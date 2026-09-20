# obd

> Working title. An open, transparent OBD-II toolkit: a pure-TypeScript OBD library, an Android app that produces a pre-purchase inspection report and evidence-cited diagnoses for gas cars, and a battery-health tool for GM Ultium EVs. Built full-time as a portfolio project using an architect / implementer / reviewer agent workflow, with every claim checked against recordings from real cars.

**Status:** Phase 0 in progress. Started 2026-09-16. The workspace scaffold and hello-world HIL service exist; vehicle functionality, the diagnostic engine, and ML experiments remain planned. See [docs/PLAN.md](docs/PLAN.md).

## Why this exists

Consumer OBD apps are a crowded market and the AI-native corner of it is already occupied (OBDAI, MECH AI, Skanyx and others do most of what the original plan described, with hardware bundled). This project does not pretend to have found an empty niche. It exists for three reasons:

1. **Personal use.** Three cars in the driveway, one of them a used-car candidate for family and friends, one an EV whose battery health nobody will tell me about without a dealer visit.
2. **Portfolio and applied-ML learning.** Hardware protocol work, a mobile app with background BLE, deterministic feature extraction, and an evaluated diagnostic engine. After the diagnostic baseline, fine-tune a small model and measure serving tradeoffs against untuned and hosted baselines. Show reproducible data preparation, LoRA/QLoRA training, evaluation, caching, quantization, and load tests—including failures and limits, not promised accuracy gains.
3. **One direction with a real precedent.** LeafSpy became the canonical Nissan Leaf battery tool as a solo-developer app. No equivalent exists for GM's Ultium platform (Equinox EV, Blazer EV, Silverado EV, Lyriq, Prologue). That is Phase 2, and it is honestly the riskiest part of the plan.

The longer-term intent is to sell the app at a modest price. The EV battery tool has no per-request model cost, and the code stays public while the store build is what is sold. Dataset and model licenses must support their intended use; a public dataset is not automatically suitable for a paid app. See [docs/DECISIONS.md](docs/DECISIONS.md) ADR-009 through ADR-011.

## What it does, by phase

| Phase | Dates | Deliverable | Cars |
|---|---|---|---|
| 0 | Sep 16 – Oct 9, 2026 | **Pre-purchase inspection (PPI) tool.** Connect over BLE, read VIN, DTCs (stored, pending, permanent), freeze frame, readiness monitors, distance/time since codes cleared, and produce a shareable report with a "codes were recently cleared" flag. | Chrysler 200, Elantra. Equinox EV: VIN + whatever answers. |
| 1 | Oct 12 – Nov 6, 2026 | **Diagnostic engine (gas cars).** Background drive logging with cold-start capture, symptom timestamps, deterministic feature extraction (fuel trim by load bin, warm-up slope, misfire counts), an LLM turn that returns ranked hypotheses with evidence and a next test, and an eval harness scored against six induced faults. | Chrysler 200, Elantra |
| ML1–ML6 | After Phase 1 | **Applied ML showcase.** Baselines → audited data pilot → LoRA/QLoRA → held-out evaluation → serving experiments → reproducible report. | ICE diagnostic cases; real/synthetic results separate |
| 2 | After ML6; dates TBD | **EV battery health (Ultium).** State of charge, pack and cell voltages, cell imbalance, charging-session logging, capacity estimate over a full charge, 12 V health. Starts from the OBDb Equinox EV signalset and extends it. | Equinox EV |
| 3 | After Phase 2 | Stretch: Mode 06 monitor data, active-test loop, full module scan on the EV, iOS via EAS, distribution. | |

All future dates are provisional. Existing task IDs remain stable; EV delivery moves after the ML track. Full task breakdown: [docs/PLAN.md](docs/PLAN.md). Experiment design, candidate datasets, compute choices, and learning references: [docs/ML.md](docs/ML.md). No model, GPU provider, or spending cap is selected yet.

## Test fleet and hardware

| Item | Detail | Notes |
|---|---|---|
| 2013 Chrysler 200 | ICE, CAN 11-bit/500k | Primary induced-fault car (older, simpler, cheaper to be wrong on) |
| 2019 Hyundai Elantra Preferred | ICE, CAN 11-bit/500k | Second ICE data point; subset of induced faults |
| 2024 Chevrolet Equinox EV RS First Edition | Ultium, CAN 29-bit for module diagnostics | Standard Mode 01 coverage minimal; Mode 22 via OBDb signalset |
| Veepeak OBDCheck BLE | ELM327-compatible, BLE | Do not pair in Android settings; connect from the app. Service `FFF0` |
| Dev machine | Windows 11 host with WSL2 (mirrored networking) for code; a laptop for the HIL bridge; Android phone | WSL2 has no Bluetooth and the desktop is out of range of the driveway, so the bridge runs on the laptop |

## Architecture in one picture

```
                   ┌──────────────────────────────────────────────┐
                   │              obd-core (pure TS)               │
  BLE (phone) ───▶ │ Transport ─▶ Elm327Session ─▶ decode(PIDs,    │ ──▶ PPI report
  HTTP (HIL) ────▶ │            (init, queue,      DTCs, VIN,      │
  Replay (tests) ▶ │             ISO-TP, errors)   vehicle profiles)│ ──▶ drive log
                   └──────────────────────────────────────────────┘
                                          │
                                          ▼
                   ┌──────────────────────────────────────────────┐
                   │           obd-diagnose (pure TS)              │
                   │ features ─▶ case object ─▶ model via client   │ ──▶ ranked hypotheses
                   │ deterministic   (zod)     hosted / experiment  │      + evidence + next test
                   │                          + output validation   │
                   └──────────────────────────────────────────────┘
                          ▲                        ▲
                     apps/mobile              packages/obd-eval
                    (Expo, Android)      (labeled fixtures → scores)
```

Three transports implement one interface, so the same session and decoding code runs against the phone's BLE stack, the HIL bridge on the desk, and recorded transcripts in CI. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout (target)

```
packages/obd-core/       transports, ELM327 session, PID/DTC decoding, vehicle profiles
packages/obd-diagnose/   case object, feature extraction, diagnostic LLM turn
packages/obd-eval/       eval harness and scoring
apps/mobile/             Expo app (Android first)
tools/hil-bridge/        Python bridge exposing the dongle over HTTP (laptop near the car)
tools/ml/               planned isolated Python training and serving experiments
fixtures/recordings/     immutable recordings from real cars
fixtures/synthetic/      hand-written, labeled synthetic fixtures
docs/                    plan, architecture, feasibility, ELM327 notes, eval, workflow, decisions
docs/specs/              one spec per task
```

## Development setup (short version)

- **Code** lives in WSL2: Node 22, pnpm, TypeScript. `pnpm install && pnpm check`.
- **HIL bridge** runs on the laptop, in or next to the car, because WSL2 cannot see Bluetooth and the desktop is out of range: Python 3.11+, `uv`, `bleak`, FastAPI. It serves `http://<laptop-ip>:8765` on the home Wi-Fi and records every exchange to `fixtures/recordings/`. Hardware verification is therefore a deliberate session, not something an agent triggers at will; recordings carry the load in between.
- **App** is an Expo development build (Expo Go has no BLE). Build the dev client with EAS once, then run Metro in WSL2. WSL2 is already in mirrored networking mode, so the phone reaches Metro at the desktop's LAN address; `expo start --tunnel` is the fallback.
- **LLM (planned)** uses a hosted baseline with your own key in secure storage. ML experiments add a small-model endpoint behind the same client seam; training and serving tooling stays separate from the app and bridge. Production serving remains deferred.

Full setup and the known WSL2 pitfalls: [docs/FEASIBILITY.md](docs/FEASIBILITY.md#development-environment).

## How this repo is built

The build process is part of the portfolio. Every non-trivial task goes through three agents defined in `.claude/agents/`:

- **architect** writes a spec (interfaces, files, sources for every OBD constant, verification plan) and never writes code.
- **implementer** builds to the spec with tests against recordings, runs `pnpm check`, and reports PASS / FAIL / NOT RUN per item.
- **reviewer** is read-only, reruns the checks itself, rejects any unsourced PID or AT command, and returns APPROVE or REQUEST_CHANGES.

`/feature T0.4` runs the loop for a task. The rules the agents work under are in [AGENTS.md](AGENTS.md); the reasoning is in [docs/WORKFLOW.md](docs/WORKFLOW.md). The one-line version: agents are cheap, wrong PID tables are expensive, and the HIL bridge exists so agents test against the real dongle instead of guessing.

## Top risks

1. **Equinox EV data access.** Community-verified signals for this car are thin (six signals in OBDb, three of them marked 2025+). Everything beyond state of charge and cell voltages is reverse-engineering. Mitigated by a day-1 hardware spike and by keeping the EV work in Phase 2.
2. **Background BLE on Android** needs a foreground service and survives phone power management only with care. Mitigated by scoping Phase 0 to foreground use and treating the logger as Phase 1's first task.
3. **Ground truth is small.** Six induced faults on one or two cars is a handful of labeled cases. The eval reports numbers honestly rather than pretending statistical power.
4. **Bridge logistics.** The HIL bridge lives on a laptop near the car, so agents cannot test on hardware whenever they like. Every hardware session must end with recordings, or the next week of agent work runs on assumptions.
5. **ML data and compute.** The planned real cases are too few to establish broad diagnostic generalization. Synthetic labels require review; split leakage can invalidate results. Compute and runtime compatibility need a bounded feasibility check before spending.
6. **Time.** Training and serving experiments now precede EV delivery. Future dates are provisional and will be re-estimated from completed prerequisites.

All risks with evidence and mitigations: [docs/FEASIBILITY.md](docs/FEASIBILITY.md).

## Deliberately cut

Tool and parts inventory; synthetic fault data as real-world ground truth; automated prompt optimization on the tiny real benchmark; automatic model routing; production GPU infrastructure; on-device LLM commitments; ads and parts affiliates; pricing or store work before Phase 2 has a report other owners have run; incorporation and liability work; iOS before Phase 3; the Bolt EUV direction (no car). Bounded local or rented GPU experiments are now planned under ADR-011, which amends ADR-002.

## Safety

- OBD reads are passive. The only write this software ever sends is Mode 04 (clear codes) after an explicit confirmation.
- Induced faults are performed only on the Chrysler 200 and the Elantra, by their owner, following the protocol and stop conditions in [docs/EVAL.md](docs/EVAL.md). A single-cylinder misfire is held for seconds, not minutes, because unburned fuel damages the catalytic converter.
- Nothing here touches the EV's high-voltage system. Orange cables are for trained technicians. The diagnostic port on the Equinox EV is a low-voltage read of what the modules report.
- Output is a ranked list of hypotheses with evidence, not a repair instruction. It is not a substitute for a mechanic and says so in the app.

## License

Code: MIT for `packages/*` and `tools/*` is the intent (an OBD library nobody else maintains in TypeScript is worth more as reputation than as a secret). The app's license is decided before the first store listing; the code stays public either way and the Play Store build is what is sold (ADR-009). Vehicle signal definitions imported from [OBDb](https://github.com/OBDb) are CC-BY-SA-4.0 and stay under that license with attribution, in their own directory; corrections are contributed upstream (ADR-010).
