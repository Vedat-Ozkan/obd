# X-2026-09-29-deepseek-json-mode: JSON mode on every request, and the upstream status for provider errors

Order: implementation starts only after T2.11b Stage 1b is committed. Both tasks edit `tools/summary-backend/{openrouter.ts,worker.test.ts,assistant-eval.ts,README.md}`. This spec is written against the post-1b state that [T2.11b §Stage 1b](T2.11b-assistant-backend-live-eval.md) describes. Size M (small), one implementer session. Record: `docs/task-runs/X-2026-09-29-deepseek-json-mode.md`.

## Goal

The owner's D1 phone gate (2026-09-29, `docs/task-runs/T2.10.md`, last Stage history entries) settled two consented summaries as `provider-error`, with actual cost NULL and about 0.7 s latency. The likely cause is this mismatch:
- C1 sends `response_format: {type: "json_schema", json_schema: {strict: true, …}}` together with `require_parameters: true`.
- The pinned DeepSeek endpoint advertises `response_format` but not `structured_outputs` (Sources).
- OpenRouter documents `structured_outputs` as the parameter that `json_schema` requires, so no eligible endpoint remains.

The Worker threw the upstream response away, so the ledger could not say why.

After this task:
- **JSON mode everywhere.** Every outgoing chat/completions body from the local Worker sends `response_format: {"type": "json_object"}` (JSON mode). That covers the C1 summary and all four T2.11b assistant arms. Preflight requires exactly the parameters the body sends.
- **Checks unchanged.** The reply is still parsed on the server against the existing bounded schemas (`boundedSummary`, the assistant reply parser), checked by `checkSummaryFacts` / `checkFacts`, and checked again on the phone. A malformed or wrong-number reply therefore still falls back to the template.
- **Upstream status recorded.** Every `provider-error` after a response arrived records the upstream HTTP status, as a number only. It is stored in the settled ledger row and returned in the Worker's fallback envelope, and the eval CLI copies it into its rows.

Test-visible outcome, in the actual-D1 harness:
- captured bodies carry JSON mode and no `json_schema`;
- a synthetic DeepSeek envelope without `structured_outputs` is admitted;
- malformed and wrong-number replies still settle as `invalid-response`;
- a synthetic HTTP 400 settles with `error = 'provider-error:400'`, and its fallback carries `upstreamStatus: 400`.

The owner's D1 phone re-run is the live check and is NOT RUN until the owner does it.

## Non-goals

- No host or model change, no new arm, no retry, no fallback to another mode or host after a failure.
- No change to `summaryInstructions`, `SummaryRequest.promptVersion` (`t2.10-v1`), `assistantInstructions`, `assistantReplySchema` or anything else in `packages/obd-assist`.
- No change to the checkers, the bounds, the reservation and kill rules, `reservationFor`, consent text or versions, or the returned-provider rules.
- The upstream response body, headers, error message, `error.code` or `error.metadata` are never stored, returned or logged. Only the HTTP status number is.
- The phone does not read or show the status. Its development evidence is unchanged apart from the v2 literal (Decision 7).
- No Response Healing plugin or other `plugins` field. It applies only to `json_schema` (Sources), and the no-plugins rule stands.
- No backfill of the two 2026-09-29 rows: their status is unknown and stays plain `provider-error`.
- No paid call. The D1 re-run is the owner's.

## Decisions

Owner, 2026-09-29 (`docs/task-runs/X-2026-09-29-deepseek-json-mode.md`):
1. Keep the DeepSeek host. Send plain JSON mode instead of the strict schema, and rely on the server and phone schema checks and the number check.
2. The scope as specced is confirmed: JSON mode on all four arms and the C1 summary, the v2 summary prompt, and the shared preflight list.
3. Record the upstream HTTP status (number only, no body, no headers) for `provider-error`, in this task, under the same owner re-run gate.

Architect, within those answers:

4. **All four assistant arms use JSON mode, not only A and B.** The comparison is meant to vary one thing: model and host (T2.11b Experiment, Controlled). If C and D kept provider-side constrained decoding while A and B did not, differences in pass rate would mix model quality with how the output was decoded. With one mode everywhere:
   - the schema is enforced the same way on every arm (by the server parser and checker);
   - T2.11b's risk that a strict-schema keyword is rejected on C or D disappears.

   The cost is that C and D lose provider-side enforcement. A reply that breaks the shape becomes a recorded `invalid-response`, which is the comparison's measure anyway.
5. **The summary adapter prompt changes to `t2.10-openrouter-v2`.** The v1 prompt only names "StructuredSummary version 1 with claims containing text and factIds". In JSON mode nothing else tells the model the key names or the bounds, and DeepSeek's JSON Output guide asks for an example (Sources). The phone checks `adapterPromptVersion`, so its accepted literal moves to v2. It does not also accept v1, because the Worker never serves v1 again.
6. **The assistant prompt stays `t2.11-openrouter-v1`, unchanged.** `assistantInstructions` already spells out both exact reply objects with every key, and it contains the word JSON. No live rows exist, so T2.11b's frozen-prompt rule is not engaged. No text changes, so there is no version bump.
7. **Required parameters are one shared list.** Every pin needs `max_tokens`, `response_format` and `reasoning`. `ModelPin.requiredParameters` is removed, and preflight checks the module's single `parameters` list, which is exactly the sampling parameters that `prepare()` sends. The `provider` block is unchanged, including `require_parameters: true`: all four pinned endpoints advertise all three parameters (Sources).
8. **The status is stored in the existing `error` column, as `provider-error:NNN`, not in a new column.** `schema.sql` must stay idempotent and row-preserving under X-2026-09-29's rebuild-every-run pattern. That pattern copies rows with a static `SELECT` of named columns:
   - on the first run, a new column would not exist in the old table, so a `SELECT` naming it fails;
   - leaving it out of the `SELECT` drops the stored status on every later run;
   - `ALTER TABLE ADD COLUMN` fails when re-run.

   Widening the `error` CHECK only changes the CHECK text in the two `CREATE` statements, and the copy stays column-identical. The prefix keeps the category readable; plain `provider-error` means "no status known".
9. **Where the status goes.**
   - It goes to the settled D1 row and to the Worker's fallback envelope on both routes (`upstreamStatus`, number or null, present only when `reason` is `provider-error`).
   - The eval CLI records the status per round.
   - The phone does not read it. The D1 gate is diagnosed from the local ledger, which the orchestrator reads read-only as on 2026-09-29, so the phone keeps its minimal evidence and its 4 KiB budget.
10. **Which status.**
    - fetch throws (network failure or the 20 s timeout): null, stored as plain `provider-error`;
    - `!response.ok`: `response.status`;
    - HTTP 200 carrying an `error` envelope: 200. OpenRouter sends that when a failure happens after the headers (Sources), and 200 is the honest number.
    
    A status outside 100–599 or not an integer is stored as null. The status is never set on `invalid-response`, `null` (success) or pre-call fallbacks.

## Interfaces

```ts
// openrouter.ts
// before
interface ModelPin { …; requiredParameters: readonly string[] }
function prepare(pin, schemaName: string, schema: object, system: string, user: string): Prepared
//   body.response_format = { type: "json_schema", json_schema: { name, strict: true, schema } }
export const outputSchema = { … };                                   // only used by prepare()
interface SummaryUsage { …; adapterPromptVersion: "t2.10-openrouter-v1" }
interface AdapterResult { summary?; reason?; usage?; actualMicroUsd: number | null; kill: boolean }
// after
interface ModelPin { /* requiredParameters removed; every other field unchanged */ }
function prepare(pin, system: string, user: string): Prepared         // response_format = { type: "json_object" }
// outputSchema deleted; boundedSummary (the zod parser) unchanged
interface SummaryUsage { …; adapterPromptVersion: "t2.10-openrouter-v2" }
interface AdapterResult { …; upstreamStatus: number | null }          // AssistantAdapterResult inherits it; null unless reason is "provider-error"
// preflight: parameters.every(p => supportedParameters.includes(p)) for every pin

// worker.ts: settle() writes error = reason === "provider-error" && upstreamStatus !== null ? `provider-error:${upstreamStatus}` : reason ?? null
// Fallback envelopes after a call, both routes (before → after):
{ kind: "fallback", reason, usage? }  →  { kind: "fallback", reason, usage?, upstreamStatus?: number | null }   // key present only for provider-error

// schema.sql, summary_requests and summary_requests_next (both CREATE statements), CHECK before → after:
error TEXT CHECK (error IS NULL OR error IN ('provider-error', 'invalid-response'))
error TEXT CHECK (error IS NULL OR error IN ('provider-error', 'invalid-response') OR error GLOB 'provider-error:[1-5][0-9][0-9]')

// assistant-eval.ts: each round gains upstreamStatus: number | null (from the envelope when it is an integer 100–599, else null;
// transport-error rounds null). Saved replies files are unchanged.

// apps/mobile/src/summaryAccess.ts
DevelopmentUsage.adapterPromptVersion: "t2.10-openrouter-v1"  →  "t2.10-openrouter-v2"              // type and projectUsage check
```

**Summary adapter prompt v2.** Two edits to `adapterInstructions`, and the rest of the text is unchanged:
- `Adapter prompt version: t2.10-openrouter-v1.` becomes `… t2.10-openrouter-v2.`
- The line `Return only StructuredSummary version 1 with claims containing text and factIds.` is replaced with exactly:

```
Reply with exactly one JSON object and nothing else: {"version":1,"claims":[{"text":TEXT,"factIds":[IDS]}]}, with 1 to 16 claims, each text 1 to 512 characters and 1 to 16 factIds of at most 96 characters.
```

The bounds are `boundedSummary`'s, stated in the prompt so the model sees them. The server still enforces them.

**Migration.** `schema.sql` keeps X-2026-09-29's statement order and self-healing rebuild. Only the `error` CHECK text changes, in both `summary_requests` CREATE statements. Existing values (`NULL`, `provider-error`, `invalid-response`) satisfy the widened CHECK, so every row copies unchanged. The orchestrator applies the reviewed file to live local state after approval (X-2026-09-29 Decision 2, same procedure):
- before: read-only `sqlite3 -readonly` SELECT of `summary_budget`, all `summary_requests` rows (request ID, state, reservation, actual, error), and `.schema`;
- apply with the README's `pnpm dlx wrangler@4.142.0 d1 execute … --file tools/summary-backend/schema.sql`;
- after: the same SELECT shows identical rows, including both 2026-09-29 rows as `provider-error` with actual NULL and reservation 6977, and `spent` 13,954. `.schema` shows the widened CHECK, and no `_next` table remains.

The implementer never touches `.wrangler` state.

## Files

1. `tools/summary-backend/openrouter.ts`: modify. JSON mode in `prepare()`, delete `outputSchema`, remove `requiredParameters`, preflight uses `parameters`, summary prompt and usage version v2, `upstreamStatus` in `complete()` and both results.
2. `tools/summary-backend/worker.ts`: modify. `settle()` writes `provider-error:NNN`; both routes' fallback envelopes carry `upstreamStatus` for `provider-error`.
3. `tools/summary-backend/schema.sql`: modify. Widened `error` CHECK in both `summary_requests` CREATEs; the comment names the `provider-error:NNN` form.
4. `tools/summary-backend/worker.test.ts`: modify. Write the Verification cases first:
   - drop `Arm.structured`, so every synthetic envelope uses the inspected shape without `structured_outputs`;
   - remove the `no-structured-outputs` denial;
   - rename `unsupported-strict-schema` to `unsupported-json-mode`;
   - update the expected `error` values of the existing provider-error cases.
5. `tools/summary-backend/assistant-eval.ts`: modify. Per-round `upstreamStatus`.
6. `tools/summary-backend/README.md`: modify.
   - "Strict reply schema" becomes "JSON mode, reply schema enforced on the server".
   - Describe the one shared parameter list.
   - Explain the `provider-error:NNN` ledger value and the fallback field.
   - Note that re-running `schema.sql` migrates in place.
7. `apps/mobile/src/summaryAccess.ts`: modify. Accepted `adapterPromptVersion` literal becomes v2.
8. `apps/mobile/test/summary-flow.test.ts`: modify. `validUsage` uses v2; add one bad-field row, `["adapterPromptVersion", "t2.10-openrouter-v1"]`.
9. `docs/specs/T2.10c-hosted-deepseek-eval.md`: edit in place to the final rule:
   - Interfaces: `SummaryUsage.adapterPromptVersion` becomes v2, and the fallback envelope gains `upstreamStatus`.
   - Line 56: "fixed error category, plus the numeric upstream status for provider errors (`provider-error:NNN`)".
   - Preflight paragraph (line 62): the last three sentences become "Require `max_tokens`, `response_format` and `reasoning`; the request uses JSON mode, which `response_format` covers (X-2026-09-29-deepseek-json-mode, Sources); `reasoning` does not prove disabled reasoning succeeds."
   - Request paragraph (line 74): `response_format:{type:"json_object"}` replaces the strict schema; no retry with any other mode.
   - Adapter instruction paragraph (line 76): version v2 with the JSON-shape line.
   - Line 78: "No provider text/error/raw response is copied into fallback" gains "except the numeric HTTP status (`upstreamStatus`)".
   - Sources row (line 106): cites this spec's rows.
   - Verification line 129: "exactly one JSON-mode completion request"; "unsupported strict schema" becomes "unsupported JSON mode".
   - Risks line 186: "strict JSON-schema output" becomes "JSON-mode output".
10. `docs/specs/T2.11b-assistant-backend-live-eval.md`: edit in place to the final rule:
    - Goal: "the same JSON-mode request with `assistantReplySchema` enforced on the server".
    - Arms table column: "`structured_outputs` advertised (unused: all arms send JSON mode)".
    - Interfaces: `ModelPin` without `requiredParameters`; fallback with `upstreamStatus`.
    - Outgoing body: `response_format: {type: "json_object"}`.
    - Preflight per pin: one shared list.
    - Eval CLI per-round list: add `upstreamStatus`.
    - Experiment, Controlled: add "JSON-mode request".
    - Stage 1 Verification, Preflight per pin: "any pin without `response_format`" replaces "C or D without `structured_outputs`".
    - Stage 2 Prerequisite: "rejects JSON mode or disabled reasoning".
    - Risks: the largest-risk bullet is restated for JSON mode.
11. `docs/specs/X-2026-09-29-summary-reservation.md`: edit in place. §Schema's CHECK list adds the widened `error` CHECK and points to this spec.

That is eleven files: eight code or test files and three governing-spec edits. The owner directed folding the status in rather than splitting (Decision 3). Record-only: `docs/task-runs/X-2026-09-29-deepseek-json-mode.md` (orchestrator). No new dependencies.

## Sources

All fetched 2026-09-29.

| Behavior | Source |
|---|---|
| DeepSeek tag `deepseek`, flash and V4 Pro 0813: `supported_parameters` includes `max_tokens`, `response_format`, `reasoning`; **no** `structured_outputs` | `https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints` 17:44:06 UTC, SHA-256 `1462501d71858e5f3dfee7d1300c6f436895f8a6fd603ee3a1630b4a22d7157b`; `…/deepseek/deepseek-v4-pro-0813/endpoints` 17:44:06 UTC, SHA-256 `ede966ec38142ab951f21276913e5d5d5f4bc4d627df223847bcb67a4d1c2dd9` |
| Xiaomi `xiaomi/fp8` and Moonshot AI `moonshotai/mxfp4`: include `max_tokens`, `response_format`, `reasoning` (and `structured_outputs`) | `…/xiaomi/mimo-v2.6-pro/endpoints` 17:44:06 UTC, SHA-256 `7dd378e9bbac700759be12a4fee0950f60b68972283bfb48afe9270b595b13a6`; `…/moonshotai/kimi-k3/endpoints` 17:44:06 UTC, SHA-256 `4ec7a71f356a5722d9730e114ea9a8956ecc80a4df1286e5d513de46e819a124` |
| `response_format`: "Setting to `{ "type": "json_object" }` enables JSON mode, which guarantees the message the model generates is valid JSON"; the prompt should also ask for JSON. `structured_outputs`: "If the model can return structured outputs using response_format json_schema" | `https://openrouter.ai/docs/api/reference/parameters.md` 17:44:25 UTC, SHA-256 `ac96ee3185f1c2668f99d7f3e38d9f583496b8b69317c1a156e257674b8202de` |
| `require_parameters: true`: "the request won't even be routed to" a provider lacking a request parameter; the page's own example pairs it with `response_format: {type: "json_object"}` | `https://openrouter.ai/docs/guides/routing/provider-selection.md` §Requiring Providers to Support All Parameters, 17:44:25 UTC, SHA-256 `91fac5cb775f2d94040fad3f611c582e380ab6d4e42dee21edd026bb7db79b00` |
| `json_schema` support is per endpoint, listed as `structured_outputs`; unsupported model gives an error; `strict` enforcement varies by provider; Response Healing is `json_schema` only | `https://openrouter.ai/docs/guides/features/structured-outputs.md` 17:44:25 UTC, SHA-256 `2211d94594a9cb5c4075bf24813e1284b28d9b5e873bc8dc0b4f3ccf6b672aa5` |
| DeepSeek JSON Output: `{'type': 'json_object'}`, include the word "json" and an example of the format, set `max_tokens` against truncation; "may occasionally return empty content" | `https://api-docs.deepseek.com/guides/json_mode` 17:45:22 UTC, SHA-256 `f728a4dad99c2328c9c982b08c113f400abcc1a7eba238f08738f51a951d1b30` |
| Request errors return an HTTP status equal to `error.code` (400, 401, 402, 403, 404, 408, 429, 502, 503, …). A failure after the headers returns `200 OK` with a body holding only `error`, and no `choices` | `https://openrouter.ai/docs/api/reference/errors-and-debugging.md` 17:52:36 UTC, SHA-256 `a6349104af2a1d8bd45a04892150b8641e076dfa6c4cb67a898b0679b11e5c44` |
| Rebuild-every-run migration pattern, live-state procedure, orchestrator authorization | [X-2026-09-29-summary-reservation](X-2026-09-29-summary-reservation.md) §Schema, §Verification (live migration), Decision 2 |
| Reservation stays an upper bound: the body loses the schema, and the rendered prompt now holds only the messages plus any fixed JSON-mode wrapper, inside the 4,096-token margin | X-2026-09-29-summary-reservation §Sources (bound unchanged) |
| Observed failure; live rows (reservation 6977 each, spent 13,954) | `docs/task-runs/T2.10.md`, Stage history, 2026-09-29 entries |

The failure diagnosis is an inference from these documents, and the re-run confirms it. The recorded status narrows a repeat failure to a class; it does not explain it (Risks). No OBD constant is involved.

## Verification

Shared: write the `worker.test.ts` changes before the code. Every case goes through the public Worker HTTP handler in the actual-D1 Wrangler harness, with injected synthetic upstream and labeled synthetic metadata; no paid call. Existing C1, X-2026-09-29 and T2.11b cases keep their outcomes, except the stored `error` values that item 11 changes. Case counts may change. The canonical artifact is `/tmp/t2.10c-local-e2e.json`:
- its `captured-envelope` and `assistant-shared-body` rows show `response_format: {"type":"json_object"}`;
- provider-error rows show the stored `error` and the envelope's `upstreamStatus`.

There is no hash or byte-identical comparison.

Failure modes, listed before code. Each maps to a harness case.

JSON mode:
1. **A DeepSeek pin still sends a strict schema.** In the existing `captured-envelope` (summary) and `assistant-body-{A..D}` cases, `response_format` deep-equals `{type: "json_object"}`, and the raw body contains neither `json_schema` nor `"strict"`.
2. **C and D diverge from the one-mode rule.** The existing `assistant-body-*` loop asserts every non-`model`/`provider` field is equal across the four pins, and that shared `response_format` is JSON mode.
3. **Preflight still demands `structured_outputs`.** `preflight-{A..D}-inspected-shape` uses envelopes without `structured_outputs` for all four pins and is admitted with one completion call. The summary metadata E2E (DeepSeek shape) stays admitted.
4. **Preflight stops requiring what is sent.** The existing summary `missing-response_format` / `missing-max_tokens` / `missing-reasoning` cases still deny. New `preflight-{A..D}-no-response-format` → `unavailable`, 0 completion calls.
5. **The summary prompt no longer conveys the shape.** The `captured-envelope` system message starts with `Adapter prompt version: t2.10-openrouter-v2.` and contains the exact JSON-shape line from Interfaces. Accepted summaries report `usage.adapterPromptVersion` `t2.10-openrouter-v2`. The assistant system message is still `t2.11-openrouter-v1` + `assistantInstructions` (existing assertion).
6. **A lenient parse lets a malformed reply through.** Each case → `invalid-response`, settled with its actual cost, template shown:
   - `json-mode-fenced`: the valid accepted summary wrapped in a ```` ```json ```` fence;
   - `json-mode-wrong-shape`: `{"summary": <valid summary>}`;
   - `assistant-json-mode-wrong-shape`: a tool reply missing `claims`.

   Existing `invalid-content-json`, saved `malformed` and the bounds cases keep `invalid-response`.
7. **DeepSeek's documented empty content is treated as success, or as unpaid.** `json-mode-empty-content` (`content: ""`, usage and cost present) → `invalid-response`; the row settles with its actual cost.
8. **A wrong number gets through.** The saved `wrong-number` summary case and `assistant-wrong-number` stay `invalid-response`.
9. **An unsupported JSON mode is not a clean fallback.** The renamed `unsupported-json-mode` (HTTP 400) → `provider-error`, one call, no second request.
10. **The phone drops v2 usage, or still accepts v1.** In `apps/mobile/test/summary-flow.test.ts`, `validUsage` (v2) projects intact, and the bad-field row `adapterPromptVersion: "t2.10-openrouter-v1"` projects to null.

Upstream status:

11. **The status is lost, or wrong.** Each case → `provider-error`, and the D1 row and the envelope match:

    | Case | D1 `error` | Envelope `upstreamStatus` |
    |---|---|---|
    | `unsupported-json-mode` | `provider-error:400` | 400 |
    | `provider-http` | `provider-error:500` | 500 |
    | new `provider-http-404` | `provider-error:404` | 404 |
    | new `assistant-provider-http-502` (arm A) | `provider-error:502` | 502 |

12. **A thrown fetch gets a fabricated status.** `timeout`, and a new `network-throw` (the injected fetch rejects) → `error = 'provider-error'`, envelope `upstreamStatus: null`.
13. **The 200-with-error case is lost or misfiled.** `provider-error-envelope` (HTTP 200, `error` body) → `provider-error:200`, `upstreamStatus: 200`.
14. **Body or headers leak.** In `provider-http-404`, the upstream body `SENTINEL_PROVIDER_ERROR` with `error.code` 404 and `error.metadata.raw` `SENTINEL_RAW`, plus a response header `x-sentinel: SENTINEL_HEADER`, appear nowhere: not in the HTTP response, not in any D1 column (full-row SELECT), and not in the artifact.
15. **The status leaks onto other outcomes.**
    - An `invalid-response` case (`invalid-content-json`) stores exactly `invalid-response`, and its envelope has no `upstreamStatus` key.
    - An accepted case stores NULL, and pre-call fallbacks (`unavailable`, `consent-required`) have no key.
16. **The eval CLI drops the status.** In the main T2.11b dry run, every round has `upstreamStatus: null`. A new mini dry run (arm A only, harness returns HTTP 503 for every completion) writes rows with reason `provider-error` whose rounds have `upstreamStatus: 503`.
17. **The migration loses or rejects rows.** Extend the existing legacy-migration E2E:
    - seed rows with `error` `provider-error`, `invalid-response` and NULL;
    - apply `schema.sql`, settle one row as `provider-error:404` through the handler, then apply `schema.sql` again;
    - all four rows are unchanged and no `_next` table remains;
    - a direct `d1 execute` insert of `provider-error:4040` or `provider-error:abc` fails the CHECK.

No isolated tests: every item goes through the Worker handler, the real CLI, `d1 execute` on the harness D1, or the phone's public flow harness.

Commands:
- [ ] `pnpm vitest run tools/summary-backend/worker.test.ts` (includes T2.11b's eval dry runs)
- [ ] `pnpm -F mobile test`
- [ ] `pnpm check` (includes `cd tools/hil-bridge && uv run ruff check . && uv run pytest`)
- [ ] `git diff --check`
- [ ] Reviewer reads `/tmp/t2.10c-local-e2e.json`: the `captured-envelope`, `assistant-shared-body` and provider-error rows, the migration row, and the mini dry-run artifact.

After review (orchestrator, not the implementer): the live-state migration, with the read-only before/after check in Interfaces §Migration, recorded in the task record.

Owner-run, NOT RUN until done: the paid phone call, not a vehicle hardware-only exception. The owner reruns the T2.10d D1 phone gate against the migrated local D1 with the rebuilt Worker (`wrangler dev --local`) and a Metro reload of the dev client. The phone change is JS only, so no native rebuild is needed.
- PASS: the phone shows a checked LLM summary, `/tmp/t2.10d-local-phone.json` has `usage.adapterPromptVersion` `t2.10-openrouter-v2`, and the ledger row (read-only SELECT) has `error` NULL and a non-NULL `actual`.
- A fallback is a recorded result, with the row's `error` value quoted in `docs/task-runs/T2.10.md`:
  - `provider-error:NNN` or `provider-error`: return to architecture with that status; do not change mode or host.
  - `invalid-response`: the model's output quality. Record it; do not tune the prompt on it.

## Risks / open questions

- **Largest risk: the diagnosis is unconfirmed.** The status narrows a repeat failure to a class only. For example, 400 means the request was rejected, 402 credit, and 404 not found. It does not give the cause, because the body is withheld by owner decision. A 200-with-error names no class. Each failed tap holds about 6,900 micro-USD of the local budget (unknown cost).
- JSON mode guarantees valid JSON only, not the shape. On all four arms, shape compliance now rests on the prompt. The T2.11b comparison measures it as `invalid-response` rows, which is the intended evidence (T2.11b Experiment, Held out).
- The `error` column now carries a category and an optional number. Anything that reads it must treat values starting with `provider-error` as that category. Nothing outside tests reads it today.
- Summary R shrinks by roughly 400 micro-USD because the schema leaves the body. It remains an upper bound (Sources).

Open questions: none. The owner answered both on 2026-09-29 (Decisions 1–3).
