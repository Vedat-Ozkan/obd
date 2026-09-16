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
