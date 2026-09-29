# X-2026-09-29-explanatory-summary task run

## Current state (as of 2026-09-29)

- Stage: closed (desk). Stages 1–3 APPROVE — commits 9d61518, 9e09c19, Stage 3 below. Waiting for the owner's phone summary run.
- Spec: `docs/specs/X-2026-09-29-explanatory-summary.md` (Stage 1 shared ratings + reportFacts split; Stage 2 summary v2, adapter v5, judging-word rule; Stage 3 summary output cap 2,048).
- Repairs: 0/2. Escalations: 0.
- Verdicts: Stages 1, 2 and 3 APPROVE (2026-09-29); full `pnpm check` reproduced PASS.
- Decisions in effect (owner, 2026-09-29): the summary should explain what each item is, why a used-EV buyer cares, and whether it is good or bad, for people who do not understand the app's screens. Mix approach: general knowledge for what/why/what-next; the good/bad verdict only from the app's own deterministic ratings and their basis, "not rated" otherwise. Format: a one-line overall takeaway, then 2–3 sentences per area (state of charge, cell balance, capacity, 12 V, codes).
- Owner authorizations: this change; 2026-09-29 answers: build now, thresholds task next; 28-word list accepted. No paid call; the owner re-runs the phone summary afterwards.
- NOT RUN: owner phone summary run (v5 prompt, 2,048 cap). Expected: displayCategory llm, a takeaway, five sections whose Rating lines match the cards.
- Blocker: none. Implementation must follow X-2026-09-29-summary-placeholders Stage 4 (both edit `tools/summary-backend/openrouter.ts`).
- Next action: owner phone summary run; then open the thresholds task (cell balance, 12 V) and fold in the `codeList` duplicate.

## Baseline

HEAD `d24b369`; working tree: `.claude/agents/*`, `docs/task-runs/{T2.10,T2.12,X-2026-09-29-relay-recording-encoding,X-2026-09-29-summary-placeholders}.md` (records).

## Touched files

None yet.

## Verification evidence

None yet.

## Review findings

None yet.

## Log

- 2026-09-29 preflight (Claude orchestrator): record created after the passing D1 phone run (`docs/task-runs/T2.10.md`).
- 2026-09-29 architect (Claude): spec written; ratings exist only in the app today (codes only); owner answered both open questions.
- 2026-09-29 implementer Stage 1 (Claude): report-view 16/16 unchanged; report-view artifact and summary/assistant replay artifacts identical to baselines; counterfactual (OK basis string mutated in `rating.ts`) fails 5 report-view cases; obd-assist 260, mobile 403; pnpm check parts green (eslint red only on the owner's `.wrangler/tmp`).
- 2026-09-29 reviewer Stage 1 (Claude): APPROVE; reproduced the basis-string counterfactual and the replay baselines from fc89bd4. Minor follow-up: `codeList` is duplicated in `apps/mobile/src/app/reportView.ts:52` and `packages/obd-battery/src/rating.ts:15`; export it from rating.ts before any thresholds work changes code counting.
- 2026-09-29 implementer Stage 2 (Claude): items 1–15 PASS (obd-assist 285, mobile 410, worker 4/4); full `pnpm check` PASS. Rendered spike text in `/tmp/x-explanatory-spike.json`. Counterfactuals (plain copy): (a) delete verdict loop `check.ts:86-88` → 6 S, 3 M, Worker `verdict-contradicts-rating`; (b) substring match → `verdict-substring-boundary`; (c) delete rating-ID rule `check.ts:84` → `rating-fact-cited`, `rating-basis-cited`, 2 M, Worker; (d) constant rating line `check.ts:113` → 2 S, 3+2 M; (e) delete `checkFacts` `check.ts:97` → `v2-digit-outside`, `v2-uncited-placeholder`, 3 M, Worker; (f) render from the handed request → the M tampering pair. Deviations: claims artifact promptVersion; sentinel spelling for the verdict case; Worker reservation bound ≤ 9000 (measured 6,968–7,437); common reply for per-recording checks; T2.10c SummaryUsage literals; test restructuring.
- 2026-09-29 reviewer Stage 2 (Claude): APPROVE; rendered spike text identical to the spec; reproduced counterfactuals (a), (b), (f); v1 corpus 192 cases unchanged. Minors folded into Stage 3 by the orchestrator: (1) restore the projection privacy assertion (path, scan time, header, VIN) on the v2 request in `summary-replay.test.ts`; (2) record the `reportSummary` card rating and basis beside each view in the phone-flow artifact.
- 2026-09-29 implementer Stage 3 (Claude): items 1–5 and A/B PASS; full `pnpm check` PASS. Reservations 7437→8666 (spike), 6968→8196 (phone-console); status threshold 41780→43008. Counterfactuals (plain copy): cap 1024 → `worker.test.ts:389`; body max_tokens → `:553`; kill threshold → `:709`; preflight floor → `:473`; assistant given the summary cap → `:803`; global 2048 → `:803`, `:1189`, `:1201`; phone cap 1024 → 3 usage cases, 4096 → the 2049 case; privacy leak → 23 saved-reply cases. Deviations: added `assistant-output-1025-kill`; extra T2.10c lines; reservation-spec wording; README figures; artifact field split; per-pin 2047 preflight cases.
- 2026-09-29 reviewer Stage 3 (Claude): APPROVE; reproduced counterfactual (a) at `worker.test.ts:389`; arm A keeps 1,024 on the assistant route; DeepSeek endpoint advertises 393,216, so the 2,048 floor cannot block it. Minors: the 315,802 upper-bound claim now holds only through `maxSummaryBodyBytes` (fixed in T2.10c and README by the orchestrator); stale status-bound comment `openrouter.ts:12` (fixed by the orchestrator); duplicate unit lines `worker.test.ts:1195-1196` (accepted).
