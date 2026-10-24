#!/usr/bin/env bash
# Usage: tools/sim/run-flows.sh p4 p9 p2 p10 p12 p13
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

reset_display() {
  adb shell settings put system font_scale 1.0 2>/dev/null
  adb shell cmd uimode night no > /dev/null 2>&1
  adb shell settings put system user_rotation 0 2>/dev/null
  adb shell settings put system accelerometer_rotation 1 2>/dev/null
  adb shell cmd connectivity airplane-mode disable > /dev/null 2>&1
}
cleanup() {
  reset_display
  for pid in "${STARTED[@]}"; do kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null; done
  sleep 3
  for pid in "${STARTED[@]}"; do kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null; done
}
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
  (cd "$ROOT/apps/mobile" && CI=1 EXPO_PUBLIC_BETA_URL="${BETA_URL:-}" setsid bash -c 'echo $$ > "$0"; exec pnpm exec expo start --dev-client --clear --port 8081' "$OUT/metro.pid" > "$OUT/metro.log" 2>&1 &)
  until [ -s "$OUT/metro.pid" ]; do sleep 0.2; done
  STARTED+=("$(cat "$OUT/metro.pid")")
  METRO_OURS=1
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
  local tag="${MAESTRO_TAG:-$flow}"
  (cd "$dir" && maestro test --test-output-dir "$dir/$tag" "$@" "$SIM/flows/$flow.yaml" > "$dir/maestro-$tag.log" 2>&1)
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
  stop_probe() { kill "$(cat "$scratch/probe.pid" 2>/dev/null)" 2>/dev/null; rm -f "$scratch/probe.pid" "$scratch/go"; sleep 1; }
  probe() { (cd "$ROOT" && OBD_RELAY_TOKEN=$token OBD_RELAY_PORT=$port setsid pnpm exec tsx tools/sim/relay-probe.ts "$1" "$scratch" > "$dir/probe-$1.log" 2>&1 < /dev/null & echo $! > "$dir/probe-$1.pid"); PROBE_PID="$(cat "$dir/probe-$1.pid")"; }
  await_probe() { local n=0; until grep -q "$2" "$dir/probe-$1.log" 2>/dev/null; do sleep 1; n=$((n+1)); [ $n -gt "${3:-120}" ] && return 1; done; }
  printf '{"version":1,"nextId":2,"vehicles":[{"id":"1","catalogId":"chevrolet-equinox-ev-2024","ownership":"mine"}],"interests":[]}' > "$dir/garage.json"

  fresh_app; seed garage.json "$dir/garage.json"
  local pid; probe smoke; pid="$PROBE_PID"; STARTED+=("$pid")
  maestro_flow "$dir" p2-relay-connect "${envs[@]}"
  if await_probe smoke "hil:smoke: REFUSED relay: the connected phone is a simulated car" 120; then notes="$notes hil:smoke refused the simulated phone, no recording written;"; else result=FAIL; notes="$notes hil:smoke did not refuse the simulated phone;"; fi
  [ -z "$(find "$scratch" -name '*.jsonl' 2>/dev/null)" ] || { result=FAIL; notes="$notes recording written by smoke;"; }
  stop_probe

  fresh_app; seed garage.json "$dir/garage.json"
  probe guard; pid="$PROBE_PID"; STARTED+=("$pid")
  maestro_flow "$dir" p2-relay-connect "${envs[@]}" || { result=FAIL; notes="$notes relay connect (guard) failed;"; }
  await_probe guard "PHONE CONNECTED" 60; touch "$scratch/go"
  maestro_flow "$dir" p2-relay-cancel || { result=FAIL; notes="$notes Mode 04 Cancel flow failed;"; }
  if await_probe guard "^04: REFUSED" 30 && grep -q '^2E F190 00: REFUSED' "$dir/probe-guard.log"; then notes="$notes 2E refused by guard, 04 denied on phone (evidence: probe-guard.log);"; else result=FAIL; notes="$notes 2E/04 outcome missing;"; fi
  stop_probe

  fresh_app; seed garage.json "$dir/garage.json"
  probe hold04; pid="$PROBE_PID"; STARTED+=("$pid")
  maestro_flow "$dir" p2-relay-connect "${envs[@]}" || { result=FAIL; notes="$notes relay connect (hold) failed;"; }
  touch "$scratch/go"
  maestro_flow "$dir" p2-relay-killed || { result=FAIL; notes="$notes prompt not shown before kill;"; }
  stop_probe
  maestro_flow "$dir" p2-relay-ended || { result=FAIL; notes="$notes 'Relay ended mid-command' not shown;"; }
  [ "$result" = FAIL ] || notes="$notes relay killed mid-command shows 'Relay ended mid-command';"

  adb shell "run-as $APP sh -c 'cat files/captures/* files/battery-scans/*/* 2>/dev/null'" 2>/dev/null | tr -d '\r' > "$dir/app-captures.txt"
  cat "$scratch"/fixtures/recordings/*/* >> "$dir/app-captures.txt" 2>/dev/null
  if [ ! -s "$dir/app-captures.txt" ]; then notes="$notes no captures to check (see probe-guard.log);"
  elif grep -q '"dir": "tx", "data": "04' "$dir/app-captures.txt"; then result=FAIL; notes="$notes tx 04 found in captures;"
  else notes="$notes no tx 04 in captures;"; fi
  cp -r "$scratch/fixtures" "$dir/relay-recording" 2>/dev/null
  rm -rf "$scratch"
  collect_sim_misses
  record p2 "$result" "$notes"
}

set_display() {
  adb shell settings put system font_scale "$1"
  adb shell cmd uimode night "$2" > /dev/null
  adb shell settings put system accelerometer_rotation 0
  adb shell settings put system user_rotation "$3"
  sleep 3
}

flow_p12() {
  local dir="$OUT/p12"; mkdir -p "$dir"
  local result=PASS notes=""
  printf '{"version":1,"nextId":2,"vehicles":[{"id":"1","catalogId":"chevrolet-equinox-ev-2024","ownership":"mine"}],"interests":[]}' > "$dir/garage.json"
  fresh_app; seed garage.json "$dir/garage.json"
  reset_display
  MAESTRO_TAG=setup maestro_flow "$dir" p12-setup || { result=FAIL; notes="setup (battery check to get a report) failed;"; }
  local density; density="$(adb shell wm density | grep -o '[0-9]*$' | tail -1)"
  local ran=0 failed=0 combo
  for font in 1.0 2.0; do for night in no yes; do for rot in 0 1; do
    combo="font${font}-$([ $night = yes ] && echo dark || echo light)-$([ $rot = 1 ] && echo landscape || echo portrait)"
    set_display "$font" "$night" "$rot"
    ran=$((ran+1))
    if ! MAESTRO_TAG="walk-$combo" maestro_flow "$dir" p12-walk; then failed=$((failed+1)); notes="$notes $combo FAILED;"; fi
    adb shell uiautomator dump /sdcard/a11y.xml > /dev/null 2>&1 && adb pull /sdcard/a11y.xml "$dir/a11y-$combo.xml" > /dev/null 2>&1
  done; done; done
  reset_display
  [ $failed = 0 ] || result=FAIL
  notes="$notes $((ran-failed))/$ran combinations walked (font 1.0/2.0 x light/dark x portrait/landscape);"
  (cd "$ROOT" && pnpm exec tsx tools/sim/a11y-audit.ts "$density" "$dir"/a11y-*.xml > "$dir/a11y-audit.md" 2>&1); local audit=$?
  if [ $audit = 0 ]; then notes="$notes a11y audit in p12/a11y-audit.md (findings listed, not fixed);"; else notes="$notes a11y audit NOT CHECKED for some dumps (see p12/a11y-audit.md);"; fi
  collect_sim_misses
  record p12 "$result" "$notes"
}

flow_p13() {
  local dir="$OUT/p13"; mkdir -p "$dir"
  local result=PASS notes=""
  printf '{"version":1,"nextId":2,"vehicles":[{"id":"1","catalogId":"chevrolet-equinox-ev-2024","ownership":"mine"}],"interests":[]}' > "$dir/garage.json"
  fresh_app; seed garage.json "$dir/garage.json"
  MAESTRO_TAG=empty maestro_flow "$dir" p13-trends -e "EXPECT=Appears after a battery check or a charge log." && notes="$notes empty state shown;" || { result=FAIL; notes="$notes empty state not shown;"; }
  (cd "$ROOT" && pnpm exec tsx tools/sim/seed-trend.ts "$dir/charge-summaries.json" 1 > "$dir/seed-trend.log" 2>&1) || { result=FAIL; notes="$notes seed-trend failed;"; }
  fresh_app; seed garage.json "$dir/garage.json"; seed charge-summaries.json "$dir/charge-summaries.json"
  MAESTRO_TAG=populated maestro_flow "$dir" p13-trends -e "EXPECT=BMS-referenced capacity index.*" && notes="$notes populated state shown (2 SYNTHETIC charge summaries from fixtures/synthetic/charge-log-rested.jsonl via saveChargeLogSummary; too few sessions for a slope, so the caption says not enough data);" || { result=FAIL; notes="$notes populated state not shown;"; }
  collect_sim_misses
  record p13 "$result" "$notes"
}

BETA_TOKEN=simadmin
BETA_HOST=http://localhost:8787
admin_get() { curl -s -H "Authorization: Bearer $BETA_TOKEN" "$BETA_HOST$1"; }
admin_code() { curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $BETA_TOKEN" "$BETA_HOST$1"; }
manifest_keys() {
  local body; body="$(admin_get /admin/manifests)"
  case "$body" in '{"keys":['*) echo "$body" | grep -o 'files/[^"]*manifest.json' ;; *) touch "$OUT/p10/count-error"; return 1 ;; esac
}
manifest_count() { manifest_keys | wc -l; }

flow_p10() {
  local dir="$OUT/p10"; mkdir -p "$dir"
  local result=PASS notes=""
  if [ -z "${BETA_URL:-}" ] || [ "${METRO_OURS:-0}" != 1 ]; then record p10 FAIL "Metro was already running without EXPO_PUBLIC_BETA_URL; stop it and rerun;"; return; fi
  (cd "$ROOT/tools/beta-backend" && WRANGLER_SEND_METRICS=false CI=1 setsid bash -c 'echo $$ > "$0"; exec pnpm dlx wrangler@4.142.0 dev --local --ip 0.0.0.0 --port 8787 --persist-to "$1" --var "ADMIN_TOKEN:$2"' "$dir/wrangler.pid" "$dir/wrangler-state" "$BETA_TOKEN" > "$dir/wrangler.log" 2>&1 &)
  until [ -s "$dir/wrangler.pid" ]; do sleep 0.2; done
  STARTED+=("$(cat "$dir/wrangler.pid")")
  local n=0; until [ "$(admin_code /admin/manifests)" = 200 ]; do sleep 2; n=$((n+1)); [ $n -gt 90 ] && { record p10 FAIL "wrangler dev did not start (see p10/wrangler.log);"; return; }; done
  printf '{"version":1,"nextId":2,"vehicles":[{"id":"1","catalogId":"chevrolet-equinox-ev-2024","ownership":"mine"}],"interests":[]}' > "$dir/garage.json"
  fresh_app; seed garage.json "$dir/garage.json"
  local base; base="$(manifest_count)"; echo "objects before: $base" > "$dir/objects.txt"

  MAESTRO_TAG=off maestro_flow "$dir" p10-beta -e STEP=off && notes="$notes consent off: run saved with no beta sentence;" || { result=FAIL; notes="$notes consent-off step failed;"; }
  sleep 5
  local c1; c1="$(manifest_count)"; echo "after consent off: $c1" >> "$dir/objects.txt"
  [ "$c1" = "$base" ] && notes="$notes no object while off ($c1);" || { result=FAIL; notes="$notes object appeared while sharing off;"; }

  MAESTRO_TAG=on maestro_flow "$dir" p10-beta -e STEP=on && notes="$notes consent on: 'Queued for beta upload.' shown;" || { result=FAIL; notes="$notes consent-on step failed;"; }
  n=0; until [ "$(manifest_count)" -gt "$c1" ] || [ $n -gt 30 ]; do sleep 2; n=$((n+1)); done
  local c2; c2="$(manifest_count)"; echo "after on (codes-scan, online): $c2" >> "$dir/objects.txt"
  [ "$c2" -gt "$c1" ] && notes="$notes codes-scan object arrived ($c1 -> $c2);" || { result=FAIL; notes="$notes no object after sharing on;"; }

  adb shell cmd connectivity airplane-mode enable > /dev/null; sleep 5
  MAESTRO_TAG=airplane maestro_flow "$dir" p10-beta -e STEP=again || { result=FAIL; notes="$notes airplane capture step failed;"; }
  sleep 10
  local c3; c3="$(manifest_count)"; echo "airplane, capture queued: $c3" >> "$dir/objects.txt"
  [ "$c3" = "$c2" ] && notes="$notes airplane: capture queued, not uploaded ($c3);" || { result=FAIL; notes="$notes object count changed in airplane mode;"; }
  adb shell cmd connectivity airplane-mode disable > /dev/null
  sleep 75
  adb shell input keyevent KEYCODE_HOME; sleep 2
  adb shell monkey -p $APP -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1
  n=0; until [ "$(manifest_count)" -gt "$c3" ] || [ $n -gt 30 ]; do sleep 2; n=$((n+1)); done
  local c4; c4="$(manifest_count)"; echo "airplane off, 75 s backoff elapsed, foregrounded: $c4" >> "$dir/objects.txt"
  [ "$c4" -gt "$c3" ] && notes="$notes foreground upload with no tap ($c3 -> $c4);" || { result=FAIL; notes="$notes no upload after foreground;"; }

  MAESTRO_TAG=scan maestro_flow "$dir" p10-beta -e STEP=scan || { result=FAIL; notes="$notes battery check step failed;"; }
  n=0; until [ "$(manifest_count)" -gt "$c4" ] || [ $n -gt 30 ]; do sleep 2; n=$((n+1)); done
  local c5; c5="$(manifest_count)"; echo "after battery check: $c5" >> "$dir/objects.txt"
  manifest_keys > "$dir/manifests-before-delete.txt"
  local kinds=""; local key
  while read -r key; do kinds="$kinds $(admin_get "/admin/objects/$key" | grep -o '"kind":"[a-z-]*"' | head -1)"; done < "$dir/manifests-before-delete.txt"
  echo "kinds:$kinds" >> "$dir/objects.txt"
  if [ "$c5" -gt "$c4" ] && echo "$kinds" | grep -q '"kind":"battery-scan"'; then notes="$notes battery-scan object arrived (kinds:$kinds);"; else result=FAIL; notes="$notes no battery-scan object (kinds:$kinds);"; fi

  : > "$dir/objects-before-delete.txt"
  while read -r key; do
    echo "$key" >> "$dir/objects-before-delete.txt"
    local parts; parts="$(admin_get "/admin/objects/$key" | grep -o '"bytes"' | wc -l)"; local i=0
    while [ $i -lt "$parts" ]; do echo "${key%manifest.json}part-$(printf %03d $i).jsonl" >> "$dir/objects-before-delete.txt"; i=$((i+1)); done
  done < "$dir/manifests-before-delete.txt"
  local install; install="$(head -1 "$dir/manifests-before-delete.txt" | cut -d/ -f2)"

  MAESTRO_TAG=delete maestro_flow "$dir" p10-beta -e STEP=delete || { result=FAIL; notes="$notes Delete my data step failed;"; }
  sleep 5
  local c6; c6="$(manifest_count)"; echo "after Delete my data: $c6 manifests" >> "$dir/objects.txt"
  local total=0 remain=0
  while read -r key; do total=$((total+1)); [ "$(admin_code "/admin/objects/$key")" = 404 ] || remain=$((remain+1)); done < "$dir/objects-before-delete.txt"
  echo "objects under files/$install/ before delete: $total, still present after: $remain" >> "$dir/objects.txt"
  admin_get /admin/tombstones > "$dir/tombstones.json"
  if [ -f "$dir/count-error" ]; then result=FAIL; notes="$notes admin listing failed at least once, NOT CHECKED: see p10/count-error;"
  elif [ "$total" -gt 0 ] && [ "$remain" = 0 ] && grep -q "$install" "$dir/tombstones.json"; then notes="$notes Delete my data: all $total objects under files/<installId>/ are gone, tombstone present;"
  else result=FAIL; notes="$notes after delete: $remain of $total objects remain or no tombstone;"; fi
  notes="$notes step 5 (intake into fixtures/recordings) NOT RUN by design;"
  collect_sim_misses
  record p10 "$result" "$notes"
}

boot_emulator
BETA_URL=""; case " ${FLOWS[*]} " in *" p10 "*) BETA_URL=http://10.0.2.2:8787 ;; esac
start_metro
install_app
adb reverse tcp:8081 tcp:8081 > /dev/null
adb logcat -c
for f in "${FLOWS[@]}"; do
  case "$f" in
    p4) flow_p4 ;;
    p9) flow_p9 ;;
    p2) flow_p2 ;;
    p10) flow_p10 ;;
    p12) flow_p12 ;;
    p13) flow_p13 ;;
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
