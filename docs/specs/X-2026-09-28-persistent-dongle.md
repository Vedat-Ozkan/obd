# X-2026-09-28-persistent-dongle: remembered, persistent dongle link and a device picker sheet

## Goal

Owner, 2026-09-28: "why do i have to reconnect to the dongle each time? should be one and done no?" and "don't like the list of bluetooth connections. make it a modal, and ideally with only the most relevant ones to us at the top." This builds on the committed redesign (`X-2026-09-28-app-redesign`, desk stages A–C4 closed; Stage D is owner hardware).

When this is done:
- The app remembers the dongle each garage car last connected to.
- Opening the check screen connects to that dongle with no taps.
- The BLE link lasts for the app session. It survives the end of a battery check, Cancel check, a capture, a charge log that ends by itself, and leaving and reopening the check screen. It closes only when:
  - the user taps Disconnect (auto-connect then stays off until the user connects again);
  - the link is lost;
  - an uncertain relay end closes it (T0.6b rule 7, unchanged).
- "Reconnect for another run." disappears.
- The inline scan list is replaced by a bottom-sheet picker. It opens from "Change dongle", or by itself the first time a car has no remembered dongle. The order is: the remembered dongle, then OBD-looking devices by signal strength, then everything else behind "Show all devices".

Test-visible outcomes:
- E2E: two battery diagnoses run back to back on one kept link through `runAndSaveBatteryDiagnosis`. The second starts with `ATZ`, both save, and the link is never closed. Artifact: `/tmp/x-persistent-dongle-kept-link.json`.
- Isolated tests for the link store, the per-run view, the dongle memory and the device order, each covering a listed failure.
- The owner's phone checks below.

## Non-goals

- A background reconnect loop. After a loss (not during a charge log), the user taps Connect. Auto-connect runs only when the check screen opens. The charge log's own reconnect (T2.4 Decisions 19–22) is unchanged.
- Changing T0.6b's rule that an uncertain relay end closes BLE (`docs/specs/T0.6b-android-relay-mode.md` rule 7, end paths T1/T2). Relay stays screen-owned: leaving the screen ends it, as today.
- Any change to `packages/`, `src/chargeLogger.ts`, `src/batteryScan.ts`, `src/batteryDiagnosisFlow.ts`, `src/console.ts`, `src/capture.ts` or `src/relay/`. No new OBD/AT command or session behaviour.
- Writing the dongle id or name into recordings, reports, `garage.json` or beta uploads.
- Bonding or pairing (docs/ELM327.md §BLE specifics: do not pair in Android settings), a connect timeout option, multi-dongle management, and renaming or forgetting dongles in Settings.
- Changing the 12 V unplug note (T2.5b), the Ready switch, Developer tools or the charge-log timeline.
- A new dependency, native module, `app.json` change or dev-client rebuild.

## Design

**Where the link lives.** Today `EquinoxConsole` creates a `BleManager` and destroys it on unmount (`ConsoleScreen.tsx:32, 136–142`). Runs close the link:
- `batteryScan.ts` `recorded.close()` → `transport.close()`;
- `chargeLogger.ts` `link.close()`;
- `diagnose()`/`chargeLog()` `release()`.

The new design:
- One `BleManager`, created lazily in `runtime.ts` and never destroyed while JS runs. `new BleManager()` already returns ble-plx's shared instance (`react-native-ble-plx` 3.5.1 `src/BleManager.js` `sharedInstance`; T2.4 Decision 20).
- One module-level `dongleLink` holds the current `BleConnection`.
- Runs that close their transport (the diagnosis and the charge log) get a **per-run view** (`runView`). Its `close()` ends that run's use of the link and leaves the link open.
- Capture, Send and relay already leave the transport open (`ConsoleSession.close` and `RelayClient.close` only unsubscribe), so they keep using `connection.transport`.

**Why keeping the link is write-safe.** Every run opens a fresh session, and a fresh `Elm327Session` or `ConsoleSession` writes only `ATZ` or `ATI` until one gets a clean `>`-terminated reply (docs/ELM327.md §Write safety, Input rules, the "A new `Elm327Session` or app `ConsoleSession` cannot tell whether the ELM is idle" bullet; `X-2026-09-24-first-write`). That rule already covers "the ELM may still be busy from the previous run", with or without a BLE reconnect. A BLE reconnect never reset the ELM state the rule protects against, so closing between runs added no safety. The old "require reconnection" text (T2.6d) followed from `Elm327Session.close()` closing the transport; it was not a safety rule. `runView` passes `startsIdle` through unchanged (undefined for BLE), so this rule stays in force.

**One writer.** At most one check screen is mounted: App renders only the top route. On unmount, the screen closes everything it started on the link:
- the capture or Send session;
- relay;
- the diagnosis view, if a diagnosis is running (activity recreation; Back is already locked).

A closed view rejects writes, so an unmounted screen's run can never write alongside the next screen's run. The charge log is the one run that outlives the screen (T2.4 Decision 20). `bleBusy()` already includes `chargeRun.current()`.

**End paths** (the reviewer walks each one):

| Path | Link |
|---|---|
| Diagnosis ends (saved, stopped, no fingerprint, error) | kept; the view is closed |
| Cancel check | close the diagnosis view (was: close the BLE transport); link kept |
| Capture, codes report, Send end | kept (as today) |
| Charge log ends by itself or is "not started" | kept |
| Charge log ends after Disconnect was tapped (`run.stop`) | `dongleLink.disconnect()`, then `chargeRun.end(line)` |
| Disconnect, no charge log | `teardown("Disconnected by user.")` + `dongleLink.disconnect()` |
| Relay clean end | kept (as today) |
| Relay uncertain end (T0.6b T1/T2) | `teardown(...)` + `dongleLink.drop()` |
| BLE loss (`dongleLink` listener `lost`) | during a charge log: ignored by the screen (the logger's writes fail, then it calls `reconnect()`); otherwise `teardown("Disconnected[: msg].")`, which no longer closes the link itself |
| Screen unmount | close relay, sessions, scan, diagnosis view; keep the link; charge log untouched |

**Charge log wiring** (in `chargeLog()`; `chargeLogger.ts` is unchanged). `deps.connect`:
- first call returns `runView(active.transport)`;
- later calls return `runView((await dongleLink.reconnect()).transport)`.

The logger's `link.close()` now closes only the view. Decision 21's re-check becomes `dongleLink.current() !== active`; the `mounted` check stays. `chargeRun.begin` no longer takes the manager. `release()` no longer closes the transport or sets state.

**Remembering (per garage car).** A separate private file, `Paths.document/dongles.json`: `{ "version": 1, "cars": { "<garageId>": { "id": "...", "name"?: "..." } } }`. It is not a field in `garage.json`, for three reasons:
1. A corrupt or unreadable dongle file must degrade to "nothing remembered". A bad `garage.json` blocks the whole app (`garage/flow.ts` `parseState` throws).
2. `GarageVehicle` entries are passed to the beta outbox (`queueForBeta(kind, entry, …)`). A Bluetooth address kept out of that object cannot leak through a later change there.
3. The garage format, its parser and `garage-flow.test.ts` stay untouched.

A removed car's stale entry is harmless: garage ids are never reused (`garage/flow.ts` `add()` increments `nextId`).

What gets remembered:
- after every successful connect from the check screen, `{ id: connection.deviceId, name: connection.deviceName ?? picked name ?? previous name }`;
- a live link on mount, for a car with no remembered dongle.

A failed write is ignored: the link works, and the dongle simply is not remembered.

**Auto-connect on mount**, after Bluetooth permission is granted. The first matching case applies:
1. A charge log is running: nothing changes; the run's status shows.
2. A link is up: "Connected to <name>." (It is not switched to this car's remembered dongle; the user can Change dongle.)
3. `dongleLink.held()`: "Disconnected. Tap Connect to use <name> again."
4. A dongle is remembered: `dongleLink.connect(id)` with "Connecting to <name>…". Success: "Connected to <name>." Failure: "Could not reach <name> (<error>). Check it is plugged in, then tap Connect."
5. Nothing remembered: Stage A keeps today's "Scan for the Veepeak." Stage B opens the picker.

The hold is module memory, so it lasts for the app session only. Any `connect()` clears it, and so does an app restart.

**Check screen, Dongle section.**
- Stage A: a row showing the remembered or connected dongle's name (else "No dongle chosen") and its state ("Connected", "Connecting…", "Not connected"). A tonal **Connect** button, shown when a dongle is remembered and there is no link. The existing Scan button and list stay until Stage B.
- Stage B replaces Scan and the list with a tonal **Change dongle** button ("Choose dongle" when none is remembered). It is disabled while `connecting || pending || capturing || diagnosing || chargeLogging || bleBusy()`.
- Disconnect and the 12 V card are unchanged.
- Status texts drop "Reconnect for another run." and "Reconnect before another run."; the charge-log line keeps the "Charge log stopped: …" prefix (`chargeSteps.ts`). "Charge log not started: the dongle disconnected. Reconnect and try again." becomes "… Connect and try again."

**Picker sheet (Stage B).** react-native-paper 5.15.3's `Portal` + `Modal`, already installed and under `PaperProvider` in `Root`:
- **Layout.** Anchored to the bottom: surface token, top corners radius 28, bottom safe-area inset, and a scrolling list up to about 70% of the window height.
- **Dismissing.** A tap outside or system back closes the sheet only. Paper's Modal handles back ahead of App's `BackHandler`.
- **Scanning.** The sheet scans with `scanDevices(bleManager(), …)` only while it is visible.
- **Content.** A title ("Choose your OBD dongle"), then `ListRow`s. Each row shows the name, or "Unnamed device", with a subtitle: "Last used with this car · " for the remembered one, then "Signal −62 dBm" or "Signal unknown".
- **Show all.** A "Show all devices" `Switch` row captioned with the hidden count. If no relevant device is shown: "No OBD adapters found yet. Check the dongle is plugged in, or show all devices."
- **Picking a row.** It stops the scan, closes the sheet and any debug session, then connects and remembers.
- **Order.** `orderDevices` (Interfaces).
  - **Relevant:** the remembered id; any device advertising service FFF0 (docs/ELM327.md §BLE specifics; the same test as `tools/spike/go.py` `find_dongle`); or a name matching `/obd|elm327|veepeak/i` (a UI heuristic, not an OBD constant).
  - **Sort:** the remembered device first, then the other relevant devices by RSSI descending, then the rest by RSSI descending. A missing RSSI sorts last; ties go by name, then id.
  - **Hidden:** the rest, unless Show all is on.

## Interfaces

```ts
// src/ble/dongleLink.ts (create; Stage A)
import type { Transport } from "obd-core/transport";
import type { TextStore } from "../garage/flow.js";
export interface LinkConnection { transport: Transport; deviceId: string; deviceName?: string }
export function createDongleLink<C extends LinkConnection>(deps: {
  connect(deviceId: string): Promise<C>;                                              // connectVeepeak(bleManager(), id)
  onDisconnected(deviceId: string, listener: (error: Error | null) => void): { remove(): void };
}): {
  current(): C | undefined;
  connecting(): boolean;
  /** Serialized. Returns the current link if it is this device; otherwise drops any other link, connects and clears the hold. */
  connect(deviceId: string): Promise<C>;
  /** Charge log only: drops the current link and connects the last device again. Rejects if that fails; nothing is current then. */
  reconnect(): Promise<C>;
  /** Closes the link without holding auto-connect (uncertain relay end). */
  drop(): Promise<void>;
  /** The user's Disconnect: drop, then hold auto-connect until the next connect(). */
  disconnect(): Promise<void>;
  held(): boolean;
  /** Called on every change; `lost` only when the device dropped the link, never for drop()/disconnect(). */
  subscribe(listener: (connection: C | undefined, lost?: { error: Error | null }) => void): () => void;
};
/** A per-run view of the kept link: close() makes later writes reject and removes this view's listeners; the link stays open. */
export function runView(transport: Transport): Transport;
export type RememberedDongle = { id: string; name?: string };
export function createDongleMemory(store: TextStore): {
  get(garageId: string): Promise<RememberedDongle | undefined>;   // missing or corrupt file → undefined, never throws
  remember(garageId: string, dongle: RememberedDongle): Promise<void>;
};

// src/chargeRun.ts — before
export function createChargeRunRecord<C, M extends { destroy(): unknown }>(): { begin(connection: C, manager: M, line: string): ChargeRun<C, M>; mount(listener): () => boolean; /* … */ };
// after: the record owns no manager; end() destroys nothing; unmount returns nothing
export function createChargeRunRecord<C>(): { begin(connection: C, line: string): ChargeRun<C>; mount(listener: ChargeRunListener): () => void; /* current, status, requestStop, end unchanged */ };

// src/app/runtime.ts — new exports: bleManager(): BleManager (lazy, never destroyed), dongleLink, dongleMemory (over dongles.json)

// src/ble/BleTransport.ts (Stage B) — before / after
export interface ScannedDevice { id: string; name?: string; rssi?: number }
export interface ScannedDevice { id: string; name?: string; rssi?: number; serviceUuids?: string[] } // advertised; kept from an earlier advert when a later one omits it
export function orderDevices(devices: readonly ScannedDevice[], rememberedId: string | undefined, showAll: boolean): { shown: ScannedDevice[]; hidden: number };

// src/screens/DonglePicker.tsx (create; Stage B)
export function DonglePicker(props: { visible: boolean; rememberedId?: string; onPick: (device: ScannedDevice) => void; onDismiss: () => void }): JSX.Element;
```

## Files

Stage A goes first: the link, remembering and auto-connect. It keeps the inline Scan list, and it alone fixes the "reconnect each time" complaint. Stage B then adds the picker sheet.

Stage A:
- `apps/mobile/src/ble/dongleLink.ts` — create — link store, `runView`, dongle memory.
- `apps/mobile/src/chargeRun.ts` — modify — drop the manager and destroy (supersedes that part of T2.4 Decision 20; update its comment).
- `apps/mobile/src/app/runtime.ts` — modify — lazy `bleManager()`, `dongleLink`, `dongleMemory` over `dongles.json` (direct write, like `theme.txt`), and the `chargeRun` type.
- `apps/mobile/src/screens/ConsoleScreen.tsx` — modify — use `dongleLink`, apply the end-path table, auto-connect, the Connect row, the status texts, charge-log wiring.
- `apps/mobile/test/dongle-link.test.ts` — create — isolated L/V/M tests and the E2E K1.
- `apps/mobile/test/charge-run.test.ts` — modify — delete R2; R3 keeps its notify/clear assertions and drops destroy.
- `apps/mobile/test/charge-logger.test.ts` — modify — only the console-line literals in the two `X-2026-09-28 C3` tests, changed to the new wording.

Stage B:
- `apps/mobile/src/ble/BleTransport.ts` — modify — `serviceUuids` in the scan, `orderDevices`.
- `apps/mobile/src/screens/DonglePicker.tsx` — create — the bottom sheet.
- `apps/mobile/src/screens/ConsoleScreen.tsx` — modify — replace Scan and the list with Change/Choose dongle and the picker; the first-use auto-open.
- `apps/mobile/test/BleTransport.test.ts` — modify — the S1 and O tests.

## Sources

| Constant / behavior | Source |
|---|---|
| A fresh session writes only `ATZ`/`ATI` first, so a kept link needs no close between runs | docs/ELM327.md §Write safety, Input rules (the "A new `Elm327Session` or app `ConsoleSession`…" bullet); `docs/specs/X-2026-09-24-first-write.md` |
| An uncertain relay end closes BLE | `docs/specs/T0.6b-android-relay-mode.md` rule 7, end paths T1–T2 |
| Service FFF0 as the adapter signal | docs/ELM327.md §BLE specifics; `VEEPEAK_SERVICE_UUID` in `src/ble/BleTransport.ts`; `tools/spike/go.py` `find_dongle` |
| No pairing; the app connects directly | docs/ELM327.md §BLE specifics |
| The dongle stays powered, so the 12 V note stays | docs/ELM327.md §BLE specifics, last bullet; T2.5b |
| `new BleManager()` is a shared instance | react-native-ble-plx 3.5.1 `src/BleManager.js` (`sharedInstance`); T2.4 Decision 20 |
| Garage ids are never reused | `apps/mobile/src/garage/flow.ts` `add()` |
| The Veepeak's advertised name, and whether it advertises FFF0 | **No source.** Neither the spike nor the app writes the device name into a recording (`tools/spike/spike.py` meta; `recording.start` meta). Owner check B1 records both; `/obd|elm327|veepeak/i` is a UI heuristic only |

No OBD, AT, DTC or header constant is added or changed.

## Verification

**Shared (both stages):**
- [ ] `pnpm check` is green.
- [ ] `pnpm -F mobile typecheck` passes.
- [ ] `cd apps/mobile && pnpm exec expo export --platform android --output-dir /tmp/x-pd-export` passes (delete the output afterwards).
- [ ] The Expo fingerprint (`pnpm -F mobile exec fingerprint fingerprint:generate`) equals the HEAD `885bcab` baseline `e781dff043894daae732e6eeeaea13bd1ba2897c`. A mismatch is FAIL: this task needs no new dev client. The owner's installed client must already match this baseline; the Expo bump `2c3b546` and redesign Stage B needed a build, which is tracked in the redesign's Deferred to owner list, not here.
- [ ] Logic freeze: `git diff --stat <stage base> -- packages/ apps/mobile/src/{chargeLogger,batteryScan,batteryDiagnosisFlow,console,capture}.ts apps/mobile/src/relay/ apps/mobile/src/garage/` is empty.
- [ ] Every existing mobile test passes, with only the Files-listed test edits.
- [ ] The reviewer walks the end-path table in `ConsoleScreen.tsx`, checking:
  - each row's link action;
  - that no path calls `transport.close()` on the kept link or `manager.destroy()`;
  - that `bleBusy()` still gates every start handler synchronously.

**E2E (Stage A):**
- [ ] K1, in `test/dongle-link.test.ts`: one `ReplayTransport` over `fixtures/synthetic/battery-diagnosis-full-scan.jsonl` concatenated twice is the kept link. It is synthetic: no phone battery-scan recording is committed.
  - Run `runAndSaveBatteryDiagnosis` twice, each run on its own `runView` of that link.
  - Assert: both saved; the second recording's first `tx` is `ATZ\r` (a mismatch rejects in the replay); the underlying `close` is never called; history holds two reports.
  - Artifact `/tmp/x-persistent-dongle-kept-link.json`: per run, the status, scanStatus and first three tx, plus the underlying close count. The reviewer reads it.

**Isolated tests.** Failure modes, listed before any code. Each has one test that covers it and nothing else.

Link (`dongle-link.test.ts`, fake connect and disconnect):
- L1: two overlapping `connect(id)` calls (auto-connect and a tap) open two GATT connections. Expect one `deps.connect`, and both callers get the same connection.
- L2: `connect(other)` leaves the previous link open. Expect the old transport closed before the new connect.
- L3: a late disconnect event from a replaced connection clears the new one. Expect it ignored.
- L4: after a loss, `current()` still returns the dead connection, or its transport is not closed. Expect undefined, closed, and the listener called with `lost`.
- L5: the hold is wrong. `disconnect()` must hold and the next `connect()` must clear the hold; `drop()` and a loss must not hold.
- L6: a failed connect leaves `connecting()` true or a half-made connection current.
- L7: `reconnect()` returns the old connection, or connects a device other than the last one. After it fails, nothing is current and the next `reconnect()` retries the same id.
- L8: `drop()`/`disconnect()` notify with `lost`, which would make the screen run a second teardown. Expect no `lost`.

View:
- V1: `close()` closes the underlying link (today's bug).
- V2: a write after `close()` reaches the link.
- V3: data after `close()` reaches the closed view's listeners.
- V4: `close()` leaves the view's underlying subscription in place, so listeners pile up run after run.
- V5: the view reports `startsIdle: true` over a link that does not, which would skip the ATZ/ATI-first rule.

Memory:
- M1: a missing, corrupt or wrong-version file throws. Expect undefined.
- M2: remembering car A overwrites car B.
- M3: remembering without a name erases the stored name.
- M4: two quick `remember` calls lose one entry.

Charge run (`charge-run.test.ts`): R1, R3 (notify and clear only), R4 and R5 stay. R2 is deleted, because the record no longer owns a manager.

Order and scan (Stage B, `BleTransport.test.ts`):
- O1: the remembered device is not first, or it is hidden because its name does not match.
- O2: relevant devices are not ahead of the rest, or the RSSI order is wrong (ascending; a missing RSSI not last).
- O3: others are shown while Show all is off, or `hidden` miscounts them.
- O4: the name match is case-sensitive.
- O5: an unnamed device advertising FFF0 is not relevant.
- O6: the remembered device is matched by name instead of id (two dongles with the same name).
- S1: a later advertisement without service UUIDs erases the earlier `serviceUuids`.

**Hardware-only** (owner, phone and car, dev client at the fingerprint above). Each is NOT RUN until the owner does it; results and any private scan names go in `docs/task-runs/X-2026-09-28-persistent-dongle.md`.

Stage A:
- A1. Connect once from the list. Run battery check; the report opens. Tap Run check from the report: the check screen shows Connected at once, with no scan. Run a second check: it saves. Note both private scan file names.
- A2. From the check screen, go to Car › History › Settings and back. Still connected, with no reconnect.
- A3. Force-stop the app and reopen it. Car › Run check connects by itself ("Connecting to …", then "Connected to …"). Note the time to connect.
- A4. Tap Disconnect ("Disconnected by user."). Leave the screen and reopen it: there is no auto-connect, and the status says so. Tap Connect: it connects.
- A5. Cancel check mid-scan: the cancelled status shows and the link stays connected. Run again: it saves. (If the first `ATZ` fails once because the ELM was still busy, note it; a retry must work.)
- A6. With the link idle, unplug the dongle: "Disconnected: …" and the Connect button appear. Plug it back in and tap Connect.
- A7. With the dongle unplugged, open the check screen: auto-connect fails with the "Could not reach" line. Note how long it takes.
- A8. Start a charge log. Unplug the dongle for about 30 s, then plug it back in: the status shows "Lost the ELM327 …" and then "Starting the ELM327.". Tap Disconnect: the log stops and saves, and the link is closed and held.
- A9. Turn on "Don't keep activities" (developer options). Switch apps while connected and idle, then come back: the screen shows Connected, and a check runs.
- A10. The 12 V unplug card is still shown.

Stage B:
- B1. On a new garage car (nothing remembered), open the check screen: the sheet opens by itself.
  - Record the Veepeak's advertised name, whether it is listed above the Show all toggle, and its signal.
  - Pick it: it connects.
- B2. Change dongle while connected: the remembered dongle shows first ("Last used with this car"). System back and a tap outside each close only the sheet. Show all reveals the other devices and their hidden count.
- B3. Light and dark themes, and font scale 2.0: the sheet's rows wrap and stay reachable.

## Risks / open questions

- **Direct connect by id without a scan.** Auto-connect calls `connectToDevice(id)` on a device this runtime has not scanned. This is expected to work on Android, where ble-plx's id is the device address, but it is not verified on our phone. If A3 fails with "device not found", the repair is to scan for the remembered id and then connect. It must not add a timeout constant.
- **A slow failure.** With the dongle absent, the connect may take tens of seconds to fail (A7 measures it). Change dongle is disabled while connecting. If this is annoying, a follow-up can pass ble-plx's `timeout` connection option.
- **Unknown advertised name.** If the Veepeak advertises neither FFF0 nor a matching name, the first pick needs "Show all devices" (B1). A one-line follow-up then adds the observed name, cited to the task record.
- **Busy ELM after Cancel.** The next run's `ATZ` can be interrupted and fail `init` once. This is the same exposure as today's reconnect, and the ATZ/ATI-first rule keeps it write-safe (§Write safety).
- **Stable address.** The Veepeak's address is assumed to stay the same across unplugging. If B1 or A3 shows otherwise, remembering degrades to the picker.
- **Superseding T2.4.** T2.4 Decision 20's "end destroys the manager" part is superseded here. `docs/specs/T2.4-charge-logger.md` is not edited (closed task); this spec and the `chargeRun.ts` comment say so.
- No open questions for the owner. The hold after Disconnect is session-only (cleared by an app restart), a design choice made here, not a question.

## Decisions
