# Battery ML showcase and data strategy (portfolio evidence for applied-ML / AI-engineer hiring, Sept 2026)

Scope note: about 20 tool calls. Sources marked **[fetched]** were read in full this session. Sources marked **[search snippet]** were seen only as search-result summaries. Sources marked **[not fetched, well-known primary]** are standard references cited from background knowledge; check them before quoting. Opinion is labelled as opinion.

## 1. What 2025–2026 hiring signals value (end-to-end, evals, UQ, edge, MLOps vs "LLM wrappers")

### Takeaway
The best practitioner sources (Hamel Husain, Eugene Yan) consistently reward **data literacy, evaluation design, and error analysis**, not model novelty or API integration. Battery-ML job postings (for example Rivian) instead reward **domain physics plus field-data work**: reconciling field data with aging models and predicting lifetime from large datasets. A project that pairs rigorous evals with battery field data covers both. A chat UI on top of an API is widely described, as opinion, as undifferentiated.

### Cited Findings
- **Hamel Husain (opinion, practitioner; Mar 26 2026):** "The bulk of the work is setting up experiments to test how well the AI generalizes to unseen data, debugging stochastic systems, and designing good metrics." He also writes: "A data scientist would not adopt metrics off the shelf. They would explore the data, explore the traces, ask 'what is actually breaking here?'" His thesis is that the value lies in evaluation harnesses and experimental method, not model training. — [The Revenge of the Data Scientist](https://hamel.dev/blog/posts/revenge/) **[fetched]**
- Hamel Husain and Shreya Shankar's evals course reports 5,000+ students from 500+ companies, including OpenAI, Anthropic, and Google. This shows market demand for eval skills. The figure is a self-reported marketing number. — [AI Engineer speaker page](https://ai.engineer/speakers/hamel-husain), [Maven course](https://maven.com/parlance-labs/evals) **[search snippet]**. See also [Evals FAQ](https://hamel.dev/blog/posts/evals-faq/) and [Lenny's Newsletter: "Why AI evals are the hottest new skill"](https://www.lennysnewsletter.com/p/why-ai-evals-are-the-hottest-new-skill) **[search snippet]**
- **Eugene Yan (opinion; ex-Amazon Principal Applied Scientist, now at Anthropic):** hiring rubric values "data literacy means understanding and respecting the data, being proficient at data analysis" and "having a basic understanding of evals is key for anyone building ML-powered products". He also values comfort with model uncertainty, plus non-technical traits: ambiguity, influence, complexity, execution. He assesses past work through STAR stories (constraints, measured impact) rather than particular artifact types. — [How to Interview and Hire ML/AI Engineers](https://eugeneyan.com/writing/how-to-interview/) **[fetched]**; bio at [eugeneyan.com/about](https://eugeneyan.com/about/) **[search snippet]**
- **Chip Huyen, *AI Engineering* (2025):** the book covers evaluation, retrieval, prompting, agents, latency, and cost as core AI-engineering topics, and argues that automated (LLM) judges need expert review and inspection of real outputs. — [aie-book repo](https://github.com/chiphuyen/aie-book) **[search snippet]**. I found no direct Huyen writing on *portfolio* advice.
- **"LLM wrapper" skepticism (opinion, low-authority career blogs):** "Every hiring manager has seen the same project a hundred times: a chatbot that wraps the OpenAI API with a simple frontend… they don't differentiate you." The same sources say recruiters want "evaluation harnesses", "deployed applications with real users, comprehensive testing, and documented architecture decisions." — [Elite AI Advantage](https://eliteaiadvantage.com/blog/ai-portfolio-projects-get-hired-ai-engineer), [Careery](https://careery.pro/blog/ai-careers/ai-engineer-project-ideas) **[search snippet]**. These are content-marketing sites, not hiring data. Treat them as a widely repeated opinion only.
- **Rivian, Sr. Battery ML Engineer (posting open until at least Feb 20 2026; $117.2k–$146.5k CA):** responsibilities include "Reconcile field data with aging models", predicting "cell and pack lifetime performance using large datasets", and integrating "vehicle and driving profile data, pack state-of-health". Requirements are Python with "supervised and unsupervised machine learning" plus "Multi-scale physics modeling, thermal modeling, electrochemical modeling… MATLAB, C++, ANSYS, COMSOL". Preferred: P2D/ECM modeling, electrochemistry, SQL, CNN/GNN. Nothing about LLMs. — [ClimateTechList mirror of Rivian posting](https://www.climatetechlist.com/job/rivian-sr-battery-machine-learning-engineer-SPxq2r9QqLUB2T) **[fetched]**
- **Romeo Power, Battery ML Engineer/Data Scientist (older posting):** builds a cloud "Battery Management Intelligence Pipeline" for diagnostics and prognostics, including "simulations of battery models". — [startup.jobs](https://startup.jobs/battery-machine-learning-engineer-data-scientist-romeo-power-2492074) **[search snippet]**
- **Recurrent (the closest analogue to this project's product):** uses "vehicle telematic data to build machine learning models that predict battery health today" and forecasts range three years out. It reports data from 50,000+ vehicles and 1.1B miles, and describes itself as "less invasive" than diagnostic tools. It detects pack replacements from recall status, owner self-reports, and "unusual jumps in vehicle range". It reports roughly 1–2%/yr range degradation. — [Recurrent research](https://www.recurrentauto.com/research/lessons-in-electric-car-battery-health), [battery testing](https://www.recurrentauto.com/research/all-about-battery-testing), [for owners](https://www.recurrentauto.com/for-owners) **[search snippet]**

### Inferences
- **Ranking of the planned ML pieces, by expected hiring value (my inference from the sources above):**
  1. **Capacity/SOH estimation from real field data with honest evaluation**: vehicle- and session-grouped splits, a comparison against the BMS/physics baseline, and conformal intervals with measured coverage. This maps directly onto Rivian's "reconcile field data with aging models" and Recurrent's core product. It also shows the Husain/Yan "data literacy + evals" traits. Conformal intervals are a strong differentiator only if the empirical coverage is reported per vehicle or regime, including where it fails.
  2. **LLM eval infrastructure** (faithfulness checker, judge calibration against human labels, CI regression). This is the most direct match to the 2025–26 AI-engineer eval discourse (Husain, Huyen). It turns the LLM feature from "wrapper" into "measured system". Judge calibration (agreement with hand labels, confusion matrix) is the signal to show.
  3. **Anomaly detection with injected faults**. Valuable if the fault injection is physically motivated (for example PyBaMM or ECM-perturbed cells) and precision/recall per fault type is reported. Otherwise it reads as a toy.
  4. **On-device inference plus drift monitoring**. Useful signal for edge/MLOps, but secondary unless drift is shown on real data (for example seasonal temperature shift).
  5. **Distillation**. Lowest marginal value for this domain. Optional.
- Battery-company postings lean toward physics and electrochemistry. A web-dev background will not compete on P2D/COMSOL. The realistic lane is "field-data ML engineer who respects physics": use PyBaMM/ECM as a baseline or a data generator, and state its limits.
- The MCP relay and the agentic build process are good *AI-engineer* signal. Frame them as infrastructure that makes the data trustworthy (read-only allowlist, provenance, immutable recordings), not as the headline ML.

### Gaps
- No quantitative survey (for example of hiring managers) found that ranks UQ vs MLOps vs edge deployment. The evidence is opinion plus job-posting text.
- Did not retrieve current postings from Recurrent, Twaice, Voltaiq, Accure, Elysia, Aviloo, GM, or Tesla. Searches returned Rivian and Romeo only. Check their careers pages directly.
- No Jason Liu source retrieved.

## 2. Exemplary battery/EV ML portfolio projects and open datasets

### Takeaway
Credible open **field** EV battery data is scarce and usually non-commercially licensed. The main example is EVBattery (He et al.), which covers hundreds of EVs and is CC BY-NC-ND. Most Kaggle "EV battery" datasets are opaque or synthetic. A small, well-documented, consented dataset of real **Ultium** charge sessions with clear provenance would stand out because almost none exists.

### Cited Findings
- **EVBattery (He, …, Minggao Ouyang; arXiv 2201.12358, revised Nov 2023):** "charging records collected from hundreds of EVs from three manufacturers over several years", described as "the first large-scale public dataset on real-world battery data". It supports battery health and capacity estimation tasks. **License: CC BY-NC-ND 4.0.** — [arXiv abstract](https://arxiv.org/abs/2201.12358) **[fetched]**. The search snippet gives 464 EVs, over 2 years, 1.2M+ charging snippets of 128 records each — [arXiv PDF](https://arxiv.org/pdf/2201.12358) **[search snippet]**
- A 2025 Nature Communications paper builds a multi-modal SOH framework on "open-source electric vehicle data". — [Nature Comms s41467-025-56485-7](https://www.nature.com/articles/s41467-025-56485-7), [PMC11779878](https://pmc.ncbi.nlm.nih.gov/articles/PMC11779878/) **[search snippet; full text blocked]**
- Field-data SOH papers: "Towards real-world state of health estimation: Part 2, system level method using electric vehicle field data" — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S2590116824000511) **[search snippet]**. On electric buses: "Robust SOH estimation for Li-ion battery packs of real-world electric buses with charging segments" — [Sci Rep](https://www.nature.com/articles/s41598-025-09108-6) **[search snippet]**. Transfer learning from partial charging — [PMC13396333](https://pmc.ncbi.nlm.nih.gov/articles/PMC13396333/) **[search snippet]**
- Kaggle "EV Battery Charging & Thermal Runaway Dataset" claims real-time measurements including SOH, internal resistance, and BMS status, with no clear provenance in the snippet. — [Kaggle](https://www.kaggle.com/datasets/zara2099/ev-battery-charging-and-thermal-runaway-dataset) **[search snippet]**. Similar: [Kaggle EV Battery Charging Dataset](https://www.kaggle.com/datasets/programmer3/ev-battery-charging-dataset). Hugging Face example: [batteryinfodata0.1](https://huggingface.co/datasets/fatihardazengin/batteryinfodata0.1/viewer). Provenance is unclear for all three. Treat them as possibly synthetic.
- Charging-*behaviour* datasets, not battery-state datasets: ACN (Caltech/JPL, 2019–2021) and a 72,856-session / 2,337-user transactions dataset — [PMC10907370](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10907370/) **[search snippet]**. There is also a synthetic generator, ev-flow — [arXiv 2606.19520](https://arxiv.org/pdf/2606.19520) **[search snippet]**. These are useful context but have no cell-level signals.
- Lab datasets commonly used for pretraining and baselines **[not fetched, well-known primary]**: Severson et al. 2019 *Nature Energy*, 124 LFP cells fast-charged to end of life ([data.matr.io/1](https://data.matr.io/1/)); NASA PCoE battery data ([NASA Prognostics Data Repository](https://www.nasa.gov/intelligent-systems-division/discovery-and-systems-health/pcoe/pcoe-data-set-repository/)); CALCE ([calce.umd.edu/battery-data](https://calce.umd.edu/battery-data)). Their chemistries and formats differ from Ultium NCMA pouch packs. Use them for method validation, not as Ultium ground truth.
- PyBaMM (open-source Python battery models: SPM, SPMe, DFN; parameter sets) for simulation and fault injection — [pybamm.org](https://pybamm.org/) **[not fetched, well-known primary]**

### Inferences
- What makes a project stand out, inferred from how EVBattery is positioned ("first large-scale public real-world"): **real field data plus a clear task definition plus a clear license**. For a solo developer the equivalent is a small but honest dataset with a datasheet, grouped splits, and a baseline anyone can rerun.
- Keep real and synthetic (PyBaMM, fault-injected) results in separate tables. This matches AGENTS.md rule 11 and the Husain-style "look at the data" credibility.
- Recommended presentation bundle (inference; see the model-card and datasheet references below):
  - a long-form write-up per model: problem, data, splits, baseline, metrics, coverage, failure cases, and what was not run
  - a model card: [Mitchell et al. 2019, arXiv 1810.03993](https://arxiv.org/abs/1810.03993) **[not fetched, well-known primary]**
  - a datasheet for the dataset: [Gebru et al., arXiv 1803.09010](https://arxiv.org/abs/1803.09010) **[not fetched, well-known primary]**
  - a reproducible repo with one command from raw recordings to metrics
  - a short demo video of the phone reading the real car
  - optionally a Hugging Face dataset card and a talk at a local meetup

### Gaps
- Could not find specific *individual* (non-academic) battery-ML portfolio projects with documented hiring outcomes. No reliable source.
- Could not read the full Nature Comms paper (paywall redirect), so its dataset list and license terms are unverified.
- No public Ultium / Equinox EV cell-level dataset found.

## 3. Data sufficiency and ML-ready collection design

### Takeaway
Field SOH labels come from ampere-hour integration over charging segments with OCV–SOC correction. Single-segment labels are noisy, so papers aggregate: median over about 30 days or per about 1,000 km. Accuracy depends strongly on the SOC window. With one to a few vehicles, the realistic ML claim is **per-vehicle capacity tracking with calibrated intervals and a documented noise floor**, not fleet-level SOH prediction. Year-scale aging (about 1–2%/yr per Recurrent) is smaller than single-session label noise over a portfolio timeframe.

### Cited Findings
- SOH labels in field studies: "obtained… with ampere-hour integration and open circuit voltage (OCV)–SOC correction". Some studies use a fixed window (for example SOC 65→80%), but that is "highly susceptible to fluctuations caused by sensor anomalies". — [Nature Comms / PMC11779878](https://pmc.ncbi.nlm.nih.gov/articles/PMC11779878/), [Sci Rep e-bus SOH](https://www.nature.com/articles/s41598-025-09108-6) **[search snippet]**
- Noise reduction: "averaging or taking the median of capacity data over 30 consecutive days as the SOH label, or calculating average capacity within every 1,000 km of driving". — same sources **[search snippet]**
- SOC-window effect: "Charge profiles beginning between SOC=5%-20% and between SOC=50%-70% have lower error values, while those starting between SOC=30%-40% have higher errors, potentially due to lower rates of voltage change in this region." — [PMC13396333 transfer learning from partial charging](https://pmc.ncbi.nlm.nih.gov/articles/PMC13396333/) **[search snippet]**
- Field challenges: "complex and uncontrollable vehicle operating conditions, low accuracy of BMS state estimation, and data quality deficiencies". — [PMC11779878](https://pmc.ncbi.nlm.nih.gov/articles/PMC11779878/) **[search snippet]**
- Scale reference points: EVBattery has 464 EVs and 1.2M snippets ([arXiv](https://arxiv.org/pdf/2201.12358)). Recurrent has 50k+ vehicles ([Recurrent](https://www.recurrentauto.com/for-owners)). Degradation is about 1–2%/yr ([Recurrent](https://www.recurrentauto.com/research/how-long-do-ev-batteries-last)). **[search snippet]**

### Inferences (no source gives a minimum N; these are reasoned design recommendations)
- **Capacity model:** with one car, aim for dozens of charge sessions spanning seasons (temperature) and varied start SOC. Report per-session estimate spread as the noise floor. Only claim a trend if it exceeds that floor. Across vehicles, even 5–20 Ultium owners enables leave-one-vehicle-out evaluation, which is the credible split. Conformal coverage estimates need calibration sets of at least tens of sessions to be meaningful. Report the coverage confidence interval.
- **Anomaly detection:** real cell faults will be rare or absent in a tiny fleet. Evaluate on injected faults (label them synthetic) and report the false-alarm rate on real healthy sessions. The false-alarm rate on real data is the honest real-data metric.
- **Log from day one:**
  - per sample: timestamp, raw frame, decoded value, units, source PID/DID with a citation
  - per session: charger type (L1/L2/DCFC), start/end SOC, ambient and pack temperature, odometer, firmware or software version if readable, dongle and app version, transport
  - vehicle: hashed vehicle ID, model/year/trim, pack variant
  - labels: reference capacity (dealer or BMS-reported), known events (pack service), and whether each field is real or synthetic
  - consent record ID
  - immutable raw recordings (already an AGENTS.md rule) plus derived tables built by a versioned pipeline
- Pre-register split rules (by vehicle, then by session, before augmentation). This matches AGENTS.md rule 11.

### Gaps
- No source gives a quantitative minimum number of sessions or vehicles for SOH or anomaly models. This needs an empirical noise-floor study on the project's own data.
- No Ultium-specific field SOH literature found.

## 4. Privacy and legal (Canada), VINs, consent, dataset licensing

### Takeaway
PIPEDA applies to personal information handled "in the course of commercial activity". A free hobby app may fall outside it, but a paid inspection service clearly falls inside, and the OPC judges the nature of the activity, not the profit status. VIN-linked vehicle data should be treated as personal information. Use express, granular, revocable consent. Publish only de-identified, aggregated data under a license that matches the consent terms.

### Cited Findings
- PIPEDA covers "private-sector organizations across Canada that collect, use, or disclose personal information in the course of a commercial activity". Its 10 principles: Accountability, Identifying Purposes, Consent, Limiting Collection, Limiting Use/Disclosure/Retention, Accuracy, Safeguards, Openness, Individual Access, Challenging Compliance. Alberta, BC, and Quebec have substantially similar laws for in-province activity. Ontario uses PIPEDA for private-sector commercial activity. — [OPC, PIPEDA in brief](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/) **[fetched]**
- "Commercial activity" means "any particular transaction, act or conduct or any regular course of conduct that is of a commercial character". The OPC found a subsidized non-profit daycare engaged in commercial activity, because it looks at the activity itself. — [OPC Interpretation Bulletin: Commercial Activity](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda-compliance-help/pipeda-interpretation-bulletins/interpretations_03_ca/) **[search snippet]**
- **OPC Guidelines for obtaining meaningful consent** have seven principles: emphasize key elements (what, with whom, why, risks); allow individual control; clear yes/no options for non-essential collection; be innovative (just-in-time, mobile-friendly); consider the consumer perspective; make consent dynamic ("an ongoing process"); be accountable. **Express consent** is required when information is sensitive, outside reasonable expectations, or creates "meaningful residual risk of significant harm". — [OPC meaningful consent guidelines](https://www.priv.gc.ca/en/privacy-topics/collecting-personal-information/consent/gl_omc_201805/) **[fetched]**
- **VINs:** an OPC case found that collecting registration data (owner name, address, plate) for an oil change was unnecessary, while reading the VIN from the vehicle itself was acceptable for the service. "The convenience to the company… does not in any way justify the violation of customers' privacy." — [PIPEDA Case Summary #2010-006](https://www.priv.gc.ca/en/opc-actions-and-decisions/investigations/investigations-into-businesses/2010/pipeda-2010-006/) **[fetched]**. The search summary added that a VIN "when referenced with other files, can be related to a natural person" — [OPC Interpretation Bulletin: Personal Information](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda-compliance-help/pipeda-interpretation-bulletins/interpretations_02/) **[search snippet; wording not verified on page]**. For comparison, CCPA regulations treat VINs as potentially personal — [Fox Rothschild](https://dataprivacy.foxrothschild.com/2020/06/articles/california-consumer-privacy-act/ccpa-regulations-vin-i-vidi-vici/) **[search snippet]**
- The OPC is actively studying connected-vehicle privacy. It funds research on automaker privacy permissions and privacy by design for vehicle data, and made a 2026 parliamentary statement on EV-sector data. — [OPC Contributions Program](https://www.priv.gc.ca/en/opc-actions-and-decisions/research/funding-for-privacy-research-and-knowledge-translation/cp_bg/?wbdisable=true), [OPC statement Apr 16 2026](https://www.priv.gc.ca/en/opc-actions-and-decisions/advice-to-parliament/2026/parl_260416/) **[search snippet]**. The EDPB (EU) connected-vehicle guidelines are a useful design reference — [EDPB 01/2020](https://edpb.europa.eu/sites/default/files/consultation/edpb_guidelines_202001_connectedvehicles.pdf) **[search snippet]**
- Licensing precedent: EVBattery uses **CC BY-NC-ND 4.0** ([arXiv](https://arxiv.org/abs/2201.12358)) **[fetched]**. License texts: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) **[not fetched, well-known primary]**

### Inferences
- Design as if PIPEDA applies: it will once inspection customers pay, and forum-recruited beta owners expect it anyway. Concretely:
  - a written purpose statement
  - collect nothing beyond the battery and charge signals needed
  - no GPS
  - a salted hash of the VIN stored locally, with the raw VIN never uploaded or published
  - a timestamp coarsening option
  - an opt-in per use: personal report, research dataset, public release as separate checkboxes
  - withdrawal and deletion on request
  - a retention limit
  - a consent log keyed to the hashed vehicle ID
- Location plus precise charge timestamps can re-identify home and work. Drop GPS and jitter or round timestamps in any public release.
- **License choice:** CC BY 4.0 maximizes reuse and portfolio visibility. CC BY-NC limits commercial reuse, and the "non-commercial" boundary is fuzzy, but it may reassure contributors. Pick one before collecting, and state it in the consent form so contributors agree to the exact public license. Don't re-license later without fresh consent.
- A paid inspection service is a commercial activity. Customer data from it should not flow into a public dataset without separate express consent.
- This is not legal advice. Before collecting from third parties, a short consult with a Canadian privacy lawyer is worth considering.

### Gaps
- No OPC guidance found specifically on *hobby* or free apps. Applicability to a non-commercial phase is uncertain.
- The status of Bill C-27/CPPA (the proposed PIPEDA replacement) as of Sept 2026 was not researched.
- No authoritative source found on whether BMS-level battery telemetry alone, without a VIN, is personal information.

## 5. Lightweight MLOps for a solo project, and how to show it

### Takeaway
Use DVC (or plain content-hashed data manifests) to version data and pipelines, and MLflow (local) or W&B to track runs. For a solo repo, what matters to reviewers is **one reproducible command from raw recordings to reported metrics**, pinned environments, and run records linked from the write-up. Tool breadth matters less.

### Cited Findings
- "DVC focuses on version-controlling datasets, models, and pipelines, while MLflow targets experiment management… unlike DVC which focuses on the file, MLflow focuses on the run." DVC "extends Git" for large files and makes pipelines reproducible. MLflow Tracking logs parameters, code versions, metrics, and artifacts, with a UI. — [Walmart Global Tech blog](https://medium.com/walmartglobaltech/model-and-data-versioning-an-introduction-to-mlflow-and-dvc-260347cd0f6e), [CodeCut DVC intro](https://codecut.ai/introduction-to-dvc-data-version-control-tool-for-machine-learning-projects-2/) **[search snippet]**
- The combined pattern: DVC for data and pipeline stages, MLflow for run metrics. — [Towards Data Science](https://towardsdatascience.com/use-mlflow-and-dvc-for-open-source-reproducible-machine-learning-2ab8c0678a94/), [DEV/AWS builders](https://dev.to/aws-builders/ml-done-right-versioning-datasets-and-models-with-dvc-mlflow-4p3f) **[search snippet]**
- Reproducibility barriers and drivers in ML research (survey) — [arXiv 2406.14325](https://arxiv.org/pdf/2406.14325) **[search snippet]**
- Primary docs: [dvc.org/doc](https://dvc.org/doc), [mlflow.org/docs](https://mlflow.org/docs/latest/index.html) **[not fetched, well-known primary]**

### Inferences
- A minimum credible stack for this repo:
  - `uv`-locked Python in `tools/ml/`
  - a DVC pipeline (`dvc.yaml`) or a content-hash manifest from `fixtures/recordings/` to features, splits, model, and metrics
  - local MLflow file store, or W&B public projects if hosting the run dashboard is useful
  - a seeded, deterministic eval
  - a CI job that reruns the eval on a small fixture subset and fails on metric regression (the same pattern as the planned LLM CI regression)
- **How to show it:**
  - a "Reproduce" section in the README with exact commands and expected numbers
  - a results table that links run IDs
  - a data-lineage diagram
  - a changelog of dataset versions with counts of real vs synthetic
- Avoid overbuilding. Kubeflow, feature stores, and model servers would read as cargo-cult MLOps for a one-person project (opinion, consistent with the repo's simplicity rule). The spec should list any new dependency (DVC, MLflow) per AGENTS.md rule 7.

### Gaps
- No hiring-manager source found that states how much MLOps tooling in a portfolio is weighed. The reasoning here is inference.
- The DVC and MLflow docs were not fetched this session. Confirm current features and versions before choosing.
