# X-2026-09-23-vin-redaction: VIN serial masked in committed recordings

## Goal

The two tracked Equinox spike recordings hold the car's full VIN, hex-encoded inside the ISO-TP frames of the `0902` replies from ECUs `17` and `28`. This task replaces them in git with script-produced copies, `2026-09-22-spike.redacted.jsonl` and `2026-09-22-spike-2.redacted.jsonl`. In each copy, VIN characters 12–17 (the serial) are masked in place, and characters 1–11 (WMI, VDS, check digit, model year, plant) are kept. The masking changes only those characters. Every original line keeps its number and byte length, and the file gains exactly one trailing `meta` line that records the redaction and the source's SHA-256.

The originals leave the git index but stay on the owner's disk, gitignored and untouched. A new ADR-017 records the rule, and AGENTS.md hard rule 2 names the one allowed kind of derived recording. Code and doc references that should now point at the redacted copies are updated.

Test-visible outcome:
- `pnpm -F obd-core test` replays both `.redacted.jsonl` files.
- `uv run --no-project --with pytest pytest tools/spike` proves that the byte diff is limited to the VIN serial positions and that no form of the serial remains.
- `git status` shows the originals staged for removal from the index while still present on disk.

Owner decision 2026-09-23: "redact + ADR", with no history rewrite. It is recorded in `docs/specs/T0.4-elm327-session.md` Decisions item 4 and in `docs/task-runs/X-2026-09-23-vin-redaction.md`. This task runs before T0.4 implementation.

## Non-goals

- **No git history rewrite.** Commits up to `c88dffa` still contain the originals, and the owner has accepted that. The ADR says so.
- **No redaction at source.** The phone console (T0.8), the relay (ADR-013), `hil:smoke`, and the `tools/spike` recorders keep writing raw recordings. The ADR names redaction at source as a follow-up, and nothing here implements it.
- **No committed or local redacted copies of the discovery recordings.** See Open question 2. `2026-09-23-discovery.jsonl` and `-discovery-targeted.jsonl` stay gitignored and byte-identical. `tools/spike/targeted_watch.json` keeps citing them by SHA-256 and line.
- ~~No change to `targeted_watch.json`, `discover.py`, or `targeted.py`.~~ Superseded by Decision 3: removing DID `17`/`4193` from the tools is in scope. `targeted.py` still does not change.
- **No redaction of anything but the VIN serial.** That excludes the first 11 VIN characters, ECU names (`090A`), timestamps, and the meta line's `platform`/`bleak` fields. Also excluded are the `F18x` part and serial numbers in the discovery files, which that data would need before it could ever be committed.
- **No edits to closed specs or task records.** Their citations stay as history under the ADR's mapping rule (below).
- **No change to `packages/obd-core/src`, `recordings.test.ts`, or `ReplayTransport`.** The existing parser and replay already accept the trailing meta line (see Sources).
- **No CI wiring for `tools/spike` pytest.** It is not part of `pnpm check` today (`check:bridge` runs only `tools/hil-bridge`), and this task does not change that.
- **No VIN decoding.** That is T0.5.

## Interfaces

New file `tools/spike/redact_vin.py`. It uses only the standard library, with a `# /// script` header (`requires-python = ">=3.11"`, `dependencies = []`), in the same style as `spike.py`.

```python
VERSION = 1
MASK = "0"  # ASCII 0x30; each masked VIN byte's two hex digits become "30"
# Normalized tx command -> (reply payload prefix, payload indices where a 17-byte VIN starts).
# 0902: docs/ELM327.md + spike line 72. 224193: discovery.jsonl tx 44429 (VIN repeated four times, 68-byte run).
RULES: dict[str, tuple[bytes, tuple[int, ...]]] = {
    "0902": (bytes.fromhex("490201"), (3,)),
    "224193": (bytes.fromhex("624193"), (3, 20, 37, 54)),
}

class Message(NamedTuple):
    tx_line: int          # 1-based line of the tx this reply belongs to
    cmd: str              # normalized: trailing "\r" dropped, spaces removed, upper-cased ("22 4193\r" -> "224193")
    header: str           # "18DAF117" (29-bit) or "7E8" (11-bit)
    length: int           # ISO-TP declared length (FF) or SF length
    payload: bytes        # bytes received so far (== length bytes when complete)
    spots: list[tuple[tuple[int, int], tuple[int, int]]]  # per payload byte: (line_idx, char_idx) of its two hex digits

def messages(records: list[dict]) -> list[Message]:
    """Reassembles ISO-TP SF/FF/CF per header inside each tx's reply (rx lines up to the next tx), for every command."""

def redact(text: str, source: str, source_sha256: str) -> tuple[str, list[str]]:
    """Returns (redacted file text, one summary entry per masked message, e.g. "L72 0902 18DAF117").
    Raises ValueError (no partial output) on any refusal listed below. Never includes the VIN in any message.
    main() catches it, prints the reason on stderr, returns 1, and writes no file."""

def main(argv: list[str] | None = None) -> int:
    """uv run tools/spike/redact_vin.py <recording.jsonl>
    Writes <stem>.redacted.jsonl beside the input (open mode "x": never overwrites), prints the output path,
    line count, masked-message entries and the output SHA-256. Exit 0 ok, 1 refused (reason on stderr), 2 usage."""
```

### Behavior of `redact`

1. **Input.** The file must be UTF-8 text ending in `\n`, with one JSON object per line. Each line must round-trip exactly: `json.dumps(json.loads(line)) == line`. This is the `Recorder._write` format in `spike.py`, and all four current Equinox files satisfy it. If a line does not round-trip, refuse and name the line. The round-trip check is what lets a masked line be re-serialized without touching any other byte.
2. **Frames.** Inside each tx's reply, concatenate the `data` of the `rx` lines up to the next `tx`, keeping each character's `(line_idx, char_idx)`. Split the result on `\r` and `>`, then remove spaces from each piece. A piece that is all upper-case hex is a frame:
   - An even length means an 8-hex-digit 29-bit header.
   - An odd length means a 3-hex-digit 11-bit header.
   - The PCI nibble selects SF (`0`), FF (`1`, 12-bit length), or CF (`2`, sequence).
   - Other pieces (`SEARCHING...`, `NO DATA`, `BUFFER FULL`, truncated lines) are skipped.

   A byte's two hex digits may sit in different `rx` lines. In the spike files, ECU `28`'s serial is split across lines 81 and 82, mid-byte.
3. **Which bytes get masked.** A message qualifies when its command is in `RULES` and its FF payload starts with that rule's prefix. For each VIN start offset `o` in that rule, every payload byte at index `o+11` to `o+16` that has arrived is replaced by `MASK`, even if the message is incomplete. Those indices are VIN characters 12–17. For `0902` that is payload indices 14–19. For `22 4193` it is 14–19, 31–36, 48–53 and 65–70.

   Within a qualifying reply, refuse in these cases:
   - A CF arrives with the wrong sequence number.
   - A CF arrives with no FF for its header.
   - A received VIN byte (index `o` to `o+16` for any rule offset `o`) is outside ASCII `0-9A-Z`.
4. **Re-serialization.** Only lines that contain masked digits are re-serialized with `json.dumps` (default separators). Assert that each keeps its original length, and emit every other line verbatim.
5. **Safety net.** Every complete qualifying message teaches the script a VIN, using the original bytes. After masking, refuse if any learned VIN's serial (characters 12–17) is still present in any of these forms:
   - ASCII anywhere in the output text.
   - Hex, upper or lower case, anywhere in the output text.
   - Hex in any reply's concatenated rx data with `\r` and spaces removed.
   - Raw bytes inside the payload of any reassembled message, for any command.
6. **Marker.** Append one line, serialized the same way as `Recorder._write`:
   `{"t": <t of the last input line>, "dir": "meta", "redacted": "vin-serial", "source": "<input basename>", "source_sha256": "<64 hex>", "script": "tools/spike/redact_vin.py", "script_version": 1, "masked_messages": <n>}`.
   A result of `n = 0` is allowed. It is printed as `no VIN found`, and the copy is still written, because with Open question 1 option (b) the script is the only path into git.
7. **Naming.** `main` refuses an input whose name already ends in `.redacted.jsonl`.
8. **Determinism.** The same input bytes always give the same output bytes.

**Why `"0"`.** `0x30` keeps the redacted bytes printable ASCII in the VIN alphabet, so a VIN parser under test sees a structurally normal 17-character VIN. The hex text stays hex digits of the same width. The meta marker, not the mask character, is what declares the redaction. One consequence: the masked VIN no longer passes a check-digit validation (see Risks). Another: a serial digit that was already `0` does not change, so fewer characters differ in the file than there are masked positions (8 of 24 in each spike file).

## Files

The task edits nine files and adds two generated ones. The recordings are script output, and three of the edits are one-line path or comment changes, so the task is not split.

- `tools/spike/redact_vin.py`: create. The redaction script above, roughly 120 lines.
- `tools/spike/test_redact_vin.py`: create. The pytest cases listed under Verification.
- `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl`: create. Written only by running the script, never edited.
- `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike-2.redacted.jsonl`: create. Same.
- `.gitignore`: modify. Keep the originals out of git per Open question 1. The recommended option (b) inserts these lines above the existing discovery rule, so that discovery rule, coming last, still ignores any `*-discovery*.redacted.jsonl`:
  ```
  # ADR-017: only script-redacted recordings are committed; originals stay local
  fixtures/recordings/**/*.jsonl
  !fixtures/recordings/**/*.redacted.jsonl
  ```
  Option (a) instead adds the two explicit original paths.
- `docs/DECISIONS.md`: modify. Append ADR-017 (content below).
- `AGENTS.md`: modify. Change hard rule 2 wording only (below).
- `docs/EVAL.md`: modify. Add one line to the Fixtures tree: `recordings/<car>/<date>-<slug>.redacted.jsonl  committed form: VIN serial masked by tools/spike/redact_vin.py (ADR-017); the original stays local`.
- `apps/mobile/test/console-recording.test.ts`: modify. Line 21's comment path becomes `…/2026-09-22-spike.redacted.jsonl`. Lines 25–41 are unchanged by redaction.
- `tools/spike/test_discover.py`: modify. Line 12's comment path becomes `…/2026-09-22-spike.redacted.jsonl`. The S1 line numbers and reply texts cited there are unchanged.
- `docs/specs/T0.4-elm327-session.md`: modify, paths only, per its Decision 4. Update lines 273, 410, and 413 to `.redacted.jsonl`, and add one sentence at the top of Sources: "spike / spike-2 mean the `.redacted.jsonl` copies (X-2026-09-23-vin-redaction; line numbers identical to the originals)."

The originals get index removal only: `git rm --cached` on both. That is not a file edit. Nothing is committed unless the user asks, and the redacted copies are left for the commit step.

These files are deliberately unchanged:
- `tools/spike/test_spike.py`: lines 31 and 34 test `go.next_out_path` in a tmp dir, not the recording.
- `packages/obd-core/test/recordings.test.ts`: it globs the directory.
- `tools/spike/targeted_watch.json` and `docs/discovery-2026-09.md`: they cite the discovery originals.
- `docs/task-runs/X-2026-09-23-vin-redaction.md`: owned by the orchestrator.
- Every closed spec or task record.

### ADR-017 content (implementer writes it in the file's style)

**ADR-017: Committed recordings mask the VIN serial; originals stay local (2026-09-23)**

- **Decision.**
  - Every recording committed under `fixtures/recordings/` is a `<date>-<slug>.redacted.jsonl` copy written by `tools/spike/redact_vin.py`. In it, VIN characters 12–17 are masked in place with ASCII `0`, and characters 1–11 are kept.
  - Characters 1–11 identify make, model, model year, and plant, which ADR-014's "verified by model and year" needs. They are shared by many vehicles, unlike the serial.
  - The unredacted original stays on the owner's disk, gitignored and never edited.
- **Hard rule 2.** The copy is derived by a tested script, never by hand. The original is not modified. The copy's final meta line records the source file's SHA-256 and the script version, so provenance is checkable. Every original line keeps its number, so line citations carry over.
- **VIN locations covered.**
  - `0902` replies (`49 02 01` + 17 bytes).
  - Mode 22 DID `4193` replies (`62 41 93`, then the VIN four times back to back at payload indices 3, 20, 37 and 54; all four serial windows masked). Found on module `17` in the discovery recordings.
  - A safety net that refuses output if a learned serial survives anywhere.
- **Citations.** A citation of `<date>-<slug>.jsonl` line N in a closed spec or task record refers equally to `<date>-<slug>.redacted.jsonl` line N. SHA-256 values cited there are of the originals.
- **Git history.** Commits up to `c88dffa` still contain the unredacted spike files. The owner accepted this instead of a history rewrite, which stays possible before any public push.
- **Follow-ups (not implemented).**
  - Redact at source in the phone console export, the relay, and `hil:smoke`.
- **Refines ADR-014** ("the VIN stays on the device"): committed fixtures carry at most the first 11 VIN characters.
- **Amends AGENTS.md hard rule 2.**

### AGENTS.md hard rule 2, before → after

Before:
> 2. **Recordings are immutable.** Never hand-edit `fixtures/recordings/`. Add new ones with the recording tool. Hand-written data goes in `fixtures/synthetic/` and is labeled synthetic in the eval.

After:
> 2. **Recordings are immutable.** Never hand-edit `fixtures/recordings/`. Add new ones with the recording tool. Only `*.redacted.jsonl` copies made by `tools/spike/redact_vin.py` are committed (ADR-017); the original stays local and untouched. Hand-written data goes in `fixtures/synthetic/` and is labeled synthetic in the eval.

## Sources

| Constant / behavior | Source |
|---|---|
| Keep VIN characters 1–11, mask 12–17 | Owner decision 2026-09-23 (`docs/task-runs/X-2026-09-23-vin-redaction.md` Contract; T0.4 spec Decisions item 4). Field names (WMI, VDS, check digit, year, plant, serial) are descriptive only; no code depends on them |
| `0902` → 17-character VIN over multi-frame | `docs/ELM327.md` §Standard modes used (Mode 09 row) |
| PCI nibbles SF `0` / FF `1` + 12-bit length / CF `2` + sequence; FF example `7E8 10 14 49 02 01 …` (11-bit, spaced) | `docs/ELM327.md` §Multi-frame responses (ISO 15765-2 / ISO-TP) with `ATH1` |
| 29-bit `18DAF1<module>` headers, `ATS0` (no spaces), `0902` answered by `17` and `28` with FF length `0x14`, interleaved, split across rx lines (ECU `28`'s serial split mid-byte, lines 81–82) | `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.jsonl` lines 72–84; `-spike-2.jsonl` lines 72–84 |
| Masked positions: 24 hex digits, lines 80 (12), 81 (7), 82 (5), in both spike files; after redaction all read `30`, and only 8 characters actually change per file because some serial digits are already `0` | Computed from the two originals by the architect (read-only); the implementer's test re-derives it at runtime |
| DID `4193` on module `17` returns a 173-byte message `62 41 93` followed by a 68-byte printable run holding the VIN four times, at payload indices 3, 20, 37, 54 (serials at 14, 31, 48, 65); verified at every listed tx line | `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-discovery.jsonl` tx line 44429 (phase B; local, gitignored, SHA-256 `520fc8fb…`); `-discovery-targeted.jsonl` tx lines 9283, 18537, 27814, 36959, 46026, 55119, 64420, 73605, 82866 (phase C rotation; `targeted_watch.json` line 861) |
| No other VIN location in the four Equinox files: no ASCII or hex form of the serial outside `0902`/`22 4193` replies; none in meta lines; `0902` and `22 F190` never sent by `discover.py` | Architect's read-only scan of all four files (payload reassembly per command); `tools/spike/discover.py` `_VIN` |
| `22 F190` is not a rule | Not sent in any repo recording, so no source for its reply format (hard rule 1). Add it when a recording shows it |
| Recorder line format (`json.dumps` default separators, `ensure_ascii`), round-trips for every line of all four files | `tools/spike/spike.py` `Recorder._write`; architect's round-trip check |
| Trailing meta line accepted by the parser and replay | `packages/obd-core/src/recording/format.ts` (`z.looseObject({ t, dir: "meta" })`, `t` nonnegative); `ReplayTransport.write` skips `meta`; `recordings.test.ts` `timedOut` only reacts to a `note` starting `timeout waiting for '>'`, which the marker does not have |
| Tool conventions: stdlib, `# /// script`, ruff via the bridge env, pytest via `uv run --no-project --with pytest` | `docs/specs/T0.2-hardware-spike.md` Verification; `docs/specs/T2.3b-targeted-watch.md` Verification |
| Synthetic VIN `1C4SYNTHETICVIN00` in tests | Already the repo's synthetic VIN (`docs/specs/T0.4-elm327-session.md` Sources); synthetic, so the literal is allowed |

## Verification

All commands run from the repo root. Tests and the spec never contain the real VIN or its serial as a literal. Tests that need them compute them at runtime from the local originals.

- [ ] `cd tools/hil-bridge && uv run ruff check ../spike` passes.
- [ ] `uv run --no-project --with pytest pytest tools/spike` passes, the existing tests unchanged. The new tests in `tools/spike/test_redact_vin.py` are listed below.

  Synthetic, always run, built inline from `1C4SYNTHETICVIN00`:
  1. **29-bit, two ECUs.** Interleaved `0902` replies from two ECUs, with rx chunks cut mid-header and mid-byte. The output differs from the input only at the 12 hex digits per ECU that encode `CVIN00`, which become `303030303030`. Every original line keeps its number and length. Exactly one line is appended, and it is the meta marker, with the correct `source_sha256`, `t` equal to the last input `t`, and `masked_messages == 2`.
  2. **11-bit, spaced.** Using the `docs/ELM327.md` example form (`7E8 10 14 49 02 01 …`, spaces kept), the same property holds.
  3. **DID `4193`.** A synthetic `22 4193` reply with prefix `62 41 93`, the synthetic VIN repeated four times from index 3, and trailing bytes (at least 72 bytes in total) is masked at payload indices 14–19, 31–36, 48–53 and 65–70 only. Every other byte is identical, including the four copies of characters 1–11.
  4. **Look-alikes untouched.** A non-rule reply whose text contains `0902`, modeled on the spike `22 2AF5` reply shape, is unchanged. A `0902` reply whose FF prefix is not `49 02 01` is unchanged.
  5. **Refusals.** Each of these makes `redact` raise `ValueError`. Through `main()` it becomes exit code 1 with the reason on stderr, and no file is written:
     - A line not in `json.dumps` form, for example `{"t":1,"dir":"tx","data":"0902\r"}`.
     - A CF with the wrong sequence number in a `0902` reply.
     - A VIN byte outside `0-9A-Z`.
     - An input already named `.redacted.jsonl`.
     - An existing output file.
  6. **Deterministic.** Two runs give identical bytes. With `capsys`, printed output contains neither `CVIN00` nor its hex.

  Committed copies, always run (they are tracked):
  7. For each `2026-09-22-spike*.redacted.jsonl`:
     - The last line is the marker, with `source_sha256` equal to `6c29956dfc2ade5a2f2071f6042120b18747bfc6d0a4b821bf431fb58ba387d5` for spike or `910f0d7551e8984b585211f5fed028a2e6f770ac35853581e31469aeadbc9b7f` for spike-2, `script_version == 1`, and `masked_messages == 2`.
     - `messages()` finds exactly two complete `0902` messages (`18DAF117`, `18DAF128`), each 20 bytes starting `49 02 01`, with payload bytes 14–19 equal to `b"000000"`, and the two payloads equal.

  Local-only, `pytest.skip("NOT RUN: original not on disk")` when absent:
  8. **Spike originals.** `redact(original)` equals the committed copy byte for byte. Only the 24 hex-digit serial positions, in lines 80, 81 and 82, may differ. After redaction they all read `30` (ASCII `0`), and every other byte is identical. The line count is original + 1. The serial learned at runtime from the original appears nowhere in the committed copy: not as ASCII, not as hex in either case, and not in any reassembled payload. The first 11 VIN characters are still present in the `0902` payloads.
  9. **Discovery originals, in memory only, nothing written.** `redact()` reports 1 masked message for `2026-09-23-discovery.jsonl` and 9 for `-discovery-targeted.jsonl`, all `22 4193` from `18DAF117`. In each message only the 48 hex-digit positions of the four serial windows may differ, and after redaction they all read `30`. Every other byte is identical, and the safety net passes. The run is slow because the files have about 156k lines; mark it NOT RUN if the files are absent.
- [ ] Before and after, `sha256sum` on both spike originals prints `6c29956d…87d5` and `910f0d75…9b7f` unchanged.
- [ ] Run `uv run tools/spike/redact_vin.py fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.jsonl` and the same for `-spike-2.jsonl`. Each exits 0 and prints 2 masked messages (`L72 0902 18DAF117`, `L72 0902 18DAF128`) and the output SHA-256. Paste both summaries into the task record. A second run exits 1 because the output exists.
- [ ] `wc -l` on the redacted copies prints 172 (spike) and 174 (spike-2). `cmp -l <original> <redacted>` lists only byte offsets inside the 24 hex-digit serial positions, with the redacted byte `060` or `063` (octal for ASCII `0` and `3`), and `cmp` reports EOF on the original after byte 8764 (spike) and 8854 (spike-2). Together these show equal-length lines up to the appended marker.
- [ ] `pnpm -F obd-core test` output lists `replays fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl` and `…-spike-2.redacted.jsonl`, both passing. The local originals and discovery files still pass too.
- [ ] `pnpm check` is green.
- [ ] Run `git rm --cached` on both originals. Then:
  - `git status --short fixtures/recordings` shows `D ` for both originals and `??` for both `.redacted.jsonl` copies.
  - `git check-ignore -v` matches both originals and both discovery files.
  - `git check-ignore` on both `.redacted.jsonl` copies exits 1, meaning not ignored.
  - `ls` shows all four originals still on disk.
- [ ] `grep -rn "2026-09-22-spike.jsonl\|2026-09-22-spike-2.jsonl" apps packages tools docs/specs/T0.4-elm327-session.md` prints only `tools/spike/test_spike.py` lines 31 and 34, which are the tmp-dir `next_out_path` tests.
- [ ] Hardware-only: none. This task sends nothing to a vehicle.

## Risks / open questions

Risks:
- **Other clones lose the originals on pull.** A commit that removes a tracked file deletes it from every other clone on `git pull`, including the Windows laptop that recorded the spikes, even though the path is now ignored. The WSL copy survives because `--cached` keeps it on disk. Before pulling elsewhere, copy the originals aside. Alternatively, restore them afterwards with `git show c88dffa:fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.jsonl > <path>`, which works because history keeps them.
- **The history still holds the full VIN.** Anyone with the repo can recover it. That is acceptable for a private repo. A public push should revisit a history rewrite.
- **Check-digit validation fails on the masked VIN.** VIN character 9 was computed over the real serial. T0.5 must not assert check-digit validity on the recorded VIN; it should use the synthetic VIN for that.
- **The safety net only catches known VINs.** It detects serials it learned from a rule location. A future recording whose only VIN appears in some other DID would pass unmasked. The ADR's redact-at-source follow-up and a review of any new VIN-bearing DID are the mitigation. Today's four files were scanned, and `4193` is the only other location.
- **`tools/spike` tests are not in CI.** Test 7, the proof on the committed copies, runs only when someone runs the spike pytest. Adding it to `pnpm check:bridge` is a follow-up if wanted.

Open questions:
1. **How the originals stay out of git.**
   - (a) Two explicit `.gitignore` lines for the two spike originals. This is the minimum.
   - (b) Default-deny: ignore `fixtures/recordings/**/*.jsonl` except `*.redacted.jsonl`, with the discovery rule kept last. Every future raw recording (phone export, `hil:smoke`, `spike.py`) is then ignored until it goes through the script, which enforces ADR-017 without relying on discipline. Cost: the script must also be run on recordings with no VIN, which is why `masked_messages: 0` is allowed. A future `*.log.jsonl` charge-log format would need its own rule when T2.x defines it.

   **Recommendation: (b).**
2. **Redacted copies of the discovery recordings.**
   - (a) None now. The script is proven on them in memory (test 9), and the originals stay untouched and gitignored.
   - (b) Local `.redacted.jsonl` copies now.

   **Recommendation: (a).** They must stay gitignored anyway, because they also hold `F18x` part and serial numbers (`docs/discovery-2026-09.md` line 5), which VIN masking does not cover. A local copy beside the original adds no privacy. It would also double the local replay time (about 120 s per file) and need a second `EARLY_PROMPT` SHA-256 entry in `recordings.test.ts`, since the copy's hash differs.
3. **DID `17`/`4193` in the targeted watch list.** It returns the full VIN on every rotation cycle, which conflicts with the T2.3a/T2.3b "no VIN reads" decision (`discover.py` `_VIN` blocks only `0902` and `22 F190`). Options:
   - (a) A separate small follow-up removes `["17", "4193", 44429]` from `targeted_watch.json`, adds `"22 4193"` to `_VIN`, and updates `test_targeted.py`'s rotate count from 839 to 838.
   - (b) Fold that into this task.

   **Recommendation: (a).** It changes tool behavior and T2.3b's tested contract, not recordings.

## Decisions
Answered by the user 2026-09-23 (orchestrator recorded):

1. Gitignore: ignore every raw `fixtures/recordings/**/*.jsonl` except `*.redacted.jsonl`, keeping the discovery rule. As recommended.
2. Discovery copies: none now; the script is tested on them in memory only. As recommended.
3. DID `4193` (VIN on module `17`): **folded into this task** (owner overrode the recommendation). Scope additions: remove `["17","4193",…]` from `tools/spike/targeted_watch.json`; add `22 4193` to `discover.py`'s VIN refusal (`_VIN`) so no tool can request it again, keeping `discover.py` within its 299-line limit; update `tools/spike/test_targeted.py` (rotate count 839 → 838, and the re-derivation rule in `test_watch_list_cites_recording` must exclude VIN-bearing DIDs so the list still equals the derived rule); add a refusal test for `22 4193` in `tools/spike/test_discover.py`; append a one-line amendment note to `docs/specs/T2.3b-targeted-watch.md` and `docs/specs/T2.3a-equinox-discovery.md` recording the change. The local discovery recordings stay untouched (they still contain the VIN and stay gitignored). Files added by this decision (orchestrator note for the reviewer): `tools/spike/targeted_watch.json`, `tools/spike/discover.py`, `tools/spike/test_targeted.py`, `tools/spike/test_discover.py`, `docs/specs/T2.3a-equinox-discovery.md`, `docs/specs/T2.3b-targeted-watch.md` (modify).

## Amendment 2026-09-23

After implementation attempt 1 (`docs/task-runs/X-2026-09-23-vin-redaction.md`):

1. **DID `4193` holds the VIN four times.** The VIN starts at payload indices 3, 20, 37 and 54 (a 68-byte printable run) in every reply: discovery tx 44429 and targeted tx 9283, 18537, 27814, 36959, 46026, 55119, 64420, 73605, 82866, all from `18DAF117`, each 173 bytes. The architect re-checked this against the local recordings. `RULES` now maps each command to a prefix and a tuple of VIN offsets, and all four serial windows are masked (14–19, 31–36, 48–53, 65–70). Updated: Interfaces, Behavior step 3, the ADR text, the Sources row, and tests 3 and 9.
2. **Byte-diff wording.** Replaced the "24 bytes changed" and "12 hex digits per message" wording. Only the serial positions may differ, and after redaction they all read `30`. Every other byte is identical. In memory only 8 characters change per spike file, because some serial digits are already `0`. Updated: "Why `0`", Sources, test 8, test 9, and the `cmp` check.
3. **Refusals.** `ValueError` from `redact` becomes exit 1 in `main()`, with the reason on stderr and no file written. The implementer's behavior is accepted, and Interfaces and test 5 now say so.
4. **Decision 3** puts removing DID `17`/`4193` from the tools in scope, so the Non-goal that excluded it is struck through and the ADR follow-up line for it is removed. Decisions 1–3 are otherwise unchanged.

Orchestrator note 2026-09-23 (review round 1, finding 4): the script refuses any bad or extra consecutive frame in any reply to a RULES command, including non-qualifying replies and a CF after a complete message. This is stricter than Behavior step 3; accepted, because refusing to write a copy can never leak. The repair round also updates the stale `.gitignore` comment ("until the redaction ADR") and the discovery run card's "no VIN" statement (`docs/discovery-2026-09.md`), which DID `4193` disproved.
