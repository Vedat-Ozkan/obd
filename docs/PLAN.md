# Plan

Revised 2026-09-16 after the kickoff review. Assumptions this plan rests on: full-time effort (40+ h/week), Android only, three cars available (2013 Chrysler 200, 2019 Elantra, 2024 Equinox EV), Veepeak OBDCheck BLE dongle, development in WSL2 with the HIL bridge on a laptop near the car. Changes from the original plan are listed at the end.

Each task has a **verify** line. That line is the definition of done; the reviewer checks it, not the description. Tasks are sized for one implementer session (S: half a day, M: a day, L: two days). Anything larger gets split by the architect.

## Phase 0: Pre-purchase inspection tool (Sep 16 – Oct 9)

Goal: plug in, read the car, hand over a report that would change a buying decision. Ships for the two gas cars; on the EV it reports VIN plus whatever answers.

Milestone check (Oct 9): PPI report produced on both ICE cars from the phone, with a recording of each session replaying green in CI. EV: recording of the spike and a decision on Phase 2 scope.

| ID | Task | Size | Verify |
|---|---|---|---|
| T0.1 | Scaffold monorepo: pnpm workspaces, TypeScript strict + ESM, vitest, lint, `pnpm check`, GitHub Actions running it. Empty `obd-core`, `obd-diagnose`, `obd-eval` packages. `tools/hil-bridge` with `uv` and a hello-world FastAPI. | S | `pnpm check` green on a clean clone; CI green on push. |
| T0.2 | **Hardware spike (no product code).** From the laptop with a throwaway `bleak` script (it runs on Windows and Linux alike), or from a phone terminal app, record raw transcripts on all three cars: `ATZ ATI ATE0 ATL0 ATS0 ATH1 ATSP0 ATDPN ATRV 0100 0120 0140 0101 0902 090A 03 07 0A`. On the Equinox EV additionally `ATSP7` and the four OBDb Mode 22 commands with their headers. Note what each car answers and response timing, and confirm the laptop's bridge is reachable from WSL2 over the home Wi-Fi. Write `docs/spike-2026-09.md` with the table. | M | Three files under `fixtures/recordings/<car>/` exist; spike doc lists per-command outcome per car; a go/no-go line for Phase 2. |
| T0.3 | `obd-core`: `Transport` interface, `ReplayTransport` over the recording format, `ElmLineReader` (accumulate until `>`, strip echo, split lines, classify `NO DATA` / `SEARCHING...` / errors). | M | Unit tests against T0.2 recordings; every response class in `docs/ELM327.md` has a test. |
| T0.4 | `obd-core`: `Elm327Session`: init sequence, protocol select with fallback, single-flight command queue, per-command timeout, retry policy, ISO-TP multi-frame reassembly with headers on, response routing by ECU header. | L | Replay tests cover init on all three cars, a multi-frame VIN, a `SEARCHING...` first request, and a timeout; `pnpm replay` prints decoded frames. |
| T0.5 | `obd-core`: standard decoding. Supported-PID bitmaps (00/20/40/60/80/A0/C0), Mode 01 PIDs needed for PPI and Phase 1 (01, 04, 05, 06–09, 0B, 0C, 0D, 0F, 10, 11, 1C, 1F, 21, 2F, 30, 31, 33, 42, 46, 4D, 4E, 5B), Mode 02 freeze frame, Mode 03/07/0A DTC lists with P/C/B/U decoding, Mode 09 VIN and CAL ID, readiness monitors from PID 01 and 41. All formulas in a table-driven J1979 file checked into the repo. | L | Table-driven tests with known input bytes → values; DTC decode tests; VIN test from real recording; `pnpm replay` on each car's spike recording shows the decoded values. |
| T0.6 | HIL bridge: `bleak` client with service/characteristic discovery, `POST /cmd` (one ELM command, returns lines), `GET /status`, `POST /record/start|stop` writing `fixtures/recordings/*.jsonl`, `HttpTransport` in `obd-core`, `pnpm hil:smoke`. | M | `pnpm hil:smoke` against one car saves a recording that replays green; bridge `pytest` covers chunking and prompt detection with a fake BLE client. |
| T0.7 | `obd-core`: PPI report model and the "recently cleared" heuristic: no stored DTCs AND monitors incomplete AND low PID 30/31/4E, with permanent DTCs (Mode 0A) as a strong signal. Report is a typed object plus a markdown renderer. | M | Unit tests on synthetic fixtures for each branch; one real fixture recorded after actually clearing codes on the Chrysler (T0.2 follow-up). |
| T0.8 | App: Expo dev build (EAS), `react-native-ble-plx` via config plugin, scan and connect to the Veepeak, `BleTransport` implementing `Transport` with MTU chunking and notify reassembly, in-app recording export. | L | On a phone: connect, `0100` succeeds, recording exported and replays green. Start the EAS build on day 2 of the phase; it is mostly waiting. |
| T0.9 | App: PPI flow. Connect → scan → report → share as markdown/PDF via the share sheet. Handles `UNABLE TO CONNECT` and disconnects without hanging. | M | Manual run on both ICE cars; two session recordings added; replay test asserts the report fields. |
| T0.10 | Baseline fixtures for all three cars in healthy state, labeled, plus a `fixtures/README.md` describing the format and label schema. | S | `pnpm test` runs every recording through replay without error. |

Not in Phase 0: background logging, any LLM call, EV-specific decoding beyond the spike, iOS.

## Phase 1: Diagnostic engine for gas cars (Oct 12 – Nov 6)

Goal: log a drive in the background, capture the cold start, extract deterministic features, get a ranked list of hypotheses with evidence, and know how often it is right.

Milestone check (Nov 6): eval harness reports top-1 and top-3 accuracy over at least eight labeled fault cases plus healthy baselines, for at least two models, with cost and latency per case.

| ID | Task | Size | Verify |
|---|---|---|---|
| T1.1 | Drive logger: Android foreground service, PID polling with a priority schedule (fast: RPM, load, STFT/LTFT, MAF, TPS; slow: coolant, IAT, voltage), 1–5 Hz, append-only local storage, survives screen off for a 30-minute drive. | L | 30-minute drive log on the Chrysler with no gaps > 2 s; log exported and loads in the eval package. |
| T1.2 | Symptom anchor: a big button (and optional voice note) that timestamps "it just did it" into the log. | S | Anchor appears in the exported log at the right offset. |
| T1.3 | `obd-diagnose`: feature extraction, pure functions over a log: fuel trim mean/variance by load bin, warm-up coolant slope, time to closed loop, O2 switching rate, MAF vs RPM residual against a per-car baseline, RPM roughness at idle as a misfire proxy, Mode 06 misfire counts when available. | L | Unit tests with synthetic logs; snapshot tests on baseline recordings; a healthy baseline yields features inside declared ranges. |
| T1.4 | `obd-diagnose`: the case object (zod): vehicle, DTCs, freeze frame, readiness, features, symptom anchors, user-described symptom. Redacts VIN before leaving the device. | S | Schema tests; a case built from a baseline recording validates. |
| T1.5 | `obd-diagnose`: the diagnostic turn. Anthropic TypeScript SDK, `claude-opus-5` default with adaptive thinking, structured output (`messages.parse` + zod) returning ranked hypotheses each with evidence references into the case, a confidence, and one concrete next test. Reference material (PID meanings, common-fault patterns) in a cached system prompt. Model and effort are parameters, not constants. | M | Runs on a baseline case and a synthetic fault case; output validates; `usage.cache_read_input_tokens` > 0 on the second call. |
| T1.6 | Ground truth: run the induced-fault protocol in `docs/EVAL.md` on the Chrysler (six faults) and the Elantra (vacuum leak, MAF unplug, coolant sensor unplug). Each yields a labeled log plus DTC snapshot. Clear codes and confirm baseline between faults. | L (calendar: spread over the phase) | Nine labeled fault fixtures plus two baselines under `fixtures/recordings/`, each with a label file. |
| T1.7 | `obd-eval`: harness. Runs the engine over labeled fixtures, scores top-1/top-3 match against label, records cost, tokens, latency, model, effort. Compares `claude-opus-5`, `claude-sonnet-5`, and one hosted open-weight model behind the same interface. Writes a markdown report. | M | `pnpm eval` produces the report; a deliberately wrong label fails the score; results table committed to `docs/eval-results.md`. |
| T1.8 | App: case screen with symptom entry, hypothesis list with evidence, BYOK key entry in secure store, offline behavior (everything but the LLM turn works without network). | M | Manual run on a fault fixture replayed on-device; key never appears in logs or exports. |

## Phase 2: EV battery health for Ultium (Nov 9 – Dec 11)

Goal: a battery report for the Equinox EV that an owner would trust more than the dash, built on verified signals and honest about unverified ones. Go/no-go is decided by the T0.2 spike.

Milestone check (Dec 11): report on own car covering SOC, pack voltage, cell min/max/spread, and a capacity estimate from a logged full charge; at least one other Equinox EV owner has run it.

| ID | Task | Size | Verify |
|---|---|---|---|
| T2.1 | Vehicle profiles in `obd-core`: 29-bit CAN setup (`ATSP7`, `ATCP`, `ATSH`, `ATCRA`, flow control), Mode 22 request/response with per-module headers, and an importer for OBDb signalset JSON (CC-BY-SA, vendored under its own license file). | L | Replay test decodes the T0.2 EV recording into the six OBDb signals. |
| T2.2 | Verify the OBDb signals on the 2024 car; submit a PR upstream with corrections. | S | Recording plus a note of which signals match dash values. |
| T2.3 | Candidate discovery: port Bolt EV BECM PIDs (community lists) to the Equinox headers, scan for responses, keep only signals that pass plausibility (temperature tracks ambient, current sign flips on charge). Each kept signal gets a recording and a "verified on 2024 Equinox EV" note. | L | A candidate table with verified/unverified columns; no unverified signal reaches the report. |
| T2.4 | Charging-session logger and capacity estimate: log SOC and pack current/voltage through a full charge, integrate energy, compare to rated capacity. Cell imbalance report from min/max spread. | M | One full-charge log; the estimate is within a stated error band of the rated usable capacity. |
| T2.5 | 12 V health (`ATRV` plus any module-reported 12 V), and a note on dongle drain: an always-on dongle on an EV's small 12 V battery is a real problem, so the app reminds the user to unplug. | S | Voltage in report; reminder shown. |
| T2.6 | Report screen and share, same shape as the PPI report. Post to the Equinox EV owners' forum for beta. | S | One external user run. |

## Phase 3: stretch (Dec 2026 onward)

Unordered. Pick by what Phase 1 and 2 results say is worth it.

- Mode 06 on-board monitor results on the ICE cars (may return nothing on the Chrysler; the spike will tell).
- Active-test loop: hypothesis → guided action ("unplug X, rev to 2000") → capture → re-rank.
- Full module scan on the EV via UDS `19 02` per module, once 29-bit enumeration is solid.
- Open-weight model benchmarking on the eval harness via a hosted provider.
- Distribution: thin API proxy for the diagnostic feature, Play Store listing, pricing and a license decision for the app (ADR-009).
- iOS via EAS Build.
- `obd-core` published as a package with its own README, if the interfaces have held for two phases.

## Changes from the original plan

- **Bolt EUV replaced by Equinox EV.** There is no Bolt; there is a 2024 Equinox EV. The battery-health direction survives and gets broader (Ultium spans several GM models), but the community data for this specific car is thinner than for the Bolt, so it stays in Phase 2 behind a spike.
- **HIL bridge moves to a laptop near the car.** WSL2 has no Bluetooth stack and the desktop is out of range. See ADR-003.
- **No local GPU inference in Phases 0–2.** See ADR-002. The open-weight comparison arm uses a hosted provider.
- **Model routing simplified.** No cheap classifier tier. Deterministic feature extraction decides whether an LLM turn is even needed; one frontier model does the turn; model and effort are eval parameters. See ADR-006.
- **Android only until Phase 3.** See ADR-001.
- **A hardware spike is the second task of Phase 0** instead of discovering dongle and EV behavior mid-implementation.
- **Dates re-based** to a Sep 16 start with full-time effort. Phase lengths are unchanged; the original dates were already assuming this pace.
