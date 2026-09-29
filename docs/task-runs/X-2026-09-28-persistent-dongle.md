# X-2026-09-28-persistent-dongle task run

## Current state (as of 2026-09-28)

- Stage: Stage A approved and committed; implementer Stage B (in progress). Tool: Claude Code, orchestrator `/feature`.
- Spec: `docs/specs/X-2026-09-28-persistent-dongle.md` (two stages, A link/memory/auto-connect, B picker; 0 open questions).
- Repairs: 1/2. Escalations: 0.
- Verdicts: Stage A APPROVE after repair 1 (2026-09-29).
- Decisions in effect: none yet.
- Owner authorizations: 2026-09-28 owner confirmed scope, build both stages.
- NOT RUN: owner phone checks A1–A10 (need phone and car).
- Blocker: none.
- Next action: implementer Stage B, then reviewer.

## Request

Owner, 2026-09-28: "why do i have to reconnect to the dongle each time? should be one and done no?" and "don't like the list of bluetooth connections. make it a modal, and ideally with only the most relevant ones to us at the top." Follow-up to `X-2026-09-28-app-redesign`. Scope as stated in the `/feature` arguments: remember the dongle per car and auto-connect, keep the BLE link across runs and screens, modal device picker sorted by relevance.

## Baseline

`git status --short` at start (not this task's files; do not stage):

```
 M .claude/agents/implementer.md
 M .claude/agents/recording-analyst.md
 M docs/specs/T0.6a-node-relay-mcp.md
 M tools/relay/hil-smoke.ts
?? docs/specs/T2.11b-assistant-backend-live-eval.md
```

`tools/relay/hil-smoke.ts` and the T0.6a spec line carry an owner-requested wait change (60 s → 5 min) made in the same session, outside this task.

## Touched files

Stage A: `apps/mobile/src/ble/dongleLink.ts` (new), `src/chargeRun.ts`, `src/app/runtime.ts`, `src/screens/ConsoleScreen.tsx`, `test/dongle-link.test.ts` (new), `test/charge-run.test.ts`, `test/charge-logger.test.ts`.

## Verification evidence

Stage A implementer (2026-09-28): `pnpm check` PASS; Android `expo export` PASS; fingerprint equal to `e781dff0…` PASS; logic-freeze diff empty PASS; K1 E2E PASS, artifact `/tmp/x-persistent-dongle-kept-link.json` (synthetic); L1–L8, V1–V5, M1–M4 PASS. Six stated deviations (auto-connect cases 1/3, error texts, name retention, error-listener) for the reviewer.

## Review findings

Stage A: both review-1 findings fixed in repair 1; re-review APPROVE, no open findings.

## Log

- 2026-09-28 preflight (Claude orchestrator): record created.
- 2026-09-28 architect (Claude): spec written, 0 open questions; fingerprint baseline `e781dff0…` at HEAD `885bcab`.
- 2026-09-28 scope (owner): confirmed, build Stage A and Stage B.
- 2026-09-28 implementer Stage A (Claude): done, see Verification evidence.
- 2026-09-29 reviewer Stage A (Claude): REQUEST_CHANGES, 1 major 1 minor; checks, fingerprint, K1 reproduced PASS.
- 2026-09-29 implementer repair 1 (Claude): rows and Scan gated by `chargeLogging || bleBusy()`; redundant setConnection dropped; `pnpm check` PASS; fingerprint unchanged.
- 2026-09-29 reviewer Stage A (Claude): APPROVE (repairs 1/2); render-time gating ruled sufficient.
