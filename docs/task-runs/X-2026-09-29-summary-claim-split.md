# X-2026-09-29-summary-claim-split task run

## Current state (as of 2026-09-29)

- Stage: closed (desk). APPROVE (repairs 0/2) — commit below. Waiting for the owner's phone re-run.
- Spec: `docs/specs/X-2026-09-29-summary-claim-split.md` (one stage, 10 files; prompt t2.10-v3 / adapter v6; four rolled-up code facts in the summary projection only).
- Repairs: 0/2. Escalations: 0.
- Verdicts: APPROVE (2026-09-29); full `pnpm check` reproduced PASS.
- Decisions in effect (owner, 2026-09-29): the prompt makes each sentence its own claim (up to 3 per area); the projection gains rolled-up code facts so the codes area cites a few facts instead of one per module; claim limits (512 characters, 16 factIds) stay.
- Owner authorizations: this change; scope is the owner's chosen fix (no separate confirmation). No paid call; the owner re-runs the phone summary afterwards.
- NOT RUN: owner phone re-run (v3/v6); record displayCategory, output tokens and any doubled value.
- Blocker: none.
- Next action: owner phone re-run. Follow-up (test gap): assert that no `get_session`/`get_codes` trace fact ID matches `/^(codes-(stored|pending|permanent)|readiness)$/` in `assistant-replay.test.ts`.

## Baseline

HEAD `57ff2bf`; working tree: `.claude/agents/*`, record edits (`docs/task-runs/T2.10.md` and others).

## Touched files

None yet.

## Verification evidence

None yet.

## Review findings

None yet.

## Log

- 2026-09-29 preflight (Claude orchestrator): record created from the `invalid-response:shape` diagnosis in `docs/task-runs/T2.10.md`.
- 2026-09-29 architect (Claude): spec written; no checker rule for repeated {fact:ID} or one-sentence claims; assistant keeps per-module facts.
- 2026-09-29 implementer (Claude): items 1–10 PASS (obd-assist 295, mobile 417); full `pnpm check` PASS. Reservations 7,767 (spike), 7,257 (phone-console). Counterfactuals: (a) filter removed at `summary.ts:92` → projection-shape test, `v2-era-module-citation`, artifact kinds; (b) wrong read count → three claim-split cases; (c) roll-ups moved into `reportFacts` → no test fails, assistant replay artifact differs by 110 lines (test gap); (d) old prompt sentence → `worker.test.ts:595`; (e) phone accepts v5 → `summary-flow.test.ts:347`. Baselines differ only in the promptVersion line.
- 2026-09-29 reviewer (Claude): APPROVE; reproduced counterfactual (c) (roll-ups leak into the assistant with CI green — follow-up assertion recorded above); assistant replay artifact equals the 57ff2bf baseline. Minors accepted: typed casts in `codeRollups`; extra test artifact.
