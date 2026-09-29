# X-2026-09-29-summary-placeholders task run

## Current state (as of 2026-09-29)

- Stage: Stage 1 APPROVE (repairs 1/2) — committed; live D1 migration; then Stage 2. Tool: Claude Code, orchestrator `/feature`.
- Spec: `docs/specs/X-2026-09-29-summary-placeholders.md` (Stage 1 failed-check category, 2 placeholders and rendering, 3 summary prompt v4, 4 assistant t2.11-v2).
- Repairs: 1/2. Escalations: 0.
- Verdicts: Stage 1 APPROVE after repair 1 (2026-09-29); full `pnpm check` reproduced PASS.
- Decisions in effect (owner, 2026-09-29): (1) the model never writes numeric values; it writes placeholders naming fact IDs and the app renders the exact value and unit from the report; prose stays checked. (2) Record which check failed as a category only (for example `invalid-response:facts`), never reply text.
- Owner authorizations: this change; 2026-09-29 build all four stages; hedging words around placeholders allowed (left to semantic grading). No paid call; the owner re-runs the D1 phone gate afterwards.
- NOT RUN: none yet.
- Blocker: none. X-2026-09-29-twelve-volt-name Stage 2 is on hold until this spec decides whether it is superseded.
- Next action: Stage 1 implementer → reviewer → commit → live D1 migration; then Stages 2, 3 (owner D1 re-run after 3), 4. No paid call or phone run between Stage 2 and Stage 3.

## Baseline

HEAD `ca86868`; working tree: `.claude/agents/*` (not this task), `docs/task-runs/T2.10.md` (third attempt entry).

## Touched files

None yet.

## Verification evidence

Stage 1 implementer (2026-09-29): items 1–9 PASS (worker 4/4, mobile 402); counterfactuals reproduced by the reviewer: (a) base `ca86868` schema.sql fails at `worker.test.ts:315` (migration-block wrong-number post returns `unavailable`, settle hits the old CHECK); (b) every `failedCheck` literal in `openrouter.ts` (lines 241, 248, 264, 272, 275, 277, 287, 294) replaced with `"facts"` fails at `worker.test.ts:376` ("missing-citation: expected 'facts' to be 'shape'"); artifacts `/tmp/t2.10c-local-e2e.json`, `/tmp/t2.10d-mobile-flow.json`, `/tmp/t2.11b-eval-dry-facts.json`. `pnpm check` red only at eslint on the owner's `.wrangler/tmp`; parts green. Deviations: provider gate keeps an earlier category; exported const array; test keep-alive fix; stronger llm-ignores-failedCheck assertion.

## Review findings

Stage 1 review 1 (fixed in repair 1): (1, major) T2.10d Interfaces `DevelopmentSummaryEvidence` lacks `failedCheck`; (2, major) T2.10c Interfaces fallback envelope lacks `failedCheck?`; (3, major) T2.11b:58 `failedCheck` sits inside a comment; (5, minor) `summary-flow.test.ts:142` row name puts SENTINEL into the artifact. Recorded by the orchestrator: (4) counterfactual lines above; (6) deviation: when `complete()` already failed (e.g. finish_reason not stop), a wrong-provider response keeps `envelope`, not `provider` (`openrouter.ts:272`) — accepted, stated in the spec by repair 1. Re-review minor: the vitest case title (%j) still shows the sentinel word in console output only; no artifact affected.

## Log

- 2026-09-29 preflight (Claude orchestrator): record created after the third D1 attempt fell back (`docs/task-runs/T2.10.md`).
- 2026-09-29 architect (Claude): spec written; owner confirmed scope and the modifier boundary.
- 2026-09-29 implementer Stage 1 (Claude): done.
- 2026-09-29 reviewer Stage 1 (Claude): REQUEST_CHANGES, 3 major (spec interface edits) 3 minor; stale `.wrangler/tmp` removed by the orchestrator (server stopped).
- 2026-09-29 implementer repair 1 (Claude): findings 1, 2, 3, 5, 6 fixed (spec interfaces, test row name, deviation stated in the spec); full `pnpm check` PASS; SENTINEL absent from `/tmp/t2.10d-mobile-flow.json`.
- 2026-09-29 reviewer Stage 1 (Claude): APPROVE (repairs 1/2).
- 2026-09-29 orchestrator live migration (Stage 1): before (read-only): two tables, no `_next`; budget (1,5,15467,NULL,0); five 2026-09-29 rows (two `provider-error`, three `invalid-response`). Applied schema.sql with wrangler dev stopped (11 commands succeeded). After (read-only): identical budget and rows; error CHECK now lists the six `invalid-response:<check>` values.
