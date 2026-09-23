# obd

> Working title. An open, transparent used-EV battery health check, verified first on GM Ultium vehicles and extended to other makes through beta testers: a pure-TypeScript OBD library, an Android app that logs charges and produces battery and used-EV reports, an opt-in LLM that explains them without inventing numbers, and battery ML with measured uncertainty. Built full-time as a portfolio project using an architect / implementer / reviewer agent workflow, with every claim checked against recordings from real cars.

**Status:** Phase 0 in progress. Started 2026-09-16. The workspace scaffold, the hello-world HIL service, the spike script, and the reviewed `obd-core` transport code (T0.3) exist; the phone app, battery reports, LLM features, and ML remain planned. Direction revised through ADR-015 on 2026-09-23. See [docs/PLAN.md](docs/PLAN.md).

## Why this exists

Consumer OBD apps are a crowded market, and the AI gas-car diagnosis corner is already occupied (OBDAI, MECH AI, Skanyx and others). This project does not compete there. It exists for three reasons:

1. **A real gap.** Used-EV buyers want an independent battery check, and the off-lease wave is growing. LeafSpy became the canonical Nissan Leaf battery tool as a solo-developer app. No consumer equivalent exists for GM's Ultium platform (Equinox EV, Blazer EV, Silverado EV, Lyriq, Optiq, Prologue). The Ultium tool is the differentiated product; a general hybrid/PHEV/EV battery app on the same core reaches more people but has incumbents. The report is written so a used-EV buyer can show it to a seller, and so it can be used in a paid pre-purchase inspection.
2. **Applied AI engineering, shown with evidence.** Battery ML with calibrated uncertainty, anomaly detection, on-device inference, and drift monitoring; an opt-in LLM summary and tool-calling assistant guarded by a deterministic faithfulness check and a CI eval suite; an MCP server that lets agents work against a real car under a read-only allowlist; and the agentic build process itself (architect / implementer / reviewer, Claude and Codex). Every claim comes with measurements, including failures.
3. **Personal use.** An EV whose battery health nobody will tell me about without a dealer visit. Two gas cars remain available as an optional BLE and generic OBD bench.

The longer-term intent is to sell the app at a modest price, as one "used-EV battery health check" listing (an Ultium-specific listing is optional; ADR-014). The template report has no per-use cost; the LLM feature does, so it gets a usage cap. See [docs/DECISIONS.md](docs/DECISIONS.md) ADR-009 through ADR-015.

## What it does, by phase

| Phase | Dates | Deliverable | Cars |
|---|---|---|---|
| 0 | Sep 16 – Oct 16, 2026 | **Core, BLE, and the codes report.** ELM327 session, standard decoding, the phone app with a debug console, a phone relay that exposes the car to agents through MCP, and a codes / "recently cleared" report every battery report includes. | Equinox EV required; Chrysler 200 and Elantra optional bench. |
| 2 | Oct 19 – Dec 4, 2026 | **Battery health.** Charge logging, capacity estimate with an error band, cell imbalance, 12 V, battery report, used-EV pre-purchase report, community/verified signal tiers for other hybrids/PHEVs/EVs, beta data export, opt-in LLM summary and assistant. | Equinox EV; beta vehicles |
| BM1–BM7 | Dec 7 – Jan 29, 2027 | **Battery ML and LLM evals.** Dataset pipeline, capacity with conformal intervals, anomaly detection, on-device model and drift, LLM eval infrastructure, write-ups; distillation as a stretch. | Own car, then beta fleet |
| 3 | After BM6 | Stretch: two store listings, proxy with usage cap, full EV module scan, more Ultium models, iOS. | |

The gas-car diagnosis engine (old Phase 1) and the LLM fine-tuning track (ML1–ML6) are withdrawn (ADR-012). All dates are provisional. Full task breakdown: [docs/PLAN.md](docs/PLAN.md). ML design: [docs/ML.md](docs/ML.md).

## Test fleet and hardware

| Item | Detail | Notes |
|---|---|---|
| 2013 Chrysler 200 | ICE, CAN 11-bit/500k | Optional bench; no required recording or app run |
| 2019 Hyundai Elantra Preferred | ICE, CAN 11-bit/500k | Optional bench; no required recording or app run |
| 2024 Chevrolet Equinox EV RS First Edition | Ultium, CAN 29-bit for module diagnostics | Required Phase 0 vehicle; standard Mode 01 coverage minimal; Mode 22 via OBDb signalset |
| (no hybrid or PHEV owned) | | Non-Ultium vehicles are `community` until a recording from a beta tester, inspection customer (with consent), or borrowed car verifies them |
| Veepeak OBDCheck BLE | ELM327-compatible, BLE | Do not pair in Android settings; connect from the app. Service `FFF0` |
| Dev machine | Windows 11 host with WSL2 (mirrored networking) for code; Android phone as the hardware bridge; a laptop for the spike | WSL2 has no Bluetooth and the desktop is out of range of the driveway, so the phone relays commands to WSL2 (ADR-013) |

## Architecture in one picture

```
                   ┌──────────────────────────────────────────────┐
                   │              obd-core (pure TS)               │
  BLE (phone) ───▶ │ Transport ─▶ Elm327Session ─▶ decode(PIDs,    │ ──▶ codes report
  Relay (phone) ─▶ │            (init, queue,      DTCs, VIN,      │
  Replay (tests) ▶ │             ISO-TP, errors)   vehicle profiles)│ ──▶ charge log
                   └──────────────────────────────────────────────┘
                                          │
                                          ▼
                   ┌──────────────────────────────────────────────┐
                   │           obd-battery (pure TS)               │
                   │ capacity + error band, imbalance, 12 V,       │ ──▶ battery / used-EV report
                   │ on-device model estimates, templates          │      (template text)
                   └──────────────────────────────────────────────┘
                                          │  opt-in
                                          ▼
                   ┌──────────────────────────────────────────────┐
                   │           obd-assist (pure TS)                │
                   │ summary + tool-calling assistant via LlmClient│ ──▶ explanation / answers
                   │ faithfulness check → template on failure      │      with cited values
                   └──────────────────────────────────────────────┘
        ▲                    ▲                           ▲
   apps/mobile         tools/relay (MCP)          packages/obd-eval
 (Expo, Android)     agents ↔ phone ↔ car     (fixtures → scores, LLM suite)
```

The same session and decoding code runs against the phone's BLE stack, through the phone relay for agents on the desk, and against recorded transcripts in CI. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout (target)

```
packages/obd-core/       transports, ELM327 session, PID/DTC decoding, vehicle profiles, codes report
packages/obd-battery/    charge sessions, capacity, imbalance, 12 V, reports, templates, on-device models
packages/obd-assist/     opt-in LLM summary and assistant, faithfulness check (replaces obd-diagnose)
packages/obd-eval/       eval harness and scoring
apps/mobile/             Expo app (Android first); two store listings later from one codebase
tools/relay/             WSL2 relay and car MCP server; the phone connects to it
tools/hil-bridge/        Python laptop bridge, for the spike and as a fallback
tools/ml/                planned isolated Python battery modeling (BM1–BM4, BM7)
fixtures/recordings/     immutable recordings from real cars
fixtures/synthetic/      hand-written or injected, labeled synthetic fixtures
docs/                    plan, architecture, feasibility, ELM327 notes, eval, ML, workflow, decisions
docs/specs/              one spec per task
```

## Development setup (short version)

- **Code** lives in WSL2: Node 22, pnpm, TypeScript. `pnpm install && pnpm check`.
- **Hardware bridge** is the phone (ADR-013): the app's relay mode connects to `tools/relay` in WSL2, which exposes the car to agents as an MCP server with a read-only allowlist and records every exchange to `fixtures/recordings/`. The Python laptop bridge (`tools/hil-bridge`) is used for the T0.2 spike and as a fallback. Hardware verification is still a deliberate session with the phone in the car; recordings carry the load in between.
- **App** is an Expo development build (Expo Go has no BLE). Build the dev client with EAS once, then run Metro in WSL2. WSL2 is already in mirrored networking mode, so the phone reaches Metro at the desktop's LAN address; `expo start --tunnel` is the fallback.
- **LLM (planned, opt-in)** uses a hosted model with your own key in secure storage (BYOK); a paid release adds a thin proxy with a usage cap. Battery modeling tooling (`tools/ml/`) stays separate from the app and relay.

Full setup and the known WSL2 pitfalls: [docs/FEASIBILITY.md](docs/FEASIBILITY.md#development-environment).

## How this repo is built

The build process is part of the portfolio. Every non-trivial task goes through three agents defined in `.claude/agents/`:

- **architect** writes a spec (interfaces, files, sources for every OBD constant, verification plan) and never writes code.
- **implementer** builds to the spec with tests against recordings, runs `pnpm check`, and reports PASS / FAIL / NOT RUN per item.
- **reviewer** is read-only, reruns the checks itself, rejects any unsourced PID or AT command, and returns APPROVE or REQUEST_CHANGES.

`/feature T0.4` runs the loop for a task. The rules the agents work under are in [AGENTS.md](AGENTS.md); the reasoning is in [docs/WORKFLOW.md](docs/WORKFLOW.md). The one-line version: agents are cheap, wrong PID tables are expensive, and the phone relay exists so agents test against the real dongle, through an allowlist, instead of guessing.

## Top risks

1. **Equinox EV data access.** Community-verified signals for this car are thin (six signals in OBDb, three of them marked 2025+), with no pack current, energy counter, or temperatures. Mitigated by the T0.2 spike (Gate A) and agent-driven discovery (Gate B, T2.3), with a charger-kWh fallback for capacity.
2. **Long BLE sessions on Android.** A multi-hour charge log needs a foreground service that survives power management. Tested with a full charge in T2.4.
3. **Ground truth is small and imperfect.** One owned EV and a few beta vehicles; the reference capacity is itself an estimate. The eval shows every session rather than pretending statistical power.
4. **Unverified vehicles.** No hybrid or PHEV is owned; their signals stay `community` until a recording verifies them.
5. **LLM wrong numbers and cost.** Mitigated by a deterministic number check with template fallback, a CI eval suite, and measured cost per report and question before any pricing.
6. **Time.** Dates are provisional and re-estimated at each gate.

All risks with evidence and mitigations: [docs/FEASIBILITY.md](docs/FEASIBILITY.md).

## Deliberately cut

The gas-car diagnosis engine, drive logger, and induced-fault protocol (ADR-012); LLM fine-tuning for diagnosis and GPU serving experiments (ADR-011, withdrawn; a distillation stretch remains as BM7); synthetic data as real-world ground truth; automatic model routing; an LLM on the device; ads and parts affiliates; pricing or store work before Phase 2 has a report other owners have run; incorporation and liability work; iOS before Phase 3; the Bolt EUV direction (no car).

## Safety

- OBD reads are passive. The only write this software ever sends is Mode 04 (clear codes) after an explicit confirmation.
- No faults are induced on any vehicle. Battery faults exist only as synthetic injections into real logs.
- Agents reach the car only through the relay's read-only allowlist; UDS writes are rejected in code and Mode 04 needs a tap on the phone.
- Nothing here touches the EV's high-voltage system. Orange cables are for trained technicians. The diagnostic port on the Equinox EV is a low-voltage read of what the modules report.
- Reports are observed data, not a certified battery-health rating or a repair instruction, and say so in the app.

## License

Code: MIT for `packages/*` and `tools/*` is the intent (an OBD library nobody else maintains in TypeScript is worth more as reputation than as a secret). The app's license is decided before the first store listing; the code stays public either way and the Play Store build is what is sold (ADR-009). Vehicle signal definitions imported from [OBDb](https://github.com/OBDb) are CC-BY-SA-4.0 and stay under that license with attribution, in their own directory; corrections are contributed upstream (ADR-010).
