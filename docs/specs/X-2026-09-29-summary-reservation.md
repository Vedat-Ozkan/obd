# X-2026-09-29-summary-reservation: size the summary reservation to the request

Owner request 2026-09-29: "adjust reserve to the real size" (`docs/task-runs/X-2026-09-29-summary-reservation.md`). This task amends the C1 local development Worker (`docs/specs/T2.10c-hosted-deepseek-eval.md` §Bounds, durable credit and idempotence; ADR-020). It makes no paid call and needs no car.

## Goal

Today every summary call reserves a fixed 315,802 micro-USD: the model's whole 1,048,576-token context at US$0.30/M plus 1,024 output tokens at US$1.20/M. A real summary request body is about 7.5 KB. The US$1 durable ceiling and the four-use cap therefore allow only three or four calls. After this task:

- The Worker derives the reservation from the exact outgoing request body. The bound rests on a sourced property of the pinned model's tokenizer, with a stated margin. Output stays capped at 1,024 tokens. The bound never exceeds the old full-context value.
- The reservation is stored per request and settled against that stored value. Unknown cost still keeps the full reservation for that request. A reported `prompt_tokens` above the request's reserved input tokens trips the existing kill switch.
- The use-count cap is removed (Decision 1). The US$1 budget alone limits calls; `uses` stays as a counter.
- The existing local D1 schema is migrated in place, and re-running `schema.sql` never resets it.

Test-visible outcome: in the actual-D1 Wrangler E2E harness, each recording-derived request row holds a reservation of about 7,000 micro-USD, and the fixed 315,802 is gone. The harness also shows a fifth and later calls admitted, admission ending only when the budget runs out, the migration from the legacy schema, and the kill cases, all in `/tmp/t2.10c-local-e2e.json`. The three committed recordings give bodies of 7,518, 7,518 and 6,735 bytes, which reserve 6,969, 6,969 and 6,499 micro-USD (architect measurement 2026-09-29, formula below).

## Non-goals

- No tokenizer dependency, no token counting of the prompt, no provider-side input cap. The bound is byte-based.
- No change to the model pin, host, rates, preflight metadata checks, prompt, output schema, `max_tokens`, request bounds (16 KiB raw, 64 facts, field lengths), consent, token or host guard, the US$1 durable ceiling, `SUMMARY_KEY_LIMIT_USD = "1"` or `SUMMARY_BUDGET_MICRO_USD = "1000000"`.
- No refund of ambiguous calls. No lease expiry. No reset or deletion of `tools/summary-backend/.wrangler` state. No new use cap, rate limit or per-day limit.
- The `no-credit` member of `SummaryFallback` stays in the type (T2.10b/C2 production credit and the phone use it); C1 simply no longer emits it.
- No T2.11b assistant route, tables or eval CLI. This task only exports `reservationFor` so T2.11b can reuse it (see Interfaces).
- No change to C2/T2.10b production economics, rewarded ads or phone UI beyond the status `uses` validation bound.
- No paid call, live phone tap or D1 repair. The implementer never touches the real `.wrangler` state (Verification, orchestrator step).

## Interfaces

`tools/summary-backend/openrouter.ts`

```ts
// before
export const reservationMicroUsd = 315802;
preflight(key: string): Promise<ProviderSnapshot>;
generate(request: SummaryRequest, key: string): Promise<AdapterResult>;

// after (reservationMicroUsd constant removed)
export const maxSummaryBodyBytes = 65536;
export interface Reservation { inputTokens: number; microUsd: number }
/** Upper bound for one completion whose rendered prompt consists only of text and JSON present in the body. */
export function reservationFor(bodyBytes: number): Reservation;
/** Builds the exact chat/completions body that generate() sends (unchanged content) and its reservation. */
export function prepareSummary(request: SummaryRequest): { body: string; bodyBytes: number; reservation: Reservation };
preflight(key: string, reservationMicroUsd: number): Promise<ProviderSnapshot>;
generate(request: SummaryRequest, prepared: ReturnType<typeof prepareSummary>, key: string): Promise<AdapterResult>;
```

**Bound (frozen policy).** `bodyBytes` is the UTF-8 byte length of the exact body string sent to `/chat/completions` (`new TextEncoder().encode(body).length`, never `string.length`).

- `inputTokens = min(contextCeiling, 2 × bodyBytes + 4096)`
- `microUsd = ceil((3 × inputTokens + 12 × the route's completion cap) / 10)`, in integer arithmetic, for example `Math.floor((3 * t + 12 * 1024 + 9) / 10)` for a 1,024-token route (the summary route's cap is 2,048 since X-2026-09-29-explanatory-summary Stage 3, so it uses `12 * 2048`). Here 3 and 12 are the verified base ceilings of US$0.30/M and US$1.20/M, expressed in tenths of a micro-USD per token. They are declared next to `inputRate`/`outputRate` with a comment that ties them together. Preflight still rejects any endpoint or override rate above those ceilings. Discounted, cached or override rates never lower the reservation.
- At the context clamp, `reservationFor` returns exactly 315,802. No reservation can exceed the legacy value.

Why this is an upper bound (the full source list is in Sources):

1. The pinned tokenizer is byte-level BPE, with all 256 byte symbols in its base vocabulary and an empty normalizer. Any text therefore encodes to at most its UTF-8 byte count in tokens.
2. In the model's reference prompt format, the rendered prompt consists of BOS and role tokens, the system content, a fixed response-format preamble, the response schema re-serialized with `json.dumps` default separators (at most twice its compact bytes), and the user content. The body carries every one of these strings JSON-escaped, and escaping never shortens a string. So `2 × bodyBytes` covers the rendered text.
3. The +4,096 tokens are a policy margin for special tokens and small undisclosed hosted-side additions, such as a date reminder.

The hosted rendering itself is not documented. The bound is therefore backed by a detector: see Kill switch.

**Summary route (`worker.ts`).** After schema validation and before any D1 read or write, the handler runs `prepared = prepareSummary(input.request)`. If `prepared.bodyBytes > maxSummaryBodyBytes`, it returns `invalid-request`. A valid 16 KiB input cannot reach this cap (ECMAScript JSON escaping at most doubles the user content, roughly 32 KiB, plus about 4 KB of instructions and schema). The cap exists so that the status threshold below is a true upper bound. It is a defensive invariant, not a new user-facing limit. From then on the handler uses `R = prepared.reservation.microUsd` everywhere the constant was used:

- the pre-check (`budget-exhausted` when `spent + R > 1000000`);
- `preflight(key, R)` key headroom (`limit_remaining ≥ R / 1e6`);
- `reserve(db, id, R)`: the conditional UPDATE and the guarded INSERT bind the same `R`;
- `settle(db, id, R, result)`: `charged = actual ?? R`; on kill, `max(charged, R)`.

**Use-count cap removed (Decision 1).**

- Delete the `uses<4` condition from the reserve UPDATE, the `uses >= 4` → `no-credit` pre-check and the post-denial branch, and the `row.uses < 4` term in status. `uses` is still incremented on every reservation as a counter.
- Delete `SUMMARY_MAX_USES` from `SummaryEnv`, from the `enabled()` guard and from `wrangler.toml`. A leftover value in an owner's `.dev.vars` is ignored.
- The remaining post-denial reasons are `already-requested`, `unavailable` (disabled or in flight) and `budget-exhausted`.

**Status.** `GET /v1/status` returns the same keys:

- `uses`: the unbounded counter;
- `headroomMicroUsd`: unchanged;
- `enabled: !disabled && !inflight && spent + reservationFor(maxSummaryBodyBytes).microUsd <= 1000000`, where that reservation is 41,780. So `enabled: true` means that any admissible summary fits.

**Phone (`apps/mobile/src/summaryAccess.ts`).** `projectBudget` changes `integer(b.uses, 4)` to `integer(b.uses)`: a nonnegative safe integer, using the helper's existing default maximum. `headroomMicroUsd` (0–1,000,000) and the `enabled` boolean are unchanged. This is the smallest change that still rejects negative, fractional, non-number or unsafe values.

**Kill switch.** In `generate`, the kill condition `input > contextCeiling || output > maxCompletionTokens || actual > reservationMicroUsd` becomes `input > prepared.reservation.inputTokens || output > maxCompletionTokens || actualMicroUsd > prepared.reservation.microUsd`. The outcome is the same as today: `invalid-response`, `disabled = 1`, and the ledger keeps `max(actual, R)`. A tripped kill means the bound's assumption failed, and the task returns to architecture. The provider key's non-resetting US$1 cap stays the hard money limit.

**Schema (`schema.sql`, idempotent migration in the same file).** The new CHECKs:

- `summary_budget.uses >= 0`
- `summary_requests.reservation BETWEEN 1 AND 315802`
- `summary_requests.error` is NULL, `'provider-error'`, `'invalid-response'`, or `'provider-error:NNN'` (`error GLOB 'provider-error:[1-5][0-9][0-9]'`, the upstream HTTP status); see [X-2026-09-29-deepseek-json-mode](X-2026-09-29-deepseek-json-mode.md)

The existing local DB was created with `uses BETWEEN 0 AND 4` and `reservation = 315802`. `CREATE TABLE IF NOT EXISTS` cannot change it, so the file rebuilds both tables every time it runs, with no explicit transaction. Statement order:

1. `CREATE TABLE IF NOT EXISTS summary_budget (…new…)`, then the existing `INSERT OR IGNORE` of `(1,0,0,NULL,0)`.
2. `CREATE TABLE IF NOT EXISTS summary_budget_next (…new…)`, then `INSERT OR IGNORE INTO summary_budget_next SELECT id,uses,spent,inflight,disabled FROM summary_budget`, then `DROP TABLE summary_budget`, then `ALTER TABLE summary_budget_next RENAME TO summary_budget`.
3. The same four-step rebuild for `summary_requests` via `summary_requests_next`.

The order is self-healing: a run interrupted after a DROP leaves the copied `_next` table. The next run's `INSERT OR IGNORE` keeps the copied row over a freshly inserted `(1,0,0,…)` because `id = 1` already exists. A legacy row with reservation 315,802 satisfies the new CHECK. The file comment keeps "Re-running this schema never restores uses/headroom."

**Reuse by T2.11b (not implemented here).** An assistant route may call `reservationFor(bytes of its own outgoing body)` on the same terms: the rendered prompt must contain only strings and JSON present in the body, and the route sets its own body cap and budget tables. Where the T2.11b draft says "Reservation is C1's 315,802", its architect should update that line to cite this spec; this task does not edit the draft.

## Files

1. `tools/summary-backend/openrouter.ts`: modify. `reservationFor`, `prepareSummary`, integer rate constants, preflight and kill use the per-request reservation. The outgoing body is unchanged.
2. `tools/summary-backend/worker.ts`: modify. Prepare before D1, the body-cap check, per-request pre-check/reserve/settle, the status threshold, removal of the use cap and `SUMMARY_MAX_USES`.
3. `tools/summary-backend/schema.sql`: modify. New CHECKs and the idempotent rebuild.
4. `tools/summary-backend/wrangler.toml`: modify. Remove `SUMMARY_MAX_USES`.
5. `tools/summary-backend/worker.test.ts`: modify. Legacy-migration, reservation, boundary, no-count-cap and kill cases (Verification). Expectations change first.
6. `tools/summary-backend/README.md`: modify. Rewrite §Bounds and metadata: the per-request bound and its sources, the kill detector, no use cap, and a note that the documented `d1 execute` command migrates in place.
7. `apps/mobile/src/summaryAccess.ts`: modify. `uses` is any nonnegative safe integer.
8. `apps/mobile/test/summary-flow.test.ts`: modify. The "bad-uses" value 5 becomes -1, since 5 is now valid.
9. `docs/specs/T2.10c-hosted-deepseek-eval.md`: modify in place. In §Bounds, the reservation and four-use sentences, and in Verification, the budget line, now state the final rule by pointing to this spec.
10. `docs/specs/T2.10d-mobile-rewarded-summary.md`: modify in place. Line 73 changes "uses (integer 0–4)" to "uses (nonnegative safe integer)".

No new dependencies. Pinned Wrangler 4.142.0 as prepared for C1.

## Sources

| Constant / behavior | Source |
|---|---|
| Model pin, DeepSeek host, context 1,048,576, base input US$0.30/M, output US$1.20/M, `max_tokens` 1,024, override/cache rates never lower the reservation | `docs/specs/T2.10c-hosted-deepseek-eval.md` §Sources row "Exact DeepSeek host/tag…" (endpoint JSON inspected 2026-09-27) and §Bounds; runtime preflight rechecks before every call |
| Tokens ≤ UTF-8 bytes: `model.type = "BPE"`, 128,000-entry vocab containing all 256 GPT-2 byte-level symbols, `normalizer` = empty Sequence, pre-tokenizer ends in `ByteLevel` (`use_regex: false`), 1,283 added special tokens (a special-token match only lowers the count) | `https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/dba1be0a40aa45a94ad051997016db3960a90277/tokenizer.json`, inspected by the architect 2026-09-29. This is the open-weights repo for the pinned `deepseek/deepseek-v4.1-flash` (created 2026-09-10, matching canonical slug `…-20260910`) |
| Rendered prompt = BOS + `<｜System｜>` + system content + `"\n\n## Response Format:\n\nYou MUST strictly adhere to the following schema to reply:\n"` + `json.dumps(response_format)` (default `", "`/`": "` separators, so at most 2× compact) + `<｜User｜>` + user content + `<｜Assistant｜></think>` | Same revision, `encoding/encoding.py`: `response_format_template`, `to_json`, `render_message`, `_encode_messages_text`; `encoding/README.md` §Basic chat |
| Hosted OpenRouter/DeepSeek rendering is undocumented; +4,096 margin and kill detector | Policy (this spec); the kill switch is the C1 mechanism (`openrouter.ts` `generate`) |
| JSON string escaping never shortens and at most doubles re-escaped content (`\"`, `\\`, `\uXXXX`) | ECMA-262 `JSON.stringify` / QuoteJSONString; RFC 8259 §7 |
| Real body sizes 7,518 / 7,518 / 6,735 bytes | Architect measurement with `prepareSummaryRequest` and C1's body construction over `fixtures/recordings/chevrolet-equinox-ev-2024/{2026-09-22-spike,2026-09-22-spike-2,2026-09-24-phone-console}.redacted.jsonl`; illustrative, not a code constant |
| Live local state: legacy CHECKs `uses BETWEEN 0 AND 4`, `reservation = 315802`; row `(1,0,0,NULL,0)`; 0 request rows | Read-only `sqlite3` inspection of `tools/summary-backend/.wrangler/state/v3/d1/…sqlite`, 2026-09-29 |
| No use cap; budget alone limits calls; live-state migration authorized for the orchestrator after review | Decisions 1–2 (owner, 2026-09-29) |

No OBD PID, AT command or DTC is touched.

## Verification

Shared: write the changed `worker.test.ts` expectations before the Worker/adapter code. All E2E cases go through the public Worker HTTP handler in the existing actual-D1 Wrangler harness, with synthetic upstream only, and add sanitized rows to `/tmp/t2.10c-local-e2e.json`. Never mock D1, the checker or `summarize`. Every existing case keeps its outcome category and completion count, except the ones this spec replaces. Its numeric expectations are recomputed from the per-request reservation `R` of that request, where `R = reservationFor(UTF-8 bytes of the captured /chat/completions body)`: `spent`, row `reservation`, status headroom, and the insufficient-budget offset.

The fixture entry's `local` env drops `SUMMARY_MAX_USES`. The "higher-uses" authority case is deleted. The top-level artifact field `reservationMicroUsd` becomes `reservationPolicy: { inputTokens: "min(1048576, 2*bodyBytes+4096)", outputTokens: 1024, inputTenthMicroUsdPerToken: 3, outputTenthMicroUsdPerToken: 12, useCap: null }`, and every request row carries its own `reservation`. No hash or byte-identical artifact comparison.

- [ ] **E2E, the real recordings.** For each of the three recording rows, the captured body yields a stored row `reservation === R` in the range 6,000–8,000, `spent` after cost settlement equals the actual (66), and no row holds 315,802.
- [ ] **E2E, legacy migration.** Before start, the harness applies an inline, labeled-synthetic copy of the legacy DDL (current `schema.sql` text) to the temp D1. It seeds `summary_budget (1,4,66,NULL,0)` (at the legacy cap) and one settled row `(legacy id, 'settled', 315802, 66, NULL)` with `d1 execute --command`, then applies the new `schema.sql` twice. `/__fixture` metadata shows the seeded budget and row unchanged. The existing crash-held case reapplies `schema.sql` with an inflight row and a held slot: budget and rows stay equal, and the slot stays held.
- [ ] **E2E, no count cap.** This replaces "four-cheap-settlements-fifth-denied". After a reset, six cheap calls in a row all return `llm`. `uses` reaches 6, and every stored row has a small `R`. This also proves both rebuilt CHECKs are active: the legacy ones would reject the fifth `uses` value and every new reservation.
- [ ] **E2E, budget is the only call limit.** This replaces "three-unknown-cost-fourth-denied".
  - Two unknown-cost calls from `spent = 1,000,000 − 2R` bring `spent` to exactly 1,000,000; the third call returns `budget-exhausted` with no completion.
  - A cheap call from `spent = 1,000,000 − R` is admitted and settles to `1,000,000 − R + 66`; the next call returns `budget-exhausted` with no completion.
  - Budget at `1,000,000 − R + 1` returns `budget-exhausted` with 0 completions (insufficient reservation). No C1 path returns `no-credit`.
- [ ] **E2E, key and status boundaries.**
  - Key `limit_remaining` 0.01 is now admitted (the legacy check denied it); `limit_remaining (R − 1)/1e6` returns `unavailable` with 0 completions.
  - Status after the crash-held case returns `{uses: 1, headroomMicroUsd: 1,000,000 − R, enabled: false}`. With no slot held, headroom 41,779 returns `enabled: false` and headroom 41,780 returns `enabled: true`.
- [ ] **E2E, UTF-8 size.** A request whose fact labels and values contain CJK and emoji text (a valid synthetic body) stores `R` computed from UTF-8 bytes. That value is strictly greater than the value computed from `string.length`.
- [ ] **E2E, kill cases.** `prompt_tokens = inputTokens + 1` with cost 0.000066 → `invalid-response`, `disabled = 1`, `spent` retains `R`. `prompt_tokens = inputTokens` → `llm`. Cost `(R + 1)/1e6` → kill. The existing excess-output and excess-input (1,048,577) cases are kept.
- [ ] **Phone projection.** `pnpm -F mobile test`: the summary-flow status test now accepts `uses: 5` (the existing valid path with a count above the old cap), and "bad-uses" (`-1`) still yields `budget: null` with the checked summary unchanged.
- [ ] **Isolated tests** (a second `it` in `worker.test.ts`, importing `reservationFor` and `maxSummaryBodyBytes`). Failure modes, listed before code:
  1. Rounds down instead of up at a fractional micro-USD value → `reservationFor(7518)` is `{inputTokens: 19132, microUsd: 6969}` (6,968.4 exact).
  2. Clamp missing or wrong, so a large body reserves more than the legacy full-context value → `reservationFor(522240)` and `reservationFor(10_000_000)` both return `{1048576, 315802}`.
  3. Margin or output term dropped → `reservationFor(0)` is `{4096, 2458}`.
  4. The status threshold disagrees with the body cap → `reservationFor(maxSummaryBodyBytes).microUsd === 41780`.

  All other failure modes (`string.length` counting, a stale constant in pre-check/preflight/reserve/settle, a mismatched UPDATE/INSERT value, a legacy CHECK left in place, a residual use cap, state reset) are covered by the E2E rows above. They get no unit tests.
- [ ] `pnpm dlx wrangler@4.142.0 --version` (preparation), `pnpm vitest run tools/summary-backend/worker.test.ts`, `pnpm -F mobile test`, `pnpm check` (includes `cd tools/hil-bridge && uv run ruff check . && uv run pytest`), `git diff --check`. Reviewer reruns the E2E and inspects the artifact rows above.
- [ ] **Orchestrator step after reviewer APPROVE (Decision 2; not an implementer step).**
  1. Before: read-only `sqlite3 -readonly` SELECT of `summary_budget`, `count(*)` from `summary_requests`, and `.schema`, on `tools/summary-backend/.wrangler/state/v3/d1/*.sqlite`. Record the values in the task record.
  2. Apply the reviewed file with the README's existing `pnpm dlx wrangler@4.142.0 d1 execute SUMMARY_DB --local --env local --config tools/summary-backend/wrangler.toml --file tools/summary-backend/schema.sql`.
  3. After: the same read-only SELECT shows an unchanged row (`uses 0, spent 0, inflight NULL, disabled 0`) and the same request count; `.schema` shows the new CHECKs; no `_next` tables remain.

  Any difference means stop and report; no repair or reset without the parent's authorization. `wrangler dev` must not be running during the step.
- [ ] **Paid phone gate** (T2.10d, unchanged, owner-authorized): the artifact `/tmp/t2.10d-local-phone.json` must show `inputTokens ≤` the request's reserved `inputTokens` and the settled cost ≤ `R`. This is the first real evidence for the hosted-rendering margin. NOT RUN here.
- [ ] Hardware (car): none.

## Risks / open questions

- **Largest risk: the hosted rendering is undocumented.** If OpenRouter/DeepSeek adds hidden prompt text larger than the 2× slack plus 4,096 tokens, one call can cost more than its reservation. That cost is still tiny in absolute terms, at most the legacy 315,802 per call. The kill switch then disables further calls, and the US$1 non-resetting key cap bounds money regardless. The expected real ratio is about 2,500 reported tokens against 19,132 reserved, so the margin is wide.
- **No count bound (accepted by the owner, Decision 1).** Calls are bounded only by money. Each unknown-cost call holds at least 2,458 micro-USD (at most about 406 such calls), while cheap settled calls could number about 1,000 before US$1. The development token, the one-in-flight slot and the private-host guard remain the only limits on how many reports go to DeepSeek.
- **Migration touches live local state.** It is a table rebuild without an explicit transaction. The self-healing statement order, the E2E and the orchestrator's read-only before/after check cover it.
- No open questions remain.

## Decisions

1. **Use cap (owner, 2026-09-29): option (c).** No use count. The US$1 durable budget alone limits calls. The per-request reservation, unknown-cost-holds-full, the kill switch, the key-cap preflight and the US$1 ceiling stay. `uses` remains an unbounded status counter, and the phone validates it as a nonnegative safe integer.
2. **Live local D1 migration (owner, 2026-09-29).** The orchestrator may apply the reviewed `schema.sql` to `tools/summary-backend/.wrangler` after reviewer approval, with a read-only before/after SELECT. The implementer does not touch that state.
