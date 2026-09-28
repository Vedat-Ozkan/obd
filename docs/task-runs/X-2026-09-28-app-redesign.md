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
