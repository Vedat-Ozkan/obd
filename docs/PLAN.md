# Plan

Revised 2026-09-22 (ADR-012, ADR-013): the product is battery health for hybrids, PHEVs, and EVs, with a deeper Ultium experience and an opt-in LLM summary and assistant; the gas-car diagnosis engine and the LLM fine-tuning track are withdrawn; the phone replaces the laptop as the hardware bridge, exposed to agents through MCP. Assumptions: full-time effort (40+ h/week), Android only, three cars available (2013 Chrysler 200 and 2019 Elantra as core test cars, 2024 Equinox EV as the battery car; no hybrid or PHEV owned), Veepeak OBDCheck BLE dongle, development in WSL2; the laptop is used for the T0.2 spike, after which the phone is the bridge (ADR-013). Delivery order is Phase 0 → Phase 2 → BM1–BM7 → Phase 3. Within Phase 0: T0.3 → T0.8 → T0.4 → T0.5 → T0.6 → the rest. Existing task IDs remain stable; withdrawn tasks stay listed, struck through. All future dates are provisional. See [ML.md](ML.md) and ADR-012.

Each task has a **verify** line. That line is the definition of done; the reviewer checks it, not the description. Tasks are sized for one implementer session (S: half a day, M: a day, L: two days). Anything larger gets split by the architect.

## Phase 0: Core, BLE, and the codes report (Sep 16 – Oct 16; provisional)

Goal: the app connects to any of the three cars, reads codes and readiness, and produces the codes / "recently cleared" section that every battery report includes. The EV spike decides how Phase 2 starts.

Milestone check (Oct 16): codes report produced on both ICE cars from the phone, with a recording of each session replaying green in CI. EV: spike recording and a Gate A decision.

| ID | Task | Size | Verify |
|---|---|---|---|
| ~~T0.1~~ ✅ 2026-09-16 | Scaffold monorepo: pnpm workspaces, TypeScript strict + ESM, vitest, lint, `pnpm check`, GitHub Actions running it. Empty `obd-core`, `obd-diagnose`, `obd-eval` packages. `tools/hil-bridge` with `uv` and a hello-world FastAPI. | S | `pnpm check` green on a clean clone; CI green on push. |
| T0.2 | **Hardware spike (no product code).** From the laptop with a throwaway `bleak` script, record raw transcripts on all three cars: `ATZ ATI ATE0 ATL0 ATS0 ATH1 ATSP0 ATDPN ATRV 0100 0120 0140 0101 0902 090A 03 07 0A`. On the Equinox EV additionally `ATSP7` and the four OBDb Mode 22 commands with their headers. Note what each car answers and response timing. Write `docs/spike-2026-09.md` with the table. Scope reduced 2026-09-22 for a short laptop session: the EV is required; the ICE cars are optional here and otherwise recorded from the phone console right after T0.8; the bridge reachability check is dropped (ADR-013). | M | EV recording under `fixtures/recordings/chevrolet-equinox-ev-2024/` exists; spike doc lists per-command outcome for every car recorded; a Gate A (go/no-go) line for Phase 2. |
| T0.3 | `obd-core`: `Transport` interface, `ReplayTransport` over the recording format, `ElmLineReader` (accumulate until `>`, strip echo, split lines, classify `NO DATA` / `SEARCHING...` / errors). | M | Unit tests against T0.2 recordings; every response class in `docs/ELM327.md` has a test. |
| T0.4 | `obd-core`: `Elm327Session`: init sequence, protocol select with fallback, single-flight command queue, per-command timeout, retry policy, ISO-TP multi-frame reassembly with headers on, response routing by ECU header. | L | Replay tests cover init on all three cars, a multi-frame VIN, a `SEARCHING...` first request, and a timeout; `pnpm replay` prints decoded frames. |
| T0.5 | `obd-core`: standard decoding. Supported-PID bitmaps (00/20/40/60/80/A0/C0), the Mode 01 PIDs the codes report needs and battery context (01, 1C, 21, 30, 31, 41, 42, 46, 4D, 4E; all from the original T0.5 list) plus the standard hybrid/EV PIDs (5B and any others in the checked-in J1979 table), Mode 02 freeze frame, Mode 03/07/0A DTC lists with P/C/B/U decoding, Mode 09 VIN and CAL ID, readiness monitors from PID 01 and 41. All formulas in a table-driven J1979 file checked into the repo. | L | Table-driven tests with known input bytes → values; DTC decode tests; VIN test from real recording; `pnpm replay` on each car's spike recording shows the decoded values. |
| T0.6 | Phone relay and car MCP server (ADR-013; runs after T0.8): app relay mode opens a WebSocket to `tools/relay` in WSL2; the relay exposes MCP tools `send_command`, `start_recording`, `stop_recording`, `list_signals`; a read-only allowlist enforced in the server (Mode 04 needs on-phone confirmation; UDS writes and unlisted commands rejected); recordings saved in the standard format; `pnpm hil:smoke` goes through the relay. Split into two specs if needed. | L | `pnpm hil:smoke` via the phone saves a recording that replays green; relay tests with a fake phone client cover allowlist rejections (`04` without confirmation, `2E`, `31`, `2F`, unknown commands) and disconnects. |
| T0.7 | `obd-core`: codes report model and the "recently cleared" heuristic: no stored DTCs AND monitors incomplete AND low PID 30/31/4E, with permanent DTCs (Mode 0A) as a strong signal. Report is a typed object plus a template renderer; every battery report embeds it. | M | Unit tests on synthetic fixtures for each branch; one real fixture recorded after actually clearing codes on the Chrysler (T0.2 follow-up). |
| T0.8 | App: Expo dev build (EAS), `react-native-ble-plx` via config plugin, scan and connect to the Veepeak, `BleTransport` implementing `Transport` with MTU chunking and notify reassembly, a debug console (type a command, see the reply), and in-app recording export in the standard format. Runs right after T0.3 (it needs only `Transport` and `ElmLineReader`); its console records the ICE baseline sessions that T0.4 and T0.5 test against. | L | On a phone: connect, `0100` succeeds from the console, recording exported and replays green. Start the EAS build early; it is mostly waiting. |
| T0.9 | App: codes report flow. Connect → scan → report → share as markdown/PDF via the share sheet. Handles `UNABLE TO CONNECT` and disconnects without hanging. | M | Manual run on both ICE cars; two session recordings added; replay test asserts the report fields. |
| T0.10 | Baseline fixtures for all three cars in healthy state, labeled, plus a `fixtures/README.md` describing the format and label schema. | S | `pnpm test` runs every recording through replay without error. |

Not in Phase 0: any LLM call in the app, EV-specific decoding beyond the spike, iOS.

## ~~Phase 1: Diagnostic engine for gas cars~~ (withdrawn by ADR-012)

Kept for history. The foreground-service work from T1.1 moves into T2.4, because charging sessions last hours.

| ID | Task | Status |
|---|---|---|
| ~~T1.1~~ | Drive logger: Android foreground service, PID polling with a priority schedule. | Withdrawn; foreground service moves to T2.4 |
| ~~T1.2~~ | Symptom anchor button. | Withdrawn |
| ~~T1.3~~ | `obd-diagnose` feature extraction over drive logs. | Withdrawn |
| ~~T1.4~~ | `obd-diagnose` case object. | Withdrawn |
| ~~T1.5~~ | `obd-diagnose` LLM diagnostic turn. | Withdrawn |
| ~~T1.6~~ | Induced-fault ground truth on the ICE cars. | Withdrawn |
| ~~T1.7~~ | `obd-eval` diagnostic harness. | Withdrawn; `obd-eval` is reused by BM2–BM5 |
| ~~T1.8~~ | App case screen and BYOK key entry. | Withdrawn; BYOK key entry moves to T2.10 |

## Phase 2: Battery health (Oct 19 – Dec 4; provisional)

Goal: a battery report for the Equinox EV that an owner would trust more than the dash, a used-EV pre-purchase report a buyer can show a seller, community-tier support for other hybrids, PHEVs, and EVs, and an opt-in LLM summary and assistant that never states a number the data does not contain. Built on verified signals and honest about unverified ones.

Gates:

- **Gate A (T0.2):** the EV answers Mode 22 under 29-bit CAN. GO → T2.1 as planned; RE-SCOPE → start with T2.3; NO-GO → blocked pending a different dongle or approach.
- **Gate B (T2.3):** a pack current or energy-counter signal is found and passes plausibility. If not, T2.4 uses the charger-reported-kWh fallback and states its wider error band.

Milestone check (Dec 4): report on own car covering SOC, cell min/max/spread, pack voltage if T2.3 finds it, and a capacity estimate with an error band from logged charges; a used-EV report on own car; beta testers from the Equinox EV owners' forum have run it; at least one non-Ultium vehicle promoted to verified by a recording.

| ID | Task | Size | Verify |
|---|---|---|---|
| T2.1 | Vehicle profiles in `obd-core`: 29-bit CAN setup (`ATSP7`, `ATCP`, `ATSH`, `ATCRA`, flow control), Mode 22 request/response with per-module headers, and an importer for OBDb signalset JSON (CC-BY-SA, vendored under its own license file) that marks every imported signal `community` until a recording promotes it to `verified`. | L | Replay test decodes the T0.2 EV recording into every OBDb signal the car answered (upstream 2024 data suggests the five `DACB` signals, not `33E5`); importer test shows tier flags. |
| T2.2 | Verify the OBDb signals on the 2024 car; submit a PR upstream with corrections. | S | Recording plus a note of which signals match dash values. |
| T2.3 | Ultium candidate discovery (Gate B), agent-driven through the car MCP server: an agent proposes candidates by porting Bolt EV BECM PIDs (community lists) to the Equinox headers, scans for responses, keep only signals that pass plausibility (temperature tracks ambient, current sign flips on charge). Priority: pack current, energy counters, HV pack voltage (upstream `33E5` is ≤25.5 V, so not the pack), cell/module temperatures. The owner approves every signal before it counts; each kept signal gets a recording and a "verified on 2024 Equinox EV" note. | L | A candidate table with verified/unverified columns; a Gate B line; agent proposal precision against the owner's verdicts, and session cost/time, recorded; no unverified signal reaches the report. |
| T2.3a | Equinox discovery session on the laptop (pulls T2.3's scan forward): `tools/spike/discover.py` records a standard sweep, a read-only Mode 22 scan of modules `CB`/`17` (plus `F180`–`F1FF` on all five), and a watch phase across idle, heater, and charging. Spec: `docs/specs/T2.3a-equinox-discovery.md`. Recording stays local until the redaction ADR. | M | Offline pytest proves only allowlisted AT/`01`/`09`/`22` requests and no VIN reads; one discovery recording from the user's session; run card lists answering DIDs and a Gate B candidate (or none). |
| T2.4 | Charging-session logger and capacity estimate: Android foreground service (from withdrawn T1.1) that survives a multi-hour charge with the screen off; log SOC, pack voltage, cell min/max, and pack current/energy if Gate B passed. Deterministic capacity estimate: integrated energy (or charger-reported kWh, entered by the user, if Gate B failed) over ΔSOC. The result is a "reference estimate" with a stated error band, never "truth". Cell imbalance from min/max spread. | L | One full-charge log on the Equinox with no gaps > 10 s; estimate and error band printed from replay; the fallback path tested on a synthetic log. |
| T2.5 | 12 V health (`ATRV` plus any module-reported 12 V), and a note on dongle drain: an always-on dongle on an EV's small 12 V battery is a real problem, so the app reminds the user to unplug. Deterministic thresholds, sourced. | S | Voltage in report; reminder shown. |
| T2.6 | Battery report screen and share. Text from templates in code; every number traceable to a logged value; wording is "observed data". Includes the T0.7 codes section. | M | Snapshot test of the rendered report from a replayed charge log; manual run on own car. |
| T2.7 | Used-EV pre-purchase report: one scan on a car the user does not own (battery snapshot, cell spread, 12 V, codes, "recently cleared"), designed to be shown to a buyer. Capacity shown only if a logged charge exists; otherwise marked NOT MEASURED. | M | Replay test over the Equinox recording asserts every field; manual run on own car. |
| T2.8 | Vehicle picker and community-tier profiles: load OBDb signalsets for hybrids, PHEVs, and EVs; show tier on every signal; promotion to `verified` requires a recording path in the profile. Standard J1979 hybrid/EV PIDs (T0.5) work on any car. | M | Tests that an unverified signal is always labeled; one non-Ultium vehicle promoted by a recording (beta tester, inspection customer with consent, or borrowed car). |
| T2.9 | Beta data export and intake: in-app export of recordings and charge logs with explicit consent, VIN redacted, provenance in the meta line; intake adds them under `fixtures/recordings/` with the recording tool, never by hand. No backend: files come back by user-initiated share. | M | An exported file round-trips into a replay test; VIN absent from the file; consent and provenance fields validated by zod. |
| T2.10 | Opt-in LLM report summary (`obd-assist`): the typed report goes to a hosted model through `LlmClient` (structured output, cached system prompt, model and effort as parameters); every number in the output is checked against the report before display; a failed check falls back to the template. BYOK key in the secure store; VIN never sent; works only when the user turns it on. | M | Summary on a replayed report validates; a doctored output with a wrong number is rejected and the template shown; key absent from logs and exports; `usage.cache_read_input_tokens` > 0 on the second call. |
| T2.11 | Opt-in battery assistant: chat that answers questions about the user's own data by calling tools (`list_sessions`, `get_session`, `get_capacity_estimate`, `get_codes`) and cites the values used; says when data is missing instead of guessing; same number check as T2.10. Beta-tester notes and imported files are treated as untrusted text. | M | Scripted question set on replayed data: every answer's citations resolve and numbers match; a prompt-injection case in an imported note does not change tool use; cost and latency logged per question. |

## Battery ML track: BM1–BM7 (Dec 7 – Jan 29; provisional, overlaps data collection)

Goal: models that make the battery report better, with measured uncertainty, running on the phone, plus the evaluation behind the in-app LLM. Completion requires reproducible evidence, not an improvement claim; a measured negative result completes a milestone. Details: [ML.md](ML.md). The earlier ML1–ML6 (LLM fine-tuning and serving) are withdrawn by ADR-012.

| ID | Task | Prerequisite | Verify |
|---|---|---|---|
| BM1 | Dataset pipeline: resample irregular BLE polling onto a time grid, dataset versions with manifests, provenance and consent per session, splits grouped by vehicle and session. | T2.4, T2.9 | Versioned dataset built from recordings by one command; split manifest shows no vehicle or session in two splits. |
| BM2 | Partial-charge capacity estimation with calibrated intervals (conformal prediction), compared with the T2.4 deterministic baseline. | BM1 | Per-vehicle error against the reference estimate and measured interval coverage, with n shown; results real-only. |
| BM3 | Cell-imbalance anomaly detection, evaluated with faults injected into real logs (labeled synthetic). | BM1 | Detection rate on injected faults and false positives on healthy sessions, reported separately. |
| BM4 | On-device deployment and drift monitoring: run the chosen model on the phone (runtime chosen in the spec; a pure-TS model needs no new dependency), measure latency and battery cost; flag input drift, e.g. after an over-the-air update. | BM2 or BM3 | Model output on the phone matches the offline model on the same inputs; latency measured on the phone; drift check fires on a shifted synthetic log. |
| BM5 | LLM eval infrastructure for T2.10/T2.11: faithfulness scoring (numbers match, unsupported claims, missed flags), an LLM-as-judge for the semantic parts calibrated against the owner's labels, a question set for the assistant, prompt-injection cases, prompt versioning, and a CI regression suite that replays saved model responses (no paid calls in CI). Compares hosted models on quality, cost, and latency. | T2.10, T2.11 | `pnpm eval` report with per-item results, judge-vs-owner agreement with n, cost and latency per model (IDs verified in the spec); CI suite fails on a deliberately broken prompt. |
| BM6 | Three write-ups: #1 partial-charge capacity as an n=1 case study (after BM2 on own car); #2 fleet results and the LLM eval (after beta data and BM5); #3 agentic engineering: the architect/implementer/reviewer loop, the Claude/Codex handoff, and agent-driven discovery through MCP, from `docs/task-runs/` and T2.3 evidence. | BM2–BM5 | Reproduction instructions, dataset documentation, failure examples, limitations, and what was NOT RUN. |

| BM7 (stretch) | Distillation: fine-tune a small open model (LoRA) on reviewed hosted-model summaries from BM5, and compare it with the hosted model on faithfulness, cost, and latency using the BM5 suite. | BM5 with enough reviewed summaries; model, compute, and spending cap in the spec | Reproducible run with revisions and settings; held-out comparison with n; a measured negative result counts. |

Also stretch: pretraining on simulated battery data (PyBaMM) and fine-tuning on real logs. Ultium cell parameters are not public, so this stays optional.

These are milestones, not single-session implementation specs; split them into bounded tasks before implementation. Model training and evaluation runs are separate from normal CI; a missing run is NOT RUN and blocks the milestone.

## Phase 3: stretch and distribution (after Phase 2; dates provisional)

Unordered. Pick by what Phase 2 and BM results say is worth it.

- Distribution: two Play Store listings (general battery app, Ultium app) from one codebase via EAS build variants; pricing and a license decision for the app (ADR-009); the thin API proxy with a usage cap for the LLM feature (ADR-007), priced from measured cost per report and per question.
- Full module scan on the EV via UDS `19 02` per module, once 29-bit enumeration is solid.
- More Ultium vehicles (Blazer EV, Silverado EV, Lyriq, Optiq, Prologue) as testers allow.
- iOS via EAS Build.
- `obd-core` published as a package with its own README, if the interfaces have held for two phases.

## Changes from the original plan

- **Battery health is the product (2026-09-22, ADR-012).** The gas-car diagnosis engine (Phase 1) and the LLM fine-tuning track (ML1–ML6) are withdrawn. The ICE cars stay as core test cars. Battery ML (BM1–BM6) replaces the fine-tuning track. Report text is templated first; an opt-in LLM summary and assistant sit on top, checked against the data (T2.10, T2.11).
- **Two signal tiers.** Community signals from OBDb are labeled unverified; recordings promote them.
- **Two gates for the EV.** T0.2 (Mode 22 answers) and T2.3 (a current or energy signal exists).
- **Bolt EUV replaced by Equinox EV.** There is no Bolt; there is a 2024 Equinox EV.
- **HIL bridge moves to a laptop near the car, then to the phone.** WSL2 has no Bluetooth stack and the desktop is out of range (ADR-003). After the spike, the phone is the bridge and agents reach the car through an MCP server with a read-only allowlist (ADR-013).
- **Android only until Phase 3.** See ADR-001.
- **A hardware spike is the second task of Phase 0** instead of discovering dongle and EV behavior mid-implementation.
- **Dates provisional.** The Sep 16 kickoff remains historical. Existing task IDs and completed-task history are preserved.
