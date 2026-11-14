# X-2026-11-14-parked-check-first: one main path, the rest in Developer tools

## Goal

A user sees one thing to do with a car: run the parked check and read its report. The charge log and the short drive stay in the app, reachable only from Developer tools, until each has passed on the car (ADR-024). The beta sharing prompt does not appear while no beta backend is configured.

## Non-goals

- No removal of charge-log, drive-check, relay or beta code, and no change to their behaviour once started.
- No change to reports, history, the red-flag screen or saved data. Existing drive reports and charge summaries still show in history and Trends.
- No new setting or build flag.

## Design

1. `CarScreen`: remove the "Log a charge" button. `SectionScreen` (capacity): remove its "Log a charge" button; the NOT MEASURED text stays.
2. `ReportSummary`: remove the "Add a short drive" button and its `canDrive`/`openDrive` props.
3. `EquinoxConsole` Developer tools: two tonal buttons, "Log a charge" and "Short drive", shown when the screen's intent is `check`. Each asks the app to reopen the console with that intent through a new prop (`openIntent(intent)`); `App.tsx` replaces the current route. The intent-specific screens are unchanged. How a drive report finds its pre-drive report is unchanged.
4. Beta: first find how `beta` becomes `undefined` in `App.tsx` today. If an empty `EXPO_PUBLIC_BETA_URL` does not already do it, make it so; then neither the consent sheet nor the Settings "Beta data sharing" row appears. Do not read or edit `apps/mobile/.env`.
5. `tools/sim/flows/start-t218.yaml` and `tools/sim/visual-flows.md`: the drive start state is reached through Developer tools.

## Files

- `apps/mobile/src/screens/CarScreen.tsx`, `SectionScreens.tsx`, `ReportScreens.tsx`, `ConsoleScreen.tsx`, `SettingsScreens.tsx`, `apps/mobile/App.tsx` — edit
- `apps/mobile/src/app/runtime.ts` — edit only if step 4 needs it
- `apps/mobile/test/` — edit the flow tests that enter the charge log or the drive, and the navigation and text tests that name the removed buttons
- `tools/sim/flows/start-t218.yaml`, `tools/sim/visual-flows.md` — edit

## Sources

No OBD constant is added or changed.

## Verification

Write or change each test before the code it covers.

- [ ] The existing guided drive flow test still saves both reports and shows the verdict, entering the drive from Developer tools.
- [ ] A charge-log flow test starts the log from Developer tools.
- [ ] With no beta URL configured, a fresh start shows the garage with no consent sheet, and Settings has no beta row; with a URL configured both appear as before.
- [ ] No test asserts button text or order for its own sake; where an existing text test pins a removed button, delete that assertion.
- [ ] Scoped checks green for `apps/mobile` (`fast-checks` skill); Android export bundle builds.
- [ ] Visual pass on the emulator with the simulated car (lead launches `visual-tester` after merge): Car screen, report, and Developer tools open, at font 1.0 and 2.0.
- [ ] Hardware-only: none new; the phone checks in OWNER-QUEUE cover it.

## Risks / open questions

- `ConsoleScreen.tsx` already tracks who owns the BLE link through several refs. This change must not add another; it only changes how an intent is chosen.
