# X-2026-11-14-parked-check-first

Spec: `docs/specs/X-2026-11-14-parked-check-first.md`.

## Current state (2026-11-14)

- implement implementer: done — commit 45133e6
- review reviewer: APPROVE (repairs 0/2)
- integrate integrator: merged — commit 4e6625e; `pnpm check` green on main at 7a05c55
- Decision in effect: an empty `EXPO_PUBLIC_BETA_URL` did not hide the beta prompt, so `createBetaOutbox` gained `configured` and `BetaStatus` gained `available` (outside the spec's Files list; accepted by the reviewer as the minimum).
- Decision in effect: "Short drive" in Developer tools shows without a same-day parked report; the old `canDrive` gate went with the report button.
- Not covered by tests: the Developer tools entry points and the beta gating in `App.tsx` and Settings have no rendering-level test; `apps/mobile/test` has no UI harness. The emulator visual pass covers them.
- NOT RUN: the emulator visual pass. The emulator setup was restored on 2026-11-14 (SDK, `obd_phone` AVD, debug APK; smoke boot passed), but two attempts at the pass ended with the emulator dying about two minutes after boot: the host had 100-150 MB free and swap full, from unrelated jobs on the machine. One observation only: after a fresh start the beta consent sheet appeared (`tools/sim/runs/20261114-visual/f0-1.0-light-p-01-launch.png`), so a beta URL is configured in the local build and that branch behaves as before. The Developer tools entry points and the no-URL branch are still unverified on any screen.
- Next action: lead, rerun the narrowed pass (items 1-8 in the 2026-11-14 brief) when the host has several GB free; otherwise the phone build covers it (OWNER-QUEUE B1).
