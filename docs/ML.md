# Applied ML: battery health

Planned track, adopted 2026-09-22 (ADR-012); it replaces the withdrawn LLM fine-tuning track (ML1–ML6, ADR-011). No dataset, model, or measurement exists yet. BM1–BM7 follow the Phase 2 charging logger and beta data export; see [PLAN.md](PLAN.md).

## Question and boundaries

Can models built from OBD battery data give a more useful battery report than the deterministic baseline — a capacity estimate from partial charges with an honest interval, earlier warning of cell imbalance — while running on the phone? And can an in-app LLM explain the report and answer questions about the owner's data without ever stating a number the data does not contain? A reproducible negative result is a successful experiment.

Decoding, units, and the deterministic capacity estimate (T2.4) stay in tested TypeScript and remain the baseline every model is compared with. Models add estimates; they never replace a measured value in the report, and every model output in the report is labeled as an estimate with its interval.

The "reference estimate" of capacity comes from a logged full (or near-full) charge: integrated pack energy over ΔSOC, or charger-reported kWh over ΔSOC if no current/energy signal exists (Gate B in PLAN.md). It is not ground truth: the car's SOC is itself a BMS estimate, and charger kWh includes charging losses. Report which reference method each number uses.

## Experiment sequence

| Task | Deliverable | Required evidence |
|---|---|---|
| BM1 | Dataset pipeline | Resampling of irregular BLE polling onto a time grid, dataset versions with manifests, provenance and consent per session, splits grouped by vehicle and session |
| BM2 | Partial-charge capacity estimation with calibrated intervals | Error against the reference estimate per vehicle, conformal interval coverage measured on held-out sessions, comparison with the T2.4 baseline |
| BM3 | Cell-imbalance anomaly detection | Detection on faults injected into real logs (labeled synthetic), false positives on healthy sessions, reported separately |
| BM4 | On-device deployment and drift monitoring | Phone output matches offline output on identical inputs, on-phone latency and battery cost, a drift check that fires on shifted inputs |
| BM5 | LLM eval infrastructure for the in-app summary and assistant (T2.10, T2.11) | Faithfulness scoring, judge calibrated against owner labels, assistant question set, prompt-injection cases, prompt versions, CI replay regression suite, cost and latency per model |
| BM6 | Three write-ups | #1 own-car capacity case study (n=1), #2 fleet results and the LLM eval, #3 agentic engineering (agent workflow, Claude/Codex handoff, agent-driven discovery through MCP); reproduction commands, dataset documentation, failures, limitations, NOT RUN items |
| BM7 (stretch) | Distillation of the summary model | LoRA fine-tune of a small open model on reviewed hosted summaries; held-out comparison with the hosted model on the BM5 suite; model, compute, and spending cap in the spec |

BM2 and BM3 can start on own-car data as case studies; fleet claims wait for beta data (T2.9). Each milestone is split into bounded specs before implementation.

## Data and labels

Sources are project recordings only: own car, beta testers, inspection customers with consent, borrowed cars. Every session records vehicle (make, model, year; VIN redacted), dongle, app version, consent, and whether it is real or synthetic. Recordings stay immutable; derived datasets are versioned artifacts with manifests pointing back to recording paths and hashes.

Split by vehicle first and by session second, before any windowing or augmentation. All windows from one charge session stay in one split. Report per-vehicle results; never let a vehicle in the test split contribute to training, calibration, or model selection. With few vehicles, say so and report leave-one-vehicle-out results instead of a single headline.

Synthetic data (injected imbalance faults, simulated charge curves) is labeled `synthetic: true`, reported in separate tables, and never counted toward real-data results.

## Methods (candidates, chosen in specs)

- **Features.** Charge-curve shape by SOC window, incremental capacity (dQ/dV) where current and voltage resolution allow it, cell spread versus SOC, temperature effects if temperatures are available.
- **Capacity models.** Gradient-boosted trees and Gaussian processes as the main candidates; a small 1D CNN or GRU as a comparison only if data volume supports it.
- **Uncertainty.** Split conformal prediction on held-out calibration sessions; report empirical coverage of the nominal interval (e.g. 90%) per vehicle, with n.
- **Anomaly detection.** Residual models against the vehicle's own history and isolation forest as candidates; faults are injected into real healthy logs with a documented recipe.
- **On-device.** A tree model exported to JSON and evaluated in pure TypeScript needs no new dependency; ONNX Runtime or TFLite in Expo is a new native module and must be justified in the BM4 spec (AGENTS.md rule 7).
- **Drift.** Input-distribution checks per vehicle, especially after over-the-air updates that may change signals or BMS behavior; a drifted model is flagged as stale in the report rather than silently used.
- **Simulation (stretch).** Pretraining on [PyBaMM](https://github.com/pybamm-team/PyBaMM) simulations (BSD-3-Clause) and adapting to real logs. Ultium cell parameters are not public, so simulated data is a generic-chemistry prior, not a model of this pack.

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
