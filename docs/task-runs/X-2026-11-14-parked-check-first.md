# X-2026-11-14-parked-check-first

Spec: `docs/specs/X-2026-11-14-parked-check-first.md`.

## Current state (2026-11-14)

- implement implementer: done — commit 45133e6
- review reviewer: APPROVE (repairs 0/2)
- integrate integrator: merged — commit 4e6625e; `pnpm check` green on main at 7a05c55
- Decision in effect: an empty `EXPO_PUBLIC_BETA_URL` did not hide the beta prompt, so `createBetaOutbox` gained `configured` and `BetaStatus` gained `available` (outside the spec's Files list; accepted by the reviewer as the minimum).
- Decision in effect: "Short drive" in Developer tools shows without a same-day parked report; the old `canDrive` gate went with the report button.
- Not covered by tests: the Developer tools entry points and the beta gating in `App.tsx` and Settings have no rendering-level test; `apps/mobile/test` has no UI harness. The emulator visual pass covers them.
- Visual pass (simulated car, emulator, 2026-11-14; closes no owner item): PASS for all eight items at font 1.0 and 2.0, light, portrait (`tools/sim/runs/20261114-visual/`). The removed buttons leave no gap on the Car screen, the report or the Capacity section; Developer tools shows "Log a charge" and "Short drive", unclipped at 2.0; each opens its screen; `start-t218.yaml` passes as written. A beta URL is configured in the local build, so the consent sheet and the Settings row appeared.
- NOT RUN: the no-beta-URL branch on a screen (covered only by the status-level test); dark theme and landscape.
- Candidates from the pass, all low, none fixed (hardware gate, ADR-024):
  - Car screen Trends caption says "Appears after a battery check or a charge log", and the Capacity section says capacity needs a completed charge log; neither screen offers the charge log any more.
  - The short-drive and charge-log screens still show "Run battery check" above their start buttons.
  - At font 2.0 the "Start short drive (20 min)" label wraps with "min)" alone on the second line.
  - Older than this task: after scrolling, page text is drawn under the status bar (for example the clock over "Simulated car").
- Next action: owner, the phone build (OWNER-QUEUE B1).
