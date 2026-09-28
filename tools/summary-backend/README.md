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

The four-use maximum and US$1 durable ceiling are fixed. Each call reserves **315,802 micro-USD** against the full 1,048,576-token context at US$0.30/M input plus 1,024 tokens at US$1.20/M output. Discounts/cache savings never reduce this reservation. Three unknown-cost calls hold 947,406 micro-USD and deny a fourth; validated cheap settlement can permit four uses, never five. The provider's per-key cap is independently checked before every generation.

`GET /v1/status` requires the development token and returns only `uses`, `headroomMicroUsd` and `enabled`. No report, key, token, peer IP or retry summary is persisted. A consumed request ID is permanently rejected even with a changed body. An unresolved reservation survives restart and blocks further calls. Do not delete/reset state, change keys or refund ambiguous calls to obtain more credit. Stop and request parent authorization for any repair. Kill switch: disable `SUMMARY_DEV_ENABLED` and revoke the dedicated key.

For the later owner phone artifact `/tmp/t2.10d-local-phone.json`, save only consent version, request ID, returned model, enforced pin/dated snapshot digest/rates, tokens/cost/latency, checked display category and cumulative budget. `SummaryUsage.provider` identifies the configured DeepSeek pin; absent returned-provider evidence is unknown. Do not save key documents, labels, facts, raw responses or errors. Observability and Worker logging stay off.

## Reproducible software gates

Cached Wrangler **4.142.0** is required. The test discovers that exact version in the configured pnpm cache and never installs tools. It creates a temporary Worker entry whose fetch is entirely synthetic and cannot reach OpenRouter, running actual D1 for every HTTP replay/race/credit/restart case. Synthetic responses are not hardware or live-provider evidence.

On first use, prepare the pinned tool before running tests. Preparation may install it; test execution may not. Preparation and all gates must use the same `XDG_CACHE_HOME`. CI shares `${{ runner.temp }}/t210-ci-cache` across the job. To reproduce a fresh cache locally, run the following in one shell; the temporary store keeps downloads under the same writable prefix:

```bash
T210_CI_ROOT=$(mktemp -d /tmp/t210-ci-XXXXXX)
export XDG_CACHE_HOME="$T210_CI_ROOT/cache"
export npm_config_store_dir="$T210_CI_ROOT/store"
export WRANGLER_SEND_METRICS=false
export CI=true
pnpm dlx wrangler@4.142.0 --version
pnpm vitest run tools/summary-backend/worker.test.ts
cp /tmp/t2.10c-local-e2e.json /tmp/t2.10c-local-e2e-first.json
pnpm vitest run tools/summary-backend/worker.test.ts
diff -u /tmp/t2.10c-local-e2e-first.json /tmp/t2.10c-local-e2e.json
sha256sum /tmp/t2.10c-local-e2e.json
pnpm -F obd-assist test
pnpm check
git diff --check
```

The artifact contains local immutable recording paths/digests, synthetic case categories, checked display, provider call counts and durable integer metadata. It excludes runtime ports, temp paths, IDs, dates, facts and credentials. Independent review must regenerate it. Live phone, ads/SSV, production entitlement and C2 evaluation remain separate gates.
