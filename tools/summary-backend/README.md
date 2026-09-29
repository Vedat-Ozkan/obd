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

`GET /v1/status` requires the development token and returns only `uses`, `headroomMicroUsd` and `enabled`. No report, key, token, peer IP or retry summary is persisted. A consumed request ID is permanently rejected even with a changed body. An unresolved reservation survives restart and blocks further calls. Do not delete/reset state, change keys or refund ambiguous calls to obtain more credit. Stop and request parent authorization for any repair. Kill switch: disable `SUMMARY_DEV_ENABLED` and revoke the dedicated key.

For the later owner phone artifact `/tmp/t2.10d-local-phone.json`, save only consent version, request ID, returned model, enforced pin/dated snapshot digest/rates, tokens/cost/latency, checked display category and cumulative budget. `SummaryUsage.provider` identifies the configured DeepSeek pin; absent returned-provider evidence is unknown. Do not save key documents, labels, facts, raw responses or errors. Observability and Worker logging stay off.

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
