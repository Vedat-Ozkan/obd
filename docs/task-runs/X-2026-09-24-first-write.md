# X-2026-09-24-first-write task run

## Ownership

- Last tool: Claude
- Last role: orchestrator (preflight)
- Current stage: CLOSED 2026-09-24
- Completed stages: preflight
- Other active tool or role: Codex T2.5 (untracked `packages/obd-battery/`, `pnpm-lock.yaml`, `apps/mobile/App.tsx`). This task must not touch those files.

## Contract

- Task: the follow-up from T0.7 spec Decision 7 and the PLAN T0.7 note. A fresh `Elm327Session` or app `ConsoleSession` writes its first command without knowing whether the ELM is idle. Close this gap. Also fix the six A2 re-review doc follow-ups in `docs/task-runs/T0.7.md`:
  - recorded Equinox DIDs as the residual examples, plus `23` and `2A` in the refused-leftover list;
  - one general sentence for any number of dropped characters;
  - "count digit of `0`" wording;
  - `init()` cover: `runInit` does not wait for the second `>` after `STOPPED`, and `ATE0` → `E0` after two drops;
  - the app console named in the gap sentence;
  - the long guard.ts comment line.
- Spec paths: `docs/specs/X-2026-09-24-first-write.md` (Stage A obd-core first, then Stage B app + `docs/ELM327.md`)
- Approved decisions: owner standing delegation; T0.7 Decision 7.
- Repair count: 1 of 2 (Stage A round 1). Escalation: 0.

## Architecture

- 2026-09-24, Claude architect: spec written. Unknown-state rule in `Elm327Session` and `ConsoleSession` (ATZ/ATI only until a clean reply; STOPPED restarts it; general drain after STOPPED; `init()` requires a clean ATZ). Replay exempt via optional `Transport.startsIdle` (set by `ReplayTransport`). No tracked recording or fixture changes output. 13 files, split A (8) → B (5). Five open questions (Q1–Q5) with recommendations. Hardware: optional, not required.
- 2026-09-24, orchestrator: Q1–Q5 decided as recommended (spec Decisions).

## Stage A implementation

- 2026-09-24, Claude implementer. Spec Stage A plus Decisions Q1 (reuse `blocked`), Q4 (`Transport.startsIdle`), Q5 (`init()` fails on an `ATZ` error).
- Changed: `packages/obd-core/src/transport/types.ts`, `src/transport/replay.ts`, `src/elm/session.ts`, `src/elm/guard.ts` (comment rewrap only), `scripts/profile-scan-replay.ts`, `test/session.test.ts`, `test/profile-scan.test.ts`, `docs/ARCHITECTURE.md`.
- Tests first: F1–F7 added to `session.test.ts` (with `ScriptedTransport(replies, startsIdle = true)` and `runEquinox` over a wrapper without `startsIdle`). On the pre-change source all 8 cases (F3 is two) failed; the other 28 passed.
- A1: baselines taken before any edit (replay stdout/stderr/exit of the 3 tracked redacted recordings and all 9 `fixtures/synthetic/*.jsonl`, both profile-scan tails, `pnpm -s codes-report` over the 7 inputs, the T2.5 `twelve-volt-report.ts` over spike, spike-2, `twelve-volt-vpwr.jsonl`; local raw spike, spike-2, phone-console, discovery-targeted by exit code and line/byte counts only). After the change, `diff -r` of before/after: empty. `codes-report` vs `packages/obd-core/test/codes-reports.md`: identical. Full `2026-09-23-discovery.jsonl`: NOT RUN (~1.5 h).
- A2: both tracked spike recordings pass "init and every following tx replay byte for byte" with `runEquinox` wrapping `ReplayTransport` without `startsIdle`. Also a throwaway script replayed the tracked redacted and local raw spike/spike-2 through `init()` + every later tx over a non-`startsIdle` wrapper: 32/32 tx written, 0 errors each.
- Mutations (each on `session.ts`, restored, `cmp` clean): check moved into `send()` → F2 fails; `unknown = false` on a stray `>` → F4 fails; drain removed → F6 (and F7) fail; `runInit` ignores the `ATZ` kind → F7 fails.
- `pnpm check` green (obd-core 194, obd-battery 5, mobile 67, relay 58, bridge 1). `git diff --check` clean. No new imports in `packages/obd-core/src`. `packages/obd-battery/`, `apps/mobile/App.tsx`, `pnpm-lock.yaml` untouched; the T2.5 test passes.
- Note for reviewer: `guard.ts` line 61 is also over 120 characters (124); the spec named only the `READ_LENGTHS` comment, so it was left.

## Stage B implementation

- 2026-09-24, Claude implementer. Spec Stage B plus Decisions Q1 (`blocked` stays obd-core's; console uses the spec's message), Q2 (`ATI` in the console allowlist), the recorded-DID doc deviation, and the bare-CR residual.
- Changed: `apps/mobile/src/console.ts`, `apps/mobile/src/capture.ts`, `apps/mobile/test/console-recording.test.ts`, `apps/mobile/test/capture.test.ts`, `docs/ELM327.md`. Not touched: obd-core, `apps/mobile/App.tsx`, `pnpm-lock.yaml`, `packages/obd-battery/`, `apps/mobile/test/codes-scan.test.ts`.
- Tests first: C1–C4 in `console-recording.test.ts` (named "first-write C1".."C4"), C5 in `capture.test.ts` (named "first-write C5", because `capture.test.ts` already has C1–C7), `FakeTransport.startsIdle = true`, allowlist assertion gains `ATI`, `"ATI"` leaves `rejected`. On the pre-change source 6 failed (C1–C5 and the allowlist assertion), 65 passed.
- B1: `codes-scan.test.ts` (unmodified) and capture C1–C7 (unmodified) pass under the new rule.
- Mutations on a temp copy under the session scratchpad, each restored with `cmp` clean: console `unknown = false` in the no-pending `onData` branch → only C3 fails; capture loop-top check removed → only C5 fails.
- `docs/ELM327.md`: §Responses `STOPPED` row, two Input-rules bullets after the stale bullet, and "What the length rule does not do" replaced with the spec text (recorded DIDs from `default.json` lines 2, 6, 10, 16 and spike/spike-2 L144, L152, L156, L162, checked). The relay bullet and the table are unchanged.
- `pnpm check` green (obd-core 194, obd-battery 5, mobile 71, relay 58, bridge 1). `git diff --check` clean. `expo export --platform android` succeeded; output deleted. Hardware (optional): NOT RUN, optional; no car session.

### Stage A round 1 (Claude reviewer, 2026-09-24): REQUEST_CHANGES

- 9/10 Stage A items. Replay (19 runs, including local raw recordings, counts only), codes-report, profile-scan tails and twelve-volt output are all byte-identical to HEAD. The spec mutations are all caught.
- 1. [blocking] F1 uses an explicit `startsIdle: false`. The mutant `startsIdle === false` survives, which would switch the rule off on every live path (BLE and relay never set the flag). → repair round 1.
- 2. [minor, recorded in the spec] a multi-error reply is classified by its first line only.
- 3. [minor, CLOSED by orchestrator] stale broker.ts citations.

### Stage A repair round 1 (Claude implementer, 2026-09-24)

- Test only. Changed: `packages/obd-core/test/session.test.ts`. Added one F1 case ("a transport with no startsIdle member (BLE, relay) starts in the unknown state"). It uses a plain `Transport` object that wraps a `ScriptedTransport` and has no `startsIdle` member, as the `runEquinox` wrapper does. It asserts that `0131` is refused with kind `blocked` and that zero writes reach the transport. No source change.
- Mutant `this.unknown = transport.startsIdle === false` applied to `session.ts`, backup kept in the session scratchpad. Only the new F1 case fails (1 failed, 36 passed in `session.test.ts`). Restored, and `cmp` against the backup is clean.
- Current code: `pnpm -F obd-core test` 195 passed. `pnpm check` green (obd-core 195, obd-battery 5, mobile 71, relay 58, bridge 1). `git diff --check` clean. Temps deleted.

### Stage A re-review (Claude reviewer, 2026-09-24): APPROVE

- The new F1 case (`session.test.ts:532-542`) has no `startsIdle` member; it expects `blocked` and zero writes, and it kills the `startsIdle === false` mutant (1 failed / 36 passed). No new source hunk. `pnpm check` PASS (obd-core 195). Stage A CLOSED.

### Stage B round 1 (Claude reviewer, 2026-09-24): APPROVE

- 13/13 Stage B items. The console rule matches `Elm327Session`; capture and the codes scan cannot bypass it; BleTransport does not set `startsIdle`; every recording starts unknown. Spec mutations plus five of the reviewer's own are all caught. Doc DIDs and leftovers were hand-checked. JS-only; `expo export` OK. `pnpm check` PASS.
- Three minor doc wording findings, applied by the orchestrator (doc only, `docs/ELM327.md` §Write safety):
  1. add `10` (from `0100` after one drop, unverified) and state the list is not exhaustive, including unlisted `2B`/`33`/`90`;
  2. "requests our tools send or the guard allows";
  3. name the console's no-drain residual (a late non-error reply while ATZ/ATI is pending).
- Task CLOSED 2026-09-24. Hardware check (optional) NOT RUN.

## Next action

- None. Follow-up note: a multi-error reply is classified by its first line (Stage A finding 2).
