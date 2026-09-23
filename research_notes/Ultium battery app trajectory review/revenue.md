# Revenue potential for a solo-dev OBD-II EV/hybrid battery-health app and services (US + Canada/GTA), as of 2026-09-23

Scope note: research done 2026-09-23 with web search/fetch. Several primary pages (Google Play via AppBrain, GM Authority) returned HTTP 403, so some figures come from search-result snippets of those pages rather than a full read; these are flagged. Everything labeled "Inference" or "Estimate" is my own arithmetic, not sourced data.

## Comparable apps: pricing, installs, revenue scale

### Takeaway
Hard revenue numbers for niche OBD apps are essentially not public. What is public is price points: the niche-EV precedent (LeafSpy Pro) sells at ~$15–20 one-time, generalist ELM327 apps sit at $5–10 one-time with ~$10 per-brand add-ons, and hardware-plus-subscription players (FIXD) charge ~$70–100/yr. Generalist free apps (Car Scanner, 10M+ installs) set a very low price anchor for anything that looks like "an OBD app."

### Cited Findings
- LeafSpy Pro (Turbo3): paid-only on Google Play, $19.99 (some regions ~$14.99), on Play since Sept 2013; no free/lite version on Play. Install bucket not retrieved (AppBrain returned 403). — [Google Play listing](https://play.google.com/store/apps/details?id=com.Turbo3.Leaf_Spy_Pro&hl=en_US); [AppBrain](https://www.appbrain.com/app/leaf-spy-pro/com.Turbo3.Leaf_Spy_Pro) (via search snippet); [MyNissanLeaf forum on Lite removal](https://mynissanleaf.com/threads/leafspy-lite-no-longer-available-for-downloading.36018/); also on iOS [App Store](https://apps.apple.com/us/app/leafspy-pro/id967376861)
- Car Scanner ELM OBD2: 10,000,000+ Play downloads (AppBrain snippet); a review site claims 25M downloads and 4.8 stars. Free with ads; Pro unlock described as ~$5 one-time by one reviewer, while other sources say "one-time purchase or a subscription" unlocks all features. Includes EV/hybrid battery diagnostics. — [AppBrain](https://www.appbrain.com/app/car-scanner-elm-obd2/com.ovz.carscanner); [OBDadvisor review 2026](https://obdadvisor.com/car-scanner-elm-obd2-review/); [Google Play](https://play.google.com/store/apps/details?id=com.ovz.carscanner&hl=en_US)
- OBD Fusion: $9.99 one-time (iOS), no subscription; enhanced diagnostics add-ons ~$9.99 per vehicle family (Ford, Toyota, Nissan, Stellantis, etc.). — [OBDadvisor OBD Fusion review](https://obdadvisor.com/obd-fusion-app-review/); [App Store](https://apps.apple.com/us/app/obd-fusion/id650684932)
- Torque Pro: paid version cited at ~$5 in forum discussion (dated, forum-level evidence). — [Tacoma World forum](https://www.tacomaworld.com/threads/torque-pro-vs-odb-fusion.711820/)
- FIXD Premium: $99.99/yr (App Store listing), other listings $89.99/yr per vehicle, promo $69.99/yr, monthly $12.99. FIXD raised ~$3M over 4 rounds (CB Insights); no revenue disclosed. — [App Store](https://apps.apple.com/us/app/fixd-obd2-scanner/id957168651); [Pixoneye](https://pixoneye.com/fixd-premium-vs-free/); [CB Insights](https://www.cbinsights.com/company/fixd-repair/financials)
- BlueDriver: acquired by Repairify (Jan 2021); revenue not public. — [CB Insights](https://www.cbinsights.com/company/bluedriver/financials); [PitchBook](https://pitchbook.com/profiles/company/118304-20)
- OBDeleven: no funding/revenue figures found in public search results. — [OBDeleven vs FIXD](https://obdeleven.com/obdeleven-vs-fixd)

### Inferences
- A one-time price of US$9.99–19.99 for the Ultium app is consistent with the market; LeafSpy's $19.99 is the ceiling proven for a single-model, battery-focused, enthusiast tool. Above ~$20 one-time there is no precedent among ELM327 apps.
- A general "hybrid/EV battery" app competes directly with Car Scanner (free, 10M+ installs, already does EV/hybrid battery data) and OBD Fusion's $9.99 + add-on model. Differentiation must come from interpretation (SOH estimate, report), not raw PIDs.
- FIXD's ~$100/yr shows consumers will pay subscriptions, but FIXD bundles hardware and mass-market marketing; a solo niche app should not use it as a base case.

### Gaps
- No install bucket retrieved for LeafSpy Pro, Dr. Prius, Hybrid Assistant, Scan My Tesla, Torque Pro (AppBrain 403). No AppMagic/Sensor Tower public estimates found for any of these. No developer revenue statements found for LeafSpy (Turbo3), Car Scanner, OBD Fusion (OCTech). EVNotify donation totals not found. OBDeleven pricing/subscription and funding not retrieved. MECH AI $7.99/mo not verified.

## Addressable market: Ultium fleet, used-EV volumes, Canada

### Takeaway
GM sold ~114k EVs in the US in 2024 and 150k+ in 2025 (almost all Ultium, since the Bolt EUV/EV ended in 2023), but sales fell sharply in 2026 after US federal credits expired (Q2 2026 GM EV sales 30,828, −33% YoY). Canada adds ~25k GM EVs in 2025. The US+Canada Ultium installed base is likely on the order of 350k–450k by end of 2026 (estimate). US used-EV sales hit 378k in 2025 (all makes).

### Cited Findings
- GM US EV sales 2024: 114,432 (record, +50%); Lyriq 28,402; Blazer EV 23,115; Hummer EV ~14,000; Equinox EV was GM's top EV in 2024. — [InsideEVs](https://insideevs.com/news/746177/general-motors-record-2024-ev-sales/); [Electrek](https://electrek.co/2025/01/03/gm-surges-become-americas-number-2-ev-seller-2024/)
- GM surpassed 300,000 cumulative US EV sales by Nov 2024 (this total includes Bolt, which is not Ultium). — [GM News](https://news.gm.com/home.detail.html/Pages/topic/us/en/2024/nov/1104-evsales.html)
- GM US EV sales 2025: 150,000+ (+48% YoY), 13% of US EV market; total US EV market ~1.29M (−2%), 7.8% share; Q4 2025 US EV sales collapsed to 234k (−46% QoQ) after incentive expiry. Cox projects ~8% EV share for 2026. — [Cox Automotive Q4 2025 commentary](https://www.coxautoinc.com/insights/q4-2025-ev-sales-report-commentary/)
- Chevy Equinox EV: ~58,000 US units in 2025 (top non-Tesla EV); H1 2026 16,249 (−41%); Q2 2026 6,660 (22% of GM BEV). — [Electrek, 2026-07-01](https://electrek.co/2026/07/01/chevy-equinox-ev-sales-fall-41-new-bolt-picks-up-slack/); [GM Authority Q2 2026](https://gmauthority.com/blog/2026/07/gm-ev-sales-numbers-figures-results-second-quarter-2026-q2/) (snippet only, full page 403)
- GM US EV sales Q2 2026: 30,828 (−33%); new Bolt and Cadillac EVs partly offset Equinox decline. — [GM Authority Q2 2026](https://gmauthority.com/blog/2026/07/gm-ev-sales-numbers-figures-results-second-quarter-2026-q2/); [Electrek](https://electrek.co/2026/07/01/chevy-equinox-ev-sales-fall-41-new-bolt-picks-up-slack/)
- Canada: GM was Canada's EV leader in 2025 with 21.2% share and 25,000+ EV registrations; Equinox EV was the #2 registered EV in Canada in 2025. Equinox EV Canada Q3 2025 2,950 units (−48%); first 9 months 2025 7,911 (+17%). — [GM Canada release, Jan 2026](https://news.gm.ca/en/home.detail.html/Pages/news/ca/en/2026/jan/0123_general-motors-is-canadas-electric-vehicles-sales-leader-in-2025.html); [GM Authority Q3 2025](https://gmauthority.com/blog/2025/12/chevy-equinox-ev-sales-numbers-figures-results-thrid-quarter-2025-q3/)
- Canada ZEV sales fell 32% YoY in the first three quarters of 2025; AutoTrader survey: 42% of non-EV owners considering an EV (down from 68% in 2022). — [The Logic](https://thelogic.co/news/analysis/canada-ev-sales-slump-2025/)
- Ontario ZEV share 7.3% in Q4 2025 (11,261 units), up from 6.4% in Q3 (11,890 units); national ZEV share of registrations 9.5% by end 2025 vs 14.6% end 2024. — [Electric Autonomy / StatsCan](https://electricautonomy.ca/data-trackers/ev-sales-data/2026-03-13/zev-sales-in-canada-rise-to-11-2-per-cent-market-share-in-q4-2025-statscan/)
- US used EV sales: 378,140 units in 2025 (+35.1%), 2.1% of used market; record months Aug 2025 (40,960) and Sep 2025 (40,569, 2.8% share). — [Cox EV Market Monitor Dec 2025](https://www.coxautoinc.com/insights/ev-market-monitor-december-2025/); [Aug 2025](https://www.coxautoinc.com/insights/ev-market-monitor-august-2025/); [Sep 2025](https://www.coxautoinc.com/insights/ev-market-monitor-september-2025/)

### Inferences
- Estimate of Ultium installed base (US+CA) end-2026: ~2023 Ultium ~20–40k (Lyriq, Hummer, early Blazer/Equinox; not sourced) + 2024 ~114k + 2025 ~150k + 2026 ~100–130k (Q2 run-rate ~31k/qtr) + Canada ~40–60k cumulative + Honda Prologue/Acura ZDX (not sourced). Range ≈ 350k–450k vehicles. Treat as order-of-magnitude.
- The Equinox EV specifically is probably ~120–150k US units cumulative by end-2026 plus low tens of thousands in Canada (estimate from ~58k 2025, 2024 volume not sourced, 16k H1 2026).
- Most Ultium vehicles are 0–3 years old and within the 8-yr/100k-mile battery warranty, which lowers owner anxiety and thus willingness to pay for battery checks today; the used-Ultium market grows as 2024–2025 leases return (2027–2028).
- GTA used-EV transaction volume is not published; if Ontario is ~35–40% of Canadian EV activity and GTA ~half of Ontario (unsourced assumptions), GTA used-EV sales are likely low thousands to ~10k per year.

### Gaps
- No clean Ultium-only cumulative figure; 2023 GM Ultium volume, Honda Prologue/Acura ZDX totals, GM Q1 2026 figure, and Canada used-EV volumes (CBB/AutoTrader.ca) not found. No published attach rate for enthusiast OBD apps; LeafSpy installs vs Leaf fleet could not be computed because the install bucket was not retrieved.

## Pricing: what people pay for EV battery checks (consumer, PPI, B2B)

### Takeaway
GTA general PPIs cost C$190–200 and already include EVs at the same price; US EV PPIs ~US$249. AVILOO charges dealers €480/yr + €35/test; Recurrent gives consumers free reports. Market price for a battery-specific check in the GTA is effectively "under $200," and a competing battery-certificate brand (VoltScore) is marketing Toronto though it lists no certified location there yet.

### Cited Findings
- CarInspect (Toronto): $199 for gas/hybrid and $199 for PHEV/EV pre-purchase inspection (170-point, 90-day warranty); no separate battery-SOH tier. — [CarInspect Toronto](https://carinspect.com/car-inspection-toronto/)
- iNeedaPPi (Canada): mobile PPI $189.99, electric/hybrid checks include "overall battery health," pack inspection, HV wiring, charging port. — [iNeedaPPi](https://ineedappi.ca/)
- Lemon Squad (US): EV pre-purchase inspection $249; includes charge level and estimated range but no explicit SOH test; Canada coverage not stated. — [Lemon Squad EV](https://lemonsquad.com/used-car-inspections/electric)
- VoltScore: third-party battery health reports, claims >90% EV/hybrid coverage, ~30-min test; pricing "varies by location"; no certified Toronto location currently; partnered with NAPA AUTOPRO NexDrive; has "For Shops/For Dealers" offerings. — [VoltScore Toronto](https://voltscore.ca/locations/toronto); [NAPA NexDrive EV PPI](https://napanexdrive.ca/en/maintenance-and-repair/pre-purchase-inspection)
- AVILOO: dealers pay €480/yr license + €35 per FLASH test; PREMIUM consumer test requires full charge/discharge. Claim: buyers willing to pay $600–1,200 more with a certificate. — [AVILOO FLASH (US)](https://aviloo.com/en/b2b-aviloo-flash-test-us); [WhichEV review 2026-07](https://www.whichev.net/2026/07/29/aviloo-premium-battery-test-2026-review/); [Forbes 2026-07-29](https://www.forbes.com/sites/jamesmorris/2026/07/29/how-aviloo-is-solving-the-used-ev-market-battery-health-trust-problem/)
- Recurrent: free one-time reports for shoppers and free monthly owner reports; B2B deal with ADESA/AutoIMS; claims sellers get ~$1,400 more. — [Electrek](https://electrek.co/2021/11/20/recurrent-monitor-and-compare-the-battery-health-of-evs-free/); [Recurrent dealers FAQ](https://www.recurrentauto.com/dealers/faq); [Yahoo/The Cool Down](https://www.yahoo.com/news/selling-used-ev-just-got-103039821.html)
- One Canadian dealer-content site says a used EV battery check takes under an hour and costs under $200. — [Ridez.ca](https://ridez.ca/used-ev-battery-health-check/)

### Inferences
- A GTA EV battery-focused inspection priced C$150–250 is market-consistent; an Ultium-specific deep report (cell-level imbalance, capacity estimate) might support C$200–300 but only with clear differentiation from $199 generalist PPIs that already claim "battery health."
- B2B per-test benchmark is ~€35 (≈US$38–40) plus annual license; Recurrent's free tier caps what dealers pay for "a battery score."

### Gaps
- No Kijiji/Facebook Marketplace pricing signals collected. CAA Ontario inspection price not retrieved. No published price for VoltScore. No Recurrent paid-tier price found.

## Play Store economics and conversion

### Takeaway
Google takes 15% on the first US$1M/yr and 15% on all subscriptions. Freemium D35 conversion median ~2.1% and hard-paywall ~10–12% (RevenueCat 2026); median subscription app MRR grew only 5.3% YoY.

### Cited Findings
- Google Play fee: 15% on first US$1M revenue per year, 30% above; 15% for auto-renewing subscriptions regardless of revenue. — [Google Play Console Help](https://support.google.com/googleplay/android-developer/answer/112622?hl=en)
- RevenueCat State of Subscription Apps 2026 (115k+ apps, $16B revenue): freemium D35 conversion 2.1% (flat since 2025); hard paywall conversion down ~2 pts from 12.1% in 2025; median app MRR +5.3% YoY vs top decile +306%. Annual subscribers rarely return after canceling. — [RevenueCat 2026 report](https://www.revenuecat.com/state-of-subscription-apps); [RevenueCat blog summary](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026); [9to5Mac 2026-05-27](https://9to5mac.com/2026/05/27/new-report-shows-annual-app-subscribers-rarely-return-after-they-cancel/)

### Inferences
- Net per US$14.99 sale ≈ US$12.74 after 15%; before sales tax handling (Google handles), Canada price would be set separately (~C$19.99).
- A paid-upfront app (LeafSpy model) forgoes the funnel; a free "read SOH" + paid unlock gets ~2% conversion of installs per RevenueCat-style benchmarks, so installs, not price, dominate.

### Gaps
- No Play refund-rate benchmark found for utility apps (Play's automatic refund window is 48h for apps; not re-verified here).

## LLM feature unit economics

### Takeaway
A short battery summary costs roughly US$0.005–0.02 per call on current Claude models; the LLM feature does not need a subscription to cover cost, and a subscription would be hard to justify versus FIXD-level value.

### Cited Findings
- Claude pricing (2026-09): Haiku 4.5 $1 in / $5 out per MTok; Sonnet 5 $2 / $10 (introductory price made standard; planned Sept 1 increase cancelled); Opus 5.5 $4 / $20; Batch API 50% off; Claude 4.7+ tokenizer yields ~30% more tokens for the same text. — [Claude pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Comparable AI-bundled pricing: FIXD Premium $69.99–99.99/yr or $12.99/mo (bundles more than AI). — [App Store FIXD](https://apps.apple.com/us/app/fixd-obd2-scanner/id957168651)

### Inferences
- Worked estimate: 3,000 input + 500 output tokens per summary. Haiku 4.5 ≈ $0.003 + $0.0025 = ~$0.0055; Sonnet 5 ≈ $0.006 + $0.005 = ~$0.011 (add ~30% for newer tokenizer → ~$0.014). A user running 20 summaries a year costs ~$0.10–0.30. A usage cap (e.g., 50/month) bounds worst-case cost at <$1/user/month. The proxy hosting cost (serverless) is likely the larger fixed cost.
- Implication: bundle the summary into the one-time price with a cap, or BYOK; a separate subscription adds billing/churn complexity for revenue that would be small.

### Gaps
- No verified price for MECH AI ($7.99/mo claimed in brief) or FIXD's AI features specifically. No OpenAI/Google pricing collected (not needed for the order-of-magnitude answer).

## Costs and risks

### Takeaway
Paid in-person inspections in Ontario carry insurance and liability costs that were not quantified; industry norm is ≥$2M liability. Support and OEM PID changes are ongoing costs with no public benchmark.

### Cited Findings
- Ontario mobile mechanic insurance guidance: $2M commercial auto liability advised; E&O/professional liability covers claims of negligent inspections. Ontario DriveON VIC operators need $3M CGL and garage liability. — [Western Financial Group](https://westernfinancialgroup.ca/mobile-mechanics-insurance-in-Ontario); [Ontario DriveON](https://www.ontario.ca/page/join-driveon-program); [Insureon](https://www.insureon.com/auto-services-business-insurance/mobile-repair-mechanics)
- Competitors offer a 90-day warranty with PPIs (CarInspect), setting customer expectations of recourse. — [CarInspect Toronto](https://carinspect.com/car-inspection-toronto/)

### Inferences
- A read-only battery report sold as "information, not a mechanical inspection" reduces but does not remove E&O exposure; an E&O + CGL policy is plausibly C$1–3k/yr (unsourced; get a broker quote).
- OEM firmware/OTA updates can change Mode 22 DIDs on Ultium; each break costs developer time and refund risk; single-OEM dependency is the key fragility of the Ultium app.

### Gaps
- No Ontario E&O premium quotes found. No data on ELM327 clone support burden (refund/complaint rates).

---

## Scenario model (all Estimates; assumptions explicit)

Assumptions: prices in USD; Google fee 15%; horizon = first 3 years after launch (2027–2029); no paid marketing; Ultium installed base 400k (US+CA) growing ~100k/yr; lifetime attach = share of Ultium owners who buy.

| Stream | Low | Base | High |
|---|---|---|---|
| Ultium app, one-time $14.99 (net ~$12.74) | 0.1% of 400k = 400 sales ≈ $5k over 3 yrs | 0.5% of ~500k = 2,500 ≈ $32k over 3 yrs | 1.5% of ~600k = 9,000 ≈ $115k over 3 yrs |
| General hybrid/EV battery app ($4.99–9.99 unlock) | ~$1k/yr (lost vs Car Scanner) | ~$3–6k/yr | ~$15–25k/yr (needs top search rank for "hybrid battery test") |
| GTA in-person battery inspections at C$200 | 2/month ≈ C$5k/yr gross | 6/month ≈ C$14k/yr gross | 20/month ≈ C$48k/yr gross |
| B2B (dealers; AVILOO benchmark €35/test) | $0 | 1–2 small dealers, ~20 tests/mo × $30 ≈ $7–15k/yr | several dealers ≈ $30–60k/yr, but competes with Recurrent (free) and AVILOO |
| LLM feature | cost center (~$0.01/call) | break-even if bundled | small margin if priced ~$1–2/report |

Totals (inference): low ≈ US$3–5k/yr; base ≈ US$15–30k/yr; high ≈ US$60–100k/yr, with the high case requiring sustained inspection/dealer sales labor rather than app sales. The app alone most likely yields low-thousands to low-tens-of-thousands per year.

Key drivers: (1) attach rate among Ultium owners (no benchmark found; LeafSpy install data would calibrate it), (2) Ultium used-market growth as leases return 2027–28, (3) US EV demand after credit expiry (GM Q2 2026 −33%), (4) differentiation vs free Recurrent and free Car Scanner, (5) whether inspections/B2B are pursued, since that is where per-unit revenue ($30–250) exceeds app revenue ($13).
