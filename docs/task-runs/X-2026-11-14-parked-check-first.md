# X-2026-11-14-parked-check-first

Spec: `docs/specs/X-2026-11-14-parked-check-first.md`.

## Current state (2026-11-14)

- implement implementer: done — commit 45133e6
- review reviewer: APPROVE (repairs 0/2)
- integrate integrator: merged — commit 4e6625e; `pnpm check` green on main at 7a05c55
- Decision in effect: an empty `EXPO_PUBLIC_BETA_URL` did not hide the beta prompt, so `createBetaOutbox` gained `configured` and `BetaStatus` gained `available` (outside the spec's Files list; accepted by the reviewer as the minimum).
- Decision in effect: "Short drive" in Developer tools shows without a same-day parked report; the old `canDrive` gate went with the report button.
- Not covered by tests: the Developer tools entry points and the beta gating in `App.tsx` and Settings have no rendering-level test; `apps/mobile/test` has no UI harness. The emulator visual pass covers them.
- NOT RUN: the emulator visual pass (2026-11-14). The Android SDK (`~/Android/Sdk`), the `obd_phone` AVD (`~/.android`) and the prebuilt `apps/mobile/android/` are no longer on this machine, so no screen was opened. The Developer tools entry points and the beta gating are therefore unverified on any screen.
- Next action: owner decides whether to restore the emulator setup (`tools/sim/README.md`, One-time setup) or to check these screens on the phone in the next build (OWNER-QUEUE B1).
