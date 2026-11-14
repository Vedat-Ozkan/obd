# X-2026-11-14-deepseek-repin: pin the current DeepSeek Flash snapshot, drop the Kimi arm

## Goal

The summary and the assistant call a model route that exists. The paid comparison's pre-check accepts arm A again. The Kimi arm is gone (owner, 2026-11-14: "use deepseek, no kimi").

## Evidence

On 2026-11-14 the paid comparison stopped before any request: OpenRouter lists no DeepSeek-hosted endpoint for `deepseek/deepseek-v4.1-flash` (canonical `deepseek/deepseek-v4.1-flash-20260910`), which is both arm A and the in-app summary's model. The Kimi pin's tag `moonshotai/mxfp4` is also no longer listed.

## Non-goals

- No change to prompts, consent versions, the number check, budgets, reservation maths or price ceilings.
- The DeepSeek V4 Pro and Xiaomi MiMo arms stay as they are.
- No paid call in this task; the lead reruns the comparison afterwards.
- Earlier specs and task records that mention the old id are history and stay unchanged.

## Design

1. `tools/summary-backend/openrouter.ts`: `model` becomes `deepseek/deepseek-v4.1-flash-1017` and `canonicalSlug` becomes `deepseek/deepseek-v4.1-flash-20261017`. `AssistantModel` and `pins` lose `moonshotai/kimi-k3`. Provider name, tag, context ceiling and rate ceilings of the Flash pin are unchanged.
2. `apps/mobile/src/summaryAccess.ts`: `SUMMARY_MODEL` and the accepted returned-model values become the new id and the new canonical slug.
3. `tools/summary-backend/README.md`: the arms table, the runbook command (`--models` with three arms, `--max-spend-usd 0.05,0.05,0.15`) and any sentence that counts four arms.
4. `docs/specs/T2.11b-assistant-backend-live-eval.md`: only the section that defines the arms and pins is edited in place to three arms with the new Flash pin.

## Files

- `tools/summary-backend/openrouter.ts`, `tools/summary-backend/worker.test.ts`, `tools/summary-backend/README.md` — edit
- `apps/mobile/src/summaryAccess.ts`, `apps/mobile/test/summary-flow.test.ts` — edit
- `docs/specs/T2.11b-assistant-backend-live-eval.md` — edit, arms section only

## Sources

| Constant | Source |
|---|---|
| `deepseek/deepseek-v4.1-flash-1017`, canonical `deepseek/deepseek-v4.1-flash-20261017` | `GET https://openrouter.ai/api/v1/models`, fetched 2026-11-14 |
| Provider `DeepSeek`, tag `deepseek`, context 1048576, parameters `max_tokens`, `response_format`, `reasoning` | `GET https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash-1017/endpoints`, fetched 2026-11-14 |
| Listed rates US$0.15 in / US$0.60 out per million tokens, peak-hour override US$0.30 / US$1.20 | same response; equal to or below the pin's existing ceilings (3 and 12 tenth-micro-USD per token) |

## Verification

Change the tests' expected ids first and see them fail on the unchanged code.

- [ ] `tools/summary-backend/worker.test.ts` passes with the new Flash id and slug and three arms; its offline dry run of the eval CLI covers three arms.
- [ ] `apps/mobile/test/summary-flow.test.ts` passes with the new id; a usage record carrying the old id or old slug is rejected.
- [ ] `grep -rn "kimi\|mxfp4" tools/summary-backend apps/mobile/src apps/mobile/test` prints nothing, and `grep -rn "flash-20260910" tools/summary-backend apps/mobile/src` prints nothing (the mobile test that rejects the old slug names it).
- [ ] Scoped checks green for `apps/mobile` and the summary-backend tests (`fast-checks` skill).
- [ ] Live (lead, after merge, paid): the comparison's pre-check accepts arm A and the arm runs.
