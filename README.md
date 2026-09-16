# obd

> Working title. An open, transparent OBD-II toolkit: a pure-TypeScript OBD library, an Android app that produces a pre-purchase inspection report and evidence-cited diagnoses for gas cars, and a battery-health tool for GM Ultium EVs. Built full-time as a portfolio project using an architect / implementer / reviewer agent workflow, with every claim checked against recordings from real cars.

**Status:** Phase 0 (pre-purchase inspection tool) in progress. Started 2026-09-16. Nothing is runnable yet; the first task is the scaffold. See [docs/PLAN.md](docs/PLAN.md).

## Why this exists

Consumer OBD apps are a crowded market and the AI-native corner of it is already occupied (OBDAI, MECH AI, Skanyx and others do most of what the original plan described, with hardware bundled). This project does not pretend to have found an empty niche. It exists for three reasons:

1. **Personal use.** Three cars in the driveway, one of them a used-car candidate for family and friends, one an EV whose battery health nobody will tell me about without a dealer visit.
2. **Portfolio.** Hardware protocol work, a mobile app with background BLE, a deterministic feature-extraction layer under an LLM, and an eval harness with real induced-fault ground truth. The interesting engineering claim is not "AI diagnoses your car" but "here is exactly how often it is right, on which faults, at what cost, and how we know."
3. **One direction with a real precedent.** LeafSpy became the canonical Nissan Leaf battery tool as a solo-developer app. No equivalent exists for GM's Ultium platform (Equinox EV, Blazer EV, Silverado EV, Lyriq, Prologue). That is Phase 2, and it is honestly the riskiest part of the plan.

The longer-term intent is to sell the app at a modest price. That does not change Phases 0 to 2, but it does shape two decisions now: the EV battery tool, which needs no LLM call and therefore has no marginal cost, is the natural paid product, and the code stays public while the store build is what is sold. See [docs/DECISIONS.md](docs/DECISIONS.md) ADR-009 and ADR-010.

## What it does, by phase

| Phase | Dates | Deliverable | Cars |
|---|---|---|---|
| 0 | Sep 16 – Oct 9, 2026 | **Pre-purchase inspection (PPI) tool.** Connect over BLE, read VIN, DTCs (stored, pending, permanent), freeze frame, readiness monitors, distance/time since codes cleared, and produce a shareable report with a "codes were recently cleared" flag. | Chrysler 200, Elantra. Equinox EV: VIN + whatever answers. |
| 1 | Oct 12 – Nov 6, 2026 | **Diagnostic engine (gas cars).** Background drive logging with cold-start capture, symptom timestamps, deterministic feature extraction (fuel trim by load bin, warm-up slope, misfire counts), an LLM turn that returns ranked hypotheses with evidence and a next test, and an eval harness scored against six induced faults. | Chrysler 200, Elantra |
| 2 | Nov 9 – Dec 11, 2026 | **EV battery health (Ultium).** State of charge, pack and cell voltages, cell imbalance, charging-session logging, capacity estimate over a full charge, 12 V health. Starts from the OBDb Equinox EV signalset and extends it. | Equinox EV |
| 3 | Dec 2026+ | Stretch: Mode 06 monitor data, active-test loop, full module scan on the EV, iOS via EAS, open-weight model benchmarking. | |

Full task breakdown with verification criteria: [docs/PLAN.md](docs/PLAN.md).

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
                   │ case object ─▶ feature extraction ─▶ LLM turn │ ──▶ ranked hypotheses
                   │  (zod)         (deterministic)     (Anthropic  │      + evidence + next test
                   │                                    SDK, JSON)  │
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
fixtures/recordings/     immutable recordings from real cars
fixtures/synthetic/      hand-written, labeled synthetic fixtures
docs/                    plan, architecture, feasibility, ELM327 notes, eval, workflow, decisions
docs/specs/              one spec per task
```

## Development setup (short version)

- **Code** lives in WSL2: Node 22, pnpm, TypeScript. `pnpm install && pnpm check`.
- **HIL bridge** runs on the laptop, in or next to the car, because WSL2 cannot see Bluetooth and the desktop is out of range: Python 3.11+, `uv`, `bleak`, FastAPI. It serves `http://<laptop-ip>:8765` on the home Wi-Fi and records every exchange to `fixtures/recordings/`. Hardware verification is therefore a deliberate session, not something an agent triggers at will; recordings carry the load in between.
- **App** is an Expo development build (Expo Go has no BLE). Build the dev client with EAS once, then run Metro in WSL2. WSL2 is already in mirrored networking mode, so the phone reaches Metro at the desktop's LAN address; `expo start --tunnel` is the fallback.
- **LLM** calls use the Anthropic TypeScript SDK with your own key stored in the app's secure store. No proxy server exists yet; there is no reason for one until the app is distributed.

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
5. **Time.** Phase 0 is 3.5 weeks full-time including learning Expo dev builds and the dongle's real behavior. The dates carry no slack; slipping Phase 0 by a week is acceptable, slipping it by three means cutting the HIL bridge to a script.

All risks with evidence and mitigations: [docs/FEASIBILITY.md](docs/FEASIBILITY.md).

## Deliberately cut

Tool and parts inventory; synthetic fault data as ground truth; automated prompt optimization; more than two agents per change; local GPU inference (see [docs/DECISIONS.md](docs/DECISIONS.md) ADR-002); ads and parts affiliates; any pricing or store work before Phase 2 has a report other owners have run; incorporation and liability work; iOS before Phase 3; the Bolt EUV direction (no car).

## Safety

- OBD reads are passive. The only write this software ever sends is Mode 04 (clear codes) after an explicit confirmation.
- Induced faults are performed only on the Chrysler 200 and the Elantra, by their owner, following the protocol and stop conditions in [docs/EVAL.md](docs/EVAL.md). A single-cylinder misfire is held for seconds, not minutes, because unburned fuel damages the catalytic converter.
- Nothing here touches the EV's high-voltage system. Orange cables are for trained technicians. The diagnostic port on the Equinox EV is a low-voltage read of what the modules report.
- Output is a ranked list of hypotheses with evidence, not a repair instruction. It is not a substitute for a mechanic and says so in the app.

## License

Code: MIT for `packages/*` and `tools/*` is the intent (an OBD library nobody else maintains in TypeScript is worth more as reputation than as a secret). The app's license is decided before the first store listing; the code stays public either way and the Play Store build is what is sold (ADR-009). Vehicle signal definitions imported from [OBDb](https://github.com/OBDb) are CC-BY-SA-4.0 and stay under that license with attribution, in their own directory; corrections are contributed upstream (ADR-010).
