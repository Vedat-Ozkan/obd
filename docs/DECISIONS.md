# Decisions

Short architecture decision records. Newest last. A decision can be reversed; when it is, add a new entry rather than editing the old one.

## ADR-001: Android only until Phase 3 (2026-09-16)

**Decision.** Build and test on Android. iOS is a Phase 3 stretch via EAS Build.
**Why.** Expo Go cannot load BLE, so every native change needs a development build. On Android that is an APK sideloaded from EAS or a local build; on iOS it needs an Apple developer account and a slower loop. The owner's phone is Android. Nothing in `obd-core` or `obd-diagnose` is platform-specific, so adding iOS later is app work only.

## ADR-002: No local GPU inference in Phases 0–2 (2026-09-16)

**Decision.** All LLM calls go to hosted APIs. The open-weight comparison arm in the eval uses a hosted provider. The two AMD GPUs are not part of the plan.
**Why.** Cost is not a constraint (a diagnostic turn is cents; personal use is single-digit dollars a month). ROCm on WSL2 supports RDNA3 only, so the RX 6600 needs workarounds; llama.cpp's Vulkan backend works but every hour spent there is an hour not spent on recordings and evals, which are what the portfolio rests on. Privacy is handled by redacting the VIN client-side. Offline use already covers everything except the narrative turn. Revisit only if Phase 3 benchmarking needs a model no host offers.

## ADR-003: The HIL bridge runs on a laptop near the car, not in WSL2 (2026-09-16)

**Decision.** `tools/hil-bridge` is a Python program run on the laptop, which sits in or next to the car on the home Wi-Fi. WSL2 on the desktop talks to it over HTTP at the laptop's LAN address (WSL2 is in mirrored networking mode, so no forwarding is needed).
**Why.** WSL2 has no Bluetooth stack, and the desktop is out of BLE range of the driveway anyway. `bleak` runs on Windows and Linux, so the laptop's OS does not matter. The cost is that hardware verification becomes a scheduled session rather than an on-demand check, which the workflow absorbs by ending every session with recordings. A later option is to make the phone app itself the bridge and delete the Python.

## ADR-004: Equinox EV replaces the Bolt EUV direction; EV work is Phase 2 behind a spike (2026-09-16)

**Decision.** The EV target is the 2024 Chevrolet Equinox EV. Battery-health work is Phase 2, gated by the Phase 0 hardware spike (T0.2). Verified signals are shown as verified; everything else is labeled as a candidate.
**Why.** The Bolt was never actually available. The Equinox EV is, and the Ultium platform it shares with several other GM models is a broader target than the Bolt, but community-verified signals for it are thin (six in OBDb, three of them flagged 2025+), so the plan cannot promise what the car will answer. The spike costs a day and prevents a month of building against assumptions.

## ADR-005: pnpm workspaces monorepo; TypeScript strict; `uv` for the one Python tool (2026-09-16)

**Decision.** One repo: `packages/*` for pure TypeScript, `apps/mobile` for Expo, `tools/hil-bridge` for Python managed by `uv`. vitest, ESM, named exports, zod at boundaries.
**Why.** The whole point of the architecture is that `obd-core` runs in three places; a monorepo keeps those three places on one version. Python is confined to the bridge because `bleak` is the most reliable cross-platform BLE library from a desktop and the bridge is tiny.

## ADR-006: One frontier model per turn, no routing tier; model and effort are eval parameters (2026-09-16)

**Decision.** The diagnostic turn is a single structured-output call. Default `claude-opus-5` with adaptive thinking. `claude-sonnet-5`, a hosted open-weight model, and effort levels are compared on the eval harness; the default changes only when the eval says so. Deterministic feature extraction decides whether a turn is needed at all.
**Why.** The original plan had a cheap classifier tier routing to a frontier tier. With turns costing cents, a router saves nothing and adds a component to evaluate. The deterministic layer already answers "is there anything to diagnose"; the frontier model's value is ranking and explanation, and that is what the eval measures. Caches are model-scoped, so one model also means one cache.

## ADR-007: BYOK for the API key; no backend until distribution (2026-09-16)

**Decision.** The user enters their own Anthropic key in the app; it lives in the secure store and is used directly from the device. No proxy server.
**Why.** This is a personal and portfolio project. A proxy adds hosting, auth, and abuse handling for zero users. If the app is ever distributed, a thin proxy is a Phase 3 task and the `LlmClient` interface is the seam.
**Amended later on 2026-09-16.** The app is intended to be sold (ADR-009). BYOK stays for development and personal use, but a paid app cannot ask buyers for an Anthropic key, so the proxy moves from "if ever" to a prerequisite for the first paid release of the diagnostic feature.

## ADR-008: Read-only toward the vehicle; Mode 04 is the only write (2026-09-16)

**Decision.** The software sends diagnostic reads only. Clearing codes requires an explicit confirmation. No UDS writes, actuator tests, or coding, on any car, ever in this plan.
**Why.** Reads are safe by design. Writes to modules whose behavior we learned from forum posts are not, and the EV's modules control a high-voltage system. The reviewer rejects any write beyond Mode 04.

## ADR-009: The app will eventually be sold at a modest price; this shapes, but does not accelerate, the plan (2026-09-16)

**Decision.** Pricing and store work are Phase 3, after Phase 2 has a battery report that at least one other owner has run. Until then: code stays public (portfolio), the Play Store build is what gets sold, and the two features are priced differently because their costs differ.

- **EV battery health** needs no LLM call. Its marginal cost per user is zero, so a one-time purchase at a modest price works, and it is the feature with a precedent (LeafSpy).
- **Diagnostic engine** costs about $0.04 to $0.10 per turn in model fees. A one-time price cannot cover unbounded turns, so it needs a small monthly plan, a credit pack, or a turn cap included in the purchase. That decision waits for eval results: if the engine is not reliably useful on the eval, it is not sold at all.

**What changes now.** Nothing in Phases 0 to 2 except: the `LlmClient` seam must make a proxy a drop-in (already true), the case object must never carry the VIN off-device (already true), and the license split in ADR-010 is decided before any public push rather than "later".

**What does not change.** No accounts, no backend, no store listing, no payment code before Phase 3. Selling a diagnostic tool also raises the "not a substitute for a mechanic" wording from a footnote to a screen the user sees; that is a Phase 3 task too.

**Why modest.** The market analysis in the kickoff stands: general OBD apps are crowded and the AI ones are funded. The realistic ceiling is LeafSpy-scale, not salary-scale. The point of charging is to fund the API bill and validate that anyone will pay, not to build a company.

## ADR-010: OBDb signalsets are vendored under CC-BY-SA-4.0, kept in their own directory, and corrections go upstream (2026-09-16)

**Decision.** Vehicle signal definitions imported from OBDb live under `packages/obd-core/vehicles/<make>-<model>/` with OBDb's LICENSE file and attribution. That directory, and any modified version of it we ship, stays CC-BY-SA-4.0. Application code that reads the JSON is under the project's own license. Signals we verify or correct on our cars are submitted to OBDb as pull requests.

**Why this is compatible with selling the app.** CC-BY-SA governs the data files, not the software that reads them, and it does not forbid commercial use. The obligations are attribution and that the data itself, including our improvements to it, remains available under the same license. Shipping the JSON inside a paid APK is fine as long as the JSON is attributed and available under CC-BY-SA, which it is by being public in the repo. This is a reading of the license terms, not legal advice; if the project ever incorporates, have a lawyer confirm it.

**Why contribute rather than hoard.** The verified PIDs are not the moat. Leaf PIDs have been public for a decade and LeafSpy is still the tool people buy, because the value is the app, the logging, the capacity estimate, and trust. Contributing makes the Equinox EV owner community, which is also the beta pool and the only marketing channel, more likely to try the app; hoarding buys a few months until someone posts the PIDs on the forum anyway. Signals discovered independently, without deriving from OBDb data, could legally be kept private; the decision is to contribute those too, for the same reason.

## ADR-011: Applied-ML experiments follow diagnosis and precede EV delivery (2026-09-20)

**Decision.** Add ML1–ML6: matched model baselines, an audited data pilot, supervised LoRA/QLoRA fine-tuning, held-out evaluation, serving experiments, and a reproducible portfolio report. Delivery order is Phase 0 → Phase 1 → ML1–ML6 → Phase 2 → Phase 3. Preserve existing task IDs and completed evidence. Future dates are provisional; EV delivery is re-estimated after the ML track. See [ML.md](ML.md).

**Why.** The owner wants hands-on fine-tuning and inference-engineering experience for applied-ML interviews. The structured case and evaluation boundary provide a bounded experiment: can a specialized small model retain useful diagnostic quality with lower cost or latency? A measured negative result satisfies the learning goal.

**Amends ADR-002 and ADR-005.** Local or rented GPU experiments are permitted after the diagnostic baseline. Python may also be used in an isolated `tools/ml/` workspace for training and serving experiments; it remains outside the app, pure TypeScript core, and HIL bridge environment. This does not select hardware, a provider, a model, dependencies, or a spending cap; task specs settle those before execution.

**Clarifies ADR-006 and ADR-007.** Hosted inference remains the app baseline. Experimental small-model endpoints plug into the existing client seam for evaluation; there is no automatic router, production GPU backend, or on-device LLM commitment. Promotion to the app requires measured quality and operational evidence. Historical model identifiers and cost estimates are not current availability/pricing guarantees.

**Data and verification.** Review provenance, licenses, and intended use before imports or teacher-data generation. Separate real and synthetic results and split by source case/session before augmentation. Keep labels out of model inputs and test data out of adaptation. Required training and serving runs need actual evidence; missing compute cannot be waived as vehicle hardware-only verification. Ordinary CI stays fixture-based and free of GPU/paid-API requirements.

**Unchanged boundaries.** Vehicle safety, immutable recordings, sourced protocol constants, core purity, and the eventual paid-app intent remain in force. Retrieval is optional. Training completion or good formatting alone does not establish diagnostic accuracy.

## ADR-012: Battery health is the product; the gas-car diagnosis engine and LLM fine-tuning are withdrawn (2026-09-22)

**Decision.** The product is a battery-health app for hybrids, PHEVs, and EVs, with a deeper experience for GM Ultium vehicles (Equinox EV first). Delivery order is Phase 0 → Phase 2 (battery health) → BM1–BM6 (battery ML) → Phase 3. Specifically:

- **One app now, two listings later.** A single `apps/mobile` treats Ultium as a vehicle profile with extra screens. At store time, one codebase ships two listings (a general battery app and an Ultium app) through EAS build variants. No duplicate maintenance before there are users.
- **A basic, opt-in LLM in the app.** Every report renders from templates in code first: free, offline, deterministic, and always available. On top, an opt-in LLM writes a plain-language summary of the report and answers questions about the user's own data ("is my battery degrading?") by calling tools over their logs and citing the values it used. Every number in LLM output is checked against the data before display (BM5); a failed check falls back to the template. During development and beta the user supplies their own API key (BYOK, ADR-007); a paid release needs the thin proxy with a usage cap built into the price (ADR-007 amendment) before the LLM feature ships to buyers.
- **Two signal tiers.** Signals imported from OBDb signalsets are shown as "community, unverified". A vehicle is promoted to "verified" only when a recording from that vehicle is in the repo (own car, beta testers, inspection customers with consent, borrowed cars). Hard rule 1 still applies to every signal.
- **The Chrysler 200 and Elantra stay as core test cars.** They exercise the session, standard decoding, and the codes / "recently cleared" section that every battery report includes. The drive logger, feature extraction, diagnostic turn, and induced-fault protocol (T1.1–T1.8) are withdrawn.
- **ML1–ML6 are withdrawn and replaced by BM1–BM7** (extended to BM1–BM9 and re-scoped by ADR-016): dataset pipeline, partial-charge capacity estimation with calibrated intervals, imbalance anomaly detection, on-device deployment with drift monitoring, the LLM faithfulness and assistant eval, write-ups, and (stretch) distilling the hosted summary model into a small fine-tuned one. See [ML.md](ML.md).
- The report is written so it can be shown to a used-EV buyer and used in a paid inspection: "observed data", never "certified battery health".

**Why.** A market review (FEASIBILITY.md, Market check) found the AI gas-car diagnosis space crowded, while no consumer tool exists for Ultium battery health. The general hybrid/PHEV/EV app has more reach but faces incumbents; the Ultium experience is the differentiated one. Battery-focused ML (time series, uncertainty, anomaly detection, edge deployment) is applied ML that ships inside the product, instead of a fine-tuning track attached to a feature that was not going to be sold.

**Supersedes ADR-011.** Fine-tuning and serving experiments are withdrawn; the delivery order changes.
**Amends ADR-004.** EV work follows Phase 0 directly, still gated by T0.2 (Gate A) and now also by Ultium signal discovery in T2.3 (Gate B: a pack current or energy signal).
**Amends ADR-006 and ADR-007.** The LLM turn is now the report summary and the battery assistant instead of the gas-car diagnosis; model and effort remain eval parameters. BYOK for development and beta; the proxy remains a prerequisite for selling the LLM feature.
**Amends ADR-009.** The template report has zero marginal cost and can be sold one-time; the LLM feature has a per-use cost, so it needs a usage cap or small plan, decided at store time from measured cost per report and per question. Store work stays in Phase 3 and covers two listings.
**Restores ADR-002 for training by default.** Battery models are small and train on CPU. The BM7 stretch (distillation) states any GPU or rental cost in its spec before execution.

**Unchanged.** Read-only toward the vehicle, immutable recordings, sourced constants, core purity, BYOK for any development LLM use, the OBDb license handling in ADR-010.

## ADR-013: The phone is the hardware bridge; agents reach the car through an MCP server (2026-09-22)

**Decision.** After T0.8, the app gets a debug console (send a command, see the reply, record in the standard `.jsonl` format) and a relay mode: the app opens a WebSocket to a small relay in WSL2, and the relay exposes the dongle to agents as an MCP server. Tools include `send_command`, `start_recording` / `stop_recording`, and `list_signals`. The MCP server enforces a read-only allowlist in code: Mode 04 needs an explicit confirmation on the phone, and UDS writes (`2E`, `31`, `2F`) and anything outside the allowlist are rejected, regardless of what the agent asks. The Python laptop bridge is kept only for the T0.2 spike and as a fallback.

**Why.** Data gathering moves to the phone anyway (charging logs, beta testers, inspections), and nobody leaves a laptop in the car for a multi-hour charge. The phone already has a working BLE transport, React Native has WebSocket built in (no new native dependency), and WSL2 mirrored networking lets the phone reach the desktop. Exposing the car through MCP lets any agent drive signal discovery (T2.3) against real hardware, with safety enforced by the server rather than by the prompt.

**Costs.** The app must stay open in the car with the screen on during a relay session; the dongle accepts one connection at a time. The relay is a new component with its own tests.

**Amends ADR-003.** Takes the "phone as bridge" option now instead of later. **Unchanged:** ADR-008 (read-only toward the vehicle), which the allowlist now enforces in code.

## ADR-014: The product is a used-EV health check; Ultium is the first verified platform (2026-09-23)

**Decision.** The app is positioned as a **used-EV battery health check**: a buyer, seller, or inspector plugs in, scans, and gets a report that can be shown to the other party. The first and only verified platform at launch is **GM Ultium**: the 2024 Equinox EV (own car), then other Ultium models (Blazer EV, Silverado EV, Sierra EV, Hummer EV, Lyriq, Optiq, and, where they answer, Prologue and ZDX) as owners run the app and their recordings verify the signals. Other makes come later, one at a time, through beta testers and consented inspection customers (T2.9), in order of used supply. Tesla is out of scope until an adapter-cable path is specified, because it does not expose battery data through a plain OBD-II dongle. Every value in a report carries its tier (verified or community).

**Garage (user requirement, 2026-09-23).** The app is organised around a **garage**: the user adds vehicles, and every scan, charge log, and report belongs to a garage vehicle. A pre-purchase check on a car the user does not own also goes into the garage, tagged `checked` rather than `mine`; the tag can change if they buy it. Only supported vehicles can be added; for now that is the Ultium family. The picker lists Ultium models by model year. A model is `verified` once a recording from that model and year is in the repo (today: 2024 Equinox EV), and `beta` otherwise (community signals, labeled as such). On first connect the app confirms the car answers like the selected model (for example the battery module replies to the known SOC read) before showing battery data. An unsupported car cannot be added. Instead the user can register interest (make, model, year) and join the beta, which is how the next makes get chosen. The VIN stays on the device.

One store listing ("used-EV battery health check") is the default. A separate Ultium listing is optional at store time.

**Why.** The deep-research review of 2026-09-23 (`reports/Ultium battery app trajectory review.md`) found the used-EV and off-lease market growing through 2028 while Ultium new sales shrink (Equinox EV −41% in H1 2026). The demand is reassurance at purchase, which is multi-make by nature, and paid inspections, the largest income case, cannot turn away non-GM cars. Ultium stays first because the project's own recordings already go beyond public knowledge for it (80 cell-group voltages, per-module SOC, pack voltage and likely current on module 17), which is the depth a paid report needs.

**Amends ADR-012.** "One app now, two listings later" becomes one primary listing, with the Ultium listing optional. The general hybrid/PHEV scope stays possible but follows EVs; T2.8 becomes the garage and supported-vehicle picker; profiles for other makes are added per make as beta data arrives rather than as a bulk import, and only then become addable.
**Unchanged.** Signal tiers, the verification rule (hard rule 1), read-only toward the vehicle, templates first with the opt-in LLM, the phone relay and MCP (ADR-013), BM1–BM7.

## ADR-015: Equinox EV is the required Phase 0 vehicle; ICE cars are optional bench vehicles (2026-09-23)

**Decision.** Phase 0 hardware acceptance and recording-backed checks use the 2024 Equinox EV. The Chrysler 200 and Hyundai Elantra are available as optional BLE and generic OBD bench vehicles, but no task or milestone requires recordings or app runs on them. T0.8 proves the phone console with one successful `0100` and one exported, replayable recording from the Equinox EV. Future supported EV makes bring their own consented recordings through beta testing.

**Why.** ADR-014 limits the garage to supported vehicles, initially Ultium. Neither ICE car can be added to the product, so mandatory ICE sessions would test a path users cannot take. The two tracked Equinox spike recordings already exercise real ELM framing and replay. T0.4 and T0.5 use them for vehicle-backed checks and labeled synthetic fixtures for branches absent from those recordings; 11-bit CAN behavior needs a real recording when a supported vehicle using it is added. T0.7 tests the "recently cleared" branches with synthetic fixtures and does not require clearing codes on a car.

**Amends ADR-012.** Its statement that the Chrysler and Elantra are core test cars is historical, superseded here. **Amends the Phase 0 plan.** T0.2's ICE sessions, T0.3's ICE replay follow-up, T0.4/T0.5's three-car checks, T0.7's Chrysler clear, T0.8's ICE baseline collection, T0.9's two ICE app runs, and T0.10's three-car fixture requirement are replaced by Equinox and synthetic verification as stated in `docs/PLAN.md`. Existing specs, review findings, and recordings remain historical evidence; no hardware verification is retroactively claimed.

**Unchanged.** Source every protocol constant, keep recordings immutable, keep `obd-core` pure, and require explicit confirmation before any Mode 04 write. The optional ICE bench does not expand the supported-vehicle garage.

## ADR-016: Measurement-first battery ML; the LLM only explains (2026-09-23)

**Decision.** The core ML work is building trustworthy measurements from the car's raw signals, each with an honest uncertainty, not asking a model or an LLM to interpret data. The ML track is organised around four pieces, all feasible with one car:

1. **Independent capacity estimator (BM2).** Integrate pack current (`17`/`2414`) over a partial charge and divide by the SOC change, where the SOC at both ends comes from **rested cell-group voltages mapped through an OCV curve learned from this car**, not from the BMS's SOC (dividing by BMS SOC mostly reads GM's own capacity number back). Explicit error budget; session-selection rules (roughly ≥ 30–50 % SOC covered, rested endpoints); incremental capacity (dQ/dV) as a secondary feature. The BMS figure (`27AF` ÷ SOC) is a comparison, not the reference.
2. **Resistance and a circuit model (BM8).** Effective DC resistance from current steps (charger start/stop, acceleration, regen) over fixed short windows, normalised for temperature and SOC; an equivalent-circuit model per cell group with a small learned residual, trained on voltage (self-labelling). Full RC-pair fits, impedance spectroscopy, and electrochemical models are out of reach at OBD polling rates.
3. **Per-cell-group analytics and fault detection (BM3).** Each of the 80 groups is compared with the other 79 (capacity, resistance, self-discharge while parked); detection is evaluated by injecting physics-based faults (internal short, capacity fade, connection resistance, sensor offset/drift) into real healthy logs, reporting detection versus severity, lead time, and false alarms per vehicle-day on untouched data.
4. **Bayesian capacity trend (BM2).** A Kalman filter or Gaussian process over per-session estimates, with each session's noise from the error budget. **Conformal prediction is demoted to a rolling-origin coverage check**: its guarantee assumes exchangeable data, and one car's sessions across seasons are not. Conformal calibration by vehicle becomes the lead method only with a fleet (leave-one-vehicle-out).

**Fine-tuning, stated honestly.** Legitimate training here: a lab-data prior for the capacity model, the circuit model's learned residual, and a same-data-budget benchmark of a small time-series foundation model against gradient boosting, reported as a comparison row even if (as expected on small data) it loses. BM7 distillation stays an optional privacy/offline experiment. Cross-vehicle SOH regressors and supervised deep fault detection wait for a fleet.

**The LLM's role.** The opt-in summary and assistant (T2.10, T2.11) only explain results the deterministic and statistical code already computed and checked (hard rule 11).

**Why.** The deep-research review of 2026-09-23 (`reports/Battery ML depth beyond LLM wrappers.md`) found that with one car there is no ground-truth capacity label, so the hard and valuable work is constructing one, and that hiring signals for battery ML reward field-data measurement with rigorous evaluation over model novelty.

**Amends ADR-012** (ML track contents) and the BM table in `docs/ML.md`. **Unchanged:** provenance, grouped splits, real/synthetic separation, NOT RUN semantics.

## ADR-017: Committed recordings mask the VIN serial; originals stay local (2026-09-23)

**Decision.** Every recording committed under `fixtures/recordings/` is a `<date>-<slug>.redacted.jsonl` copy written by `tools/spike/redact_vin.py`. In it, VIN characters 12–17 (the serial) are masked in place with ASCII `0`, and characters 1–11 are kept. Characters 1–11 identify make, model, model year, and plant, which ADR-014's "verified by model and year" needs; many vehicles share them, unlike the serial. The unredacted original stays on the owner's disk, gitignored and never edited.

**Hard rule 2.** The copy is derived by a tested script, never by hand, and the original is not modified. The copy's final meta line records the source file's SHA-256 and the script version, so provenance is checkable. Every original line keeps its number, so line citations carry over.

**VIN locations covered.** `0902` replies (`49 02 01` + 17 bytes). Mode 22 DID `4193` replies (`62 41 93`, then the VIN four times back to back at payload indices 3, 20, 37 and 54; all four serial windows masked), found on module `17` in the discovery recordings. A safety net refuses output if a learned serial survives anywhere.

**Citations.** A citation of `<date>-<slug>.jsonl` line N in a closed spec or task record refers equally to `<date>-<slug>.redacted.jsonl` line N. SHA-256 values cited there are of the originals.

**Git history.** Commits up to `c88dffa` still contain the unredacted spike files. The owner accepted this instead of a history rewrite, which stays possible before any public push.

**Follow-ups (not implemented).** Redact at source in the phone console export, the relay, and `hil:smoke`.

**Refines ADR-014** ("the VIN stays on the device"): committed fixtures carry at most the first 11 VIN characters. **Amends AGENTS.md hard rule 2.**

## ADR-018: Battery diagnosis stays in the garage; PDF export waits for beta (2026-09-24)

**Decision.** The app calls this feature **battery diagnosis**. Tapping Run battery diagnosis starts a fresh read-only scan and saves an internal report under the selected garage vehicle's stable entry ID. The garage opens that car's report history and detail in the app. An entry tagged `checked` uses the same diagnosis as one tagged `mine`. Alpha does not create a separate user-facing report file or PDF, or offer report sharing. Consider PDF export in beta after the in-app report and privacy behavior are verified. Private scan recordings kept for replay and internal report persistence are implementation data, not user-facing exports.

**Evidence and limits.** A report shows only values the scan or a completed charge log supports, with source and signal tier. A snapshot can show SOC, cell observations, 12 V adapter supply and codes where they answer; it does not certify battery health. Capacity says NOT MEASURED until a completed charge log and reviewed estimator exist. Missing or partial replies remain visible as missing evidence. A report never borrows measurements from another garage entry or scan.

**Amends ADR-014 and the Phase 2 plan.** The used-EV positioning and `mine`/`checked` garage distinction remain, while the former “pre-purchase report” label, separate report/share flow, and alpha PDF expectation are superseded. T2.6 builds the in-app report and per-car history; T2.7 covers the `checked` entry flow and remaining diagnosis coverage. Historical specs and verification evidence stay unchanged.
