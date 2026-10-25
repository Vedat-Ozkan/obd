# Visual pass: six flows

SIMULATED: no car, no dongle; closes no OWNER-QUEUE or ACCESSIBILITY row. The agent is `visual-tester`. Findings are candidates for the lead, never fixed here.

Output: `tools/sim/runs/<date>-visual/` (`<date>` is `date +%Y%m%d`). Screenshots are named `f<flow>-<combo>-<nn>-<screen>.png`; `<combo>` is `<font>-<theme>-<rot>`, e.g. `1.0-light-p` (p portrait, l landscape). `summary.md` is the only other file.

## Setup commands (Bash, one call per block)

Environment, in every Bash call that uses these tools:

```
export JAVA_HOME=$HOME/.jdks/jdk-17.0.20.1+1 ANDROID_HOME=$HOME/Android/Sdk MAESTRO_CLI_NO_ANALYTICS=1
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$HOME/.maestro/bin:$PATH
OUT=tools/sim/runs/$(date +%Y%m%d)-visual; mkdir -p $OUT
```

Emulator and Metro, only if not already up (`adb devices` lists `emulator-*  device`; `curl -s localhost:8081/status` answers `packager-status:running`). Record each PID you start and stop only those at the end:

```
setsid emulator -avd obd_phone -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -no-metrics > $OUT/emulator.log 2>&1 &
echo $! > $OUT/emulator.pid
adb wait-for-device; until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 3; done
(cd apps/mobile && CI=1 setsid pnpm exec expo start --dev-client --port 8081 > ../../$OUT/metro.log 2>&1 & echo $! > ../../$OUT/metro.pid)
until curl -s -o /dev/null localhost:8081/status; do sleep 2; done
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

If the debug APK is missing, stop and report it (build steps are in `tools/sim/README.md`; the lead decides).

Fresh app (clears all app data):

```
adb shell am force-stop com.ev.obd; adb shell pm clear com.ev.obd
for p in BLUETOOTH_CONNECT BLUETOOTH_SCAN ACCESS_FINE_LOCATION POST_NOTIFICATIONS; do adb shell pm grant com.ev.obd android.permission.$p; done
```

Garage seed, one Equinox EV (flows 1, 2, 4, 5; skip for flows 3 and 6):

```
printf '{"version":1,"nextId":2,"vehicles":[{"id":"1","catalogId":"chevrolet-equinox-ev-2024","ownership":"mine"}],"interests":[]}' | adb shell "run-as com.ev.obd sh -c 'mkdir -p files && cat > files/garage.json'"
```

Start states (Maestro only for these; run from the repo root, after fresh app and seed):

| State | Command | Arrival |
|---|---|---|
| App home ("Add a vehicle" visible, consent screen passed) | `maestro test --test-output-dir $OUT/maestro-launch tools/sim/flows/launch.yaml` | Garage |
| Connected simulated car, saved parked report open | `maestro test --test-output-dir $OUT/maestro-report tools/sim/flows/start-report.yaml` | "Battery report" |
| Saved parked report with "Add a short drive" visible | `maestro test --test-output-dir $OUT/maestro-t218 tools/sim/flows/start-t218.yaml` | "Battery report", "Add a short drive" |

Maestro prints COMPLETED on success. If it fails, retry once; then record the flow as not reached with the log line.

Display settings (adb only). Always apply all three, then `sleep 3` and screenshot:

```
adb shell settings put system font_scale 1.0          # or 2.0
adb shell cmd uimode night no                         # light; "yes" for dark
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 0         # 0 portrait; 1 landscape
sleep 3
```

Driving the screens (adb only):

```
adb exec-out screencap -p > $OUT/<name>.png           # then Read the png
adb shell uiautomator dump /sdcard/ui.xml && adb exec-out cat /sdcard/ui.xml   # find text and bounds="[x1,y1][x2,y2]"
adb shell input tap <x> <y>                           # centre of the bounds
adb shell input swipe 540 1700 540 600 300            # scroll down; reverse the y values to scroll up
adb shell input text '<ascii>'                        # no spaces: use %s
adb shell input keyevent KEYCODE_BACK
```

After a font, theme or rotation change the layout moves: re-dump the UI before tapping. Do not tap blind.

Reset at the end (always, even after a failure):

```
adb shell settings put system font_scale 1.0
adb shell cmd uimode night no
adb shell settings put system user_rotation 0
adb shell settings put system accelerometer_rotation 1
adb shell cmd connectivity airplane-mode disable
```

Then `kill $(cat $OUT/metro.pid)` and `kill $(cat $OUT/emulator.pid)` for the ones you started, and confirm with `adb devices` and `curl` that they are gone. Delete the `.pid` files.

## Combos

Portrait set (P4): 1.0 light, 1.0 dark, 2.0 light, 2.0 dark, all `user_rotation 0`.
Landscape pass (L): 1.0 light with `user_rotation 1`, once, only for flows 1 and 4.

Every screenshot is read with Read and judged for: layout, text, truncation, contrast, dark mode, font scale 2.0, rotation, flow. Findings go to `summary.md` as `severity | screen | issue | screenshot path`, severity high, med or low.

## Flow 1: connect, battery check, report and sections

Combos: P4, then L. Per combo: fresh app, seed, then the start state "Connected simulated car, saved parked report open" (`start-report.yaml` performs steps 2 to 4 itself; take steps 2 to 4 by hand, with screenshots, for the first combo only, from "App home").
1. Apply the combo's display settings; screenshot the garage.
2. Tap "2024 Chevrolet Equinox EV", screenshot the car screen.
3. Tap "Run check"; on "Choose your OBD dongle" screenshot the picker and tap "Simulated car (Equinox EV)".
4. Screenshot "Run battery check", tap it, wait (poll the UI dump every 15 s, up to 240 s) for "Battery report".
5. Screenshot the report top and after one scroll; then open each row in turn (State of charge, Cell balance, Capacity, 12 V battery), screenshotting each and going back.

## Flow 2: codes report

Combos: P4. Start state "Connected simulated car, saved parked report open".
1. Apply the combo; scroll to and tap "Diagnostic codes"; screenshot the screen.
2. Scroll to the bottom and screenshot; tap one "Module" row if present and screenshot it; back.
3. Never tap a clear-codes or Mode 04 control. If one is visible, screenshot it and note it; do not press it.

## Flow 3: garage, picker, wrong model

Combos: P4. Start state "App home" with no seed.
1. Apply the combo; screenshot the garage; tap "Add a vehicle"; screenshot the list.
2. Add the Equinox EV; screenshot the garage and car screen.
3. Tap "Run check"; screenshot "Choose your OBD dongle" (both simulated rows; a BLE scan error row is expected).
4. Tap "Run check" back through to the picker, choose "Simulated car (wrong model VIN)", tap "Run battery check", wait up to 120 s for the message containing "did not answer as a", screenshot it.

## Flow 4: T2.18 short drive

Drive once, at 1.0 light portrait, from the start state "Saved parked report with Add a short drive visible".
1. Screenshot the report with "Add a short drive" visible.
2. Tap "Add a short drive"; screenshot the drive screen with its two "Start short drive" buttons.
3. Tap "Start short drive (10 min)". The simulated drive runs in real time: poll the UI dump every 60 s, screenshot at the start, at about 5 min and at completion (up to 15 min). The drive screen text says it stops and saves by itself.
4. Screenshot the result and open the drive report from "Report history" (a row ending "min drive"); screenshot it top to bottom.
5. Reopen the parked battery report from Report history and screenshot it.

Then, without a new drive, re-view the saved reports (the drive report and the parked report, opened from Report history) in 1.0 dark, 2.0 light and 2.0 dark portrait, and once in 1.0 light landscape (L). Do not clear app data between combos; apply display settings, reopen Report history, screenshot both reports.

## Flow 5: trends

Combos: P4. Start state "App home" with the seed.
1. Apply the combo; tap "2024 Chevrolet Equinox EV"; scroll to "Trends" and screenshot the empty state.
2. Tap Trends if it opens a screen; screenshot it. Populated only if the app already has trend data, which this pass does not seed: say "empty state only".

## Flow 6: beta consent

Combos: P4. Start state "App home" with the seed.
1. Apply the combo; tap "Settings"; tap "Beta data sharing"; screenshot (consent off).
2. Tap "Share my data to improve the app"; screenshot the consent screen "Help improve battery checks", scrolled to top and to the bottom.
3. Tap "Continue"; screenshot Beta data sharing with consent on. Do not enable airplane mode or run an upload; the backend is not required.
4. Turn consent off again and screenshot, so the next combo starts clean.
