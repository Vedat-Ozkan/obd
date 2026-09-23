# Pivot assessment: gas-car AI OBD diagnosis to EV/hybrid battery health (GM Ultium focus), as of 2026-09-23

Scope: Canada (Ontario/GTA) and US. Goals being judged: applied-AI portfolio first, personal use second, modest income third. Research budget was about 20 tool calls, so several items are gaps (listed per section). Source quality flags: `gcn.com`, `recharged.com`, `energy-solutions.co`, `mppsociety.com`, and `obd2assistant.com`/`pulscar.io` are aggregators or vendor blogs. I cite them only where no primary source turned up, and I flag them each time.

## 1. Gas-car AI OBD app market (the abandoned direction)

### Takeaway
The market is large: about 289M US vehicles in operation, averaging 12.8 years old. It is also crowded. Incumbents (FIXD, BlueDriver) already sell "AI mechanic" features, and many small "AI OBD" apps (OBDAI, AI Mechanic, OBDAssistant) compete on the same LLM-explains-codes pitch. A solo developer would have had little room to stand out commercially. The original differentiator was evaluated hypothesis ranking against induced faults. That was a portfolio differentiator, not a market one.

### Cited Findings
- US average light-vehicle age was a record 12.8 years in 2025 (passenger cars 14.5, light trucks 11.9). Vehicles in operation reached 289M, with a 4.5% scrappage rate. This is the latest S&P figure found. S&P's 2026 update (normally published in May) did not surface in search. — [S&P Global Mobility press release, 2025-05-21](https://press.spglobal.com/2025-05-21-U-S-Vehicle-Age-Rises-Again-to-12-8-Years-in-2025,-According-to-S-P-Global-Mobility); CCC projection of about 13 years by 2026, reported secondhand in the same search results ([AAPEX blog](https://www.aapexshow.com/blog/average-vehicle-age/))
- FIXD Premium includes an "AI Mechanic" chatbot at about $100/yr (other listings: $8.99/mo or $69.99/yr). BlueDriver is about $99.95 one-time, with no subscription and enhanced ABS/SRS/transmission diagnostics. The same source says BlueDriver has more than 1M users. — [OBDadvisor FIXD vs BlueDriver](https://obdadvisor.com/fixd-vs-bluedriver/); [BlueDriver](https://us.bluedriver.com/); [FIXD Crunchbase](https://www.crunchbase.com/organization/fixd)
- Dedicated AI-first OBD apps already exist. OBDAI markets itself as the "World's First AI OBD2 Scanner". "AI Mechanic" (mechsit.ai.obd2gpt) is on Google Play, and OBDAssistant markets "AI-powered diagnostic answers". — [OBDAI](https://obdai.app/); [AI Mechanic, Google Play](https://play.google.com/store/apps/details?id=mechsit.ai.obd2gpt&hl=en_US); [OBDAssistant 2026 comparison (vendor blog)](https://www.obd2assistant.com/blog/best-obd2-apps-2026)
- Commentary in 2026 frames "AI OBD2 scanners" as a boom category (a low-quality blog, but it shows the category is saturated). — [MPPSociety](https://mppsociety.com/ai-obd2-scanner-boom-2026/)
- A structural limit: OBD only sees faults that set a code, so noises, bearings, brakes and suspension are invisible. — [PulsCar comparison (vendor blog)](https://www.pulscar.io/blog/best-car-diagnostic-app-2026)
- The Crunchbase listing shows only $15K for FIXD (Georgia Tech/ATDC accelerator). Real revenue and subscriber numbers did not turn up. — [Crunchbase](https://www.crunchbase.com/organization/fixd)

### Inferences
- An aging ICE fleet means gas-car diagnosis is the bigger addressable market in 2026 by one to two orders of magnitude. Dropping it did not mean leaving a small market.
- The LLM-explains-a-code layer is commoditized: incumbents with hardware distribution already bundle it. A solo app would compete on price and marketing, which is a poor fit for "modest income".
- What was lost is mainly a demo almost any interviewer understands immediately ("check engine light, AI tells you why"). Induced-fault evaluation would still have been a strong, unusual eval story. It was also costly and somewhat risky to run on the developer's own cars.

### Gaps
- No verified 2026 funding, revenue, or subscriber data for FIXD, BlueDriver (Lemur), OBDAI, Carly, OBDeleven, Topdon, or Launch. I also did not check OBDeleven's, Carly's, or Car Scanner's AI features individually.
- No 2026 S&P age figure, and no Canadian fleet-age figure (DesRosiers or StatCan) found in this pass.
- No quantified DIY-repair trend data found.

## 2. EV and hybrid trajectory 2025–2027 (US and Canada)

### Takeaway
The markets diverge. US new-EV share fell to about 5–6% in 2026 after the federal credit ended on 2025-09-30. Canada rebounded to about 12% in March 2026 after the $5,000 EV Affordability Program (EVAP) launched on 2026-02-16. Hybrids are the fastest-growing segment (15.4% of US H1 2026 sales). Used EVs set US records in 2026 on a coming wave of off-lease returns. That used-EV wave is the strongest market tailwind for a battery-health tool.

### Cited Findings
- US new EVs, June 2026: 74,967 units, 5.4% share, down 27.8% YoY. Used EVs, June 2026: 35,253 units (2.4% share), up 20.3% YoY. Average used-EV price was $38,342, up 7% YoY. — [Cox Automotive EV Market Monitor, June 2026](https://www.coxautoinc.com/insights/ev-market-monitor-june-2026/)
- US Q1 2026 new-EV share "stabilizes near 6%". New EV sales were down 28% in Q1 2026, while used EVs reached 93,500 (up 12% YoY). — [Cox Q1 2026 commentary](https://www.coxautoinc.com/insights/q1-2026-ev-sales-report-commentary/); [Electrek 2026-03-27](https://electrek.co/2026/03/27/used-ev-sales-boom-new-ev-sales-drop-28-percent-q1-2026/)
- US used EVs, Q2 2026: 128,000, an all-time record, up 29% YoY (citing Cox, via an aggregator). Cox lease-maturity data shows EV/PHEV lease returns ramping through 2026–2028, with about 20% of roughly 240K monthly lease returns being electric (about 50K/month). These are the IRA "leasing loophole" vehicles from 2023–2025. — [GCN (aggregator)](https://gcn.com/128-000-secondhand-electric-cars-sold/21727/); [Electrek 2026-04-07](https://electrek.co/2026/04/07/used-evs-just-hit-a-sales-record-a-much-bigger-wave-is-coming/)
- US hybrids reached a record 15.4% of new sales in H1 2026, nearly three times BEV share. Toyota, Hyundai Motor Group and Honda hold about 86% of hybrid sales. — [GCN (aggregator)](https://gcn.com/hybrids-claimed-record-percent-all-new/21832); J.D. Power put hybrids at 14% earlier in 2026 ([Collision Repair Mag](https://www.collisionrepairmag.com/news/collision-repair/market-trends/article/15830511/jd-power-toyota-tops-us-sales-as-hybrids-hit-14-share))
- Canada policy, 2026-02-05: PM Carney repealed the EV Availability Standard (EVAS) and replaced it with GHG standards targeting 75% EV sales by 2035 and 90% by 2040. The new $2.3B EV Affordability Program started 2026-02-16. BEVs get $5,000 and PHEVs $2,500 in 2026, declining to $2,000 and $1,000 by 2030. There is a $50K price cap (none for Canadian-built ZEVs). The program targets about 840K vehicles over five years. Used-EV eligibility is not addressed. — [Electric Autonomy](https://electricautonomy.ca/policy-regulations/2026-02-05/canada-repeals-ev-availability-standard-restores-5000-vehicle-incentives-with-new-automotive-policy/)
- Canada ZEV sales in 2026: Jan 8,672; Feb 12,547; Mar 21,574 (12.2% share, versus 6.5% in March 2025); Apr 17,795. Jan–Apr was up 20.8% YoY. BC and Quebec are above 20%, and Ontario is "closer to the national average". J.D. Power's 2026 Canada EV Consideration Study found 34% of shoppers considering an EV, up from 28%. — [Canadian Auto Dealer, 2026-09 (StatCan data)](https://canadianautodealer.ca/2026/09/are-ev-sales-rebounding/)
- cCarbon forecasts 16% Canadian ZEV share by Q4 2026 and 25% by 2030 (a forecast, not a fact). — [cCarbon](https://www.ccarbon.info/article/new-phase-for-canadas-ev-market-incentives-return-and-policy-shifts/)
- The Canada Energy Regulator describes Canadian EV sales in 2024–2025 as a "roller coaster", following iZEV funds running out in January 2025. — [CER Market Snapshot 2026](https://www.cer-rec.gc.ca/en/data-analysis/energy-markets/market-snapshots/2026/market-snapshot-canadian-electric-vehicle-sales-ride-a-roller-coaster-in-2024-and-2025.html)
- Toyota Canada's electrified sales were 65% of its H1 mix (per the article title), and it set a sales record of 249,445 in 2025. — [Automotive News Canada](https://www.autonews.com/ev/anc-toyota-canada-hybrid-bev-sales-0728/); [Toyota Canada](https://media.toyota.ca/en/releases/2026/record-electrified-vehicle-sales-power-toyota-canada-inc--to-rec.html)
- Battery-health concern as a purchase barrier: Cox found 8 in 10 people not considering a used EV are skeptical about battery value and life. This is **old (2022)**. — [Canary Media, 2022-11-16](https://www.canarymedia.com/articles/batteries/the-used-ev-market-cant-thrive-without-accurate-battery-health-data)
- **UK, not North America**, 2026: 77% of potential used-EV buyers fear battery failure, and 57% would never buy without an independent battery check (Startline, August 2026). Only 3% of drivers feel confident buying a used EV, and 38% say a verified battery certificate would help (Electrifying.com/AA). — [AM Online](https://www.am-online.com/news/more-than-half-of-potential-used-ev-buyers-would-need-a-battery-check); [Electrifying.com](https://www.electrifying.com/blog/article/electric-groups-call-for-used-battery-health-checks)
- Evidence cutting the other way: Recurrent data show average EVs keep 97% of range after 3 years and 95% after 5. Only 1.5% of about 15,000 surveyed owners replaced a battery outside recall or warranty. Cox tested nearly 80K EVs and found average battery health of 92%. Cadillac, Ford, Hyundai, Mercedes and Rivian show no observable range loss at 3 years. — [InsideEVs 2026 guide](https://insideevs.com/features/794674/used-ev-battery-health-guide-2026/); [NPR 2026-03-02](https://www.npr.org/2026/03/02/nx-s1-5706658/electric-vehicle-battery-lifespan)
- A 2026 arXiv paper reports that "battery health reporting fails independent validation across manufacturers". This supports the case for independent measurement with honest uncertainty. — [arXiv 2603.21592](https://arxiv.org/pdf/2603.21592)

### Inferences
- The addressable market for the battery app is **used EVs, PHEVs and hybrids changing hands**, not new-EV sales. That segment is growing in both countries (US records, rising off-lease supply), even though US new-EV share is falling.
- Degradation data weaken the fear itself: batteries mostly last. The demand is for *reassurance and verification* at purchase and for anomaly detection, not for a degradation crisis. So a one-shot pre-purchase check fits better than ongoing monitoring. A tool that must log several charge sessions on the owner's own car serves owners, not buyers.
- Canada's EVAP and Ontario's near-average share make GTA demand plausible but modest. Hybrids are the volume, and hybrid battery-health reading (Toyota, Hyundai) is a different technical problem from Ultium.

### Gaps
- No 2025–2026 North American survey found that quantifies battery health as a used-EV barrier (J.D. Power, Cox, AutoTrader Canada). The best numbers are UK 2026 and US 2022.
- No Canadian used-EV volume data found.
- US full-year 2025 EV share not retrieved. The claim that the 2025-09-30 credit expiry caused a Q3 2025 pull-forward and a Q4 drop is implied by the 2026 YoY declines, but I did not pull it from a primary source.

## 3. GM Ultium specifically

### Takeaway
The Equinox EV is still GM's best-selling EV, but its US volume is falling fast: H1 2026 was 16,249, down 41%. GM has cut EV plans hard ($7.6B in EV charges in 2025, Orion moved to ICE, Factory Zero idled, BrightDrop cancelled at CAMI Ingersoll, Ultium branding dropped). The installed base will grow slowly. No systemic Ultium pack recall like the Bolt's was found.

### Cited Findings
- Equinox EV US sales: Q2 2026 was 6,660, down 61.8% YoY and about 22% of GM BEV sales. GM's US EV sales fell 33% to 30,828 in Q2 2026. — [GM Authority Q2 2026 EV sales (via search snippet; the page returned 403 to fetch)](https://gmauthority.com/blog/2026/07/gm-ev-sales-numbers-figures-results-second-quarter-2026-q2/)
- Equinox EV H1 2026 was 16,249 (down 41% from about 27,800 in H1 2025). It was the third best-selling EV in the US in 2025. The new 2027 Bolt ($28,995, LFP) sold 4,224 in H1 2026. GM's US EV share is about 13.5–14%. GM attributes the decline to "the smaller EV market, discontinued vehicles and some inventory constraints". — [Electrek 2026-07-01](https://electrek.co/2026/07/01/chevy-equinox-ev-sales-fall-41-new-bolt-picks-up-slack/)
- GM said in January 2026 that it expects notably lower EV volume in 2026. It recorded $7.6B in EV-related charges in 2025, including a $6B writedown for cancelled production plans and battery supply contracts. It is retooling Orion Assembly for ICE trucks. Factory Zero was idled again (1,300 temporary layoffs). The Ultium Cells plants in Ohio and Tennessee were idled for about six months (1,550 workers). — [Hagerty](https://www.hagerty.com/media/news/general-motors-ev-loss-2025/); [WardsAuto](https://www.wardsauto.com/news/gm-layoffs-ultium-cells-factory-zero/804171/); [electrive 2026-03-31](https://www.electrive.com/2026/03/31/gm-enforces-four-week-production-break-at-ev-factory/)
- GM ended the Ultium brand name for its architecture, cells and components in North America. The hardware is unchanged, and the name stays only on the Ultium Cells LLC joint venture with LG. — [MotorAuthority](https://www.motorauthority.com/news/1144673_gm-reportedly-ditching-ultium-ev-branding-on-batteries-and-tech); [S&P AutoTechInsight](https://autotechinsight.spglobal.com/news/5278493/general-motors-ends-ultium-branding-for-ev-batteries-amid-strategy-shift)
- GM cancelled the BrightDrop van. CAMI Ingersoll (Ontario) has been idle since April 14 after only 274 BrightDrop sales in Q1 2025, and Unifor has urged federal action. — [Jalopnik](https://www.jalopnik.com/2003474/gm-drops-brightdrop-electric-van/); [Unifor](https://www.unifor.org/news/all-news/unifor-urges-canadian-action-gm-halts-reduces-brightdrop-ev-production-cami-assembly)
- Reported Equinox EV recalls are for the pedestrian-alert sound (software fix) and Continental tires, not the HV pack. Owner complaints are mostly charging quirks and software bugs. This comes from a **dealer/marketplace blog, low quality**. — [Recharged](https://recharged.com/articles/chevrolet-equinox-ev-common-problems-2026)
- Honda recalled about 60K Prologue and Acura ZDX (Ultium-based) for a rearview camera fault, not the battery. — [Electrek 2026-05-21](https://electrek.co/2026/05/21/honda-recalling-nearly-60000-electric-suvs/)
- A 2026 Equinox EV had an MSRP cut and a freight charge increase. An Equinox EV refresh is expected. — [GM Authority 2026-01](https://gmauthority.com/blog/2026/01/2026-chevy-equinox-ev-gets-msrp-drop-but-freight-charge-increase/); [Electrek 2026-07-27](https://electrek.co/2026/07/27/chevy-equinox-ev-due-for-update/)

### Inferences
- The Ultium-specific tool targets a shrinking-growth niche: tens of thousands of Equinox EVs a year in the US, fewer in Canada. It suits personal use and a portfolio. As a revenue base it is weak.
- Dropping the Ultium name and GM's 2026+ changes (LMR/LFP chemistries, new Bolt on LFP, a reported protocol change on 2026+ models) suggest that Equinox-specific PIDs may not carry over to later GM EVs. The analysis layer should stay generic.
- The absence of a Bolt-style pack recall weakens a "catch the next Bolt" pitch. It does not affect the portfolio value.

### Gaps
- Canadian Equinox EV sales for 2024–2026 not found (GM Canada does not report by model routinely). Full-year 2024 and 2025 US Equinox EV totals were not pulled from a GM primary source.
- Ultium cell-level issues (LG Energy Solution manufacturing defects on Ultium) were not confirmed in this pass.

## 4. Technical and data-access risk

### Takeaway
The biggest risk is technical, not market. The project's own feasibility notes say the public Equinox EV signalset has SOC and cell min/avg/max but **no pack current, temperatures, capacity or SOH**. Capacity estimation with conformal intervals therefore depends on finding a current or energy signal on hardware (Gate T2.3). GM Global B (VIP, 2019+) has a secure gateway, but owners report read-only Mode 22 working through a Veepeak on a 2024. There are reports of protocol changes on 2026+ Ultium vehicles. Legal right-to-repair protection is limited: Canada's C-244 legalizes circumventing digital locks for repair, and the US federal REPAIR Act is still pending.

### Cited Findings
- The OBDb Equinox EV signalset (CC-BY-SA) defines four Mode 22 commands on 29-bit headers DA1D/DACB: SOC, SOC high-res, drive-motor-module HV voltage, and cell voltage min/avg/max. It has "nothing for pack current, temperatures, capacity, state of health". Upstream 2024 test data show the DACB commands answering, and the 33E5 voltage is 25.5 V or less, which is not HV pack voltage. — local `docs/FEASIBILITY.md` lines 12 and 33 (reviewed 2026-09-22), citing [OBDb Chevrolet-Equinox-EV](https://github.com/OBDb/Chevrolet-Equinox-EV)
- Equinox EV forum owners report a Veepeak OBDCheck BLE+ with Car Scanner working on a 2024, so the port is not gatewayed against read-only diagnostics on that model year. Reports mention protocol changes on 2026+ Ultium vehicles. — local `docs/FEASIBILITY.md` line 34, citing [Equinox EV forum](https://www.equinoxevforum.com/threads/odb-2-dongle-and-app-that-you-recommend.6454/)
- The developer's own discovery run on the car found a GWM-Gateway module (address 14400000) and Mode 22 cell-record data. — local `docs/discovery-2026-09.md` lines 84 and 136
- GM Global B/VIP (2019+) uses a secure gateway between the OBD port and ECUs. Full access needs GM tools (GDS2/Tech2Win via J2534) or pro scanners with a subscription, and "no plug-and-play bypass module exists". — [Klavkarr](https://www.klavkarr.com/blog/56-understanding-secure-gateway); [TechRoute66](https://techroute66.com/gm-diagnostic-tools-guide-blog)
- Canada: Bill C-244 (a Copyright Act amendment) passed the House unanimously on 2023-10-18 and received Royal Assent in 2024. It allows circumventing digital locks for diagnosis, maintenance and repair. CASIS (2009) is voluntary, and its enforcement is described as non-existent. Commentary says the fight has shifted to telematics and proprietary diagnostics. — [AIA Canada](https://www.aiacanada.com/news/right-to-repair-and-bill-c-244-what-you-need-to-know/); [Dentons](https://www.canadaregulatoryreview.com/a-moving-target-navigating-legislative-developments-in-canadas-emerging-right-to-repair/); [RIDEZ (low quality)](https://ridez.ca/right-to-repair-canada-what-car-owners-can-do/)
- US: the REPAIR Act (H.R.1566, 119th Congress) was under consideration as of March 2026. — [Congress.gov](https://www.congress.gov/bill/119th-congress/house-bill/1566/text); [Sidley Data Matters 2026-03-02](https://datamatters.sidley.com/2026/03/02/congress-considers-right-to-repair-bill-for-vehicle-owners/)

### Inferences
- The gas-car plan had almost no access risk: Mode 01 is legally mandated emissions data. The EV plan depends on undocumented Mode 22 reads that GM can change in any model year. That is a real loss of robustness.
- C-244 protects circumvention for repair. It does not force GM to document Mode 22 or keep reads open over OBD.

### Gaps
- Bill C-294 (interoperability) status and the current Massachusetts data-access law enforcement status (litigation, NHTSA stance) were not verified in this pass.
- No primary source (GM or an SAE paper) on what the Global B gateway blocks for reads versus writes.

## 5. Portfolio angle (applied-AI hiring, 2026)

### Takeaway
Hiring evidence is thin but points in the pivot's favor. Battery state-of-health ML is a named, niche role (Clarios, EVident, Romeo-type listings, EV.Careers), and the battery-analytics companies (Recurrent, Aviloo, TWAICE, Generational) sell exactly SOH estimation. Calibrated uncertainty, time series, on-device inference, LLM evals with deterministic fact checks, and MCP tooling together make a broader applied-AI story than "LLM ranks gas-car fault hypotheses". The counterweight is legibility: the gas-car demo was instantly understandable, and the battery project is only compelling if real data exists.

### Cited Findings
- Clarios posts "AI/ML Battery SOH Engineer for Predictive Analytics" (Milwaukee). EVident Battery posts an ML Engineer role (Westford, MA). — [JobLeads](https://www.jobleads.com/us/job/ai-ml-battery-soh-engineer-for-predictive-analytics--milwaukee--ee6b6d349cc45d587957f0425fc9d5ef3); [Glassdoor](https://www.glassdoor.com/job-listing/machine-learning-engineer-evident-battery-JV_IC1154720_KO0,25_KE26,41.htm?jl=1009630322668)
- EV.Careers (a recruiter, so self-interested) describes the overlap of ML and battery-degradation, charging and fleet knowledge as "a small talent pool". It says SOH modeling needs different ML expertise from other EV specialties. — [EV.Careers](https://ev.careers/hire/data-ai)
- Battery-health providers in the market: Recurrent (consumer reports at about $19–49), Aviloo, Moba and Altelium (dealer certificates at about $99–249, "±3%"), plus Generational, Geotab and DEKRA. Aviloo's September 2026 study covers more than 500K tests on 20 models (2022–2026) and uses "trained models rather than relying on a vehicle's own dashboard reports". Pricing comes from a **low-quality aggregator**. — [Energy Solutions (aggregator)](https://energy-solutions.co/articles/sub/ev-battery-health-report-buying-used); [Aviloo study, 2026-09](https://ai-online.com/2026/09/aviloo-launches-worlds-largest-independent-ev-battery-study/); [Generational](https://generational.ac/)
- TWAICE (Munich battery analytics, partnered with TÜV Rheinland) put the value of verified battery data at about €450 per vehicle. This is **a 2022 figure**. — [Canary Media 2022](https://www.canarymedia.com/articles/batteries/the-used-ev-market-cant-thrive-without-accurate-battery-health-data)

### Inferences
- Battery analytics is a real but small and mostly B2B field. Several funded players (Aviloo, Recurrent, and dealer-certificate providers) already sell SOH reports, so a solo consumer app has competition here too. The income case is modest in both directions.
- For applied-AI generalist roles, the MCP server, LLM eval harness and faithfulness check carry over whatever the vehicle domain. Most of the portfolio value survives the pivot and does not depend on EVs. The battery ML adds a rarer skill signal (uncertainty quantification, degradation time series, edge inference) that gas-car diagnosis lacked.
- Portfolio risk: if Gate T2.3 fails (no current or energy signal), capacity estimation with intervals rests on SOC and charger-kWh only, or on synthetic data. The flagship ML result could then look thin. Public battery datasets (for example NASA or CALCE cell-cycling data) could backstop the ML showcase, but I did not verify them here.

### Gaps
- No 2026 survey of hiring-manager preferences found. No verified current postings at GM, Tesla, Rivian, Recurrent, Voltaiq, Elysia, TWAICE or Accure (search returned aggregators). The strength of battery-ML demand is inferred, not measured.
- No data on how often applied-AI job postings ask for MCP or LLM-eval experience specifically.

## Overall verdict (inference, based on the above)

- **Portfolio (primary goal): good decision, conditional on data access.** The pivot keeps the LLM-eval and MCP work, adds rarer ML skills (calibrated intervals, time series, edge inference), and avoids a commoditized "LLM explains the code" category. It fails if the Equinox exposes no current or energy signal. Then the showcase falls back to synthetic data, which the project's own rules must label.
- **Personal use: good.** The developer owns an Equinox EV. The gas cars (a 2013 and a 2019) stay in the test fleet for obd-core anyway.
- **Income: weak either way.** The gas-car market is huge but saturated with bundled AI features. The EV/hybrid battery market grows via used-EV turnover (a US record of 128K in Q2 2026, and off-lease returns rising to 2028) but already has Recurrent, Aviloo and dealer certifiers. The Ultium niche is small and shrinking in growth (Equinox EV down 41% in H1 2026). Hybrids at 15.4% US share are the real volume, but they require different, non-Ultium battery reads.
- **What was lost:** a legally mandated, stable data interface (Mode 01) versus undocumented Mode 22; a far larger user base; and an instantly legible demo. The induced-fault eval idea was the one unusual asset in the gas-car plan.
- **Main risks of the new direction:** (1) missing current, temperature or SOH signals on the Equinox; (2) GM changing protocols or gateways on 2026+ vehicles; (3) weak Canadian volume and GM retreating from EVs (BrightDrop and CAMI, Orion, the dropped Ultium name); (4) evidence that batteries rarely degrade meaningfully, which lowers the urgency of consumer demand; (5) established SOH-certificate competitors.
