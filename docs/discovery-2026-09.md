# Equinox EV discovery session, September 2026 (T2.3a)

Run card for `tools/spike/discover.py`. Spec: `docs/specs/T2.3a-equinox-discovery.md`. The tool records one file, `fixtures/recordings/chevrolet-equinox-ev-2024/<date>-discovery.jsonl`. Claude fills the result sections from that file. Every result cell starts as `NOT RUN`.

The recording stays **local only**. `.gitignore` excludes `fixtures/recordings/**/*-discovery*.jsonl` until the redaction ADR exists (spec Decision 3). It holds ECU names, calibration IDs, and `F18x` part and serial numbers, but no VIN: `0902` and `22 F190` are refused by the tool's allowlist.

## Desk prep (once, with internet)

1. Get the current `tools/spike/` (`discover.py`, `go.py`, `spike.py`) onto the laptop: `git pull` once it is pushed, or copy the three files.
2. `uv run tools/spike/discover.py --help`. This downloads Python and `bleak` now, so the car session needs no downloads.
3. If the Veepeak is paired in the OS Bluetooth settings, remove it.
4. Charge the laptop fully. The session takes about 25 minutes with the laptop left in the car.

## At the car (about 25 min)

Safety: the tool only reads (services `01`, `09`, `22`, plus a fixed list of AT setup commands). It never clears codes, changes sessions, or writes anything. Stay in Park with the parking brake on the whole time.

1. Park within reach of the home charger. The charging step needs the laptop left inside the car while you plug in.
2. Plug in the dongle. Car powered on and **Ready**, in **Park**, **parking brake** on. **HVAC off** at the start.
3. Note the battery % on the dash and the outside temperature.
4. In the `obd` folder, run `uv run tools/spike/discover.py`. Type the battery % and the temperature. It finds the dongle (choose it by number if asked) and prints the plan and the file name.
5. Phases A and B run on their own, about 15 minutes. Phase B prints a progress line every 5 s with an ETA. A `WARNING: the budget will cut ranges` line means the modules answer slowly. That is fine: the scan stops at 15 minutes and the recording says what was covered. **Do not press Enter during A or B.**
6. Phase C prints one instruction per state. Hold each state for at least 60 s and 3 cycles (the console counts both), then press Enter:
   1. idle baseline: HVAC off. Then heater to max (hot, fan high); press Enter once hot air flows.
   2. heater max on: after about 60 s, heater off; press Enter.
   3. heater off: after about 60 s, plug in the home charger; press Enter once the car or charger shows charging. **If charging does not start within about a minute in Ready, switch the car off and continue** (spec Decision 6); the tool keeps polling and records whatever the modules do. Leave the laptop in the car.
   4. plugged in and charging: after about 90 s, unplug the charger; press Enter.
   5. unplugged: after about 60 s, press Enter to finish.
7. The tool prints `Done` and disconnects. **Unplug the dongle** (12 V drain on the EV).
8. If the run stops early (BLE drop, the car powering off, Ctrl+C), keep the partial file and rerun; it goes to `-discovery-2.jsonl`. There is no resume. The tool can also stop itself with `aborted: UNABLE TO CONNECT` or `aborted: LV RESET`, for example after you switch the car off during the charging step. That is not a failure: everything recorded up to that point is kept and still counts.

## Time plan

Basis: 75 ms per physical Mode 22 request, about 100 ms per functional Mode 01 request, 30 ms per AT command, 243 ms per NO DATA (T0.2 EV recording).

| Step | Requests | Estimate |
|---|---|---|
| Prompts, BLE scan (10 s), connect | — | ~1 min |
| A: init + `0100` with SEARCHING | 9 | ~3 s |
| A: bitmaps `0120`–`0160` (+`0180` if flagged) | 3–4 | <1 s |
| A: flagged Mode 01 PIDs | 47 + ≤31 | ~5–8 s |
| A: `ATSP7`/`ATCP` + 5 × (3 AT + `0900` + ≤6 infotypes) | ~55 | ~5 s |
| B: `CB` 2000–2FFF | 4096 | 5.1 min |
| B: `CB` 4000–43FF | 1024 | 1.3 min |
| B: `CB` 8300–83FF | 256 | 0.3 min |
| B: `17` 2000–2FFF | 4096 | 5.1 min |
| B: `17` 4000–43FF | 1024 | 1.3 min |
| B: `F180`–`F1FF` × 5, minus `F190` | 635 | 0.8 min |
| B total | 11,131 | 13.9 min at 75 ms; hard stop 15 min |
| C: watch, 5 states × 60–90 s + walking to the charger | cycles ≤ 15 s | 6–8 min |
| Total | | about 21–25 min |

## What to bring back

The `.jsonl` file, copied to the desktop as a file (USB, cloud drive, or similar) into `fixtures/recordings/chevrolet-equinox-ev-2024/`. Never open and re-save it in an editor. Say where it landed. It stays out of git (see above).

## 1. Session setup

| Item | Value |
|---|---|
| Recording path | `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-discovery.jsonl` (local only, gitignored; SHA-256 `520fc8fb…c53`, 71,898 lines, 16,882 tx) |
| Date | 2026-09-23 (run length 1,282 s) |
| Laptop OS (meta `platform`) | Windows-11-10.0.26200-SP0 |
| `bleak` version (meta `bleak`) | 3.0.2 |
| Write / notify characteristic (meta) | `FFF2` / `FFF1` |
| MTU (meta `mtu`) | 247 (as reported by bleak; not authoritative) |
| Dash SOC % (meta `note`) | 85 |
| Ambient C (meta `note`) | 15 |
| Replay (`pnpm -F obd-core test` with the file in the tree) | **FAIL**: `no '>' after "ATRV\r" (line 49776)`. Line 49775 (the `ATRV` reply, t 869.744) was recorded before its tx line 49776 (same t): the tool writes the tx line after the BLE write returns, and this one write stalled ~1 s at the start of phase C. Only occurrence in the file (0 in the T0.2 spike files). Tool fix needed; the recording stays as is. Update 2026-09-23: fixed in the tools by T2.3b; this file now replays with one SHA-256-keyed exemption for tx line 49776 (`packages/obd-core/test/recordings.test.ts`). |

## 2. Phase A: standard sweep

| Item | Value |
|---|---|
| Mode 01 responders (`0100`) | `17`, `28`, `40`, `45`, `CB` |
| Bitmaps walked | `0100`–`01C0` as flagged (`01A0` answered by `17` only) |
| Mode 01 PIDs requested (meta `mode01_pids`, count) | 50 (line 75). Decoded with docs/ELM327.md formulas: `31` 7,922 km since codes cleared; `30` 149/150 warm-ups; `42` 13.2–14.0 V per module; `21` 0 km; `0D` 0 km/h. `A6` raw `0004F8A9` (scaling not in the repo yet; 32,580.1 km if ×0.1 km, check against the dash). `46` flagged but not answered. |

| Module | `0900` bitmap | Infotypes requested | `090A` name | Notes |
|---|---|---|---|---|
| `17` | `54400000` | 04, 06, 0A | DMCM-DriveMotorCtrl | lines 227–256 |
| `28` | `55600000` | 04, 06, 08, 0A, 0B | CHCM-ChassisCtrl | lines 271–335 |
| `40` | `14400000` | 04, 06, 0A | BCM-BodyControl | lines 353–451 |
| `45` | `14400000` | 04, 06, 0A | GWM-Gateway | lines 466–491 |
| `CB` | `14400000` | 04, 06, 0A | BECM-B+EnergyCtrl | lines 506–528 |

## 3. Phase B: coverage

From the phase-B end meta line (`stopped_early`, `last`, `counts`, `positives`).

| Module | Range | Requests | Positive | Negative | NO DATA | Other | Covered / cut |
|---|---|---|---|---|---|---|---|
| `CB` | 2000–2FFF | 4096 | 752 | 3343 | 1 | 0 | covered |
| `CB` | 4000–43FF | 1024 | 1 | 1023 | 0 | 0 | covered |
| `CB` | 8300–83FF | 256 | 0 | 256 | 0 | 0 | covered |
| `17` | 2000–2FFF | 4096 | 291 | 3805 | 0 | 0 | covered |
| `17` | 4000–43FF | 1024 | 7 | 1017 | 0 | 0 | covered |
| `17` | F180–F1FF | 127 | 15 | 112 | 0 | 0 | covered |
| `28` | F180–F1FF | 127 | 16 | 111 | 0 | 0 | covered |
| `40` | F180–F1FF | 127 | 16 | 111 | 0 | 0 | covered |
| `45` | F180–F1FF | 127 | 14 | 113 | 0 | 0 | covered |
| `CB` | F180–F1FF | 127 | 16 | 111 | 0 | 0 | covered |

`stopped_early`: false (line 49772); every range covered in 848 s. Uncut remainder: none. Classification here is recomputed from the replies (per-range counts); the tool's own per-module totals are in line 49772.

## 4. Phase C: watch

Watch list (line 49773): 201 single-frame DIDs on `CB` (`2023`–`29C4`); **0 on `17`**. Dropped: 881 (every multi-frame `CB` DID, `CB` single-frame DIDs from `29C5`, all of `17`), because the cap stops at the first DID that overflows 15 s. Cycle ≈ 15.3 s.

| State | Start line | Cycles | Notes |
|---|---|---|---|
| idle baseline | 49774 | 5 | heater already switching on in the last cycle |
| heater max on | 53873 | 5 | heater off during the last cycle |
| heater off | 57969 | 5 |  |
| plugged in and charging | 62067 | 7 | charging actually ran from about t 1125 to t 1190 (about 60 s) |
| unplugged | 67800 | 5 | HV load values read 0: car was off |

Did charging start while the car was in Ready, or was the car switched off (spec Decision 6)? The data points to the car being switched off: `27C8` goes 4 → 3 when charging starts and 10 after unplug, and the load-like values (`2979`, `297D`, `2982`) drop to 0–1 after unplug. The owner confirms.

## 5. Candidate table

A candidate changes with heater load and flips sign when charging. The recording line numbers are its citation (AGENTS.md hard rule 1).

| DID | Module | Reply length | Changes with heater (yes/no) | Sign flip on charge (yes/no) | Lines |
|---|---|---|---|---|---|
| `2979` / `297D` / `2982` | `CB` | 1 | yes (≈3 → 22–35) | no; rises to 56–79 on charge (magnitude, unsigned) | 49773–71898 (watch) |
| `2984`, `2985`, `2988`, `2989` | `CB` | 1–2 | yes, rise and slow decay | no (thermal-looking: lag and exponential decay) | watch |
| `270C` / `2707` | `CB` | 1–2 | yes (4000 → 12599–15138; 5 → 11–20) | no; back to baseline on charge | watch |
| `27CD` | `CB` | 2 | no | charge-only (0 → 44–49 → 0) | watch |
| `27CE` | `CB` | 2 | no | charge-only (0 → 30, then 1254/1249 after charge) | watch |
| `27AF` | `CB` | 2 | falls 1 count | rises 7486 → 7500 during charge (energy-like) | watch |
| `276D` | `CB` | 2 | falls slowly | rises 55508 → 55602 (84.7% of 65535; dash 85%: SOC-like) | watch |

Not watched but decoded from phase B (single snapshot, idle):
- `2AE1`–`2AE7` (`CB`, 36 bytes each): 80 records of [u16 cell-group voltage ×0.0001 V][module 1–10]; 10 modules × 8 groups; min 4.0769 V, max 4.0796 V, average 4.0777 V. The average and minimum equal `2AF5`'s exactly.
- `2AF5` tail `09 02 22 05`: record index and module of the minimum (9, module 2) and maximum (34, module 5), matching the records.
- `2B43` (26 bytes): pack SOC (0xD8, 84.7%) then 10 per-module SOC bytes (module 5: 85.1%, the rest 84.7%).
- `2AF7` (`CB`, 8 bytes `7F62 0000 7F6D 0000`): 326.10 V and 326.21 V at 0.01 V; 80 × 4.0777 V = 326.2 V. Pack-voltage candidate; its scaling is inferred, not sourced.
- Single-byte triples `2771`–`277F`, `2793`–`27A1`: first and third byte equal; 0x38–0x39 at idle (16–17 °C if raw−40, ambient 15 °C). `2793`–`27A1` barely move with the heater (battery-like); `2771`–`277F` move fast (coolant-like). Scaling inferred, not sourced.

## 6. Gate B

Decision: superseded by §7.5 (**GO**, owner, 2026-09-23). This session alone did not pass: no watched value flipped sign.

Criteria (`docs/PLAN.md` T2.3 and Gate B): a pack current or energy-counter signal is found and passes plausibility (current changes with load; its sign flips on charge). If not, T2.4 uses the charger-reported-kWh fallback and states its wider error band. The owner approves every signal before it counts; this card only proposes candidates.

Justification (citing recording line numbers): no watched value flips sign on charge, so no pack-current signal passes plausibility yet. The best load candidate, `2979`/`297D`/`2982`, behaves like an unsigned power magnitude (roughly 0.3 → 2–3.5 → 5.6–7.9 in units that fit 0.1 kW), not a signed current. Charging ran only about 60 s, and every multi-frame `CB` DID plus all of `17` went unwatched (cap), so current may still be in the unwatched set. Proposal for the owner: keep Gate B open and run a short targeted watch (the phase-B positives on `17`, the `CB` multi-frame DIDs, and `2AF7`) with a charge of at least 5 minutes, after fixing the tx-ordering bug.

## 7. Targeted watch (T2.3b)

Run card for `tools/spike/targeted.py`. Spec: `docs/specs/T2.3b-targeted-watch.md`. The tool records one file, `fixtures/recordings/chevrolet-equinox-ev-2024/<date>-discovery-targeted.jsonl`, which stays **local only** (same `.gitignore` pattern as above). It runs no phase-B scan. It re-runs phase A, then polls the checked-in list `tools/spike/targeted_watch.json`:
- **core**, every cycle (~8 s): the 17 `CB` DIDs `2979`, `297D`, `2982`, `27CD`, `27CE`, `27AF`, `276D`, `2AF7`, `2AF5`, `2AE1`–`2AE7`, `2B43`;
- **rotate**, time-sliced 6 s per cycle: 839 DIDs (`CB` multi-frame positives, the 336 `CB` single-frame positives T2.3a never watched, and every `17` positive; no `F180`–`F1FF`, no `2E8E`).

Every entry cites its phase-B tx line in the 2026-09-23 recording (§1). The recorder now writes each tx line before the BLE write, so the §1 replay defect cannot recur.

### Desk prep (once, with internet)

1. Get the current `tools/spike/` onto the laptop: `discover.py`, `go.py`, `spike.py`, **`targeted.py`, and `targeted_watch.json`**. Use `git pull` once it is pushed, or copy the files.
2. `uv run tools/spike/targeted.py --help`. This downloads Python and `bleak` now, so the car session needs no downloads.
3. If the Veepeak is paired in the OS Bluetooth settings, remove it. Charge the laptop.

### At the car (about 15 min)

Safety: as in T2.3a. The tool only reads (`01`, `09`, `22`, and the same fixed AT list). Park, parking brake on, the whole time.

1. Park within reach of the home charger. Plug in the dongle. Car in **Ready**, **Park**, **HVAC off**.
2. Note the battery % on the dash and the outside temperature.
3. Run `uv run tools/spike/targeted.py`. Type the battery % and the temperature. It prints the plan, finds the dongle, and prints the file name.
4. Phase A runs on its own (~20 s). **Do not press Enter during it.**
5. The watch prints one instruction per state and a status line after every cycle: time in state, cycles, rotation progress, and `full rotation done` once every rotating DID was read in that state. **The tool refuses an early Enter**: before `full rotation done` in any state, and before 5:00 of charging. It then prints what is still missing (DIDs or time left) and keeps polling; press Enter again when done. **Press Enter only once per attempt, and only after the status line says you may.** Extra presses stay queued and would end the next stage early (reviewer finding, T2.3b round 1).
   1. idle baseline: HVAC off. After `full rotation done`, heater to max (hot, fan high); press Enter once hot air flows.
   2. heater max on: after `full rotation done`, heater off; press Enter.
   3. heater off: after `full rotation done`, plug in the home charger; press Enter once the car or charger shows charging. **If charging does not start within about 1 minute in Ready, switch the car off, wait for charging, then press Enter.** Leave the laptop in the car.
   4. plugged in and charging: the console shows `charging m:ss of 5:00, do not unplug yet`. Once it says 5:00 reached and `full rotation done`, unplug and press Enter.
   5. unplugged: after `full rotation done`, press Enter to finish.
6. The tool prints `Done` and disconnects. **Unplug the dongle.**
7. If the run stops early (BLE drop, the car powering off, Ctrl+C, or `aborted: UNABLE TO CONNECT` / `aborted: LV RESET`), keep the partial file; it is still valid. A rerun goes to `-discovery-targeted-2.jsonl`.

### Time plan

Basis: spec Time budget (phase-B times from the 2026-09-23 recording). Cycle ≈ 7.8 s; full rotation ≈ 101 s (13 cycles); ≈ 131 s+ if `17` goes silent with the car off.

| Step | Estimate |
|---|---|
| Prompts, BLE scan, connect | ~1 min |
| Phase A (reused sweep) | 0.3 min |
| idle baseline (1 rotation) | 1.7 min |
| heater max on (1 rotation) | 1.7 min |
| heater off (1 rotation, plus walking and plugging in) | ~2 min |
| plugged in and charging (≥ 5 min, ≥ 2 rotations) | 5–5.5 min |
| unplugged (1 rotation; slower if the car is off) | 1.7–2.7 min |
| Total | ≈ 13.5–15 min |

### What to bring back

The `-discovery-targeted.jsonl` file, copied as a file (never re-saved in an editor) into `fixtures/recordings/chevrolet-equinox-ev-2024/`. Say where it landed and whether the car was switched off to charge. It stays out of git.

### 7.1 Session setup

| Item | Value |
|---|---|
| Recording path, SHA-256, lines | `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-discovery-targeted.jsonl` (local, gitignored); SHA-256 `4df9d9352c6aedadbe023d94fd789f2182b0e7ed952bd2e7db00d9094715d6cc`; 84,154 lines, 10,434 tx |
| Date, run length | 2026-09-23, 916.5 s |
| Laptop OS, `bleak` version, characteristics, MTU (meta) | Windows-11-10.0.26200-SP0, 3.0.2, write `FFF2` / notify `FFF1`, 247 (not authoritative) |
| Dash SOC %, ambient C (meta `note`) | 86, 18 |
| `watch_list_sha256` (phase-C meta) | `3e4e6e01c4931a2d27a81dd368f2473fe856b9758a5b6fa31b6b5377520b4481` (line 542; 17 core, 839 rotate) |
| Replay (`pnpm -F obd-core test`, no exemption) | PASS (`recordings.test.ts`, 8/8, 2026-09-23) |

### 7.2 Phase A delta vs T2.3a

| Item | T2.3a (§2) | T2.3b |
|---|---|---|
| Mode 01 responders, PIDs requested | `17`, `28`, `40`, `45`, `CB`; 50 | same five; same 50 PIDs (line 75) |
| `0900` bitmaps and `090A` names | §2 table | same (phase A reused) |
| Differences | — | none in the PID set; `31` still 7,922 km, `A6` raw `0004F8A9` unchanged |

### 7.3 States

| State | Start line | Cycles | Rotations | Ignored marks | Notes |
|---|---|---|---|---|---|
| idle baseline | 543 | 31 | ≥ 1 (enforced) | 0 | |
| heater max on | 23031 | 14 | ≥ 1 | 0 | |
| heater off | 33280 | 16 | ≥ 1 | 0 | plugged in a few seconds before the mark (current already −26.35 A at line 44364, t 484) |
| plugged in and charging | 44553 | 42 | ≥ 3 | 0 | duration 322 s (t 487 → 809) |
| unplugged | 74351 | 14 | ≥ 1 | 0 | |

Car switched off to charge (yes/no): no. The owner confirms it stayed in Ready throughout.

### 7.4 Candidate table

A candidate changes with heater load and flips sign when charging. The recording line numbers are its citation.

| DID | Module | Reply length | Changes with heater (yes/no) | Sign flip on charge (yes/no) | Lines |
|---|---|---|---|---|---|
| `2414` | `17` | 2 | yes: +0.9 / +1.2 A idle → **+12.9 A** heater (line 26002) | **yes: −26.35 / −26.35 / −25.75 / −25.45 A** charging (lines 44364, 53458, 62601, 71935); +1.2 A unplugged (81233) | 7620–81233 (rotating, 9 samples) |
| `2885` | `17` | 2 | slight sag 327.4 → 326.1 V | no sign; rises 328.2 → 329.3 V while charging | 8072–81688 (9 samples) |
| `27AF` | `CB` | 2 | falls 0.01 kWh per ~8 s | rises 74.76 → 75.52 kWh while charging | core, every cycle |
| `2AF7` | `CB` | 8 | sags 326.0 → 325.3 V | rises 327.0 → 328.2 V while charging | core |
| `2429` | `17` | 2 | no (0x5806 constant) | no | rotating |

Scalings used (from the public captures in `reports/Ultium battery app trajectory review.md`; not yet in a checked-in signalset): `2414` s16 ÷ 20 A (negative = into the pack), `2885` u16 ÷ 100 V, `27AF` u16 ÷ 100 kWh, `276D` u16 × 100/65535 %.

Cross-checks inside this recording:
- **Power, two ways.** Charging: I × V = −26.0 A × 328.7 V ≈ **8.5 kW** into the pack; `27AF` rose 0.74 kWh from t 488 to t 802 (314 s) ≈ **8.5 kW**. Heater: 12.9 A × 326.1 V ≈ **4.2 kW**; `27AF` fell 0.12 kWh from t 250 to t 350 ≈ **4.3 kW**. They agree.
- **First idle disagrees; likely explained.** `2414` read about 0.3–0.4 kW at two instants (t 92, t 190), while `27AF` (0.07 kWh over 230 s ≈ 1.1 kW) and the `276D` SOC drop (≈ 0.95 kW) both say about 1 kW on average. `ATRV` climbed 12.7 → 13.6 V during that idle: the DC-DC converter recharging the 12 V battery after wake-up, plus wake-up loads (owner: it was a true idle). The likely explanation is a varying load between two sparse current samples, not a sensor fault; not verified. The last idle (fan on, per owner) agrees: I × V ≈ 0.39 kW against ≈ 0.44 kW from SOC. Consequence for T2.4: poll `2414` every cycle, not in rotation.
- **12 V observation.** The owner confirms the car stayed in Ready for the whole recording. `ATRV` held 13.6 V from t 119 (line 9703) through the first ~220 s of charging, then stepped down at t 710 (13.6 → 12.6 → 11.7 V, lines 64960–65440) and ran a slow sawtooth (11.7 → 12.2 V, then back to 11.7 V) until the end, including after unplug. Module `17` kept answering, and pack current stayed +1.2 A after unplug, so the car was awake. Cause unverified: a DC-DC low-voltage regulation mode after the 12 V battery was topped up fits the shape; an internal power-state change or a dongle measurement quirk are the alternatives. Consequence for T2.5: a single `ATRV` value is not a health verdict; record the context and judge only under a defined condition.
- **Capacity proxy.** `27AF` ÷ SOC(`276D`) = **88.4 kWh** at the start, 88.36 at charge start, 88.45 at charge end, and 88.45 at the end (four points, 15 minutes). The same ratio from `2B43` SOC gives 88.5–88.7. The T2.3a single sample gave ~88. This is the BMS's own energy figure scaled to 100 %, not a measured capacity; compare with GM's published figure once it is sourced.
- **Charge in amp-hours.** −26 A for 314 s ≈ 2.27 Ah for 0.754 % SOC (`276D`), so ≈ 301 Ah per 100 %. 301 Ah × 327 V ≈ 98 kWh, which matches the incremental ΔE/ΔSOC (0.74 kWh / 0.754 % ≈ 98 kWh). The average E/SOC (88.4) is lower because the pack sits well above its average voltage at 85 %. Four current samples only; provisional.

### 7.5 Gate B

Decision: **GO** (owner, 2026-09-23).

Justification: `17`/`2414` flips sign on charge (+12.9 A heater at line 26002; −26.35 A charging at line 53458; +1.2 A after unplug at line 81233), and I × V with `2885` matches the `27AF` energy slope within about 1 % both charging and heating. That passes the PLAN Gate B plausibility criterion. An energy counter (`27AF`) is also present, so T2.4 does not need the charger-kWh fallback. Caveats: the scalings come from other Ultium owners' public captures and become hard-rule-1 sources only once this recording is cited in a checked-in profile (T2.1); and the idle mismatch above is unexplained.
