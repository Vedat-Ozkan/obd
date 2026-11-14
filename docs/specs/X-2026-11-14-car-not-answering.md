# X-2026-11-14-car-not-answering: say "the car is not answering" in seconds

## Goal

When the car does not answer the first request, every flow reports the dongle's own `UNABLE TO CONNECT` instead of a session timeout, and the charge logger stops within about half a minute with a reason the owner can act on. Today the logger retries for ten minutes and ends with "no current for 10 min".

## Evidence

The three local charge-log attempts of 2026-09-28 (`fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-28-charge-log.jsonl`, `-2`, `-3`; not committed) hold 63 init attempts. In each, `0100` after `ATSP0` gets `SEARCHING...` and then `UNABLE TO CONNECT` 5.35–5.57 s after the request. `DEFAULT_TIMEOUT_MS` is 5000, so the session timed out every time before the reply arrived: the files record 53 sessions with reason `timeout` and none with the adapter's answer. Working sessions answer `0100` about 2.1 s after the request (`2026-09-24-phone-console.redacted.jsonl` lines 18–28). Why the car did not answer is unknown; the header note is a default string, not an observation.

## Non-goals

- No change to mid-charge recovery or the stop rules of T2.4 (Decisions 19–25) once a session has initialised.
- No reconnect of the BLE link on a failed init: the dongle answered every AT command in all 63 attempts.
- No change to retries, `RESYNC_MS`, or other commands' timeouts.

## Design

1. `packages/obd-core/src/elm/session.ts`: `runInit` sends both `0100` probes with `timeoutMs: PROTOCOL_SEARCH_TIMEOUT_MS` (new exported constant, 10000). Nothing else changes.
2. `apps/mobile/src/chargeLogger.ts`: while no session has ever initialised, an init that fails because the car did not answer `0100` counts as a start failure. The status line reads `The car is not answering (<adapter reply>). Is it switched on? Trying again in 5 s.` After `START_ATTEMPTS` (3) consecutive start failures the log stops with reason `the car did not answer (<adapter reply>)`. After the first successful init the existing behaviour applies unchanged.
3. `apps/mobile/src/ble/BleTransport.ts`: `connectVeepeak` passes `{ timeout: CONNECT_TIMEOUT_MS }` (15000) to `connectToDevice`, so a hung connect rejects and the existing retry paths run.

## Files

- `packages/obd-core/src/elm/session.ts` — edit — the constant and the two probe calls
- `packages/obd-core/test/` — one replay test (new file or the existing session replay file)
- `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-28-charge-log-2.redacted.jsonl` — create with `tools/spike/redact_vin.py` from the local original (35 lines, one attempt); never by hand
- `apps/mobile/src/chargeLogger.ts`, `apps/mobile/test/charge-logger.test.ts` — edit
- `apps/mobile/src/ble/BleTransport.ts`, `apps/mobile/test/BleTransport.test.ts` — edit
- `docs/ELM327.md` — edit — the `SEARCHING...` row gains the measured delay and the constant

## Sources

| Constant / behavior | Source |
|---|---|
| `UNABLE TO CONNECT` arrives 5.35–5.57 s after `0100` under `ATSP0` | the three 2026-09-28 charge-log recordings, 63 attempts (Evidence) |
| `PROTOCOL_SEARCH_TIMEOUT_MS` 10000 | project policy: about twice the slowest observed reply |
| `START_ATTEMPTS` 3, `CONNECT_TIMEOUT_MS` 15000 | project policy, not protocol facts |
| `timeout` connection option | `react-native-ble-plx` `ConnectionOptions.timeout` (`src/index.d.ts`) |

## Verification

Write each test before its code and run it against the unchanged code first; it must fail there for the stated reason.

- [ ] E2E: the redacted 2026-09-28 recording replayed through `Elm327Session.init` with recorded timing ends in an init error carrying the adapter's `UNABLE TO CONNECT` reply, not kind `timeout`. On unchanged code it reports `timeout`. If `ReplayTransport` cannot reproduce recorded delays, say so in the report and stop; do not fake the timing.
- [ ] App: a charge-logger run against the fake ELM answering `0100` with `SEARCHING...` then `UNABLE TO CONNECT` stops after three attempts, in under 60 s of fake time, with the stop reason and the recording's final meta line naming the car not answering. A run where the first init succeeds and a later one fails still follows the existing recovery path.
- [ ] `connectVeepeak` passes the timeout option; a rejected connect surfaces as today.
- [ ] Scoped checks green for `obd-core` and `apps/mobile` (`fast-checks` skill).
- [ ] Hardware-only (OWNER-QUEUE C1): at the car, start a charge log with the car off, then with it on; record which state answers.

## Risks / open questions

- Whether the Equinox answers diagnostics while switched off and charging is not known from any recording. The hardware item above settles it and decides how an overnight log has to be run.
