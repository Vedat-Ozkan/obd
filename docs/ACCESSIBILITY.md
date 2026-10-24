# Accessibility

Audit date: 2026-10-23. Scope: `apps/mobile` (Expo / React Native, Android, React Native Paper 5). Evidence is file:line at commit `8e22d78`.

## Verdict

The app has real, deliberate accessibility work. TalkBack testing was possible (owner phone, dev client) but none is recorded.

- **Interactive elements:** 72 JSX call sites. A mapped list counts once.
  - 24 kit `Button`
  - 3 `IconButton`
  - 2 Paper text `Button`
  - 5 `Switch`
  - 9 `TextInput`
  - 3 expanders
  - 22 pressable `ListRow`
  - 2 pressable `Hero`
  - 2 `Text` links
- **Names: 65 of 72 (90%).**
  - 36 set an explicit `accessibilityLabel`. Kit `Button` passes its title (`src/ui/kit.tsx:22`).
  - 29 take their name from child text.
- **Roles: 72 of 72.** App code sets 53 of them explicitly; Paper or the native widget supplies the rest.
- **States:**
  - Disabled on `Button` and `ListRow`.
  - `radio` with `checked` on choice rows (`kit.tsx:47`).
  - `expanded` on the expanders (`ConsentScreen.tsx:14`, `ConsoleScreen.tsx:541`, `SectionScreens.tsx:71`).
- **Unnamed inputs: 7 of 9 `TextInput`s have only a placeholder.**
  - 5 can be reached in release builds: `AddVehicleScreen.tsx:62-64`, `ConsoleScreen.tsx:549`, `ConsoleScreen.tsx:557`.
  - 2 are dev-only: `ConsoleScreen.tsx:561-562`.
- **Charts: 2 of 2 have a text alternative.**
  - `ScanHistory` is grouped and given a sentence listing each point (`src/ui/charts.tsx:14`).
  - `CellRangeStrip` states min, average and max (`charts.tsx:48`).
- **Live regions:** one, the check status card (`ConsoleScreen.tsx:493`).
- **TalkBack testing:** none recorded. No hits for "talkback" or "screen reader" in `docs/` or `apps/`.
- **Font scale 2.0:** the phone checks are listed in `docs/task-runs/X-2026-09-28-app-redesign.md` (lines 157, 304, 374, 503, 698). They were deferred to the owner (line 720), and no result is recorded.
- **Automated checks:** none. Mobile tests are vitest on pure logic only.

**CV line "added accessibility labels and roles to the mobile screens and charts".** It is accurate as written. 90% of controls are named, all of them have roles, and both charts have text alternatives (`git log -S accessibilityLabel` shows `fa8c3e3`, `1f41022`, `7bd9803`). Do not stretch it to "accessible app", "WCAG compliant" or "tested with TalkBack". Once the Definition of Done below is met, this line would be justified: "brought the Android app to WCAG 2.2 AA-equivalent, verified with TalkBack, Accessibility Scanner and automated role/label tests."

## Per-screen findings

- **Top bar** (`App.tsx:32-35`). Back and Settings are labelled and 48×48. The title has the `header` role.
  - Gap: focus does not move to the new title when the screen changes.
- **Garage, Car, Add vehicle, Codes, Module.** Rows, buttons and heroes are named (`CarScreen.tsx:48`). No gaps found in code.
- **Interest form** (`AddVehicleScreen.tsx:62-66`).
  - Three inputs have no name.
  - The input height is probably under 48dp (`kit.tsx:108`: `input` has `padding: 8` and no `minHeight`).
  - "Join future beta interest: yes/no" behaves as a toggle but is exposed as a button.
- **Report summary** (`ReportScreens.tsx:44`).
  - The verdict card has one combined label. It leaves out the policy line and `verdict.limitation`. If that label replaces the children, TalkBack users lose the "does not certify battery health" caveat.
- **Section detail** (`SectionScreens.tsx:30-34`).
  - `CellRangeStrip` sits inside a labelled `Hero`. The parent label may hide the chart's own label.
- **Check console** (`ConsoleScreen.tsx:489-563`).
  - The live region also contains the MTU and characteristic UUIDs (`:496`), so every change is announced with noise.
  - `captureStep` and `relayStatus` are not announced.
- **Dongle picker** (`DonglePicker.tsx`).
  - Neither the scan error (`:36`) nor arriving devices are announced.
  - The Paper `Modal` (`:32`) may leave the screen behind it reachable.
- **Settings, Beta, Consent** (`SettingsScreens.tsx:51-53`, `ConsentScreen.tsx:33-35`).
  - Each switch row gives two focus stops: the text, then the switch.
  - `betaMessage` is not announced.

Other points:

- **Colour alone:** mostly avoided.
  - `Chip` shows an icon and a word (`kit.tsx:92-101`).
  - The latest chart dot is larger and has a legend (`charts.tsx:23,34-35`).
  - Charge steps and errors use words.
- **Font scaling:** nothing sets `allowFontScaling={false}` or `maxFontSizeMultiplier`. Two fixed heights could clip at 200%:
  - `charts.tsx:60` (`height: 132`)
  - `ConsoleScreen.tsx:576` (`height: 220`, scrolls)
- **Orientation:** portrait is locked (`app.json:6`). This fails WCAG 1.3.4 unless portrait is essential.
- **Display-only rows and heroes:** these are disabled `TouchableRipple`s (`kit.tsx:47,66`), so TalkBack may say "disabled".
- **Reduce motion:** no `Animated` code.

## Contrast (WCAG 2 ratios, computed from `src/ui/theme.ts:18-39`)

| Pair | Light | Dark | Need |
|---|---|---|---|
| text / bg | 12.19 | 11.74 | 4.5 |
| muted / bg (captions, placeholders) | 5.39 | 7.07 | 4.5 |
| onAccent / accent (primary button) | 4.70 | 7.02 | 4.5 |
| onContainer / container (hero) | 10.88 | 8.61 | 4.5 |
| containerMuted / container | 5.69 | 5.67 | 4.5 |
| error / bg | 5.91 | 9.57 | 4.5 |
| chip icon / chip bg (worst) | 3.02 | 3.56 | 3 |
| chart dots / bg (worst) | 3.36 | 4.93 | 3 |
| **input border: outline / surface** | **1.43** | **1.48** | **3** |

The chip label uses the text token: 10.91 or higher. These ratios match the repo's own records (`X-2026-09-28-app-redesign.md:258,279,397`), but those records never checked input borders. Input borders are the one failure (WCAG 1.4.11).

## Gaps ranked by user impact

1. **No TalkBack run.** Every "may" above is unconfirmed.
2. **Five unnamed release inputs.** Once a field has text, TalkBack reads only the value.
3. **Errors and progress are not announced.**
   - Covers the garage error, scan error and results, `betaMessage`, `captureStep`, and the AI summary.
   - The one live region that exists is noisy.
4. **The spoken verdict leaves out its caveat** (`ReportScreens.tsx:44`).
5. **Input borders are at 1.43:1.**
6. **No focus management** on screen change or in the dongle sheet.
7. **Portrait lock.**
8. **Possible masking:** the chart inside `Hero`, `Chip` inside `ListRow`, and "disabled" on display rows.
9. **Targets under 48dp:**
   - the interest inputs
   - the dev links
   - the switches, whose label text is not tappable
10. **200% font scale never verified.**

## Checklist to WCAG 2.2 AA-equivalent

**Names, roles, states**
- [ ] Give the 7 inputs visible labels plus `accessibilityLabel`.
- [ ] Make each switch row one pressable element:
  - `accessibilityRole="switch"` and `accessibilityState={{ checked }}`
  - the row text as its name
  - the inner `Switch` hidden from accessibility

  Treat the beta-interest toggle the same way.
- [ ] Render display-only `ListRow` and `Hero` as a plain `accessible` `View`, not as a disabled ripple.
- [ ] Add the policy line and the limitation to the verdict label.
- [ ] Fold the cell-strip summary into the section hero's label.

**Announcements and focus**
- [ ] Add `accessibilityLiveRegion="polite"` to error text, `betaMessage`, `captureStep`, and the AI summary. Use `"assertive"` for failures that stop a check.
- [ ] Move the MTU and UUIDs out of the live region.
- [ ] Announce how many dongles were found.
- [ ] On route change, call `AccessibilityInfo.setAccessibilityFocus` on the new title.
- [ ] While the sheet is open, set `importantForAccessibility="no-hide-descendants"` on the content behind it.

**Charts**
- [ ] Keep the summary sentences.
- [ ] For long histories, read only first, latest, min, max and n.
- [ ] Add a "Show as table" row that lists date and SoC.

**Visual and layout**
- [ ] Raise input borders to at least 3:1 against both `surface` and `bg`. Light `#828C86` gives 3.35 and 3.14; dark `#6B766F` gives 3.10 and 3.46.
- [ ] Keep icon + word on every status. Add that rule to the spec template.
- [ ] Make every target at least 48×48dp:
  - `minHeight: 48` on `styles.input`
  - padded links
  - whole-row switches
- [ ] Replace the fixed chart and pane heights with `minHeight`. Check every screen at 360dp width and 200% font scale.
- [ ] Allow landscape, or record in `docs/DECISIONS.md` why portrait is essential.
- [ ] If animation is added, gate it on `AccessibilityInfo.isReduceMotionEnabled()`.

## How to test

1. **TalkBack on the Android phone.** On each screen, swipe through every element. Write down the order, name, role, and state of each one.
   - Trigger announcements: start a check, force a scan error, open the dongle sheet.
   - Do one real battery check and one charge log with TalkBack on.
   - Record PASS/FAIL per screen in a task-run file.
2. **Accessibility Scanner.** Run it on every screen in light and dark, at font scale 1.0 and 2.0. Fix or justify each finding.
3. **Component tests.** React Native Testing Library expects Jest, so add a separate `jest.config.js` (`jest-expo` preset) next to vitest.
   - Render screens with real kit components and fixture reports. Do not mock internals.
   - Assert `getByRole("button", { name: "Run check" })`, `getByRole("switch", { name: /Vehicle Ready/ })`, and `getByLabelText` for every input.
   - Assert that nothing with `onPress` lacks a role and a name.
4. **Lint.** Before adopting `eslint-plugin-react-native-a11y`, confirm it works with ESLint 10 flat config (root `eslint.config.js`). If it does not, write a small local rule: every `TextInput` needs an `accessibilityLabel`.
5. **Contrast test** over `TOKENS` in vitest.

## Definition of Done

- Every interactive element has a name and a role, enforced by RNTL tests and lint inside `pnpm check`.
- Each status change and error during a check is announced once, without noise.
- The contrast test passes in both themes, including input borders at 3:1 or more.
- Accessibility Scanner shows no unresolved findings at 1.0 and 2.0 font scale, in light and dark.
- A TalkBack walkthrough of every screen, a real battery check, and a charge log are recorded as PASS. Anything not run is marked NOT RUN.
- The orientation decision is recorded.
