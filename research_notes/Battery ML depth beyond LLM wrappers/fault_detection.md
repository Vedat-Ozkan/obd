# Cell/module fault and anomaly detection from EV field data (series cell-group voltages + pack current), as of Sept 2026

Scope note: research budget was about 18 tool calls. Many ScienceDirect/Nature/PMC full texts were paywalled or blocked, so several findings come from abstracts and search-result snippets. Where that is the case it is flagged. Numbers not found are listed as gaps, not estimated.

## 1. Which detection methods are established for series-cell voltage arrays, and which work at low sample rates?

### Takeaway
The field-proven core is cross-cell comparison within one pack: at each timestamp, healthy series cells see the same current, so their voltages are close to a normal distribution, and outliers (z-score, entropy, correlation, distance/clustering) flag the faulty cell. These methods were validated on Chinese national-platform field data sampled every 10 to 30 s. Deep models (autoencoders, LSTM residuals, graph nets, model-constrained networks) have real-vehicle results too, but mostly with fleet-level labels and modest AUROC. Isolation forest and one-class methods show up mostly as baselines or with sliding windows.

### Cited Findings
**Statistical / outlier (field-validated):**
- The core assumption: "cells of the same type in battery packs are exposed to the same external stimuli and their voltage parameters follow a normal distribution," so faults are found as cells with outlier values. — [Sci. Rep. 2024, segmented regression](https://www.nature.com/articles/s41598-024-82960-0) (search snippet)
- Wang Zhenpo et al. (Applied Energy 2017, vol. 196, pp. 289–302): modified Shannon entropy on cell voltages plus a Z-score "security management strategy"; validated on real-time monitoring data from the Service and Management Center for Electric Vehicles (SMC-EV), Beijing; claimed to predict the time and location of voltage faults in the pack. — [Applied Energy abstract](https://www.sciencedirect.com/science/article/abs/pii/S0306261916319262); [BIT Pure record](https://pure.bit.edu.cn/en/publications/voltage-fault-diagnosis-and-prognosis-of-battery-systems-based-on/); [RePEc](https://ideas.repec.org/a/eee/appene/v196y2017icp289-302.html)
- Earlier entropy work: Energies 2018 "Entropy-Based Voltage Fault Diagnosis of Battery Systems for EVs" — [doi:10.3390/en11010136](https://doi.org/10.3390/en11010136) (open access)
- Follow-ups on real vehicles: modified Shannon entropy with misdiagnosis analysis on real EVs ([J. Energy Storage 2023](https://www.sciencedirect.com/science/article/abs/pii/S2352152X23026853)); multi-scale fuzzy entropy on real-scenario packs ([EAAI 2025](https://www.sciencedirect.com/science/article/abs/pii/S0952197625006700)); mutual information for voltage faults ([J. Power Sources 2024](https://www.sciencedirect.com/science/article/abs/pii/S0378775324005883)). All abstracts only.
- Clustering/distance on real EVs: K-means plus the Fréchet distance ([ACS Omega 2022, open access](https://pubs.acs.org/doi/10.1021/acsomega.2c04991)); Gaussian-parameterized LCSS for defect detection on real vehicles ([J. Energy Storage 2023](https://www.sciencedirect.com/science/article/abs/pii/S2352152X23030773)); weighted Euclidean distance plus statistics that classify the type of voltage inconsistency ([Energy 2024](https://www.sciencedirect.com/science/article/abs/pii/S0360544224003475)); time-series decomposition plus an improved Manhattan distance ([ACS Omega](https://pubs.acs.org/doi/10.1021/acsomega.3c06796)).
- Isolation forest with a sliding window for fault diagnosis and early warning on vehicle data ([Energy Sci. & Eng. 2023, Wiley open access](https://scijournals.onlinelibrary.wiley.com/doi/full/10.1002/ese3.1593)). Image features plus an improved isolation forest ([Energy 2025](https://www.sciencedirect.com/science/article/abs/pii/S0360544225044913)).
- A multi-scale, feature-engineering approach detects short-timescale abnormal voltage fluctuations and characterizes long-timescale abnormal evolution on real EVs ([Applied Energy 2024/25](https://www.sciencedirect.com/science/article/abs/pii/S0306261924020178), abstract).

**Correlation-coefficient methods:**
- Recursive correlation coefficient (RCC) on neighbouring cell voltages captures synchronized voltage variation as an early fault signature and suppresses cell inconsistency. It is combined with KPCA for diagnosis. Correlations of neighbouring voltage differences with current separate connection faults from sensor faults. — search-result synthesis of [Energy 2024, connection faults via multiple correlation](https://www.sciencedirect.com/science/article/abs/pii/S0360544224023478) and [J. Energy Storage 2021, adaptive correlation sequence + sparse classification](https://www.sciencedirect.com/science/article/abs/pii/S2352152X21015541) (abstract-level; which paper introduced RCC+KPCA was not confirmed)

**Deep learning on real vehicles:**
- DyAD (Nature Communications 2023): a dynamical autoencoder that feeds charging current, as system input, into the decoder. Data: 3 datasets, >690,000 charging snippets from 347 EVs; vehicle-level anomaly labels; AUROC reported (search snippet gives 70.0% overall, up to 77.9% on one sub-dataset; could not verify the full text). Baselines: AutoEncoder, Deep SVDD, LSTM-AD, GDN. — [Nat. Commun.](https://www.nature.com/articles/s41467-023-41226-5); [PubMed](https://pubmed.ncbi.nlm.nih.gov/37741826/); [code/data repo](https://github.com/962086838/Battery_fault_detection_NC_github)
- MCNN (Nature Communications 2025): a model-constrained deep network that combines physical battery models with neural nets for online diagnosis under stochastic driving. 18.2M valid entries from 515 vehicles; "enhancing the true positive rate by over 46.5% within a false positive rate range of 0 to 0.2"; it estimates trigger probabilities for electrolyte leakage, thermal runaway, ISC, and excessive aging. Code and data are on Zenodo. — [Nat. Commun.](https://www.nature.com/articles/s41467-025-56832-8); [PubMed](https://pubmed.ncbi.nlm.nih.gov/39952987/); [Zenodo 14555916](https://zenodo.org/records/14555916); [Zenodo 10656500](https://zenodo.org/records/10656500)
- Related work evaluated on the DyAD data or on real EVs: BatteryBERT ([arXiv 2506.15712](https://arxiv.org/pdf/2506.15712)); a feature-augmented attentional autoencoder ([Sci. Rep. 2025](https://www.nature.com/articles/s41598-025-03227-w)); an optimized graph neural network for voltage faults ([Sci. Rep. 2025](https://www.nature.com/articles/s41598-025-13188-9)); a physics-aware attention LSTM autoencoder ([arXiv 2512.06809](https://arxiv.org/pdf/2512.06809)); an autoencoder for HV packs ([PMC11902689](https://pmc.ncbi.nlm.nih.gov/articles/PMC11902689/), content not retrievable).
- LSTM plus an equivalent circuit model (ECM), combined for voltage-abnormality diagnosis on EVs (Hong/Wang group). — [ResearchGate](https://www.researchgate.net/publication/342854918_Fault_Diagnosis_of_Battery_Systems_for_Electric_Vehicles_Based_on_Voltage_Abnormality_Combining_the_Long_Short-term_Memory_Neural_Network_and_the_Equivalent_Circuit_Model)
- A 2025 Frontiers review reports that algorithms using real EV data can forecast voltage abnormalities "up to six minutes in advance." — [Frontiers in Energy Research 2025](https://www.frontiersin.org/journals/energy-research/articles/10.3389/fenrg.2025.1529608/full) (snippet)
- Other reviews: "An exhaustive review of battery faults and diagnostic techniques for real-world EV safety" ([J. Energy Storage 2024](https://www.sciencedirect.com/science/article/abs/pii/S2352152X24028202)); "Battery field data and why it matters" ([eTransportation 2025](https://www.sciencedirect.com/science/article/abs/pii/S2590116825001018)); a review of sensor fault diagnosis and fault-tolerant control ([open access, 2024](https://www.sciencedirect.com/science/article/pii/S2095756424001181)).

**Newer 2026 real-vehicle unsupervised work (abstracts only):** frame-level unsupervised diagnosis and localization that works across cell groupings in realistic conditions ([eTransportation 2026](https://www.sciencedirect.com/science/article/abs/pii/S2590116826000378)); unsupervised probabilistic fault detection with risk quantification on real EVs ([2026](https://www.sciencedirect.com/science/article/abs/pii/S2405829726004587)).

**Sample rates:**
- GB/T 32960 (China's national EV remote-monitoring standard) requires upload to platforms. One study uses the standard's 30 s-per-frame minimum; other data is sampled at 10 s. Field sampling is "often limited by the data source… and can even vary for different signals within the same dataset." — search synthesis incl. [Sensors/ACS Omega K-means paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC9648163/) and [eTransportation 2025 field-data review](https://www.sciencedirect.com/science/article/abs/pii/S2590116825001018)

### Inferences
- The project's 0.1–8 s per-signal sampling matches or beats the 10–30 s national-platform data that most real-vehicle papers use. So cross-cell statistical methods (z-score, entropy, correlation, distance) transfer directly. Model-based ECM/Kalman residuals that need synchronous current and voltage at about 1 s are riskier. With ELM327 polling, the 80 group voltages are not read at the same instant as current. Timestamp skew must be modeled, or else comparisons should be limited to rest or quasi-steady windows.
- Kalman-filter innovation and PCA/ICA residual methods clearly exist in the literature, but this search found no specific real-vehicle, citable result for them. See Gaps.
- With about 1 vehicle, supervised deep models (DyAD, MCNN) cannot be trained as published. Their public data is still useful for pretraining or for a cross-dataset sanity check.

### Gaps
- Could not retrieve full text of DyAD/MCNN to confirm exact AUROC, sampling interval, or whether per-cell voltages (vs max/min cell) are included.
- No citable real-vehicle result was found specifically for PCA/ICA residuals, one-class SVM, or Kalman innovations on cell arrays (these exist but were not verified).

## 2. Early internal short circuit and self-discharge detection from rest-period drift: minimum rest and resolution

### Takeaway
Two families have field validation. One uses voltage deviation from the pack mean with adaptive thresholds (it caught faults 9–25 h earlier than fixed thresholds on real vehicles). The other compares remaining charging capacity (RCC) across consecutive charges to estimate leakage current, turning the charger into a periodic "rest-to-full" measurement. No source found gave a hard minimum rest duration or resolution.

### Cited Findings
- Adaptive ISC detection (J. Energy Storage 2024): adaptive thresholds keep normal cell deviation from the mean below threshold with 99.9% confidence. On real vehicle data it identified faults 9–25 h sooner than fixed-threshold methods. — [ScienceDirect abstract](https://www.sciencedirect.com/science/article/abs/pii/S2352152X24004584) (via search snippet)
- RCC method: the difference in a cell's remaining charging capacity between two adjacent charges is the leakage charge over that interval. Divided by the elapsed time, it gives leakage current, which converts to an equivalent short resistance. — [US patent 11867765](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11867765); [ResearchGate: online quantitative ISC diagnosis based on remaining charge capacity](https://www.researchgate.net/publication/402364464_Online_quantitative_diagnosis_algorithm_for_the_internal_short_circuit_of_a_lithium-ion_battery_module_based_on_the_remaining_charge_capacity); classic lab paper [J. Power Sources 2018, micro-short quantitative analysis in packs](https://www.sciencedirect.com/science/article/abs/pii/S0378775318305950)
- Micro-short (MSC) cells show "increasing SOC deviation over time." Features from incremental-capacity (IC) curves were validated on real vehicle data. — [J. Energy Storage 2023, IC-based MSC considering aging](https://www.sciencedirect.com/science/article/abs/pii/S2352152X23036393); [MSC detection considering cell inconsistency, 2023 (open access)](https://www.sciencedirect.com/science/article/pii/S2773153723000452) (403 on fetch)
- The evolution of the charging voltage slope in a variable voltage window catches early ISC in real power battery systems. — [Applied Energy 2024](https://www.sciencedirect.com/science/article/abs/pii/S0306261924016933); ISC diagnosis under incomplete charging and cell inconsistency — [Applied Energy 2025](https://www.sciencedirect.com/science/article/abs/pii/S0306261925015272)
- The GM patent family covers self-discharge prognostics for vehicle cells with an ISC, which suggests the OEM uses rest-period self-discharge monitoring. — [US 11733309](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11733309)
- Model-free ISC detection via the first-order difference of pseudo-OCV (voltage plus current plus an offline R–SOC table): 100% detection, no false alarms across 10 fault and 1 pseudo-fault scenarios. These were experimental tests, not a vehicle fleet. — [arXiv 2506.13394](https://arxiv.org/abs/2506.13394)
- Multivariate information entropy fusing voltage and temperature: 96.88% diagnostic accuracy with 0 false alarms. It was also validated on real EV accident data and flagged the faulty cell 240 s before a visible voltage drop. — [Appl. Sci. 16(10):5078](https://doi.org/10.3390/app16105078) (snippet)
- In quality control, rest-voltage decline beyond a threshold indicates an internal short. — [US patent 10295606](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10295606)

### Inferences
- For this car, the practical ISC and self-discharge detector is the cross-group spread of rest (key-off or parked) voltage between two sessions, plus the per-group SOC deviation trend across charges (RCC-style). The drift that matters is relative to the pack median, which cancels common-mode temperature and relaxation effects.
- Detectable leakage scales as roughly ΔV_resolution × C_group / (dOCV/dSOC × Δt). The 0.1 mV resolution is probably not the binding limit. OCV-curve flatness at the parked SOC, temperature gradients across modules, and relaxation after driving (hours) probably are. This is a derivation, not a sourced figure. Rest windows should start after relaxation and span many hours or days, with SOC recorded.

### Gaps
- No source found giving a minimum rest duration or voltage resolution for a stated leakage current or short resistance on field data. The 9–25 h lead and the 240 s figures are the only timing numbers found.

## 3. Distinguishing sensor faults and connection resistance from true cell faults

### Takeaway
The accepted signatures: a connection or contact-resistance fault gives a load-dependent (∝ current) voltage deviation, usually shared by adjacent sense channels. A sensor offset is a constant, current-independent deviation, and a sensor drift is a deviation that grows with time. A true cell fault (ISC, capacity, or resistance) moves with SOC and persists. Noise is transient and returns to normal within a few samples. Hardware interleaved-measurement topologies make this separation cleaner, but a read-only app cannot add them.

### Cited Findings
- Interleaved voltage measurement (each sensor spans parts of two cells) distinguishes sensor faults from cell faults with no extra sensors or models. Connection faults and increased internal resistance are told apart by the number and location of sensors reading abnormally. — [J. Power Sources 2019, multi-fault via interleaved topology](https://www.sciencedirect.com/science/article/abs/pii/S0378775319300618); [improved interleaved method, J. Power Sources 2016](https://www.sciencedirect.com/science/article/abs/pii/S0378775316313544); [fault-tolerant voltage measurement](https://www.researchgate.net/publication/292209109_A_fault-tolerant_voltage_measurement_method_for_series_connected_battery_packs)
- Correlation of neighbouring voltage differences with current isolates connection faults from sensor faults. Neighbour-voltage correlation with fault flags separates cell faults. — [Energy 2024, connection faults via multiple correlation + adaptive fusion](https://www.sciencedirect.com/science/article/abs/pii/S0360544224023478) (search synthesis)
- Contact resistance is estimated with canonical variable analysis plus local Mahalanobis distance. — [Energy 2025](https://www.sciencedirect.com/science/article/abs/pii/S0360544225002671)
- Periodic checks separate a constant offset (offset fault) from an offset that grows over time (sensor drift). — [US patent 12442868](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12442868)
- Noise or sensor-error anomalies are transient and return to normal at the next samples. Internal battery failures persist. — [K-means + Fréchet on real EVs, ACS Omega 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9648163/) (snippet)
- Voltage inconsistency types: static inconsistency; dynamic inconsistency (progressive fluctuation fault vs sudden fluctuation fault). — [Energy 2024 WED + statistics](https://www.sciencedirect.com/science/article/abs/pii/S0360544224003475); multi-fault envelope method — [ResearchGate](https://www.researchgate.net/publication/360394783_An_Online_Multifault_Diagnosis_Scheme_for_Battery_Packs_Based_on_Voltage_Envelope_Relationship); statistical multi-fault — [Energy 2024](https://www.sciencedirect.com/science/article/abs/pii/S0360544224002366)

### Inferences
- Feasible read-only discriminator: for each group, regress (V_i − median V) on pack current across driving and charging. The slope estimates extra series resistance (cell resistance rise and connection resistance are confounded, but a slope step change points to a connection). The intercept at I = 0 and its drift over time capture offset and drift. The residual trend vs SOC or time captures capacity or self-discharge. Adjacent groups that share a sense lead should show equal and opposite deviations if the fault is a shared-lead resistance. That idea comes from interleaved-topology reasoning and is not verified for Ultium sense wiring.

### Gaps
- Nothing found on the Ultium module sense topology (whether adjacent groups share sense leads). Whether per-module SOC is BMS-computed from the same voltages is unknown, so it is not an independent check.

## 4. How papers inject synthetic faults, and how they report detection rate, time-to-detection, and false alarms

### Takeaway
Lab and HIL work emulates ISC with a resistor (often 0.25 Ω to tens of Ω) placed in parallel with a healthy cell. It adds pseudo-fault stress events (large current pulses without a short) to measure false positives. Metrics are detection accuracy, false alarm rate, lead time (seconds to hours before the voltage anomaly or before a fixed-threshold alarm), AUROC, and TPR at fixed FPR. Deep field models use AUROC and TPR@FPR on vehicle-level labels.

### Cited Findings
- External resistors in parallel with healthy cells are the standard ISC stand-in when natural ISC data is unavailable. One setup added a 0.25 Ω resistor at the peak charge pulse to create a hidden fault, and injected a 50 A discharge pulse with no short as a pseudo-fault to test false positives. — [Appl. Sci. 2026 MIE paper](https://doi.org/10.3390/app16105078) and search synthesis
- Reported metrics: 96.88% accuracy with 0 false alarms and a 240 s lead ([Appl. Sci.](https://doi.org/10.3390/app16105078)); 100% detection with no missed or false alarms across 10 fault and 1 false-fault scenario ([arXiv 2506.13394](https://arxiv.org/abs/2506.13394)); 9–25 h earlier than fixed thresholds ([J. Energy Storage 2024](https://www.sciencedirect.com/science/article/abs/pii/S2352152X24004584)); AUROC ([DyAD](https://github.com/962086838/Battery_fault_detection_NC_github)); TPR within FPR 0–0.2 ([MCNN](https://pubmed.ncbi.nlm.nih.gov/39952987/)); an ECM-based ISC/thermal-runaway early-detection model ([BattBee, arXiv 2506.13577](https://arxiv.org/pdf/2506.13577)).
- OSBAD (arXiv 2511.01745, CC-BY-4.0) is an open benchmark of 15 statistical, distance-based, and unsupervised ML anomaly detectors for battery data. It converts collective anomalies into point anomalies with physics- and statistics-informed features, and uses Bayesian-optimization hyperparameter tuning with transfer-learning and regression proxies, because labels are incomplete. — [arXiv abstract](https://arxiv.org/abs/2511.01745)
- Synthetic-anomaly benchmark practice in a 2026 dataset: 600 synthetic anomalies plus extrapolation samples. — [MagBridge-Battery arXiv 2605.20240](https://arxiv.org/pdf/2605.20240)

### Inferences
Fault models to inject into real healthy logs. These are derived from ECM physics, so treat them as design, not sourced:
- ISC with resistance R_sc on group k: add a leakage I_leak ≈ V_k/R_sc and integrate into group k's SOC. Map to voltage through that group's OCV(SOC) slope. Also add I·R shifts, because during charge and discharge the group sees I − I_leak.
- Capacity fade on group k: scale its ΔSOC per Ah by 1/(1−f). This spreads its voltage relative to others at the SOC extremes.
- Resistance rise and connection resistance: add ΔR·I_pack to group k (connection: split across neighbouring channels).
- Sensor offset or drift: add a constant or ramp to the reading only, with no SOC effect.
- Sweep severity (for example, several R_sc decades), onset time, and group position. Report detection probability vs severity, lead time from onset, and false alarms per vehicle-day on uninjected data. That follows the metric set used in the papers above.

### Gaps
- Could not retrieve a paper that injects faults into real field logs (rather than using lab resistors) with a full protocol. Such papers likely exist but were not confirmed in this pass.

## 5. Public field datasets with labeled EV battery faults and their licenses

### Takeaway
The main open, labeled field fault dataset is the DyAD release: 347 EVs, 3 brands, over 690k charging snippets, vehicle-level fault labels, hosted on OneDrive/PKU disk. The GitHub README states no license. The MCNN (515 vehicles) code and data are on Zenodo. National-platform data (SMC-EV Beijing, GB/T 32960) used in most papers is not public.

### Cited Findings
- DyAD dataset: brand1–3 with train/test splits and label files, five-fold CV, AUROC evaluation. Links: OneDrive and disk.pku.edu.cn. The README specifies no license. — [GitHub](https://github.com/962086838/Battery_fault_detection_NC_github)
- MCNN: 18.2M entries from 515 vehicles; Zenodo records. The license was not checked. — [Zenodo 14555916](https://zenodo.org/records/14555916); [Zenodo 10656500](https://zenodo.org/records/10656500)
- EVBattery (arXiv 2201.12358) is a large-scale EV dataset for health and capacity estimation, from the same group lineage. — [arXiv](https://arxiv.org/pdf/2201.12358)
- 300-vehicle, three-year field vs lab data analysis — [arXiv 2505.05364](https://arxiv.org/pdf/2505.05364); open-source EV data used for SOH — [Nat. Commun. 2025](https://www.nature.com/articles/s41467-025-56485-7)
- A micro-short circuit diagnosis record on Zenodo (content not inspected) — [Zenodo 17091033](https://zenodo.org/records/17091033)
- SMC-EV Beijing platform data (Wang 2017) — [Applied Energy](https://www.sciencedirect.com/science/article/abs/pii/S0306261916319262); no public release found.

### Inferences
- DyAD data has no stated license, so treat it as research-use only and do not redistribute. Before any use, record provenance per AGENTS.md rule 11. It is likely charging snippets with aggregate pack signals rather than 80-channel group voltages (unconfirmed), which limits transfer to the per-group methods above.

### Gaps
- Whether DyAD and MCNN data contain per-cell voltages, and their licenses, were not confirmed (Nature and PMC full texts blocked).

## 6. What is realistic with one or a few vehicles, and how to present results honestly

### Takeaway
With one healthy car, the credible showcase is an unsupervised, within-pack detector (cross-group robust z-score or entropy plus current-regression residuals), evaluated by (a) false alarms per vehicle-day on real healthy data, and (b) detection probability and lead time vs injected fault severity. Results are labeled synthetic-injection, with no claim of real-fault validation.

### Cited Findings
- Published field AUROCs on real labeled faults are modest (DyAD about 0.70 overall, per snippet), which shows real-fault detection is hard even with 347 vehicles. — [DyAD PubMed](https://pubmed.ncbi.nlm.nih.gov/37741826/)
- Incomplete labels are a recognized bottleneck. OSBAD uses proxies for tuning rather than labels. — [arXiv 2511.01745](https://arxiv.org/abs/2511.01745)
- Most real-vehicle validations are case studies on a handful of accident or fault vehicles (for example, the 240 s lead on one accident vehicle). — [Appl. Sci.](https://doi.org/10.3390/app16105078)

### Inferences
- Honest presentation: split injection experiments by session and date (inject only into held-out sessions, and tune thresholds on separate healthy sessions). Report the false-alarm rate on untouched real data separately. State the minimum detectable severity rather than a single accuracy. Say that injected faults follow simple ECM assumptions and miss real fault co-effects (thermal, gas, nonlinear ISC growth).
- Validation against published data (DyAD) could add a real-label check. It would be a separate result on a different signal set and must not be merged with this car's results.

### Gaps
- No source found evaluating fault detection with n = 1 vehicle, or giving guidance on minimal fleet size.
