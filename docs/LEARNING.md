# Learning guide: build and understand this project

Revised 2026-09-24 for ADR-014–ADR-017 and the current testing rules. This is the owner's personal study guide, not a project spec or evidence that a task is complete. [PLAN.md](PLAN.md), [ML.md](ML.md), and approved task specs define the work; this guide defines what to learn to understand and contribute to it.

## 1. Goal and boundaries

**Goal:** learn enough to build, debug, evaluate, and explain the used-EV battery health check in its currently planned form. Start with the Equinox EV; add fleet methods when beta vehicles provide the data. Interview stories should grow out of this work, with measured results and honest limitations.

The central learning problem is measurement: extracting trustworthy battery estimates from imperfect recordings, understanding their uncertainty, and checking them over time. The app also needs reliable phone logging, safe agent access through MCP, and an optional LLM that explains computed results with checks and fallbacks.

You do not need a general AI curriculum before contributing. Learn a topic when a task needs it, to the depth needed to explain the implementation and diagnose a failure. There is no six-week completion promise: charge sessions, rested measurements, and beta data arrive on their own schedule.

**How to use the guide:**

- Use the week-by-week schedule in section 11 alongside the topic blocks and relevant project tasks. The LLM block can proceed independently once suitable reports exist; it does not require finishing battery ML first.
- Start with the smallest exercise that resolves a gap in your understanding. Skip an exercise if you can already explain and demonstrate its outcome.
- Spend more time inspecting data, building, and diagnosing failures than collecting courses.
- Keep scratch notebooks and synthetic practice data in a personal scratch directory or separate repo. Never hand-edit `fixtures/recordings/`.
- A practice artifact teaches a skill. Project evidence additionally needs the approved spec, permitted data, reproducible verification, and review. Never present practice results as vehicle verification.

## 2. What to learn, and when

| Area | Depth and timing | Project use |
|---|---|---|
| MCP, tool contracts, permissions, asynchronous failures | Practical understanding now, alongside relay work | T0.6, T2.3 |
| BLE/ELM session boundaries, recording and replay, Android logging lifecycle | Understand the paths you operate and debug; consult protocol sources for details | Phase 0, T2.4 |
| Python, NumPy/pandas, plots, dataset manifests | Learn enough to inspect and transform recordings reproducibly | BM1 and later experiments |
| Battery measurements, units, OCV, integration, error budgets | Core study with worked examples | T2.4, BM1, BM2 |
| Statistical uncertainty, time-ordered validation, Kalman filters/GPs | Core study when session estimates exist; exact model selected in the spec | BM2 |
| Resistance, simple circuit models, group comparisons, fault evaluation | Core study after usable current and group-voltage logs exist | BM8, BM3 |
| Hosted LLM APIs, structured output, tool calling, faithfulness and evals | Practical understanding when building the summary and assistant | T2.10, T2.11, BM5 |
| Gradient boosting, lab-data priors, small time-series foundation models | Bounded comparison experiments when BM2 reaches them | BM2; these comparison rows remain planned |
| Model export, phone parity, latency, battery cost and drift | Learn after choosing something to deploy | BM4 |
| Fleet validation and conformal calibration by vehicle | Understand the distinction now; implement when beta data supports it | Later battery experiments |
| LoRA/distillation, LLM serving, quantization, battery simulation | Outside the main checklist; study only for an approved stretch experiment | BM7, simulation stretch |
| Transformer/tokenizer implementation, vector databases and broad RAG stacks | Optional background; no current task requires building these | Revisit only if the plan changes |

The gas-car diagnosis engine and original ML1–ML6 LLM training track are withdrawn. ICE cars are optional benches. Do not study those historical tasks as prerequisites for the EV product.

## 3. Just enough foundations

Use these as a gap check, not a second curriculum.

**Python and data tools:** functions, collections, file I/O, environments with `uv`, NumPy arrays, pandas time indexing and grouping, basic plots, and a command that regenerates an output. A notebook is useful for exploration; its important results should be reproducible without manual cell-order tricks. Colab is optional, not a requirement.

**Math and statistics:** units and dimensional checks, numerical integration, interpolation, basic algebra, mean/median/percentiles, variance and measurement noise, precision/recall, intervals and empirical coverage. Learn the probability and linear algebra needed for the chosen Kalman/GP or residual model when its spec is written.

**Battery concepts:** voltage, current, charge (Ah), energy (Wh/kWh), SOC, capacity and SOH; cell groups and the BMS; rested versus loaded voltage; temperature and relaxation. Learn what each observable can support before interpreting it as health.

**LLM concepts:** tokens, context limits, inference versus training, sampling, and why fluent output needs validation. Be able to explain attention at a high level. Implementing GPT or a tokenizer is optional; neither is a prerequisite for this app's hosted API features.

## 4. Block A: reliable capture and safe agent access

**Tasks:** T0.6, T2.3, and the capture/replay foundations used by T2.4.

**Learn:**

- How a command travels through an MCP tool, the relay, the phone, BLE, and the ELM session, then returns as a result and recording.
- Framing, one command in flight, timeouts, disconnects, cancellation, and incomplete responses. Use [ELM327.md](ELM327.md) for command and protocol facts; do not invent constants from memory.
- Authentication, input validation, allowlists, and explicit confirmation at the actual execution boundary. A prompt cannot authorize a forbidden operation.
- Android foreground logging and screen-off behavior, durable capture, polling gaps, and keeping measurements aligned within a cycle.
- What an agent may propose versus what needs the owner's signal-verification verdict. Track proposal precision, session cost, and time.

**Practice artifact:** trace one allowed command through a replay or fake-phone scenario. Produce a transcript showing the result, a rejected operation, and a disconnect outcome. Define expected failures before implementing isolated tests. Fake-device success does not establish phone/car acceptance.

**Enough when:** you can identify where each permission is enforced, explain what happens to an interrupted command, and trace a displayed result back to a recording.

## 5. Block B: battery measurement and dataset construction

**Tasks:** T2.4, BM1, and the measurement part of BM2. Data export and intake requirements come from T2.9.

**Learn:**

- Inspect timestamps, sign conventions, units, missing samples, and polling alignment before computing features. Resampling must not silently hide a gap.
- Integrate current over time for charge and voltage × current for energy. Keep Ah and kWh distinct and state how each estimate was obtained.
- Understand the progression in [PLAN.md](PLAN.md): T2.4 initially uses BMS-SOC-referenced estimates; BM1 builds this car's OCV–SOC curve from rested windows; BM2 uses OCV-anchored endpoints for its independent estimator.
- Understand why a BMS energy/SOC calculation is a comparison, and why the independent estimator also has uncertainty rather than becoming ground truth.
- Build an error budget covering current offset/quantisation, sampling gaps, SOC endpoint uncertainty, relaxation, and temperature. Learn session-selection rules from the approved experiment spec.
- Preserve raw recordings, produce derived artifacts with source hashes and versions, and track consent and real/synthetic provenance. Apply the appropriate export/redaction policy: ADR-017 describes committed recording copies; other export paths have their own requirements.
- Split data before windowing or augmentation. Keep an entire session together. Separate own-car time-series analysis from claims about generalisation to other vehicles.

**Practice artifact:** a reproducible charge-session summary with plots, gap counts, integrated quantities, the SOC reference method, and an error-budget table. For OCV practice, show rested-point count and SOC coverage. Use labeled synthetic data for learning a missing branch; required project evidence still needs the specified recordings.

**Enough when:** you can explain what changed an estimate, which error dominates, when a session should be rejected, and what additional measurement would reduce uncertainty.

## 6. Block C: own-car modeling and honest validation

### C1. Capacity trends and uncertainty — BM2

Start with per-session estimates and their error budgets. Learn how a Kalman filter or Gaussian process can represent a trend with different noise levels for different sessions. Compare with a simple baseline before adding complexity.

Practice **rolling-origin evaluation**: use earlier sessions to estimate or predict later ones without using future observations in fitting or preprocessing. Report interval coverage and width with the number of evaluated sessions. Distinguish repeatability from accuracy against an independent reference; one consistent estimator can still be biased.

Conformal prediction remains useful to understand and check. Its exchangeability assumption is a central lesson: one car observed across seasons does not automatically satisfy it. ADR-016 makes Bayesian trends the primary own-car method and defers leading with vehicle-level conformal calibration until fleet data exists.

The BM2 comparison rows still require learning enough gradient boosting or ridge, lab-data priors, and a selected small time-series foundation model to run a fair comparison at the specified data budget. Learn the selected model's inputs, fitting, validation, and limitations. Training a foundation model from scratch is outside this scope. Public lab datasets are method practice or approved priors, not vehicle ground truth; check licensing before use.

**Practice artifact:** a time-ordered results table showing baseline and chosen-method estimates, intervals, coverage with n, and failure cases. Project comparisons include losing models and reproducible negative results.

### C2. Resistance and circuit models — BM8

Learn effective resistance from current steps, matched temperature/SOC comparisons, and the limits imposed by sampling rate and timing. Then learn the simple equivalent-circuit model selected in the spec and how a small learned residual corrects its voltage prediction.

The target is explaining and evaluating that model, including residual training and overfitting. Detailed electrochemical modeling, impedance spectroscopy, and elaborate circuit identification are outside the current OBD-rate scope. Use [ML.md](ML.md) and its cited research for feasibility and parameter sources.

**Practice artifact:** an event table and voltage plot with conditions, effective-resistance estimates, repeatability across matched sessions, and held-out-session voltage errors for the circuit model and learned residual.

### C3. Group analytics and fault detection — BM3

Start with each group relative to the pack: median/MAD baselines, persistence, and dependence on current, SOC, and temperature. Learn to distinguish sensor offset/drift, connection resistance, and plausible cell faults before choosing a more complex detector.

Study physics-based fault injection from the approved spec. Split sessions before injection. Evaluate detection against severity, lead time, and false alarms per vehicle-day on untouched healthy recordings. Synthetic detection results and real-data false alarms belong in separate tables. Healthy own-car data does not establish real-fault diagnostic accuracy.

**Practice artifact:** a scored fault experiment with source-session provenance, injection parameters, detection curves, and a separate healthy-data false-alarm result.

**Enough for Block C when:** you can explain the baseline, what the model adds, how leakage was prevented, what the intervals mean, and which claims the available data cannot support.

## 7. Block D: checked LLM summaries, tools, and evaluation

**Tasks:** T2.10, T2.11, BM5. This block can use synthetic reports for practice while real report builders are pending.

**Keep the practical focus:**

- Typed reports, hosted API calls through the project's client boundary, structured output and schema validation.
- Context selection, tool calling over stored sessions, citations to returned values, and correct behavior when data is missing.
- A deterministic number-and-unit check, unsupported-claim and omission evaluation, and the template fallback. Matching numbers alone does not prove the explanation is correct.
- Untrusted imported notes, prompt injection, tool permissions, BYOK handling, and excluding identifying data from model requests.
- Prompt versions, development/test separation, owner labels, judge agreement with n, and measured tokens, caching, latency, and cost.
- Saved-response regression checks in CI, with live model evaluation separate. Replaying saved responses tests checkers; evaluating a changed prompt's generated behavior requires new model outputs.

**Practice artifact:** a small set of synthetic reports and questions, including missing data and malicious notes. Define expected outcomes and freeze the test set before prompt tuning. Build the checker and tool path, then report checker failures, missed flags, citation failures, refusal behavior, judge-versus-owner agreement, and cost/latency. Save representative failures and reproduction instructions.

Use current official documentation for the selected provider when implementing; verify API methods, model IDs, and prices in the task spec. No broad provider survey is required. Retrieval over a vector database is not a prerequisite for the currently specified tools over stored sessions.

**Enough when:** you can trace an answer to its data, demonstrate a rejected output and fallback, explain what the checker misses, and measure whether a change improved the feature.

## 8. Block E: deployment, evidence, and communication

**Tasks:** BM4, BM6, plus verification throughout the project.

**Deployment:** learn the export format and runtime selected for the actual model. Pure TypeScript evaluation may be sufficient. ONNX/TFLite and native Expo integration are only study requirements if the BM4 spec chooses them. Compare offline and phone outputs on identical inputs, measure phone latency and battery cost, and demonstrate a drift/stale-model check. A TypeScript script on a laptop is useful preparation but does not verify phone behavior.

**Verification:** follow [AGENTS.md](../AGENTS.md) and [WORKFLOW.md](WORKFLOW.md). Prefer recordings through public entry points that produce a checkable artifact: replay summary, report, recording path, or eval output. The reviewer regenerates it. For necessary isolated tests, list failure modes in the spec first, write a test for each, and demonstrate failure before changing implementation. Do not add unit tests after the code to restate its behavior.

**Communication:** keep a short evidence note with each artifact: question, source data and consent, method, versions, reproduction command, results with denominators, representative failures, limitations, and PASS/FAIL/NOT RUN. Derive the BM6 write-ups from completed experiments and task records as they become available. You do not need a separate week of portfolio exercises before returning to project work.

**Enough when:** another person can reproduce the result, distinguish practice from vehicle evidence, and understand the limits without asking you to fill in missing steps.

## 9. Working glossary

Return here when a task uses a term; memorising the whole list is not a prerequisite.

| Term | Meaning in this project |
|---|---|
| Model | A mathematical mapping from inputs to outputs; may be a simple regression, a circuit model, or an LLM. |
| SOC / capacity / SOH | SOC describes charge state; capacity describes how much charge or energy is usable under stated conditions; a health claim needs its definition and reference stated. |
| OCV | Open-circuit voltage; rested measurements support the planned SOC mapping, with relaxation and temperature limitations. |
| Coulomb counting | Integrating current over elapsed time to estimate transferred charge. |
| Error budget | Explicit contributions to an estimate's uncertainty, including measurement and processing errors. |
| Learned residual | A trained correction to a baseline model's prediction, evaluated on held-out data. |
| Kalman filter / Gaussian process | Candidate methods for the capacity trend; learn the chosen method's noise assumptions and interval interpretation. |
| Coverage | How often the evaluated target lies inside the reported interval, with the target and sample count stated. |
| Exchangeability | The data assumption behind standard conformal guarantees; temporal or seasonal structure can undermine it. |
| Rolling-origin evaluation | Repeatedly fit using the past and evaluate on later observations. |
| Grouped split / leakage | Keep related observations together; leakage occurs when evaluation information influences training, preprocessing, or selection. |
| MAD | Median absolute deviation, used with the median for robust group-versus-pack comparisons. |
| Fault injection / drift | Injection introduces a labeled synthetic fault for evaluation; drift is a change in inputs or relationships that may invalidate a deployed model. |
| Token / context | Units of model input/output and the information available to a model call; relevant to limits, cost, and grounding. |
| Training / inference | Training adjusts model parameters; inference uses them. Supplying a prompt does not update weights. |
| Structured output / faithfulness | Schema-conforming output versus claims supported by supplied data; both need checks. |
| Tool calling / MCP | The model requests an operation; application code validates and executes it. MCP exposes tools through a shared protocol. |
| Prompt injection | Instructions in untrusted content that attempt to redirect model behavior. |
| LLM-as-judge | Model-assisted grading, measured against owner labels and supplemented by deterministic checks. |
| Distillation / LoRA | Optional BM7 methods for training a smaller summary model; outside the main learning path. |

## 10. Sources and study discipline

Start with the project's requirements, then read only the external material needed to understand or implement the selected method.

| Question | Start here |
|---|---|
| What is actually planned, and what depends on data? | [PLAN.md](PLAN.md), [DECISIONS.md](DECISIONS.md) |
| Where does the code run, and what are its boundaries? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Where do protocol facts and signal constants come from? | [ELM327.md](ELM327.md) and the cited signal sources |
| What battery method and evidence are required? | [ML.md](ML.md), its cited research, then the approved experiment spec |
| How are outputs scored and datasets labeled? | [EVAL.md](EVAL.md) |
| How do implementation and review work? | [AGENTS.md](../AGENTS.md), [WORKFLOW.md](WORKFLOW.md), the task's spec and record |

Use official documentation for pandas/NumPy and the selected statistical library as specific questions arise. For LLM/MCP APIs, consult current official documentation at implementation time. A course is optional support for a concrete gap, not a completion gate. Check dataset licenses and model terms before importing data or running experiments.

**Park until needed:** implementing transformers/tokenizers; broad deep-learning courses; LoRA/QLoRA and LLM serving; PyBaMM/PyBOP simulation; vector databases; native inference runtimes that have not been selected; cross-vehicle SOH regressors and supervised deep fault detection before fleet evidence. BM7 and simulation remain stretch work, BM9 publication remains optional, and none of them should delay the core study blocks.

## 11. Week-by-week study guide

Use this as an **eight-week first pass**, alongside project work: roughly 12–18 focused hours per week, about one-third reading and two-thirds practice. These are study budgets, not task estimates. Extend a week when its exercise exposes a gap; completing the schedule does not complete the associated milestones. If studying full time, use additional time for the current project task and deeper practice rather than adding unrelated courses.

The topic blocks above explain the scope; this schedule tells you where to learn it. Resource pages were checked on 2026-09-24. Follow the named topics if headings move, and use documentation matching the project's installed versions. Course access may require an account or payment; no certificate is required. The linked UCCS circuit-model notes were found in the search index but their server returned an error during this check.

### Week 1: understand the data path and MCP

**Goal:** explain how an agent reaches the car and where software enforces the boundaries. **Tasks:** T0.6, T2.3; Block A.

**Read in this order (4–6 hours):**

1. [ARCHITECTURE.md](ARCHITECTURE.md) — core transport/session, mobile, relay, and data-flow sections. Draw the path from tool request to recorded response. Read the framing and command rules in [ELM327.md](ELM327.md).
2. [MCP: Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server) — core concepts, logging, and the TypeScript example. Learn tool schemas, handlers, results, and connecting a client. Skip the other language implementations.
3. [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) — workflows versus agents and the appendix on tool design. Learn when a fixed workflow suffices and what makes a tool clear. Skip implementing every orchestration pattern.
4. [Android foreground services overview](https://developer.android.com/develop/background-work/services/fgs) — purpose, user visibility, and lifecycle restrictions. Relate these to a multi-hour screen-off charge log; native service implementation comes with T2.4.

**Build (8–12 hours):** in a scratch project, expose one fake-device tool with a schema and allowlist. Define rejection and disconnect outcomes before coding. Save a transcript showing an allowed request, a rejected request, and an interrupted request. If the relay already provides this evidence, trace and explain that implementation instead of recreating it.

**Done/self-check:** show the transcript and answer: who executes the tool, where is permission checked, and what happens when the phone disappears? No car access is required.

### Week 2: Python, recordings, and battery vocabulary

**Goal:** turn a recording into an understandable dataset without hiding data-quality problems. **Tasks:** T2.4, BM1; Block B.

**Read in this order (4–6 hours):**

1. [Python tutorial](https://docs.python.org/3/tutorial/) — skim chapters 3–5 for syntax, then modules, file/JSON I/O, and exceptions in chapters 6–8. Skip material you already know; use the repo's `uv` environment conventions.
2. [pandas time-series guide](https://pandas.pydata.org/docs/user_guide/timeseries.html) — datetime conversion, time indexing, time differences, and resampling. Learn what aggregation or filling does to missing observations. Skip calendar/business-day machinery.
3. [Gregory Plett: Introduction to battery-management systems](https://www.coursera.org/learn/battery-management-systems/) — “Introducing Important Battery Terminology” and “How Does an Electrochemical Cell Store and Release Energy?” in Battery Boot Camp; then the voltage, temperature, and current-sensing lessons in module 3. Focus on quantities and measurement limitations. Skip manufacturing, contactor design, and the full certificate sequence.

**Build (8–12 hours):** read an available recording without modifying it; produce a derived table, timeline plot, gap counts, units dictionary, and source manifest. If it lacks decoded charge signals, use a separately labeled synthetic charge series for the plots. Keep absent signals explicit rather than filling them with invented vehicle values.

**Done/self-check:** regenerate the outputs with one command and explain SOC versus capacity, Ah versus kWh, which fields are observed, and which are derived.

### Week 3: capacity measurement, OCV, and error budgets

**Goal:** explain how a capacity estimate is constructed and why it can be wrong. **Tasks:** T2.4, BM1, BM2; Block B.

**Read in this order (4–6 hours):**

1. [ML.md: methods](ML.md#methods-candidates-chosen-in-specs) and [ADR-016](DECISIONS.md#adr-016-measurement-first-battery-ml-the-llm-only-explains-2026-09-23) — the BMS-referenced starting point, OCV endpoints, session selection, and error terms. Follow the cited battery research when you need the justification for a project-specific assumption.
2. [Plett: Equivalent-Circuit Cell Models, lecture notes](https://mocha-java.uccs.edu/ECE5710/ECE5710-Notes02.pdf) — focus on open-circuit voltage and SOC dependence first. Learn why loaded voltage and rested voltage need different treatment. Save resistance and dynamics for Week 5; skip detailed electrochemical models.
3. [NumPy trapezoidal integration](https://numpy.org/doc/stable/reference/generated/numpy.trapezoid.html) — the explicit `x` sample coordinates and examples. Practice with actual elapsed times and check units rather than assuming uniform sampling.
4. [NIST Technical Note 1297](https://www.nist.gov/pml/nist-technical-note-1297) — sections on Type A/Type B uncertainty and combined uncertainty; consult [Appendix A](https://www.nist.gov/pml/nist-technical-note-1297/nist-tn-1297-appendix-law-propagation-uncertainty) for propagation. Learn to enumerate sources and account for dependencies. Do not treat this as a certification exercise.

**Build (8–12 hours):** integrate a labeled synthetic charge with known inputs, then perturb timing, current offset, gaps, and SOC endpoints one at a time. Produce an estimate/sensitivity table and plot. Explain how an OCV curve would supply endpoints and what real rested measurements are still needed. Apply the analysis to a real charge only when a suitable recording exists.

**Done/self-check:** identify the dominant error, show why a smaller SOC span can amplify endpoint error, and explain why agreement with the BMS is insufficient validation. Recordings needed for real OCV evidence remain a project dependency.

### Week 4: uncertainty and trends with one car

**Goal:** evaluate a simple capacity trend without learning from the future. **Tasks:** BM2; Block C1.

**Read in this order (4–6 hours):**

1. [Roger Labbe: Kalman and Bayesian Filters in Python](https://github.com/rlabbe/Kalman-and-Bayesian-Filters-in-Python) — the Gaussian and one-dimensional Kalman-filter chapters. Learn prediction, update, measurement noise, and process noise. Stop before extended/unscented/particle filters.
2. [Forecasting: Principles and Practice, time-series cross-validation](https://otexts.com/fpp3/tscv.html) — study the rolling-origin diagram and evaluation procedure. Implement the idea in Python; learning the book's R stack is unnecessary.
3. [scikit-learn Gaussian processes](https://scikit-learn.org/stable/modules/gaussian_process.html) — regression, noise handling, and predictive uncertainty. Read enough to compare the approach with Kalman filtering; deeply practice one first.
4. [A Gentle Introduction to Conformal Prediction](https://arxiv.org/abs/2107.07511) — the introductory split-conformal construction and assumptions only. Connect the exchangeability limitation to ADR-016. Fleet calibration is later work.

**Build (8–12 hours):** create a labeled synthetic sequence of session estimates with known trend and differing measurement noise. Compare a last-value baseline with a simple filter, evaluating later sessions using only the past. Plot intervals, report coverage with n, and deliberately introduce a shift to expose a limitation. Use real sessions later without pretending their true capacity is known.

**Done/self-check:** explain what the interval targets, why a noisy session gets different weight, and the difference between measured coverage on synthetic truth and evidence available on the Equinox.

### Week 5: resistance, cell groups, and fault detection

**Goal:** connect battery behavior to a simple detector and its failure modes. **Tasks:** BM8, BM3; Blocks C2/C3.

**Read in this order (4–6 hours):**

1. Revisit [Plett's circuit-model notes](https://mocha-java.uccs.edu/ECE5710/ECE5710-Notes02.pdf) — equivalent series resistance, voltage dynamics, and the basic circuit representation. Focus on explaining a current step; do not implement the entire model toolbox.
2. [ML.md](ML.md) — resistance windows, temperature/SOC normalization, learned residuals, and the named fault families. Learn which effects the available polling can resolve.
3. [scikit-learn novelty and outlier detection](https://scikit-learn.org/stable/modules/outlier_detection.html) — the distinction between novelty and outlier detection, then Isolation Forest only. Compare its purpose with a median/MAD group baseline before adding it.
4. [scikit-learn cross-validation](https://scikit-learn.org/stable/modules/cross_validation.html) — grouped-data and time-series sections. Understand why windows from one session stay together; group splitting alone does not enforce time order.

**Build (8–12 hours):** use a documented synthetic current-step example to compute effective resistance and plot a simple circuit response. In a separate labeled group-voltage exercise, compare a constant sensor offset with a current-dependent deviation. Start with a robust group baseline; report detection by severity and false alarms on an untouched healthy split. These toy faults teach mechanics; BM3's physics-based injections require their approved spec.

**Done/self-check:** explain which fault distinctions the signals support and show the baseline's failure cases. Fitting BM8's learned residual on real held-out sessions is a follow-on project experiment, not an assumed one-week result.

### Week 6: hosted LLM summaries and tool calling

**Goal:** build the app's kind of LLM feature and contain failures in code. **Tasks:** T2.10, T2.11; Block D.

**Read in this order (4–6 hours):**

1. Review the LLM entries in section 9 and the `obd-assist` boundary in [ARCHITECTURE.md](ARCHITECTURE.md). Be able to explain tokens, context, and inference; no transformer implementation is required.
2. [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) — JSON schemas, parsing, and limitations. Learn the distinction between valid shape and true content.
3. [Claude tool-use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) — tool definitions, requests/results, and the client execution loop. Implement one tool over a stored report before adding more.
4. [Claude prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — stable prefixes, cache behavior, and usage reporting. Learn how to verify a cache hit; do not assume ordinary application caching is the same mechanism.

**Build (8–12 hours):** create a small synthetic report set including missing data and uncertainty. Define expected behavior and reserve a test set before prompt iteration. Build structured summaries, a number/unit checker with a template fallback, and one report-reading tool. Include a wrong-number output and an instruction hidden in a note. Log model/prompt versions and usage without secrets or identifying data.

**Done/self-check:** show a supported answer, a rejected answer, and a missing-data response. Explain what schema validation and number checking each fail to detect. Live API practice uses a stated personal spending cap; without access, saved synthetic responses can exercise the checker, with live generation marked NOT RUN.

### Week 7: LLM evals and fair model comparisons

**Goal:** measure whether a change helps and preserve honest evidence. **Tasks:** BM5 and preparation for BM2 comparison rows; Blocks C1/D.

**Read in this order (4–6 hours):**

1. [Claude: Define success criteria and build evaluations](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests) — criteria, test cases, and grading choices. Translate them into the specific failures in [EVAL.md](EVAL.md) and BM5.
2. [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) — tool evaluations and interpreting agent behavior. Focus on reproducible cases and tool descriptions; skip adopting extra agent infrastructure.
3. [scikit-learn ensemble guide](https://scikit-learn.org/stable/modules/ensemble.html) — gradient-boosting regression and its main controls only. Learn fit/predict, overfitting, and a baseline comparison. This is preparation for BM2's comparison row, not a survey of every ensemble.

**Build (8–12 hours):** score the Week 6 held-out outputs for numbers, citations, omissions, unsupported claims, and refusals. Grade a small sample yourself and compare a judge's grades with yours. Produce a results table with n, failures, cost, and latency; save responses for checker regression. Separately, sketch BM2's comparison protocol: shared data budget, splits, baseline, target, and metrics.

**Done/self-check:** explain whether the prompt improved, how the judge disagreed with you, and which changes require fresh model calls. Full lab-prior and time-series foundation-model runs remain required BM2 work once the spec selects models/data/compute; no need to study those architectures broadly this week.

### Week 8: phone deployment and reproducible explanations

**Goal:** carry a small result across runtimes and explain its evidence. **Tasks:** BM4, BM6; Block E.

**Read in this order (3–5 hours):**

1. [React Native performance overview](https://reactnative.dev/docs/performance) — JS/UI thread work, development versus release performance, and profiling considerations. Connect this to inference and logging without blocking the app.
2. Revisit [Android foreground services](https://developer.android.com/develop/background-work/services/fgs) for the capture lifecycle and [ML.md](ML.md) for offline/phone parity and drift requirements. Study ONNX/TFLite documentation only if the approved runtime choice requires it.
3. [AGENTS.md testing rules](../AGENTS.md#testing-rules), [WORKFLOW.md](WORKFLOW.md), and [EVAL.md](EVAL.md) — learn what an independent reviewer must regenerate and which claims require real recordings or hardware.

**Build (8–12 hours):** export a small practice estimator or model into a simple TypeScript representation, compare outputs on identical inputs, and save a parity report. Introduce a documented synthetic input shift and demonstrate a stale-data/model signal. Measure on a phone when the app and device are available; otherwise explicitly leave phone latency and battery cost NOT RUN.

Write a one-page report for one completed exercise: question, source, method, result, failure, limitations, and reproduction command. Practice explaining it in two minutes, then answering a deeper technical question using the artifact.

**Done/self-check:** someone else can regenerate the result and tell which parts used synthetic data, real recordings, a live model, or a phone. You can explain one meaningful failure without overstating what the project has verified.

### After the eight-week pass

Return to the next approved project task and deepen only the required method. Keep the main progress checklist below as the long-term record; the weekly exercises do not automatically check off project evidence. When beta vehicles arrive, add fleet validation. When BM2 selects a foundation-model comparison, learn that model's official inference/fine-tuning example and run the specified comparison. Only start LoRA, simulation, or dataset-publication study when the corresponding stretch/optional work is selected.

## 12. Progress checklist

Check a box when you can explain the result and point to an artifact. Label that artifact practice or project evidence.

### Capture and measurement

- [ ] Trace a relay command, its permissions, and its failure handling.
- [ ] Regenerate a replay artifact and explain what it proves.
- [ ] Inspect a charge log's timestamps, units, polling alignment, and gaps.
- [ ] Produce a charge/energy calculation with its reference method stated.
- [ ] Explain rested windows and show an OCV exercise with coverage and limitations.
- [ ] Build an error budget and explain when to reject a session.
- [ ] Produce a dataset manifest with provenance, appropriate redaction, and valid splits.

### Battery modeling

- [ ] Compare a baseline with a chosen capacity trend using time-ordered evaluation.
- [ ] Report interval coverage and width with n; explain measurement uncertainty and the reference target.
- [ ] Explain why fleet calibration differs from own-car validation.
- [ ] Complete BM2's specified comparison experiments when their data and specs are ready.
- [ ] Evaluate resistance events and a simple circuit model with a learned residual.
- [ ] Evaluate group faults by severity and lead time, with separate real healthy-data false alarms.

### LLM application and evaluation

- [ ] Explain tokens, context, inference, tool calling, and output validation at the application boundary.
- [ ] Demonstrate a checked summary and deterministic fallback.
- [ ] Demonstrate cited answers, missing-data behavior, and an injection test.
- [ ] Produce an eval table with held-out outcomes, judge agreement, and measured cost/latency.
- [ ] Replay saved responses through CI checkers and explain what still requires a live eval.

### Deployment and explanation

- [ ] Compare offline and phone outputs on identical inputs and measure phone cost.
- [ ] Demonstrate drift detection and explain the stale-result behavior.
- [ ] Produce an artifact another person can regenerate under the current testing rules.
- [ ] Explain one completed experiment's question, method, result, failure, and limitation.

For an interview or a project review, use the same explanation: what you built, why you chose it, what the evidence says, and what remains unknown. No claim of fleet generalisation, certified battery health, hardware verification, or model improvement without the corresponding evidence.
