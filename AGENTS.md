# AGENTS.md

Instructions for coding agents (Claude Code, Cursor, Codex, and humans in a hurry) working in this repository. Keep this file short; details live in `docs/`.

## What this project is

A used-EV battery health check, verified first on GM Ultium vehicles, with other makes added through beta testers (ADR-014): a transport-agnostic OBD-II library in TypeScript (`obd-core`), battery analysis (`obd-battery`), an opt-in LLM summary and assistant checked against the data (`obd-assist`), an Android app built on them (Expo), and a phone relay that exposes the car to agents through an MCP server with a read-only allowlist. Test fleet: 2013 Chrysler 200 (ICE), 2019 Hyundai Elantra (ICE), 2024 Chevrolet Equinox EV (Ultium). Dongle: Veepeak OBDCheck BLE.

It is a portfolio and personal-use project first, showcasing applied AI engineering: battery ML with calibrated uncertainty, on-device inference, LLM evals, MCP tooling, and the agentic build process. Correctness and honest verification matter more than feature count. See ADR-012 to ADR-014; the gas-car diagnosis engine and ML1–ML6 are withdrawn.

## Read before working

| Need | File |
|---|---|
| Phases, task list, dates | `docs/PLAN.md` |
| Packages, interfaces, data formats | `docs/ARCHITECTURE.md` |
| ELM327 / dongle / vehicle quirks | `docs/ELM327.md` |
| Risks, research findings, decisions on tooling | `docs/FEASIBILITY.md` |
| Fixtures, labels, eval scoring (battery, LLM, discovery) | `docs/EVAL.md` |
| Battery ML (BM1–BM7), datasets, LLM eval, ML verification | `docs/ML.md` |
| How the architect/implementer/reviewer loop runs | `docs/WORKFLOW.md` |
| Why things were decided | `docs/DECISIONS.md` |
| Spec template | `docs/specs/README.md` |

## Repository map (target layout; see PLAN.md T0.1 for what exists)

```
packages/obd-core/      pure TS: transports, ELM327 session, PID/DTC decoding, vehicle profiles
packages/obd-battery/   pure TS: charge sessions, capacity, imbalance, 12 V, reports, templates, on-device models
packages/obd-assist/    pure TS: opt-in LLM summary and assistant, faithfulness check (replaces obd-diagnose)
packages/obd-eval/      Node: eval harness over labeled fixtures, scoring, reports
apps/mobile/            Expo (Android): BLE transport, console, relay mode, charge logger, report + assistant screens
tools/relay/            Node in WSL2: phone relay and car MCP server with a read-only allowlist
tools/hil-bridge/       Python (laptop near the car): spike and fallback bridge
tools/ml/               planned isolated Python battery modeling (not implemented)
fixtures/recordings/    recorded ELM327 transcripts (never hand-edited)
fixtures/synthetic/     hand-written fixtures, labeled synthetic
docs/                   the documents above
docs/specs/             one spec per task, written by the architect
```

## Commands (the contract the scaffold must satisfy)

```
pnpm install
pnpm check          # typecheck + lint + test across all packages; must be green before review
pnpm test           # vitest across packages
pnpm -F obd-core test
pnpm replay <recording.jsonl>      # run a recording through obd-core and print decoded output
pnpm hil:smoke      # send 0100 through the phone relay and save a recording (needs phone + car)
pnpm eval           # run battery models and the LLM suite over labeled fixtures and print scores
cd tools/hil-bridge && uv run hil-bridge   # laptop fallback bridge; URL in docs/ARCHITECTURE.md
```

## Hard rules

1. **Source every constant.** Every PID, AT command, CAN header, scaling formula, and DTC decode must trace to `docs/ELM327.md`, a J1979 table checked into the repo, an OBDb signalset under `packages/obd-core/vehicles/`, or a file under `fixtures/recordings/`. If you cannot cite it, do not write it; capture it on hardware first. Values from memory are the main way wrong PID tables spread.
2. **Recordings are immutable.** Never hand-edit `fixtures/recordings/`. Add new ones with the recording tool. Hand-written data goes in `fixtures/synthetic/` and is labeled synthetic in the eval.
3. **Never claim hardware verification you did not do.** Reports say PASS, FAIL, or NOT RUN with a reason. Hardware claims cite a recording path.
4. **`obd-core` is pure.** No React Native, BLE, `fetch`, or Node-only imports. Transports are injected. The same code runs in the app, the eval harness, and replay tests.
5. **Read-only toward the vehicle.** The only write is Mode 04 (clear DTCs), behind an explicit user confirmation. No UDS writes (2E, 31, 2F), no session changes beyond what reads require, no coding or adaptation. Reading is safe; writing to a car you do not fully understand is not.
6. **Scope is the spec.** Do only what the spec says. Adjacent improvements go in a note, not in the diff.
7. **No new dependencies** unless the spec lists them with a reason.
8. **No secrets in the repo.** API keys live in the app's secure store (BYOK) or in `.env` files that are gitignored.
9. **Tests run against fixtures, not the dongle.** CI has no Bluetooth. Tests that need hardware are tagged and skipped in CI, and the spec says how to run them via the phone relay (or the laptop bridge fallback).
10. **Simplicity.** Minimum code for the task. No single-use abstractions. If a senior engineer would call it overbuilt, rewrite it smaller.
11. **ML evidence.** Track data/model provenance, consent, and intended-use licensing; separate synthetic and real results; split by vehicle and session before augmentation. No test-set tuning or invented benchmark results. Required model training and evaluation runs cannot be waived as vehicle hardware-only checks. Exact compute, spending, dependencies, and model choices belong in the experiment spec before execution. LLM output shown to users passes the deterministic number check.

## ELM327 quick facts (full detail in `docs/ELM327.md`)

- Commands end with `\r`. Responses end with `>` (the prompt). Nothing is complete until `>` arrives.
- Init: `ATZ` (wait ~1 s), `ATE0`, `ATL0`, `ATS0`, `ATH1`, then protocol select. Keep headers on and reassemble ISO-TP multi-frame yourself.
- `SEARCHING...`, `NO DATA`, `UNABLE TO CONNECT`, `CAN ERROR`, `BUFFER FULL`, `STOPPED`, `?`, `LV RESET` are all documented responses; each has a defined handling in `docs/ELM327.md`.
- One command in flight at a time. Over BLE, writes are chunked to the MTU (20 bytes by default) and notifications are reassembled until `>`.
- Veepeak BLE: service `FFF0`, characteristics `FFF1`/`FFF2` (which is write vs notify varies by firmware; discover, do not assume).
- The Equinox EV needs 29-bit CAN (`ATSP7`) and Mode 22 with per-module headers. Standard Mode 01 coverage on an EV is minimal.

## Workflow

Architect writes a spec, implementer builds to it, reviewer gates it. `/feature <task-id>` runs the loop. A task is done when: `pnpm check` is green, the reviewer approved, every verification item in the spec is PASS or explicitly hardware-only, and the report states what was not run. Details in `docs/WORKFLOW.md`.

## Style

- TypeScript: strict, ESM, named exports only, `zod` at package boundaries, `vitest`. Small files, small functions. Comments explain why, not what.
- Python (laptop bridge and planned isolated ML workspace): `uv`, `ruff`, type hints, `pytest`. Training dependencies stay out of the bridge and normal fixture-based CI.
- Commit messages: imperative subject, body says what was verified. No commits unless the user asks.
