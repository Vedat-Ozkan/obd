# X-2026-09-16: Codex task workflow

## Goal
Add a Codex entry point for one task per request: automatic architect, implementer, independent reviewer, and at most two repair rounds. Preserve every existing file from Claude's setup and allow the task to transfer between Claude and Codex without repeating completed stages.

## Non-goals
- Implement T0.1 or any product feature; install project tooling or dependencies.
- Change Claude's agents, the shared instructions, plan, architecture, or verification gates.
- Change global Codex settings or relax execution permissions.
- Run Claude and Codex on the same task concurrently.

## Interfaces
Invoke `$obd-feature T0.1` from Codex in the repository. Custom agents are `obd_architect`, `obd_implementer`, and `obd_reviewer`. The orchestrator persists subsequent task progress in the tool-neutral `docs/task-runs/<task-id>.md` record shared with Claude.

Only one tool and one role may actively own a task at a time. A transfer closes or stops the current role before the other tool continues. The receiving tool reconciles the shared record, spec, working tree, and recorded evidence; it resumes at the first incomplete or invalidated stage rather than rerunning valid architecture or implementation work. Independent review is never inherited as trust: a receiving reviewer reruns every check affected by the current changes and all checks required by the spec before approving.

Default role tiers favor cost-efficient, separate contexts rather than the strongest model everywhere:

- Coordinator: `gpt-5.6-sol`, medium reasoning, shown in the `CODEX.md` CLI example.
- Architect: `gpt-5.6-sol`, medium reasoning.
- Implementer: `gpt-5.6-terra`, medium reasoning.
- Reviewer: `gpt-5.6-sol`, high reasoning.

Escalation is role-local and bounded. Escalate only after concrete evidence that the default tier is insufficient, such as unresolved cross-package design ambiguity, repeated implementation failure on the same defect, or review of a high-risk protocol/safety change. Record the reason and target tier in the shared task record, retry only the affected stage, and allow at most one model-tier escalation for that stage before stopping with a blocker. Do not upgrade unrelated roles or select the strongest model by default.

## Files
- `CODEX.md` — create — usage, prerequisites, preservation rules, and limits.
- `.agents/skills/obd-feature/SKILL.md` — create — one-task orchestration.
- `.codex/agents/obd_architect.toml` — create — spec-only role.
- `.codex/agents/obd_implementer.toml` — create — implementation role.
- `.codex/agents/obd_reviewer.toml` — create — independent review role.
- This spec — create — setup contract and validation record.

The setup changes at most these six files. Future task execution may create its task spec and `docs/task-runs/<task-id>.md`; those are task artifacts, not additional setup files.

## Sources
No OBD constants or new dependencies. Codex discovery and configuration follow the official [skills](https://developers.openai.com/codex/skills) and [subagents](https://developers.openai.com/codex/subagents) documentation. Project workflow comes from `docs/WORKFLOW.md` and `.claude/agents/`.

## Verification
- Validate the skill with the installed skill-creator `scripts/quick_validate.py`.
- Parse each TOML file and check its required custom-agent fields.
- Check that `CODEX.md` shows the coordinator tier and that the role configurations use the specified model/reasoning overrides without defaulting every role to the strongest model.
- Independently review workflow behavior for a scaffold task, absent required recordings, material questions, failed reviews, and resuming or transferring a task between Claude and Codex.
- Confirm the workflow never runs Claude and Codex, or two roles, concurrently on one task; preserves completed valid stages on transfer; and requires the independent reviewer to rerun affected and spec-required checks.
- Confirm every future handoff updates `docs/task-runs/<task-id>.md`. Its minimum transfer state is last tool and role, current stage and completed stages, spec path, approved decisions, baseline and touched files, exact verification commands and evidence, remaining review findings, repair count, escalation count and reason, current blocker, and next action.
- Compare SHA-256 hashes of all pre-existing repository files with the pre-edit baseline.
- `pnpm check`: NOT RUN for this setup change because no package manifest or check script exists yet. This does not waive the gate for subsequent product tasks.
- Live feature execution and hardware verification: NOT RUN; this request adds workflow files only.

## Risks / open questions
The installed CLI is 0.154.0. Discovery in a fresh session must be distinguished from file syntax validation. Protected `.agents` and `.codex` paths may require sandbox approval to install. Node and pnpm are available; `uv` is absent from PATH, and the available Python is 3.10.12 while the bridge plan calls for 3.11+.

## Decisions
The user selected one task at a time with automatic spec → implementation → review. This authorizes sequencing within that task without another routine scope approval. Material ambiguities still require answers before dependent implementation. Missing mandatory recordings block dependent work; optional hardware checks are reported honestly.

Claude and Codex alternate sequentially when a task crosses tools; they never work on the same task concurrently. The shared handoff is `docs/task-runs/<task-id>.md`, not a tool-owned run directory. Valid completed stages are reused after reconciliation, while independent review always reruns checks affected by the implementation and every check the spec requires for approval.

The default Codex coordinator is `gpt-5.6-sol`/medium; roles are architect `gpt-5.6-sol`/medium, implementer `gpt-5.6-terra`/medium, and reviewer `gpt-5.6-sol`/high. A single affected-stage escalation is permitted only when recorded evidence shows the default tier is insufficient; otherwise the workflow stops and reports the blocker.
