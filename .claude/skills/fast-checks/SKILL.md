---
name: fast-checks
description: How to check a change quickly in this repo without the full `pnpm check`. Use before running any typecheck, lint or test.
user-invocable: false
---
# Scoped checks
- Fresh worktree: `pnpm install --frozen-lockfile --offline 2>&1 | tail -5` once before anything else.
- Typecheck: `pnpm exec tsc --noEmit` covers `packages/` and the Node tools (about 6 s); add `pnpm -F mobile typecheck` when `apps/mobile` changed.
- Lint only the files you touched: `node_modules/.bin/eslint <files>` (eslint also runs `--fix` on every edit through a hook).
- One test file: `pnpm exec vitest run <path/to/file.test.ts>` (sub-second). One package: `pnpm -F <obd-core|obd-battery|obd-assist|mobile> test`
  (obd-core about 50 s, mobile about 2 min). Node tools: `pnpm exec vitest run tools/<relay|beta-backend|beta-intake|summary-backend>`.
- Python: `cd tools/hil-bridge && uv run ruff check . && uv run pytest -q`.
- E2E replays: `pnpm replay <recording.jsonl>` and the report scripts in the root `package.json`; write artifacts under `/tmp`.
- Append `2>&1 | tail -40` to every command; read errors from the top with `grep` if needed.
- Prefer one run that proves several things over many tiny runs; run a whole package only when its public entry point changed.
- Never run full `pnpm check` in a worktree (hook-blocked): the integrator runs it on main through `test-runner`.
- A `Stop` hook reruns the tests of every package you changed and blocks finishing while they fail (`OBD_SKIP_GATE=1` bypasses it).
