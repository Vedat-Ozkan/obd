# Codex workflow

Codex handles one task from `docs/PLAN.md` per request, using the existing architect → implementer → reviewer contract. `AGENTS.md` and the project documents remain authoritative. Claude's setup remains unchanged.

## Start a task

Open Codex from this repository and send:

```text
$obd-feature T0.1
```

Or launch the economical coordinator tier from a shell:

```sh
codex --model gpt-5.6-sol --config model_reasoning_effort="medium" '$obd-feature T0.1'
```

The single quotes keep the shell from expanding `$obd`. That shell launch selects the `gpt-5.6-sol` coordinator with medium reasoning; an existing session keeps its selected coordinator model. In either case, roles use fixed, economical tiers: architect `gpt-5.6-sol`/medium, implementer `gpt-5.6-terra`/medium, and reviewer `gpt-5.6-sol`/high. T0.1 above illustrates invocation syntax; the scaffold now exists. Select the next incomplete task from `docs/PLAN.md` and reconcile its task record before starting.

The skill delegates to `obd_architect`, `obd_implementer`, and `obd_reviewer` in sequence. It asks about material missing decisions before implementation, then implements, checks, reviews, and repairs within the requested task. Selecting this automatic workflow supplies the routine scope authorization; you do not need to approve the same task again. It does not start the next task or commit changes.

## Files and discovery

| File | Purpose |
|---|---|
| `.agents/skills/obd-feature/SKILL.md` | Discoverable task workflow |
| `.codex/agents/obd_architect.toml` | Spec author; no application edits |
| `.codex/agents/obd_implementer.toml` | Builds and tests the spec |
| `.codex/agents/obd_reviewer.toml` | Independent review; no source edits |
| `docs/task-runs/<task-id>.md` | Tool-neutral task state, handoff, and verification evidence shared with Claude |

Codex discovers repository skills under `.agents/skills` and custom agents under `.codex/agents`. Project configuration requires project trust. Restart Codex if new files are not discovered; use `/skills` to check for `obd-feature`. If the skill is absent, explicitly ask Codex to read `.agents/skills/obd-feature/SKILL.md` and follow it for the task. If named agents are unavailable but delegation works, the skill supplies their instructions to ordinary subagents. If delegation itself is unavailable, it reports the missing independent review instead of claiming approval.

`CODEX.md` is a human entry point, not a replacement for auto-loaded `AGENTS.md`. No `AGENTS.override.md` is added. Claude's `.claude/` permissions do not configure Codex; normal Codex sandbox approvals still apply.

## Handoff, completion, resuming

The handoff contract between Claude and Codex — the task record, reconciliation rules, counters, and one-tool-one-role — is defined once in `docs/WORKFLOW.md`, Handoff section, and applies to Codex unchanged. To take over a task from Claude, run `$obd-feature <task-id>`; it performs the reconciliation itself.

Approval requires the reviewer's own successful `pnpm check` and the existing verification gates. There are at most two repair rounds after the initial review. Escalate a single affected stage at most once only after recording concrete insufficiency evidence, target tier, and reason; otherwise stop with a blocker. Remaining defects, missing tooling, and external checks are reported as FAIL or NOT RUN, with a concrete next step. Software approval with explicitly deferred hardware checks is not hardware verification or a completed phase milestone.

## ML and battery tasks

BM1–BM9 (battery ML and LLM evals) follow the Phase 2 battery work (ADR-012). Read `docs/ML.md` and `docs/EVAL.md` for those tasks and for the LLM features (T2.10, T2.11). Record data/model provenance, consent, splits grouped by vehicle and session, baselines, compute/spending choices, and reproducible experiment artifacts. Normal CI remains fixture-based and follows the Testing rules in `AGENTS.md`; a missing training or eval run is NOT RUN and cannot use the vehicle hardware-only exception.

## Scope limits

The README, `AGENTS.md`, `CLAUDE.md`, `.claude/`, and planning documents are authoritative reference material. Routine feature tasks add specs and reports without rewriting unrelated setup. User-authorized roadmap revisions update the affected documents and append an ADR while preserving historical specs and verification evidence. Setup inspection on 2026-09-16 found the baseline toolchain (Codex CLI, Node 22, pnpm 9, Python 3.10; `uv` 0.12.15 added to `~/.local/bin` during T0.1); the task preflight identifies what needs installation and follows the current execution permissions. Do not provide credentials in prompts or reports; configure them through the existing secure mechanisms.
