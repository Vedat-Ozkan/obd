# X-2026-09-29-relay-recording-encoding task run

## Current state (as of 2026-09-29)

- Stage: closed (desk). APPROVE (repairs 1/2) — commit below. Tool: Claude Code, orchestrator `/feature`.
- Spec: `docs/specs/X-2026-09-29-relay-recording-encoding.md` (size S; 0 open questions).
- Repairs: 1/2. Escalations: 0.
- Verdicts: APPROVE after repair 1 (2026-09-29).
- Decisions in effect: none yet.
- Owner authorizations: 2026-09-29 owner asked for this task ("do 1-4 in any order you want"); scope taken as confirmed by that instruction, no separate confirmation.
- NOT RUN: owner `pnpm hil:smoke` re-run, redact and replay (phone and car).
- Blocker: none.
- Next action: owner re-runs Owner re-runs `pnpm hil:smoke` after the fix (the 2026-09-28 raw file is not converted).

## Baseline

`git status --short` at start: ` M .claude/agents/implementer.md`, ` M .claude/agents/recording-analyst.md`, `?? docs/specs/T2.11b-assistant-backend-live-eval.md`, plus `docs/task-runs/T2.12.md` (record note). None belongs to this task. HEAD `927f7f3`.

## Touched files

`packages/obd-core/src/recording/provenance.ts` (export only), `tools/relay/broker.ts`, `tools/relay/server.test.ts`, `docs/ARCHITECTURE.md`.

## Verification evidence

Implementer (2026-09-29): E2E steps 1–6 PASS (fake phone, junk bytes, real `redact_vin.py`, replay); the test fails on the old broker; relay 62/62. `pnpm check` FAIL only at eslint parsing `tools/summary-backend/.wrangler/tmp/…`, a build scratch from the orchestrator's running `wrangler dev`; the orchestrator stopped the server and removed the gitignored `tmp` (`state` kept). Follow-up note: `eslint.config.js` ignores do not cover `**/.wrangler/**`, so any running `wrangler dev` breaks `pnpm check`.
E2E step 6 artifact (vitest hides console output by default; print it with `npx vitest run tools/relay/server.test.ts -t "redact_vin.py accepts" --disableConsoleIntercept` or `--reporter=verbose --silent=false`). Redacted ATZ rx line as the test prints it, bytes checked with `od -c` by the orchestrator (2026-09-29): every non-ASCII byte is escaped on disk. Subagent reports rendered the last two escapes as `üÿ`; that was display only.

```
{"t": 0.004, "dir": "rx", "data": "\u0000\u007f\u0080\u009f\u00fc\u00ff\r\rELM327 v1.5\r\r>"}
```

Replay: `L14 0100 -> data`; 7 commands (ATZ data, ATE0/ATL0/ATS0/ATH1/ATSP0 ok, 0100 data with one dropped malformed frame because the shared test constant `raw` has no header under ATH1).

## Review findings

No open findings. Review 1 findings fixed in repair 1 and by the orchestrator's record paste; re-review minor (artifact command) addressed in the record.

## Log

- 2026-09-29 preflight (Claude orchestrator): record created.
- 2026-09-29 architect (Claude): spec written; the broker also writes compact separators, which the redactor's form check refuses; fix is `pythonJson` + utf8 in `append`.
- 2026-09-29 implementer (Claude): done; see Verification evidence.
- 2026-09-29 reviewer (Claude): REQUEST_CHANGES, 1 major (record paste, done by orchestrator), 3 minor.
- 2026-09-29 implementer repair 1 (Claude): findings 2–4 fixed in `server.test.ts`; relay 62/62; eslint clean. Orchestrator confirmed the escaped on-disk form with `od -c`.
- 2026-09-29 reviewer (Claude): APPROVE (repairs 1/2). Full `pnpm check` red only in the parallel reservation task's in-progress `worker.test.ts`; this task's scoped checks green.
