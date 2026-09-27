# Codex workflow

Codex handles one task from `docs/PLAN.md` per request, using the existing architect → implementer → reviewer contract. `AGENTS.md` and the project documents remain authoritative. Claude's setup remains unchanged.

## Start a task

Open Codex from this repository and send:

```text
$obd-feature T0.1
```

Or launch from a shell, using the model the architect/coordinator agent is configured with:

```sh
codex --model gpt-6-sol --config model_reasoning_effort="medium" '$obd-feature T0.1'
```

The single quotes keep the shell from expanding `$obd`. That shell launch selects the coordinator model and reasoning effort explicitly; an existing session keeps its selected coordinator model. Each role's model and reasoning effort are set in its `.codex/agents/*.toml` (`model`/`model_reasoning_effort`), not here; consult those files for the current tier per role. T0.1 above illustrates invocation syntax; the scaffold now exists. Select the next incomplete task from `docs/PLAN.md` and reconcile its task record before starting.

The skill delegates to `obd_architect`, `obd_implementer`, and `obd_reviewer` in sequence, with `obd_recording_analyst` for questions about what a recording contains and `obd_test_runner` for check and test runs, so large recordings and check output never reach the main conversation. It asks about material missing decisions before implementation, then implements, checks, reviews, and repairs within the requested task. Selecting this automatic workflow supplies the routine scope authorization; you do not need to approve the same task again. It does not start the next task or commit changes.

## Files and discovery

| File | Purpose |
|---|---|
| `.agents/skills/obd-feature/SKILL.md` | Discoverable task workflow |
| `.codex/agents/obd_architect.toml` | Spec author; no application edits |
| `.codex/agents/obd_implementer.toml` | Builds and tests the spec |
| `.codex/agents/obd_reviewer.toml` | Independent review; no source edits |
| `.codex/agents/obd_recording_analyst.toml` | Answers questions about `fixtures/recordings/` with line citations; never edits recordings |
| `.codex/agents/obd_test_runner.toml` | Runs checks and test suites, reports only failures; never edits files |
| `docs/task-runs/<task-id>.md` | Tool-neutral task state, handoff, and verification evidence shared with Claude |

Codex discovers repository skills under `.agents/skills` and custom agents under `.codex/agents`. Project configuration requires project trust. Restart Codex if new files are not discovered; use `/skills` to check for `obd-feature`. If the skill is absent, explicitly ask Codex to read `.agents/skills/obd-feature/SKILL.md` and follow it for the task. If named agents are unavailable but delegation works, the skill supplies their instructions to ordinary subagents. If delegation itself is unavailable, it reports the missing independent review instead of claiming approval.

`CODEX.md` is a human entry point, not a replacement for auto-loaded `AGENTS.md`. No `AGENTS.override.md` is added. Claude's `.claude/` permissions do not configure Codex; normal Codex sandbox approvals still apply.

## Handoff, completion, resuming

The handoff contract (task record, reconciliation rules, counters, one-tool-one-role) is defined once in `docs/WORKFLOW.md`, "Handoff between Claude and Codex" section; completion gates are in that document's "Definition of done" section. Both apply to Codex unchanged. To take over a task from Claude, run `$obd-feature <task-id>`; it performs the reconciliation itself.

## ML and battery tasks

BM1–BM9 (battery ML and LLM evals) follow the Phase 2 battery work (ADR-012). Read `docs/ML.md` and `docs/EVAL.md` for those tasks and for the LLM features (T2.10, T2.11). Record data/model provenance, consent, splits grouped by vehicle and session, baselines, compute/spending choices, and reproducible experiment artifacts. Normal CI remains fixture-based and follows the Testing rules in `AGENTS.md`; a missing training or eval run is NOT RUN and cannot use the vehicle hardware-only exception.

## Scope limits

The README, `AGENTS.md`, `CLAUDE.md`, `.claude/`, and planning documents are authoritative reference material. Routine feature tasks add specs and reports without rewriting unrelated setup. User-authorized roadmap revisions update the affected documents and append an ADR while preserving historical specs and verification evidence. Setup inspection on 2026-09-16 found the baseline toolchain (Codex CLI, Node 22, pnpm 9, Python 3.10; `uv` 0.12.15 added to `~/.local/bin` during T0.1); the task preflight identifies what needs installation and follows the current execution permissions. Do not provide credentials in prompts or reports; configure them through the existing secure mechanisms.
