# obd

> Working title. An independent battery health check for used EVs, verified first on GM Ultium (2024 Chevrolet Equinox EV): an Android app that talks to a $30 Bluetooth OBD dongle, measures what the battery reports, and explains it without inventing numbers. Built full-time as an applied-AI portfolio project with an architect / implementer / reviewer agent workflow, where every claim is checked against recordings from a real car.

**Status (2026-11-14):** the parked battery check is the product and is what gets verified next; desk work is frozen until the queued phone and car checks are done (ADR-024, [docs/OWNER-QUEUE.md](docs/OWNER-QUEUE.md)). The last car session was 2026-09-30. Everything merged since then is tested at the desk only, against recordings and a simulated car. No charge log has succeeded yet, so there is no capacity estimate and no battery model, and the AI summary and assistant have no measured evaluation yet. Plan: [docs/PLAN.md](docs/PLAN.md). Why things changed: [docs/DECISIONS.md](docs/DECISIONS.md).

## What we are building

Used-EV buyers want to know one thing: is this battery healthy? Dealers won't say, and GM's Ultium cars (Equinox EV, Blazer EV, Silverado EV, Lyriq, Optiq, Prologue) have no consumer tool like LeafSpy is for the Nissan Leaf. This app is that tool, built so the owner and a buyer can both trust what it shows.

It offers three checks, each measuring only what its duration can support (ADR-022):

| Check | Takes | Measures | Who | State |
|---|---|---|---|---|
| **Parked scan** | ~2 min | State of charge, cell-group spread, 12 V, trouble codes, "recently cleared?" heuristic; GM's own capacity figure once verified, labeled as the car's own number | Owners and buyers | Run on the Equinox in September; later changes await a phone check |
| **Test drive** | 15–20 min of normal driving | Pack resistance from acceleration and regen steps, and cell groups that sag more than the rest under load: a view of power fade and weak cells a parked scan cannot see | Owners and buyers | Two drives recorded; absolute resistance was a NO-GO, so the check compares cell groups under load. Rule unconfirmed; in Developer tools until one confirming drive |
| **Overnight charge** | One charge | Independent capacity with an error band | Owners | Logger built; no successful log yet. In Developer tools until one passes on the car |

Every report shows observed data with its source and signal tier, marks what was not measured, and never certifies health it cannot measure. Capacity reads **NOT MEASURED** until a charge log supports it.

An optional **AI summary** and a **battery assistant** explain the results in plain language. The analysis itself is deterministic code; the model only explains numbers the code already computed, and a number check rejects any reply containing a value that is not in the report (the app then shows the plain template). Consent comes first, and a minimized, VIN-free projection is sent through OpenRouter.

## Working on now

- **Phone and car checks** for everything merged at the desk, in the order at the top of [docs/OWNER-QUEUE.md](docs/OWNER-QUEUE.md): a build, one parked session, one overnight charge, one drive.
- **Why the charge logs failed.** In the three September attempts the car never answered the first request, and a 5 s session timeout hid the dongle's own `UNABLE TO CONNECT` (it arrives after about 5.5 s). The fix is `docs/specs/X-2026-11-14-car-not-answering.md`; whether the car answers while switched off and charging is the first thing the next session checks.
- **One measured result for the assistant:** the paid four-model comparison on the 12 frozen questions.

## Next

After a real charge log exists: the battery ML track (BM1–BM9, [docs/ML.md](docs/ML.md)), starting with the dataset pipeline and an independent capacity estimate with an error budget. Beta testing with other Ultium owners and the rewarded-ad funding path are suspended until the parked check is verified (ADR-024).

## How it fits together

```
 Veepeak BLE dongle ── phone (Expo app) ── obd-core ── obd-battery ── report screens
                            │               (ELM327     (reports,      │ opt-in
                            │                session,    charge log,   ▼
                            │                decoding,   test drive)  obd-assist ── local summary
                            │                profiles)                (number check) Worker → OpenRouter
                            └─ relay mode ── tools/relay (WSL2) ── MCP server for agents (read-only allowlist)

 fixtures/recordings/ ──── replay ──── the same obd-core code in tests and CI
```

`obd-core` is pure TypeScript with injected transports, so the same session and decoding code runs on the phone, through the relay, and against recorded transcripts in CI. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```
packages/obd-core/       transports, ELM327 session, J1979 and Mode 22 decoding, vehicle profiles, codes report
packages/obd-battery/    battery reports, charge-log and test-drive analysis scripts
packages/obd-assist/     AI summary and assistant, number check
packages/obd-eval/       eval harness and scoring
packages/obd-diagnose/   withdrawn gas-car diagnosis (ADR-012)
apps/mobile/             Expo app, Android first
tools/relay/             WSL2 relay and car MCP server; the phone connects to it
tools/summary-backend/   local development Worker for the AI summary (OpenRouter, US$1 budget)
tools/beta-backend/      Cloudflare Worker for consented beta uploads (ADR-019)
tools/beta-intake/       owner-side beta intake, re-scrub and deletion
tools/spike/             laptop capture scripts, VIN redaction
tools/hil-bridge/        Python laptop bridge (fallback)
fixtures/recordings/     immutable recordings from real cars (committed copies are VIN-redacted)
fixtures/synthetic/      hand-written fixtures, labeled synthetic
docs/                    plan, architecture, ELM327 notes, eval, ML, workflow, decisions
docs/specs/              one spec per task;  docs/task-runs/  one progress record per task
```

## Development setup (short version)

- **Code** lives in WSL2: Node 22, pnpm, TypeScript. `pnpm install && pnpm check`.
- **App** is an Expo development build (Expo Go has no BLE); Metro runs in WSL2 with mirrored networking. An EAS `preview` profile builds a standalone APK for use away from the desk.
- **Car access from the desk** goes through the phone's relay mode to `tools/relay` (ADR-013); `pnpm hil:smoke` checks the path end to end and saves a recording.
- **AI summary** runs against a local Worker (`tools/summary-backend/README.md`) with a dedicated OpenRouter key capped at US$1; keys never enter the app or the repo.

Setup details and WSL2 pitfalls: [docs/FEASIBILITY.md](docs/FEASIBILITY.md#development-environment).

## Test fleet and hardware

| Item | Detail | Notes |
|---|---|---|
| 2024 Chevrolet Equinox EV RS First Edition | Ultium, CAN 29-bit for module diagnostics | The required vehicle; pack current, voltage and energy signals found and checked in recordings (`docs/discovery-2026-09.md`) |
| 2013 Chrysler 200, 2019 Hyundai Elantra | ICE, CAN 11-bit | Optional bench only (ADR-015) |
| Veepeak OBDCheck BLE | ELM327-compatible, BLE service `FFF0` | Connect from the app, not Android settings; unplug after use (12 V drain) |

## How this repo is built

The build process is part of the portfolio. Every non-trivial task goes through three agents (`.claude/agents/`):

- **architect** writes a spec with sources for every OBD constant and a verification plan, and never writes code;
- **implementer** builds to the spec with end-to-end tests over real recordings and reports PASS / FAIL / NOT RUN per item;
- **reviewer** is read-only, reruns everything itself, rejects unsourced constants, and returns APPROVE or REQUEST_CHANGES (at most two repair rounds).

`/feature <task>` runs the loop; each task's history is in `docs/task-runs/`. Rules: [AGENTS.md](AGENTS.md). Process: [docs/WORKFLOW.md](docs/WORKFLOW.md). Hardware claims always cite a recording; anything not run on the car says NOT RUN.

## Safety

- The app only reads. The single write it can send is Mode 04 (clear codes) after an explicit confirmation; UDS writes are rejected in code.
- Agents reach the car only through the relay's read-only allowlist, and Mode 04 needs a tap on the phone.
- The test-drive check needs no interaction after the start tap. Don't touch the phone while driving.
- Nothing here touches the high-voltage system. Reports are observed data, not a certified battery rating or a repair instruction.
- The VIN stays on the device; committed recordings mask it (ADR-017).

## License

Intended: MIT for `packages/*` and `tools/*`; the app's license is decided before the first store listing (ADR-009). Signal definitions imported from [OBDb](https://github.com/OBDb) stay CC-BY-SA-4.0 with attribution in their own directory, and corrections go upstream (ADR-010).
