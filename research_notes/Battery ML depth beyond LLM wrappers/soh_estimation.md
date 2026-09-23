# EV battery capacity / SOH and internal resistance estimation from OBD-rate field data (Equinox EV, Sept 2026)

Scope note: the researcher could open arXiv abstracts and search snippets; ScienceDirect, Cell/Joule, Nature and MDPI full texts returned HTTP 403 in this session, so several findings below rest on abstracts/search snippets rather than full papers. Items marked "(not fetched; standard reference)" are well-known papers whose URL/DOI the researcher is confident about but whose content was not re-read in this session; the report writer should treat their specifics with that caveat. Lab-cell results and field-vehicle results are labeled [LAB] and [FIELD].

Arithmetic used in inferences (derived, not sourced): 88 kWh / (80 series groups × ~3.7 V nominal) ≈ 300 Ah per series group; 8.5 kW L2 at ~26 A pack current ≈ C/11; ΔSOC per hour at 26 A ≈ 26/300 ≈ 8.7 %/h. Current LSB = 0.05 A; cell-group voltage LSB = 0.1 mV; energy counter LSB = 0.01 kWh ≈ 0.011 % of 88 kWh. The 300 Ah figure assumes ~3.7 V nominal NMC(A) and should be replaced by the real value once pack voltage at mid-SOC is recorded.

## 1. Partial-charge capacity estimation (coulomb counting over ΔSOC, charge-curve features, ICA dQ/dV, DVA dV/dQ)

### Takeaway
Ah- or energy-counting over a partial Level-2 charge divided by an independent ΔSOC is the most robust field capacity method and is exactly what field studies use to create "labels"; ICA/DVA is feasible here only because L2 charging is slow and near-constant-current (≈C/11) and the group voltages have 0.1 mV resolution, but field literature repeatedly reports that low sampling rate, fragmented charges and a moving voltage window make IC peaks fragile, so peak features need strong smoothing and should be treated as secondary features, not the primary estimate.

### Cited Findings
- [FIELD] Field data is characterized by "random charging and discharging patterns, low fidelity, low sampling frequency, unlabeled data, and outliers", needing substantial preprocessing before modelling — [Search summary of field-SOH literature, ScienceDirect listing](https://www.sciencedirect.com/science/article/abs/pii/S2590116825001018) ("Battery field data and why it matters: Foundations for real-world electric vehicles", eTransportation 2025; abstract only).
- [FIELD] "It is a dilemma for model fitting methods to be applied to real-world battery operating signals ... due to low sampling accuracy and long sampling intervals"; ICA "require[s] further improvement ... due to fragmented charging processes and low sampling frequency"; one proposed fix is converting IC analysis into charge-capacity-sequence analysis that is less sensitive to sampling frequency — [Incremental capacity analysis of battery under dynamic load conditions (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12056397/) (via search snippet; full text not retrieved).
- [FIELD] Using BMS current measurements gives consistent capacity estimates without lab equipment, but "the capacity used in a charging segment might not represent the pack's full usable capacity" because the operating voltage window moves — [Electric vehicle battery state of health estimation using Incremental Capacity Analysis, J. Energy Storage 2023](https://www.sciencedirect.com/science/article/pii/S2352152X23005078) (search snippet; 403 on full text).
- [FIELD] Earlier EV ICA work: [Incremental Capacity Analysis Applied on Electric Vehicles for Battery State-of-Health Estimation](https://www.researchgate.net/publication/349610883_Incremental_Capacity_Analysis_Applied_on_Electric_Vehicles_for_Battery_State-of-Health_Estimation) and [Incremental Capacity Analysis for Electric Vehicle Battery State-of-Health Estimation](https://www.researchgate.net/publication/335495314_Incremental_Capacity_Analysis_for_Electric_Vehicle_Battery_State-of-Health_Estimation) (titles only; accuracy numbers not retrieved).
- [LAB] Smoothing choice matters for IC curves; wavelet filtering with peak value/position as health factors is common, and a J. Energy Storage 2024 paper compares filter methods for ICA — [Filter methods comparation for incremental capacity analysis](https://www.sciencedirect.com/science/article/abs/pii/S2352152X24034649) (abstract/snippet only).
- [LAB] ICA/DVA can be used jointly for SOC and capacity estimation — [ICA and DVA based SOC and capacity estimation (ResearchGate)](https://www.researchgate.net/publication/323553208_Incremental_capacity_analysis_and_differential_voltage_analysis_based_state_of_charge_and_capacity_estimation_for_lithium-ion_batteries).
- [LAB→FIELD] Lu, Ouyang et al. (Tsinghua), "Towards real-world SOH estimation" two-part series: Part 1 achieves accurate SOH on five lab datasets from arbitrary random charging segments of 800 s — [Part 1, eTransportation 2024](https://www.sciencedirect.com/science/article/abs/pii/S2590116824000286); Part 2 applies a system-level method to three field datasets of 464 EVs from three manufacturers, >1.2 million charging snippets — [Part 2, eTransportation 2024](https://www.sciencedirect.com/science/article/abs/pii/S2590116824000511), [SSRN preprint](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4799753). Accuracy numbers were not retrievable (paywall).
- [FIELD] Rest-period features: a 2-min post-charge rest with time-domain, frequency-domain and inter-cell inconsistency features, fed to lightweight tree models, on 106 real EVs / 17,729 charging cycles plus 28 lab cells — [Cross-domain feature-based SOH estimation from rest period, eTransportation 2025](https://www.sciencedirect.com/science/article/abs/pii/S2590116825000785) (abstract).
- [FIELD] Partial driving data: passive EIS-like frequency-domain features from a short driving discharge enable SOH estimation from ~5 % SOC variation — [Health estimation of onboard EV batteries from partial driving data, J. Energy Storage 2026](https://www.sciencedirect.com/science/article/abs/pii/S2352152X26031385) (abstract).
- [FIELD] 300 EVs with multi-step CC fast charging, 1.5 years, 193,180 samples — [Decoding battery aging in fast-charging EVs (Penn State)](https://pure.psu.edu/en/publications/decoding-battery-aging-in-fast-charging-electric-vehicles-an-adva/).
- [FIELD] "Virtual full-charge segment" reconstruction from partial charges — [Data-Driven SOH Estimation by Reconstructing Virtual Full-Charge Segments, Batteries 2026](https://doi.org/10.3390/batteries12010010) (title only).
- [FIELD] SAE 2025 framework combines "virtual impedance" and ICA on BMS-monitored charging segments of real EVs — [SAE 2025-01-8561](https://saemobilus.sae.org/papers/a-data-driven-framework-battery-capacity-estimation-real-world-electric-vehicles-using-virtual-impedance-incremental-capacity-analysis-2025-01-8561).
- [LAB] OCV-invariance-based capacity estimation (arXiv 2025) — [Capacity Estimation Using Invariance Property in OCV Relationship](https://arxiv.org/pdf/2511.06989) (not read beyond listing).

### Inferences
- Core estimator (feasible, n=1): Q̂ = ∫I dt / (SOC_end − SOC_start), with SOC endpoints taken from relaxed cell-group voltages mapped through an OCV curve rather than from BMS SOC. Using BMS SOC makes Q̂ largely circular: the BMS SOC is itself coulomb-counted with the BMS's own capacity belief, so ΔAh/ΔSOC_BMS mostly recovers the BMS's internal capacity number (still useful as a "BMS capacity readout", but not an independent measurement). Also compute ΔE_counter / ΔSOC as a cross-check.
- Quantization: at 26 A the 0.05 A LSB is 0.2 % per sample and averages out over thousands of samples; the error budget is dominated by (a) current-sensor offset/gain bias, (b) SOC-endpoint error, and (c) timestamp jitter from sequential polling. A 1 %-SOC endpoint error over a 40 % ΔSOC charge is already ~2.5 % capacity error; ΔSOC should be ≥30–50 % to keep endpoint error below the ~2–3 % year-over-year fade one expects to detect.
- ICA/DVA at C/11 with 0.1 mV group resolution is plausible: with an NMC mid-SOC slope of very roughly 5–10 mV per %SOC and 8.7 %SOC/h, cell voltage rises ~0.7–1.5 mV/min, i.e. many 0.1 mV LSB steps per minute. Recommended pipeline: resample onto a uniform voltage grid (dQ per ΔV bin of 2–5 mV), or compute dV/dQ on a uniform Q grid, then Savitzky-Golay / Gaussian-kernel / penalized-spline smoothing; track peak position/height of the graphite-stage peaks that fall in the typical home-charge window (roughly 30–80 % SOC). Per-group ICA across 80 groups gives the relative capacity ranking described in section 5. This is an inference from arithmetic; no paper was found that did ICA on Ultium or at exactly this resolution.
- Charge profile caveat: L2 charging ends with a taper/balancing phase and the onboard charger may throttle; only the constant-current portion should feed ICA.
- Temperature must be logged (still unverified on this car); IC peak positions shift with temperature, so peaks should be compared only within temperature bins.

### Gaps
- Could not retrieve quantitative field accuracy (MAE/RMSE of capacity) for ICA on EVs; full texts were paywalled/403.
- No public Ultium OCV curve or cell datasheet found in this session; an OCV–SOC map will have to be learned from the car's own slow charges and long rests.
- BMS SOC resolution and whether the pack SOC PIDs are "displayed" vs "raw" SOC is unknown and needs capture.

## 2. Online equivalent-circuit-model identification (R0, RC pairs; RLS, EKF/UKF, dual/joint EKF)

### Takeaway
Online ECM identification (RLS with forgetting, joint/dual EKF) is well established and works on real-world driving data, but the literature that identifies RC time constants usually samples at ≥1 Hz and often far faster; at 0.1–8 s sampling with non-simultaneous polling, the credible target is an "effective DC resistance at a fixed Δt" from current steps (charge start/stop, driving accelerations), normalized by SOC and temperature, not a full 2-RC model.

### Cited Findings
- [FIELD] RLS variants are applied to internal-resistance estimation from real driving data, e.g., trace-enhanced adaptive-forgetting RLS — [Springer chapter, 2025/26](https://link.springer.com/chapter/10.1007/978-981-95-6762-1_36) (title/snippet only).
- [FIELD] Data-driven ohmic resistance estimation of EV packs from vehicle data — [Energies 12(24):4772, 2019](https://doi.org/10.3390/en12244772) (403 on full text; content not verified).
- [FIELD] DC resistance online for new-energy vehicles — [J. Power Sources 2022](https://www.sciencedirect.com/science/article/abs/pii/S0378775322013659) (title only).
- [LAB/HiL] Joint EKF + RLS for online capacity and impedance with "minimal a priori parametrization", validated in HiL with realistic driving scenarios; capacity and resistance "follow expected trends" (no numeric accuracy in abstract) — [Beckers, Hoekstra, Willems, VPPC 2024, arXiv:2410.03528](https://arxiv.org/abs/2410.03528).
- [LAB/field-style] Recursive Gaussian-process regression as a joint state-parameter estimator learning ECM parameter dynamics vs state, operating conditions and lifetime; accurate capacity and resistance estimates and forecasts, robust to gaps — [Aitio, Jöst, Sauer, Howey 2023, arXiv:2304.13666](https://arxiv.org/abs/2304.13666).
- Online impedance papers in the search results use very high sampling rates (one cited 10 kHz / 0.1 ms sampling) — [search snippet over online RLS literature, e.g., WEVJ 14(7):168](https://doi.org/10.3390/wevj14070168).
- Kalman filters that assume static noise degrade in real use; adaptive/improved UKF addresses time-varying noise — [search summary; J. Power Sources 2026](https://www.sciencedirect.com/science/article/abs/pii/S0378775326003745) (snippet).
- Dual EKF for joint SOC/capacity is the classical reference (Plett, "Extended Kalman filtering for battery management systems of LiPB-based HEV battery packs", Part 3, J. Power Sources 134 (2004)) — [DOI 10.1016/j.jpowsour.2004.02.033](https://doi.org/10.1016/j.jpowsour.2004.02.033) (not fetched; standard reference).

### Inferences
- Observability: capacity in a dual EKF is observable only through SOC drift over large ΔSOC, so a dual EKF adds little over section-1 Ah-counting for this car; its main value here would be as an interview talking point (formulated as a state-space model with process noise on Q), not as a better estimator.
- R0 vs RC: separating R0 (ms) from charge-transfer RC (≈0.1–10 s) needs samples within the first second after a step; at 0.1 s best-case polling one might capture a crude 1-RC fit on large driving pulses, but at 1–8 s only a lumped "R_Δt" (e.g., ΔV/ΔI over 2 s or 10 s) is identifiable. Report it as DCIR_Δt, the way industry DCIR tests do.
- Skew: pack current and voltage are polled as separate PIDs, so they are not simultaneous. Mitigations: (i) during resistance-focused logging poll only I and V_pack; (ii) use only steps where current is flat for several samples before and after; (iii) estimate the skew itself by cross-correlation. Resistance across the 80 groups for the same step is skew-free relative to each other if one module's groups arrive in the same frame burst (needs verification).
- Excitation: L2 charge start/stop gives a clean 0→~26 A step (≈C/11) but small ΔI, so ΔV ≈ ~26 A × R_pack (tens of mV at pack level for a milliohm-class pack; per group ~0.1–1 mV, near the 0.1 mV LSB). Driving accelerations/regen (100+ A) give much better SNR. Cabin/battery heater steps are small DC loads; likely too small for per-group R but usable at pack level. All magnitudes here are inference, not measured.
- RLS with forgetting λ≈0.98–0.999 on the discrete ARX form of a 1-RC model is the minimal online implementation; bias from correlated noise (errors-in-variables) is a known RLS failure mode — mention total least squares as the remedy (not sourced here).

### Gaps
- No paper found that states a minimum sampling rate for R0 vs RC separation on field EV data; numbers above are reasoning.
- Could not retrieve accuracy numbers for the field RLS/DCIR papers.

## 3. Data-driven SOH models on field data (GBMs, GPs, small NNs, physics-informed ML); fleet studies and industry methods

### Takeaway
Serious field-data SOH work uses hundreds of vehicles (106–464 EVs, 300 EVs, Recurrent's 30–50k), and labels are themselves derived from Ah-counting over charging snippets; with one car, a learned SOH regressor cannot be validated across vehicles, so the credible ML contribution is a physics-anchored estimator plus a probabilistic time-series model (e.g., GP) of the car's own capacity/resistance trajectory, optionally with transfer from public field datasets.

### Cited Findings
- [FIELD] Stanford + Volkswagen Group of America: one EV over one year, 1,655 battery signals, performance/health indicators extracted and correlated with charging habits, acceleration, braking and seasonal temperature; shows misalignment between lab testing and real usage; BMS algorithms are designed in ideal lab conditions — [Pozzato, Onori et al., Joule 7 (2023) 2035](https://www.cell.com/joule/fulltext/S2542-4351(23)00316-1), [ADS](https://ui.adsabs.harvard.edu/abs/2023Joule...7.2035P/abstract), [TechXplore summary](https://techxplore.com/news/2023-08-ev-batteries-real-world.html). The dataset is public: [Real-world electric vehicle data: driving and charging, Mendeley Data](https://data.mendeley.com/datasets/7vdkzpnjgj/2). (This is the closest published analogue to the user's n=1 project.)
- [FIELD] Aitio & Howey, Joule 2021: inferred health and end-of-life from off-grid solar battery field data using only measured V, I, T, no extra sensors or offline tests; GP used to infer SOC dependence of resistance — [Joule 5(12):3204](https://www.cell.com/joule/fulltext/S2542-4351(21)00532-8).
- [FIELD] Reviews: [The challenge and opportunity of battery lifetime prediction from field data, Joule 2021](https://www.cell.com/joule/fulltext/S2542-4351(21)00293-2); [Battery health management in the era of big field data, Joule 2024](https://www.cell.com/joule/fulltext/S2542-4351(24)00435-5); [GP-based online health monitoring and fault analysis from field data, Cell Rep. Phys. Sci. 2024](https://www.cell.com/cell-reports-physical-science/fulltext/S2666-3864(24)00563-0) (titles only; 403).
- [FIELD] EVBattery: first large-scale public real-world dataset, charging records from hundreds of EVs from three manufacturers over several years, labels for health and capacity estimation; CC BY-NC-ND 4.0 — [arXiv:2201.12358](https://arxiv.org/abs/2201.12358).
- [FIELD] Multi-modal SOH framework on open-source EV data — [Nature Communications 2025, s41467-025-56485-7](https://www.nature.com/articles/s41467-025-56485-7) (content not retrieved).
- [FIELD] Comparison of ARIMA(X), XGBoost, LSTM, TCN for capacity estimation on large-scale real-world EV data — [Energy Systems (Springer) 2025](https://link.springer.com/article/10.1007/s12667-025-00775-y) (snippet).
- [FIELD] Cell-to-pack transfer learning for real-world EV pack SOH — [ResearchGate 2025](https://www.researchgate.net/publication/397152939_State-of-health_estimation_for_battery_packs_of_real-world_electric_vehicles_with_cell-to-pack_transfer_learning) (title only).
- [LAB→FIELD] Zhao et al. 2025: ML predicts lab-style curves (impedance, charge, discharge, relaxation) from just two field-measurable real-impedance values at medium/high frequency; test MAPE 0.85 % (impedance curve), 4.72 % (charge curve), 2.69 % (discharge curve) on 249 NMC cells from two open datasets; argues this avoids needing massive private field data — [arXiv:2505.05364](https://arxiv.org/abs/2505.05364).
- [FIELD/foundation-style] Multitask battery management with flexible pretraining — [arXiv:2509.01323](https://arxiv.org/pdf/2509.01323); probabilistic capacity via conditional diffusion under real-world conditions — [arXiv:2510.17414](https://arxiv.org/pdf/2510.17414) (listing only).
- [INDUSTRY] Recurrent: telematics data + ML to predict battery health now and range in three years; fleet of ~30,000 active EVs, "50,000+ vehicles and 1.1 billion miles"; "range score" as proxy for original performance, compared against the fleet of the same model — [Recurrent for owners](https://www.recurrentauto.com/for-owners), [dealer FAQ](https://www.recurrentauto.com/dealers/faq), [research](https://www.recurrentauto.com/research/lessons-in-electric-car-battery-health). Method details beyond "ML on telematics" are not disclosed.
- [INDUSTRY] Aviloo: PREMIUM test (full drive-down with cell-level V/I and temperature streamed to cloud) and FLASH test, an ML model trained on "tens of thousands of PREMIUM tests" using predictors such as vehicle age, mileage and charging behaviour, ~3 minutes, stated accuracy ~±3 % vs PREMIUM; cell-level analysis records per-cell SOC including balancing status, with a "Weakest Cell" method as most accurate — [Aviloo Certified](https://aviloo.com/en-us/aviloo-certified), [TÜV SÜD article](https://www.tuvsud.com/en-us/e-ssentials-newsletter/automotive-essentials/e-ssentials-03-2022/aviloo-battery-test-for-professionals), [Aviloo SOH white paper PDF](https://aviloo.com/files/Aviloo/pdf/Whitepaper/AVILOO%20White%20Paper%20SoH%20ENG.pdf) (PDF not parseable by the fetch tool).
- [LAB] Severson et al., early-cycle lifetime prediction with elastic net on discharge-curve ΔQ(V) features — [Nature Energy 4 (2019) 383](https://www.nature.com/articles/s41560-019-0356-8) (not fetched; standard reference; lab cells under fast charging, not field).
- [TOOLS] BatteryML (Microsoft, ICLR 2024): unified preprocessing, feature extraction, baselines and access to most public lab datasets — [GitHub](https://github.com/microsoft/BatteryML), [arXiv:2310.14714](https://arxiv.org/abs/2310.14714).

### Inferences
- A GBM/NN "SOH from features" model trained on one car has no held-out vehicle; with n=1 it would at best be a within-car regressor whose "labels" are the section-1 Ah-counting estimates. Framing it as label-noise-aware denoising of capacity estimates (e.g., predicting the per-session capacity estimate from session covariates T, ΔSOC, window, rate, then reading off the de-confounded trend) is honest and non-trivial.
- A GP / state-space model over time (capacity_k = capacity trend(t, Ah-throughput) + session-level noise with heteroscedastic variance from ΔSOC and temperature) is the most defensible "ML" for n=1, mirrors Aitio & Howey's field approach, and yields posterior intervals.
- Transfer: public field datasets (EVBattery, the Stanford/VW Mendeley set) can pretrain feature→capacity mappings, but chemistry, pack size and BMS differ; any transfer claim must be evaluated only on the Equinox's own held-out sessions and reported separately from public-data results (consistent with project rule 11).
- Recurrent/Aviloo-style "compare to fleet of the same model" is not possible with n=1; with a handful of beta cars, the useful fleet-level output is cross-vehicle comparison of BMS-capacity readout and per-group dispersion, not a trained cross-vehicle regressor.

### Gaps
- No numeric field accuracy obtained for Recurrent (not disclosed) or for the 464-EV Tsinghua study (paywalled).
- No public Ultium/Equinox field dataset found.

## 4. Uncertainty quantification for SOH (conformal prediction, GP posteriors, Bayesian filtering)

### Takeaway
Conformal prediction is now routinely layered on SOH regressors (split/quantile conformal, conformalized transfer learning, damage-adaptive CP), but its coverage guarantee needs exchangeable calibration data, which a single car's time-ordered sessions violate; for n=1, GP posteriors / Kalman-filter covariance on the capacity trajectory are the natural UQ, with conformal or rolling-origin calibration checks as the empirical coverage test.

### Cited Findings
- [LAB] Conformal inference on top of linear regression, random forest and gradient-boosted trees for SOH and RUL, producing quantile estimates — [Uncertainty Quantification of Li-ion SOH and RUL using Conformal Inference (ResearchGate, 2024)](https://www.researchgate.net/publication/383565161_Uncertainty_Quantification_of_Lithium-ion_Battery_State_of_Health_and_Remaining_Useful_Life_Prediction_using_Conformal_Inference_Method).
- [LAB] Conformalized transfer learning (LSTM + MMD domain adaptation + conformal prediction) for SOH forecasting under manufacturing and usage variability — [arXiv:2603.24475 (2026)](https://arxiv.org/abs/2603.24475).
- [LAB] Decision-oriented UQ that splits uncertainty by source, checks predictions against aging physics, and adds a conformal layer with finite-sample coverage — [SSRN 7025872](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7025872).
- [LAB] Damage-adaptive conformal prediction for RUL under missing and faulty capacity telemetry — [SSRN 7372428](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7372428).
- [LAB] Hybrid ensemble learning with UQ for SOH — [Measurement 2026](https://www.sciencedirect.com/science/article/abs/pii/S026322412600237X).
- [LAB] Hybrid probabilistic battery health management (drones) — [arXiv:2405.00055](https://arxiv.org/pdf/2405.00055).
- [FIELD] GP-based field health monitoring — [Aitio & Howey, Joule 2021](https://www.cell.com/joule/fulltext/S2542-4351(21)00532-8); recursive GP with gap-robust forecasts — [arXiv:2304.13666](https://arxiv.org/abs/2304.13666); probabilistic diffusion capacity prediction — [arXiv:2510.17414](https://arxiv.org/pdf/2510.17414).

### Inferences
- For n=1, use a local-level / local-linear-trend Kalman filter or GP on per-session capacity estimates, with per-session measurement variance propagated from ΔSOC-endpoint and current-bias error budgets (section 1). The interval then reflects physics-derived noise, which is easy to explain in interviews.
- Conformal as a check, not the guarantee: use rolling-origin (time-series) splits and report empirical coverage; call out that exchangeability does not hold across seasons (temperature drift), which is the known failure mode. Adaptive conformal inference variants for non-exchangeable streams exist (not sourced here).
- With a small fleet, split conformal with calibration by vehicle (leave-one-vehicle-out) becomes meaningful.

### Gaps
- No paper found applying conformal prediction to single-vehicle field SOH trajectories.

## 5. Cell-level metrics from 80 group voltages (capacity/resistance ranking, self-discharge, balancing, weak-cell ID)

### Takeaway
Per-group voltages at 0.1 mV are the richest signal this project has; industry (Aviloo "weakest cell") and patents (GM "cell block voltage analytics") use them for weakest-group capacity, imbalance, balancing effectiveness and self-discharge detection, and these are feasible with n=1 because the other 79 groups act as the reference population.

### Cited Findings
- [INDUSTRY] Aviloo analyzes per-cell SOC including balancing status; "Weakest Cell" method (weakest cell determines pack condition) described as the most accurate — [Aviloo Certified](https://aviloo.com/en-us/aviloo-certified) (search snippet).
- [PATENT] "System and method of cell block voltage analytics to improve balancing effectiveness and identify self-discharge rate" — [US 9531038](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9531038), [US 10693197](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10693197); "Method and system for self-discharge prognostics for vehicle battery cells with an internal short circuit" — [US 11733309](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11733309). (Titles from search; assignees and claims not read in this session — verify before attributing to GM.)
- [FIELD] Cell-to-cell variation evaluation of EV packs from charging cloud data — [eTransportation 2020](https://www.sciencedirect.com/science/article/abs/pii/S2590116820300345) (title only).
- [FIELD] Rest-period inter-cell inconsistency features improve SOH estimation on 106 EVs — [eTransportation 2025](https://www.sciencedirect.com/science/article/abs/pii/S2590116825000785).
- [FIELD/news] Study reports weak cells can cut pack life by nearly 23 %; lower-capacity cell hits upper voltage first when charging, higher-resistance cell hits limits under high power; field analysis combined model identification with neural nets to estimate per-cell capacity and resistance changes — [Interesting Engineering](https://interestingengineering.com/energy/weak-ev-battery-cells-leave-energy-unused) (secondary news source; primary paper not identified).
- [REVIEW] Self-discharge/leakage-current variation drives cell SOC divergence; ~15 % internal-resistance variation among same-batch cells cited — [Cell Balancing Paradigms, arXiv:2411.05478](https://arxiv.org/html/2411.05478v1) (the 15 % figure is a review claim; treat cautiously).
- [FIELD/new] Fault decoding from sparse voltage snapshots — [arXiv:2608.10825](https://arxiv.org/pdf/2608.10825) (listing only).

### Inferences
- Capacity ranking: for each group i during a CC charge, ΔQ between two voltage levels (or IC-peak Q positions) gives Q_i relative to the median; equivalently, the slope of V_i − V_median vs Q is proportional to capacity mismatch, while the offset reflects SOC mismatch. Distinguishing the two needs ΔSOC coverage over a region with nonzero OCV slope.
- Resistance ranking: at each current step, ΔV_i/ΔI minus the pack-median ΔV/ΔI; averaging over many steps and normalizing by temperature gives a robust z-score ranking.
- Self-discharge: during long parked rests with no balancing, drift of V_i − V_median (converted to SOC via local dV/dSOC) over days gives a relative self-discharge rate; this needs repeated wake-up snapshots (OBD polling a parked car may wake modules and affect 12 V — a practical constraint).
- Balancing detection: after charge-end, groups being bled show extra downward drift; the balancing target and whether balancing is passive are unknown for Ultium and should not be assumed.
- Robust statistics (median/MAD z-scores, per-group EWMA, CUSUM on residuals) are the minimal and defensible anomaly method; an isolation forest over 80 × sessions adds little.

### Gaps
- Ultium balancing strategy and whether the "80 group voltages" are per series group (with parallel cells) was not confirmed from public sources.
- Primary paper behind the "23 %" weak-cell claim not identified.

## 6. What is credible with n=1 vs a small fleet; minimum viable non-trivial project; libraries and datasets

### Takeaway
With one car, the credible and still non-trivial project is: (1) an independent, OCV-anchored partial-charge capacity estimator with an explicit error budget, (2) DCIR_Δt resistance from current steps normalized by T/SOC, (3) per-group capacity/resistance/self-discharge ranking, and (4) a Bayesian (GP or Kalman) trajectory with calibrated intervals checked by time-ordered backtesting, compared against the BMS's own capacity readout; cross-vehicle learned SOH models need the fleet and should wait.

### Cited Findings
- The closest published analogue (one EV, one year, 1,655 signals, indicators vs usage) is Stanford/VW — [Joule 2023](https://www.cell.com/joule/fulltext/S2542-4351(23)00316-1), data at [Mendeley](https://data.mendeley.com/datasets/7vdkzpnjgj/2).
- Field SOH studies with learned models use 106 EVs ([eTransportation 2025](https://www.sciencedirect.com/science/article/abs/pii/S2590116825000785)), 300 EVs ([Penn State](https://pure.psu.edu/en/publications/decoding-battery-aging-in-fast-charging-electric-vehicles-an-adva/)), 464 EVs ([eTransportation 2024](https://www.sciencedirect.com/science/article/abs/pii/S2590116824000511)), hundreds of EVs ([EVBattery](https://arxiv.org/abs/2201.12358)), tens of thousands ([Recurrent](https://www.recurrentauto.com/for-owners); [Aviloo](https://aviloo.com/en-us/aviloo-certified)).
- PyBOP: parameter inference/optimization for PyBaMM electrochemical and ECM models with Bayesian and frequentist methods; intended for BMS design and aging data analysis — [GitHub](https://github.com/pybop-team/PyBOP), [JOSS 2025 / arXiv:2412.15859](https://arxiv.org/pdf/2412.15859).
- BatteryML: unified ML pipeline and public lab datasets — [GitHub](https://github.com/microsoft/BatteryML).
- Public field datasets: EVBattery ([arXiv:2201.12358](https://arxiv.org/abs/2201.12358), CC BY-NC-ND 4.0), Stanford/VW real-world EV data ([Mendeley](https://data.mendeley.com/datasets/7vdkzpnjgj/2)).
- PyBaMM, `impedance.py` and BEEP were not researched in this session beyond general knowledge; the report writer should not attribute features to them from these notes.

### Inferences
- n=1 validation strategy: ground truth options are (a) an occasional near-full 10→100 % L2 charge with long rests at both ends (independent OCV-anchored capacity), (b) BMS energy counter / capacity readout as a comparison (not ground truth), (c) Ah-count repeatability across sessions under similar conditions. Report estimator repeatability (std across sessions) as the honest accuracy metric, since no lab capacity test exists.
- Expected fade over the project horizon for a 2024 NMC pack is only a few percent, so detecting a real trend within one year may be below the noise floor; the showcase should emphasize the estimator and its calibrated uncertainty, not a claimed degradation trend.
- Not feasible here: EIS/high-frequency impedance (needs kHz sampling), 2-RC identification at 1–8 s sampling, physics-model (DFN/SPM) parameterization with PyBOP beyond OCV/ECM (unidentifiable from pack-level, low-rate, quantized data without cell teardown data), cross-vehicle SOH regressors with n=1, and "early-life lifetime prediction" à la Severson (lab cycling protocol, not field).
- Feasible stretch with a small fleet (3–10 cars): leave-one-vehicle-out evaluation of a feature→capacity model, hierarchical Bayesian model with vehicle-level random effects for capacity trend, and fleet-calibrated conformal intervals.
- PyBOP is still useful narrowly: fitting a 1-RC ECM to logged driving segments offline (at whatever rate is achieved) with Bayesian posteriors, to demonstrate identifiability limits explicitly.

### Gaps
- No evidence found about the accuracy/meaning of GM's own BMS capacity or SOH PIDs on Ultium.
- Did not verify current PyBaMM/BEEP/impedance.py status (Sept 2026).
- Did not find any public Ultium teardown or cell spec with OCV curve.
