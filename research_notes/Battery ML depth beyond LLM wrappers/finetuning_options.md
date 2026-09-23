# Fine-tuning and training options for a solo EV battery-health project (as of 2026-09)

Scope: which training/fine-tuning directions are real applied-ML work (not wrappers) for an Equinox EV OBD logger with one car now and a few beta cars later, public lab datasets available, AMD GPUs at home, rented GPUs possible. Research budget was about 16 tool calls, so several areas rely on abstracts or search snippets; that is flagged where it matters.

Framing that applies to everything below (inference, not cited): the hard constraint is labels, not model capacity. With one car there is no ground-truth capacity measurement. The only "label" a field pipeline can make is a self-derived capacity estimate: integrated pack current (Ah or kWh) between two SOC or rest-voltage points in a charge session, with a stated uncertainty. Every model direction below either (a) improves or calibrates that estimate, (b) learns from lab data where labels exist and transfers, or (c) models behavior (voltage response, cell spread) where the signal itself is the target and no SOH label is needed. Directions of type (c) are the ones one car can support honestly.

## 1. Time-series foundation models (Chronos/Chronos-Bolt, TimesFM, Moirai, Lag-Llama, MOMENT, TTM) and battery-specific foundation models

### Takeaway
TSFMs can be fine-tuned (LoRA or full) and a handful of battery papers report SOH gains, but they are forecasting models evaluated on lab cycling data, the comparisons against well-tuned tree/linear baselines at equal data budgets are mostly missing, and a 2026 break-even study found LoRA fine-tuning can hurt on short, scarce series. Battery-specific "foundation models" (PBT, LiPM, Battery-Timer) are lab-cycle-life/capacity models, not field-log models. For this project a TSFM is defensible only as one benchmarked baseline or as a frozen feature extractor, not as the headline.

### Cited Findings
- A July 2026 break-even study (KIT; Chronos-Bolt Small 48M / Base 205M, Moirai Small 14M / Base 91M / Large 311M, Lag-Llama 7M, vs naive seasonal, ETS, ARIMA and XGBoost with lag features, 30 datasets) found FMs dominate at all training fractions on 15 datasets, classical methods catch up with ~2% of data on 6, and need 20–100% of data on 8. — [Tan Jerome & Simon, arXiv 2607.04919](https://arxiv.org/html/2607.04919)
- Same study: LoRA fine-tuning "can actively degrade performance on short series" and should be avoided when data is scarce (e.g., ILI: MASE 2.472 zero-shot to 2.766 after fine-tuning). Their rule: under ~700 training samples with meaningful seasonality, use zero-shot and do not fine-tune. — [arXiv 2607.04919](https://arxiv.org/html/2607.04919)
- A 2025 benchmark of forecasting models concluded gradient boosting remains the better choice for accuracy and robustness, with pretrained FMs attractive for simplicity and minimal preprocessing. — [arXiv 2502.03395](https://arxiv.org/pdf/2502.03395) (search-snippet level; not read in full)
- An August 2026 review of large models for battery PHM found no domain-specific battery language model; TSFM battery uses documented are Lag-Llama ("Internet of Batteries", SOH with ~0.72% of target data for fine-tuning over 143 cells) and TimeGPT-1. It states that "controlled same-data-budget comparisons against well-tuned specialists remain absent", that most works lack RMSE/MAE comparisons against XGBoost/RF/physics baselines on identical data, that field-data deployment "remains largely unexplored", and that only one work targets on-device inference. No battery applications of Chronos, TimesFM, Moirai, TTM or MOMENT were listed. — [arXiv 2608.26111](https://arxiv.org/html/2608.26111)
- Fine-tuned TimeGPT on 143 cells from six groups (six cathode chemistries) for SOH: average RMSE reduction of 21.55% vs zero-shot TimeGPT (the comparison is against its own zero-shot, not against tree baselines). — [Energy (ScienceDirect) S0360544224039550](https://www.sciencedirect.com/science/article/abs/pii/S0360544224039550)
- Pretrained Battery Transformer (PBT): pretrained on 13 datasets, 977 cells, 528 aging conditions (Li-ion, Na-ion, Zn-ion), mixture-of-experts layers encoding battery knowledge, for early cycle-life prediction; reports beating the strongest competitor by 21.9% on average (up to 86.9%) across 15 datasets. Authors note transfer learning alone gives only incremental gains unless the pretrained model encodes relevant aging knowledge. Licence CC BY-NC-SA 4.0 (paper). — [arXiv 2512.16334](https://arxiv.org/abs/2512.16334)
- Battery-Timer: the Timer TSFM fine-tuned on 220,153 open-source cycles with a "degradation-aware" strategy, evaluated on an energy-storage-station dataset (CycleLife-SJTUIE), then distilled into compact expert models; reports outperforming specialized experts. — [arXiv 2505.08151](https://arxiv.org/abs/2505.08151)
- Other 2024–2026 battery "foundation" work surfaced but not read: BatteryMFormer ([arXiv 2605.27044](https://arxiv.org/pdf/2605.27044)), multitask pretraining for battery management ([arXiv 2509.01323](https://arxiv.org/pdf/2509.01323)), SambaMixer Mamba SOH ([arXiv 2411.00233](https://arxiv.org/pdf/2411.00233)), physics-guided test-time training for cross-domain SOH ([arXiv 2402.00068](https://arxiv.org/pdf/2402.00068)).
- IBM TTM (granite-timeseries-ttm r1/r2): models from ~1M parameters, TSMixer-based, runs zero-shot, fine-tuning and inference on CPU/laptops; claims competitiveness when fine-tuned on 5% of training data and 4–40% gains over zero/few-shot benchmarks; supports exogenous channels and channel mixing during fine-tuning. — [HF model card](https://huggingface.co/ibm-granite/granite-timeseries-ttm-r2); [arXiv 2401.03955](https://arxiv.org/abs/2401.03955)
- BatteryML (Microsoft) platform benchmarks linear models on handcrafted features ("Variance", "Discharge", "Full"), ridge/PCR/PLSR, trees and neural nets; statistical/linear models are competitive with deep models on lifetime prediction, and deep models vary widely across random seeds. — [BatteryML arXiv 2310.14714](https://arxiv.org/pdf/2310.14714); [Statistical learning for lifetime prediction, arXiv 2101.01885](https://arxiv.org/pdf/2101.01885)

### Inferences
- Hype vs measured: most battery-TSFM gains are reported vs zero-shot or vs other deep models on lab cycling data, which is the easy transfer case. None of the found work shows a TSFM beating a tuned GBM/ridge on field EV charge snippets at equal data. Treat any claim otherwise as unverified.
- The task mismatch matters: TSFMs are forecasters. Cycle-by-cycle capacity curves (lab) are forecastable; one car's field logs give maybe tens of capacity estimates per year, which is below the 700-sample "do not fine-tune" line.
- The defensible TSFM use here is (1) TTM or Chronos-Bolt Small as a zero-shot / lightly fine-tuned baseline on the lab capacity-forecast benchmark alongside ridge and LightGBM, with the result reported whichever way it goes, or (2) a frozen embedding for anomaly scoring of within-session voltage/current sequences. TTM is the only one realistically trainable on the local CPU and small enough to export.
- An interview-grade finding is the honest negative: "TSFM fine-tuning did not beat LightGBM on field-derived features at N samples; here is the break-even curve." That mirrors the KIT study design and is cheap to run.

### Gaps
- Did not find TimesFM 2.x or MOMENT battery-specific results, or any public head-to-head of TSFMs vs GBM on real EV field charging data.
- Did not verify PBT or Battery-Timer code/weights availability or licences for weights.
- Chronos-2 / TimesFM version status as of Sept 2026 not checked.

## 2. Transfer learning / domain adaptation (lab-to-field, sim-to-real)

### Takeaway
Lab-to-field transfer for EV SOH is an active, published area with real field datasets (hundreds of vehicles), and self-supervised pretraining on unlabeled charging snippets is the most label-efficient reported approach. For this project the defensible version is: pretrain or fit on public lab cells, adapt using self-derived field capacity estimates, and evaluate with leave-one-vehicle-out splits; the main pitfalls are label definition in the field, chemistry/format mismatch, and partial charging windows.

### Cited Findings
- A lab-to-field study released three field datasets from 464 EVs with over 1.2 million charging snippets; field capacity/SOH labels were produced with K-means clustering, and a gated CNN was used for capacity estimation. — [Applied Energy S030626192301111X](https://www.sciencedirect.com/science/article/abs/pii/S030626192301111X) (snippet level)
- A masked autoencoder pretrained on unlabeled field charging data extracted SOH-related latent features and reached competitive results with ~20% of the labeled data normally needed. — surfaced in the same search; exact paper attribution uncertain between the results listed ([Vision-powered generative paradigm, PMC13457183](https://pmc.ncbi.nlm.nih.gov/articles/PMC13457183/) and [Big field data deep-fusion transfer learning, MSSP S0888327024004837](https://www.sciencedirect.com/science/article/abs/pii/S0888327024004837)); verify before citing.
- Real-world charging data from 300 EVs over 1.5 years: ML models reached absolute error under 2% for 93.7% of samples, RMSE 1.05% (SOH). — [Decoding battery aging in fast-charging EVs, S2405829725002351](https://www.sciencedirect.com/science/article/abs/pii/S2405829725002351) (snippet level)
- Cell-to-vehicle transfer of differential-voltage (DV) and incremental-capacity (IC) features with deep learning for EV SOH diagnostics (2026). — [S2590174526001613](https://www.sciencedirect.com/science/article/pii/S2590174526001613)
- System-level SOH using EV field data ("Towards real-world SOH estimation, Part 2"). — [S2590116824000511](https://www.sciencedirect.com/science/article/abs/pii/S2590116824000511)
- Sim-to-real: pretraining a network on simulated signals mapped to internal parameters, then unsupervised domain adaptation with unlabeled real data to close the sim-to-real gap; transfer-learned SPMe-PINNs validated in PyBaMM. — [arXiv 2606.28220](https://arxiv.org/pdf/2606.28220); [arXiv 2503.22396](https://ar5iv.labs.arxiv.org/html/2503.22396)
- Physics-based synthetic data for thermal monitoring: the paper's focus is that synthetic data fidelity determines transfer value. — [arXiv 2509.10380](https://arxiv.org/pdf/2509.10380) (title/snippet only)
- Capacity-fade prediction with probabilistic models with and without pretrained priors (prior from other cells as transfer). — [arXiv 2410.06422](https://arxiv.org/pdf/2410.06422) (title only)
- PBT authors: transfer only gives incremental improvements unless the pretrained model encodes relevant aging knowledge. — [arXiv 2512.16334](https://arxiv.org/abs/2512.16334)

### Inferences
- Pitfalls to design around: (a) lab cells are single small-format cells cycled full-depth at fixed temperature; the Equinox pack (NMC-based Ultium pouch, cell groups) is charged partially at varying temperature, so features must be window-robust (e.g., IC/DV peaks within a common SOC window, or Ah over a fixed voltage window); (b) field "labels" are themselves estimates, so evaluation must separate label noise from model error; (c) leakage via random splitting of sessions from the same car.
- With one car, lab-to-field can only be evaluated as "does the lab-trained model's prediction agree with the field-derived capacity estimate within its interval", not as accuracy against ground truth. With a few beta cars, leave-one-vehicle-out becomes possible but N is tiny; report per-vehicle results, not pooled RMSE.
- Gradual-prior Bayesian transfer (a lab-fitted prior over the capacity-vs-throughput curve, updated with field estimates) is lower-risk and more interview-defensible than deep fine-tuning at this data size; it also gives calibrated uncertainty for free.
- The 464-vehicle public field datasets are the most valuable external asset: they allow a real lab-to-field or field-to-field evaluation with multiple vehicles, which one car cannot. Licence and chemistry match need checking.

### Gaps
- Could not confirm the licence/download location of the 464-EV field datasets or whether they include cell-level voltages comparable to the Equinox signals.
- Did not read full texts; the 2410.06469 "hybrid fusion" paper fetch returned a generic summary that looked unreliable, so it is not used.

## 3. Physics-informed NNs, neural ODEs, hybrid ECM + learned residual

### Takeaway
Hybrid equivalent-circuit model (ECM) plus learned residual is the most feasible physics-aware model for this data: pack current and cell-group voltages at 0.1–8 s are exactly the inputs an ECM needs, the parameters (R0, RC pairs) fitted per session are health indicators, and a small residual model can be trained on one car's data because the target is voltage (dense, self-labeling). Full electrochemical PINNs (SPMe/DFN) are published mostly on simulations and need parameters and signals the OBD data will not give.

### Cited Findings
- PINNs for SOH from partial charging profiles, targeting real-time health monitoring. — [arXiv 2511.12053](https://arxiv.org/pdf/2511.12053) (title/snippet)
- Physics-informed DeepONet replaces PyBaMM SPM at 265x speedup on standard processors and estimates SOH and degradation parameters with 3.4% average error. — [Applied Energy S0306261925017179](https://www.sciencedirect.com/science/article/pii/S0306261925017179) (snippet)
- SPMe-PINN with transfer learning (pretrain on general electrochemistry, then weight transfer/freeze/fine-tune per chemistry), validated on PyBaMM data. — [arXiv 2606.28220](https://arxiv.org/html/2606.28220v1)
- On-site electrochemical parameter estimation with transfer-learned PINNs. — [arXiv 2503.22396](https://ar5iv.labs.arxiv.org/html/2503.22396)
- Physics-guided test-time training for cross-domain Li-ion SOH. — [arXiv 2402.00068](https://arxiv.org/pdf/2402.00068)

### Inferences
- Feasible with this data: a 1RC or 2RC ECM per cell group fitted to current steps (charge start/stop, drive transients), with OCV(SOC) from rest periods; a small GRU/MLP residual on temperature, SOC, current history. Evaluation is held-out voltage RMSE by session and by vehicle, and stability of fitted R0 across sessions at matched temperature/SOC. No SOH label needed, so one car suffices for the model; trend claims still need months of data.
- Neural ODEs add complexity with little benefit over a discrete-time ECM+residual at these sampling rates; mention as a considered alternative.
- Full DFN/SPMe PINNs need electrode-level parameters and cell current density; only pack current and cell-group voltages exist. Use PyBaMM for synthetic data generation (labeled synthetic, per AGENTS.md) and sanity tests, not as the deployed model.
- Sampling caveat: 8 s sampling cannot resolve fast RC time constants; only sessions with ~0.1–1 s sampling are usable for R0/RC fitting. This must be stated in the spec.

### Gaps
- No found source reports ECM+residual performance on OBD-rate EV pack data specifically.

## 4. LLM fine-tuning that is not a wrapper (distillation, constrained decoding, on-device runtimes)

### Takeaway
Distilling hosted-model summaries into a small on-device model via LoRA SFT is technically real but weakly motivated here: the report is already templated and numbers are checked deterministically, so the measurable gains are privacy/offline/cost, not accuracy. If done, it is only defensible with a held-out faithfulness eval (number-check pass rate, omission rate) comparing template-only, hosted, and distilled small model. On-device runtimes are mature enough in 2026 (llama.cpp, LiteRT-LM, ExecuTorch) for 1–4B models.

### Cited Findings
- LiteRT-LM (Google): about 52 tokens/s via OpenCL GPU on a Samsung S26 Ultra; another comparison shows 2.9 tok/s CPU vs 5.0 tok/s GPU on a slower device. Gemma 4 E2B runs in under 1.5 GB on some devices and reached 31 decode tok/s on a Qualcomm Dragonwing IQ8 NPU (Google Developers Blog, April 2026); multi-token prediction (April 2026) gives 2x+ decode on mobile GPUs. — search summary of [daily.dev LiteRT-LM](https://daily.dev/posts/on-device-ai-series-part-5-litert-lm-tstgy0fh5), [dev.to Gemma 4 on Android](https://dev.to/samdude/gemma-4-on-android-tricks-for-faster-on-device-inference-3kj5) (secondary sources; numbers not verified against the Google blog)
- Benchmark repos for Android LLM inference: [llm-smartphone (llama.cpp and Gemini Nano)](https://github.com/on-device-llm/llm-smartphone); [llama.cpp Android performance discussion #14356](https://github.com/ggml-org/llama.cpp/discussions/14356); a May 2026 framework comparison (llama.cpp, ONNX Runtime, LiteRT, CoreML) at [arXiv 2605.08195](https://arxiv.org/html/2605.08195v1).
- Practitioner comparison of MediaPipe, llama.cpp, ExecuTorch on Android. — [meetprajapati.com](https://meetprajapati.com/blogs/running-on-device-ai-models-android-mediapipe-llamacpp-executorch/)
- React Native: [react-native-transformers](https://github.com/daviddaytw/react-native-transformers) runs HF LLMs in RN/Expo via onnxruntime.
- Battery-domain LLM work is mostly prompting/PEFT adaptations of general LLMs (e.g., BatteryGPT for multimodal anomaly detection); no battery-specific LM found. — [arXiv 2608.26111](https://arxiv.org/html/2608.26111)

### Inferences
- A distilled 1–3B model (Gemma/Qwen-class, QLoRA on a rented 24 GB GPU for a few hours) fed a structured JSON of computed metrics, with grammar-constrained decoding (llama.cpp GBNF / JSON schema) so it can only reference provided fields, is a legitimate small project. Its eval: faithfulness pass rate on the existing deterministic number check over a held-out set of synthetic and real sessions, vs hosted and template baselines. Expected honest result: the template already wins on faithfulness; the small model wins on fluency and offline use.
- Risk: training targets would be hosted-model outputs; check the provider's terms on using outputs to train models before doing this.
- Ranked below the battery-model directions for showcase value, because it is the part interviewers see most often.

### Gaps
- No verified per-device latency for a 1–3B model on a mid-range Android phone in Sept 2026 from a primary source. ExecuTorch and MLC LLM status not checked directly.

## 5. On-device deployment of non-LLM models

### Takeaway
For GBM/ridge/ECM-type models, the simplest path is exporting parameters to JSON and evaluating in pure TypeScript in `obd-battery` (no native dependency, runs identically in app, replay and eval, consistent with the "obd-core/obd-battery pure" rule). ONNX Runtime React Native works with Expo only via prebuild/dev client and has had config-plugin/autolinking friction; it is only worth it for a neural model (e.g., TTM or a GRU residual).

### Cited Findings
- `onnxruntime-react-native` "does not contain a valid config plugin" issue for Expo; Expo requires prebuild and a custom dev client for native modules; a PR removed `unimodule.json` so autolinking works via `react-native.config.js`, with a project-level workaround until merged. — [issue #548](https://github.com/microsoft/onnxruntime-inference-examples/issues/548); [PR #29005](https://github.com/microsoft/onnxruntime/pull/29005); [discussion #26536](https://github.com/microsoft/onnxruntime/discussions/26536); [ORT RN source](https://github.com/microsoft/onnxruntime/tree/main/js/react_native)
- Practitioner guide to ONNX models in React Native (Jan 2026). — [simplico.net](https://simplico.net/2026/01/21/how-to-use-an-onnx-model-in-react-native-and-other-mobile-app-frameworks/)

### Inferences
- LightGBM/XGBoost trees dump to JSON and evaluate in ~50 lines of TS; ridge/GP-with-fixed-kernel and ECM are closed-form. A parity test (Python prediction vs TS prediction on the same fixtures, tolerance 1e-6) is a strong, cheap verification item.
- Quantization is irrelevant for trees/linear; int8 matters only for neural models above ~1M params. TTM at ~1M params in fp32 is ~4 MB, acceptable without quantization.
- The mobile app already uses Expo prebuild/dev client for BLE (inference from T0.8), so ORT RN is possible, but it is a new dependency that needs a spec reason under AGENTS.md rule 7.

### Gaps
- Did not check ExecuTorch or LiteRT bindings for React Native for non-LLM models.

## 6. AMD GPU training feasibility vs renting

### Takeaway
ROCm 7.2.x officially supports the RX 7900 XT/XTX/GRE under WSL2 with PyTorch 2.9.1; the RX 6600 (RDNA2) is not on the WSL support list. For the recommended directions (GBMs, ridge/GP, ECM fitting, TTM, small GRUs) a CPU is enough and the GPU question is moot. Renting is cheap for anything larger: RTX 4090 about $0.34–0.69/h, A100 80GB about $0.50–1.59/h.

### Cited Findings
- ROCm 7.2.1 WSL support matrix lists RX 9070, RX 7900 XTX, RX 7900 XT (and pro variants); RX 6600 absent. PyTorch 2.9.1 has official production support; PyTorch 2.7 is not supported for Radeon 7000 series on WSL. — [AMD ROCm WSL compatibility](https://rocm.docs.amd.com/projects/radeon-ryzen/en/latest/docs/compatibility/compatibilityrad/wsl/wsl_compatibility.html)
- ROCm 7.2 (early 2026) described as bringing official WSL2 support for 7000/9000 series; practitioners report ROCm performance trailing CUDA by ~15–25% and recommend native Linux for the best experience. — [CraftRigs](https://craftrigs.com/guides/amd-rocm-7-2-consumer-gpu-support-matrix-2026/); [kunalganglani.com](https://www.kunalganglani.com/blog/rocm-consumer-gpu-cuda-alternative-2026) (secondary)
- Practitioner write-up of RX 7900 XTX + WSL2 + ROCm + vLLM. — [zenn.dev](https://zenn.dev/troutceremony/articles/f1bf689b878a06?locale=en)
- Rental: RunPod RTX 4090 from $0.34/h (community) / $0.69/h (secure); Vast.ai 4090 typical ~$0.39/h (Apr 2026); RunPod A100 80GB $1.59/h secure, A100 PCIe $1.19/h community; Vast.ai A100 80GB from $0.50/h unverified. RunPod bills per second. — [Spheron](https://www.spheron.network/blog/gpu-cloud-pricing-comparison-runpod-vs-vastai-2026/); [SynpixCloud](https://www.synpixcloud.com/blog/vast-ai-vs-runpod-rtx-4090-pricing); [RunPod 4090](https://www.runpod.io/gpu-models/rtx-4090)

### Inferences
- Rough budget: QLoRA SFT of a 1–3B model on a few thousand examples is a few GPU-hours on a 4090, i.e. under ~$5 per run; TSFM fine-tunes of Chronos-Bolt Base/Moirai Base on lab data are similar. A $50 cap covers the whole experiment series with repeats.
- The "7900-class" card should be confirmed as XT/XTX/GRE (listed) vs 7800/7700 (check the matrix). DirectML is a fallback but PyTorch-DirectML has lagged; not verified in this pass.
- Given local ROCm setup cost and the small models recommended, CPU locally plus occasional rental is the lower-risk plan.

### Gaps
- DirectML status in 2026 not checked. No first-party AMD statement on RDNA2 WSL support plans found.

## Comparison summary and recommendation (synthesis; see sections above for sources)

| Direction | Real value here | Data need | Compute | Eval design | Showcase value |
|---|---|---|---|---|---|
| Lab-to-field capacity model with calibrated uncertainty (GBM/ridge/GP + Bayesian prior from lab, updated with field estimates) | High: directly produces the SOH number with an interval | Public lab cells + field capacity estimates from charge sessions; 464-EV field sets if licensable | CPU | Group splits by cell/vehicle; coverage of intervals; leave-one-vehicle-out on field sets | High, and defensible |
| Hybrid ECM + learned residual per cell group | High: resistance/imbalance trends, anomaly flags, self-labeled | One car's high-rate sessions | CPU | Held-out-session voltage RMSE; R0 stability at matched T/SOC; synthetic PyBaMM injection tests | High (physics + ML) |
| TSFM (TTM/Chronos-Bolt) fine-tune | Low to medium; likely does not beat GBM at this N | Lab cycles for forecasting | CPU (TTM) or cheap rental | Same-budget comparison vs ridge/LightGBM with break-even curve | Medium, if reported honestly |
| Battery FM (PBT, Battery-Timer) reuse | Low: lab cycle-life task, weights/licence unclear | Lab | Rental | Replicate on public split | Low to medium |
| Self-supervised pretraining (MAE) on charging snippets | Medium, only with multi-vehicle field data | Large unlabeled field set | Rental | Label-efficiency curve | Medium-high but data-gated |
| Small-LLM distillation + constrained decoding | Low for accuracy, some for offline/privacy | Hosted outputs on sessions | Rental, few $ | Faithfulness pass rate vs template/hosted | Medium; common |
| Full PINN / neural ODE electrochemical | Low: parameters and signals unavailable | Simulated | GPU | Sim only | Looks impressive, weak evidence |

Recommendation (inference): the two most defensible are (1) a lab-to-field capacity/SOH estimator with calibrated uncertainty, trained on public lab data with vehicle/cell-grouped splits, applied to field-derived capacity estimates, with a same-data-budget TSFM baseline included as a comparison row rather than the headline; and (2) a per-cell-group hybrid ECM + small learned residual on the Equinox's high-rate sessions for resistance and imbalance tracking and anomaly flags. Both run on CPU, deploy as pure-TS parameter evaluation, and have evaluation designs that one car can support without overstating. LLM distillation and PINNs are optional side experiments, not the core.
