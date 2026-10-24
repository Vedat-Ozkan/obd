# tools/sim: simulated car at the desk

SIMULATED: no car, no dongle; closes no OWNER-QUEUE item. A simulated run can de-risk a phone check. It never ticks one (AGENTS.md hard rule 3). Every simulated artifact is labelled: `simulated-` file stem, `dongle: "simulated"` in recording meta, and the header of each `summary.md`.

The simulator (`packages/obd-core/src/transport/simulated.ts`) answers only from committed `*.redacted.jsonl` recordings. A command with no recorded reply fails loudly and is listed under "Recorded-key misses" in `summary.md`.

## One-time setup (nothing here is committed)

- JDK 17: `~/.jdks/jdk-17.0.20.1+1` (`run-flows.sh` defaults `JAVA_HOME` to it). Only JDK 11 is the system default.
- Android SDK under `~/Android/Sdk`: `ndk;27.1.12297006` (the version pinned by React Native 0.86) and `cmake;3.22.1`, installed with `sdkmanager`.
- AVD `obd_phone` from `system-images;android-35;google_apis_playstore;x86_64`, made with `avdmanager create avd -n obd_phone -k "system-images;android-35;google_apis_playstore;x86_64" -d pixel_6`. The other AVDs on this machine are automotive images.
- Maestro CLI 2.11 in `~/.maestro/bin`, with `MAESTRO_CLI_NO_ANALYTICS=1` (the runner sets it). No cloud.
- Debug APK: `cd apps/mobile && pnpm exec expo prebuild --platform android --no-install`, then `cd android && ./gradlew app:assembleDebug -PreactNativeArchitectures=x86_64`. This is the build `expo run:android` performs, without the install step. `apps/mobile/android/` is gitignored.

## Run

`bash tools/sim/run-flows.sh p4 p9 p2` boots `obd_phone` headless, starts Metro on 8081 if it is not running, installs the APK, runs the flows, and writes `tools/sim/runs/<stamp>/summary.md` with screenshots under `<stamp>/<flow>/`. It stops only the emulator and Metro it started. Each flow starts from `pm clear` plus seeded files (`adb shell run-as com.ev.obd`). The dev client opens through the deep link `exp+obd://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081`.

| Flow | Checks |
|---|---|
| p4 | A remembered fake real dongle id stays in `dongles.json` after a simulated run; the saved report is listed under its garage entry and absent from a second same-model entry after force-stop and reopen. |
| p9 | Picker shows both simulated rows with a BLE scan error (Bluetooth is disabled for this flow); the Equinox run saves a scan with an rx `4902` reply; the wrong-model row shows the mismatch message and saves nothing. |
| p2 | Relay mode, Mode 04 Cancel, 2E refusal, relay killed mid-command. Blocked, see Limits. |

`relay-probe.ts` is the laptop side of p2. It uses a scratch root so nothing lands in `fixtures/recordings/` (`pnpm hil:smoke` writes there and never sends 2E).

## Limits

- Not recorded, so they fail loudly: Mode 04, `19 02 FF` (module DTC capture stops at `DA17F1|19 02 FF`), charge-phase data (charge logs replay drive-phase values).
- Recorded as `NO DATA` only: `|014D`, `|014E`, `DA1DF1|22 33E5`. Source: `pnpm sim:coverage`.
- `labelled()` (apps/mobile/src/app/runtime.ts) reads the link's dongle kind at save time. A link swapped mid-run labels the file by the final link.
- The emulator has Bluetooth but no dongles. A remembered real dongle id makes the console auto-connect and wait about 30 s before "Could not reach".
- P2 is blocked: the relay broker (`tools/relay/broker.ts`, hello schema) accepts only `dongle: "veepeak-obdcheck-ble"` and `mtu > 0`, and the simulated link has `mtu 0`. The relay drops the phone right after the hello ("Relay disconnected."). Relay code is out of scope for this task, so p2 is NOT RUN.
