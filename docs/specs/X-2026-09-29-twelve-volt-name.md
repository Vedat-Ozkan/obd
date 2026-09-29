# X-2026-09-29-twelve-volt-name: accept "12 V" as a system name, never as a reading

Record: `docs/task-runs/X-2026-09-29-twelve-volt-name.md`. Size S, in two stages (file limit). **Stage 1 goes first** because it unblocks the owner's D1 phone re-run. Stage 2 then brings the assistant prompt in line with the shared checker.

## Goal

The owner ran the D1 phone re-run on 2026-09-29 (`docs/task-runs/T2.10.md`, last Stage history entry). DeepSeek flash returned JSON of the right shape, but `checkSummaryFacts` rejected it with "summary claim has an unsupported quantity or DTC body". Two claims caused the rejection: `12 V observations were not read.` and `12 V battery status was not-assessed.` In both, "12 V" names the low-voltage system; neither is a reading. Because the claims contain digits, they lose the prose route (T2.10a exact grammar, rule 7) and then match no quantity body.

After this task:
- The shared checker (`checkFacts`, which serves both the summary and the assistant) accepts exactly two name phrases, `12 V battery` and `12 V observations`, inside prose that has no other numeric characters, and only when the claim cites a fact whose label contains `12 V`.
- Every reading still has to match an accepted body exactly. The checker still rejects:
  - `The 12 V battery measured 12 V.`
  - `The 12 V battery reads 12.0 V.`
  - `The 12 V battery reads 12.7 V.`
  - `12 V` followed by any word outside the list.
- The summary adapter prompt (Stage 1) and the assistant adapter prompt (Stage 2) tell the model to use those phrases.

Test-visible outcome: a labeled synthetic reconstruction of the quoted DeepSeek claims, replayed against the real phone-console recording through public `summarize` (and, in Stage 2, `askAssistant`), is displayed as LLM text. The false-reading cases fall back to the template. Two counterfactual mutations of the checker each make a named case fail.

## Non-goals

- No change to `summaryInstructions` or `SummaryRequest.promptVersion` (`t2.10-v1`). No change to `assistantInstructions`, `AssistantTurnRequest.promptVersion` (`t2.11-v1`), the reply schemas, the projection, or the fact labels.
- No other relaxation of the grammar:
  - no name phrases inside numeric/DTC claims (T2.10a rule 6 is unchanged);
  - no `12 V system`, `12 V supply`, `12V`, plurals or possessives;
  - no numeric tolerance and no new compatibility bodies.
- No change to the T2.11a `missingHonest` scorer (`replay-assistant.ts`, its `/[0-9]/` test). See Risks.
- No change to the Worker, ledger, consent, pins, reservation or bounds, and no public API change.
- No paid call. The D1 phone re-run and any live assistant rows belong to the owner and stay NOT RUN.

## Decisions

Owner, 2026-09-29 (record): "12 V" is accepted only inside fixed name phrases, never as a reading. The prompt tells the model to use those phrases. Readings stay exact-match only.

The architect made the following choices within that answer:

1. **The closed list is `12 V battery` and `12 V observations`.** Both come from the report's own text (Sources). The label `12 V battery status` and the template line `12 V battery health` give `battery`; the label `12 V observations` and the report heading give `observations`. Two words were left out on purpose:
   - `12 V supply`, although it appears in the observation label `adapter-supply 12 V supply`. That fact always carries a reading, which the model must state with the existing exact bodies. Allowing the phrase would also let a false reading through, such as `The adapter reported 12 V supply voltage.`
   - `12 V system`, which no report text uses.
2. **A citation is required.** The phrase allowance applies only when at least one cited fact's label contains `12 V`. The check uses the label, not the ID, so it also works for the assistant's prefixed IDs (`s2/twelve-volt`). This follows the existing pattern, where compatibility bodies require their own fact.
3. **The rule sits in the prose route only** (Interfaces). A claim that still contains any numeric character after its name phrases are reduced is checked in full, on its original text, by the unchanged rule 6. The name allowance therefore cannot help a reading pass.
4. **Summary prompt: the adapter moves to `t2.10-openrouter-v3`.** The rule is one added line in `adapterInstructions`. `summaryInstructions` and `t2.10-v1` stay as they are, following X-2026-09-29-deepseek-json-mode Decision 5. The phone accepts only `t2.10-openrouter-v3`, because the Worker never serves v2 again.
5. **Assistant prompt: the adapter preamble moves to `t2.11-openrouter-v2`, and `assistantInstructions` (`t2.11-v1`) stays unchanged.** The same line is added to `assistantAdapterInstructions`. This keeps the package prompt, the frozen question set and the replay artifact unchanged. No live T2.11b rows exist, so the frozen-prompt rule is not engaged.

Orchestrator, 2026-09-29, answering the optional citation question from the owner's own diagnostic output (printed in the owner's terminal and pasted into the session, not saved): the claim "12 V observations were not read." cited `["twelve-volt"]` (label "12 V observations") and "12 V battery status was not-assessed." cited `["twelve-volt-status"]` (label "12 V battery status"). Both cited facts carry a `12 V` label, so the citation condition holds for the observed reply.

## Interfaces

Public signatures are unchanged. `checkClaim` in `packages/obd-assist/src/check.ts` changes internally, in this order:

1. The source-identifier guard runs first, unchanged.
2. **Name reduction** (new). This step runs only if some cited fact's `label` contains `12 V`. A *name occurrence* is the exact ASCII text `12 V battery` or `12 V observations` that meets both conditions:
   - it is at the start of the claim, or immediately preceded by an ASCII space or `(`;
   - it is at the end of the claim, or immediately followed by one of: ASCII space, `.`, `,`, `;`, `:`, `!`, `?`, `)`.

   Each name occurrence is replaced by its noun alone (`battery` / `observations`), giving the reduced text `R`. If no fact is cited with a `12 V` label, `R` is the original text.
3. If `R` matches the existing prose regex, the claim is accepted as prose.
4. Otherwise the existing rule-6 path runs on the **original** text, unchanged. That path covers whitespace and characters, complete bodies and the terminal period.

The list is a module-private constant (`const TWELVE_VOLT_NAMES = ["battery", "observations"]` or equivalent). It is not exported and not configurable.

Prompt line, identical in both adapter prompts. It goes after the "Digit-free prose may contain…" line in `adapterInstructions` and at the end of the `assistantAdapterInstructions` preamble:

```
The 12 V system may be named only as 12 V battery or 12 V observations (exactly this spelling), only in otherwise digit-free prose, and only in a claim citing a fact whose label contains 12 V. A name is never a reading: state any voltage only with the exact bodies above, in a separate claim.
```

In the assistant preamble, "the exact bodies above" refers to the grammar in `assistantInstructions`, which follows the preamble. The implementer may change it to "the exact bodies below" there. No other wording changes.

## Files

**Stage 1** (checker, summary prompt, phone literal), nine files plus two in-place spec edits:
- `packages/obd-assist/src/check.ts` — modify: name reduction in the prose route.
- `fixtures/synthetic/t2.10-summary-responses.json` — modify: add the spike-report cases in Verification.
- `fixtures/synthetic/x-2026-09-29-twelve-volt-name-responses.json` — create: `{label, cases}` in the existing `SavedSummaryCase` shape. It holds the phone-console reconstruction and its false-reading control. The label reads "SYNTHETIC reconstruction of claims quoted in docs/task-runs/T2.10.md; not recorded model output".
- `packages/obd-assist/test/summary-replay.test.ts` — modify: add the new names to `expectedKinds`. Add a second `describe` that replays the phone-console recording with the new fixture, asserts the exact kind and text for each case, and writes `/tmp/x-twelve-volt-name-summary.json`.
- `tools/summary-backend/openrouter.ts` — modify: the prompt line, and `t2.10-openrouter-v2` → `v3` (header text, `SummaryUsage` type, usage literal).
- `tools/summary-backend/worker.test.ts` — modify: the v3 literals, and assert that the sent system message contains the new line.
- `tools/summary-backend/README.md` — modify: the version literal.
- `apps/mobile/src/summaryAccess.ts` — modify: accept only `t2.10-openrouter-v3`.
- `apps/mobile/test/summary-flow.test.ts` — modify: `validUsage` becomes v3, and add `t2.10-openrouter-v2` to the rejected `adapterPromptVersion` values.
- Spec edits (in place):
  - `docs/specs/T2.10a-exact-quantity-amendment.md`: rule 7 gains the name-reduction sentence and points to this spec; the rule-4 note on nominal `12 V` stays.
  - `docs/specs/T2.10c-hosted-deepseek-eval.md`: the adapter becomes `t2.10-openrouter-v3` and the prompt teaches the name rule.

**Stage 2** (assistant prompt), six files plus two in-place spec edits:
- `tools/summary-backend/openrouter.ts` — modify: the preamble line, and `t2.11-openrouter-v1` → `v2` (preamble, `AssistantUsageOut`, usage literal).
- `tools/summary-backend/worker.test.ts` — modify: the v2 literals and the preamble assertion.
- `tools/summary-backend/assistant-eval.ts` — modify: `adapterPromptVersion` literals.
- `tools/summary-backend/README.md` — modify: the version literal.
- `fixtures/synthetic/t2.11-assistant-responses.json` — modify: add three adversarial cases (Verification).
- `packages/obd-assist/test/assistant-replay.test.ts` — modify: add their `expectedAdversarial` entries.
- Spec edits (in place):
  - `docs/specs/T2.11b-assistant-backend-live-eval.md`: the preamble becomes `t2.11-openrouter-v2`, and line 177's "numeric labels … must use prose" gains the name-phrase exception.
  - `docs/specs/T2.11a-assistant-tools-replay.md` §Prompt: note that the name line lives in the adapter preamble, not in `assistantInstructions`.

New dependencies: none.

## Sources

| Constant / behavior | Source |
|---|---|
| Label `12 V observations`, value `not read`; label `12 V battery status` | `packages/obd-assist/src/summary.ts` `prepareSummaryRequest` (fact ids `twelve-volt`, `twelve-volt-status`) |
| Template `12 V battery health`, heading `## 12 V observations` | `packages/obd-battery/src/twelve-volt.ts` `renderTwelveVoltReport`; `packages/obd-battery/src/report.ts` `renderBatteryDiagnosis` |
| Excluded `12 V supply` (label `adapter-supply 12 V supply`, value 12.7 V) | `summary.ts` observation facts; `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl` line 23 (`12.7V`) |
| Phone-console report with no 12 V observation (`twelve-volt` = `not read`) | `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-phone-console.redacted.jsonl`, which has no `ATRV` exchange. The owner's diagnostic request was built from this recording (`docs/task-runs/T2.10.md`) |
| Quoted DeepSeek claims and the rejection message | `docs/task-runs/T2.10.md`, 2026-09-29 D1 re-run entry. Reconstruction only; the raw reply was never saved |
| Grammar being amended | `docs/specs/T2.10a-exact-quantity-amendment.md` rules 4, 6, 7 |

No PID, AT command, header, scaling or DTC constant is introduced.

## Verification

**Shared (both stages).** All checks are E2E through public entry points: `summarize` via `createSummaryReplayArtifact`, and `askAssistant` via `createAssistantReplayArtifact`. Neither the checker nor the projection is mocked. Each accepted case asserts `kind: "llm"` (or `"answer"`) with the exact displayed text. Each rejected case asserts the exact template or fallback. Write the new cases and expectations **before** changing `check.ts`, and keep every existing case and expectation, including `nominal-label-quantity` (template). Every new case name and fixture label says synthetic. No synthetic case counts as model or hardware evidence. Final gates are `pnpm check` (which includes the hil-bridge ruff/pytest; both must PASS) and `git diff --check`.

**Failure modes, listed before code.** Each maps to a named saved case (S = spike report, P = phone-console, A = assistant).
1. A name phrase in digit-free prose is rejected (the reported bug):
   - P `synthetic-reconstructed-deepseek-twelve-volt-names` → llm. Claims: `12 V observations were not read.` [twelve-volt], `12 V battery status was not-assessed.` [twelve-volt-status], `Capacity was not measured because no completed charge log and reviewed capacity estimator are available.` [capacity-status, capacity-reason], `Battery health was not assessed.` [health-status, health-reason], `Cell spread is unavailable.` [cell-spread].
   - S `twelve-volt-name-status-prose` → llm.
2. A bare `12 V` reading passes: S `twelve-volt-name-bare-reading` `The 12 V battery measured 12 V.` [twelve-volt-0, twelve-volt-status] → template. P `synthetic-reconstructed-false-reading`, the same text with [twelve-volt, twelve-volt-status] → template.
3. A transformed or unaccepted-body reading passes next to a name: S `…-transformed-reading` `The 12 V battery reads 12.0 V.` and S `…-exact-value-wrong-body` `The 12 V battery reads 12.7 V.` → template.
4. A name phrase is mixed into a numeric claim: S `…-with-quantity-body` `The 12 V battery was not assessed; adapter supply was 12.7 V.` → template.
5. A word outside the list, or a variant form: S cases for `12 V system`, `12 V supply`, `12 V batteries`, `12 V battery's`, `12 V battery-status`, `12V battery`, `12 v battery`, `12 V Battery`, `12 V battery`, `12  V battery` and fullwidth `１２ V battery` → each template.
6. A digit or sign glued in front: S `112 V battery`, `0.12 V battery`, `-12 V battery`, `+12 V battery` → template.
7. Another numeric character elsewhere in the claim: S `The 12 V battery was checked 2 times.` → template.
8. A name without a 12 V citation: S `12 V battery status was not-assessed.` [capacity-status] → template.
9. A regression in existing bodies: all existing T2.10a cases keep their expectations, for example `The adapter supply measured 12.7 V.` → llm.
10. (Stage 2) The citation check keys on the ID rather than the label, or the assistant path differs. Dataset `real`, each case one `get_session s2` round then an answer:
    - A `twelve-volt-name-missing-prose` with the two quoted claims [s2/twelve-volt, s2/twelve-volt-status] → answer with exact text;
    - A `twelve-volt-name-false-reading` `The 12 V battery measured 12 V.` → fallback `unverified-answer`;
    - A `twelve-volt-name-outside-list` `The 12 V system was not read.` → fallback `unverified-answer`.
11. The prompt drifts from the checker: `worker.test.ts` asserts that the sent system message contains the exact prompt line and the new version header, for the summary in Stage 1 and the assistant in Stage 2. The phone rejects `t2.10-openrouter-v2` usage (Stage 1).

**Stage 1 commands** (repository root):
```bash
pnpm -F obd-assist test -- summary-replay.test.ts
node --import tsx packages/obd-assist/scripts/replay-summary.ts fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-phone-console.redacted.jsonl fixtures/synthetic/x-2026-09-29-twelve-volt-name-responses.json > /tmp/x-twelve-volt-name-cli.json
diff -u /tmp/x-twelve-volt-name-summary.json /tmp/x-twelve-volt-name-cli.json
node --import tsx packages/obd-assist/scripts/replay-summary.ts fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl fixtures/synthetic/t2.10-summary-responses.json > /tmp/t2.10a-summary-cli.json
diff -u /tmp/t2.10a-summary-replay.json /tmp/t2.10a-summary-cli.json
pnpm vitest run tools/summary-backend/worker.test.ts
pnpm -F mobile test -- summary-flow.test.ts
pnpm check && git diff --check
```
Artifacts for the reviewer:
- `/tmp/x-twelve-volt-name-cli.json` shows the reconstruction as `llm`, with the five claim texts joined by newlines, and the false-reading control as `template`.
- `/tmp/t2.10a-summary-cli.json` shows every new S case with its expected kind.

**Stage 2 commands:**
```bash
pnpm -F obd-assist test -- assistant-replay.test.ts
node --import tsx packages/obd-assist/scripts/replay-assistant.ts fixtures/synthetic/t2.11-question-set.json fixtures/synthetic/t2.11-assistant-responses.json > /tmp/x-twelve-volt-name-assistant-cli.json
pnpm vitest run tools/summary-backend/worker.test.ts
pnpm check && git diff --check
```
Artifact: `/tmp/x-twelve-volt-name-assistant-cli.json` `sections.adversarial` shows the three A cases as above. The real and synthetic question rows are unchanged from before.

**Counterfactuals** (Stage 1; repeat 1 and 2 with the A cases in Stage 2). Work in a disposable worktree `/tmp/x-twelve-volt-cf` that has the final tests and fixtures and its own `obd-assist`. Do not mutate the shared tree. Save each transcript and name the failing cases.
1. Take the baseline checker with `git show d4e6578:packages/obd-assist/src/check.ts > /tmp/x-twelve-volt-cf/packages/obd-assist/src/check.ts`, then run the focused summary test into `/tmp/x-twelve-volt-cf-baseline.txt`. **It must fail** on `synthetic-reconstructed-deepseek-twelve-volt-names` and `twelve-volt-name-status-prose` (template instead of llm), while every rejection case still passes.
2. Mutate the final checker so that the name pattern is bare `12 V` (noun list removed; each match reduced to `V`, same boundaries), and save the output to `/tmp/x-twelve-volt-cf-bare.txt`. **It must fail** on `twelve-volt-name-bare-reading`, `synthetic-reconstructed-false-reading` and the `12 V system` case, because each is accepted under the mutation.
3. Remove the citation condition, saving the output to `/tmp/x-twelve-volt-cf-uncited.txt`. **It must fail** on failure mode 8's case.

The implementer and the reviewer each report how they built the worktree, the exact mutation lines, and the named failures. A nonzero exit caused by tooling is not proof.

**NOT RUN, owner-only.** The D1 phone re-run needs:
- the local Worker restarted on v3;
- the dev client reloaded so the phone's `checkSummary` and v3 literal are current.

Expected: `displayCategory` is `llm`, or a new fixed failure that the owner records. No paid call belongs to this task. Hardware needed: none.

## Risks / open questions

- **Citations in the actual reply are unknown.** Decision 2 assumes DeepSeek cited a 12 V fact on its 12 V claims. If the owner's full reply cited, for example, only `capacity-*`, the re-run would still fall back, and the correct outcome is a recorded result, not a relaxed rule. The owner saw the full reply and could confirm this before the re-run. That is not required.
- **Residual semantic misuse.** The checker accepts `The adapter reported 12 V battery voltage.` as prose. It asserts no value, but readers may take it as one. Judging that is BM5 semantic grading, as it is for number words in prose (T2.10a Boundary).
- **The eval scorer is inconsistent with the new rule.** `missingHonest` in `replay-assistant.ts` still flags any digit. After Stage 2, an honest missing-data answer that uses `12 V battery` scores as not honest in T2.11b. The effect is conservative (it undercounts). Changing the scorer belongs in a separate note, not this diff.
- **Stage 1 and Stage 2 both edit `openrouter.ts`, `worker.test.ts` and `README.md`.** They run sequentially.
