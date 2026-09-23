# Applied ML: battery health

Planned track, adopted 2026-09-22 (ADR-012); it replaces the withdrawn LLM fine-tuning track (ML1–ML6, ADR-011). No dataset, model, or measurement exists yet. BM1–BM9 follow the Phase 2 charging logger and beta data export; see [PLAN.md](PLAN.md).

## Question and boundaries

Can the project measure a battery's real condition from its own OBD signals, independently of the BMS, with honest uncertainty, and detect a weak cell group early, all running on the phone? The work is measurement first (ADR-016): the hard part is constructing trustworthy labels and error budgets where no ground truth exists. The opt-in LLM only explains numbers this code already computed and checked. A reproducible negative result is a successful experiment.

Decoding, units, and the deterministic estimators stay in tested TypeScript. Every model output in a report is labeled as an estimate with its interval, and never replaces a measured value.

**References, not truth.** The BMS energy figure (`CB`/`27AF` ÷ SOC, ≈ 88.4 kWh on 2026-09-23) is a comparison, not the reference: dividing by the BMS's own SOC mostly reads GM's capacity number back. The project's reference is the independent estimator below (current integrated between OCV-anchored SOC points). Neither is ground truth; reports state which method each number uses. Source: `reports/Battery ML depth beyond LLM wrappers.md`.

## Experiment sequence

| Task | Deliverable | Required evidence |
|---|---|---|
| BM1 | Dataset pipeline and OCV curve | Resampling onto a time grid; rested-voltage windows extracted per session; an OCV–SOC curve for this car built from rested points across SOC; dataset versions with manifests, provenance and consent; splits grouped by vehicle and session |
| BM2 | Independent capacity estimator and Bayesian trend | Current integrated over a partial charge ÷ OCV-anchored ΔSOC, with an explicit per-session error budget and session-selection rules; dQ/dV as a secondary feature; Kalman/GP trend over sessions; repeatability across similar sessions; rolling-origin (time-ordered) coverage check of the intervals; comparison with the BMS figure; same-budget comparison rows (gradient boosting with a lab-data prior; a small time-series foundation model) |
| BM3 | Per-cell-group analytics and fault detection | Group-vs-pack scores (median/MAD) for capacity, resistance, self-discharge while parked; physics-based faults injected into real healthy logs; detection probability versus severity, lead time, false alarms per vehicle-day on untouched real data; real and synthetic in separate tables |
| BM4 | On-device deployment and drift monitoring | Phone output matches offline output on identical inputs, on-phone latency and battery cost, a drift check that fires on shifted inputs |
| BM5 | LLM eval infrastructure for the in-app summary and assistant (T2.10, T2.11) | Faithfulness scoring, judge calibrated against owner labels, assistant question set, prompt-injection cases, prompt versions, CI replay regression suite, cost and latency per model |
| BM6 | Three write-ups | #1 own-car measurement case study (capacity, resistance, per-group analytics; n=1), #2 fleet results and the LLM eval, #3 agentic engineering; reproduction commands, dataset datasheet, failures, limitations, NOT RUN items |
| BM7 (stretch) | Distillation of the summary model | LoRA fine-tune of a small open model on reviewed hosted summaries; held-out comparison with the hosted model on the BM5 suite; model, compute, and spending cap in the spec |
| BM8 | Resistance and circuit model | Effective DC resistance from current steps over fixed 2–10 s windows, normalised for temperature and SOC, stable across sessions at matched conditions; per-group equivalent-circuit model with a small learned residual, scored on held-out-session voltage error |
| BM9 (optional) | Open Ultium charge-session dataset | Consented, documented dataset with a datasheet (hashed VIN, no GPS, separate opt-ins, licence chosen before collection); owner approves release |

BM2, BM3 and BM8 run on own-car data as case studies; cross-vehicle claims, conformal calibration by vehicle, and hierarchical models wait for beta vehicles (3–10 enable leave-one-vehicle-out). Each milestone is split into bounded specs before implementation.

## Data and labels

Sources are project recordings only: own car, beta testers, inspection customers with consent, borrowed cars. Every session records vehicle (make, model, year; VIN redacted), dongle, app version, consent, and whether it is real or synthetic. Recordings stay immutable; derived datasets are versioned artifacts with manifests pointing back to recording paths and hashes.

Split by vehicle first and by session second, before any windowing or augmentation. All windows from one charge session stay in one split. Report per-vehicle results; never let a vehicle in the test split contribute to training, calibration, or model selection. With few vehicles, say so and report leave-one-vehicle-out results instead of a single headline.

Synthetic data (injected imbalance faults, simulated charge curves) is labeled `synthetic: true`, reported in separate tables, and never counted toward real-data results.

## Methods (candidates, chosen in specs)

Details, sources and feasibility limits: `reports/Battery ML depth beyond LLM wrappers.md`.

- **Independent capacity (BM2).** Q = ∫ I dt over a charge; SOC endpoints from rested group voltages through this car's OCV curve (BM1); usable sessions cover roughly ≥ 30–50 % SOC with rested endpoints (at 40 % ΔSOC, a 1 % SOC error gives about 2.5 % capacity error). Error budget terms: current quantisation and offset, sampling gaps, OCV error and relaxation, temperature. dQ/dV on a voltage grid with Savitzky–Golay or spline smoothing, compared only within temperature bins.
- **Trend and uncertainty (BM2).** Kalman filter or Gaussian process over per-session capacity with per-session noise from the error budget; intervals checked by rolling-origin backtesting. Conformal prediction as a coverage check now, as the lead method only with a fleet.
- **Comparison models (BM2).** Gradient boosting or ridge with a prior fitted on public lab data (split by cell); a small time-series foundation model (for example TTM) at the same data budget. Published results suggest fine-tuning such models on small, short series can make them worse; report the break-even honestly.
- **Resistance and circuit model (BM8).** ΔV/ΔI at current steps (charger start/stop ≈ 26 A; driving pulses much larger) with `2414` and group voltages polled in the same cycle; equivalent-circuit model per group with a small learned residual trained on voltage. Not feasible at OBD rates: multi-RC fits, impedance spectroscopy, electrochemical parameter fitting.
- **Per-group analytics and faults (BM3).** Group deviation from the pack median, correlation and entropy methods, isolation forest on sliding windows; self-discharge from voltage drift during long parked periods; distinguishing sensor offset (constant), connection resistance (scales with current), and cell faults (persists, changes with SOC). Injected faults: internal short (parallel resistance), capacity fade of one group, resistance rise, sensor offset/drift.
- **On-device (BM4).** A tree or linear model exported to JSON and evaluated in pure TypeScript needs no new dependency; ONNX Runtime or TFLite in Expo is a new native module and must be justified in the BM4 spec (AGENTS.md rule 7).
- **Drift (BM4).** Input-distribution checks per vehicle, especially after over-the-air updates or behaviour changes (for example the 12 V step-down seen on 2026-09-23); a drifted model is flagged as stale.
- **Simulation (stretch).** [PyBaMM](https://github.com/pybamm-team/PyBaMM) (BSD-3-Clause) or PyBOP as a generic-chemistry prior; Ultium cell parameters are not public.

### Public battery datasets, researched 2026-09-22

Leads for method practice and pretraining, not approved imports. They are lab cell-cycling data, not vehicle OBD data. Check the actual license text before any use, and assume nothing about commercial use until checked.

| Source | Possible use | Limitation / license note |
|---|---|---|
| [CALCE battery data](https://calce.umd.edu/battery-data) | Method practice on cell aging curves | Reported as attribution license; publications must cite the CALCE papers |
| [Severson et al. cycle-life data](https://data.matr.io/1/) | Early-life capacity prediction practice | LFP 18650 cells, not Ultium NMC(A); data license to check; modeling code needs an academic license |
| [NASA battery datasets](https://data.nasa.gov/dataset/randomized-and-recommissioned-battery-dataset) | Method practice | License listed as "other"; check before use |
| [Open-source battery data list](https://github.com/lappemic/open-source-battery-data) | Index for further sources | An index, not a dataset |

## BM5: evaluating the in-app LLM

The summary (T2.10) and assistant (T2.11) ship as an opt-in feature (ADR-012); the template report is always the fallback. BM5 is the evidence that they are safe to show.

- **Faithfulness.** A deterministic checker extracts every number and unit from the output and matches it against the report or the tool results the model received. A mismatch is a hard fail, and in the app it triggers the template fallback. Unsupported claims and omitted flagged items (for example, high cell spread) are counted.
- **LLM-as-judge.** Semantic questions (is the explanation correct, is uncertainty stated) are graded by a judge model. The judge is calibrated against the owner's own labels on a sample; report agreement with n, and do not trust the judge beyond what that agreement supports.
- **Assistant question set.** Scripted questions over replayed data, including questions the data cannot answer; the correct behavior there is to say so.
- **Prompt injection.** Imported files and beta-tester notes are untrusted. Test cases place instructions in those fields and check that tool use and answers do not change.
- **Regression in CI.** Prompts are versioned. CI replays saved model responses through the checkers, so a prompt or parser change that breaks faithfulness fails `pnpm check` without paid API calls. Live model runs happen in `pnpm eval` only.
- **Cost and latency.** Tokens, cached tokens, cost, and latency per report and per question, per model, with dated rates; these numbers set the usage cap at store time (ADR-009).

Model IDs and prices are verified and dated in the spec. BYOK keys in `.env` only.

## BM7 (stretch): distillation

Fine-tune a small open-weight model with LoRA on summaries the hosted model produced and the owner reviewed in BM5, then compare with the hosted model on the BM5 suite (faithfulness, judge scores, cost, latency). Split by source report before generating any training variants; never train on BM5 test items. Check the hosted provider's terms on using outputs for training before generating data. Select model, license, compute, and a spending cap in the spec; record revisions, settings, seeds, and losses. A small model that fails the faithfulness check more often than the hosted one is a valid, reportable result.

## Completion and portfolio evidence

Use [EVAL.md](EVAL.md) for scoring. Report real and synthetic results separately, with denominators and per-vehicle rows. No test-set tuning. Publish reproducible commands, dataset manifests (without private data), measured tradeoffs, representative failures, and what was NOT RUN. Model training and evaluation runs are separate from normal CI; a missing required run leaves the milestone incomplete and cannot use the vehicle hardware-only exception. Training runs on CPU; if a spec ever needs a GPU or paid compute, it states the cost before execution.
