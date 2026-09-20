# Applied ML: fine-tuning and inference engineering

Planned learning track, adopted 2026-09-20. No training, dataset audit, or serving benchmark has been completed. Tasks ML1–ML6 follow the Phase 1 diagnostic baseline and precede Phase 2 EV delivery; see [PLAN.md](PLAN.md). Compute and spending remain undecided.

## Question and boundaries

Can a small, specialized model produce useful, evidence-grounded diagnostic hypotheses at lower cost and latency than a larger general-purpose model? A reproducible negative result is a successful experiment. Improving a synthetic benchmark is not evidence of real-world diagnostic accuracy.

The model receives a structured case assembled from deterministic features, DTCs, symptoms, and available context. It ranks hypotheses, cites case evidence, identifies missing information, and proposes a next diagnostic step. Include healthy and ambiguous cases where no supported diagnosis is available. Protocol handling, decoding, units, and feature calculations remain tested TypeScript.

Fine-tuning changes learned parameters. Retrieval supplies reference material at inference time. Inference engineering changes how a model runs and serves requests. Retrieval is optional; automatic routing, on-device inference, and production GPU infrastructure are outside this track.

## Experiment sequence

| Task | Deliverable | Required evidence |
|---|---|---|
| ML1 | Hosted reference and untuned small-model baselines | Same case/output contract, versioned prompts, per-case quality and runtime results |
| ML2 | Audited training pilot | Provenance/license manifest, reviewed targets, frozen grouped splits, duplicate audit |
| ML3 | Supervised LoRA fine-tuning; QLoRA if memory warrants it | Model/tokenizer revisions, dependencies, seed, settings, losses, validation results, adapter artifact identity |
| ML4 | Tuned versus untuned versus hosted comparison | Untouched test results, failure analysis, real/synthetic separation, all attempted configurations |
| ML5 | Bounded serving experiments | Quality checks plus cold/warm latency, throughput, memory, and cost at documented loads |
| ML6 | Reproducible portfolio report | Commands, dataset/model documentation, result tables, limitations, deployment recommendation |

ML1 requires the Phase 1 case and evaluation pipeline. Freeze the test partition before adapting prompts or generating training variants. ML3 follows ML2 approval; ML4 uses validation-selected checkpoints; ML5 follows a quality-characterized candidate. Each milestone is split into bounded implementation specs if necessary. No model must beat the baseline to finish the track.

## Data and labels

Start with hundreds of reviewed examples as a pilot target, not a claim of sufficient training data. Measure coverage and learning curves before expanding. Include missing sensors, contradictory evidence, healthy cases, and insufficient-information cases. Remove identifiers and inspect free-text symptoms for personal information before export.

Record source, version/hash, acquisition method, license and intended-use restrictions, synthetic status, review status, and parent case/session for each example. Record teacher model and prompt for generated targets; check provider terms before generating training data. Teacher responses are candidate labels, not verified faults. Keep derived datasets and model artifacts outside immutable recordings, and never commit private data, secrets, or large checkpoints.

Group all windows and paraphrases from one source case/session into a single split. Deduplicate across imported sources. Where coverage permits, evaluate held-out vehicles and fault families separately; report when this is infeasible. Do not use test cases to generate training data, select prompts, tune hyperparameters, or choose checkpoints. Label a repeatedly consulted test set as development data and obtain a new holdout before further generalization claims.

### Candidate sources, researched 2026-09-20

These are leads, not approved imports. Inspect actual files, provenance, license terms, and task fit before selection. Public accessibility alone does not establish training or redistribution permission.

| Source | Possible use | Limitation |
|---|---|---|
| Project recordings and labels | Real-input evaluation and reviewed cases | Nine planned fault cases plus baselines cannot establish broad generalization; reserve independent holdouts |
| [Pocket Mechanic distilled](https://huggingface.co/datasets/MindFreakGamer/pocket-mechanic-distilled) | Related instruction-tuning format | Tagged synthetic/distillation; card lists CC-BY-NC-4.0; not real-world ground truth or assumed suitable for a paid app |
| [Vehicle Diagnostics LLM Training Sample](https://huggingface.co/datasets/CJJones/Vehicle_Diagnostics_LLM_Training_Sample) | Synthetic report-generation examples | Broad configuration-to-report task differs from diagnosis of supplied measurements; card lists CC-BY-NC-4.0 |
| [UCI APS Failure at Scania Trucks](https://archive.ics.uci.edu/dataset/421/aps%2Bfailure%2Bat%2Bscania%2Btrucks) | Optional separate tabular classification exercise | Truck air-pressure-system classification, not passenger-car diagnostic instructions |
| [NHTSA complaints](https://www.nhtsa.gov/nhtsa-datasets-and-apis) | Optional symptom extraction/retrieval research | Owner complaints are not verified root-cause labels |

The UCI and NHTSA exercises are optional research directions, not additional committed milestones. Sourced signal definitions such as OBDb describe decoding; they are not labeled diagnostic outcomes.

## Training and serving

Use a small open-weight instruction model and supervised LoRA training as the first experiment. LoRA trains adapter parameters with the base weights frozen; QLoRA adds a quantized base to reduce training memory. Candidate tooling is Hugging Face Transformers, PEFT, and TRL. These are proposals, not installed or approved dependencies; the implementation spec lists exact versions and reasons.

Select the exact model, license, context length, training settings, compute target, and spending cap in the experiment spec before execution. Record dataset/model revisions, chat template, truncation policy, assistant-target loss masking, batch settings, learning rate, adapter configuration, seed, and checkpoint selection. Inspect examples after tokenization to ensure targets and critical evidence survive. Use validation quality alongside loss to detect overfitting; report training/validation behavior and dataset size.

Use an isolated Python workspace planned at `tools/ml/`; do not add training dependencies to the bridge or mobile app. An experimental serving endpoint connects through the existing `LlmClient` boundary. Hosted inference stays the app baseline until quality and operational evidence supports a change. Bind a local experiment service to loopback; any remote deployment needs explicit access and credential handling in its spec, not an unauthenticated public endpoint.

Compare higher-precision and quantized inference independently from training quantization. Benchmark shared-prefix caching off/on with identical requests, cold and warm states, and documented cache resets. Vary concurrency and case/output lengths in separate experiments. Prefix caching saves shared prompt-processing work; it does not eliminate output generation. Quantization may reduce memory without improving speed on a particular workload. Concurrency tests are serving experiments, not claims of real app traffic.

Record hardware, runtime versions, context/output limits, decoding settings, precision, adapter loading/merging, warm-up, request count, concurrency, cache state, and errors. Report time to first token separately from time to a complete validated diagnosis, total p50/p95 latency, throughput, peak GPU memory, and quality. If an interface does not expose first-token timing, report it as unavailable rather than approximating it from total latency. Include API usage or rental duration, dated rates, training expense, and idle/startup costs; distinguish marginal request cost from total experimental cost.

## Completion and portfolio evidence

Use [EVAL.md](EVAL.md) for scoring. Report real, synthetic, and external benchmarks separately, with denominators and every real case visible. Record unsupported conclusions as well as invalid references. Self-reported confidence is not a calibrated probability; measure calibration only when sample size supports it and otherwise state that limitation.

Publish reproducible commands/configurations, permitted data manifests, model and dataset cards, measured tradeoffs, representative failures, and what was NOT RUN. No invented benchmark numbers or claims of mechanical expertise. Required training and serving runs cannot be waived as hardware-only vehicle checks; missing compute leaves the affected milestone incomplete. Normal CI remains fixture-based and does not require GPUs or paid APIs.

## Primary technical references

- [PEFT quantization and QLoRA](https://huggingface.co/docs/peft/developer_guides/quantization)
- [TRL supervised fine-tuning trainer](https://huggingface.co/docs/trl/sft_trainer)
- [vLLM automatic prefix caching](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/)

Recheck model/runtime compatibility and provider pricing when writing an implementation spec. These links describe techniques; they are not evidence that this project has run them.
