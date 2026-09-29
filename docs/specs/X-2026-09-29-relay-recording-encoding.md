# X-2026-09-29-relay-recording-encoding: relay recordings in the form the redactor accepts

## Goal

A recording written by the phone relay (`tools/relay/broker.ts`, used by `pnpm hil:smoke` and the MCP `start_recording` tool) is written in the same on-disk form as every other recording writer: Python `json.dumps` form (`", "` and `": "` separators, ASCII only, every `data` character above U+007E written as a `\u00XX` escape), so `uv run tools/spike/redact_vin.py <raw>` accepts it and produces a `.redacted.jsonl` copy. The observed failure was on 2026-09-28. `pnpm hil:smoke` passed, but the redactor then refused the raw file with `'utf-8' codec can't decode byte 0xfc`. Today the broker writes `JSON.stringify(...)` (compact separators, raw U+00FC) with `appendFile(..., "latin1")`, so the junk byte the ELM emits after `ATZ` lands on disk as a bare `0xFC` byte. Even without that byte, the compact separators would fail the redactor's `json.dumps(json.loads(line)) == line` check. The test-visible outcome is a fake-phone `hil:smoke` run whose `ATZ` reply carries non-ASCII junk bytes. It passes, writes an ASCII file, and the real redactor accepts that file. The redacted copy still parses and replays with those bytes intact.

## Non-goals

- No change to `tools/spike/redact_vin.py`: no legacy or compact-form mode and no latin1 decode. Its strict form check is the ADR-017 safety boundary.
- No edit, conversion or redaction of the existing raw `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-28-relay-smoke.jsonl` (hard rule 2). It stays local and gitignored (`.gitignore` lines 21–23) and is not T0.6 evidence. It holds no VIN, because the `hil:smoke` sequence has no `0902`. A new `hil:smoke` run after this fix replaces it as evidence (Verification, hardware-only).
- No change to the recording parser (`parseRecording`), `ReplayTransport`, `hil-smoke.ts`, or readers that open recordings with `"latin1"`. That read is correct for an ASCII file and matches the repo convention (`packages/obd-core/scripts/replay.ts` line 191).
- No moving `RecordingBuffer.pythonJsonLine` (apps/mobile) onto the shared helper, and no other writer refactor.
- No filtering or dropping of the ELM junk byte. Recordings keep raw bytes (§Clone quirks: the session discards up to the first `>`; the recording does not).

## Interfaces

```ts
// packages/obd-core/src/recording/provenance.ts
// before: function pythonJson(value: unknown): string          (module-private)
// after:
export function pythonJson(value: unknown): string;             // body unchanged

// tools/relay/broker.ts, private append(): the line text and file encoding change, nothing else
// before: await appendFile(recording.path, JSON.stringify({ t, ...line }) + "\n", "latin1");
// after:  await appendFile(recording.path, pythonJson({ t, ...line }) + "\n", "utf8");   // output is ASCII
```

`pythonJson` already produces Python `json.dumps` form for flat objects of strings and numbers. It uses `pyString` (scrub.ts) for strings and `JSON.stringify` for numbers, which is the same number handling the app's `pythonJsonLine` uses. Every broker line is such an object: `t`, `dir`, `data`, and meta keys holding strings or the integer `mtu`. The `rx` data stays `Buffer.from(bytes).toString("latin1")` (ISO-8859-1 chars U+0000–U+00FF). `pyString` turns chars in U+007F–U+00FF into `\u00XX`, and `JSON.stringify` turns controls below U+0020 into `\uXXXX`/`\r`, both exactly as Python does.

## Files

- `packages/obd-core/src/recording/provenance.ts`: modify. Export `pythonJson`.
- `tools/relay/broker.ts`: modify. `append` writes `pythonJson(...)` with `"utf8"`, plus a one-line why-comment citing `redact_vin.py _check`.
- `tools/relay/server.test.ts`: modify. Add the E2E below.
- `docs/ARCHITECTURE.md`: modify. Add one sentence under "Recording format": files are UTF-8 in Python `json.dumps` form (ASCII, `\u00XX` escapes for `data` chars above U+007E, `", "`/`": "` separators), the only form `tools/spike/redact_vin.py` accepts; `data` is ISO-8859-1-decoded bytes.

## Sources

| Constant / behavior | Source |
|---|---|
| ELM may emit garbage bytes on the first reply after `ATZ` | `docs/ELM327.md` §Clone quirks seen in the wild ("First command after `ATZ` may return garbage bytes") |
| Observed `0xFC` before `\r\rELM327 v1.5` in the relay `ATZ` rx | local raw `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-28-relay-smoke.jsonl` (byte 328, per the task statement; not committed, not re-inspected here) |
| `data` = bytes decoded as ISO-8859-1, file is UTF-8 | `docs/specs/T0.2-hardware-spike.md` §Recording format contract; `packages/obd-core/src/recording/format.ts` (`latin1String`); `fixtures/README.md` §Implemented recording JSONL contract |
| Redactor decodes UTF-8 and requires `json.dumps(json.loads(line)) == line` | `tools/spike/redact_vin.py` `_check` and `main` (`raw.decode("utf-8")`); ADR-017 |
| Other writers already emit that form | `tools/spike/spike.py` (`open(..., encoding="utf-8")` + `json.dumps`, `CODEC = "iso-8859-1"`); `apps/mobile/src/recording.ts` `pythonJsonLine`; `packages/obd-core/src/recording/provenance.ts` `pythonJson`; `packages/obd-core/src/recording/scrub.ts` `pyString` |
| Python escapes U+007F and U+0080–U+00FF as `\u00XX` | checked here: `python3 -c 'import json; print(json.dumps("\x7f\x00\x1f\x80\xfc"))'` → `"\u007f\u0000\u001f\u0080ü"` |
| `hil:smoke` sequence and banner | unchanged; `tools/relay/hil-smoke.ts` and `docs/specs/T0.6a-node-relay-mcp.md` decision 5 |
| `uv` available to vitest in CI; TS tests may spawn the redactor | `.github/workflows/check.yml` (`astral-sh/setup-uv`); precedent `tools/beta-intake/intake.ts` `uvRedact` |

## Verification

- [ ] **E2E** (`tools/relay/server.test.ts`, new `it`, "hil:smoke writes a relay recording redact_vin.py accepts, junk bytes included"). Follow the existing fake-phone `hil:smoke` tests (`fixture(false)`, stdout spy):
  1. Run `hilSmoke(broker)`. The fake phone answers the seven commands with: `ATZ`: `JUNK + banner`, where `JUNK = "\x00\x7F\x80\x9F\xFC\xFF"` (synthetic; `0xFC` as observed on 2026-09-28, the others one per escape class); `OK\r\r>` five times; then `raw`.
  2. `run` resolves, and stdout contains `Replay matched live response.` and the recording path. The replay equality inside `hil-smoke.ts` proves the round trip byte for byte, and no byte is remapped the windows-1252 way.
  3. The raw file's bytes are all `< 0x80`. `parseRecording(readFileSync(file, "latin1"))` gives an `ATZ` rx `data` exactly equal to `JUNK + banner`.
  4. `spawnSync("uv", ["run", "tools/spike/redact_vin.py", <absolute raw path>], { cwd: <repo root>, encoding: "utf8" })` exits 0. Its stdout names the `.redacted.jsonl` path and says `no VIN found`.
  5. The redacted copy parses. Its `ATZ` rx `data` still equals `JUNK + banner`, and its last line is the redactor's `"redacted": "vin-serial"` meta. `replayRecording(parsed)` (`packages/obd-core/scripts/replay.js`) completes and its output contains the `0100` exchange.
  6. Artifact: the test logs the redacted copy's `ATZ` rx line and the `replayRecording` output. The reviewer sees the `ü`-style escapes and the decoded `0100` in the vitest log, and the implementer pastes both into `docs/task-runs/X-2026-09-29-relay-recording-encoding.md`. Give the test a timeout of about 60 s, because it spawns `uv`.
- [ ] Failure modes this E2E must catch (no isolated tests; each one fails a numbered step above):
  1. Raw non-ASCII byte written to disk (the 2026-09-28 bug): steps 3 and 4 fail.
  2. Compact `JSON.stringify` separators: step 4 fails ("not in json.dumps form").
  3. An escape class that differs from Python's (controls, `0x7F`, `0x80`–`0x9F`, `0xA0`–`0xFF`, `\r`): step 4 fails, because `JUNK` and the banner cover each class.
  4. A byte value changed in the round trip (U+FFFD, or a windows-1252 remap of `0x80`–`0x9F`): steps 2, 3 and 5 fail.
  5. `t` or `mtu` number form that differs from Python (for example `0` vs `0.0`): step 4 fails on the meta line or on the first timestamped line.
- [ ] Existing relay tests still pass unchanged. They read files with `"latin1"`, and an ASCII file reads identically.
- [ ] `pnpm check` green.
- [ ] Hardware-only (owner session; needed for the T0.6 gate, not for this task's software acceptance): run `pnpm hil:smoke` through the phone relay on the Equinox, then `uv run tools/spike/redact_vin.py <printed raw path>`, then `pnpm replay <…>.redacted.jsonl`. Expect the redactor to exit 0 and replay to print the `0100` exchange. Record both paths in `docs/task-runs/T0.6.md`. Until that run happens this item is NOT RUN, and nothing claims the 09-28 file was redacted.

## Risks / open questions

- A future broker meta key holding a nested object or array would go through `pythonJson`'s object branch. Arrays would be written wrongly, and the redactor would refuse the file. That fails closed, and no such key exists today.
- Not material: the owner may delete the unredactable 2026-09-28 raw file or keep it locally. This task does neither.

## Decisions
