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
| Recording path | NOT RUN |
| Date | NOT RUN |
| Laptop OS (meta `platform`) | NOT RUN |
| `bleak` version (meta `bleak`) | NOT RUN |
| Write / notify characteristic (meta) | NOT RUN |
| MTU (meta `mtu`) | NOT RUN |
| Dash SOC % (meta `note`) | NOT RUN |
| Ambient C (meta `note`) | NOT RUN |
| Replay (`pnpm -F obd-core test` with the file in the tree) | NOT RUN |

## 2. Phase A: standard sweep

| Item | Value |
|---|---|
| Mode 01 responders (`0100`) | NOT RUN |
| Bitmaps walked | NOT RUN |
| Mode 01 PIDs requested (meta `mode01_pids`, count) | NOT RUN |

| Module | `0900` bitmap | Infotypes requested | `090A` name | Notes |
|---|---|---|---|---|
| `17` | NOT RUN | NOT RUN | NOT RUN | |
| `28` | NOT RUN | NOT RUN | NOT RUN | |
| `40` | NOT RUN | NOT RUN | NOT RUN | |
| `45` | NOT RUN | NOT RUN | NOT RUN | |
| `CB` | NOT RUN | NOT RUN | NOT RUN | |

## 3. Phase B: coverage

From the phase-B end meta line (`stopped_early`, `last`, `counts`, `positives`).

| Module | Range | Requests | Positive | Negative | NO DATA | Other | Covered / cut |
|---|---|---|---|---|---|---|---|
| `CB` | 2000–2FFF | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| `CB` | 4000–43FF | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| `CB` | 8300–83FF | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| `17` | 2000–2FFF | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| `17` | 4000–43FF | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| `17` | F180–F1FF | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| `28` | F180–F1FF | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| `40` | F180–F1FF | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| `45` | F180–F1FF | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| `CB` | F180–F1FF | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

`stopped_early`: NOT RUN. Uncut remainder for a follow-up session (if stopped early): NOT RUN.

## 4. Phase C: watch

Watch list (meta `watch`) and dropped DIDs (meta `dropped`): NOT RUN.

| State | Start line | Cycles | Notes |
|---|---|---|---|
| idle baseline | NOT RUN | NOT RUN | |
| heater max on | NOT RUN | NOT RUN | |
| heater off | NOT RUN | NOT RUN | |
| plugged in and charging | NOT RUN | NOT RUN | |
| unplugged | NOT RUN | NOT RUN | |

Did charging start while the car was in Ready, or was the car switched off (spec Decision 6)? NOT RUN

## 5. Candidate table

A candidate changes with heater load and flips sign when charging. The recording line numbers are its citation (AGENTS.md hard rule 1).

| DID | Module | Reply length | Changes with heater (yes/no) | Sign flip on charge (yes/no) | Lines |
|---|---|---|---|---|---|
| NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

## 6. Gate B

Decision: `NOT DECIDED`

Criteria (`docs/PLAN.md` T2.3 and Gate B): a pack current or energy-counter signal is found and passes plausibility (current changes with load; its sign flips on charge). If not, T2.4 uses the charger-reported-kWh fallback and states its wider error band. The owner approves every signal before it counts; this card only proposes candidates.

Justification (citing recording line numbers): NOT RUN
