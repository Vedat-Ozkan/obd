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

- Stage A phone checks (a)–(f) (see the Stage A reviewer entry).
- Optional, before the EAS build: `cd apps/mobile && pnpm exec expo install expo expo-modules-core expo-sharing` (patch bumps flagged by `expo install --check`), so one build covers them. The orchestrator can do this on request.
- EAS dev-client build for Stage B's native change (fingerprint `d66ba328…`): `cd apps/mobile && pnpm dlx eas-cli@24.7.0 build --profile development --platform android`, then install it.
- Stage B phone checks 2–6 in the Stage B report (light and dark screenshots, safe areas with gesture and 3-button nav, fonts, portrait lock). They can run once, after all C stages, together with the Stage D matrix.

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
