# X-2026-09-29-summary-wording-polish: plain status words and mid-sentence reasons in the summary

Record: `docs/task-runs/X-2026-09-29-summary-wording-polish.md`. Size S, one stage, ten files. Written against HEAD `29b2959`: summary `t2.10-v3`, adapter `t2.10-openrouter-v6`.

## Goal

The owner's passing explanatory-summary run (`docs/task-runs/T2.10.md`, last entry, request `498a2d47…`) displayed raw status tokens and capitalised full-sentence reasons in the middle of the model's sentences. Examples: "reports capacity as not-measured", "status is not-assessed", "the recently-cleared check was not-indicated", "a buyer would need No completed charge log…", and "the reason given is that In-car adapter…". These values come verbatim from the summary projection (`prepareSummaryRequest`) through `renderSummary`.

After this task, the summary projection sends display forms for the status and reason facts, and `renderSummary` applies two sentence rules to each rendered claim. As a result:
- status values render as plain words ("not measured", "not assessed", "not indicated");
- reason values render as clauses that start in lower case, with no final period;
- a claim that starts with a placeholder still starts with a capital letter;
- every claim ends with sentence punctuation.

The prompt (`t2.10-v4`, adapter `t2.10-openrouter-v7`) gets one sentence telling the model to introduce a reason with "because" or a colon.

Test-visible outcome: a synthetic reply that copies the owner run's phrasing, run through `summarize` on the spike report, displays exactly the text in Verification item 2. The same checks pass in the Worker and phone flows on all three redacted recordings, which display "Capacity was not measured: no completed charge log and reviewed capacity estimator are available." and "The twelve-volt battery status is not assessed."

## Non-goals

- No change to the checker: `checkClaim`, `checkFacts`, `checkAreaClaim`, `verdictWords`, the rating-fact rule, `claimGrammar`, `areaSummarySchema`, and the Worker bounds (512 / 16 / 1–3). Owner decision, see the record.
- No change to `reportFacts`, `renderClaims`, the assistant, `t2.11-v2` or its saved replies. The assistant keeps the raw values; see Decision P1.
- No change to the report, `renderBatteryDiagnosis`, the app's report screens or rating cards, or `reportRatings` basis strings. For example, the basis "the recently-cleared check says no" stays as written.
- No rewording of report reasons into noun phrases. No per-reason mapping table.
- No grammar repair of model prose. "would need {fact:capacity-reason}" still yields an awkward sentence; the prompt addresses that, and Risks records it.
- No change to the per-module code facts, which are not in the summary projection, or to the roll-up values, which are already plain.
- No change to consent, the output cap, pins, the ledger or budget policy. No paid call.
- Thresholds and the "Not rated" areas are deferred by the owner.

## Decisions

Owner, 2026-09-29 (record): polish only. (1) Status values render as plain words. (2) Reason facts read cleanly mid-sentence. No change to the checker's rules.

Architect choices:
- **P1. Display forms live in the summary projection only.** `prepareSummaryRequest` maps the reportFacts-derived facts through a private `displayFact`. Facts outside the two ID sets below pass through unchanged. Reasons:
  - The model sees the plain words and the lower-case clause, so it writes around them. A render-time-only formatter would still show the model "not-measured", and the model might copy that into prose.
  - The checker and the renderer both read the projection, so no new code path is needed.
  - `reportFacts` stays raw. The assistant (`get_session`, `get_codes`, `get_capacity_estimate` on a scan) keeps "not-measured" and "No completed…". Its prompt already names "NOT MEASURED, not read or not assessed", and its trace assertions (`assistant-replay.test.ts`, the `s1/capacity-status=not-measured` lines) and saved replies stay valid. **The assistant does not see the display forms.**
  - Each fact keeps its `status` field, which already holds the raw token for every status fact. The report object and the app screens never read the projection.
- **P2. The formatter.** There are two fixed ID sets:
  - Status IDs `capacity-status`, `health-status`, `twelve-volt-status`, `codes-recently-cleared`: the value becomes `value.replaceAll("-", " ")`. The report enums are `not-measured`, `not-assessed`, `indicated`, `not-indicated` and `unknown` (`obd-battery/src/report.ts` lines 25–26, 44, 51–52), so the display words are "not measured", "not assessed", "indicated", "not indicated" and "unknown". None of these is one of the 28 `verdictWords`, and none contains a digit.
  - Reason IDs `capacity-reason`, `health-reason`, `twelve-volt-reason`: lower-case the first character and remove one final `.`.
    - The internal wording is unchanged. So are the digits of the rested-OCV 12 V reasons (`twelve-volt.ts` lines 67 and 74, where values render only through placeholders).
    - Today's reasons start with "No", "A", "In-car" and "Independent". None starts with an acronym, so there is no acronym guard (hard rule 10). A future reason that starts with an acronym would need one.
- **P3. Two sentence rules in `renderSummary` (summary display only).** Each rendered claim, including the takeaway:
  - gets its first character upper-cased if it is a lower-case letter, so a claim that starts with `{fact:health-reason}` reads as a sentence;
  - gets a `.` appended if it does not end in `.`, `!` or `?`. This is needed because P2 removes the reason's own final period, and existing replies end claims with a bare `{fact:capacity-reason}`.

  The two rules apply after rendering, never to the checked text, so the checker's input is unchanged. They are not added to `renderClaims`, which the assistant and the v1 claim corpus share.
- **P4. One prompt sentence, not formatting alone.** No deterministic form fits every sentence a model might write. A clause after "would need" is ungrammatical in any casing. The deterministic part (P2, P3) removes the stray capital and the doubled or missing period. The prompt sentence steers where the clause goes. No checker rule is added (owner decision).
- **P5. Versions bump:** summary `t2.10-v3` → `t2.10-v4`, adapter `t2.10-openrouter-v6` → `t2.10-openrouter-v7`. Both the projection values and the instructions change, and the ledger's prompt version must tell runs apart (hard rule 11 provenance). The phone and the Worker accept only v4/v7. The reply shape stays `version: 2`. Consent is unchanged: the data is the same, only its spelling differs.

## Interfaces

```ts
// packages/obd-assist/src/summary.ts
export interface SummaryRequest { version: 1; promptVersion: "t2.10-v4"; facts: readonly SummaryFact[] }   // was "t2.10-v3"
function displayFact(item: SummaryFact): SummaryFact;   // private, P2
export function prepareSummaryRequest(report): SummaryRequest;
//   facts: [...reportFacts(report).filter(<unchanged>).map(displayFact), ...codeRollups(report), ...ratingFacts]
// reportFacts, codeRollups, checkSummary, summarize: unchanged signatures and behaviour

// packages/obd-assist/src/check.ts
export function renderSummary(facts, summary): string;   // signature unchanged; P3 applied inside `render`
```

`summaryInstructions` (exact). Relative to v3 there are two edits: the version tag, and a new fifth line after the `{label:ID}` line:
```
Summary prompt version: t2.10-v4. Explain this battery check …            (line 1, only the tag changes)
… (lines 2–4 unchanged) …
A reason fact is a clause that starts in lower case: introduce it with "because" or a colon, as in: Capacity was not measured because {fact:capacity-reason}.
The app prints each area's own rating … (unchanged)
```

Version literals, `t2.10-v3` → `t2.10-v4` and `t2.10-openrouter-v6` → `t2.10-openrouter-v7`, at the same sites the claim-split spec lists (Interfaces there):
- `check.ts` `requestSchema`;
- `replay-summary.ts` `ReplayArtifact` and its two values;
- `openrouter.ts`: the `adapterInstructions` line, `SummaryUsage` and the usage literal;
- `worker.ts` `requestSchema`;
- `summaryAccess.ts` `DevelopmentUsage` and `projectUsage`.

## Files

- `packages/obd-assist/src/summary.ts`: `displayFact`, the projection `.map`, the v4 instructions and literal.
- `packages/obd-assist/src/check.ts`: the P3 rules in `renderSummary`; the `requestSchema` literal.
- `packages/obd-assist/scripts/replay-summary.ts`: the literal. It also adds a `report: "synthetic-not-indicated-no-recording"` variant to `reportForSavedCase`, which sets `codes.recentlyCleared.verdict` to `not-indicated`. This mirrors the derived case in `apps/mobile/test/report-view.test.ts` and is labeled synthetic.
- `packages/obd-assist/test/summary-replay.test.ts`: a new describe block. The explanatory and claim-split expected texts change only as listed in item 5, and the `promptVersion` assertions become v4.
- `fixtures/synthetic/x-2026-09-29-summary-wording-polish-responses.json`: create. Label: `SYNTHETIC hand-written v4 summary replies reproducing the owner's 2026-09-29 run phrasing (request 498a2d47); not recorded model output`.
- `tools/summary-backend/openrouter.ts`: the v7 literals.
- `tools/summary-backend/worker.ts`: the `requestSchema` literal.
- `tools/summary-backend/worker.test.ts`: the v7 prompt assertion; `t2.10-v3.` and `t2.10-openrouter-v6` join the stale lists; a v3 request → 400; the polished-line assertions (item 3).
- `apps/mobile/src/summaryAccess.ts`: accept only v4/v7.
- `apps/mobile/test/summary-flow.test.ts`: `validUsage` becomes v4/v7; usage naming v3 or v6 → `null`; the polished-line assertions (item 3).
- In-place literal edits (docs): `tools/summary-backend/README.md` line 42 (if it names the adapter version), and `docs/specs/T2.10a-summary-contract-replay.md` line 24, `T2.10c-hosted-deepseek-eval.md` lines 30, 31 and 78, `T2.10d-mobile-rewarded-summary.md` line 70. Leave the `X-` specs as they are.

New dependencies: none.

## Sources

| Constant / behavior | Source |
|---|---|
| Owner-run phrasing, codes "Good", 12 V "Not rated", request `498a2d47…` | `docs/task-runs/T2.10.md` last entry; this task's record |
| Status enums, capacity and health reason text | `packages/obd-battery/src/report.ts` lines 25–26, 44, 51–52, 89 |
| 12 V reason text (adapter; rested variants) | `packages/obd-battery/src/twelve-volt.ts` lines 51, 67, 74 |
| Codes rating and basis for `not-indicated` | `packages/obd-battery/src/rating.ts` `codesRating` |
| Projection and rendering paths; `renderClaims` shared with assistant and v1 corpus | `packages/obd-assist/src/summary.ts`, `check.ts`, `assistant.ts` lines 5–6, 80, 101, 113, 192; `scripts/replay-summary.ts` `createClaimReplayArtifact` |
| 28 judging words | `check.ts` `verdictWords` |
| Spike codes: `recentlyCleared` `unknown`, roll-up values; SoC 69.8039 percent; adapter 12.7 V | `x-2026-09-29-summary-claim-split` Verification item 2 over `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl` |
| Reservations at v3: 7,767 spike, 7,257 phone-console | `docs/task-runs/X-2026-09-29-summary-claim-split.md` implementer entry |

No PID, AT command, header, scaling or DTC constant is introduced.

## Verification

**Shared** (as in the claim-split spec's Shared section):
- The tests are E2E through public entry points:
  - S: `summarize` via `createSummaryReplayArtifact` on the spike report.
  - W: the Worker over HTTP, with a synthetic upstream and local D1, on spike, spike-2 and phone-console.
  - M: `createDevelopmentSummaryFlow` on the same three recordings.
- Nothing is mocked except the upstream. No test contacts `openrouter.ai`. Every reply is synthetic.
- Write the new cases before changing code.
- Save baselines of `/tmp/t2.10a-summary-replay.json`, `/tmp/x-twelve-volt-name-summary.json`, `/tmp/t2.11a-assistant-replay.json`, `/tmp/x-explanatory-spike.json` and `/tmp/x-claim-split-spike-test.json`. Compare content, never hashes.
- Run counterfactuals in a disposable worktree (`/tmp/x-wording-polish-cf`), and name the mutation and the failing cases. A compile error is not proof.
- Finish with `pnpm check` and `git diff --check`.

**Fixture cases.** All are built from `claim-split-accepted` (`fixtures/synthetic/x-2026-09-29-summary-claim-split-responses.json`), copied into the new file with only these changes:
- `polish-owner-phrasing`, `report: "synthetic-not-indicated-no-recording"`:
  - capacity claims:
    1. `This check reports capacity as {fact:capacity-status}.` [`capacity-status`]
    2. `To know more, a buyer would need {fact:capacity-reason}.` [`capacity-reason`]
    3. `{fact:health-reason}` [`health-reason`]
  - twelveVolt claims:
    1. unchanged
    2. `The twelve-volt status is {fact:twelve-volt-status}` [`twelve-volt-status`]
    3. `The reason given is that {fact:twelve-volt-reason}` [`twelve-volt-reason`]
  - codes claim 3: `{label:readiness}: {fact:readiness}; the recently-cleared check was {fact:codes-recently-cleared}.` [`readiness`, `codes-recently-cleared`]
- `polish-prompt-form`: `polish-owner-phrasing` with capacity claim 2 replaced by `It was not measured because {fact:capacity-reason}.`

**Failure modes, then checks.**
1. **Display forms are wrong or leak.**
   - S asserts that the spike v4 projection has these values:
     - `capacity-status` `not measured`;
     - `health-status` and `twelve-volt-status` `not assessed`;
     - `codes-recently-cleared` `unknown`;
     - `capacity-reason` `no completed charge log and reviewed capacity estimator are available`;
     - `health-reason` `a single scan and community cell readings cannot establish battery health`;
     - `twelve-volt-reason` `in-car adapter and control-module supply voltage are not rested battery-terminal measurements; a load test or service assessment is needed for battery health`.
   - Their `status` fields are unchanged (`not-measured`, `not-assessed`, `unknown`, `available`, `missing`).
   - No other fact differs from `reportFacts` or the roll-ups. The fact count stays 28.
   - `reportFacts(report)` returns the raw values for the same IDs.
   - No status display value contains a `verdictWords` run or a digit.
2. **The owner's phrasing still renders robotically.** S `polish-owner-phrasing` → `llm` with exactly:
   ```
   This parked check read the charge level, cell voltages, the supply voltage and trouble codes, but it cannot measure how much capacity the battery has left.

   State of charge
   Rating: Not rated. Basis: The app does not rate state of charge.
   State of charge is how full the high-voltage battery is, like a fuel gauge. This check read SoC: 69.8039 percent. It shows the charge at the time of the check, not the battery's condition.

   Cell balance
   Rating: Not rated. Basis: No threshold yet.
   Cell balance compares the highest and lowest cell voltages. A wide gap can point to a cell group that ages faster. Here the Cell spread is 0.003 volts, a community reading.

   Capacity
   Rating: Not rated. Basis: No threshold yet.
   This check reports capacity as not measured. To know more, a buyer would need no completed charge log and reviewed capacity estimator are available. A single scan and community cell readings cannot establish battery health.

   12 V battery
   Rating: Not rated. Basis: No threshold yet.
   The twelve-volt battery powers the car's computers and wakes the high-voltage system. The twelve-volt status is not assessed. The reason given is that in-car adapter and control-module supply voltage are not rested battery-terminal measurements; a load test or service assessment is needed for battery health.

   Diagnostic codes
   Rating: Good. Basis: Project policy: no codes reported, and the recently-cleared check says no.
   Stored diagnostic codes: none (5 of 5 modules read). Pending diagnostic codes: none (5 of 5 modules read); Permanent diagnostic codes: none (3 of 5 modules read). Readiness status: 5 of 5 modules read; the recently-cleared check was not indicated.
   ```
   The "would need" sentence is a documented boundary (P4), not a defect.
3. **The prompt form or the real recordings do not render cleanly.**
   - S `polish-prompt-form`: the capacity claim line is exactly `This check reports capacity as not measured. It was not measured because no completed charge log and reviewed capacity estimator are available. A single scan and community cell readings cannot establish battery health.` It has no `..`.
   - W and M `claim-split-common` on all three recordings → `llm`. The capacity section's claim line is exactly `Capacity was not measured: no completed charge log and reviewed capacity estimator are available.`, and the 12 V line is exactly `The twelve-volt battery status is not assessed.`
   - No displayed summary text in W or M contains `not-measured`, `not-assessed` or `not-indicated`.
4. **The assistant or the v1/12 V corpora change.** `/tmp/t2.11a-assistant-replay.json`, `/tmp/t2.10a-summary-replay.json` and `/tmp/x-twelve-volt-name-summary.json` equal their baselines apart from the `promptVersion` line. `assistant-replay.test.ts` passes unedited.
5. **Existing summary texts regress.** Compared with the baselines, the explanatory and claim-split S artifacts differ only in:
   - `It was not measured: No completed…` → `no completed…` (the period stays);
   - the `twelve-volt-status` / `capacity-status` hyphens, wherever a case renders them;
   - `promptVersion`.

   Every template/llm kind is unchanged. `apps/mobile/test/report-view.test.ts` passes unedited.
6. **Prompt or version drift.**
   - W asserts the system message equals `[summaryInstructions, "Adapter prompt version: t2.10-openrouter-v7. …", replyShape, claimGrammar].join("\n")`, and that `summaryInstructions` contains the P4 sentence verbatim.
   - `t2.10-v3.` and `t2.10-openrouter-v6` are absent.
   - A W request with `t2.10-v3` → 400 `invalid-request` with no D1 row.
   - M usage naming `t2.10-v3` or `t2.10-openrouter-v6` → `null`.
7. **Budget.** The existing W reservation band (below 8,666 and at least 7,000) still holds. Record the new spike and phone-console reservations against 7,767 / 7,257.

Commands:
```bash
pnpm -F obd-assist test
node --import tsx packages/obd-assist/scripts/replay-summary.ts fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl fixtures/synthetic/x-2026-09-29-summary-wording-polish-responses.json > /tmp/x-wording-polish-spike.json
pnpm vitest run tools/summary-backend/worker.test.ts      # /tmp/t2.10c-local-e2e.json
pnpm -F mobile test -- summary-flow.test.ts report-view.test.ts   # /tmp/t2.10d-mobile-flow.json
pnpm check && git diff --check
```
Reviewer artifacts:
- `/tmp/x-wording-polish-spike.json`: items 2 and 3.
- `/tmp/t2.10c-local-e2e.json` and `/tmp/t2.10d-mobile-flow.json`: item 3 lines, the v7 message, the reservations.
- The four baseline comparisons: items 4 and 5.

Counterfactuals, each with its expected failure:
- (a) Remove the status `replaceAll`: items 1–3 fail.
- (b) Remove the lower-casing: items 1–3 fail.
- (c) Keep the reason's final period: `polish-prompt-form` shows `available..`.
- (d) Remove the appended period: the item 2 12 V line fails.
- (e) Remove the capitalisation: the item 2 capacity line starts `a single`.
- (f) Apply `displayFact` inside `reportFacts`: `assistant-replay.test.ts` fails on its `s1/capacity-status=not-measured` trace, and item 4 differs.
- (g) The phone also accepts v6: item 6 M fails.

**NOT RUN, optional, owner only.** A phone re-run after commit: restart `wrangler dev` to load the v7 prompt, and reload the dev client. Expected: `displayCategory` `llm`, no hyphenated status tokens, and lower-case reasons introduced by "because" or a colon. Cost is about US$0.001. It needs the owner's phone, not the vehicle.

## Risks / open questions

- **Prompt compliance for reason placement (P4).** If the model still writes "would need {fact:capacity-reason}", the sentence reads awkwardly, though without the stray capital. The deterministic alternatives are rewriting the reasons as noun phrases, which is a report-wording change, or a checker rule, which the owner excluded. Either needs the owner if the re-run shows it.
- **Raw tokens remain visible to the model** in each fact's `status` field (`not-measured`). The model could copy one into prose. It is low risk and cosmetic; removing `status` from the projection would change the request contract.
- The lower-casing assumes no reason starts with an acronym, which is true today (P2).

No open questions for the owner.
