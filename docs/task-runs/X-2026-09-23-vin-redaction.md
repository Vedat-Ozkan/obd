# X-2026-09-23-vin-redaction task run

## Ownership

- Last tool: Claude
- Last role: reviewer (round 2: APPROVE, 2026-09-23)
- Current stage: CLOSED 2026-09-23 (no hardware items)
- Completed stages: preflight, architecture (Claude architect 2026-09-23), open questions answered, scope (owner: "redact vin then implement"), implementation (Claude implementer; its final report was lost to an API session limit, state reconciled by the orchestrator)
- Other active tool or role: none

## Contract

- Task: redact the VIN in tracked recordings (owner decision 2026-09-23, recorded in `docs/specs/T0.4-elm327-session.md` Decisions item 4): a script produces masked copies of the tracked Equinox spike recordings with the VIN's last 6 characters masked in place (line numbers unchanged); the originals move to a private/local store and are gitignored; an ADR records the rule (refines AGENTS.md hard rule 2 and ADR-014's "VIN stays on the device"); existing references to the spike files are updated to the redacted copies; runs before T0.4 implementation. Git history rewriting is out of scope (not chosen).
- Spec paths: `docs/specs/X-2026-09-23-vin-redaction.md`
- Approved decisions: owner chose "redact + ADR" (not history rewrite) on 2026-09-23 and "redact vin then implement"; spec questions: gitignore all raw except `*.redacted.jsonl`; no discovery copies now; DID `4193` removal folded into this task (owner override)
- Repair count: 1 of 2
- Escalation count: 0
- Escalation reason: none

## Baseline

- Git state at start: `main` at `c88dffa`; untracked `docs/specs/T0.4-elm327-session.md`, `docs/task-runs/T0.4.md` (T0.4 orchestrator work, not this task).
- Tracked recordings with the VIN: `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.jsonl` (SHA-256 `6c29956d…`) and `-spike-2.jsonl` (`910f0d75…`); `0902` replies from ECUs `17` and `28`. Local gitignored discovery recordings (2026-09-23) also contain the VIN via Mode 22 DID `4193` on module `17` (architect finding; not phase A as first assumed): once in the discovery file, 9 times in the targeted file.
- Files referencing the spike recordings by name include `packages/obd-core/test/*`, `apps/mobile/test/console-recording.test.ts`, `tools/spike/test_spike.py`, `tools/spike/test_discover.py`, several specs and task records.

## Touched files

- `docs/task-runs/X-2026-09-23-vin-redaction.md` (this record)
- `docs/specs/X-2026-09-23-vin-redaction.md` (architect; Decisions by orchestrator)

## Verification evidence

### Implementation attempt 1 (Claude implementer, 2026-09-23): stopped on spec errors

- Built `tools/spike/redact_vin.py` only (untracked); nothing generated, nothing untracked in git, no other edits. Baselines: ruff PASS; `pytest tools/spike` 46 passed; recording SHA-256s unchanged.
- In memory: both spike originals redact with lines 80–82 changed, line counts +1 (meta), lengths kept, leak check passes. Discovery originals: the script refuses (VIN survives).
- Spec error 1: every DID `4193` reply holds the VIN four times (payload indices 3, 20, 37, 54), not once. Orchestrator decision: mask all four serial windows, offsets sourced from the recordings (needed when discovery recordings are later redacted for T2.1 citations).
- Spec error 2: "24 bytes changed" should read "only the 24 serial positions may differ, and they read `30`" (8 characters actually change per spike file). Implementer's `main` refusal → exit 1 interpretation accepted.

### Implementation attempt 2 (Claude implementer, 2026-09-23) — terminated by an API session limit before reporting; reconciled by the orchestrator

- On disk: `tools/spike/redact_vin.py`, `tools/spike/test_redact_vin.py`; `2026-09-22-spike.redacted.jsonl` (SHA-256 `371030ef…`, 172 lines) and `-spike-2.redacted.jsonl` (`bd71be55…`, 174 lines), each one meta line longer than its original; originals untracked (`git rm --cached`, staged `D`) and still on disk with unchanged SHA-256 (`6c29956d…`, `910f0d75…`); discovery recordings unchanged (`520fc8fb…`, `4df9d935…`); `.gitignore` (raw ignored, `*.redacted.jsonl` allowed); ADR-017; AGENTS.md rule 2; EVAL.md; path updates (T0.4 spec, `console-recording.test.ts`); DID `4193` removed from `targeted_watch.json`, added to `discover.py`; `test_discover.py`, `test_targeted.py`; T2.3a/T2.3b amendment notes.
- Orchestrator reruns (2026-09-23): `cd tools/hil-bridge && uv run ruff check ../spike` PASS; `uv run --no-project --with pytest pytest -q tools/spike` PASS (63); `pnpm check` PASS (obd-core 44, mobile 50); `git diff --check` PASS. The remaining `2026-09-22-spike.jsonl` strings in `tools/spike/test_spike.py:31,34` are intended (they test `next_out_path` naming in a tmp dir). Byte-diff, leak check, and redaction-specific checks left to the reviewer.

## Review findings

### Round 1 (Claude reviewer, 2026-09-23): REQUEST_CHANGES

1. [major, CLOSED round 2] `tools/spike/test_redact_vin.py` — no test makes the safety net refuse (a no-op net passed all 15 tests). Add a synthetic test with the VIN serial in a reply no rule covers: ValueError, `main()` exit 1, no file written.
2. [minor, closed by orchestrator] script summaries pasted below.
3. [minor, CLOSED round 2] refusal tests do not assert the stderr reason; the "CF with no FF" refusal is untested.
4. [minor, accepted] stricter CF refusal than spec step 3; recorded in the spec.
5. [minor, CLOSED round 2] redundant `UnicodeDecodeError` catch; bare `assert` at line 141.
- Notes, fixed in the repair round: stale `.gitignore` comment; `docs/discovery-2026-09.md` "no VIN" statement.
- Reviewer evidence: regenerated copies byte-identical to the committed ones (SHA-256 `371030ef…`, `bd71be55…`); only the 24 serial positions differ (8 characters), all `0`; leak scan of 103 files and every reassembled payload: 0 hits; originals untracked and intact; check-ignore correct; replay passes; DID 4193 removal correct; `pytest tools/spike` 63 passed; `pnpm check` PASS.
- Script summaries (verification item 4), reproduced by the reviewer: spike → `L72 0902 18DAF117`, `L72 0902 18DAF128`, 172 lines, SHA-256 `371030ef…`; spike-2 → same two entries, 174 lines, SHA-256 `bd71be55…`; second run exit 1 "output exists"; `.redacted.jsonl` input exit 1.

### Repair round 1 (Claude implementer, 2026-09-23)

- `redact_vin.py`: explicit length check raising ValueError; redundant `UnicodeDecodeError` catch removed. `test_redact_vin.py`: refusal tests assert the stderr reason; new cases CF-without-FF, VIN serial in an unlisted DID `22 1234`, serial in a meta note. `.gitignore` comment and `docs/discovery-2026-09.md` "no VIN" statement corrected.
- No-op safety-net mutation: the two new leak cases fail (DID NOT RAISE) — PASS; `pytest tools/spike` 66 passed; ruff PASS; `pnpm check` PASS; `git diff --check` PASS; regeneration into a temp dir byte-identical (`371030ef…`, `bd71be55…`), originals unchanged; nothing committed.
- Open question: the safety net only runs once a serial has been learned from a RULES reply, so a file whose only VIN is in an unlisted DID passes unrefused (existing behavior).

### Round 2 (Claude reviewer, 2026-09-23): APPROVE

- 10/10 items PASS; round-1 findings fixed; mutation check reproduced (no-op net → 2 failing leak tests); regeneration byte-identical; leak scan of 103 files 0 hits; originals and discovery recordings unchanged; `pytest tools/spike` 66; `pnpm check` PASS.
- Minor: script length 195 vs "roughly 120" (no action). Follow-up (with ADR-017's redact-at-source item): the safety net only runs after a serial is learned from a RULES reply; add a `22 F190` rule once a recording shows its reply format, and review any new VIN-bearing DID before its recording goes through the script. Already in the spec's Risks.

## Blocker

- None.

## Next action

- Owner commits (the staged deletions of the two originals plus the new files); note that pulling on another clone removes the originals there. T0.4 implementation proceeds against the redacted copies.
