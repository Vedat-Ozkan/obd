# X-2026-09-27: Charge-stop priority and recovery cleanup

## Goal

When pack-current observations stop after a charge window, the phone waits until the existing 10-minute silence threshold and saves the partial log with `stopReason: "no current for 10 min"`. It must not stop at the earlier 300-second transition threshold and falsely claim `"no post-charge rest within 300 s of the charge"` without current observations through that deadline. A continuously observed non-rest taper still stops under T2.4 Decision 25 at the 300-second deadline. The same change removes the unreachable `!same ||` term from recovery bridging without changing live or replayed charge phases, gate results, or the checked-in Stage A artifact.

## Non-goals

- Changing `TRANSITION_S`, `SILENT_STOP_S`, current classes, rest/charge windows, recovery limits, the replay gate, estimates, or error bands.
- Reopening T2.4 B1c, its repair count, or its approved verification evidence.
- Changing the wording of any existing stop reason.
- Adding a general stop-priority abstraction or changing foreground-service/UI wiring.
- Hardware, recordings, the driveway check, or the full T2.4 Stage C charge. This is a deterministic desk follow-up.
- Resolving other open T2.4 review findings.

## Interfaces

There is no public type or signature change. `runChargeLog()` retains its existing result:

```ts
export interface ChargeLogResult {
  file: string;
  complete: boolean;
  stopReason: string;
  saved: string;
}
```

The observable policy for its existing `stopReason` changes as follows. Let `tc` be the last charging-class current sample, as in T2.4 Decision 25, and let `td = tc + TRANSITION_S`.

| Observations after the charge | Stop |
|---|---|
| Current continues to arrive through `td`, but no rest run has started | At or just after `td`: `no post-charge rest within 300 s of the charge` |
| Current stops before `td`, with no post-rest run | Do not infer a missing rest at `td`; at `lastCurrent + SILENT_STOP_S`: `no current for 10 min` |
| A post-rest run starts and is observably interrupted | Existing Decision 25 behavior: `post-charge rest interrupted` once its time rule is satisfied |
| A passable post-rest completes | Existing behavior: `post-charge rest logged` |

The minimal evidence rule for the first two rows is: the missing-post-rest branch is eligible only if the logger has a current sample at or after `td`. It uses the existing sample timestamp and constants, and adds no timer or tolerance. A sample observed through the deadline supports the Decision 25 claim; a last sample before the deadline does not distinguish taper/rest from a silent module or link, so the existing silence rule supplies the reason later.

This refinement keeps Decision 25's accepted bound for an observed long taper. It does not simply reorder `stopFor()` checks: at `td` only 300 seconds have elapsed, so the 600-second silence condition cannot yet be true.

In `bridgedRecoveries()`, simplify:

```ts
isRecoveryGap(a, b, recoveries) && (!same || count < MAX_RECOVERIES_PER_RUN)
```

to the equivalent cap check after the existing `if (!same) count = 0`. Do not otherwise change the reset, count, or bridging rules. On a class change, `count` is already zero, so `!same` cannot affect the result.

## Files

- `apps/mobile/test/charge-logger.test.ts` — modify first; add fake-clock/FakeElm end-to-end cases for a silent current module and a lost link after charge, and retain the existing Decision 25 pass cases.
- `apps/mobile/src/chargeLogger.ts` — modify; require an observed current sample through the transition deadline before returning the missing-post-rest reason.
- `packages/obd-battery/src/session.ts` — modify; remove the dead `!same ||` alternative from `bridgedRecoveries()` only.
- `packages/obd-battery/test/charge-log.test.ts` — verification-only, no edit expected; its public replay/artifact check guards the session cleanup.
- `packages/obd-battery/test/charge-log-reports.md` — verification-only and byte-identical; do not edit.

No other product, fixture, plan, decision, task-run, package, or generated file is in scope. The orchestrator owns the task-run record.

## Sources

| Constant / behavior | Source |
|---|---|
| Charge-window selection, post-rest construction, `TRANSITION_S = 300`, and the two Decision 25 post-charge reasons | `docs/specs/T2.4-charge-logger.md` Decisions 24–25; `packages/obd-battery/src/session.ts` `chargePhases()` |
| `SILENT_STOP_S = 600` and `"no current for 10 min"` | `docs/specs/T2.4-charge-logger.md` §Policy values and §Verification Stage B1 failure mode 6; `apps/mobile/src/chargeLogger.ts` |
| Sample time used for silence and transition decisions | `docs/specs/T2.4-charge-logger.md` Decisions 15 and 25 |
| Recovery cap, class-change reset, and only gaps over 10 seconds counting | `docs/specs/T2.4-charge-logger.md` Decisions 22–23; `packages/obd-battery/src/session.ts` `bridgedRecoveries()` |
| The two carried review findings | `docs/task-runs/T2.4.md` §Current state, Open findings; baseline `docs/task-runs/X-2026-09-27-charge-stop-priority.md` |
| Current fake-clock/FakeElm E2E and its per-case JSONL artifacts | `apps/mobile/test/charge-logger.test.ts` header and `run()` |

No OBD command, DID, header, scaling formula, recording, or dependency is introduced. Existing fake replies remain sourced by the T2.4 spec and are not changed by this task.

## Verification

Tests must be written and run before product code. These are E2E tests at the scoped public entry point: each drives `runChargeLog()` through the existing fake ELM and fake clock, saves the resulting JSONL, replays it through `chargeLogFromRecording()`/`chargePhases()`, and asserts the user-visible `ChargeLogResult.stopReason`.

### Test-first failure evidence

- [ ] Add `silent-after-charge-module`: run the established pre-rest and charge sequence, then make `22 2414` return `NO DATA` from the first post-charge current request onward while cycles continue. Before implementation it must fail because the result is `no post-charge rest within 300 s of the charge`. Preserve the failing assertion/result in the implementer report, then implement the policy.
- [ ] Add `silent-after-charge-link`: lose the transport on the first post-charge `22 2414` and make subsequent reconnects fail. Before implementation it must fail for the same false 300-second reason.

These two cases cover distinct observable paths: an answering ELM with a silent current module, and no reachable link. They do not mock `stopFor()` or call a private helper.

### Required E2E assertions and artifacts

- [ ] Both new cases finish partial with the exact reason `no current for 10 min`; neither result contains `no post-charge rest`.
- [ ] For each new case, replay shows a charge window and no post-rest run. The run ends no earlier than `lastCurrent + SILENT_STOP_S` and within one normal polling/recovery step after it. Use the existing timing constants in the bound rather than a new literal tolerance.
- [ ] `/tmp/t2.4-b1-silent-after-charge-module.jsonl` and `/tmp/t2.4-b1-silent-after-charge-link.jsonl` are produced by the existing harness. Each parses, contains the final saved stop note with the matching reason, and gives the same current log/phases as the live stop decision via `expectSameLog()`.
- [ ] Existing Decision 25 probe P2 still ends partial near `tc + TRANSITION_S` with `no post-charge rest within 300 s of the charge`. This proves continuously observed `-3 A` taper remains bounded at 300 seconds.
- [ ] Existing happy path, Decision 24 pause/dip cases, Decision 25 P1/P3, and recovery cap/reset cases remain green. Complete results still replay to Gate PASS; the new partial cases do not claim Gate PASS.
- [ ] Existing class-change recovery case remains green after removing `!same ||`, proving the reset-to-zero path still bridges that gap. Existing fourth-gap and per-run reset cases retain their results.

Run:

```sh
pnpm -F mobile test -- charge-logger.test.ts
pnpm -F obd-battery test
sha256sum packages/obd-battery/test/charge-log-reports.md
pnpm check
```

Expected evidence:

- the focused mobile test writes the two named `/tmp` JSONL artifacts and all charge-logger cases pass;
- `obd-battery` regenerates the expected summary in memory and matches `packages/obd-battery/test/charge-log-reports.md` byte for byte;
- the report artifact SHA-256 remains `1575f0d60ec60de3231a69115e6e31fd6ec698bcd9f5d577619813f4829563fc`;
- `pnpm check` is green.

There is no isolated unit test. The behavior crosses polling, time, recovery, recording, replay, phase selection, and the returned phone result; the existing E2E harness observes all of them. The dead-expression cleanup adds no behavior to test separately and is covered by the existing class-change, cap, replay, and artifact cases.

Hardware: **NOT RUN / not required for this follow-up.** The separate T2.4 driveway and Stage C checks remain pending under `docs/task-runs/T2.4.md`; this spec makes no hardware claim.

## Risks / open questions

- A current sample at or after `td` makes the Decision 25 missing-rest reason eligible immediately, even if the module goes silent just after that sample. That is intentional: the logger directly observed non-rest current through the accepted transition deadline. Moving the evidence boundary later would weaken Decision 25's 300-second drain bound.
- If current stops before `td` and later resumes, the logger continues waiting. On the first sample at or after `td`, the existing phase state decides whether the missing/interrupted rest reason applies; a resumed charging run can still move the provisional charge window as Decisions 24–25 require.
- The checked-in replay report does not contain mobile stop reasons. Its byte identity guards the `session.ts` cleanup, while the two `/tmp` mobile artifacts guard the priority change.
- No material owner decision is open. The requested outcome and existing Decision 25 can coexist under the sample-through-deadline evidence rule.

## Decisions

1. Refine only the missing-post-rest arm of Decision 25: it requires a current sample at or after `tc + TRANSITION_S`. An observably interrupted post-rest keeps its existing rule.
2. When that evidence is absent, do not invent a rest outcome. Continue until current resumes, another higher-priority existing stop applies, or `lastCurrent + SILENT_STOP_S` yields `no current for 10 min`.
3. Keep all constants and stop-reason strings unchanged.
4. Remove only the dead `!same ||` term; preserve the established recovery behavior and artifact.
5. Add no dependencies and require no hardware or recording.
