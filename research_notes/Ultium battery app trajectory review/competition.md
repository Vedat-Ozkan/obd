# Competitive landscape: consumer/prosumer EV, hybrid and PHEV battery-health tools (GM Ultium focus; Canada/US; as of 2026-09-23)

Research method note: about 27 web searches and fetches on 2026-09-23. Several primary pages would not load: the equinoxevforum.com and cadillacforums.com threads (Tollbit paywall redirect), InsideEVs (HTTP 402) and Omdia (HTTP 403). Where only a search snippet or a secondary aggregator was available, this is flagged. Prices are as stated by the cited page on the access date (2026-09-23) unless another date is given. None of the app prices were checked against the live Play Store listing, so treat them as unverified until someone checks them.

**Naming collision (important):** a search for "OBD Fusion GM EV" returned the user's own public repo, [GitHub Vedat-Ozkan/obd](https://github.com/Vedat-Ozkan/obd). The search engine's summary called that repo "OBD Fusion", but OBD Fusion is OCTech's established commercial app ([Google Play](https://play.google.com/store/apps/details?id=OCTech.Mobile.Applications.TouchScan&hl=en_US)). If the project is presented under that name anywhere, it is a trademark and confusion risk for the Play Store listings. Check the repo README.

## 1. App-based tools (OBD-II + phone)

### Takeaway
For Ultium, no app confirmed as of 2026-09 gives a validated SOH or capacity number. Car Scanner has a community/built-in "Ultium" profile that shows some live BMS data on the Equinox EV. Owners report that many of its gauges are empty, and in 2024–2025 Lyriq owners reported no working battery data at all. Mature battery-health apps exist only for other platforms: LeafSpy for the Nissan Leaf, Dr. Prius/Hybrid Assistant for Toyota hybrids, and Scan My Tesla for Tesla. OBD Fusion's GM support is centred on the Bolt (BEV2), not Ultium.

### Cited Findings
- **Car Scanner ELM OBD2**: an Equinox EV forum summary says the "Ultium profile is for use with all GM Ultium vehicles. Not all of the selections show actual data on the Equinox EV", and users swap gauges for ones that return data — [Equinox EV Forum (search snippet)](https://www.equinoxevforum.com/threads/question-for-those-who-don%E2%80%99t-see-the-car-scanner-app.6907/). A YouTube walkthrough shows how to use a dongle plus Car Scanner to see Equinox EV and other new GM data — [YouTube](https://www.youtube.com/watch?v=4o3_Q8722xI).
- Forum demand thread: "Any battery health apps for Equinox EV?" — [Equinox EV Forum thread 4983](https://www.equinoxevforum.com/threads/any-battery-health-apps-for-equinox-ev.4983/). The content was paywalled and not read; only the title and its existence are confirmed.
- **Lyriq**: a Lyriq owner thread reports that the Car Scanner Bolt profile lists battery sensors but shows no data. It also says there "don't appear to be any clear posts of anyone successfully getting battery data from Ultium platform vehicles" — [Cadillac Owners Forum (search snippet; thread date not confirmed)](https://www.cadillacforums.com/threads/lyriq-obdii-port-and-scan-tools.1133066/).
- **OBD Fusion (OCTech)** sells manufacturer "Enhanced Diagnostics" as in-app purchases, and its PID types include EV PIDs — [App Store](https://apps.apple.com/us/app/obd-fusion/id650684932), [Google Play](https://play.google.com/store/apps/details?id=OCTech.Mobile.Applications.TouchScan&hl=en_US). Bolt owners discuss using it for battery health — [chevybolt.org](https://www.chevybolt.org/threads/obdii-scan-on-bolt-%E2%80%94-can-it-tell-me-battery-health.58614/). A 2026-03-16 aggregator lists OBD Fusion as "$9.99 + GM plugin" for the Bolt/Bolt EUV (module voltages, SoH, pack temp) and says "No apps listed specifically support the newer Ultium platform or Equinox EV" — [VoltChek blog, 2026-03-16](https://voltchek.app/blog/ev-battery-health-check-app-guide). This is a secondary source with SEO characteristics; its prices are unverified.
- The same aggregator (2026-03-16) lists: LeafSpy Pro, $14.99 (Leaf: SoH%, cell voltages, cycles); Car Scanner, free / $9.99 Pro (BMW i3/i4/iX, Hyundai/Kia E-GMP, VW ID, Zoe: SoH%, cell data); Scan My Tesla, free + IAP (OBDLink MX+ recommended). It gives dealer diagnostics as $80–$150 per visit — [VoltChek blog](https://voltchek.app/blog/ev-battery-health-check-app-guide). VoltChek itself is a free web SOH *estimator* that uses fleet benchmarking and no hardware (same source).
- **Dr. Prius / Dr. Hybrid**: available on Android and iOS and needs an ELM327 adapter. It reads HV battery block voltages, internal resistance and temps, and flags weak blocks — [Google Play](https://play.google.com/store/apps/details?id=com.nexcell.app&hl=en), [App Store](https://apps.apple.com/us/app/dr-prius-dr-hybrid/id1321750222), [priusapp.com](https://priusapp.com/). Sources disagree on the price: about $14 in one, and $11.99 for unlimited tests on up to 3 vehicles in another. Most features are free and the tests are an IAP — [search summary of priusapp.com / Amazon Appstore](https://www.amazon.com/Dr-Prius-battery-diagnostic-app/dp/B07DCZG45G).
- Hybrid Assistant is discussed alongside Dr. Prius for Toyota hybrids such as the Corolla Cross Hybrid — [Corolla Cross Forum](https://www.corollacrossforum.com/threads/does-dr-prius-app-or-hybrid-assistant-app-work-with-the-cch.1185/), [Toyota Nation](https://www.toyotanation.com/threads/preferred-android-hybrid-diagnostic-app.1705882/).
- **SOHpro** (LATAM-focused) produces tamper-evident battery reports from pro scanners (Launch, Autel, Topdon, XTOOL and others). It lists GM Bolt, Ultium and Equinox EV among supported vehicles, with per-cell voltages, lifetime Ah/kWh counters and insulation resistance. No pricing is shown and it is not aimed at Canada or the US — [sohpro.app scanner setup](https://sohpro.app/en/partners/scanner-setup). The same page says per-cell data needs the HV contactors closed and the BMS "service-active", which is relevant to the project's Mode 22 approach.

### Inferences
- The consumer Ultium "cell-level + capacity" niche appears unoccupied in Canada and the US. Car Scanner gives raw gauges with no interpretation, no capacity estimate and no report. This matches the project's premise, but the evidence is mostly absence of evidence from forums and aggregators.
- Car Scanner is the closest substitute and the one to benchmark against. It is cheap and multi-brand, and an Ultium profile already exists, so an Ultium-specific app has to differentiate on interpretation (spread, capacity from logged charges, report), not on raw PID access.
- The hybrid market (Toyota) is already served by Dr. Prius and Hybrid Assistant, which are mature, cheap and block-level. A general "hybrids/PHEVs/EVs" listing competes head-on with them and with Car Scanner. The Ultium listing is where differentiation is plausible.

### Gaps
- Could not verify current Play Store prices, installs or ratings for Car Scanner, OBD Fusion, LeafSpy, Torque Pro, Hybrid Assistant, EVNotify, OBDeleven, Carly, BlueDriver or FIXD; the listing pages were not fetched.
- Could not confirm whether OBD Fusion's GM EV add-on reads Ultium cell data.
- Could not confirm whether any app reads Blazer EV, Silverado EV, Hummer EV, Lyriq or Prologue cell-level data. Only the Equinox EV (partial) and Lyriq (negative, date unknown) have any evidence.
- Nothing found on Torque Pro, EVNotify, OBDeleven, Carly, BlueDriver or FIXD for Ultium. General knowledge suggests they are ICE-focused, but this is unsourced here.

## 2. GM / OnStar / myChevrolet own battery-health reporting

### Takeaway
As of 2026, GM does not appear to give owners a SOH percentage in its apps. Full SOH and module data reportedly need a dealer GDS2 scan. GM has signalled plans to expose SOH to Ultium owners (Omdia headline), but no shipped feature was confirmed.

### Cited Findings
- "GM's myChevrolet and myGMC apps show lifetime energy usage, though full State of Health (SOH) and module data still come from a dealer GDS2 scan" — [Recharged, Equinox EV battery health check guide 2026 (secondary, via search snippet)](https://recharged.com/articles/chevrolet-equinox-ev-battery-health-check).
- Omdia report titled "GM Plans Battery State-of-Health Data, Touts Faster AC Charging" — [Omdia](https://omdia.tech.informa.com/om130875/gm-plans-battery-stateofhealth-data-touts-faster-ac-charging). The body returned HTTP 403, so the date and details are unknown.
- Under CARB ACC II, some OEMs added in-car SOH displays for MY2026: Hyundai and Kia (Hyundai said this was for ACC II compliance) and the Volvo EX30 Cross Country — [search summary of InsideEVs / WardsAuto](https://www.wardsauto.com/regulatory/ev-regulations-continue-evolving). GM was not named.

### Inferences
- If GM ships an owner-facing SOH readout (by OEM choice, Canadian rules or a restored ACC II), a single SOH number becomes a commodity. The durable value would then be cell-group spread, per-module detail, trend over logged charges, 12 V health and an independent third-party report for buyers.

### Gaps
- Whether 2026/2027 Ultium models show SOH in the infotainment or the myChevrolet app. Needs owner confirmation or the GM owner's manual.
- Whether dealers give customers a GDS2 SOH printout, and at what cost.

## 3. Telematics and data services (Recurrent, Aviloo, Smartcar-based, others)

### Takeaway
Recurrent is the main North American consumer player. It reports range and SOC-based projections from telematics, not cell data, and it covers Equinox EV, Blazer EV and Lyriq. Aviloo has a US entity in Denver, but its public messaging is B2B, and no Ultium coverage or USD pricing was confirmed. In the GTA, Lyteflo (Ontario, founded 2024, CAD 3M seed) already sells OBD-II battery-health certificates to dealers, including Carnex in Mississauga. It is the most direct local competitor to a paid GTA inspection service.

### Cited Findings
- **Recurrent**: "A Recurrent Report shows your car's daily state-of-charge history and projected range at full charge". It targets Chevy Bolt, Volt, Equinox EV and Blazer EV sellers and claims "Sellers with a Recurrent Report earn $1,400 more on average" (a vendor claim) — [Recurrent sell/chevrolet](https://www.recurrentauto.com/sell/chevrolet). Model pages exist for the 2025 Blazer EV and the 2025 Lyriq — [Blazer EV](https://www.recurrentauto.com/shopper-guides/chevrolet/blazer-ev/2025), [Lyriq](https://app.recurrentauto.com/shopper-guides/cadillac/lyriq/2025). Its homepage says it is "used daily by 30,000 electric car owners and dealerships" and tracks expected range, seasonal range and time to add 100 miles — [recurrentauto.com](https://www.recurrentauto.com/). No cell-level data is mentioned.
- **Aviloo**: runs in the US as AVILOO Inc. (Denver, 1-844-4-AVILOO). It sells a FLASH test (about 3 minutes, plug-and-play) and a PREMIUM test (a full discharge cycle), both with a certificate. Its site messaging is B2B (dealers, fleets) and shows no USD pricing — [aviloo.com/en-us](https://aviloo.com/en-us/). EU prices: Certificate €99, FLASH €95 — [aviloo.com Private (search snippet)](https://aviloo.com/en/aviloo-private). A WhichEV review of AVILOO PREMIUM is dated 2026-07-29 — [WhichEV](https://www.whichev.net/2026/07/29/aviloo-premium-battery-test-2026-review/). In 2026-09 Aviloo launched a large independent battery study — [AI Online, 2026-09](https://ai-online.com/2026/09/aviloo-launches-worlds-largest-independent-ev-battery-study/).
- **Lyteflo** (Ontario): founded 2024 and raised CAD 3M seed in 2025-01 (Diagram Ventures lead) — [BetaKit](https://betakit.com/lyteflo-secures-3-million-cad-in-seed-funding-to-rev-up-ev-sales-platform/). It makes an OBD2 plug-in device that reports remaining capacity, estimated useful life and real-world range, sold to dealerships as part of an "EV Revenue Platform" — [lyteflo.com](https://www.lyteflo.com/), [Auto Remarketing](https://www.autoremarketing.com/arcanada/used-ev-marketplace-carnex-adds-lyteflo-battery-health-reports-to-its-listings/).
- **Carnex** (Mississauga; sells across the GTA) became "the first Canadian dealer to display verified battery health information on used EV listings" (2026-03) — [Canadian Auto Dealer, 2026-03](https://canadianautodealer.ca/2026/03/dealer-adds-verified-ev-battery-health-to-used-listings/). Its reports come from Lyteflo and include SOH %, "cell voltage consistency", remaining kWh and degradation against mileage. The brands listed are Tesla, BMW, Mercedes, Audi, Porsche, Hyundai, Kia and Ford, and **no GM Ultium models are listed** — [carnex.ca/battery-health](https://carnex.ca/battery-health).
- **EV Auto Lab** (evautolab.ca) came up in the same Ontario battery-diagnostics search — [evautolab.ca](https://evautolab.ca/). Its offering was not examined.
- Canadian aggregator claims: an independent used-EV battery check "costs under $200 at the high end", and DIY OBD tools cost $30–$150 — [Ridez / Energy Solutions (low-quality SEO sources)](https://ridez.ca/used-ev-battery-health-check/). Claims that buyers "saved an average of $4,200" come from Energy Solutions Intelligence — [energy-solutions.co](https://energy-solutions.co/articles/sub/ev-battery-health-report-buying-used). The methodology is unverified; treat these as marketing.
- Canadian Black Book and Fitch released a 2026 depreciation report that notes growing EV supply is shaping used values. No battery-health score was found — [Canadian Black Book](https://www.canadianblackbook.com/depreciation-reports/).

### Inferences
- For a GTA pre-purchase inspection business, Lyteflo is the direct local incumbent on the dealer side. The consumer/private-sale side and Ultium coverage look open: Carnex/Lyteflo lists no GM Ultium models. This needs confirming with Lyteflo.
- Recurrent competes on "range/SOH number from telematics, no hardware". The project's edge over it is cell-level spread and an in-person check, not the headline SOH.

### Gaps
- Recurrent pricing (free vs. paid tiers), Canadian availability and Smartcar dependence were not found on the fetched pages.
- Not researched for lack of budget: Moba, ClearWatt, Altelium, Generational, Cox Automotive/Manheim battery health score, J.D. Power EV battery grading, Carfax Canada, CarGurus, AutoTrader.ca and Clutch.ca battery reports, and SAE J3263-style reports. These remain open.
- Aviloo's Ultium coverage, USD consumer pricing and Canadian availability.
- Lyteflo's per-test pricing and whether it covers Ultium.

## 4. User demand signals

### Takeaway
There is visible but thin demand: an Equinox EV forum thread asking for battery-health apps, a Car Scanner Ultium-profile thread, a YouTube how-to, and Lyriq owners reporting no working battery data. Aggregator articles in 2026 still say no app specifically supports Ultium.

### Cited Findings
- Equinox EV forum threads "Any battery health apps for Equinox EV?" and "Question for those who don't see the Car Scanner app" — [thread 4983](https://www.equinoxevforum.com/threads/any-battery-health-apps-for-equinox-ev.4983/), [thread 6907](https://www.equinoxevforum.com/threads/question-for-those-who-don%E2%80%99t-see-the-car-scanner-app.6907/).
- Lyriq owners found no Ultium battery data via Car Scanner — [Cadillac Owners Forum](https://www.cadillacforums.com/threads/lyriq-obdii-port-and-scan-tools.1133066/).
- "No apps listed specifically support the newer Ultium platform or Equinox EV" (2026-03-16) — [VoltChek blog](https://voltchek.app/blog/ev-battery-health-check-app-guide).
- DIY interest in Ultium internals, such as measured module cell voltages of 3.534–3.535 V — [DIY Electric Car Forums](https://www.diyelectriccar.com/threads/gm-ultium-batteries.210424/).

### Inferences
- Demand exists among enthusiasts, but the numbers are small. The thread contents, reply counts and dates could not be read because of the paywall.

### Gaps
- No reddit threads (r/EquinoxEV, r/BlazerEV, r/Lyriq, r/electricvehicles) were retrieved.
- No app-review complaint analysis was done.

## 5. Regulatory drivers

### Takeaway
CARB ACC II required a customer-readable battery SOH metric from MY2026. Congress revoked the ACC II waiver via the CRA, which Trump signed on 2025-06-12, and litigation by California and other states is ongoing, so the US mandate is legally in limbo. Hyundai, Kia and Volvo shipped SOH displays anyway. The EU battery passport (from 2027-02-18) includes SOH but restricts that data to people with a "legitimate interest", and it is not retroactive.

### Cited Findings
- ACC II requires a "customer readable state of health metric" relative to new. It is described as requiring a battery health monitor in the infotainment from MY2026. Durability rules rise from 70% of range for MY2026–2029 to 80% for 10 yr/150k mi by MY2030, and the warranty minimum rises from 70% to 75% energy for 8 yr/100k mi by MY2031 — [CARB ACC II](https://ww2.arb.ca.gov/rulemaking/2022/advanced-clean-cars-ii), [WardsAuto (search summary)](https://www.wardsauto.com/regulatory/ev-regulations-continue-evolving), [CARB durability deck (UNECE)](https://wiki.unece.org/download/attachments/172852349/EVE-57-13e%20-%20CARB%20ACCII%20-%20updated.pdf?version=1&modificationDate=1663760313115&api=v2&download=true).
- The House passed the CRA resolution on 2025-05-01 and the Senate on 2025-05-22, and Trump signed on 2025-06-12. California and 10 states sued, and GAO had said the waivers are not rules subject to the CRA — [H.J.Res.88](https://www.congress.gov/bill/119th-congress/house-joint-resolution/88), [DieselNet](https://dieselnet.com/news/2025/05us2.php), [Jones Day, 2025-08](https://www.jonesday.com/en/insights/2025/08/active-battle-over-the-california-clean-air-act-waiver-continues).
- InsideEVs headline: "Vetting A Used EV Battery Was About To Get Easier. Then Trump Happened" — [InsideEVs](https://insideevs.com/features/789263/battery-used-ev-trials-hardship/). The body was paywalled (HTTP 402).
- EU battery passport: mandatory from 2027-02-18 for EV batteries over 2 kWh, accessed by QR code. SOH and cycle-count data are restricted to persons with a legitimate interest, and it is not retroactive except for repurposed batteries — [Circularise](https://www.circularise.com/blogs/eu-battery-passport-regulation-requirements), [automotive-iq](https://www.automotive-iq.com/electrics-electronics/articles/eu-battery-passport-explained-requirements-timeline-and-compliance-steps-to-2027).

### Inferences
- Commoditization risk for a headline SOH number is real but slower than it looked in 2023. OEMs are adding SOH displays voluntarily, but US enforcement is uncertain, and GM's position is unknown. The EU passport does not help North American used-car buyers.
- An independent, cell-level, trended report stays differentiated even if OEM SOH displays spread, because an OEM SOH number is a single opaque figure.

### Gaps
- Canadian federal or Ontario SOH disclosure rules. None were found, and no search specific to Canada or Ontario was run.
- The current (2026-09) status of the ACC II litigation, and whether CARB still enforces SOH display through other means.
- Whether GM MY2026 Ultium vehicles include an ACC II-style SOH display.
