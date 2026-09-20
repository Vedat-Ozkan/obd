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

Codex discovers repository skills under `.agents/skills` and custom agents under `.codex/agents`. Project configuration requires project trust. Restart Codex if new files are not discovered; use `/skills` to check for `obd-feature`. If the skill is absent, explicitly ask Codex to read `.agents/skills/obd-feature/SKILL.md` and follow it for the task. If named agents are unavailable but delegation works, the skill supplies their instructions to ordinary subagents. If delegation itself is unavailable, it reports the missing independent review instead of claiming approval. See the official [skills](https://developers.openai.com/codex/skills), [subagents](https://developers.openai.com/codex/subagents), and [configuration](https://developers.openai.com/codex/config-basic) documentation.

`CODEX.md` is a human entry point, not a replacement for auto-loaded `AGENTS.md`. No `AGENTS.override.md` is added. Claude's `.claude/` permissions do not configure Codex; normal Codex sandbox approvals still apply.

## Completion, resuming, and Claude handoff

The orchestrator records the last tool and role, current and completed stages, spec path, approved decisions, baseline and touched files, exact verification commands and evidence, review findings, repair count, escalation count and reason, blocker, and next action in `docs/task-runs/<task-id>.md`. To resume or take over from Claude, first reconcile that record, the spec, working tree, and evidence; resume at the first incomplete or invalidated stage. If a transfer has no record, create one from only verifiable spec, tree, and evidence state. A genuinely new task starts repair and escalation counts at zero; incomplete imported history keeps those counts unknown. Never invent approvals, completed stages, findings, or counters; ask only when an unknown changes continuation or a repair/escalation limit. Completed architecture or implementation is reused only while its evidence remains valid. A receiving reviewer always reruns checks affected by current changes and every spec-required check before approval. Another user's unfinished changes are preserved, including untracked files.

Do not run Claude and Codex, or two roles, concurrently for one task. A transfer stops the current role before the receiving tool proceeds. In a Claude session, `/feature <task-id>` performs this reconciliation itself (see `docs/WORKFLOW.md`, Handoff section); the equivalent prompt in prose is:

```text
Take over <task-id> from Codex. Stop any active work first; reconcile its shared record when present, plus its spec, git status, and recorded evidence. If the record is absent, reconstruct it only from verifiable spec, tree, and evidence state; use zero counters only for a genuinely new task, otherwise leave imported history counts unknown and do not invent approvals, completed stages, or findings. Ask only if an unknown changes continuation or a repair/escalation limit. Preserve valid completed stages, resume the first incomplete or invalidated stage, independently rerun affected and spec-required checks before approval, and update the shared task record at every handoff.
```

Approval requires the reviewer's own successful `pnpm check` and the existing verification gates. There are at most two repair rounds after the initial review. Escalate a single affected stage at most once only after recording concrete insufficiency evidence, target tier, and reason; otherwise stop with a blocker. Remaining defects, missing tooling, and external checks are reported as FAIL or NOT RUN, with a concrete next step. Software approval with explicitly deferred hardware checks is not hardware verification or a completed phase milestone.

The README, `AGENTS.md`, `CLAUDE.md`, `.claude/`, and planning documents are authoritative reference material. Routine feature tasks add specs and reports without rewriting unrelated setup. User-authorized roadmap revisions update the affected documents and append an ADR while preserving historical specs and verification evidence.

ML1–ML6 follow the diagnostic baseline and precede EV delivery. Read `docs/ML.md` and `docs/EVAL.md` for those tasks. Record data/model provenance, grouped splits, reviewed targets, matched baselines, compute/spending choices, and reproducible experiment artifacts. Normal CI remains fixture-based; missing training or serving compute is NOT RUN and cannot use the vehicle hardware-only exception.

## Prerequisites and limits

Setup inspection on 2026-09-16 found Codex CLI 0.154.0, Node 22.13.0, pnpm 9.15.9, and Python 3.10.12 with no `uv` on PATH. During T0.1, `uv` 0.12.15 was installed to `~/.local/bin` and it manages a Python 3.11 for the bridge. No other tools are installed by this setup; the task preflight identifies what needs installation and follows the current execution permissions.

T0.2 requires sessions with the laptop, dongle, and cars. Later replay requirements depend on those recordings. Synthetic fixtures remain useful where the spec permits them, but do not replace required recordings. A missing required recording blocks the affected work; a separately identified hardware-only check can remain NOT RUN with instructions for obtaining evidence.

The phone build, cloud CI, live diagnostic API calls, and vehicle checks have their own prerequisites. Do not provide credentials in prompts or reports. Configure them through the existing secure mechanisms when the relevant task needs them. No keys or account access are needed merely to install this workflow.
