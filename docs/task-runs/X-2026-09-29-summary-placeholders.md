# X-2026-09-29-summary-placeholders task run

## Current state (as of 2026-09-29)

- Stage: closed (desk). Stages 1–4 APPROVE — commits 6f5340c, 2e72c73, 6f107cd, d24b369, Stage 4 below. Owner D1 phone re-run PASS (b6640624).
- Spec: `docs/specs/X-2026-09-29-summary-placeholders.md` (Stage 1 failed-check category, 2 placeholders and rendering, 3 summary prompt v4, 4 assistant t2.11-v2).
- Repairs: 1/2. Escalations: 0.
- Verdicts: Stage 1 APPROVE after repair 1; Stage 2 APPROVE; Stage 3 APPROVE; Stage 3b APPROVE (2026-09-29); full `pnpm check` reproduced PASS for both.
- Decisions in effect (owner, 2026-09-29): (1) the model never writes numeric values; it writes placeholders naming fact IDs and the app renders the exact value and unit from the report; prose stays checked. (2) Record which check failed as a category only (for example `invalid-response:facts`), never reply text.
- Owner authorizations: this change; 2026-09-29 build all four stages; hedging words around placeholders allowed (left to semantic grading). No paid call; the owner re-runs the D1 phone gate afterwards.
- NOT RUN: T2.11b paid four-arm run (owner go-ahead; tracked in docs/task-runs/T2.11.md).
- Blocker: none. X-2026-09-29-twelve-volt-name Stage 2 is on hold until this spec decides whether it is superseded.
- Next action: none for this task. Follow-ups: guard that summarize renders from the rebuilt projection; remove the dead `checkSummary` export; T2.11c prompt renamed to `t2.11-v3` (done by the orchestrator).

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
- 2026-09-29 implementer Stage 2 (Claude): items 1–13 PASS (obd-assist 257, mobile 100 flow, worker 4/4); full `pnpm check` PASS. Counterfactuals (disposable worktree): (a) `check.ts:16` PLACEHOLDER=/(?!)/g → 19 obd-assist failures incl. `placeholder-real-values` and the mobile 12.7/12.8 case; (b) delete `check.ts:21` uncited check → 1 failure `placeholder-uncited`; (c) `check.ts:26` ASCII-only digit test → 10 failures (non-ASCII numeral cases); (d) `check.ts:36` value without unit → 15 failures; (e) `check.ts:33` first cited fact for every placeholder → 4 failures; (f) `summary.ts` raw model text instead of `renderClaims` → 15 failures plus the mobile case. Deviations: `cites-session-never-fetched` not rewritten; `no-soc-charge-log-claims-estimate` rewritten; M pair is one test with two rows; Worker saved-case additions; `checkSummary` still exported; fixture label extended.
- 2026-09-29 reviewer Stage 2 (Claude): APPROVE; reproduced counterfactuals (b), (c), (e), (f); baseline diffs show only the four planned flips and added cases. Minors for follow-up: no test guards that `summarize` renders from the rebuilt projection rather than the request handed to the client (`summary.ts:70-72`); `checkSummary` is a dead public export (`summary.ts:63`, `index.ts:6`).
- 2026-09-29 implementer Stage 3 (Claude): items 1–3 PASS; full `pnpm check` PASS (mobile 403). Counterfactuals: (a) `openrouter.ts:70` grammar removed → `endsWith(claimGrammar)` fails; (b) old "Label: value unit" line inserted → `worker.test.ts:530` fails; (b2) appended after the grammar → `worker.test.ts:529` fails; (c) phone accepts v3 → `summary-flow.test.ts` "drops malformed usage 21" fails. Deviations: real-recording reservation lower bound 6000 → 5000 (v4 prompt ~1.2 KB shorter, reservation 5530); literal-equality assertion on `claimGrammar`.
- 2026-09-29 reviewer Stage 3 (Claude): APPROVE; reproduced counterfactual (c). Must settle before the D1 re-run: (1, spec-level) `openrouter.ts:67` still says "Cite known unique fact IDs only in factIds, never in text", contradicting `claimGrammar` and the edited T2.10c text; (2, risk) the source-identifier guard (`check.ts:30`) rejects prose containing a fact ID as a substring, so "the twelve-volt battery" fails when the report has the bare `twelve-volt` fact. Accepted: real-recording reservation lower bound 6000 → 5000.
- 2026-09-29 architect Stage 3b (Claude): delete the prose fact-ID guard, fix the reply-shape line and trim claimGrammar; prompt stays v4. Orchestrator read-only precondition: ledger unchanged (uses 5, five rows). Owner accepted ID words in prose.
- 2026-09-29 implementer Stage 3b (Claude): items 1–4 PASS (obd-assist 260, worker 4/4, mobile flow 101); full `pnpm check` PASS. Baseline diffs: spike only the `placeholder-id-in-prose` flip plus `id-underscore-in-prose`; phone-console only the two new llm cases. Counterfactuals: (a) guard restored at `check.ts:30` → exactly `placeholder-id-in-prose`, `prose-twelve-volt-battery`, `prose-twelve-volt-battery-status`, Worker `real-recording-twelve-volt-prose` fail; (b) old reply-shape sentence → `worker.test.ts:528`; `never in text` appended elsewhere → `worker.test.ts:537`.
- 2026-09-29 reviewer Stage 3b (Claude): APPROVE; reproduced counterfactual (a) and one variant of (b); confirmed all six Equinox signal IDs contain `_`, so only the nine digit-free IDs can appear in prose. Minor: the assistant prompt (`assistant.ts:46`) still says "never in text" until Stage 4.
- 2026-09-29 implementer Stage 4 (Claude): items 1–3 PASS (obd-assist 260, worker 4/4); pnpm check parts green, full run red only at eslint on the owner's `.wrangler/tmp`. Counterfactuals: (a) raw-claims scorer → `assistant-replay.test.ts:159`, `:163` (q07 missingHonest false); (b) old `assistant.ts:46` line → `assistant-replay.test.ts:135`, `worker.test.ts:773`; (c) old quantity line instead of claimGrammar → `assistant-replay.test.ts:134`, `worker.test.ts:771`; (d) Worker v1-only → `worker.test.ts:732`, v1+v2 accepted → `:733/:836`; (e) eval header v1 → `worker.test.ts:979`, replies literal v1 → `:1020`. Baseline diff: only promptVersion, instructions text and q07 displayed text.
- 2026-09-29 reviewer Stage 4 (Claude): APPROVE; reproduced counterfactual (a). Minors: T2.11a:90 wording and T2.11c version clash fixed in place by the orchestrator; duplicate prompt assertions (`assistant-replay.test.ts:133-135`, `worker.test.ts:771`) accepted.
