# X-2026-09-28-app-redesign task run

## Current state (as of 2026-09-28)

- **Stage:** architecture done (spec written). Open questions 1–10 in the spec wait for owner decisions. No implementation yet.
- **Repair count:** 0 of 2. **Escalations:** 0.
- **Verification:** none run for this task. Baseline checked by the architect at `78cd7d6`:
  - PASS: `pnpm -F mobile test` passed 304/304 across 14 files. This includes Codex's uncommitted T2.10 edits in the working tree.
- **NOT RUN:** everything in the spec's Verification section. Implementation has not started.
- **Blocker:** Stage A cannot start until Codex commits or releases `apps/mobile/App.tsx`, `apps/mobile/package.json`, the root `package.json`, `eslint.config.js`, `.gitignore` and `pnpm-lock.yaml` (spec §Sequencing and ownership; open question 7).
- **Next action:** see the Next action section below.

## Ownership

- Last tool: Claude
- Last role: architect
- Current stage: architecture
- Completed stages: preflight
- Other active tool or role: Codex T2.10 (C1/D1) is uncommitted in the six files above, plus `packages/obd-assist/`, `tools/summary-backend/`, `fixtures/synthetic/t2.10-*`, `apps/mobile/src/summary{Access,Flow}.ts`, `apps/mobile/test/summary-flow.test.ts`, `tsconfig.json`, `docs/specs/T2.10*` and `docs/task-runs/T2.10.md`. All of these are off-limits until Codex releases them.
- Baseline (`git status --short` at start, HEAD `78cd7d6`):
  ```
   M .gitignore
   M apps/mobile/App.tsx
   M apps/mobile/package.json
   M docs/specs/T2.10c-hosted-deepseek-eval.md
   M docs/specs/T2.10d-mobile-rewarded-summary.md
   M docs/task-runs/T2.10.md
   M eslint.config.js
   M fixtures/synthetic/t2.10-summary-responses.json
   M package.json
   M packages/obd-assist/scripts/replay-summary.ts
   M packages/obd-assist/src/check.ts
   M packages/obd-assist/test/summary-replay.test.ts
   M pnpm-lock.yaml
   M tsconfig.json
  ?? apps/mobile/src/summaryAccess.ts
  ?? apps/mobile/src/summaryFlow.ts
  ?? apps/mobile/test/summary-flow.test.ts
  ?? docs/specs/T2.10a-exact-quantity-amendment.md
  ?? docs/specs/T2.10c2-production-summary-eval.md
  ?? tools/summary-backend/
  ```

## Contract

- **Task:** free-text owner request to redesign the mobile UI to the approved mockups. The mockups are the claude.ai canvas https://claude.ai/artifact/SD23eYAzDCTT8aMM9sn352, restated in spec §Design.
- **Spec path:** `docs/specs/X-2026-09-28-app-redesign.md`
- **Stages:** A (split, no visible change) → B (tokens, Paper, safe areas, fonts; needs a new EAS dev build) → C1 → C2 → C3 → C4 (screens) → D (owner screenshot matrix and phone flows). File lists are in spec §Files.
- **Approved decisions:** the owner design decisions of 2026-09-27/28 (spec §Design). Spec open questions 1–10 are not yet decided.

## Log

- 2026-09-28, Claude architect: wrote the spec. Six implementer stages, each touching at most ten files. Stage A keeps the fingerprint unchanged; Stage B adds seven dependencies (one conditional) and needs a new EAS dev build. E2E coverage is report view-models over the five Equinox redacted recordings plus four synthetic codes fixtures, and the charge-log step mapping over the existing charge-logger harness. No new OBD constants.

## Next action

- Orchestrator: take spec open questions 1–10 to the owner and record the answers in the spec's §Decisions. Get Codex to release `App.tsx` (open question 7). Then spawn the Stage A implementer.
- 2026-09-28, orchestrator: all 10 open questions are settled (spec §Decisions). Owner:
  - 1: codes rating as recommended.
  - 6: ADR-021 accepted and appended to DECISIONS.md.
  - 7: Codex commits T2.10d D1 now.

  Standing delegation: 2 (one decimal), 3, 4, 5, 8, 10 as recommended, and 9 (dark highlight `#C97A3C`, validator PASS).

  Blocker: Stage A waits for Codex to commit `apps/mobile/App.tsx`, `apps/mobile/package.json`, root `package.json`, `eslint.config.js` and `.gitignore`. The owner relays item 7 to Codex.
- 2026-09-28, orchestrator: Codex released App.tsx: T2.10d D1 is committed at `fa8c3e3`, prerequisites at `7a465ce` and `1b2ab49`, record at `ffd336f`. The tree is clean and App.tsx is 704 lines. Stage A implementer spawned; repair count 0 of 2.

## Stage A implementer (Claude, 2026-09-28)

Base: HEAD `ffd336f` (tree clean apart from this record). The committed App.tsx (704 lines, with T2.10d D1's `DevelopmentSummary`) matches the spec's Stage A file list; no conflict. No test was added: the spec assigns no view-model extraction test to Stage A.

Changed: `apps/mobile/App.tsx` (704 → 129 lines). Created: `apps/mobile/src/app/runtime.ts`, `apps/mobile/src/ui/theme.ts`, `apps/mobile/src/ui/kit.tsx`, `apps/mobile/src/screens/{GarageScreen,AddVehicleScreen,ConsoleScreen,ReportScreens,ConsentScreen,DevelopmentSummary}.tsx`. Ten files; no others (`git status --short`).

### Moved-code map (old `App.tsx` at `ffd336f` → new file:lines)

Moved declarations keep their original line text; exports are added as one `export { … }` list at the end of each file, so the declaration lines stay byte-identical. Fragment bodies of the old main ScrollView are dedented by 2 spaces, so review with `git diff --color-moved=zebra --color-moved-ws=allow-indentation-change` (or compare against `git show ffd336f:apps/mobile/App.tsx`).

| Old lines | Block | New location |
|---|---|---|
| 1–33 | imports | split per file (import lines only) |
| 35–51 | `localDate`, `localFilename`, `requestBlePermission` | `src/app/runtime.ts:24–40` |
| 53–57 | `palettes` | `src/ui/theme.ts:3–7` (+ `usePalette()` 9–11) |
| 59–360 | `EquinoxConsole` | `src/screens/ConsoleScreen.tsx:22–323` |
| 362–431 | `garageFlow`, `batteryHistory`, `equinoxSignals`, `DIALOG_TITLES`, `captureFolderFile`, constants, `phoneTargets`, `deferredShare`/`shareDeferred`/`AppState` listener | `src/app/runtime.ts:42–111` |
| — | new `deferShare` setter (deviation 1) | `src/app/runtime.ts:112–113` |
| 433–451 | `chargeRun`, `betaOutbox`, `queueForBeta` | `src/app/runtime.ts:115–133` |
| — | new `foregroundService` (spec §Interfaces) | `src/app/runtime.ts:135–140` |
| 453–503 | `DevelopmentSummary` | `src/screens/DevelopmentSummary.tsx:10–60` |
| 505–562 | `App` state, beta effects, `decideBeta`, `deleteBeta`, `refreshReports`, `load`, `change` | `App.tsx:16–73` (506 → 17 `usePalette()`) |
| 563–564 | `title`, `normal` | `App.tsx:74–75`; copies of 563–566 as needed in each screen |
| 567–569 | `models`, `choices`, `selected` (picker only) | `src/screens/AddVehicleScreen.tsx:18–20` |
| 570–590 | `clearPicker`, `reopenInterest`, `openHistory`, `openSaved`, `consentVisible`, consent-reset effect | `App.tsx:76–96` |
| 592–599 | consent screen | `src/screens/ConsentScreen.tsx:12–19` (body 593–598 → 13–18); call `App.tsx:98` |
| 601–609 | beta/garage loading gates | `App.tsx:100–108` (View container → `Screen`) |
| 611–615 | console route (wrapper View unchanged) | `App.tsx:110–114` |
| 617–624 | detail view | `src/screens/ReportScreens.tsx:25–32` `ReportDetail` (body 618–623 → 26–31); call `App.tsx:116` |
| 626–629, 700 | main ScrollView shell, title, error, back | `App.tsx:118–121, 126` (ScrollView → `Screen scroll`) |
| 630–664 | garage fragment | `src/screens/GarageScreen.tsx:19–53` (body 631–663 → 20–52); call `App.tsx:122` |
| 665–672 | history fragment | `src/screens/ReportScreens.tsx:13–20` `ReportHistory` (body 666–671 → 14–19); call `App.tsx:123` |
| 673–690 | picker fragment | `src/screens/AddVehicleScreen.tsx:21–38` (body 674–689 → 22–37); call `App.tsx:124` |
| 691–699 | interest fragment | `src/screens/AddVehicleScreen.tsx:48–56` `InterestScreen` (body 692–698 → 49–55); call `App.tsx:125` |
| 703 | `styles` | `src/ui/kit.tsx:20` |
| 704 | `export default App` | `App.tsx:129` |

Every changed (not moved) line, found by diffing the trimmed line sets: `palettes[useColorScheme()…]` → `usePalette()` (3); the three `BackgroundService` calls → `foregroundService.start/update/stop`; `deferredShare = result.file; shareDeferred();` → `deferShare(result.file);`; the `View styles.container`/`ScrollView styles.garage` page roots → `Screen`/`Screen scroll`, and the `View styles.card` wrappers → `Card` (identical style arrays inside the kit); fragment/route call sites and prop types. Everything else is byte-identical after trimming indentation.

State stays where it was: all `App` state hooks, effects and handlers remain in `App` and are passed down as props with their original names, so screen-local state lifetimes (picker, interest form, privacy toggle) are unchanged. The one-per-runtime objects (`betaOutbox`, `chargeRun`, `phoneTargets`, `deferredShare` and its `AppState` listener) keep their module-level declaration order in `runtime.ts`. The console's refs, race guards and charge-log lifetime (`chargeRun.mount`/unmount) are untouched. The consent-reset effect stays in `App` before the early returns, so hook order is unchanged. The main ScrollView keeps its child positions (title, error, back, garage, history, picker, interest).

### Verification (Stage A)

- Logic freeze: `git diff --stat HEAD -- apps/mobile/src/{beta,ble,garage}/ apps/mobile/src/{batteryDiagnosisFlow,batteryReports,batteryReportsDocumentStore,batteryScan,capture,chargeLogger,chargeRun,codesScan,console,recording,runFiles,summaryAccess,summaryFlow}.ts packages/obd-battery packages/obd-core/src` is empty: PASS.
- Existing tests unchanged (`git diff --stat HEAD -- apps/mobile/test` empty) and green: `pnpm check` exit 0 (core 239, battery 21, assist 142, mobile 304, relay 58, backend/intake/summary 42, Ruff, pytest 1): PASS.
- `pnpm -F mobile typecheck`: PASS. `eslint apps/mobile`: PASS.
- `expo export --platform android` into a scratch temp dir (deleted afterwards): PASS (`AppEntry-3980b5e1….hbc`, 2.6 MB).
- Expo fingerprint `pnpm -F mobile exec fingerprint fingerprint:generate`: `5d1377e547ea25caaaab8106951bf2b94c9b386e` before and after: PASS. No dev-client rebuild needed.
- Artifacts deleted, regenerated by `pnpm check`, `cmp`-identical to the pre-change copies: `/tmp/t2.9-{b,c1}-codes.jsonl` `01d894f4…e9b4`, `/tmp/t2.9-{b,c1}-charge-log.jsonl` `fbb90c17…043e`, `/tmp/t2.9-c2-intake.txt` `bfacfd43…cf7d`, `/tmp/t2.10d-mobile-flow.json` `4eb12fbc…bc23`: PASS. (The spec's §Verification still quotes the older `eb769cd0…`/`e1bb7fee…`; T2.9.md records their scrubVersion-2 successors used here.)
- Moved-code diff: self-checked with the trimmed line-set diff above; reviewer `--color-moved` check pending.
- Phone steps: NOT RUN (no phone or car in this WSL2 session). The owner runs, on the existing dev client through Metro (`cd apps/mobile && pnpm start`), recording PASS/FAIL/NOT RUN per step here:
  1. Before/after screenshot pairs in identical state (checkout `ffd336f` for before, this tree for after) for: Garage, Add a vehicle (with a year selected), the battery diagnosis/debug console, Report history, and a report detail. Compare visually.
  2. T2.9 Stage D (`docs/specs/T2.9-beta-data-upload.md` §Stage D) owner session setup (local `wrangler dev`, `EXPO_PUBLIC_BETA_URL` in `apps/mobile/.env`, car Ready/Park), then steps 1 (fresh data: consent once with switch off, Continue off, Run codes report → no beta sentence, no object), 2 (Garage switch on → consent text, Continue on; Run codes report → "Queued for beta upload." and a manifest), 3 (airplane mode, Run capture queued; airplane off, background/foreground → uploads with no tap), 4 (Run battery diagnosis → a `battery-scan` file arrives), 6 (Delete my data, confirm → no `files/<installId>/`; intake again deletes local copies). Step 5 is not part of Stage A.
  3. One battery diagnosis that opens its saved detail view.
  4. One charge-log start (Run charge log), then Disconnect: the status shows "Stopping the charge log after the current command…", then a "Charge log stopped: …" line, and the foreground notification goes away.

Deviations: (1) `deferredShare` is assigned from the console, and an imported ES binding is read-only, so `runtime.ts` adds a two-line `deferShare(name)` setter and the console's line 308 calls it; same order of effects. (2) The kit's `Button` and `Text` are re-exports of RN's, not a wrapper that applies `buttonBackground`: today only the console's buttons pass `color`, while garage/picker/history/consent/summary buttons use the platform default, so a palette-colour wrapper would be a visible change. (3) `Screen` takes `scroll` to cover today's two page roots; `styles` is exported from `kit.tsx` because every screen uses it.
- 2026-09-28, orchestrator, on the Stage A report:
  - Deviations 1–5 accepted. Button and Text stay re-exports of React Native's own, because a palette-colour wrapper would be a visible change, which Stage A forbids.
  - Spec §Verification hashes corrected to `01d894f4…`, `fbb90c17…` and `bfacfd43…` (the old ones predate scrubVersion 2).
  - Next: Stage A reviewer.
- 2026-09-28, Stage A reviewer: **APPROVE**.
  - Reproduced: pnpm check PASS (mobile 304); expo export PASS (same bundle hash); all six artifacts cmp-identical; logic freeze empty, extended to test/, package.json, app.json and the lockfile; fingerprint `5d1377e5…` unchanged.
  - Moved-code range diff: every non-moved line is accounted for. Singletons are created once, in the old order. Hook order is unchanged (useColorScheme, 19 useState, 3 useEffect). The consent-reset effect is still before the early returns. Console lifetime is unchanged.
  - Findings:
    - (1) Consent ↔ garage no longer share one native ScrollView, so the scroll offset resets to the top after Continue. **Accepted by the orchestrator** as the only visible change: harmless, and C1 replaces this navigation anyway.
    - (2) The orchestrator's "deviations 1–5" named two the record did not list. They are, from the implementer's hand-back: **4** — all App state, effects and handlers stay in App and pass down under their original names (identical state lifetimes); **5** — declarations keep byte-identical text, exports go in a trailing `export { … }` list, fragment bodies are dedented 2 spaces.
    - (3) Stale comment at `src/runFiles.ts:10` ("App.tsx implements it"). Fix it in C1 once the logic freeze lifts.
- Stage A closed and committed by path.
- Phone checks NOT RUN (owner), per the reviewer's list:
  - (a) before/after screenshots;
  - (b) T2.9 Stage D steps 1–4 and 6;
  - (c) a diagnosis opening its saved detail, with DevelopmentSummary in __DEV__;
  - (d) a charge-log start, then Disconnect (notification lifecycle);
  - (e) the deferred share after a failed folder copy, if practical;
  - (f) the scroll reset.
- 2026-09-28, orchestrator: Stage B implementer spawned; repair count 0 of 2.
  - Stage A's phone checks can run on the existing dev client (JS only) before the Stage B build. If they are not run first, the checks after Stage B cover both stages, and a regression cannot then be attributed to one stage.
- 2026-09-28, owner: "do as many stages as possible, all the stages, for things that need my attention defer them, I'll handle them later". The orchestrator runs B, C1–C4 and the desk part of D back to back. Owner-only items collect in **Deferred to owner** below.

## Deferred to owner
- Follow-up spec (not owner hardware; an owner go-ahead to unfreeze obd-battery): `buildBatteryDiagnosis` should record the chosen 2AF5 reply (min/avg/max) in `cellSpread`. The report drops undecoded rows, so the app cannot recover which reply was used (C3 repair round 1, fix 3). Until then the Cells range strip shows only when the triple is unambiguous and matches the spread. The same follow-up should test the same-ECU conditions (C3 re-review finding 2).

- Stage A phone checks (a)–(f) (see the Stage A reviewer entry).
- Optional, before the EAS build: `cd apps/mobile && pnpm exec expo install expo expo-modules-core expo-sharing` (patch bumps flagged by `expo install --check`), so one build covers them. The orchestrator can do this on request.
- EAS dev-client build for Stage B's native change (fingerprint `d66ba328…`): `cd apps/mobile && pnpm dlx eas-cli@24.7.0 build --profile development --platform android`, then install it.
- Stage B phone checks 2–6 in the Stage B report (light and dark screenshots, safe areas with gesture and 3-button nav, fonts, portrait lock). They can run once, after all C stages, together with the Stage D matrix.
- Stage C1 phone steps 1–9 in the Stage C1 implementer report (Garage → Car navigation and system back, SoC hero in JetBrains Mono, ownership dialog, remove refusal, Add a vehicle, Settings › Beta with consent on switch-on, Privacy note, T2.9 Stage D steps 1–4 and 6 with the switch under Settings). No new build: C1's fingerprint equals B's.
- Stage C2 phone steps 1–8 in the Stage C2 implementer report (report summary rows and chips, the four section details with charts 4 and 2, Codes with the recently-cleared card and module detail, the AI summary route in `__DEV__`, route resolution across history back-and-forth, light/dark and font scale 2.0). No new build: C2's fingerprint equals B's.
- Stage C3 phone steps 1–8 in the Stage C3 implementer report (History, the check screen fitting or scrolling at 360 dp, system back locked only during a run, a real charge log from start to Saved, Disconnect during a charge log, light/dark and font scale 2.0). No new build: C3's fingerprint equals B's.

## Stage B implementer (Claude, 2026-09-28)

Base: HEAD `1f41022`. The tree was clean apart from this record. The spec assigns no tests to Stage B (§Verification: Stage B lists only checks), so no test was written.

Changed (7 files, all on the spec's Stage B list): `apps/mobile/package.json`, `pnpm-lock.yaml`, `apps/mobile/app.json`, `apps/mobile/App.tsx`, `apps/mobile/src/ui/theme.ts`, `apps/mobile/src/ui/kit.tsx`, and this record.

- **Dependencies.** Installed with `pnpm exec expo install` in `apps/mobile`, which ran pnpm 9.15.9. Each package was checked first against `node_modules/expo/bundledNativeModules.json` (Expo 57.0.24):

  | Package | Installed | License (from its installed `package.json`) | SDK 57 pin |
  |---|---|---|---|
  | react-native-paper | 5.15.3 | MIT | not listed (pure JS) |
  | react-native-safe-area-context | 5.7.0 (`~5.7.0`) | MIT | `~5.7.0` |
  | @expo/vector-icons | 15.1.1 (`^15.0.2`) | MIT | `^15.0.2` |
  | expo-font | 57.0.4 (`~57.0.4`) | MIT | `~57.0.4` |
  | @expo-google-fonts/manrope | 0.4.2 | MIT AND OFL-1.1 | not listed |
  | @expo-google-fonts/jetbrains-mono | 0.4.1 | MIT AND OFL-1.1 | not listed |
  | expo-system-ui | 57.0.4 (`~57.0.4`) | MIT | `~57.0.4` |

  - **expo-system-ui** is included because the Expo color-themes guide, read on 2026-09-28 (https://docs.expo.dev/develop/user-interface/color-themes/), says: "When you are creating a development build, you have to install expo-system-ui to support the appearance styles for Android" and "android: userInterfaceStyle: Install expo-system-ui in your project to enable this feature."
  - pnpm re-sorted the dependency keys alphabetically, which moves `obd-core` down one line. The lockfile gains 159 lines and loses 3; the 3 are the `obd-battery` entry moving because of that re-sort.
  - `expo install` also added an `"expo-font"` config plugin to `app.json`. I removed it. The spec lists only the two `app.json` keys, and runtime `useFonts` does not need the plugin.
- **app.json:** adds `"orientation": "portrait"` and `"userInterfaceStyle": "automatic"`.
- **theme.ts:**
  - `TOKENS` for light and dark, with every value from spec §Design (the cited section is in a comment). The dark chart highlight is `#C97A3C` (§Decisions 9).
  - `paperTheme(scheme)` extends MD3 Light or Dark: primary is accent, background is bg, surface is surface, onSurface is text, and so on. Headline, display and title variants use Manrope 700; the rest use Manrope 500.
  - `useTokens()` reads the system scheme; C4 adds the override. `useScheme()` is new.
  - `FONTS` holds the family names.
  - `usePalette()` now maps the old keys onto tokens: background→bg, text→text, muted→muted, border→outline, input→surface/text, placeholder→muted, console→surface/text, buttonBackground→accent.
- **kit.tsx:**
  - `Text` wraps Paper `Text`. By default it uses body type, 15 on a 1.5 line height, in the token text colour. A `bold`/`700` style maps to the Manrope 700 family, so there is no synthetic bold. An explicit `fontFamily` (the console's `monospace`) is kept.
  - `Button` keeps React Native's `title`/`onPress`/`disabled`/`color` props. It is built from Paper `TouchableRipple` and the kit `Text`: at least 52 high, radius 16, accent fill, onAccent label in Manrope 600 at 16, and Paper's disabled colours.
  - `Card` is a Paper `Card` in `contained` mode, radius 24, on surface.
  - `Screen` pads by the safe-area insets plus 16 dp and draws on bg.
- **App.tsx:**
  - New `Root`, which is now the default export. It gates on `useFonts` for Manrope 500/600/700/800 and JetBrains Mono 600; if a font fails to load, the app falls back to the system font.
  - It wraps the app in `SafeAreaProvider` › `PaperProvider theme={paperTheme(scheme)}`.
  - The RN `StatusBar` is `dark-content` in light and `light-content` in dark.
  - `App` itself is unchanged.
- **Glyphs:** Paper finds its icons through `@expo/vector-icons/MaterialCommunityIcons`, its second fallback in `src/components/MaterialCommunityIcon.tsx:40-46`. The export bundles `MaterialCommunityIcons.ttf`. All five chip glyph names exist in the installed glyph map (C2 uses this): `star-circle`, `check-circle`, `alert-circle-outline`, `close-circle` and `minus-circle-outline`.

### Verification (Stage B)

- Tests assigned to Stage B: none in the spec. None were written.
- Logic freeze: PASS. The spec's path list diffed against HEAD is empty. I extended the diff to `apps/mobile/test`, `apps/mobile/src/screens` and `apps/mobile/src/app`, and it is still empty.
- Only listed files changed (`git status --short`): PASS. The changes are the six Stage B files plus this record.
- `pnpm check`: PASS, exit 0. Counts: core 239, battery 21, assist 142, mobile 304, relay 58, backend/intake/summary 42, Ruff, pytest 1.
- `pnpm -F mobile typecheck`: PASS. `eslint apps/mobile`: PASS.
- `pnpm exec expo export --platform android` into a scratch temp dir, deleted afterwards: PASS.
  - Bundle: `AppEntry-b5a821ab….hbc`, 3.2 MB, 992 modules.
  - Assets: the 4 Manrope and 1 JetBrains Mono `.ttf` files, and `MaterialCommunityIcons.ttf`.
- `pnpm -F mobile exec expo install --check`: PASS for every new package; none is flagged. The command still exits 1, because it flags three existing dependencies that Stage B did not touch as one patch behind: expo 57.0.24 (expects ~57.0.25), expo-modules-core 57.0.18 (~57.0.19) and expo-sharing 57.0.21 (~57.0.22). Upgrading them is out of scope.
- Expo fingerprint: `5d1377e547ea25caaaab8106951bf2b94c9b386e` before, `d66ba328b7116976e29d34d6aac3378c2be9ecaf` after. The change is expected: safe-area-context and expo-system-ui are native, and app.json changed. **A new EAS dev-client build is required.** From C1 to C4, each stage's fingerprint must equal `d66ba328…`.
- Artifacts, deleted and then regenerated by `pnpm check`:
  - Codes E2E `01d894f4…e9b4` (b and c1), charge-log E2E `fbb90c17…043e` (b and c1) and the C2 intake log `bfacfd43…cf7d`: all `cmp`-identical, PASS.
  - `/tmp/t2.10d-mobile-flow.json`: PASS, `4eb12fbc…bc23`, but only on rerun (3 isolated reruns and 1 full `pnpm -F mobile test`). The first `pnpm check` run gave `6eaa5686…`, which differs by one `"phoneLatencyMs": 0` → `1`, a wall-clock measurement. This is an existing timing flake in T2.10d's test and `summaryFlow.ts`; both are frozen and untouched. I'm reporting it here and not fixing it.
- Colour validation (dark highlight): recorded, not re-run. It ran in the design session, and its output is in spec §Decisions 9. `#C97A3C` is set from that result.
- Safe-area before/after screenshots: NOT RUN (no phone in this WSL2 session).
- New EAS dev build installs, launches and renders the fonts: NOT RUN (owner).

### Deviations

1. The kit `Button` is built from Paper's `TouchableRipple` and `Text`, not Paper's `Button`. Paper's `Button` renders its label with `numberOfLines={1}` (`Button.tsx:404`). That would truncate the titles that carry state, such as the console's "Vehicle Ready and in Park for diagnosis: yes/unknown" and the device row's name, id and RSSI. Truncating them would hide information.
2. The spacing between `Screen` children stays at 8 dp, not §Design's 14 dp. In Stage B, children are single lines and buttons, not blocks. The console page does not scroll and now has 52 dp buttons, so a larger gap would push more of its controls off-screen (see the risk below).
3. The type scale in B is the default body style plus the bold→Manrope 700 mapping. The h1, section, row-label and caption styles arrive with the C stage that first uses them (rule 10: no screen in B can use them). Titles keep the screens' own 20/bold.
4. The default export is `Root` (providers and fonts). `App` stays a named export.
5. `expo install` added the `expo-font` config plugin to app.json; I removed it (see Dependencies above).

### Risk for the reviewer and orchestrator

The console page (`ConsoleScreen.tsx`, frozen until C3) is a fixed page, not a scroll view. It has 9–10 buttons. They were about 36 dp high as RN buttons and are now at least 52 dp. By rough count, its fixed content grows from about 790 dp to about 950 dp plus insets. On a typical phone, the lowest controls ("Run charge log", the second input, "Send", the report and transcript panes) may be clipped and unreachable until C3's restyle. The owner should check this first on the new build.

If they are clipped, the options are:
- (a) accept the clipping until C3 and run the console flows on the Stage A dev client;
- (b) allow a one-line console edit in B that makes that page scroll;
- (c) bring C3's console restyle forward.

### Owner steps (hardware, NOT RUN)

1. Build and install the new dev client: `cd apps/mobile && pnpm dlx eas-cli@24.7.0 build --profile development --platform android`. Then `pnpm start` for Metro.
2. Light theme, with the system in light mode: take screenshots of Garage, Add a vehicle, Unsupported vehicle interest, Report history, a report detail, the console, and the Consent screen.
   - The status bar has dark icons.
   - The bg is the light `bg` (a pale grey-green) and buttons are the green accent.
   - Nothing sits under the status bar or cutout at the top, or under the nav bar at the bottom. Check both gesture and 3-button nav.
3. Dark theme, with the system in dark mode: the same screens.
   - The status bar has light icons.
   - The bg is the dark `bg`, and the text is light and readable.
4. Fonts: body text and button labels are Manrope, not Roboto. A bold heading such as "Garage" is visibly Manrope Bold. JetBrains Mono has no visible use until C1's hero, so its check moves to C1.
5. The console (see Risk): every control is reachable, and the transcript pane is visible.
6. The app stays portrait when the phone rotates.
7. If not already done on the Stage A client: Stage A's phone checks (a)–(f).
- 2026-09-28, orchestrator, on the Stage B report:
  - Deviations 1–6 accepted.
  - Q1 (console overflow at ≥52 dp buttons): accepted for B. The owner does no phone checks until all stages land, so **C3 must make the console fit or scroll**, and C3's brief says so.
  - Q2: the T2.10d artifact passes on rerun. The flake is `phoneLatencyMs` wall-clock time in `/tmp/t2.10d-mobile-flow.json`. Follow-up for Codex: a fixed clock in the summaryFlow test.
  - `expo install --check` exits 1 on three packages Stage B did not touch (expo ~57.0.25, expo-modules-core ~57.0.19, expo-sharing ~57.0.22). Moved to the deferred list: bump them just before the EAS build, so one build covers both.
  - Next: Stage B reviewer.
- 2026-09-28, Stage B reviewer: **APPROVE**.
  - Reproduced: pnpm check PASS. All 7 dependencies match the table and their licenses; the lockfile diff is additions only. app.json has only portrait and automatic. theme.ts matches §Design hex for hex. The Button is accessible and ≥52 dp. Insets are applied once. Root renders on a font error. Logic freeze empty. Fingerprint `d66ba328…`. Bundle `b5a821ab…`. Artifacts identical on the first run.
  - Contrast (body text): the lowest is onAccent/accent 4.70 in light; everything else is 5.4–13.
  - Findings, carried into later briefs:
    - (1) expo patch bumps: stay on the deferred list.
    - (2) The hardcoded error colour `#B00020` is 2.23:1 on the dark bg (App.tsx:128, ReportScreens.tsx:27). **C1/C2 move it to an error token** that passes 4.5:1 in both themes.
    - (3) kit `Text` maps every non-bold weight to Manrope 500. **C1 extends the mapping** for 600, 700 and 800 before the type scale uses them.
    - (4) The six accepted deviations, named: 1 Button built on TouchableRipple (Paper's Button label is one line); 2 Screen child gap stays 8 dp in B; 3 only body and bold text styles in B; 4 default export is Root, App stays named; 5 expo-font config plugin removed from app.json; 6 pnpm re-sorted package.json keys.
- Stage B closed and committed by path.

## Stage C1 implementer (Claude, 2026-09-28)

Base: HEAD `7bd9803`, tree clean (`git status` at start). Repair count 0 of 2.

Changed (12 files): `apps/mobile/App.tsx`, `src/ui/kit.tsx`, `src/ui/theme.ts`, `src/screens/{GarageScreen,AddVehicleScreen,ReportScreens}.tsx`, `src/runFiles.ts` (comment only); created `src/app/navigation.ts`, `src/app/reportView.ts`, `src/screens/CarScreen.tsx`, `src/screens/SettingsScreens.tsx`, `test/redesign-navigation.test.ts`. The spec's C1 list is nine files; `theme.ts`, `ReportScreens.tsx` (carried item 1) and `runFiles.ts` (carried item 3) were added by the orchestrator's brief. Plus this record.

- **Route stack** (`navigation.ts`): the spec's `Route` union verbatim and `back(stack, locked)`: `exit` at one route, `blocked` when locked with `check` on top, else pop. `App` holds `stack` in state; `push`/`pop` helpers; `BackHandler` calls `back`. The consent screen covers the stack when the top is Garage (first run / newer consent version) or the Beta page (switch on); system back on consent opened by the switch closes it without a decision.
- **Garage**: top bar "Garage" with a settings gear; rows of car icon, "`<year> <make> <model>`", Mine/Checking tag, chevron; an "Add a vehicle" row. Nothing else.
- **Car**: SoC hero (`socHero`, JetBrains Mono 600, one decimal, charge bar, "Last check <date>"); tap opens the latest report (still today's detail view until C2). No report → "No check yet", not pressable. A report without an `EQUINOXEV_SOC` reading → "Not read", still opens the report. **Run check** (primary) and **Log a charge** (tonal) push `check` with their intent; both disabled with `vehicleAvailability` when `canUseEquinoxConsole` is false. Rows: Report history (count), Ownership (Alert with Cancel/Checking/Mine → existing `changeOwnership`). **Remove from garage**: error-colour text button → confirmation → existing `removeGarageVehicleWithReports`; its refusal shows unchanged through `change()` ("Garage storage error: This car has retained battery reports…").
- **Add a vehicle**: make/model/year as choice rows with a check mark; the selected card with Mine/Checking choice rows and Add to garage (pops back to Garage on success); "Not listed" section with the not-listed row and the saved interests (moved from Garage), and the "saved privately" notice. The interest form itself is unchanged.
- **Settings**: Data › Beta data sharing (On/Off), About › Privacy note. **Beta** sub-page: `CONSENT_SWITCH_LABEL` switch (on → `setConsentOpen(true)`, off → `decideBeta(false)`, unchanged), `beta.line`, Beta ID, `betaMessage`, **Delete my data** in the error colour with the existing confirmation. **Privacy**: `PRIVACY_NOTE` as plain selectable text (C4 formats it).
- **Kit**: `ListRow` (≥60 dp, divider, icon, 16/600 label, subtitle, right value or node, chevron, `selected` choice mode with a check and `radio` role), `SectionLabel` (13/700, uppercase, 0.78 dp = 0.06em at 13), `Hero` (container, radius 28, mono number, track/accent bar). `Button` gains `tonal`. `Screen` gains `blocks` (14 dp gap); C1 pages use it, unreached pages keep 8 dp. A local `TopBar` in `App.tsx` (back arrow ≥48 dp, wrapping h1 28/700 so long car names are never truncated, optional action).
- **Carried items**: (1) `error` token in `theme.ts`: light `#B3261E`, dark `#F2B8B5`, which are react-native-paper 5.15.3's MD3 `error40`/`error80` (`src/styles/themes/v3/tokens.tsx`). WCAG ratios, computed with the WCAG 2 relative-luminance formula: light 5.91 on bg, 6.30 on surface; dark 9.57 on bg, 8.58 on surface (old `#B00020`: 2.23/2.00 in dark). `App.tsx` and `ReportScreens.tsx` use it; no `#B00020` remains. (2) Kit `Text`: `600`→`Manrope_600SemiBold`, `700`/`bold`→`Manrope_700Bold`, `800`→`Manrope_800ExtraBold`, anything else →500; all four faces are loaded by `Root`'s `useFonts` (500, 600, 700, 800 plus JetBrains Mono 600). (3) `runFiles.ts:10` comment now names `src/app/runtime.ts (phoneTargets)`: the one sanctioned logic-freeze exception, one line, comment only. (4) C1 pages use the 14 dp rhythm.
- Other contrast checks for pairs C1 introduces (text ≥4.5 unless noted): onContainer/container 10.88 light, 8.61 dark; containerMuted/container 5.69, 5.67; neutral tag fg/bg 6.47, 7.18; muted/bg 5.39, 7.07; accent check mark on bg (non-text, ≥3) 4.25, 7.21; accent bar fill on track (non-text) 3.04, 4.06.

### Verification (Stage C1)

- Tests first: `test/redesign-navigation.test.ts` was written before `navigation.ts`/`reportView.ts` existed. **Failing first**: the file failed on the missing `../src/app/navigation.js` import; with placeholder stubs (`back` always pops, `socHero` always `undefined`) 5 of 7 failed (both `back` cases; the three recordings with an `EQUINOXEV_SOC` reading). PASS after implementation: 7/7.
  - Failure 1 (`back` on locked `check` pops) and failure 2 (`back` at `[garage]` does not exit): one test each.
  - `socHero` E2E: the five committed Equinox `*.redacted.jsonl` recordings through `batteryDiagnosisFromRecording`, then `socHero`. Spike and spike-2 → 69.8 (the mockup value; the 27C6 HD signal would give 69.6), discovery-targeted → 85.1 (its last 2B43 reading; the first is 84.7), both phone-console recordings → `undefined` (no SoC read).
  - Artifact `/tmp/x-redesign-navigation.json`, SHA-256 `817aaefd…17f1`, byte-identical on two runs: PASS.
- **Mutations** (each reverted; file restored and diffed): drop the lock check → 1 failed; drop the exit case → 1 failed; `EQUINOXEV_SOC_HD` instead of `EQUINOXEV_SOC` → 3 failed; whole percent instead of one decimal → 3 failed; first reading instead of last → 1 failed. PASS.
- `pnpm check`: PASS, exit 0 (core 239, battery 21, assist 142, mobile 311 = 304 + 7, relay 58, backend/intake/summary 42, Ruff, pytest 1).
- `pnpm -F mobile typecheck`: PASS. `eslint apps/mobile`: PASS.
- `expo export --platform android` into a scratch temp dir, deleted afterwards: PASS (`AppEntry-103e3d83….hbc`, 3.2 MB, 996 modules).
- Expo fingerprint: `d66ba328b7116976e29d34d6aac3378c2be9ecaf`, equal to Stage B: PASS. No new build.
- Artifacts deleted, then regenerated by `pnpm check`: codes `01d894f4…` (b and c1), charge-log `fbb90c17…` (b and c1), C2 intake `bfacfd43…`: PASS. `/tmp/t2.10d-mobile-flow.json` `4eb12fbc…`: PASS. It flaked once on the first full `pnpm check` (`6eaa5686…`, the known wall-clock `phoneLatencyMs` line), then matched on three isolated reruns and on the second full `pnpm check`.
- Logic freeze (spec path list against `7bd9803`): only `src/runFiles.ts`, 1 line, the comment above. PASS with the sanctioned exception. `test/` has only the new file.
- Only listed files changed (`git status --short`): PASS (the 12 above plus this record).
- Phone and car: NOT RUN (no phone or car in this WSL2 session). Owner steps, on the Stage B dev client through Metro (`cd apps/mobile && pnpm start`):
  1. Garage: top bar with the gear; each car row shows the Mine/Checking tag and a chevron; "Add a vehicle" row. Nothing else on the page.
  2. System back: Garage → back exits; Car → back returns to Garage; Settings › Beta → back twice returns to Garage. On the check screen system back does nothing (see deviation 1); the console's own "Back to garage" button returns to the Car.
  3. Car for the Equinox: the hero shows the last check's SoC with one decimal in JetBrains Mono over a bar, and "Last check <date>"; tapping it opens that report. A car with no check shows "No check yet" and does nothing on tap. A non-Equinox catalog car shows its availability text and both buttons disabled.
  4. Run check and Log a charge both open the existing console. One battery diagnosis there opens its saved report; back from the report returns to the Car, whose hero now shows that check.
  5. Ownership row: the dialog changes Mine ↔ Checking and the row and the Garage tag follow.
  6. Remove from garage on a car with saved reports: after confirming, the unchanged refusal text appears in the error colour. On a car without reports, the car is removed and the app returns to Garage.
  7. Add a vehicle: pick make, model and year (check marks), Mine/Checking, Add to garage → back on Garage with the new row. "My make, model, or year is not listed" opens the interest form; a saved interest appears under "Not listed" and reopens.
  8. Settings › Beta data sharing: switch on → the consent screen; Continue with the switch on → Beta page shows sharing on; switch off → off at once. Delete my data (red) shows the existing confirmation. Settings › Privacy note shows the note.
  9. T2.9 Stage D steps 1–4 and 6, with the beta switch now under Settings › Beta data sharing. Light and dark screenshots of Garage, Car, Add a vehicle, Settings, Beta and Privacy, including a font scale 2.0 check that the car-name title wraps.

### Deviations

1. **System back is blocked on the whole check screen in C1**, not only while a diagnosis or charge log runs. `EquinoxConsole` keeps `diagnosing` and `chargeLogging` in its own state and is not in C1's file list, so `App` cannot see them; `App` passes `locked = true`. The console's own back button (with its unchanged disable conditions) is the way out. C3 needs a small console prop, for example `onLockChange(locked)`, to pass the real condition; C3's brief currently forbids handler edits in `ConsoleScreen.tsx`, so the orchestrator should allow this one prop there.
2. The `socHero` E2E lives in `test/redesign-navigation.test.ts` (C1's only listed test file). It covers the brief's "reportView SoC selector" test; C2's `report-view.test.ts` will cover `reportSummary`, which contains it.
3. `socHero` takes the **last** `EQUINOXEV_SOC` reading in the report. App diagnosis reports have one; discovery-targeted has many and the latest is the current value.
4. The Car hero shows "Not read" for a report without an `EQUINOXEV_SOC` reading (the spec covers only report / no report).
5. `ReportHistory` takes `openReport(report)` instead of `setDetail` + `setView`, since views are routes now. `ReportDetail` is unchanged apart from the error token. Its "Back to report history" returns to an existing history route on the stack, or opens one.
6. After a diagnosis is saved, its report **replaces** the `check` route, so back from the report goes to the Car. Before, the detail's only exit was "Back to report history".
7. Garage rows no longer show report counts, so `refreshReports` only loads the history, and `openSaved` no longer calls `garageFlow.load()` (it only fed those counts).
8. The garage tag choice reads "Checking" (the stored value stays `checked`), per §Screens 1–2.
9. The top bar is a small local `TopBar` in `App.tsx`, not Paper's `Appbar.Content`, which renders the title on one line and would truncate car names at font scale 2.0. The destructive text buttons are Paper `Button mode="text"` with the error colour (short fixed labels, so one line is fine).

### Questions for the orchestrator

1. Deviation 1: allow C3 one console prop that reports the lock?
2. The Car's "Run check" opens the console whose back button still reads "Back to garage" but returns to the Car. C3 restyles that screen; OK to leave the label until then?
- 2026-09-28, orchestrator, on the C1 report:
  - Deviations 1–11 accepted. The reviewer verifies deviation 7 (openSaved no longer calls garageFlow.load) has no effect beyond the removed counts.
  - Q1: yes. **C3 may add one ConsoleScreen prop, `onLockChange(locked)`**, so system back is blocked only during a diagnosis or charge log. This is the one sanctioned console-behaviour hook.
  - Q2: yes. The console's "Back to garage" label stays until C3 relabels it "Back".
  - Next: C1 reviewer.
- 2026-09-28, C1 reviewer: **APPROVE**.
  - Reproduced: pnpm check PASS (mobile 311). Bundle `103e3d83…`. Artifacts identical, plus `/tmp/x-redesign-navigation.json` `817aaefd…`. Logic freeze: only the runFiles.ts comment. Fingerprint `d66ba328…`. Reviewer mutations each fail exactly one test.
  - Behaviour verified: T2.9 consent flows; deviation 10 safe (no decide on back); console never remounts mid-run; deviation 7 safe (garageFlow.load had no side effects; the count comes from fresh history); report replaces check.
  - Findings, carried to C2:
    - (1) The `report` route shows the shared `detail` state, not the report its route names, so a history back-and-forth path can show the wrong report. **C2 resolves the report from the route's scannedAt/recording.**
    - (2) The `ListRow` `chevron` prop is unused. C2 uses it or drops it.
    - (4) The socHero E2E partly restates the code. **C2 view tests use fixed literals per recording.**
  - (3) Record fix, the two C1 deviations missing from the numbered list:
    - **10**: system back on a consent opened by the Beta switch closes it without a decision.
    - **11**: 12 files against the spec's 9. The extra three (theme.ts, ReportScreens.tsx, runFiles.ts) were added by the orchestrator's brief.
- C1 closed and committed by path.

## Stage C2 implementer (Claude, 2026-09-28)

Base: HEAD `8e060ff`, tree clean (`git status` at start). Repair count 0 of 2.

Changed (8 files, all on the spec's C2 list): `apps/mobile/App.tsx`, `src/app/reportView.ts`, `src/screens/ReportScreens.tsx`, `src/ui/kit.tsx`, `packages/obd-core/src/report/replay.ts` (the sanctioned re-export line); created `src/screens/SectionScreens.tsx`, `src/ui/charts.tsx`, `test/report-view.test.ts`. Plus this record.

- **reportView.ts**: `reportSummary`, `sectionDetail`, `codesView`, `historyPoints` per spec §Interfaces, plus `findReport(reports, { scannedAt, recording })` (carried item 1) and `moduleRows(codes, ecu)` (module detail rows, worded as `renderCodesReport`'s module section). Codes rating, in precedence order (§Decisions 1): any read stored/pending/permanent code → Poor ("Project policy: a reported code is Poor"); verdict `indicated` → Poor ("Project policy (T0.7): the recently-cleared check says yes"); no module's Mode 03/07/0A read succeeded → Not rated ("No module answered a code read"); `not-indicated` → Good; otherwise (`unknown`) → OK. SoC has no rating; cells, capacity and 12 V are Not rated, basis "No threshold yet". Provenance: signal tier for SoC and cells, otherwise neutral with the report's word ("Not measured", "Not assessed", "Not read"). "What this means" = the report's reason string (`health.reason` for cells, `capacity.reason`, `twelveVolt.reason`) plus one fixed sentence each, restating ADR-018 §Evidence and limits (snapshot does not certify health; capacity not measured until a charge log and reviewed estimator exist), T2.2b (cells stay community) and the §Sources row "12 V value is the ATRV adapter supply, not a battery test". SoC has no reason string, so two fixed sentences (ADR-018: a snapshot can show SOC; it does not certify battery health). Cell range: the MIN/AVG/MAX reply whose MIN/MAX reproduce `cellSpread.volts` exactly (the pair `buildBatteryDiagnosis` chose), in mV to 0.1.
- **Screens**: `ReportSummary` replaces the text-dump `ReportDetail` (SoC hero → State of charge; four rows with value as subtitle, chip and chevron; "Run a new check"; `__DEV__` row "AI summary (development)"). `SectionScreen` (hero with provenance tag, chart 4 inside the Cell balance hero, rating card with "Basis: …", chart 2 on State of charge, readings with tier tags, What this means, Source, Log a charge on Capacity). `CodesScreen` (count hero, rating card, expandable "Recently cleared?" card with the four legs and the `LOW_COUNTER` thresholds sentence, modules list). `ModuleScreen` (per-mode rows).
- **charts.tsx** (plain Views): `ScanHistory` (0–100 % axis; below two points "Appears after your second check"; latest dot 16 dp vs 10 dp, highlight colour, and a "Latest 69.8%, <date>" legend label), `CellRangeStrip` (min–max fill and avg tick on a mV axis padded by the spread, Min/Avg/Max labels).
- **kit.tsx**: `Chip` (icon + word + colour; glyphs `star-circle`, `check-circle`, `alert-circle-outline`, `close-circle`, `minus-circle-outline`, all present in the installed glyph map, as are `chip`, `creation-outline`, `chevron-up/down`), `Tag`, `Hero` gains `tag` and `children`. Carried item 2: the unused `ListRow` `chevron` prop is dropped (it is now derived: shown when the row opens something).
- **App.tsx**: the shared `detail` state is gone. `report`, `section`, `codes`, `module` and `aiSummary` resolve their report with `findReport(historyReports, route)` (carried item 1). `aiSummary` hosts `DevelopmentSummary` unchanged, only under `__DEV__`.
- **replay.ts**: `export type { CodesReport, Tri } from "./codes.js"; export { LOW_COUNTER } from "./codes.js";`, the spec's §Interfaces line verbatim. The one sanctioned logic-freeze exception.

### Verification (Stage C2)

- Tests first: `test/report-view.test.ts` was written before any C2 function existed. **Failing first**: 13/13 failed (the view functions were not exported). PASS after implementation: 13/13.
  - E2E: the five Equinox `*.redacted.jsonl` recordings → `batteryDiagnosisFromRecording` → `reportSummary`, `sectionDetail` ×4, `codesView`, `moduleRows`, `historyPoints`; the four synthetic codes fixtures → `codesReportFromRecording` → `codesView`. Expected values are fixed literals per recording, read off `renderBatteryDiagnosis`/`renderCodesReport` output (carried item 3): SoC 69.8 / 69.8 / 85.1 / none / none; cells "3.0 mV" / "3.0 mV" / "2.7 mV" / "Not read" ×2; 12 V "12.7 V" / "13.1 V" / "11.7 V" / "Not recorded" ×2; cell ranges 3928.7/3929.7/3931.7, 3927.8/3928.8/3930.8, 4076.4/4077.2/4079.1 mV; codes OK, OK, Not rated (discovery: no code read), OK, OK; synthetic cleared Poor (cleared basis), conflict OK, permanent Poor (code basis, 1 code), stored Poor (code basis, 2 codes). `max − min` equals `cellSpread.volts × 1000` and min ≤ avg ≤ max per recording. `historyPoints` over [spike-2, spike] gives two points oldest first, over [spike] one point, over all five three points.
  - Route lookup: Car hero → latest report, then History → the older report, back twice → the latest again (`findReport` over the route, via `back`); an unknown key resolves to nothing.
  - Artifact `/tmp/x-redesign-report-view.json`, SHA-256 `8de1172f35283b6e276d5b28455170f1d90f335e7da5f091c59896e86a9df910`, byte-identical on two runs: PASS.
- **Mutations** (each reverted; `cmp` against a backup): code→Poor removed → 2 failed; indicated→Poor removed → 1; not-read→Not rated removed → 1; not-indicated→Good removed → 1; unknown→Good → 6; SoC given a rating → 5; cells rated OK → 5; `findReport` returns the first report → 1; `findReport` ignores scannedAt → 1; history unsorted → 1; cell range from the last reply → 1. PASS.
- `pnpm check`: PASS, exit 0 (core 239, battery 21, assist 142, mobile 324 = 311 + 13, relay 58, backend/intake/summary 42, Ruff, pytest 1).
- `pnpm -F mobile typecheck`: PASS. `eslint apps/mobile packages/obd-core/src/report`: PASS.
- `expo export --platform android` into a `mktemp -d` dir, deleted afterwards: PASS (`AppEntry-e8ba15ba….hbc`, 3.3 MB).
- Expo fingerprint: `d66ba328b7116976e29d34d6aac3378c2be9ecaf`, equal to Stage B: PASS. No new build.
- Artifacts deleted, then regenerated by `pnpm check`: codes `01d894f4…` (b and c1), charge-log `fbb90c17…` (b and c1), C2 intake `bfacfd43…`, navigation `817aaefd…17f1`: PASS, unchanged (C2 does not touch `socHero` or `back`). `/tmp/t2.10d-mobile-flow.json`: PASS `4eb12fbc…bc23` on rerun; the full `pnpm check` run flaked once to `6eaa5686…` (the known wall-clock `phoneLatencyMs` line).
- Logic freeze (spec path list against `8e060ff`): only `packages/obd-core/src/report/replay.ts`, 1 line, the sanctioned re-export: PASS. `test/` has only the new file.
- Only listed files changed (`git status --short`): PASS (the 8 above plus this record).
- Phone: NOT RUN (no phone or car in this WSL2 session). Owner steps, on the Stage B dev client through Metro (`cd apps/mobile && pnpm start`), after a battery check on the Equinox (or with saved reports):
  1. Car hero → Report summary: SoC hero with one decimal; rows Cell balance, Capacity, 12 V battery, Diagnostic codes in that order, each with value, chip (icon + word) and chevron; "Run a new check" opens the check screen.
  2. Each row's chip reads Not rated for cells, capacity and 12 V; Diagnostic codes reads OK (or Poor/Good/Not rated per the car's codes), and its rating card names the basis.
  3. State of charge: no rating card; the scan-history chart shows "Appears after your second check" with one saved check, and dots with a larger labelled latest dot after two or more.
  4. Cell balance: the range strip (Min/Avg/Max labels, mV) inside the hero with a Community tag; readings with Community tags; What this means; Source.
  5. Capacity: Not measured with a neutral tag; Log a charge opens the check screen with the charge intent. 12 V: the adapter voltage with a "Not assessed" tag.
  6. Codes: tap "Recently cleared?" to expand the four legs and the policy thresholds; tap a module → its per-mode rows.
  7. Route resolution: from the Car hero open the latest report, back, open Report history, open an older report, then back twice: the summary shows the latest report again. In `__DEV__`, the "AI summary (development)" row opens T2.10d's summary for that report.
  8. Light and dark screenshots of each of these screens, and font scale 2.0 (chips and row subtitles wrap, nothing clipped).

### Deviations

1. `findReport` and `moduleRows` are exported from `reportView.ts` beyond spec §Interfaces: the first is carried item 1's route lookup, the second the module detail rows (§Screens 5), kept pure so the E2E artifact covers them.
2. `sectionDetail`'s hero carries a `tagLabel` (the word on the provenance tag), in addition to the spec's `tag` tone.
3. The Good codes branch has no recording or fixture (none has all code reads answered with the verdict `not-indicated`). The test derives one in memory from the spike's codes report with the verdict set to `not-indicated`, labelled synthetic with `derivedFrom` in the artifact. No fixture file was added.
4. "No module answered" is read as "no module's Mode 03/07/0A read succeeded" (the Q1 recommendation's wording). So discovery-targeted, whose modules answered PIDs but no code read, is Not rated, although its recently-cleared verdict is `not-indicated`.
5. `codeCount` counts distinct codes across modules and modes (codes-stored: P0133 stored and permanent, U0158 pending → 2).
6. The 12 V hero and summary value use the last observation; the detail adds "Readings in this check" when there is more than one (discovery-targeted has 44).
7. Module detail rows repeat `render.ts`'s wording in `reportView.ts`, because `render.ts` exports only `renderCodesReport` and obd-core is frozen apart from the re-export.

### Questions for the orchestrator

1. **Chip contrast.** The §Design chip fg/bg pairs are below 4.5:1 for 13 dp text (WCAG 2 relative luminance): light Good 4.28, OK 3.02, Poor 4.35; dark Good 3.75, OK 3.86, Poor 3.56 (Not rated 5.24/5.67). As non-text (the glyph), every pair passes 3:1 (lowest 3.02). The colours are binding, so they are unchanged; the owner may want the Stage D contrast check to decide, or a darker fg step. Tags pass (5.43–6.85).
2. The scan-history chart and the Car hero read `historyReports`, which `listReports` loads per car; a report route whose report is not in that list (it cannot happen through the UI) falls back to Garage like other stale routes. OK?
- 2026-09-28, orchestrator, on the C2 report:
  - Deviations 1–3 accepted.
  - Q1 (chip label contrast): the label uses the **text token** on the chip's tint, and only the icon takes the status colour (≥ 3:1). This follows the approved mockups and the dataviz "text wears text tokens" rule, so no owner decision is needed. Sent back to the same implementer as a small fix.
  - Q2: a stale report route falls back to Garage. Accepted.

### C2 addendum (implementer, after the orchestrator's rulings)

- The orchestrator ruled on Q1: the chip label wears the text token. `Chip` in `src/ui/kit.tsx` now draws the word in `tokens.text`, and only the icon uses the status colour. The spec colours are unchanged. WCAG 2 contrast on each chip background:

  | Chip | Light label (#2A302C) | Light icon | Dark label (#D6DCD8) | Dark icon |
  |---|---|---|---|---|
  | Great / Good | 11.43 | 4.28 | 9.06 | 3.75 |
  | OK | 11.61 | 3.02 | 8.87 | 3.86 |
  | Poor | 10.91 | 4.35 | 9.60 | 3.56 |
  | Not rated | 11.85 | 5.24 | 9.41 | 5.67 |

  - Every label is at least 4.5:1 and every icon at least 3:1: PASS.
  - No pure function decides these colours, so no test was added. They are checked in the Stage D screenshots.
- Q2 was accepted: a stale report route falls back to Garage. Deviations 1–3 were accepted.
- Re-run after the change:
  - `pnpm check`: exit 0, mobile tests 324 pass. eslint passes on `kit.tsx`. PASS.
  - Fingerprint: `d66ba328…`, unchanged. PASS.
  - Artifacts: `01d894f4…`, `fbb90c17…`, `bfacfd43…`, `4eb12fbc…` (first run, no flake), `817aaefd…` and `8de1172f…` (report view), all unchanged. PASS.
- 2026-09-28, C2 reviewer: **APPROVE**.
  - Reproduced: pnpm check PASS (mobile 324); 19 of 24 reviewer mutations killed, the survivors equivalent or covered by the artifact; chip contrast recomputed and matching; chart values are the report's own; logic freeze is only the replay.ts line; fingerprint `d66ba328…`; all artifacts identical, including report view `8de1172f…`.
  - Deviation 4 (discovery-targeted Not rated) judged sound.
  - Findings:
    - (1) Record: the orchestrator ruled only on deviations 1–3 of 7.
    - (2) Surviving mutants: dropping `module.stored` from codeList; findReport ignoring `recording`.
    - (3) cellReply re-finds the reply by float equality and could pair min/max with an earlier reply's avg on a partial decode.
    - (4) Copy: the Capacity source line reads like the value came from a charge log; the Codes caption "5 modules answered" sits beside the basis "No module answered a code read".
- 2026-09-28, orchestrator:
  - **Deviations 4–7 accepted:**
    - 4: discovery-targeted Not rated (reviewer: sound);
    - 5: the code count is distinct codes;
    - 6: the 12 V hero shows the last reading;
    - 7: module rows repeat render.ts wording while obd-core is frozen.
  - Findings 2–4 are folded into the C3 brief as required items, not a C2 repair round:
    - a stored-only-code → Poor test;
    - a findReport negative case that differs only in `recording`;
    - cellReply selects min/max/avg from one reply by identity, not float equality;
    - copy: "Not measured; needs a completed charge log" and "5 modules answered; none answered a code read".
- C2 closed and committed by path.

## Stage C3 implementer (Claude, 2026-09-28)

Base: HEAD `5975608`, tree clean (`git status` at start). Repair count 0 of 2.

Changed (8 files): `apps/mobile/App.tsx`, `src/screens/ConsoleScreen.tsx`, `src/screens/ReportScreens.tsx`, `src/app/reportView.ts`, `src/screens/SectionScreens.tsx` (one line of copy), `test/charge-logger.test.ts`, `test/report-view.test.ts`; created `src/app/chargeSteps.ts`. The spec's C3 list is five files. `reportView.ts`, `SectionScreens.tsx` and `report-view.test.ts` come from the brief's carried C2 review items. Plus this record.

- **History** (`ReportHistory`): chart 2 (`ScanHistory` over `historyPoints`, empty state below two checks); "Battery checks" rows (date and time, "Complete scan"/"Partial scan", chevron to the Report summary), newest first as `batteryHistory.list` returns them; "Charge logs" with the empty state "Charge logs are saved to your capture folder; showing them per car comes later." (§Decisions 4). Title "Report history".
- **Check screen** (`ConsoleScreen.tsx`, JSX and styles): a scrolling `Screen scroll blocks` page. Top bar: an arrow `IconButton` labelled "Back" (carried item 3), with the old disable condition `diagnosing || chargeLogging`, and the title "Battery check", "Log a charge" or "Charge log". Next, a status hero (container, radius 28) with the car line, the status line (live region) and the connection line. Then **Dongle**: Scan (tonal), and device rows (`ListRow`, name, then id and RSSI; tap to connect). Then a "Vehicle Ready and in Park" `Switch` (caption "Recorded with the battery check: yes/unknown"). Then one primary action per intent: "Run battery check" → `diagnose`, or "Start charge log" → `chargeLog`. Then "Cancel check" while a diagnosis runs, then Disconnect (tonal). Then the 12 V unplug note as a card. Last, a collapsed **Developer tools** card: note field, Run capture, Run codes report, the capture progress lines, the command field, Send (not saved), and the report and transcript panes (fixed 220 dp, `nestedScrollEnabled`). Every `disabled`/`editable` condition and every `onPress` body is the old expression, character for character. `FlatList` became a mapped list, because a FlatList inside the page ScrollView is a nested VirtualizedList.
- **Charge log** (the check screen while `chargeLogging`): the status hero shows the existing status line from `chargeRun.mount`. Below it: the 5-step timeline (`CHARGE_STEP_LABELS`: Rest 10 min, Plug in, Charge, Rest 30 min, Saved); the note "The charge log stops and saves by itself. Disconnect stops it early; what was logged so far is kept."; and the existing Disconnect. There is no other start or stop control. The start stays the single "Start charge log" tap (T2.4 B2, owner one-and-done rule). Step marks while running: earlier steps "Done", current "Now" (icon + word), later ones blank. Once the status maps to Saved, the timeline stays on the check screen: step 5 "Done", steps the run reached "Logged", the rest "Not reached", so a run stopped early never shows the charge as done.
- **`chargeSteps.ts`** (pure): `chargeStep(line)` and `CHARGE_STEP_LABELS`. Minutes come from `PRE_REST_S / 60` and `POST_REST_S / 60` (`obd-battery/session`). Mapping: `update()`'s lines (`chargeLogger.ts:169–173`) → 1–4, "Charge log stopped…" → 5, everything else → `undefined` (keep the previous step).
- **Lock** (carried item 2, the sanctioned hook): new console prop `onLockChange(locked)`. It is fed by an effect on `diagnosing || chargeLogging`, and an unmount cleanup sends `false`, because a saved diagnosis replaces the check route while `diagnosing` is still true. `App` keeps `locked` in state, passes the stable `setLocked`, and calls `back(stack, locked)` instead of `back(stack, true)`. The console also gets `intent={route.intent}`.
- **C2 review items** (carried item 4):
  - (a) Stored-only-code test: derived in the test from `codes-stored.jsonl`, with its pending and permanent reads cleared, which leaves only stored P0133. Result: Poor, 1 code.
  - (b) New `findReport` negative case: spike's `scannedAt` with spike-2's `recording` → undefined.
  - (c) `cellReply` rewritten. It takes the first MIN directly followed by its reply's MAX from one ECU (the pair `buildBatteryDiagnosis` takes), found by position. It takes the AVG only when that AVG sits immediately before the pair from the same ECU. There is no float comparison. With no same-reply AVG, the readings are Lowest, Highest and Spread, and there is no range strip.
  - (d) Copy changes. The Capacity source is now "Not measured; needs a completed charge log". The Codes caption is now "5 modules answered; none answered a code read" when the rating is Not rated.

**Logic-file changes, named:** `src/app/chargeSteps.ts` (new, pure); `src/app/reportView.ts` (`cellReply`, the Capacity `source` string); `App.tsx` (`locked` state, `back(stack, locked)`, the console's `intent`/`onLockChange` props); `ConsoleScreen.tsx` (the `onLockChange` prop and its two effects, plus presentation state `devOpen`/`reached` with two effects that only read `status`/`chargeLogging`). No handler, ref or status string in the console changed. The spec's logic-freeze path list is empty.

### Verification (Stage C3)

- **Tests first**, recorded failing before any implementation:
  - `charge-logger.test.ts` failed to load (`Cannot find module '../src/app/chargeSteps.js'`).
  - `report-view.test.ts` had 6 failures: the 5 recordings on the new Capacity source copy, and the derived partial-decode case (old `cellReply` returned `{ minMv: 4076.3, avgMv: 4077.2, maxMv: 4079 }`, reply 1's AVG beside reply 2's pair, which is the reviewer's finding 3).
  - The stored-only and `findReport`-recording cases passed on the correct C2 code. They exist to kill C2's surviving mutants (see Mutations).
  - After implementation: PASS.
- **E2E (C3), `test/charge-logger.test.ts`:** cases 1 (happy), 5 (disconnect-recover and disconnect-give-up) and 9 (stop-requested) map every `statuses` line through `chargeStep`. The step never decreases. Happy gives 1→2→3→4→5; the other three give 1→5.
  - The console's own lines are mapped too: "Starting the charge log…" → none; "Stopping the charge log after the current command…" → none; "Charge log stopped; preparing the beta upload…" → 5; two "Charge log stopped: …" lines → 5; the "log file could not be created … NOT SAVED: …" line → none.
  - Isolated failure 3 (recovery, retry and "Starting the ELM327." lines → undefined) and failure 4 (the three "Charge log not started: …" lines → undefined) have one test each.
  - Artifact `/tmp/x-redesign-charge-steps.json`, SHA-256 `26f39b22e5892703a9a1ceefaf82b0a4da3d23f62fce25704a4e55b5a506fb19`, `cmp`-identical on a rerun: PASS.
- **Report view:** `/tmp/x-redesign-report-view.json` changed from `8de1172f…` to `cdae2bf639c66d86b0aaa995b32b4b3d5e6991a49d23d5e42792ef28b3e95c62`, `cmp`-identical on a rerun: PASS. Old and new differ in 63 lines, for three reasons:
  - the five `sections.capacity.source` strings changed to the new copy;
  - a new key `synthetic/derived-partial-2af5` (derived from discovery-targeted, labelled synthetic);
  - a new key `synthetic/derived-stored-only` (derived from `codes-stored.jsonl`, labelled synthetic).

  Every other value, including the five recordings' cell ranges, is unchanged, so the new `cellReply` picks the same reply as before on every committed recording.
- **Mutations**, each reverted (`cmp` against a backup):

  | Mutation | Result |
  |---|---|
  | "Resting" matched before "Charge done" | 1 failed |
  | Recovery or ELM-start lines → 1 | 1 failed |
  | "Charge log not started" → 5 | 1 failed |
  | The "NOT SAVED:" guard removed | 1 failed |
  | A hardcoded 5-minute rest label | 1 failed |
  | The Plug in step removed | 1 failed |
  | `codeList` without `module.stored` | 1 failed (C2's surviving mutant, now killed) |
  | `findReport` ignores `recording` | 1 failed (C2's surviving mutant, now killed) |
  | AVG taken without the same-reply check | 1 failed |
  | Old Capacity copy | 5 failed |

  PASS.
- `pnpm check`: PASS, exit 0 (core 239, battery 21, assist 142, mobile 329 = 324 + 5, relay 58, backend/intake/summary 42, Ruff, pytest 1). `pnpm -F mobile typecheck`: PASS. `eslint apps/mobile`: PASS.
- `expo export --platform android` into a scratch dir, deleted afterwards: PASS (`AppEntry-bf657e75….hbc`, 3.3 MB).
- Expo fingerprint `d66ba328b7116976e29d34d6aac3378c2be9ecaf`, equal to Stage B: PASS.
- **Existing artifacts:** PASS. Deleting them first was refused by this session's permission classifier, so each was overwritten by `pnpm check` instead, and its mtime confirms it was regenerated in that run. All match their recorded hashes on the first run:
  - codes `01d894f4…` (b and c1)
  - charge-log `fbb90c17…` (b and c1)
  - C2 intake `bfacfd43…`
  - `/tmp/t2.10d-mobile-flow.json` `4eb12fbc…` (no flake this time)
  - navigation `817aaefd…`: unchanged, because `navigation.ts` is untouched and C1 already tests the unlocked case (`back(checkStack, false)` pops)
  - the 41 `/tmp/t2.4-b1-*.jsonl` charge-logger artifacts, regenerated and identical to the pre-change copies. The four `probe-*` files are older and no current test writes them.

  The live==replay tests (13, Decision 17, 18, 22) pass unchanged.
- Logic freeze (spec path list against `5975608`): empty. PASS.
- Only the files listed above changed (`git status --short`): PASS.
- **Console fits or scrolls** (carried item 1): the page is a ScrollView, so every control, the command field, Send and both panes are reachable at any height. The panes are fixed-height, nested-scroll areas, because a flex pane has no height inside a scroll page. This is by construction; checking it on screen is owner step 2 below, NOT RUN.
- Phone and car: NOT RUN (no phone or car in this WSL2 session). Owner steps, on the Stage B dev client through Metro (`cd apps/mobile && pnpm start`):
  1. Car › Report history: the scan-history chart (or "Appears after your second check"), battery-check rows with date, time and scan status opening that report's summary, and the Charge logs empty-state sentence.
  2. The check screen on a 360 dp width (developer options, smallest width) at font scale 1.0 and 2.0, with Developer tools expanded: every button, both text fields, Send, and the report and transcript panes can be scrolled to; the panes scroll inside the page. Nothing is clipped under the status or nav bar.
  3. Run check → "Run battery check" is the only primary action. Log a charge → "Start charge log" is the only one. Developer tools start collapsed.
  4. System back on the check screen when idle returns to the Car. During a battery check, system back does nothing and the Back arrow is disabled. After the check saves, the report opens and back returns to the Car.
  5. A real charge log on the Equinox: one "Start charge log" tap, then the Charge log view shows the status hero, the timeline (Rest 10 min "Now", then Plug in, Charge, Rest 30 min), the note and Disconnect, and nothing else. Leave it to finish by itself: the timeline reaches Saved ("Done"), the final "Charge log stopped: …" line shows, and the file is in the capture folder.
  6. A second charge log, with Disconnect pressed during the rest: "Stopping the charge log after the current command…", then "Charge log stopped: disconnect pressed …". The timeline shows Rest 10 min "Logged", the other steps "Not reached", Saved "Done", and the foreground notification goes away. System back is blocked while it runs.
  7. The Codes screen for the discovery-style case (if available) reads "N modules answered; none answered a code read". Capacity's Source reads "Not measured; needs a completed charge log".
  8. Light and dark screenshots of History, the check screen (collapsed and expanded) and the Charge log view.

### Deviations

1. The console's back control is the top-bar arrow (`IconButton`, accessibility label "Back"), as on every other page, not a text button. The disable condition is unchanged.
2. `chargeStep` maps the one "Charge log stopped" line that saved nothing (log file not created, "NOT SAVED: …") to `undefined`, not Saved. A failed folder copy ("NOT SAVED to the capture folder …") still maps to Saved, because the log is kept in app storage, and the status hero says so.
3. `CHARGE_STEP_LABELS` is exported from `chargeSteps.ts` beyond §Interfaces, so the minutes derived from `PRE_REST_S`/`POST_REST_S` are pinned in the test and the artifact.
4. While a charge log runs, the check screen shows only the hero, timeline, note and Disconnect. The hidden controls are all disabled during a run, except the Ready switch and the command field, whose Send is disabled. After the run the timeline stays visible while the status line is the Saved line.
5. Each intent shows only its own primary action. The other one is reached through the Car's other button.
6. History rows show date and time (two checks can share a day) and no longer go through `batteryReportRows`, which rendered each full report as text.
7. The console reads `useTokens()` instead of `usePalette()`; the colours are the same values the palette map returned.
8. The Codes caption copy is in `SectionScreens.tsx`, which is outside the C3 file list. The brief's item 4 requires it.

### Questions for the orchestrator

1. Deviation 2: is a failed folder copy acceptable as "Saved" in the timeline (the log is in app storage, and the hero line says NOT SAVED to the folder), or should any "NOT SAVED" line stop short of Saved?
2. Deviation 5: should the check intent also offer the charge log (or the reverse) behind Developer tools, or is one action per intent final?
- 2026-09-28, orchestrator, on the C3 report:
  - Deviations 1–8 accepted. The /tmp delete was refused by permissions, and overwrite plus the mtime check was used instead; this is fine, and nothing should work around the block.
  - Q1: a failed folder copy still maps to **Saved**. The log is kept in private app storage and the folder copy is a convenience; the status line already names the failure.
  - Q2: one primary action per intent is final. The other action is one Back away on the Car screen.
  - Deviation 4 (controls hidden during a run) is safer: one command in flight.
  - Next: C3 reviewer.
- 2026-09-28, C3 reviewer: **REQUEST_CHANGES**.
  - Blocking (1): a console mounted after a run ended gets the replayed final line (Decision 21), so saved=true while reached is undefined. The timeline then shows steps 1–4 "Not reached" and Saved "Done", misrepresenting a completed log.
  - Minor:
    - (2) The Q1 folder-copy-failure → Saved rule is untested (the mutant `includes("NOT SAVED")` survives).
    - (3) cellReply pairs by adjacency, but buildBatteryDiagnosis resets at each AVG row including undecoded ones, so the two can diverge when all rows between replies fail to decode.
    - (4) setReached does not clamp, so the step could go backwards.
  - Verified clean: console handlers byte-identical, lock cannot stick, Disconnect visible, 41 t2.4 artifacts identical, C2 mutants killed, all artifacts identical, fingerprint unchanged.
- 2026-09-28, orchestrator: C3 repair round 1 of 2 (fresh implementer).
  - (1) Show per-step marks only when this console observed the run (`reached` known). Otherwise show the steps without claims ("Not observed on this screen" or none), with the saved hero line as is.
  - (2) Map case 11's statuses through stepTransitions and assert Saved.
  - (3) cellReply mirrors buildBatteryDiagnosis's pairing exactly: reset at each AVG row including undecoded ones. obd-battery stays frozen. Add a synthetic case with all-undecoded rows between replies.
  - (4) Clamp: the step is the max seen.
  - Every fix is tested first, with its mutant killed.

## Stage C3 repair round 1 implementer (Claude, 2026-09-28)

Base: the uncommitted C3 tree on HEAD `5975608`. Changed in this round: `apps/mobile/src/app/chargeSteps.ts`, `apps/mobile/src/screens/ConsoleScreen.tsx`, `apps/mobile/test/charge-logger.test.ts`, plus this record. `reportView.ts` and `report-view.test.ts` were not changed in this round (fix 3, below).

- **Fix 1 (blocking):** new pure `stepMarks(reached, saved)` in `chargeSteps.ts`. With `reached` undefined it returns no mark for any step, whether or not the log is saved. Otherwise it gives the C3 marks unchanged (saved: step 5 "done", reached steps "logged", the rest "not-reached"; running: "done", "now", or blank). The saved hero line is unchanged.
- **Fix 4:** new pure `reachedStep(previous, line)`. It keeps the furthest step 1–4 seen. Unmapped, Saved and lower lines keep the previous value.
- **Console lines changed** (`ConsoleScreen.tsx`, against the C3 tree):
  - l.20: the import adds `reachedStep`, `stepMarks`.
  - l.72–73: the comment, and the status effect is now `setReached((previous) => reachedStep(previous, status))`.
  - l.312–317: `stepView` now maps `stepMarks(reached, saved)` through a `MARK` table. Icons, colours and words are the same as C3's.

  No handler, ref or status string changed.
- **Fix 2:** case 11 now maps its statuses through `stepTransitions("copy-fails", …)` and asserts `[1, 5]`.

### Verification (C3 repair 1)

- **Tests first.** New assertions in `test/charge-logger.test.ts` (no new test cases, and no production change before they ran):
  - case 1: observed marks `logged×4, done`; the replayed final line alone gives no marks (fix 1); `reachedStep(reachedStep(undefined, <Charging line>), <rest line>) === 3` (fix 4), lines taken from the run's own statuses.
  - case 9: observed marks `logged, not-reached×3, done`; the replayed final line gives no marks.
  - case 11: `stepTransitions` gives `[1, 5]`.

  They failed before implementation (4 failed: `reachedStep`/`stepMarks` not exported). They pass after it (40/40).
- **Mutants** (each on `chargeSteps.ts`, restored from a backup, `cmp` clean):

  | Mutant | Result |
  |---|---|
  | fix 1: today's behaviour (`reached` undefined + saved → steps 1–4 "not-reached", 5 "done") | 2 failed |
  | fix 2: `line.includes("NOT SAVED")` | 1 failed (`[1]` vs `[1, 5]`) |
  | fix 4: no clamp (`step === 5 ? reached : step`) | 1 failed (1 vs 3) |

  PASS.
- **Charge-steps artifact:** `/tmp/x-redesign-charge-steps.json` changed from `26f39b22…` to `f475f03eb81e33a2bc7a2795668accb3817db18d57d3f7713e7b4f964590f7d1`. It is `cmp`-identical on a rerun. The change, checked against a saved copy of the `26f39b22…` file:
  - a new key `copy-fails` (fix 2);
  - two new fields on each run entry, `marks` and `replayedFinalMarks` (fixes 1 and 4).

  Every C3 field of `labels`, `happy`, `disconnect-recover`, `disconnect-give-up`, `stop-requested` and `console` is equal to before. PASS.
- `pnpm check`: PASS, exit 0 (core 239, battery 21, assist 142, mobile 329, relay 58, backend/intake/summary 42, Ruff, pytest 1). `pnpm -F mobile typecheck`: PASS. `eslint apps/mobile`: PASS.
- `expo export --platform android` into a scratchpad dir, removed afterwards: PASS (`AppEntry-4af8868d….hbc`, 3.3 MB).
- Fingerprint `d66ba328b7116976e29d34d6aac3378c2be9ecaf`: PASS.
- **Artifacts**, all overwritten by `pnpm check` (mtimes 05:15–05:17, after the 05:14:34 start), nothing deleted:
  - The 45 `/tmp/t2.4-b1-*` files (41 plus 4 probes) are sha256-identical to the snapshot taken before the run, and again after a second charge-logger run.
  - `fbb90c17…` (b, c1), `01d894f4…` (b, c1), `bfacfd43…`, `4eb12fbc…` (no flake), `817aaefd…`, and report-view `cdae2bf6…` (unchanged; fix 3 not applied): PASS.
- **Fix 3: NOT DONE. The plan cannot be carried out as written.**
  - `cellReply` only sees `BatteryDiagnosisReport`, and `buildBatteryDiagnosis` drops every undecoded reading from `report.signals` (`packages/obd-battery/src/report.ts:71`). An undecoded AVG row therefore leaves no trace in the report, and no function of the report can reset on it.
  - Shown with the real `buildBatteryDiagnosis` (scratch script, not committed):
    - Input X: reply 1 = AVG 3.90, MIN 3.89, MAX undecoded; reply 2 = AVG and MIN undecoded, MAX 3.91; reply 3 = 3.91 / 3.90 / 3.92.
    - Input Y: reply 1 = 3.90 / 3.89 / 3.91; reply 2 = 3.91 / 3.90 / 3.92.
    - Both give **byte-identical reports** (`JSON.stringify` equal, spread `0.020000000000000018`). But the builder's pair is reply 3 (3.90 / 3.91 / 3.92) for X and reply 1 (3.89 / 3.90 / 3.91) for Y.
    - So any `cellReply(report)` is wrong for one of them, and the requested synthetic case has no single right answer to assert.
  - Options for the orchestrator:
    - (a) Unfreeze obd-battery so the report records the chosen reply (for example, the AVG and the MIN/MAX values or indices in `cellSpread`). This is a schema change.
    - (b) Show only the spread, with no Lowest/Average/Highest readings and no range strip.
    - (c) Accept a best effort. For example, C3's adjacency, or C2's exact `max − min === volts` check. Either one stays ambiguous in the case above and needs an owner/orchestrator waiver of "exactly".
- Phone and car: NOT RUN (no phone or car in this session). C3 owner steps 5 and 6 still apply. Add: open the check screen after a charge log has finished while the console was unmounted. The timeline shows the five steps with no Done/Logged/Not reached marks, and the hero shows the saved line.
- 2026-09-28, orchestrator, on C3 repair round 1: fixes 1, 2 and 4 PASS. Fix 3's "mirror exactly" is impossible while obd-battery is frozen: undecoded rows are dropped, so two different input sets give byte-identical reports. Decision: option (c) plus an honesty guard. Draw the range strip only for a same-reply, fully decoded triple whose max − min equals the report's spread; otherwise show the spread only. The obd-battery follow-up is added to the deferred list. Same implementer continues, within round 1.

### C3 repair 1 addendum: fix 3 per the orchestrator's ruling, option (c) plus a guard (Claude, 2026-09-28)

Changed in addition: `apps/mobile/src/app/reportView.ts`, `apps/mobile/test/report-view.test.ts`. obd-battery is untouched (`git diff -- packages` is empty).

- **`cellReply`** keeps C3's adjacency pick: the first MIN directly followed by a MAX from the same ECU. It now returns the triple only when both of these hold:
  - the AVG directly before that MIN is decoded and from the same ECU;
  - `max − min === cellSpread.volts`.

  Otherwise it returns undefined, and the Cells detail shows the spread alone: readings `[Spread]`, no range strip, no Lowest/Average/Highest rows. The source line now comes from `cellSpread`'s own min/max sources, so a spread-only detail does not say "Not read in this check".
- **"Unambiguous by that rule"** is read as "the first adjacent pick", which is unique by construction. A stricter rule, one exactly-matching triple in the whole report, would drop discovery-targeted's strip, which the ruling requires to stay. Its reply at signals 73–75 (MIN 4.0760, MAX 4.0787) gives exactly the same float spread (`0.002700000000000813`) as the builder's pick (4.0764 / 4.0791).
- **Tests first:**
  - C3's partial-decode case (reply 2's AVG undecoded) now expects spread-only.
  - New synthetic case `derived-undecoded-between-replies`, derived from discovery-targeted: reply 1's MAX, the 22 2B43 read after it, and reply 2's AVG and MIN are dropped, so every row between MIN 1 and MAX 2 is undecoded. The report's spread is reply 3's, as the builder resets. The adjacency pick (MIN 1, MAX 2) does not give that spread, so the detail must show spread-only.
  - The first draft of this case dropped only the three 2AF5 rows. It passed on C3's code because the 2B43 SoC reading sat between the replies, so the adjacency pick was already reply 3. The case was corrected to drop every row between MIN 1 and MAX 2 before the implementation was accepted.
  - Against C3's `cellReply`, both cases fail (2 failed). C3 showed MIN 1 with MAX 2 (`minMv 4076.3 … maxMv 4079`).
- **Mutants** (each restored, `cmp` clean): PASS.

  | Mutant | Result |
  |---|---|
  | No spread check | 1 failed |
  | No AVG check | 1 failed |
  | Whole guard dropped | 2 failed |
- **Report-view artifact:** `/tmp/x-redesign-report-view.json` changed from `cdae2bf6…` to `f533bbe63875c952ac278db31bacb53fe7fdb2898962063b29d29a31df07d376`, `cmp`-identical on a rerun. A key-by-key diff against the `cdae2bf6…` copy shows two changes:
  - the new key `synthetic/derived-undecoded-between-replies`;
  - `synthetic/derived-partial-2af5.cells.readings` went from Lowest/Highest/Spread to Spread only.

  Every other value is unchanged. That includes the three recordings' cell ranges and readings (spike, spike-2 and discovery keep their strips) and the two phone-console recordings (not read). PASS.
- `pnpm check`: PASS, exit 0 (mobile 330). The first run failed lint on two non-null assertions in the new test lines; they were replaced by local values. `pnpm -F mobile typecheck`: PASS.
- `expo export --platform android` into the scratchpad, removed afterwards: PASS (`AppEntry-81d23e22….hbc`).
- Fingerprint `d66ba328b7116976e29d34d6aac3378c2be9ecaf`: PASS.
- **Artifacts:** PASS. All 45 `/tmp/t2.4-b1-*` files were rewritten in this run (none older than the 05:24:45 start) and are sha256-identical to the snapshot. `fbb90c17…`, `01d894f4…`, `bfacfd43…`, `4eb12fbc…` and `817aaefd…` match. Charge steps are `f475f03e…`, as explained above.
- **Not done / follow-up:**
  - The report cannot identify the reply `buildBatteryDiagnosis` chose once undecoded rows are dropped. Two different sets of 2AF5 readings give byte-identical reports with different chosen replies (shown above).
  - So the guard still shows a triple when the first adjacent pick crosses a hidden reset and happens to give the same spread. In that case the numbers are internally consistent, but they may belong to a different reply than the builder's.
  - Follow-up spec idea (orchestrator's deferred list): obd-battery records the chosen reply in `cellSpread` (its AVG, and MIN/MAX values), and `cellReply` reads it instead of searching.
- 2026-09-28, orchestrator: C3 repair round 1 complete. Both readings accepted: the spread-only detail shows Spread as a reading row sourced from `cellSpread`; "unambiguous" means the first adjacent pick (strict uniqueness would drop discovery-targeted's real strip on a float-equal spread). Next: C3 re-review.
- 2026-09-28, C3 re-reviewer (round 1): **APPROVE**.
  - Reproduced: pnpm check PASS (mobile 330). Fixes 1–4 pass, and the reviewer's mutants are killed. Console lines 75–307 are untouched against HEAD. Hash changes are explained byte for byte (`f475f03e…`, `f533bbe6…`). All 45 t2.4 files are identical. Other artifacts are identical. Fingerprint `d66ba328…`. `packages/` diff empty.
  - Findings:
    - (1) The cellReply comment overstated the guarantee. The orchestrator added the residual clause (comment-only; typecheck and lint re-run).
    - (2) The same-ECU conditions on MAX and AVG are untested. Harmless today, because 2AF5 is read only from ECU CB and the spread check bounds it. This is noted for the obd-battery follow-up.
- C3 closed and committed by path.
