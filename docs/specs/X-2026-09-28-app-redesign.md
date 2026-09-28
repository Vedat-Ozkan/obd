# X-2026-09-28-app-redesign: mobile app redesign to the owner-approved mockups

## Goal

Replace the mobile app's single 704-line `apps/mobile/App.tsx` debug-style UI with the owner-approved design "D · Combined". The visual reference is the owner's claude.ai design canvas, https://claude.ai/artifact/SD23eYAzDCTT8aMM9sn352. Agents cannot open it; §Design below restates everything from it that binds this task, and that restatement is authoritative. When the task is done, a user on an Android phone sees the nine screens in §Screens, with Material 3 structure, the matte tokens, Manrope and JetBrains Mono type, correct safe areas in light and dark, and working system back. Ratings follow the owner's rules, and every rating names what backs it. Every scan, capture, charge log, upload, consent and storage path behaves byte-for-byte as it does today. Test-visible outcomes: the existing 304 mobile tests and their artifacts are unchanged; new E2E artifacts show what the report screens display for every committed Equinox recording and what the charge-log timeline shows for every status line the logger emits; and an owner screenshot matrix is PASS on the phone.

## Non-goals

- Any change to data, recording, capture, scan, charge-log, upload, scrub, consent-record or vehicle logic. The files in §Verification "logic freeze" must show an empty diff. No new status strings in logic files. No new vehicle command.
- Changing the wording of `CONSENT_TEXT` or `PRIVACY_NOTE`, or the `beta-1` pin. That is the owner's pending item, blocked on the contact email (`docs/task-runs/T2.9.md`, owner quotes).
- Rating thresholds for cell balance, capacity or 12 V. Each gets its own spec later. `Great` exists as a chip value, but no rule in this task produces it.
- T2.10d's summary UI and its D2 rewarded-ad work. This task only hosts the component on a route (§Sequencing).
- A per-car charge-log index, auto-connect to a known dongle, a relay-mode screen, PDF or share export (ADR-018), app icon or splash, localisation, landscape or tablet layouts, an iOS build.
- A navigation library (react-navigation, expo-router). A route stack in plain state is enough for this app.
- `react-native-svg`. Both charts are drawn with `View`s.

## Design (binding; restates the owner's canvas decisions of 2026-09-27/28)

**Direction.** Material 3 structure with matte colours. The hero is a monospaced number over a charge bar. Lists are rows with dividers and generous spacing. Summary pages show little detail; each detail sits behind a tap.

**Tokens** (light / dark):

| Token | Light | Dark | | Token | Light | Dark |
|---|---|---|---|---|---|---|
| bg | `#F2F4F1` | `#1C211E` | | muted | `#5C6660` | `#A3ADA7` |
| surface | `#FAFBF9` | `#242A26` | | outline | `#CFD6D1` | `#3C4540` |
| container | `#DFE7E1` | `#2E3A34` | | divider | `#E7EBE8` | `#2F3632` |
| onContainer | `#24302A` | `#D4DED8` | | accent | `#4E7D6A` | `#8DB5A2` |
| containerMuted | `#4C5B53` | `#A8B7AE` | | onAccent | `#FFFFFF` | `#17251E` |
| track | `#C6D3CA` | `#3C4B43` | | chart data | `#1E8060` | `#3FA884` |
| text | `#2A302C` | `#D6DCD8` | | chart highlight | `#C2702A` | **not validated** (Stage B) |

Provenance tags, bg/fg: verified `#EDF2EE`/`#3F6A58` (dark `#2B3A33`/`#A9CCBA`); community `#F2EBDF`/`#735623` (dark `#3A3427`/`#D6BE90`); neutral `#EEF1EE`/`#4F5853` (dark `#2C322E`/`#B9C2BC`). Signal tier `verified` maps to verified, `community` to community, and anything else (derived, not read) to neutral.

Rating chips, fg/bg. A chip always pairs an icon with a word, never colour alone. Good `#2E7D4F`/`#E4EFE7` (dark `#3A9C80`/`#25372E`). OK `#A8841A`/`#F4EEDA` (dark `#B08B24`/`#3A3427`). Poor `#BF3B3B`/`#F6E3E1` (dark `#D65A7A`/`#3D2A30`). Not rated `#5C6660`/`#EEF1EE` (dark `#A3ADA7`/`#2C322E`). Great uses Good's colours with a different icon. Proposed MaterialCommunityIcons glyphs, which the owner confirms in the Stage C screenshots: Great `star-circle`, Good `check-circle`, OK `alert-circle-outline`, Poor `close-circle`, Not rated `minus-circle-outline`. The implementer confirms each name exists in the installed glyph map.

**Type.** Manrope 500–800 everywhere; JetBrains Mono 600 for hero numbers only. h1 28–30/700. Section label 13/700, uppercase, 0.06em tracking. Row label 16/600. Body 15, line height 1.5. Caption 12–13.

**Spacing and shape.** Side margin 16 dp plus the safe-area insets. 14 dp between blocks. List rows at least 60 dp (56 in dense lists). Touch targets at least 48 dp. Corner radii: cards 24, hero 28, buttons 16. Buttons are 52–56 high.

**Rating rules.** A rating is one of Great, Good, OK, Poor or Not rated. It appears only when a cited standard or a named project policy backs it, and the rating card names which. State of charge is never rated and shows no chip. Diagnostic codes are OK when no module reports a code but the recently-cleared check is unknown, and Good only when that check answers no (`verdict: "not-indicated"`). The remaining codes cases are open question 1. Cell balance, capacity and 12 V are Not rated, with the basis "No threshold yet".

**Platform.** Android is the target, per ADR-001 and the proposed ADR in open question 6. The design follows Material 3, Android's edge-to-edge guide and Android Core app quality. Insets come from `react-native-safe-area-context` (status bar and cutout at the top; gesture or 3-button nav at the bottom). The status-bar style follows the active theme. The app is locked to portrait. Where the platforms differ, follow the HIG. Platform-only APIs sit behind small interfaces: the folder picker is already behind `SaveTargets & StreamTargets` (`phoneTargets`), and Stage A adds `foregroundService`.

## Screens

1. **Garage.** Top app bar "Garage" with a settings gear. Rows: car icon, "`<year> <make> <model>`", a Mine/Checking tag (`ownership` `mine`/`checked`), chevron. An "Add a vehicle" row. Nothing else: the interest form, saved interests and the privacy notice move to Add a vehicle, and beta sharing moves to Settings.
2. **Car.** SoC hero with the last-check date; tapping it opens the latest report's summary. With no report, the hero shows "No check yet" and does nothing on tap. **Run check** (primary) and **Log a charge** (tonal) both open the check screen (open question 3). For a catalog vehicle where `canUseEquinoxConsole` is false, both are disabled and show `vehicleAvailability`. List rows: Report history (count) and Ownership (a Mine/Checking choice dialog that calls the existing `changeOwnership`). **Remove from garage** is a low-key destructive text button with a confirmation dialog, then the existing `removeGarageVehicleWithReports`; its existing refusal message is shown unchanged.
3. **Report summary.** SoC hero, then four rows in fixed order: Cell balance, Capacity, 12 V battery, Diagnostic codes. Each row shows label, value, rating chip and chevron. One primary button, "Run a new check", opens the check screen. Under `__DEV__` only, one extra row "AI summary (development)" opens the T2.10d route.
4. **Section detail** (State of charge, Cell balance, Capacity, 12 V). Hero with a provenance tag, rating card (with the basis named; none for SoC), readings list, "What this means", source, and a CTA where relevant: Capacity has **Log a charge**. Charts: chart 4, the cell range strip (min/avg/max on a mV axis), sits in the Cell balance hero. Chart 2, scan history (one SoC dot per check; below two checks it shows an honest empty state, "Appears after your second check"), sits on State of charge and History. The latest dot is also marked by size and a label, so it never depends on the highlight colour alone. "What this means" uses the report's own reason strings (`capacity.reason`, `health.reason`, `twelveVolt.reason`) plus at most two sentences of fixed copy per section, stating only what ADR-018 §Evidence and limits and the cited sources support.
5. **Codes.** A summary container and a rating card. An expandable "Recently cleared?" card shows the four legs (`noStoredDtcs`, `monitorsIncomplete`, `countersLow`, `permanentDtcs`), labelled as in `renderCodesReport`, with the project-policy thresholds from `LOW_COUNTER`. A modules list: tapping a module opens module detail with its per-mode rows (stored 03, pending 07, permanent 0A, readiness, PIDs 21/30/31/4D/4E, freeze frame), each as the module reported it.
6. **History.** Chart 2, then the battery checks list (date, scan status, chevron to Report summary), then Charge logs with an empty state (open question 4).
7. **Settings.** Groups: **Data**, with Beta data sharing › and Save folder ›. **Display**, with Theme › (System default / Light / Dark). **About**, with Version (`app.json` `expo.version`), Privacy note › and Open-source licenses ›. The current value sits on the right of each row, and sub-pages get a chevron. The Beta sub-page has the switch, the status line (`beta.line`), the Beta ID, `betaMessage`, and **Delete my data**, set apart in destructive red with the existing confirmation. Switching on opens the consent screen; switching off decides at once (unchanged T2.9 behaviour). Save folder shows the remembered folder's display name, or "Not chosen", and offers "Choose again at next save", which calls the existing `phoneTargets.forgetFolder()`. Licenses lists every runtime dependency with its license, plus the OBDb CC-BY-SA-4.0 attribution (ADR-010). The theme choice persists in a private `theme.txt` under `Paths.document`.
8. **Consent.** `CONSENT_TITLE`, `beta.line`, and the intro paragraph of `CONSENT_TEXT`. Then six expandable sections (what is sent, what is removed first, how it's labeled, why, how long, your control), each with the verbatim pinned text of its paragraph (open question 5). The switch is off by default and resets on every appearance (the existing effect is kept). Then Continue.
9. **Charge log** (the check screen while `chargeLogging`). A status hero shows the existing status line from `chargeRun.mount`, and a 5-step timeline: Rest 10 min, Plug in, Charge, Rest 30 min, Saved. The minutes are derived from `PRE_REST_S`/`POST_REST_S`. There is no start or stop button on this screen. A note says it stops and saves by itself, and that Disconnect stops it early. The existing Disconnect button keeps its current behaviour.

**Check screen** (no mockup; open question 3). The existing console, restyled: status hero, device rows (Scan, then tap to connect), a "Vehicle Ready and in Park" switch, one primary action per intent ("Run battery check", or "Start charge log" for the Log a charge intent), Cancel while a diagnosis runs, Disconnect, and the 12 V unplug note as a card. Run capture, Run codes report, the note field, Send and the transcript go in a collapsed "Developer tools" card. Every enable/disable condition is unchanged.

## Interfaces

All new modules are pure `.ts` except the screen, kit and chart `.tsx` files.

```ts
// src/ui/theme.ts
export type Scheme = "light" | "dark";
export type Rating = "great" | "good" | "ok" | "poor" | "not-rated";
export interface Tokens {
  bg: string; surface: string; container: string; onContainer: string; containerMuted: string; track: string;
  text: string; muted: string; outline: string; divider: string; accent: string; onAccent: string;
  tag: Record<"verified" | "community" | "neutral", { bg: string; fg: string }>;
  rating: Record<Rating, { fg: string; bg: string }>;
  chart: { data: string; highlight?: string }; // dark highlight stays undefined until validated
}
export const TOKENS: Record<Scheme, Tokens>;
export function paperTheme(scheme: Scheme): MD3Theme;         // Stage B
export function useTokens(): Tokens;                          // Stage B; honours the Settings override from C4
export function usePalette(): LegacyPalette;                  // Stage A: today's palettes; B maps them onto tokens; deleted in C4

// src/app/navigation.ts (C1)
export type Route =
  | { name: "garage" } | { name: "addVehicle" } | { name: "interest"; saved?: Interest }
  | { name: "car"; entryId: string } | { name: "check"; entryId: string; intent: "check" | "charge" }
  | { name: "history"; entryId: string } | { name: "report"; entryId: string; scannedAt: string; recording: string }
  | { name: "section"; entryId: string; scannedAt: string; recording: string; section: "soc" | "cells" | "capacity" | "twelveVolt" }
  | { name: "codes" | "aiSummary"; entryId: string; scannedAt: string; recording: string }
  | { name: "module"; entryId: string; scannedAt: string; recording: string; ecu: string }
  | { name: "settings" | "beta" | "theme" | "saveFolder" | "privacy" | "licenses" };
/** System back. `locked` is true while the check screen runs a diagnosis or a charge log. */
export function back(stack: readonly Route[], locked: boolean): readonly Route[] | "blocked" | "exit";

// src/app/reportView.ts (C1 creates socHero; C2 adds the rest)
export interface RatingView { rating: Rating; basis: string }
export function socHero(report: BatteryDiagnosisReport): { percent: number; tier: "verified" | "community"; scannedAt: string } | undefined;
export function reportSummary(report: BatteryDiagnosisReport): { soc: ReturnType<typeof socHero>; rows: readonly { section: "cells" | "capacity" | "twelveVolt" | "codes"; label: string; value: string; rating: RatingView }[] };
export function sectionDetail(report: BatteryDiagnosisReport, section: "soc" | "cells" | "capacity" | "twelveVolt"): {
  hero: { value: string; unit?: string; tag: "verified" | "community" | "neutral" }; rating?: RatingView;
  readings: readonly { label: string; value: string; tier?: "verified" | "community" }[]; meaning: string; source: string;
  cellRange?: { minMv: number; avgMv: number; maxMv: number };
};
export function codesView(codes: CodesReport): { rating: RatingView; codeCount: number; legs: readonly { label: string; result: Tri }[]; thresholds: typeof LOW_COUNTER; modules: readonly { ecu: string; summary: string }[] };
export function historyPoints(reports: readonly BatteryDiagnosisReport[]): readonly { scannedAt: string; percent: number }[];

// src/app/chargeSteps.ts (C3)
/** 1 Rest 10 min … 5 Saved; undefined keeps the previous step (retry, recovery, starting lines). */
export function chargeStep(line: string): 1 | 2 | 3 | 4 | 5 | undefined;

// src/ui/text.ts (C4)
export function consentSections(text: string): { intro: string; sections: readonly { title: string; body: string }[] };
export function noteBlocks(text: string): readonly { kind: "heading" | "para" | "bullet"; spans: readonly { text: string; bold?: boolean; italic?: boolean }[] }[];

// src/app/runtime.ts (Stage A: moved verbatim from App.tsx, plus:)
export const foregroundService: { start(task: () => Promise<void>): Promise<void>; update(text: string): Promise<void>; stop(): Promise<void> };
// C4 adds: loadThemePreference(): Promise<"system" | "light" | "dark">; saveThemePreference(p): void; folderLabel(): Promise<string | undefined>

// packages/obd-core/src/report/replay.ts (C2), before → after
export type { CodesReport } from "./codes.js";
// → export type { CodesReport, Tri } from "./codes.js"; export { LOW_COUNTER } from "./codes.js";
```

## Files

Each stage is one implementer session with at most ten files. Paths are under `apps/mobile/` unless stated otherwise.

**Stage A: behaviour-preserving split (no visible change, no native change)**
- `App.tsx`: modify. Keeps only the root: loading gates, consent gate, the view switch.
- `src/app/runtime.ts`: create. Moved verbatim: the module singletons (`garageFlow`, `batteryHistory`, `equinoxSignals`, `phoneTargets`, `deferredShare` with its `AppState` listener, `chargeRun`, `betaOutbox`, `queueForBeta`), plus `localDate`, `requestBlePermission` and constants. Adds `foregroundService`, with the same `BackgroundService` arguments.
- `src/ui/theme.ts`: create. Today's `palettes` and `usePalette()`.
- `src/ui/kit.tsx`: create. `Screen`, `Card`, `Button`, `Text`, rendering exactly as today (RN `Button` with the palette colour). The rest of the kit arrives in the stage that first uses it (rule 10: Stage A cannot show new components).
- `src/screens/GarageScreen.tsx`: create. Garage list, interests and the beta card, as today.
- `src/screens/AddVehicleScreen.tsx`: create. Picker and interest form.
- `src/screens/ConsoleScreen.tsx`: create. `EquinoxConsole`, logic verbatim.
- `src/screens/ReportScreens.tsx`: create. The history and detail views.
- `src/screens/ConsentScreen.tsx`: create.
- `src/screens/DevelopmentSummary.tsx`: create. T2.10d's component, moved verbatim; T2.10d owns it from then on.

**Stage B: tokens, Paper theme, safe areas, fonts**
- `package.json`, `../../pnpm-lock.yaml`: modify. The dependencies below.
- `app.json`: modify. Adds `"orientation": "portrait"` and `"userInterfaceStyle": "automatic"`.
- `App.tsx`: modify. `SafeAreaProvider`, `PaperProvider`, `useFonts`, and an RN `StatusBar` whose style follows the scheme.
- `src/ui/theme.ts`: modify. `TOKENS`, `paperTheme`, `useTokens`; `usePalette` becomes a map from the old keys onto tokens.
- `src/ui/kit.tsx`: modify. Paper-based `Button`/`Card`/`Text` with the type scale; `Screen` applies the insets and the 16 dp margin.

**Stage C1: navigation, Garage, Car, Add a vehicle, Settings (Beta and Privacy only)**
- `App.tsx` (route stack, `BackHandler`, consent gate over the stack), `src/app/navigation.ts` (create), `src/ui/kit.tsx` (+`ListRow`, `SectionLabel`, `Hero`), `src/screens/GarageScreen.tsx`, `src/screens/CarScreen.tsx` (create), `src/screens/AddVehicleScreen.tsx`, `src/screens/SettingsScreens.tsx` (create), `src/app/reportView.ts` (create, `socHero`), `test/redesign-navigation.test.ts` (create).

**Stage C2: Report summary, section details, Codes, charts**
- `src/app/reportView.ts`, `src/screens/ReportScreens.tsx` (summary replaces detail), `src/screens/SectionScreens.tsx` (create: section, codes, module), `src/ui/charts.tsx` (create: `ScanHistory`, `CellRangeStrip`), `src/ui/kit.tsx` (+`Chip`), `App.tsx` (routes, including `aiSummary` hosting `DevelopmentSummary` unchanged), `packages/obd-core/src/report/replay.ts` (re-exports only), `test/report-view.test.ts` (create).

**Stage C3: History, check screen, Charge log**
- `src/screens/ReportScreens.tsx` (History), `src/screens/ConsoleScreen.tsx` (presentation only: JSX and styles; no handler or ref edits), `src/app/chargeSteps.ts` (create), `test/charge-logger.test.ts` (append the step mapping to existing cases), `App.tsx`.

**Stage C4: Settings completion, Consent**
- `src/screens/SettingsScreens.tsx` (Theme, Save folder, Version, Licenses, formatted Privacy note), `src/app/runtime.ts` (theme preference file, `folderLabel`), `src/ui/theme.ts` (override; delete `usePalette`), `App.tsx`, `src/screens/ConsentScreen.tsx`, `src/ui/text.ts` (create), `src/app/licenses.ts` (create), `test/redesign-text.test.ts` (create).

**Stage D: hardware verification.** No source files. Evidence goes to `docs/task-runs/X-2026-09-28-app-redesign.md`.

**New dependencies** (AGENTS.md rule 7). Versions were read on 2026-09-28 from npm and from `apps/mobile/node_modules/expo/bundledNativeModules.json` (Expo 57.0.24 installed, RN 0.86.3). Install with `pnpm -F mobile exec expo install <pkg>` so the SDK pins apply:

| Package | Version | License | Why / compatibility |
|---|---|---|---|
| `react-native-paper` | 5.15.3 (latest stable, 2026-05-26; `6.0.0-alpha.0` not used) | MIT | M3 components and theming. Pure JS; peers `react`, `react-native`, `react-native-safe-area-context` are all `*`. RN 0.86 support is not declared, so Stage B's `expo export` and phone run are the check. |
| `react-native-safe-area-context` | ~5.7.0 (SDK 57 pin; npm latest is 5.10.0) | MIT | Insets; Paper peer. **Native.** |
| `@expo/vector-icons` | ^15.0.2 (SDK 57 pin; npm 15.1.1) | MIT | Paper's icon source and the row and chip glyphs. The implementer confirms Paper's icon resolution in the installed Paper source. |
| `expo-font` | ~57.0.4 (already installed through `expo`) | MIT | `useFonts`; declared because the app now imports it. |
| `@expo-google-fonts/manrope` | 0.4.2 | MIT AND OFL-1.1 | Manrope 500/600/700/800 only. |
| `@expo-google-fonts/jetbrains-mono` | 0.4.1 | MIT AND OFL-1.1 | JetBrains Mono 600 only. |
| `expo-system-ui` | ~57.0.4, **conditional** | MIT | Only if Expo's color-themes guide (read in Stage B) says Android needs it for `userInterfaceStyle` at SDK 57. |

**EAS dev client.** Stage A needs no rebuild: the `@expo/fingerprint` hash is unchanged and Metro serves the JS onto the installed client. Stage B needs a new EAS development build, because of `react-native-safe-area-context` (native) and the `app.json` changes; this is an owner step. C1–C4 need none, and each stage's fingerprint must equal Stage B's. If T2.10d D2's native dependencies land near Stage B, one rebuild can cover both.

## Sources

| Constant / behavior | Source |
|---|---|
| Tokens, type, spacing, radii, rating colours, rating rules, screens | Owner decisions 2026-09-27/28 (this spec §Design) and the canvas https://claude.ai/artifact/SD23eYAzDCTT8aMM9sn352 |
| SoC signals `EQUINOXEV_SOC` (22 2B43) and `EQUINOXEV_SOC_HD` (22 27C6), `verified` | `docs/specs/T2.2a-equinox-soc-evidence.md`; `packages/obd-battery/test/battery-diagnosis-spike.md` |
| Cell MIN/AVG/MAX (22 2AF5, `community`), same-reply pairing | `packages/obd-battery/src/report.ts` `buildBatteryDiagnosis`; T2.2b §Non-goals (stays community) |
| 12 V value is the ATRV adapter supply, not a battery test | `docs/ELM327.md` §Init sequence (ATRV); `twelveVolt.reason`; `docs/specs/T2.5a-twelve-volt-observation.md` |
| Codes modes 03/07/0A, readiness, PIDs 21/30/31/4D/4E | `docs/ELM327.md` §Standard modes used, §Mode 01 PIDs |
| Recently-cleared legs and `LOW_COUNTER` (project policy, not a standard) | `packages/obd-core/src/report/codes.ts:65`, `render.ts` `renderCodesReport`; `docs/specs/T0.7-codes-report.md` |
| Charge-log steps; 10 and 30 min | `PRE_REST_S`/`POST_REST_S` in `packages/obd-battery/src/session.ts:35-36`; status lines in `apps/mobile/src/chargeLogger.ts` (`update`, lines 169–173; recovery lines 217, 229, 258; final 275) and the console's own lines |
| Capacity NOT MEASURED; health not assessed | `report.ts` reasons; ADR-018 |
| Consent and privacy text | `apps/mobile/src/beta/consent.ts` (pinned by `test/beta-consent.test.ts`) |
| Platform rules | https://m3.material.io/ ; https://developer.android.com/design/ui/mobile/guides/layout-and-content/edge-to-edge ; https://developer.android.com/docs/quality-guidelines/core-app-quality ; Expo safe-areas doc; https://developer.apple.com/design/human-interface-guidelines/ |
| Library versions and licenses | npm registry and `bundledNativeModules.json`, read 2026-09-28 (table above) |

No new PID, AT command, header or DTC decode is introduced.

## Verification

**Shared by every stage:**
- [ ] `pnpm check` green, and `pnpm -F mobile test` passes (baseline 304 on 2026-09-28 at `78cd7d6`, plus the stage's new tests).
- [ ] `cd apps/mobile && pnpm exec expo export --platform android` bundles.
- [ ] Existing artifacts regenerate byte-identical: the T2.9 codes E2E `01d894f4…` and charge-log E2E `fbb90c17…` (scrubVersion 2, after X-2026-09-27-power-state-meta), the C2 intake log `bfacfd43…` (`docs/task-runs/T2.9.md`), and `/tmp/t2.10d-mobile-flow.json` at its current recorded SHA-256 (`docs/task-runs/T2.10.md`).
- [ ] **Logic freeze:** `git diff --stat <stage base> -- apps/mobile/src/{beta,ble,garage}/ apps/mobile/src/{batteryDiagnosisFlow,batteryReports,batteryReportsDocumentStore,batteryScan,capture,chargeLogger,chargeRun,codesScan,console,recording,runFiles,summaryAccess,summaryFlow}.ts packages/obd-battery packages/obd-core/src` is empty. C2's re-export line in `replay.ts` is the one allowed exception.
- [ ] `pnpm -F mobile exec fingerprint fingerprint:generate` hash: A equals the pre-A baseline, C1–C4 equal B's. A mismatch is FAIL unless the spec lists it.
- [ ] Only the stage's listed files change (`git status --short` against the recorded baseline).

**Stage A:**
- [ ] The reviewer confirms the move with `git diff --color-moved=zebra`. Every non-import line of the old `App.tsx` appears unchanged in one new file. The allowed edits are `palettes[...]` → `usePalette()`, RN `Button`/`Text` → the kit, the three `BackgroundService` calls → `foregroundService`, and props passed between files.
- [ ] Phone, on the existing dev client through Metro (owner): an identical-state before/after screenshot pair for Garage, Add vehicle, console, history and detail, compared visually. Then T2.9 Stage D owner steps 1–4 and 6 (`docs/specs/T2.9-beta-data-upload.md` §Stage D), which are still pending, so this is their first run, on this build. Plus one battery diagnosis that opens its saved detail, and one charge-log start and Disconnect. PASS/FAIL/NOT RUN per step in the record. Car and phone are required; without them each step is NOT RUN.

**Stage B:**
- [ ] `pnpm -F mobile exec expo install --check` reports no SDK-incompatible versions.
- [ ] Before and after screenshots of the current build show whether content already draws under the status bar. After B, no screen's content sits under the status bar, cutout or nav bar, with gesture or 3-button nav.
- [ ] **Colour validation:** the owner's dataviz validator runs on the dark chart pair (`#3FA884` and a proposed dark highlight step) against dark `bg`/`surface`, and on the dark chip and tag pairs. The dark highlight token stays `undefined` until the validator passes; the output is recorded. Prerequisite: open question 9.
- [ ] Owner: a new EAS dev build installs and launches, and the fonts render (a hero number in JetBrains Mono, body text in Manrope).

**Stages C1–C4: E2E and isolated tests.** There is no `App.tsx` test harness, and none is added. Every rule lives in a pure module; JSX layout is screenshot-only.
- [ ] **E2E (C2), `test/report-view.test.ts`.** The five committed Equinox `*.redacted.jsonl` recordings go through `batteryDiagnosisFromRecording` (the public report builder) and then `reportSummary`, `sectionDetail` (all four sections), `codesView` and `historyPoints`. The four synthetic codes fixtures (`fixtures/synthetic/codes-{cleared,conflict,permanent,stored}.jsonl`, labelled synthetic) go through `codesReportFromRecording` and then `codesView`. The artifact is `/tmp/x-redesign-report-view.json`, and two runs are byte-identical. It asserts SoC has no rating; cells, capacity and 12 V are `not-rated` with basis "No threshold yet"; codes follow §Rating rules and the Q1 answer; for each recording, `cellRange.maxMv − minMv` equals `cellSpread.volts × 1000`, with `min ≤ avg ≤ max`; `historyPoints` over the two spike reports gives two points in date order, and over one report gives one point (the empty state).
- [ ] **E2E (C3), `test/charge-logger.test.ts`.** For the happy path (case 1), reconnect (case 5) and Disconnect (case 9), every `statuses` line is mapped through `chargeStep`. The resulting step sequence never decreases, and the happy path reaches 1→2→3→4. The console's own lines ("Starting the charge log…", "Stopping the charge log after the current command…", "Charge log stopped; preparing the beta upload…", "Charge log stopped: …", "Charge log not started: …") are mapped too. The artifact is `/tmp/x-redesign-charge-steps.json`, byte-identical on a rerun.
- [ ] **Isolated tests**, one per listed failure:
  - `back` (C1):
    1. System back on `check` while locked pops the route, which would unmount the console mid-run → `blocked`.
    2. Back at `[garage]` does anything but exit → `exit`.
  - `chargeStep` (C3):
    3. A recovery or retry line moves the step backwards → `undefined`.
    4. "Charge log not started: …" maps to Saved → `undefined`.
  - `consentSections` (C4):
    5. A paragraph of the pinned `CONSENT_TEXT` goes missing: `intro` plus the sections, rejoined, must equal the text apart from the bold markers.
    6. The titles are not the six in owner order.
  - `noteBlocks` (C4):
    7. Characters other than the markdown markers are dropped from `PRIVACY_NOTE`.
  - `licenses` (C4):
    8. A runtime dependency in `apps/mobile/package.json` (except `workspace:*`) has no entry.
    9. An entry's license differs from the installed package's `package.json`.

**Stage D: hardware (owner phone; car for flows).** The screenshot matrix uses the owner's phone, with developer options for smallest width, cutout simulation and nav mode, instead of emulators. Emulators are optional.
- [ ] Configs: 360 dp with punch-hole cutout; ~411 dp with 3-button nav; 430 dp with gesture nav. Each at font scale 1.0 and 2.0 in light. Then 411 dp at 1.0 and 2.0 in dark. That is eight shots per screen, for Garage, Car, Add vehicle, Report summary, each section detail, Codes, module detail, History, Settings and the Beta sub-page, Consent, Charge log and the check screen. Name each shot `<screen>-<dp>-<nav>-<scale>-<theme>.png`, kept locally (open question 8).
- [ ] For each screen, a PASS/FAIL line against the owner's canvas and against the Core app quality items, quoted with the IDs the page shows on the day the checklist is made. They must cover system back, state kept across background and foreground, contrast in both themes, touch targets of at least 48 dp, no clipped text at font scale 2.0, and edge-to-edge insets.
- [ ] Final: the owner reviews on their own phone in its normal settings, and reruns T2.9 Stage D steps 1–4 and 6 with the beta switch now under Settings.

## Sequencing and ownership

- Order: A → B → C1 → C2 → C3 → C4 → D. Each stage is reviewed and committed by path before the next starts.
- **Stage A cannot start** until Codex has committed or released `apps/mobile/App.tsx`, `apps/mobile/package.json`, the root `package.json`, `eslint.config.js`, `.gitignore` and `pnpm-lock.yaml`. At spec time (`78cd7d6`) all six carry uncommitted T2.10 edits, and `src/summaryAccess.ts`, `src/summaryFlow.ts` and `test/summary-flow.test.ts` are untracked. Stage A moves `DevelopmentSummary` verbatim into `src/screens/DevelopmentSummary.tsx`. After that, T2.10d edits only that file plus its route line in `App.tsx`, and D2's rewarded-ad UI lives on the same `aiSummary` route.
- The navigation change (Garage → Car) is in C1, not B. B stays one visible change: the same screens, re-themed. C1 changes structure.
- T2.9 Stage D owner steps are still pending. Running them after A is part of this task's verification, and after C1 the step-2 switch lives in Settings → Beta data sharing.

## Risks / open questions

Biggest risk: **a silent behaviour regression while splitting `App.tsx`.** Its module-level singletons (one `betaOutbox` and one `chargeRun` per JS runtime), ref-based race guards, the consent-reset effect, and the console's lifetime during a charge log have no test harness. Only the logic freeze, the moved-code diff and the Stage A phone steps catch a break. Second risk: the implementer cannot see the canvas, so layout fidelity depends on §Design and the owner's screenshot review. Budget one layout repair per C stage. Also: Paper 5.15.3 does not declare RN 0.86 support. Portrait lock conflicts with Android's large-screen guidance, which the owner has accepted. A Light/Dark override opposite to the system may leave nav-bar icons low-contrast; if Stage D shows that, `expo-navigation-bar` goes in a follow-up.

Open questions (each with a recommendation):
1. **Codes rating beyond the owner's two rules.** Recommended: any read stored, pending or permanent code → Poor (basis: "Project policy: a reported code is Poor"). Recently-cleared `indicated` → Poor (basis: the T0.7 recently-cleared project policy). No module's DTC read succeeded → Not rated. Otherwise the owner's rules apply.
2. **Which SoC for the hero.** Recommended: `EQUINOXEV_SOC` (22 2B43) rounded to whole percent, as a dashboard shows it. Both signals appear in the readings list at report precision.
3. **Check screen and developer tools have no mockup.** Recommended: the layout in §Screens. Both CTAs open it with an intent, and the charge log's single start tap stays there, because a connection is needed first (T2.4 B2 one-tap). Developer tools stay in release builds, collapsed.
4. **Charge logs in History.** Charge-log files are not linked to a garage car today. Recommended: an empty state, "Charge logs are saved to your capture folder; showing them per car comes later", and a separate spec for a per-car index.
5. **Consent display vs the pinned text.** Recommended: verbatim paragraphs in collapsible sections, with the intro always visible, so the digest and `beta-1` do not change. Known gap: the pinned text says "Garage → Beta data sharing", which becomes Settings in C1. Fold that into the pending re-pin item; no tester sees the screen before then, because the contact placeholder blocks testers.
6. **ADR proposal "Android first, iOS-ready" (amends ADR-001).** Proposed text: "Android is the only built and tested target until Phase 3. UI code follows Material 3 and Android Core app quality. Where platforms differ, it follows the HIG. Platform-only APIs stay behind small interfaces (`foregroundService`, the `SaveTargets`/`StreamTargets` folder picker). The navigation stack is plain state; revisit native-stack navigation for iOS back-swipe when iOS starts." Recommended: accept. The owner has not accepted it yet.
7. **Releasing `App.tsx`.** T2.10d D1 is blocked only on the owner's phone gate. Recommended: the owner lets Codex commit the reviewed D1 source now, with the phone gate still open, so Stage A can start. The alternative is that Stage A waits for D1 to close.
8. **Screenshot storage.** Recommended: keep the PNGs out of git in a gitignored local folder, and record per-screen verdicts and SHA-256s in the task record.
9. **The dataviz validator** is not in this repo or on this machine. Recommended: the owner provides the script to commit under `tools/` (with its license), or reruns it in the design session and pastes the output into the record. Until then the dark highlight stays unset.
10. **Theme preference persistence** in a private `theme.txt` (it never uploads). Recommended: yes.

## Decisions

(frozen at kickoff: owner answers recorded here by the orchestrator)

Owner, 2026-09-28:
1. Codes rating: accepted as recommended. Any stored, pending or permanent code → Poor. "Recently cleared" answering yes → Poor. No module answered → Not rated. No codes with clearing unknown → OK. No codes and not recently cleared → Good.
6. ADR accepted as **ADR-021** in `docs/DECISIONS.md` ("Android first, iOS-ready").
7. Codex commits the reviewed T2.10d D1 code now. Its phone check stays a NOT RUN item on T2.10d. Stage A starts once `App.tsx` and the other shared files are released.

Orchestrator, standing delegation, 2026-09-28:
2. The SoC hero uses `EQUINOXEV_SOC` (22 2B43) with **one decimal** (69.8%), as in the approved mockups. It is not rounded to whole percent.
3, 4, 5, 8, 10: accepted as recommended.
   - 5: the consent display is the pinned text verbatim, split into six sections. The pin is unchanged. The "Garage → Beta data sharing" wording is folded into the owner's pending consent re-pin (owner item; no tester sees the text before then).
9. The validator ran in the design session. The dark chart highlight is `#C97A3C`: all five checks PASS against data `#3FA884` on `#242A26`. That output:
   - lightness band inside L 0.48–0.67
   - chroma ≥ 0.1
   - CVD ΔE 9.2 (deutan)
   - normal ΔE 19.5
   - contrast ≥ 3:1

   Light (from the design session): data `#1E8060` vs highlight `#C2702A` on `#FAFBF9`. Every check passes except CVD ΔE 7.1 (protan), which is WARN. The highlight therefore always carries a text label.
