# Learning guide: from full-stack web dev to applied AI engineering

This is the owner's personal study plan, written 2026-09-22 and revised the same day for ADR-012 and ADR-013. It isn't a project spec, and nothing in it counts as evidence for any task in [PLAN.md](PLAN.md). The guide assumes you can build web apps well but know almost nothing about how AI models work. It gives you an order to learn things in, explains each concept from zero, and ties every step to this repo: battery ML (BM1–BM4), the in-app LLM and its evals (T2.10, T2.11, BM5), agents working against the car through MCP (T0.6, T2.3), and distillation as a stretch (BM7). See [ML.md](ML.md).

## 1. Purpose and honest target

**Goal.** In about six weeks of full-time study, be able to hold a credible technical conversation in applied-ML and AI-engineering interviews, and back it with work you built and measured yourself.

**What's realistic.** Six weeks won't make you a research scientist. It *can* make you someone who has:

- called models through an API, controlled their context and tools, and validated their output against real data;
- built an eval, checked an LLM judge against your own labels, and wired a regression suite into CI;
- trained tabular and time-series models, put honest uncertainty intervals on their predictions, and measured whether those intervals hold;
- detected anomalies when real labels don't exist, by injecting faults and measuring detection;
- shipped a model to a phone and noticed when its inputs drifted;
- built an MCP server and let an agent use it safely against real hardware;
- written up each of these with real numbers, failures included.

That profile is rarer than it sounds. Most candidates can describe these ideas, but few have measured them.

**What practice runs are and aren't.** The exercises below use public or synthetic data and throwaway notebooks. They teach the skills BM1–BM7 need, but they are **not** BM1–BM7. The real milestones need recordings from real cars and a spec (AGENTS.md hard rules 3 and 11). In interviews, describe practice runs as practice runs.

**Time split.** Spend about one-third of your time reading and two-thirds building. If a week's reading runs long, cut reading, not building.

## 2. The map: five layers of AI work

Think of it like a web stack. Most AI jobs sit in one or two layers but talk to the neighbours.

| Layer | Web-dev analogy | What you learn | For this repo |
|---|---|---|---|
| **Model fundamentals** | Knowing how HTTP and the browser work, even though you use a framework | Tokens, embeddings, attention, training vs. inference, why models make confident mistakes | Required. Everything else builds on it |
| **Application engineering** ("AI engineering") | Building the app on top of an API | Prompts, context, tool calling, structured output, retrieval, guardrails, evals | Required. T2.10 summary, T2.11 assistant, BM5 |
| **Agents and tooling** | Designing an API other programs call | Agent loops, MCP servers, tool design, sandboxing and permissions | Required. T0.6 car MCP server, T2.3 agent-driven discovery, the repo's own agent workflow |
| **Classical and time-series ML** | Writing the business logic and its tests | Features, gradient boosting, Gaussian processes, uncertainty, anomaly detection, drift, on-device inference | Required. BM1–BM4 |
| **Training and serving LLMs** | Writing a database engine | Fine-tuning, LoRA, serving, quantization | Stretch. BM7 distillation only |

Your advantage as a web dev: applied AI work is mostly software engineering, meaning APIs, validation, testing, latency, cost, and debugging. The model is a new, unreliable dependency that you learn to measure and contain.

## 3. Glossary from zero

Read this once now and come back to it. Each entry gives what the term is, an analogy where one helps, and where it shows up in obd.

### How models work

- **Model.** A very large function: text in, a probability for every possible next token out. It's "large" because it has billions of adjustable numbers inside.
- **Parameters / weights.** Those adjustable numbers. Training sets them, and after that they're fixed. *Analogy:* a compiled binary. You don't edit it by talking to it.
- **Token.** The unit a model reads and writes, usually a word fragment. Pricing, speed, and context limits are all counted in tokens. *In obd:* a battery report full of numbers can use surprisingly many tokens.
- **Tokenizer.** The code that turns text into token IDs and back. Each model family has its own.
- **Embedding.** A vector that represents a piece of text, where similar meanings end up close together. It powers semantic search and retrieval.
- **Transformer / attention.** The architecture behind modern LLMs; attention lets each token "look at" other tokens and decide which matter.
- **Context window.** The maximum number of tokens the model can see at once. Everything outside it doesn't exist to the model.
- **Training vs. inference.** Training changes the weights; inference runs the fixed model. **Prompting never changes weights.**
- **Sampling and temperature.** How the next token gets picked. Low temperature is more repeatable. For evals, fix these settings and record them.
- **Hallucination.** Fluent, confident output that is false. *In obd:* this is why every number in LLM output is checked against the data before display, with the template as fallback (T2.10).

### Building applications

- **Prompt / system prompt.** The text you send. The system prompt sets rules and role. *Analogy:* config plus request.
- **Structured output.** Asking the model for JSON matching a schema, then validating it in code. *Analogy:* zod at the boundary, which you already do.
- **Tool calling.** You describe functions; the model replies "call `get_capacity_estimate` with these args"; **your code** decides whether to run it and returns the result. The model never executes anything itself. *In obd:* the assistant (T2.11).
- **Context engineering.** Deciding what goes into the context window. Most quality problems turn out to be context problems.
- **Grounding and faithfulness.** Output that only states what the supplied data supports. A **faithfulness check** verifies that in code. *In obd:* the number checker in `obd-assist`.
- **Guardrail.** A code-level check around a model: input filtering, output validation, fallbacks. Guardrails belong in code, not in prompts.
- **Prompt injection.** Untrusted text (a file, a note, a web page) containing instructions the model then follows. *In obd:* imported beta files and notes are untrusted.
- **Retrieval / RAG.** Searching a knowledge source and pasting relevant pieces into the prompt. It adds knowledge without training.
- **Prompt caching.** The provider reuses processing of a stable prompt prefix across calls, cutting cost and latency. *In obd:* the cached system block (T2.10 verify line).

### Agents and tooling

- **Workflow vs. agent.** A workflow runs fixed steps written in code; an agent lets the model choose its next step in a loop. Start with workflows. Use agents when the path can't be known in advance, like signal discovery (T2.3).
- **MCP (Model Context Protocol).** An open protocol for exposing tools and data to any agent. You write a server once; Claude Code, Codex, and others can call it. *Analogy:* a REST API with a standard shape that agents know how to discover. *In obd:* the relay's car MCP server (T0.6).
- **Allowlist / sandboxing.** Permissions enforced by the server, not by asking the model nicely. *In obd:* the relay rejects UDS writes no matter what the agent sends.
- **Human in the loop.** A person approves an agent's result before it counts. *In obd:* the owner approves every discovered signal.
- **Agentic engineering.** Using agents to build software: specs, implementers, reviewers, handoffs. *In obd:* the architect / implementer / reviewer loop and the Claude/Codex handoff in `docs/task-runs/`.

### Classical and time-series ML

- **Feature.** A number computed from raw data that a model uses, such as cell spread at 50% SOC. *In obd:* built in BM1 from charge logs.
- **Resampling.** Putting irregular measurements on a regular time grid. BLE polling is irregular, so this comes first.
- **Gradient-boosted trees.** Many small decision trees added together, each fixing the previous ones' errors. The strongest default for tabular data.
- **Gaussian process.** A model that predicts a value *and* its own uncertainty, well suited to small datasets.
- **Incremental capacity (dQ/dV).** How much charge goes in per unit of voltage rise; its peaks shift as a battery ages. Needs current data (Gate B).
- **Uncertainty / prediction interval.** A range the true value should fall in, such as "58–62 kWh".
- **Conformal prediction.** A method that turns any model's errors on held-out data into intervals with a coverage guarantee, as long as new data resembles the calibration data. *In obd:* BM2.
- **Coverage.** How often the interval actually contained the true value. A 90% interval that covers 70% of the time is overconfident.
- **Anomaly detection.** Flagging data that looks unlike normal data. Methods include residuals against a model of normal behaviour and isolation forests. *In obd:* BM3.
- **Fault injection.** Adding a known, synthetic problem to real data so you can measure detection without waiting for real failures. Results stay labeled synthetic.
- **Drift.** Inputs or relationships changing after deployment, for example after a software update. *In obd:* BM4.
- **On-device / edge inference.** Running the model on the phone instead of a server. Costs: model size, latency, battery. *In obd:* BM4.

### Evaluation

- **Eval.** A repeatable test suite for model behaviour: fixed inputs, known good answers, a scoring rule. *Analogy:* unit tests with rates instead of pass/fail.
- **Train / validation / test split.** Train is what the model learns from, validation is for choices, test is touched **once**.
- **Grouped split.** Keeping everything from one source (a vehicle, a charge session) in the same split. *In obd:* split by vehicle, then session.
- **Leakage.** Test information sneaking into training or tuning. Classic causes: windows from one session in two splits, tuning on the test set.
- **Leave-one-group-out.** Train on all vehicles but one, test on that one, repeat. Honest when you have few vehicles.
- **LLM-as-judge.** Using a model to grade output. Biased; check it against your own labels and report agreement with n.
- **Regression suite.** Saved inputs and outputs replayed in CI so a change that breaks behaviour fails the build. *In obd:* saved model responses replayed through the checkers (BM5).

### Training and serving LLMs (for BM7 only)

- **Fine-tuning / SFT.** Continuing training on input → ideal-output pairs. Changes behaviour and format well, adds facts poorly.
- **LoRA.** Training small adapter matrices while the base model stays frozen. Cheap; the adapter file is small.
- **Distillation.** Training a small model to imitate a larger one's outputs. *In obd:* BM7 on reviewed hosted summaries.
- **Loss / overfitting.** Loss measures how wrong predictions are; overfitting is training loss falling while validation stalls.
- **Quantization.** Storing weights at lower precision to save memory. Doesn't always make things faster; measure.

## 4. Prerequisites you may be missing

Just enough of each. Don't go deeper until a later week needs it.

**Python and notebooks (2–4 hours if new).** Functions, lists and dicts, comprehensions, virtual environments (`uv` is already used here), Jupyter notebooks. Google Colab is the easiest start.

**pandas and numpy (4–6 hours).** DataFrames, indexing by time, `resample`, `groupby`, merging. Battery logs are time series, so this is the workhorse.

**scikit-learn (3–4 hours).** The `fit` / `predict` API, pipelines, `GroupKFold` for grouped splits, metrics. The "Getting Started" and user-guide pages for ensembles and model selection are enough.

**Basic statistics (3–4 hours).**
- Mean vs. median vs. percentile (p50/p95).
- Small samples: 7/9 is not "78%" in any trustworthy sense. Report it as 7/9, with a bootstrap interval where it helps.
- Precision and recall when classes are imbalanced (most battery sessions are healthy).
- What a prediction interval is and what coverage means.

**Battery basics (3 hours).** SOC vs. state of health, capacity (kWh, Ah), cell voltage and why spread matters, how a lithium-ion charge curve looks, what a BMS does. The [Battery University](https://batteryuniversity.com) articles on capacity and cell balancing are a readable start; check anything you plan to rely on against a second source.

## 5. Courses and what to take from them

**Hugging Face LLM Course** (<https://huggingface.co/learn/llm-course>): chapters 0, 1, 2 in week 1 (setup, transformers, the tokenizer → model pipeline). Chapters 3, 5, 10, 11 only when you start BM7. Skip the rest for now.

**scikit-learn user guide** (<https://scikit-learn.org/stable/user_guide.html>): ensembles (gradient boosting), Gaussian processes, cross-validation with groups, outlier detection (isolation forest).

**Conformal prediction:** Angelopoulos and Bates, "A Gentle Introduction to Conformal Prediction and Distribution-Free Uncertainty Quantification" (<https://arxiv.org/abs/2107.07511>). Read sections 1–2 and run the split-conformal example yourself.

**Time series:** Hyndman and Athanasopoulos, *Forecasting: Principles and Practice* (free online, <https://otexts.com/fpp3/>). Chapters on time-series graphics, decomposition, and evaluating accuracy.

**MCP:** the Model Context Protocol docs and quickstart (<https://modelcontextprotocol.io>). Build the quickstart server before designing the car server.

## 6. Six-week plan

Each week has a goal, reading, one hands-on exercise with a definition of done, common pitfalls, and a self-check. Hours are rough estimates for full-time study. Keep all practice notebooks and notes **outside** `fixtures/` and out of any task evidence. A personal scratch folder or separate repo is fine.

### Week 1: model fundamentals

**Goal.** Explain what happens between sending a prompt and getting a response.

**Read / watch (about 12–15 h):**
- 3Blue1Brown's neural network series, including the transformer and attention videos (<https://www.3blue1brown.com/topics/neural-networks>).
- Karpathy's "Neural Networks: Zero to Hero" (<https://karpathy.ai/zero-to-hero.html>). Minimum: "Let's build GPT" and "Let's build the GPT Tokenizer".
- HF course chapters 0, 1, 2.
- Python prerequisites from section 4, as needed.

**Build (about 20 h):**
1. Write a synthetic battery report by hand as JSON: SOC, pack voltage, cell min/max, a capacity estimate with an interval, a couple of codes. Don't copy anything from `fixtures/recordings/`.
2. Tokenize it with a small open model's tokenizer. Print the token count and look at how numbers split.
3. Ask a hosted model to summarize it in plain language, at low and higher temperature, several times each. Compare.
4. Ask it something the report can't answer ("how many km until 70%?") and watch what it invents.

**Done when.** A notebook plus a half-page note: token count, how output varied, and one hallucination with your explanation of why it happened.

**Self-check. Can you explain:**
- [ ] why cost and limits are counted in tokens?
- [ ] what attention does, in one paragraph with no math?
- [ ] why prompting doesn't change the model, and what does?
- [ ] why a model hallucinates numbers, and two ways an application contains the damage?

### Week 2: application engineering, guardrails, and evals

**Goal.** Build a small but honest LLM feature, guard it in code, and measure it. The most interview-relevant week.

**Read (about 12 h):**
- Anthropic, "Building effective agents" and "Effective context engineering for AI agents" (Anthropic engineering blog).
- Claude API docs on tool use, structured outputs, and prompt caching. When implementing in this repo, use the `claude-api` skill rather than memory for model IDs and parameters.
- Hamel Husain on evals and error analysis (<https://hamel.dev>).
- Eugene Yan, "Patterns for Building LLM-based Systems & Products" (<https://eugeneyan.com/writing/llm-patterns/>).
- Chip Huyen, *AI Engineering* (O'Reilly, 2025): the evaluation and guardrail chapters.

**Build (about 25 h):**
1. Write 20–30 synthetic battery reports: healthy, high cell spread, missing data, a capacity with a wide interval. For each, write what a good summary must mention.
2. **Before writing any prompt**, split them into development and test sets. Don't open the test set again until step 6.
3. Structured output: summary text plus a list of the numbers it cites, each with the report field it came from.
4. A **number checker** in code: extract every number from the text and match it against the report. A mismatch fails, and the fallback is a template.
5. A tool-calling version: the model can call `get_report_field` instead of seeing the whole report. Add one prompt-injection case (instructions hidden in a "notes" field).
6. Run once on the test set: checker failures, missed flags, injection result, tokens, latency, cost.
7. Grade 20 outputs yourself, then have a judge model grade the same 20. Report agreement.

**Done when.** A results table (dev and test separate, with denominators), judge-vs-you agreement with n, three failure examples with your diagnosis, and a note on what the checker caught that the judge missed or vice versa.

**Pitfalls.** Tuning on the test set. Scoring only whether the answer "looks good". Trusting an unchecked judge. Putting guardrails in the prompt instead of in code.

**Self-check. Can you explain:**
- [ ] why you validate output in code, and what happens when validation fails?
- [ ] how tool calling works, and why the model never executes the tool?
- [ ] what prompt injection is and how your design limits it?
- [ ] why a test set must be frozen before prompt iteration?
- [ ] how LLM-as-judge can mislead, and how you checked yours?
- [ ] what prompt caching saves and when it helps?

### Week 3: time-series ML and uncertainty

**Goal.** Train a model on battery data, put intervals on its predictions, and measure whether the intervals hold.

**Read (about 12 h):**
- scikit-learn guide: gradient boosting, Gaussian processes, `GroupKFold`.
- Angelopoulos and Bates on conformal prediction, sections 1–2.
- *Forecasting: Principles and Practice*: time-series graphics and evaluating accuracy.
- Severson et al., "Data-driven prediction of battery cycle life before capacity degradation" (Nature Energy, 2019): abstract, figures, and the features they used.

**Build (about 25 h):**
1. Pick a public battery dataset from [ML.md](ML.md) and read its license first. Load it with pandas.
2. Build features per cell and cycle: capacity, voltage-curve shape, and so on. Resample onto a regular grid.
3. Split **by cell**, not by row, into train, calibration, and test.
4. Train a gradient-boosted model and a Gaussian process to predict capacity. Compare with a simple baseline (last value, or linear trend).
5. Apply split conformal prediction using the calibration set. Report the interval width and the coverage on the test set.
6. Break it on purpose: split by row instead of by cell and watch the scores look better than they should. Write down why.

**Done when.** A table of error and coverage per model, with n, the leakage demonstration from step 6, and a paragraph on what would change with real vehicle data instead of lab cells.

**Pitfalls.** Row-level splits. Calibrating on the test set. Reporting average interval width without coverage. Treating lab cells as if they were Ultium packs.

**Self-check. Can you explain:**
- [ ] why gradient boosting is the default for tabular data?
- [ ] what a Gaussian process gives you that boosting doesn't?
- [ ] how split conformal prediction works, and what it assumes? (Exchangeability: why one car's sessions over seasons break it, and why ADR-016 leads with a Bayesian interval instead.)
- [ ] what coverage is, and what an overconfident interval looks like?
- [ ] why you split by cell or vehicle, and what leakage looked like in your run?

### Week 4: anomalies, edge deployment, drift, and agents with MCP

**Goal.** Detect a problem without real labels, run a model on the device, notice drift, and let an agent use a tool you built, safely.

**Read (about 10 h):**
- scikit-learn guide: novelty and outlier detection.
- *AI Engineering*: the chapters on deployment and monitoring.
- MCP docs: concepts (servers, tools) and the quickstart.
- Anthropic, "Building effective agents" (again, the agent sections).

**Build (about 25 h):**
1. **Anomalies.** From the week-3 data, take healthy series and inject a synthetic fault (for example, one cell drifting low). Train a residual model or isolation forest on healthy data only. Measure detection rate, time to detection, and false positives on healthy data. Label everything synthetic.
2. **Edge.** Export the week-3 tree model to JSON (or ONNX) and evaluate it in a small TypeScript script. Confirm it gives the same predictions as Python on the same inputs. Time it.
3. **Drift.** Shift one input's distribution (simulate an over-the-air update changing a signal's scale) and build a check that flags it.
4. **MCP.** Build a small MCP server with two tools over a fake device: `send_command` with an allowlist, and `read_log`. Connect an agent (Claude Code works). Ask it to do a task that needs several calls. Then ask it to send a forbidden command and confirm the server, not the prompt, blocks it.

**Done when.** Detection and false-positive numbers, a Python-vs-TypeScript agreement check with latency, a drift check that fires, and an agent transcript showing a blocked command.

**Pitfalls.** Evaluating anomaly detection only on injected faults and forgetting false positives on healthy data. Trusting an exported model without comparing outputs. Enforcing tool permissions in the prompt.

**Self-check. Can you explain:**
- [ ] how to evaluate anomaly detection when real faults are rare?
- [ ] why synthetic results are reported separately?
- [ ] what changes when a model runs on a phone instead of a server?
- [ ] what drift is and how you'd notice it?
- [ ] what MCP is and why it's useful beyond one agent?
- [ ] where agent permissions must be enforced, and why?

### Week 5: write-ups

**Goal.** Turn weeks 1–4 into evidence you can talk through.

**Do (about 30 h):**
- For each exercise, one page: the question, the setup (data, models, versions), the results table, three failures, limitations, what you'd do next.
- Put the notebooks and write-ups in a public personal repo with instructions to reproduce them.
- A one-paragraph summary of each for your resume or LinkedIn. Only numbers you actually measured.
- Re-read the glossary. Anything you can't explain without notes goes back on the list.

**Done when.** Someone else could rerun each exercise from your write-up, and every number has a source.

### Week 6: interview prep, and back to the real project

**Goal.** Practise explaining, and keep the real work moving so BM1–BM5 start with real evidence.

**Do:**
- Work through section 9. Answer each question out loud or in writing, under 2 minutes each.
- Mock interviews: have Claude play interviewer and push back on vague answers.
- Keep Phase 0 and Phase 2 moving in this repo. Real charge logs and the relay are what turn practice into portfolio evidence.

**Optional (BM7 prep).** HF course chapters 3, 5, 10, 11; the LoRA paper (<https://arxiv.org/abs/2106.09685>); a small LoRA run on a public dataset in Colab. Only after the rest is solid.

## 7. How this maps onto the project

| Project task | Skills needed | Guide week | What still has to happen before it's real |
|---|---|---|---|
| T0.6 car MCP server | MCP, tool design, allowlists | 4 | T0.8 app with BLE on the phone |
| T2.3 agent-driven discovery | Agent loops, human in the loop, measuring agent precision | 2, 4 | Gate A passed; relay running |
| T2.10 LLM summary | Structured output, faithfulness check, prompt caching | 1, 2 | Battery report (T2.6) exists |
| T2.11 assistant | Tool calling, prompt injection, refusing when data is missing | 2 | Stored charge sessions |
| BM1 dataset pipeline | pandas, resampling, grouped splits, provenance | 3 | Charge logs (T2.4) and beta data (T2.9) |
| BM2 independent capacity + Bayesian trend | Coulomb counting, OCV curves, error budgets, Kalman filters/GPs, rolling-origin coverage (conformal as a check; exchangeability) | 3 | Several real charges; a reference method per charge |
| BM3 imbalance anomalies | Fault injection, detection metrics, false positives | 4 | Healthy real sessions to inject into |
| BM8 resistance + circuit model | Equivalent-circuit models, ΔV/ΔI at current steps, small residual networks trained on voltage (self-labelling) | 3, 4 | Current and group voltages polled every cycle (T2.4); driving and charging sessions |
| BM4 on-device and drift | Model export, parity checks, drift detection | 4 | A BM2 or BM3 model worth shipping; runtime chosen in the spec |
| BM5 LLM eval infrastructure | Evals, judge calibration, CI regression suites | 2 | T2.10 and T2.11 built |
| BM6 write-ups | Writing with numbers and failures | 5 | BM2–BM5 evidence exists |
| BM7 distillation (stretch) | Fine-tuning, LoRA, comparing against the hosted model | optional | Enough reviewed BM5 summaries; compute and cap in the spec |

## 8. Resources

Grouped by topic. Links and course contents change, so check them.

**Fundamentals**
- 3Blue1Brown, neural networks series: <https://www.3blue1brown.com/topics/neural-networks>.
- Andrej Karpathy, "Neural Networks: Zero to Hero": <https://karpathy.ai/zero-to-hero.html>.
- Hugging Face LLM Course: <https://huggingface.co/learn/llm-course>.

**Application engineering and agents**
- Anthropic, "Building effective agents" and "Effective context engineering for AI agents" (Anthropic engineering blog).
- Claude API documentation: tool use, structured outputs, prompt caching.
- Model Context Protocol: <https://modelcontextprotocol.io>.
- Eugene Yan, "Patterns for Building LLM-based Systems & Products": <https://eugeneyan.com/writing/llm-patterns/>.
- Chip Huyen, *AI Engineering* (O'Reilly, 2025). **The best single book for this whole track.**

**Evals**
- Hamel Husain's blog: <https://hamel.dev>.
- [EVAL.md](EVAL.md) in this repo: a real example of eval design.

**Classical ML, time series, and uncertainty**
- scikit-learn user guide: <https://scikit-learn.org/stable/user_guide.html>.
- Angelopoulos and Bates, conformal prediction introduction: <https://arxiv.org/abs/2107.07511>.
- Hyndman and Athanasopoulos, *Forecasting: Principles and Practice*: <https://otexts.com/fpp3/>.

**Batteries**
- Severson et al., Nature Energy 2019, and its dataset (linked in [ML.md](ML.md)).
- CALCE battery data: <https://calce.umd.edu/battery-data>.
- PyBaMM (battery simulation; the stretch in ML.md): <https://github.com/pybamm-team/PyBaMM>.

**Fine-tuning (BM7 only)**
- LoRA: <https://arxiv.org/abs/2106.09685>. QLoRA: <https://arxiv.org/abs/2305.14314>.
- TRL SFT trainer docs; HF smol-course: <https://github.com/huggingface/smol-course>.

## 9. Interview readiness

### Turning an exercise into a story

For each exercise, have a 2-minute version and a 10-minute version covering:
1. **Question.** What were you trying to find out?
2. **Setup.** Data, models, versions, and how you kept the test set clean.
3. **Numbers.** The results, with denominators.
4. **Failure.** Something that went wrong, how you found it, and what it taught you.
5. **Decision.** What you'd do next, or recommend, and why.

Interviewers usually remember the failure more than the result. "The intervals looked fine until I split by vehicle instead of by session" is a strong answer.

### Questions to practise, by layer

**Fundamentals**
- What is a token, and why does it matter for cost and limits?
- Why do LLMs hallucinate, and how do you contain it in a product?

**Application engineering**
- How would you design an LLM feature whose numbers users will act on? (Structured output, a code-level check, a deterministic fallback.)
- RAG vs. fine-tuning vs. prompting: when do you use which?
- How do you defend against prompt injection from user-supplied files?
- What does prompt caching save, and how would you verify it's working?

**Agents and tooling**
- When would you build an agent instead of a workflow?
- What is MCP, and how would you design a server that exposes real hardware?
- Where do you enforce what an agent is allowed to do? (Server-side allowlists, not prompts.)
- How would you measure whether an agent's work is any good? (Precision against human verdicts, cost, time.)

**Evals**
- How do you know a prompt change made things better?
- What are the risks of LLM-as-judge, and how did you check yours?
- How do you run LLM regression tests in CI without paying for API calls?
- What's wrong with "92% accuracy on 12 examples"?

**Classical ML and uncertainty**
- Why gradient boosting for tabular data? When would you use a Gaussian process instead?
- Explain conformal prediction to a backend engineer. What does it assume?
- Your 90% intervals cover 70% of the time. What's going on?
- How do you evaluate anomaly detection when real faults are rare?
- How would you split data from 8 vehicles with 5 charges each?

**Deployment and monitoring**
- What changes when a model runs on a phone?
- How would you detect that a model has gone stale after an over-the-air update?

**Fine-tuning (if BM7 happened)**
- Explain LoRA and distillation. When is a small tuned model worth it versus a hosted one?

### What not to claim

- Don't claim results you didn't run. Say "NOT RUN" or "planned".
- Don't present practice-run numbers as obd's results.
- Don't claim certified battery health. The reports are observed data and estimates with intervals.
- Don't say "expert". Say what you built and measured.

### Web skills that transfer

| You already know | AI-work equivalent |
|---|---|
| Validating input at API boundaries (zod) | Structured output validation and faithfulness checks |
| Unit and integration tests | Evals and CI regression suites over saved model responses |
| API design and auth | MCP server design and server-side permissions |
| API latency monitoring, p95s | Model latency on the phone and per LLM call |
| Caching (CDN, Redis) | Prompt caching |
| Feature flags and fallbacks | Opt-in LLM features with deterministic fallbacks |
| Monitoring and alerting | Drift detection and stale-model flags |
| Secure handling of API keys | BYOK, never committing secrets |

## 10. Progress checklist

**Prerequisites**
- [ ] Python basics and a working Colab notebook
- [ ] pandas time-series basics (`resample`, `groupby`)
- [ ] scikit-learn `fit` / `predict`, pipelines, `GroupKFold`
- [ ] Understand p50/p95, bootstrap intervals, precision/recall, coverage
- [ ] Battery basics: SOC, SOH, capacity, cell spread, BMS

**Week 1: fundamentals**
- [ ] 3Blue1Brown neural network and transformer videos
- [ ] Karpathy: Let's build GPT, and the GPT Tokenizer
- [ ] HF chapters 0, 1, 2
- [ ] Exercise: tokenization and sampling notebook on a synthetic battery report, with a hallucination example
- [ ] Self-check answered

**Week 2: application engineering and evals**
- [ ] Anthropic: Building effective agents; Effective context engineering
- [ ] Claude docs: tool use, structured outputs, prompt caching
- [ ] Hamel Husain: evals and error analysis posts
- [ ] Eugene Yan: LLM patterns
- [ ] *AI Engineering*: evaluation and guardrail chapters
- [ ] Exercise: synthetic reports, frozen split, number checker, tool calling, injection case, judge agreement
- [ ] Self-check answered

**Week 3: time-series ML and uncertainty**
- [ ] scikit-learn: boosting, Gaussian processes, grouped cross-validation
- [ ] Conformal prediction introduction, sections 1–2
- [ ] *Forecasting: Principles and Practice*: graphics and accuracy chapters
- [ ] Severson et al. paper: abstract, figures, features
- [ ] Exercise: capacity models with conformal intervals, coverage table, leakage demonstration
- [ ] Self-check answered

**Week 4: anomalies, edge, drift, and MCP**
- [ ] scikit-learn: outlier and novelty detection
- [ ] MCP docs and quickstart server
- [ ] Exercise: injected-fault detection, Python/TypeScript parity, drift check, MCP server with a blocked command
- [ ] Self-check answered

**Week 5: write-ups**
- [ ] One-page write-up per exercise
- [ ] Public practice repo with reproduction instructions
- [ ] Resume and LinkedIn summaries using only measured numbers

**Week 6: interview prep**
- [ ] Every question in section 9 answered in under 2 minutes
- [ ] Three stories with numbers and a failure each
- [ ] At least two mock interviews
- [ ] Phase 0 / Phase 2 work continuing in this repo
