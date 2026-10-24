#!/usr/bin/env bash
# Usage: tools/sim/run-flows.sh p4 p9 p2
# SIMULATED: no car, no dongle; closes no OWNER-QUEUE item. Setup: tools/sim/README.md
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SIM="$ROOT/tools/sim"
APP=com.ev.obd
export JAVA_HOME="${JAVA_HOME:-$HOME/.jdks/jdk-17.0.20.1+1}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export MAESTRO_CLI_NO_ANALYTICS=1
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$HOME/.maestro/bin:$PATH"
FLOWS=("$@")
[ ${#FLOWS[@]} -gt 0 ] || FLOWS=(p4 p9 p2)

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$SIM/runs/$STAMP"
mkdir -p "$OUT"
SUMMARY="$OUT/summary.md"
STARTED=()
MISSES="$OUT/sim-misses.txt"
: > "$MISSES"

cleanup() { for pid in "${STARTED[@]}"; do kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT

{
  echo "# Simulated run $STAMP"
  echo
  echo "SIMULATED: no car, no dongle; closes no OWNER-QUEUE item"
  echo
  echo "| Flow | Result | Checks |"
  echo "|---|---|---|"
} > "$SUMMARY"

ROWS=()
record() { echo "| $1 | $2 | $3 |" >> "$SUMMARY"; }

boot_emulator() {
  if adb devices | grep -q '^emulator-.*device$'; then return; fi
  setsid emulator -avd obd_phone -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -no-metrics > "$OUT/emulator.log" 2>&1 &
  STARTED+=("$!")
  adb wait-for-device
  until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 3; done
}

start_metro() {
  if curl -s -o /dev/null http://localhost:8081/status; then return; fi
  (cd "$ROOT/apps/mobile" && CI=1 setsid pnpm exec expo start --dev-client --port 8081 > "$OUT/metro.log" 2>&1 & echo $! > "$OUT/metro.pid")
  STARTED+=("$(cat "$OUT/metro.pid")")
  until curl -s -o /dev/null http://localhost:8081/status; do sleep 2; done
}

install_app() {
  local apk="$ROOT/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
  [ -f "$apk" ] || { echo "no debug APK; build first (tools/sim/README.md)" >&2; exit 2; }
  adb install -r "$apk" > /dev/null
}

fresh_app() {
  adb shell am force-stop $APP
  adb shell pm clear $APP > /dev/null
  for p in BLUETOOTH_CONNECT BLUETOOTH_SCAN ACCESS_FINE_LOCATION POST_NOTIFICATIONS; do adb shell pm grant $APP android.permission.$p 2>/dev/null; done
}

seed() { adb shell "run-as $APP sh -c 'mkdir -p files && cat > files/$1'" < "$2"; }
app_cat() { adb shell "run-as $APP cat files/$1" 2>/dev/null | tr -d '\r'; }
app_ls() { adb shell "run-as $APP ls files/$1" 2>/dev/null | tr -d '\r'; }

maestro_flow() {
  local dir="$1" flow="$2"; shift 2
  mkdir -p "$dir"
  (cd "$dir" && maestro test --test-output-dir "$dir/$flow" "$@" "$SIM/flows/$flow.yaml" > "$dir/maestro-$flow.log" 2>&1)
}

collect_sim_misses() { adb logcat -d -s ReactNativeJS 2>/dev/null | grep '\[sim\]' >> "$MISSES"; adb logcat -c; }

flow_p4() {
  local dir="$OUT/p4" seeds="$OUT/p4/seed"; mkdir -p "$seeds"
  printf '{"version":1,"nextId":3,"vehicles":[{"id":"1","catalogId":"chevrolet-equinox-ev-2024","ownership":"mine"},{"id":"2","catalogId":"chevrolet-equinox-ev-2024","ownership":"mine"}],"interests":[]}' > "$seeds/garage.json"
  printf '{"version":1,"cars":{"1":{"id":"AA:BB:CC:DD:EE:01","name":"Fake real dongle"}}}' > "$seeds/dongles.json"
  fresh_app; seed garage.json "$seeds/garage.json"; seed dongles.json "$seeds/dongles.json"
  local result=PASS notes=""
  maestro_flow "$dir" p4-persistence || { result=FAIL; notes="maestro failed (see p4/maestro-p4-persistence.log)"; }
  app_cat dongles.json > "$dir/dongles.after.json"
  if grep -q 'AA:BB:CC:DD:EE:01' "$dir/dongles.after.json" && ! grep -q 'sim:' "$dir/dongles.after.json"; then notes="$notes dongles.json unchanged (real id kept, no sim id);"
  else result=FAIL; notes="$notes dongles.json changed;"; fi
  collect_sim_misses
  record p4 "$result" "$notes"
}

flow_p9() {
  local dir="$OUT/p9" seeds="$OUT/p9/seed"; mkdir -p "$seeds"
  printf '{"version":1,"nextId":2,"vehicles":[{"id":"1","catalogId":"chevrolet-equinox-ev-2024","ownership":"mine"}],"interests":[]}' > "$seeds/garage.json"
  fresh_app; seed garage.json "$seeds/garage.json"
  local result=PASS notes=""
  adb shell cmd bluetooth_manager disable > /dev/null; sleep 3
  maestro_flow "$dir" p9-picker || { result=FAIL; notes="maestro failed (see p9/maestro-p9-picker.log)"; }
  adb shell cmd bluetooth_manager enable > /dev/null
  local scans; scans="$(app_ls battery-scans/1)"
  echo "$scans" > "$dir/battery-scans.txt"
  local count; count="$(echo "$scans" | grep -c 'jsonl')"
  if [ "$count" = 1 ] && echo "$scans" | grep -q '^simulated-'; then
    local file; file="$(echo "$scans" | head -1)"
    app_cat "battery-scans/1/$file" > "$dir/scan.jsonl"
    if grep -q '"dir": "rx".*4902' "$dir/scan.jsonl"; then notes="$notes scan $file holds a 0902 reply (rx 4902) (wrong-model run saved nothing);"; else result=FAIL; notes="$notes no 0902 in $file;"; fi
  else result=FAIL; notes="$notes expected exactly one simulated- scan file, found $count;"; fi
  collect_sim_misses
  record p9 "$result" "$notes"
}

flow_p2() {
  local dir="$OUT/p2"; mkdir -p "$dir"
  local scratch; scratch="$(mktemp -d)"
  local ip=10.0.2.2 port=8765 token=simtoken
  local result=PASS notes=""
  local envs=(-e "RELAY_URL=ws://$ip:$port" -e "RELAY_TOKEN=$token")
  probe() { (cd "$ROOT" && OBD_RELAY_TOKEN=$token OBD_RELAY_PORT=$port setsid pnpm exec tsx tools/sim/relay-probe.ts "$1" "$scratch" > "$dir/probe-$1.log" 2>&1 & echo $! > "$dir/probe-$1.pid"); cat "$dir/probe-$1.pid"; }
  await_probe() { local n=0; until grep -q "$2" "$dir/probe-$1.log" 2>/dev/null; do sleep 1; n=$((n+1)); [ $n -gt "${3:-120}" ] && return 1; done; }
  printf '{"version":1,"nextId":2,"vehicles":[{"id":"1","catalogId":"chevrolet-equinox-ev-2024","ownership":"mine"}],"interests":[]}' > "$dir/garage.json"

  fresh_app; seed garage.json "$dir/garage.json"
  local pid; pid="$(probe smoke)"; STARTED+=("$pid")
  maestro_flow "$dir" p2-relay-connect "${envs[@]}" || { result=FAIL; notes="$notes relay connect failed;"; }
  if await_probe smoke "Replay matched live response" 120; then notes="$notes hil smoke matched live and replay;"; else result=FAIL; notes="$notes hil smoke did not finish;"; fi
  kill -- "-$pid" 2>/dev/null

  fresh_app; seed garage.json "$dir/garage.json"
  pid="$(probe guard)"; STARTED+=("$pid")
  maestro_flow "$dir" p2-relay-connect "${envs[@]}" || { result=FAIL; notes="$notes relay connect (guard) failed;"; }
  await_probe guard "PHONE CONNECTED" 60
  maestro_flow "$dir" p2-relay-cancel || { result=FAIL; notes="$notes Mode 04 Cancel flow failed;"; }
  if await_probe guard "^04: REFUSED" 30 && grep -q '^2E F190 00: REFUSED' "$dir/probe-guard.log"; then notes="$notes 2E refused by guard, 04 denied on phone;"; else result=FAIL; notes="$notes 2E/04 outcome missing;"; fi
  kill -- "-$pid" 2>/dev/null

  fresh_app; seed garage.json "$dir/garage.json"
  pid="$(probe hold04)"; STARTED+=("$pid")
  maestro_flow "$dir" p2-relay-connect "${envs[@]}" || { result=FAIL; notes="$notes relay connect (hold) failed;"; }
  maestro_flow "$dir" p2-relay-killed || { result=FAIL; notes="$notes prompt not shown before kill;"; }
  kill -- "-$pid" 2>/dev/null
  maestro_flow "$dir" p2-relay-ended || { result=FAIL; notes="$notes 'Relay ended mid-command' not shown;"; }
  [ "$result" = FAIL ] || notes="$notes relay killed mid-command shows 'Relay ended mid-command';"

  adb shell "run-as $APP sh -c 'cat files/captures/* files/battery-scans/*/* 2>/dev/null'" 2>/dev/null | tr -d '\r' > "$dir/app-captures.txt"
  cat "$scratch"/fixtures/recordings/*/* >> "$dir/app-captures.txt" 2>/dev/null
  if grep -q '"dir": "tx", "data": "04' "$dir/app-captures.txt"; then result=FAIL; notes="$notes tx 04 found in captures;"; else notes="$notes no tx 04 in captures;"; fi
  cp -r "$scratch/fixtures" "$dir/relay-recording" 2>/dev/null
  rm -rf "$scratch"
  collect_sim_misses
  record p2 "$result" "$notes"
}

boot_emulator
start_metro
install_app
adb reverse tcp:8081 tcp:8081 > /dev/null
adb logcat -c
for f in "${FLOWS[@]}"; do
  case "$f" in
    p4) flow_p4 ;;
    p9) flow_p9 ;;
    p2) flow_p2 ;;
    *) record "$f" FAIL "unknown flow" ;;
  esac
done

{
  echo
  echo "## Recorded-key misses (\`[sim]\` log lines)"
  if [ -s "$MISSES" ]; then sed 's/^/- /' "$MISSES"; else echo "none"; fi
  echo
  echo "Screenshots: tools/sim/runs/$STAMP/<flow>/"
} >> "$SUMMARY"
echo "$SUMMARY"
grep -q '| FAIL |' "$SUMMARY" && exit 1
exit 0
