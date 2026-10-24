# X-2026-10-24-simulated-car: simulated car, emulator and automated phone checks at the desk

Size L overall, so split into four stages, each its own implementer session. Order: A, B (A and B may share one session), C1, C2, then D after T2.18 merges.

## Goal

Let the owner's phone checks run at the desk with no car and no dongle. A pure-TS transport in `obd-core` answers from committed `*.redacted.jsonl` recordings, keyed by (active header, command). A `__DEV__`-only "Simulated car" row in the dongle picker connects the dev client to it. The dev client runs in an Android emulator, and Maestro flows drive it and leave screenshots plus a run summary. A simulated run de-risks a check; it never closes an `docs/OWNER-QUEUE.md` item (AGENTS.md hard rule 3). Every simulated artifact is labelled simulated: recording file name, recording meta, and the run summary header.

Test-visible outcome: `pnpm -F mobile test` runs the real battery scan, codes scan and VIN gate over the simulator and renders a report; `tools/sim/run-flows.sh` produces `tools/sim/runs/<stamp>/summary.md` with one screenshot set per flow.

## Non-goals

- No synthesised replies. A command with no recorded reply fails loudly (hard rule 1). The only non-recorded data is the existing synthetic wrong-model VIN fixture.
- No moving `FakeElm` (`apps/mobile/test/drive-capture.test.ts:66`, `charge-logger.test.ts:50`) onto the simulator. Both script amps, link loss, `offAt` and latency against a fake clock; a recording-keyed queue cannot express that. Leave them.
- No change to `ReplayTransport`, relay code, the write guard, or Mode 04 behaviour. The simulator has no `04` reply, so Confirm fails loudly; flows tap Cancel only.
- No TalkBack automation, no Accessibility Scanner automation, no BLE emulation, no EAS build, no iOS.
- No new recordings, no unredacted files bundled, no sim output copied into `fixtures/recordings/`.
- No closing or editing of OWNER-QUEUE rows (the coverage table below is a plan, not a status).
- The T2.18 flow is folded into Stage C3 (visual pass, flow 4); T2.18 is merged (c9b7731).

## Interfaces

`packages/obd-core/src/transport/simulated.ts` (new, export `./transport/simulated`):

```ts
export type SimTable = {
  replies: Readonly<Record<string, readonly string[]>>;   // key = `${header}|${command}`
  wrongModelVin: readonly string[];                       // replies for "|0902", from the synthetic fixture
};
export const simKey = (header: string, command: string): string;
export function buildSimTable(
  sources: readonly { path: string; lines: readonly RecordingLine[] }[],
  synthetic: { path: string; lines: readonly RecordingLine[] },
  maxPerKey: number,
): SimTable;                      // throws if a source path does not end in ".redacted.jsonl"
export class SimulatedCommandError extends Error { readonly key: string }
export class SimulatedTransport implements Transport {
  readonly startsIdle = true;
  constructor(table: SimTable, scenario?: "equinox" | "wrong-model");
  readonly misses: readonly string[];        // keys requested with no recorded reply
}
```

Behaviour: the transport tracks the active header from `ATSH` (arguments normalised: trim, upper-case, collapse spaces) and clears it on `ATZ`, `ATD`, `ATWS` (docs/ELM327.md §Write safety, "Headers set with ATSH/ATFCSH persist until ATD/ATWS/ATZ"). AT commands are keyed with an empty header and use the first recorded reply only (echo-on and echo-off variants of the same AT command must not mix). Non-AT commands cycle a per-key queue of the distinct recorded replies in source order, subsampled evenly to `maxPerKey`; error-token replies (`NO DATA`, `UNABLE TO CONNECT`, `?`, `CAN ERROR`, `BUFFER FULL`) are dropped when the key has at least one data reply. A write whose key has no queue rejects with `SimulatedCommandError` and appends to `misses`. Replies are delivered in one microtask after the write.

`apps/mobile/src/ble/dongleLink.ts` (before/after). Before: `createDongleLink<BleConnection>` where `BleConnection.transport` is the concrete `BleTransport` and `ConsoleScreen` calls `.onError`. After (new exported type; `BleConnection` already satisfies it):

```ts
export interface DongleConnection extends LinkConnection {
  mtu: number; writeCharacteristicUuid: string; notifyCharacteristicUuid: string;
  transport: Transport & { onError(cb: (e: Error) => void): () => void };
}
```

`apps/mobile/src/recording.ts`: `RecordingMeta.dongle: "veepeak-obdcheck-ble"` becomes `"veepeak-obdcheck-ble" | "simulated"`. `apps/mobile/src/sim/simulatedCar.ts` exports `SIM_EQUINOX_ID = "sim:equinox-2024"`, `SIM_WRONG_MODEL_ID = "sim:wrong-model"`, `isSimulated(id)`, `connectSimulated(id): DongleConnection` (mtu 0, characteristic ids `"simulated"`, `deviceName` "Simulated car"), and `captureStem(base, link)` returning `simulated-<base>` for simulated links (used where `createCapture` / `phoneTargets.create` names a file).

## Files

Stage A (obd-core, generator, Node E2E; no UI):
- `packages/obd-core/src/transport/simulated.ts` - create - table builder and transport.
- `packages/obd-core/src/transport/simulated.test.ts` - create - isolated tests for the listed failures.
- `packages/obd-core/package.json` - modify - add the `./transport/simulated` export. TOOLCHAIN UNLOCK.
- `tools/sim/build-table.ts` - create - reads an explicit list of `*.redacted.jsonl` paths plus `fixtures/synthetic/battery-diagnosis-wrong-model.jsonl`, writes the table, prints a coverage report (needed keys per app flow minus recorded keys).
- `apps/mobile/src/sim/equinox.table.json` - create - generated output of `build-table.ts` (committed; do not hand-edit; regenerate with `pnpm sim:table`).
- `apps/mobile/test/simulated-car.test.ts` - create - E2E through the app entry points.
- `package.json` (root) - modify - scripts `sim:table`, `sim:coverage` (tsx, like `replay`). TOOLCHAIN UNLOCK.

Stage B (app wiring and labelling):
- `apps/mobile/src/sim/simulatedCar.ts` - create - ids, `connectSimulated`, `captureStem`.
- `apps/mobile/src/ble/dongleLink.ts` - modify - `DongleConnection` type.
- `apps/mobile/src/app/runtime.ts` - modify - link `connect` and `onDisconnected` branch on `isSimulated(id)`; table required lazily inside `if (__DEV__)`.
- `apps/mobile/src/screens/DonglePicker.tsx` - modify - two `__DEV__` rows ("Simulated car (Equinox EV)", "Simulated car (wrong model VIN)"), shown even when the BLE scan errors.
- `apps/mobile/src/screens/ConsoleScreen.tsx` - modify - connection type to `DongleConnection`; skip both `dongleMemory.remember` calls for simulated ids; `dongle:` and capture stems from the link at the `recording.start` sites.
- `apps/mobile/src/recording.ts` - modify - the `dongle` union.
- `apps/mobile/src/batteryDiagnosisFlow.ts` - modify - `batteryScanMeta` takes the dongle kind.
- `tools/beta-intake/intake.ts` and `intake.test.ts` - modify - reject files whose meta `dongle` is `"simulated"` (only if open question 1 keeps its default).

Stage C1 (emulator, runner, flows P4/P9/P2):
- `tools/sim/README.md` - create - one-time setup (JDK 17, SDK packages, AVD, Maestro), start order, the "simulated, closes nothing" rule.
- `tools/sim/run-flows.sh` - create - boots the AVD, seeds app files, runs flows, pulls captures and `[sim]` logcat lines, writes `summary.md`.
- `tools/sim/flows/launch.yaml` - create - shared launch: dev-client deep link, dismiss first-run sheets.
- `tools/sim/flows/p4-persistence.yaml`, `p9-picker.yaml`, `p2-relay.yaml` - create.
- `.gitignore` - modify - `apps/mobile/android/`, `tools/sim/runs/`.
- `docs/WORKFLOW.md` - modify - line 50 ("Nobody simulates the dongle to make a check pass") now says simulated runs may de-risk but are labelled and never tick an item.
- `AGENTS.md` - modify - add `tools/sim/` to the repository map.
- `apps/mobile/src/relay/RelayClient.ts` - modify - `RelayPhoneMeta.dongle` (line 19) becomes `"veepeak-obdcheck-ble" | "simulated"` (review follow-up; the relay sends the link's kind).
- `tools/sim/README.md` (same file as above) also notes that `labelled()` reads the link's dongle kind at save time, so a link swapped mid-run labels by the final link (review follow-up).
- eslint: `tools/sim/build-table.ts` is not in the `files` glob of `eslint.config.*` (line 29), so it is not linted. Default: leave it (a dev script, typechecked by tsx use; the config is a toolchain file needing the unlock). Open question 9.

Stage C2 (P10, P12, P13):
- `tools/sim/flows/p10-beta.yaml`, `p12-walk.yaml`, `p13-trends.yaml` - create.
- `tools/sim/a11y-audit.ts` - create - parses `adb shell uiautomator dump` XML: clickable nodes under 48 dp, clickable nodes with neither text nor content-desc.
- `tools/sim/run-flows.sh` - modify - font scale / theme / rotation matrix, wrangler start and stop, local-bucket object count.

Stage C3 (agent-driven visual pass; after C1, uses C2's matrix switches if C2 is done, else sets them itself; absorbs the former Stage D):
- `.claude/agents/visual-tester.md` - create - frontmatter modelled on `reviewer.md`: `name: visual-tester`, `tools: Read, Bash, Write`, `model: sonnet`, `effort: medium`, `disallowedTools: Edit, MultiEdit, NotebookEdit`, `maxTurns` about 120. Body: drives the emulator only through `adb` (`exec-out screencap -p`, `uiautomator dump`, `input tap/text/keyevent`, `settings put system font_scale`, `cmd uimode night`, `user_rotation`); Maestro only to reach a start state (`tools/sim/flows/start-*.yaml`); reads each screenshot with Read; writes only under `tools/sim/runs/<date>-visual/` (screenshots, `summary.md`); never edits source, never touches `fixtures/`, never sends Mode 04 or any write; every report labelled SIMULATED, closes no OWNER-QUEUE item. Model rule: Sonnet 5.5 medium; Opus only when the lead escalates; never Fable.
- `CLAUDE.md` - modify - add `visual-tester` to the agent list (line 7) and to the Sonnet 5.5, medium list in model tiering (line 16).
- `tools/sim/flows/start-report.yaml`, `start-t218.yaml` - create - Maestro start states only (connected simulated car and a saved report; a saved parked report for the T2.18 flow). No assertions beyond arrival.
- `tools/sim/visual-flows.md` - create - the six flows as step lists the agent follows (below), so the agent prompt stays short.

## Sources

| Constant / behavior | Source |
|---|---|
| Every reply byte | `fixtures/recordings/chevrolet-equinox-ev-2024/` files, `*.redacted.jsonl` only: `2026-09-22-spike`, `2026-09-22-spike-2`, `2026-09-23-discovery-targeted`, `2026-09-24-phone-console`, `2026-09-24-phone-console-2`, `2026-09-30-test-drive`, `2026-09-30-test-drive-2` (explicit list; the same directory holds unredacted siblings that must not be read) |
| Header persists until ATD/ATWS/ATZ | docs/ELM327.md §Write safety (line 129) |
| Command spelling `ATSH DACBF1`, `22 2AF5`, `ATCRA 18DAF1CB` | spike lines 132-142, test-drive tx lines |
| Matching VIN gate | spike redacted `0902` reply decodes to `3GN7DNRP9RS000000` (WMI `3GN`, index 9 `R`); `apps/mobile/src/garage/catalog.ts:44` accepts it. Verified by reading the frames; Stage A test asserts it end to end |
| Mismatched VIN reply | `fixtures/synthetic/battery-diagnosis-wrong-model.jsonl` (labelled SYNTHETIC in its meta line); no new fixture |
| Mode 04, `19 02 FF`, charge-phase data | none recorded: the simulator fails loudly on them |
| Beta backend URL from the emulator | `10.0.2.2` is the emulator's alias for the host loopback; `EXPO_PUBLIC_BETA_URL` per docs/specs/T2.9-beta-data-upload.md:583 |

Provisional coverage gaps from a command-key dump the architect ran (NOT authoritative; the recording-analyst must confirm with file:line before Stage A is signed off, see Verification prerequisite):
- Codes scan (`CODES_SCAN_COMMANDS`): `0121 0130 0131 014D 014E` are absent from the committed spike files; the committed phone-console files have `02` and `03` only. Closing this needs D3 (redacting the local `2026-09-28-phone-console-2.jsonl`).
- No `19 02 FF` (P7 never ran). No `04`. No committed charge-log recording (the 2026-09-28 charge logs are unredacted failed attempts). Charge logs over the simulator replay drive-phase `2414`/`2885` values, not charging.
- `0902` exists only in the two spike files. T2.14 upgraded parked-scan DIDs: unconfirmed (P6 was NOT RUN).
- `2026-09-23-discovery-targeted` covers 562 `DACBF1` and 302 `DA17F1` keys, so most battery-scan Mode 22 reads are likely covered.

## Verification

Shared by all stages: a simulated run prints and stores a "SIMULATED: no car, no dongle; closes no OWNER-QUEUE item" header; recordings produced carry `dongle: "simulated"`, characteristic ids `"simulated"` and a `simulated-` file stem; every `[sim]` miss is listed in the summary; `pnpm check` green on main (integrator). No digests or byte comparisons.

Prerequisite (orchestrator to the `recording-analyst`, before Stage A sign-off): list which `(header, command)` keys in the seven redacted files have a reply, with line citations, for: `CODES_SCAN_COMMANDS`, `CAPTURE_COMMANDS`, `0902`, the `equinoxEv2024Profile` and `CHARGE_LOG_PROFILE` Mode 22 lists, `DRIVE_FAST_PROFILE`, `GROUP_DIDS`, `CONTEXT_DIDS`, and what `moduleDtcCapture.ts` sends. The gaps go into `tools/sim/README.md` as explicit limits. `pnpm sim:coverage` must reproduce the same list from code.

### Stage A

- [ ] E2E: `runAndSaveBatteryDiagnosis` over `SimulatedTransport(equinox)` ends with an identity `match`, a saved report whose `Recording:` line carries the simulated stem, and signals read from `CB`/`17`; artifact `/tmp/sim-battery-report.md` (rendered report).
- [ ] E2E: the same with `scenario: "wrong-model"` ends with the mismatch message, no report saved, no battery Mode 22 command sent.
- [ ] E2E: `runCapture` over the simulator reproduces the `CAPTURE_COMMANDS` replies; the codes scan prints its misses for the gap keys instead of replies (artifact: `pnpm sim:coverage` output).
- [ ] Isolated tests (`simulated.test.ts`). Failure modes, listed before code:
  1. A reply recorded under one header is returned under another -> `header-keyed`.
  2. A key with no recording returns a reply or an empty string instead of rejecting -> `unknown-fails-loudly`.
  3. A non-`.redacted.jsonl` source is accepted by the builder -> `unredacted-refused`.
  4. The per-key queue stalls on one value or skips on wrap -> `queue-cycles`.
  5. `ATSH` spelling (`ATSH DACBF1\r`, lower case, double space) misses the key -> `atsh-normalised`.
  6. An AT key mixes echo-on and echo-off replies -> `at-first-reply-only`.
- [ ] `pnpm -F obd-core test` and `pnpm -F mobile test` include the new files; `pnpm sim:table` rewrites the table and its size is below 1 MB.

### Stage B

- [ ] `pnpm -F mobile typecheck` green; every `recording.start` site takes `dongle` from the link.
- [ ] `expo export --platform android` bundle contains neither `Simulated car` nor `sim:equinox-2024` (string count 0; production mode folds `__DEV__`).
- [ ] If kept: intake rejects a file with `dongle: "simulated"` (one test, failure: simulated file lands in `fixtures/recordings/`).
- [ ] Hardware-only: the picker row on the owner's real phone and the real BLE list are Car only.

### Stage C1

- [ ] `tools/sim/run-flows.sh p4 p9 p2` ends with `summary.md` PASS for each flow and screenshots under `tools/sim/runs/<stamp>/<flow>/`.
- [ ] P4: seed `dongles.json` with a fake real-dongle id via `adb shell run-as com.ev.obd`; connect to the simulated car; after the flow the file is unchanged (picker shows the real id still "Last used with this car"). Force-stop and reopen: the saved report is listed under its garage entry and absent from a second same-model entry.
- [ ] P9: picker opens, shows both simulated rows with the BLE scan error visible; "Run check" on the Equinox entry saves a scan that holds a `0902` reply (pulled capture file checked by the runner); the wrong-model row shows the mismatch message and saves nothing.
- [ ] P2: relay mode with the broker URL pasted (laptop `pnpm relay` on `10.0.2.2`); Mode 04 prompt appears and Cancel is tapped (no `04` is sent: the summary greps the capture for tx `04`); `2E` refusal observed through `pnpm hil:smoke`. Mid-command disconnect is exercised by killing the relay mid-run (by PID) and checking the "Relay ended mid-command" status.
- [ ] Build: `expo run:android` debug variant installs on the AVD; first launch past the dev-client launcher via deep link works.

### Stage C2

- [ ] P12: `p12-walk.yaml` visits every screen at font scale 1.0 and 2.0, light and dark, portrait and landscape (set by `adb shell settings put system font_scale`, `cmd uimode night`, `user_rotation`); screenshots per combination, `assertVisible` on each screen's title. `a11y-audit.ts` output attached; findings are listed, not auto-fixed.
- [ ] P13: Trends section opens and shows its empty state; populated state only if a saved charge summary can be seeded from `fixtures/synthetic/charge-log-rested.jsonl` through an existing summary function in at most about 30 lines of helper, else it stays empty-state only (limit stated in the summary).
- [ ] P10: `wrangler dev --local --ip 0.0.0.0` in `tools/beta-backend` (started and stopped by PID); `EXPO_PUBLIC_BETA_URL=http://10.0.2.2:8787` set when Metro starts. Steps 1-4 and 6 of the T2.9 Stage D list run: consent off then on, "Queued for beta upload." status, airplane mode (`cmd connectivity airplane-mode enable`) then foreground upload, battery-scan object arrives, Delete my data empties `files/<installId>/` in the local bucket directory (count in summary). Step 5 (intake into `fixtures/recordings/`) is not run: sim files never go there.

### Stage C3

Key flows, each in light and dark at font scale 1.0 and 2.0 (portrait; one landscape pass on flows 1 and 4):
1. Connect to the simulated car, run a battery check, open the report and each section.
2. Codes report.
3. Garage: add a car, the picker, the wrong-model mismatch.
4. T2.18: report, "Add a short drive", the drive report, reopen from Report history. The simulated drive runs the real `DRIVE_MINUTES` unless the flow stops at the cap; the 20-minute wait is real time, so run it once, at font scale 1.0 light, then re-view the saved reports (not a new drive) in the other three combinations.
5. Trends (empty state; populated only if C2 P13 seeded it).
6. Beta consent screens (consent off and on; backend not required to view them).

- [ ] The lead launches `visual-tester` (Sonnet 5.5 medium) with `tools/sim/visual-flows.md`; run produces `tools/sim/runs/<date>-visual/summary.md` and screenshots beside it.
- [ ] `summary.md` starts with the SIMULATED header and lists each finding as `severity | screen | issue | screenshot path` (severity high/med/low). Categories checked and stated as checked or not reached: layout, text, truncation, contrast, dark mode, font scale 2.0, rotation, flow. Every finding's screenshot exists. A flow that could not be reached says so; no silent skips.
- [ ] Reviewer opens at least three listed screenshots (one per severity found, or the first three) and confirms the finding matches; reviewer also checks the agent wrote only under `tools/sim/runs/` (`git status --short` shows no source change).
- [ ] Findings are listed, not auto-fixed. They go to the lead as candidates for tasks; nothing closes an OWNER-QUEUE or ACCESSIBILITY row, and the summary says so.
- [ ] Not E2E-automatable by design: subjective judgement (is it ugly, is contrast adequate on a real panel). The pass finds candidates; real-phone and real-car checks stay owner items.

## Tools and dependencies (hard rule 7)

None in the repo's dependency graph: no `pnpm add`, no lockfile change. Toolchain unlocks (create `.claude/ALLOW_TOOLCHAIN`, delete after): `packages/obd-core/package.json` (export), root `package.json` (two scripts), both Stage A. `.gitignore`, `AGENTS.md`, `docs/WORKFLOW.md` are not hook-protected. Out-of-repo tools, installed by the owner or implementer into `~/tools` or `~/.maestro`, never committed:

| Tool | Reason |
|---|---|
| JDK 17 (Temurin tarball, no sudo) | Only JDK 11 is installed; RN 0.86 / Expo 57 Gradle and Maestro CLI need 17+ |
| Android SDK: `ndk`, `cmake`, `platforms;android-36`-matching build-tools via `sdkmanager` (licenses dir already exists) | native build of the dev client; exact packages are whatever the first `expo run:android` asks for |
| AVD `obd_phone` from `system-images;android-35;google_apis_playstore;x86_64` | existing AVDs, including `store_port`, are automotive images |
| `~/Android/Sdk/platform-tools` on PATH for the runner | adb |
| Maestro CLI (Apache-2.0), `MAESTRO_CLI_NO_ANALYTICS=1`, no cloud | see below |

Why local `expo run:android` over EAS: no Expo account step or queue, builds x86_64 for the emulator, and EAS profile `development` is a universal APK aimed at the real phone. `expo run:android` runs prebuild into `apps/mobile/android/` (gitignored by this task). The `withChargeLogService` plugin runs in prebuild as it does on EAS.

Why Maestro: YAML flows live in the repo, it drives through adb with no app-side dependency (Detox would add a native module and jest wiring to the app; Appium is heavy), it has `takeScreenshot` and text assertions from the accessibility tree. Computer-use stays a manual fallback for judging screenshots; it is not deterministic or cheap enough to be the runner. `uiautomator dump` plus `a11y-audit.ts` covers the checks Maestro cannot (touch-target size, unlabeled clickables).

## Coverage table (plan; nothing here closes an OWNER-QUEUE row)

Covered at desk = every check in the row can run on the simulator. Flow only = a flow exists but a leg needs the car or the real phone. Car only = no desk value.

| Item | Class | Note |
|---|---|---|
| B1 | Flow only | emulator build shows the redesign UI; the EAS APK itself stays unproven |
| P1 | Flow only | relay -> app -> simulator path; real dongle encoding is the point of the item |
| P2 | Covered at desk | 2E refusal, 04 Cancel, URL paste; mid-command disconnect by killing the relay (no real BLE loss) |
| P3 | Flow only | console and codes legs limited by the recorded-key gaps |
| P4 | Covered at desk | persistence and isolation logic; scan content is recorded, not live |
| P5 | Flow only | `checked` entry blocks battery data; no bench car |
| P6 | Flow only | depends on analyst confirming the T2.14 DIDs are recorded; real export needs a real scan |
| P7 | Car only | no `19 02 FF` recording |
| P8 | Flow only | unplug-reminder screenshot at desk; rested 12 V reading is Car only |
| P9 | Covered at desk | picker UI, mismatch message, `0902` in scan; real BLE device list is Car only |
| P10 | Covered at desk | steps 1-4, 6; step 5 intake Flow only (sim files stay out of `fixtures/`) |
| P11 | Car only | needs a laptop capture with a dash SOC note |
| P12 | Flow only | font/theme/rotation matrix and touch-target audit; TalkBack and Accessibility Scanner are manual |
| P13 | Flow only | empty state certain, populated state if seeding fits the limit above |
| R1 | Flow only | drive UI and rescan run 10 real minutes over recorded drive data; the pass criterion (skew median) is a real-car result |
| C1 | Car only | needs the real car Ready and ELM init |
| C2 | Car only | multi-hour charge |
| T2.18 flow | Flow only (Stage C3, flow 4) | merged c9b7731 |
| D*, A* | out of scope | decisions and accounts |

## Risks / open questions

1. Same dev client on the owner's phone (B1) shows the Simulated row and could save simulated reports into real history or queue them for beta. Default: labelling by stem and meta only, intake rejects `dongle: "simulated"`, no history quarantine. (P10 needs simulated files to upload, so queueing is not blocked.)
2. JDK 17 without sudo. Default: Temurin tarball into `~/tools/jdk-17`, `JAVA_HOME` set by `run-flows.sh`.
3. In-report banner (a `BatteryDiagnosisReport` schema change) instead of file-name labelling. Default: no; the `Recording:` line and source citations already carry the stem.
4. `maxPerKey` 64 and the 1 MB table cap. Default as written; raise only if drive data looks flat.
5. Fill the codes-scan gap by approving D3 (redact local `2026-09-28-phone-console-2.jsonl`). Default: not part of this task; the gap is listed.
6. The emulator has no BLE: `new BleManager()` and the permission prompt may misbehave. Default: Stage B checks it first; `adb shell pm grant` for BLE/notification permissions in the runner; the sim path skips `requestBlePermission`.
7. Dev-client first-run sheets and Metro on WSL2 (`10.0.2.2:8081`) may need `adb reverse` as fallback. Default: deep link, then reverse.
9. Lint `tools/sim/build-table.ts`? Default: leave (toolchain unlock for a one-off script; revisit if `tools/sim` grows).
10. Stage C3 placement. Default: its own stage after C1, independent of C2, so the visual pass can run before the Maestro matrix exists. Folding into C2 would not be smaller (it adds an agent definition and CLAUDE.md edit).
11. Visual-agent cost. The matrix is 6 flows x 4 combinations plus rotation, every screenshot read as an image. Default: Sonnet medium, one run per release candidate, not per commit; the lead escalates to Opus only on a flagged-ambiguous screen.
8. Mid-command disconnect uses killing the relay, not a simulated BLE drop. Default: accept.

## Decisions
(frozen at kickoff: none yet)
