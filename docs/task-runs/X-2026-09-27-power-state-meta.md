# X-2026-09-27-power-state-meta task run

## Current state (as of 2026-09-27)

- **Stage:** architecture done (spec written). Open questions 1–6 await orchestrator or owner decisions. No implementation yet.
- **Repair count:** 0 of 2. **Escalations:** 0.
- **Verification:** none run for this task. Baselines checked by the architect at `8dcc0e7`:
  - PASS: the Stage A scrub summary regenerates to `452e139309cd680f824106b1205e50bcb00b973c4697ba86702ebaa7ebacb94b`.
  - PASS: `battery-diagnosis.ts` on `2026-09-22-spike.redacted.jsonl` gives no diff against `packages/obd-battery/test/battery-diagnosis-spike.md`.
- **NOT RUN:** everything in the spec's Verification section. Implementation has not started.
- **Next action:** see below.

## Ownership

- Last tool: Claude
- Last role: architect
- Current stage: architecture
- Completed stages: preflight
- Other active tool or role: Codex T2.10 is uncommitted in `packages/obd-assist/`, `tools/summary-backend/`, `fixtures/synthetic/t2.10-*`, `docs/specs/T2.10*` and `docs/task-runs/T2.10.md`. These are off-limits (spec §Non-goals).
- Baseline (`git status --short` at start, HEAD `8dcc0e7`):
  ```
   M docs/specs/T2.10c-hosted-deepseek-eval.md
   M docs/specs/T2.10d-mobile-rewarded-summary.md
   M docs/task-runs/T2.10.md
   M fixtures/synthetic/t2.10-summary-responses.json
   M packages/obd-assist/scripts/replay-summary.ts
   M packages/obd-assist/src/check.ts
   M packages/obd-assist/test/summary-replay.test.ts
  ?? docs/specs/T2.10a-exact-quantity-amendment.md
  ?? docs/specs/T2.10c2-production-summary-eval.md
  ?? tools/summary-backend/
  ```

## Contract

- Task: T2.9 Decision 19 follow-up. The battery-scan power state gets its own allowlisted meta key (decided yes, `docs/task-runs/T2.9.md`).
- Spec path: `docs/specs/X-2026-09-27-power-state-meta.md`
- Approved decisions: none yet (spec open questions 1–6).

## Log

- 2026-09-27, Claude architect: wrote the spec. Key `powerState` with values `{ready, unknown}`, `SCRUB_VERSION` 2, report key-first with the note as fallback, `batteryScanMeta` in `batteryDiagnosisFlow.ts`, and E2E E1 through the outbox over both backends. 10 files, no new dependencies, no hardware gate.

## Next action

- Orchestrator: decide open questions 1–6, record them in the spec's §Decisions, then spawn the implementer.
- 2026-09-27, orchestrator: open questions 1–6 decided as recommended (spec §Orchestrator decisions). Implementer spawned; repair count 0 of 2.

## Implementer (Claude, 2026-09-27)

### Failure modes, written before any code (spec §Verification "Isolated tests")

- S1. An out-of-set string `powerState` (`"other"`, `"Ready"`, `"ready, park"`, `"2026-09-27"`) is kept or silently dropped instead of refusing. It must throw `ScrubRefusal` carrying the line number. Test: `beta-scrub.test.ts` `power-state-refusal`, table 1.
- S2. A non-string `powerState` (`true`, `1`, `null`, `["ready"]`, `{}`) is kept or dropped instead of refusing. Same case, table 2.
- S3. The refusal message echoes the value. The message must not contain the test value (VIN-like `"1C4SYNTHETICVIN00"`). Same case.
- R1. The key does not win over the note. With `powerState: "unknown"` and a note containing `ready`, the result must be `"unknown"`. With `powerState: "ready"` and a note without `ready`, it must be `"ready"`. Test: `battery-diagnosis.test.ts` `power-state-key-wins`. Inputs are synthetic, built from `battery-diagnosis-full-scan.jsonl` with only line 1 replaced.
- R2. An invalid key value in a local file (`"other"`, `1`) is silently treated as unknown or as ready. It must throw `"battery scan power state meta is invalid"`. Test: `power-state-invalid`.

### Baselines at HEAD 8dcc0e7, before any edit

- Stage A: `beta-scrub.ts` over SPIKE, SPIKE2, PHONE, TARGETED gives `452e139309cd680f824106b1205e50bcb00b973c4697ba86702ebaa7ebacb94b`.
- `/tmp/t2.9-b-codes.jsonl` and `/tmp/t2.9-c1-codes.jsonl`: `eb769cd0056a463cf6ccb37acbcf62df58e0c7ad5b97968c9aa9cb4c931e976b`.
- `/tmp/t2.9-b-charge-log.jsonl` and `/tmp/t2.9-c1-charge-log.jsonl`: `e1bb7feed1a095bb9ddf1b12d38a3084a8a0aa71342a10e3a8ee4f0d77365034`.
- `/tmp/t2.9-c2-intake.txt`: `bfacfd433ef4a5d34307dd409632d7f82ee9f435e3a5c79b84329e9e72a5cf7d`.
- `/tmp/t2.6d-synthetic-report.md`: `6250569a901e1d3a5ba59f4147c3aa75f553a7beb432a4c385705e589818cab3`.
- `battery-diagnosis-spike.md` diff: no diff. `twelve-volt-reports.md` diff: no diff.
- HEAD copies of the B/C1 artifacts are saved in the implementer scratchpad so the `head -n -1` comparison can be run.

### Tests recorded failing before implementation

Recorded after the tests were written and before any source edit:
- `beta-scrub.test.ts` `power-state-refusal`: FAIL (the scrubber accepted the value).
- `battery-diagnosis.test.ts` `power-state-key-wins`: FAIL (`expected [ 'ready' ] to deeply equal [ 'unknown' ]`).
- `battery-diagnosis.test.ts` `power-state-invalid`: FAIL (the promise resolved).
- `beta-outbox.test.ts` E1, all 4 cases (2 backends x 2 toggle values): FAIL (`batteryScanMeta is not a function`).

### Implementer report

```
Spec: docs/specs/X-2026-09-27-power-state-meta.md
Changed: packages/obd-core/src/recording/scrub.ts, packages/obd-core/test/beta-scrub.test.ts,
  packages/obd-core/test/beta-provenance.test.ts, packages/obd-battery/src/report.ts,
  packages/obd-battery/test/battery-diagnosis.test.ts, apps/mobile/src/recording.ts,
  apps/mobile/src/batteryDiagnosisFlow.ts, apps/mobile/App.tsx, apps/mobile/test/beta-outbox.test.ts,
  docs/specs/T2.9-beta-data-upload.md (meta-key row only)
Verification:
  - E2E E1, both backends x ready/unknown (steps 1-6) : PASS
  - E1 artifacts, stable across 2 runs (a direct vitest run, then pnpm check) : PASS
      /tmp/x-power-state-b-ready.jsonl    43a013403e1d436cc0484b3084e617237983593ed49069a3590e6d38c7c0192f
      /tmp/x-power-state-c1-ready.jsonl   43a013403e1d436cc0484b3084e617237983593ed49069a3590e6d38c7c0192f
      /tmp/x-power-state-b-unknown.jsonl  fbad1b5b64f89df1cccddb88bc7e114b738baa27c66763d1e81c0fde878de46d
      /tmp/x-power-state-c1-unknown.jsonl fbad1b5b64f89df1cccddb88bc7e114b738baa27c66763d1e81c0fde878de46d
  - Isolated S1-S3 (power-state-refusal), R1 (power-state-key-wins), R2 (power-state-invalid) : PASS
  - Mutation M1, powerState removed from META_KEYS: all 4 E1 cases fail at step 5 (first-line toMatchObject) : PASS (bites)
  - Mutation M2, scrub value check disabled: power-state-refusal fails : PASS (bites)
  - Mutation M3, report ignores the key (note only): power-state-key-wins fails, and E1 fails in both ready cases.
    The uploaded note is "removed before upload", so the replay says unknown while the local report says ready.
    The unknown cases still pass : PASS (bites)
  - Mutation M4, note fallback removed (key ?? "unknown"): battery-diagnosis-spike.md diff shows
    "state ready" -> "state unknown", and /tmp/t2.6d-synthetic-report.md changes (ee28cfad… vs 6250569a…).
    No vitest case fails : PASS (bites, through the artifact diffs only; see Questions)
  - Backward compat: battery-diagnosis.ts on 2026-09-22-spike.redacted.jsonl | diff battery-diagnosis-spike.md : PASS (no diff)
  - Backward compat: twelve-volt-report.ts on both spikes | diff twelve-volt-reports.md : PASS (no diff)
  - Backward compat: /tmp/t2.6d-synthetic-report.md unchanged (6250569a…) and the existing
    battery-diagnosis / battery-diagnosis-flow tests unchanged and green : PASS
  - Stage A: beta-scrub.ts over the four recordings | sha256sum = 452e139309cd…ebacb94b : PASS
  - C2 intake log /tmp/t2.9-c2-intake.txt = bfacfd433ef4…72a5cf7d, both runs : PASS
  - Stage B/C1 artifacts: `head -n -1` byte-identical to the HEAD-generated copies (cmp) for all four files.
    The last line differs only in "scrubVersion": 1 -> 2 (cmp after sed on the base copy). Both runs give the same new hashes : PASS
      /tmp/t2.9-b-codes.jsonl, /tmp/t2.9-c1-codes.jsonl                01d894f4e2bba12a31c0f1a0aa49367099a99620c0ecfa5f6c34f04fe038e9b4
      /tmp/t2.9-b-charge-log.jsonl, /tmp/t2.9-c1-charge-log.jsonl      fbb90c1785b9222e9b42953875b50949075dd18449766435f7d14f816dc5043e
  - No recording edited (git status fixtures/recordings clean) : PASS
  - pnpm check (typecheck incl. mobile, lint, all tests, bridge ruff + pytest) : PASS
  - pnpm -F obd-core / obd-battery / mobile test, mobile typecheck (inside pnpm check) : PASS
  - cd tools/hil-bridge && uv run pytest ../spike : PASS (68 passed)
  - expo export --platform android into a scratchpad temp dir, then deleted : PASS (AppEntry .hbc bundle, 760 modules)
  - git diff --check on the changed files : PASS
  - No off-limits path in this task's changes : PASS (Codex T2.10 files untouched; they kept changing during the run, which is Codex's work)
  - Hardware (optional owner check) : NOT RUN (needs the phone and the Equinox; not a gate)
Deviations from spec: none. The scrub.ts POWER_STATES source comment names the spec path instead of the words
  "this task's spec". E1 runs runAndSaveBatteryDiagnosis with an entry from createGarageFlow().add("…", "mine")
  (id "1", the same as MINE), because the report history checks the garage, and queues with MINE as the spec says.
Not done: none
Questions for reviewer:
  - The note fallback (M4) is caught only by the artifact diffs (battery-diagnosis-spike.md, t2.6d).
    No vitest case asserts the spike's "state ready", so pnpm check alone would not catch that regression.
    The spec lists no isolated test for this; noted, not added.
```
- 2026-09-27, reviewer: **APPROVE** (first review).
  - Reproduced: pnpm check, spike pytest (68), expo export; M1–M8 caught in a scratch copy; old-recording report artifacts unchanged.
  - Accepted minor: the note fallback is pinned only by the t2.6d and spike report artifacts, not by a vitest case.
- Closed and committed by path. The optional phone check is NOT RUN.
