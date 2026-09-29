# Local summary Worker (T2.10c C1)

This development service is disabled by default. It accepts only an exact configured local host, a separate development token and per-request `t2.10-openrouter-deepseek-v1` consent. It pins `deepseek/deepseek-v4.1-flash` to the DeepSeek host through OpenRouter, with no retry or alternate route. The server and phone must both check the summary against their typed facts. Errors preserve the offline report.

## Owner setup after independent C1 and D1 reviews

Run from the repository root. Before creating any secret file:

```bash
git check-ignore tools/summary-backend/.dev.vars
```

Privately create a separate OpenRouter key with a **non-resetting US$1 limit**, inside the existing US$5 evaluation budget. Never paste the key or development token into chat. In gitignored `tools/summary-backend/.dev.vars`, set `OPENROUTER_API_KEY`, `SUMMARY_DEV_ENABLED=1`, `SUMMARY_DEV_HOST` to the laptop's exact loopback/private IPv4 hostname, and `SUMMARY_DEV_TOKEN` to an independently generated random token of at least 32 characters. Token and provider key must differ. Do not use `.dev.vars.local`, beta credentials or `EXPO_PUBLIC_*`. The phone holds the development token only in memory, entered through a masked field.

```bash
pnpm dlx wrangler@4.142.0 d1 execute SUMMARY_DB --local --env local --config tools/summary-backend/wrangler.toml --file tools/summary-backend/schema.sql
pnpm dlx wrangler@4.142.0 dev --local --env local --config tools/summary-backend/wrangler.toml --ip 0.0.0.0 --port 8788
```

Both commands use the same default persistent state under `tools/summary-backend/.wrangler/state/`. The E2E harness proves this with a temporary config directory, schema initialization, HTTP settlement, restart and schema reapplication without resetting credit. It also verifies that pinned Wrangler `--env local` reads the base `.dev.vars` when `.dev.vars.local` is absent, using only a synthetic non-secret marker. Keep those files and state local. No tunnel, remote preview, production deployment or reset is authorized.

Wrangler locally supplies `cf-connecting-ip`. Only absent or canonical loopback/private IPv4 peers are permitted. Any `cf-ray`, `forwarded` or `x-forwarded-*` header is rejected; permitted peer metadata never replaces host, token or enabled checks. Plain HTTP is only for the owner-controlled laptop/phone development network. If Android blocks it, surface that issue before selecting an existing supported local connection configuration; do not weaken production security or add a native dependency.

Before a live phone tap, the owner/reviewer records the actual free catalog and endpoint URLs, check time and SHA-256 in a sanitized local artifact. Runtime fetch repeats validation (15-minute in-memory metadata cache, no key-limit cache). Endpoint `response_format` and `reasoning` do not establish strict JSON-schema or disabled-reasoning compatibility; the paid phone gate must record actual compatibility. No paid generation occurs in the tests.

## Bounds and metadata

The US$1 durable ceiling is fixed and is the only limit on the number of calls (there is no use count; `uses` is a counter). Each call reserves a bound derived from the exact outgoing `/chat/completions` body: `inputTokens = min(1,048,576, 2 x bodyBytes + 4096)` (`bodyBytes` is the UTF-8 length) at US$0.30/M, plus 1,024 output tokens at US$1.20/M, rounded up to whole micro-USD. A real report (about 7.5 KB) reserves about 7,000 micro-USD; the full-context value 315,802 is the clamp and the schema's upper limit. Bodies over 65,536 bytes are rejected as `invalid-request` (a valid 16 KiB input cannot reach that), so `GET /v1/status` `enabled` (headroom for the largest admissible reservation, 41,780 micro-USD) is a true bound. Discounts/cache savings never reduce a reservation; unknown cost keeps the request's full reservation. The provider's per-key cap is independently checked against that reservation before every generation.

Why it is an upper bound: the pinned tokenizer is byte-level BPE (all 256 byte symbols in the base vocabulary, empty normalizer), so any text encodes to at most its UTF-8 byte count in tokens. The reference prompt format renders the system content, a fixed response-format preamble, the schema re-serialized with default separators (at most twice its compact size) and the user content; the body carries each of these JSON-escaped, and escaping never shortens a string, so `2 x bodyBytes` covers the rendered text. The 4,096 tokens are a policy margin for special tokens and undisclosed hosted-side additions. Sources: tokenizer and `encoding/` files of `deepseek-ai/DeepSeek-V4.1-Flash` revision `dba1be0a40aa45a94ad051997016db3960a90277`, and `docs/specs/X-2026-09-29-summary-reservation.md` (Sources). The hosted rendering itself is undocumented, so a detector backs the bound: a reported `prompt_tokens` above the request's reserved input tokens, an output above 1,024 tokens, or a cost above the reservation disables further calls (kill switch) and the ledger keeps at least the reservation. A tripped kill means the assumption failed; stop and return it to architecture. The provider key's non-resetting US$1 cap remains the hard money limit.

Re-running `schema.sql` (the `d1 execute` command above) migrates an existing local database in place: it rebuilds both tables with the current CHECKs and keeps the budget row and request rows. Stop `wrangler dev` first and never delete `.wrangler` state.

`GET /v1/status` requires the development token and returns only `uses`, `headroomMicroUsd` and `enabled` (its `enabled` threshold is the largest summary reservation). No report, key, token, peer IP or retry summary is persisted. A consumed request ID is permanently rejected even with a changed body. An unresolved reservation survives restart and blocks further calls. Do not delete/reset state, change keys or refund ambiguous calls to obtain more credit. Stop and request parent authorization for any repair. Kill switch: disable `SUMMARY_DEV_ENABLED` and revoke the dedicated key.

For the later owner phone artifact `/tmp/t2.10d-local-phone.json`, save only consent version, request ID, returned model, enforced pin/dated snapshot digest/rates, tokens/cost/latency, checked display category and cumulative budget. `SummaryUsage.provider` identifies the configured DeepSeek pin; absent returned-provider evidence is unknown. Do not save key documents, labels, facts, raw responses or errors. Observability and Worker logging stay off.

## Assistant turns and the four-arm comparison (T2.11b)

`POST /v1/assistant/turns` runs one assistant round for the phone or the eval CLI: `{ requestId, model, consentVersion, turn }`. It has the same guard as `/v1/summaries` (default-disabled, exact private host, development token, no forwarding headers) and makes at most one bounded OpenRouter call. The Worker holds no user data and never runs a tool: it checks that the reply names an allowlisted tool, or that an answer passes the same fact check as the summary (`checkFacts`), and returns `{ kind: "reply", reply, usage }` or `{ kind: "fallback", reason }`. Design and sources: `docs/specs/T2.11b-assistant-backend-live-eval.md`.

Four arms are pinned in `openrouter.ts` (`pins`), each to one OpenRouter host with no fallback routing, the same system prompt, strict reply schema, `max_tokens` 1,024 and reasoning off:

| Arm | Model | Host (tag) | Consent version |
|---|---|---|---|
| A | `deepseek/deepseek-v4.1-flash` | DeepSeek (`deepseek`) | `t2.11-openrouter-deepseek-v1` |
| B | `deepseek/deepseek-v4-pro-0813` | DeepSeek (`deepseek`) | `t2.11-openrouter-compare-eval-v1` |
| C | `xiaomi/mimo-v2.6-pro` | Xiaomi (`xiaomi/fp8`) | `t2.11-openrouter-compare-eval-v1` |
| D | `moonshotai/kimi-k3` | Moonshot AI (`moonshotai/mxfp4`) | `t2.11-openrouter-compare-eval-v1` |

Arms B to D are refused (`unavailable`) unless `SUMMARY_COMPARE_ENABLED=1` is set in `.dev.vars`; a wrong or missing consent version for the model is `consent-required`. Preflight validates each pin's catalog entry, host tag, rates against the pin's ceilings and required parameters (C and D also need `structured_outputs`; the DeepSeek host does not advertise it, and the paid phone check decides whether it is accepted). A body over 32,768 bytes, more than 4 steps or more than 64 facts per step is `invalid-request`.

**One budget.** Summaries and assistant turns share the one key, its US$1 cap and the one D1 ledger; there is no separate assistant budget or use cap. Each call reserves `reservationFor(its own body bytes, its pin)` (same rules as above, at the pin's ceiling rates; at the 32,768-byte cap: A 22,119, B 101,581, C 35,738, D 224,256 micro-USD, all under the D1 CHECK). A held slot blocks both routes. `GET /v1/status` is unchanged and is the one shared view.

**Comparison runbook (paid; owner-authorized only, after the T2.10 phone check).** With `SUMMARY_COMPARE_ENABLED=1` in the gitignored `.dev.vars` and `wrangler dev --local` running:

```bash
node --env-file=tools/summary-backend/.dev.vars --import tsx tools/summary-backend/assistant-eval.ts \
  --url http://<SUMMARY_DEV_HOST>:8788 --questions fixtures/synthetic/t2.11-question-set.json \
  --models deepseek/deepseek-v4.1-flash,xiaomi/mimo-v2.6-pro,deepseek/deepseek-v4-pro-0813,moonshotai/kimi-k3 \
  --max-spend-usd 0.05,0.05,0.15,0.25 --out /tmp/t2.11b-live-eval.json --save-replies fixtures/model-output/
```

The CLI asks the 12 frozen T2.11a questions once per arm, cheapest first, and never retries. Before each question it reads `/v1/status`; when an arm's spend has reached its `--max-spend-usd` value the rest of that arm is `NOT RUN (spend cap)`, and a `budget-exhausted` or `unavailable` answer stops the arm (`NOT RUN (budget)`). The artifact holds per-question rows (trace, verdicts, per-round tokens including reasoning tokens, provider cost, estimate, reservation, latencies), the injection verdict (q10 against q04), a `comparison` block with denominators (real and synthetic reported separately, cost per answer against the US$0.01 and US$0.05 targets, latency) and each arm's shared-budget `spent` before and after. It never writes the token or key. `--save-replies` writes `t2.11-live-<model>.json` only for an arm whose 12 questions all ran (a partial file would break the CI replay), labeled recorded live model output; those files are never hand-edited and are committed only after the owner has read every reply.

Spend plan (an estimate, not a measurement): about US$0.28 for the four arms, planned maximum about US$0.61 (the stop rules plus at most one thorough question of overshoot per arm), leaving at least about US$0.39 of the shared US$1 for the T2.10 phone check and summaries.

The offline dry run (part of `worker.test.ts`) runs this same CLI against the harness with synthetic upstream replies and metadata. The extra flag `--synthetic-metadata-base <url>` marks such a run: metadata comes from that URL and the artifact and saved files are labeled SYNTHETIC. It is never used with the live key. Outputs: `/tmp/t2.11b-eval-dry.json` (all arms), `/tmp/t2.11b-eval-dry-cap.json` (tiny caps) and `/tmp/t2.11b-eval-dry-budget.json` (budget stop).

## Reproducible software gates

Cached Wrangler **4.142.0** is required. The test discovers that exact version in the configured pnpm cache and never installs tools. It creates a temporary Worker entry whose fetch is entirely synthetic and cannot reach OpenRouter, running actual D1 for every HTTP replay/race/credit/restart case. Synthetic responses are not hardware or live-provider evidence.

On first use, prepare the pinned tool before running tests. Preparation may install it; test execution may not. Preparation and all gates must use the same `XDG_CACHE_HOME`. CI initializes `$RUNNER_TEMP/t210-ci-cache` through `$GITHUB_ENV` before tool setup. To reproduce a fresh cache locally, run the following in one shell; the temporary store keeps downloads under the same writable prefix:

```bash
T210_CI_ROOT=$(mktemp -d /tmp/t210-ci-XXXXXX)
export XDG_CACHE_HOME="$T210_CI_ROOT/cache"
export npm_config_store_dir="$T210_CI_ROOT/store"
export WRANGLER_SEND_METRICS=false
export CI=true
pnpm dlx wrangler@4.142.0 --version
pnpm vitest run tools/summary-backend/worker.test.ts
pnpm -F obd-assist test
pnpm check
git diff --check
```

The artifact contains local immutable recording paths, synthetic case categories, checked display, provider call counts and durable integer metadata. It excludes runtime ports, temp paths, IDs, dates, facts and credentials. Independent review must rerun it and check it. Live phone, ads/SSV, production entitlement and C2 evaluation remain separate gates.
