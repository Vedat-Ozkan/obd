# X-2026-09-29-deepseek-json-mode task run

## Current state (as of 2026-09-29)

- Stage: APPROVE (repairs 0/2) — commit below; orchestrator live D1 migration next. Tool: Claude Code, orchestrator `/feature`.
- Spec: `docs/specs/X-2026-09-29-deepseek-json-mode.md` (size M-small, 11 files; status stored as `provider-error:NNN` in the existing `error` column).
- Repairs: 0/2. Escalations: 0.
- Verdicts: APPROVE (2026-09-29); reviewer reproduced `pnpm check` PASS.
- Decisions in effect: owner 2026-09-29: keep the DeepSeek host; replace the strict `json_schema` request with plain JSON mode on DeepSeek-hosted pins; rely on server and phone schema validation plus the number check.
- Owner authorizations: the fix itself; owner 2026-09-29 confirmed the spec's scope (JSON mode on all four arms and the summary, v2 summary prompt) and answered the open question: yes, record the upstream HTTP status code (number only) for `provider-error`, folded into this task. No lint-config change (owner declined). No paid call authorized by this task; the owner re-runs the T2.10 phone gate afterwards.
- NOT RUN: live D1 migration (orchestrator, after review); owner D1 phone re-run.
- Blocker: none (T2.11b Stage 1b committed f241ee3).
- Next action: reviewer, then the orchestrator's live D1 migration (read-only before/after), then the owner's D1 phone re-run.

## Baseline

HEAD `f7a126e` plus T2.11b Stage 1b in progress (`tools/summary-backend/{openrouter.ts,worker.test.ts,assistant-eval.ts,README.md}`) and record edits in `docs/task-runs/T2.10.md`, `T2.11.md`. None belongs to this task.

## Touched files

`tools/summary-backend/{openrouter.ts,worker.ts,schema.sql,worker.test.ts,assistant-eval.ts,README.md}`, `apps/mobile/src/summaryAccess.ts`, `apps/mobile/test/summary-flow.test.ts`, `docs/specs/{T2.10c-hosted-deepseek-eval.md,T2.11b-assistant-backend-live-eval.md,X-2026-09-29-summary-reservation.md}`.

## Verification evidence

Implementer (2026-09-29): failure modes 1–17 PASS; worker 4/4; mobile 386; `pnpm check` PASS; `git diff --check` PASS. Artifacts `/tmp/t2.10c-local-e2e.json`, `/tmp/t2.11b-eval-dry*.json`, `/tmp/t2.10d-mobile-flow.json`. Five deviations stated (prompt line position, partial-line replacement, harness additions, doc wording, README section).

## Review findings

APPROVE with 4 minors: (1) README:61 "(below)" → "(above)", fixed by the orchestrator; (2) `reservationFor` doc comment wording changed ("any JSON"), comment-only deviation from the Non-goal, bound unchanged — accepted; (3) `assistant-eval.ts:166` comment fix is orchestrator-directed, outside the spec's Files scope — accepted; (4) FM5 wording: the spec said the system message "starts with" the adapter line; it follows `summaryInstructions` by design, so the correct rule is "contains the line".

## Log

- 2026-09-29 preflight (Claude orchestrator): record created after the owner's D1 phone gate returned `provider-error` twice (see `docs/task-runs/T2.10.md`).
- 2026-09-29 architect (Claude): spec written, 1 open question (status code). Owner: yes, and scope confirmed.
- 2026-09-29 architect revision (Claude): status code folded in; 0 open questions. Orchestrator adds the T2.11b Stage 1b review minor (stale comment at `assistant-eval.ts:163`) to this implementation, since that file is in Files.
- 2026-09-29 implementer (Claude): done; see Verification evidence.
- 2026-09-29 reviewer (Claude): APPROVE, 4 minors (README word fixed by orchestrator; others recorded).
