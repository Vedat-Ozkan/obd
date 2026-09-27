---
name: obd-feature
description: Complete one task from this OBD repository's plan through a written spec, implementation, independent review, and bounded repairs. Use for a requested task ID or a scoped OBD feature or fix, including resuming one; not for implementing the entire roadmap.
---

# One OBD task

Act as orchestrator. Read root `AGENTS.md`, `CODEX.md`, the requested entry in `docs/PLAN.md`, `docs/WORKFLOW.md`, and relevant existing specs. Project documents remain the source of truth; preserve Claude's setup. Work only on the requested task.

## Preflight and handoff

- Inspect actual files and `git status --short`, including pre-existing untracked work. Capture a task baseline so review can distinguish this task's edits from existing changes. Do not reset, stage, commit, or clean the user's work.
- Check required tools, source documents, fixtures, and prerequisite tasks. Do not install anything outside the task's spec. Required recordings and unsourced OBD values are blockers, not reasons to invent evidence.
- For a task ID, use the shared, tool-neutral `docs/task-runs/<task-id>.md` progress record. For a free-text request, assign an `X-<date>-<slug>` ID using the spec naming convention.
- The record's required contents, update points, and the reconciliation/resume/counter rules on a Claude/Codex transfer are defined once in `docs/WORKFLOW.md`, "Handoff between Claude and Codex" section; follow them unchanged. Ensure the other tool and role have stopped before taking over.

## Delegate the roles

Use separate fresh subagents for architecture, implementation, and review. Run them sequentially with only one worker active at a time; finish or close each before starting the next and never run beside Claude on the same task. The parent handles sequencing, questions, and the progress record, not product implementation. Give each bounded role context only the task, its spec when available, baseline, permitted files, relevant decisions, required source documents, and required output. No role may delegate or start a nested workflow.

Each role has parallel definitions in the two tools: `obd_architect`, `obd_implementer`, and `obd_reviewer` under `.codex/agents/`, and `architect`, `implementer`, and `reviewer` under `.claude/agents/`; prefer the client's native named agent. Two helper agents exist the same way — `obd_recording_analyst`/`recording-analyst` and `obd_test_runner`/`test-runner` — used where the steps below say so; skip them if the client lacks them. Its native model and reasoning-effort configuration is mandatory (`model`/`model_reasoning_effort` in the TOMLs, `model`/`effort` in the Claude frontmatter). If the client cannot select a named role, read the Codex TOML, use its `developer_instructions` in a fresh ordinary subagent, and pass the same model and reasoning override when the spawn tool supports it. If the fallback cannot honor that configuration or independent delegation is unavailable, stop that stage and report the limitation (review is NOT RUN). Do not launch nested CLI sessions to bypass unavailable delegation, model selection, or permissions.

1. **Architect — `obd_architect`**, `.codex/agents/obd_architect.toml`: write the task spec using `docs/specs/README.md`. Check sources, dependencies, prerequisites, and exact verification commands. Split an oversized task into ordered specs within its scope; do not advance to another plan task. Resume an existing suitable spec instead of duplicating it. Questions about what a recording contains go to the `obd_recording_analyst` / `recording-analyst` agent, so raw recordings are never read in the main conversation.
2. **Questions:** surface material open questions before dependent implementation and record answers in the spec's Decisions section. The user's choice of this automatic workflow supplies routine scope confirmation; summarize Goal / Non-goals / Files and proceed when there are no material questions. Do not infer answers about changed scope or missing evidence. Permission requests still follow the active sandbox rules.
3. **Implementer — `obd_implementer`**, `.codex/agents/obd_implementer.toml`: build the spec and return the verification report. A source, dependency, or spec conflict returns to the architect/orchestrator; the implementer must not silently rewrite the contract.
4. **Reviewer — `obd_reviewer`**, `.codex/agents/obd_reviewer.toml`: inspect this task's complete changes, including untracked additions, and independently rerun checks. Review begins only after implementation stops. Preserve the verdict and findings in the progress record. Route check and test runs through the `obd_test_runner` / `test-runner` agent so their output never floods the main conversation.
5. **Repair:** on REQUEST_CHANGES, give a fresh implementer the spec and findings, then obtain another independent review. Allow at most two repair rounds after the initial review, across resumptions. If still unapproved, stop with the remaining findings. A material spec revision goes back through architecture and any needed user decision.
6. **Close:** summarize changed files, reviewer verdict, verification PASS / FAIL / NOT RUN with reasons, and next action. On APPROVE, describe software as approved under the existing workflow gate; explicitly list pending hardware checks. Do not tick the plan, claim a phase milestone, commit, publish, or start the next task.

## Bounded escalation

Escalate only the affected role and stage, and only after recording concrete evidence its default tier is insufficient: unresolved cross-package design ambiguity, repeated failure on the same implementation defect, or review of a high-risk protocol or safety change. A named role's fixed tier takes precedence over spawn overrides, so escalating means a fresh ordinary subagent carrying that role's instructions plus an explicit elevated model/reasoning override. Record the evidence, target tier, and reason in `docs/task-runs/<task-id>.md`; retry that stage at most once. Never upgrade unrelated roles or default to the strongest model. If the retry is still insufficient, stop with a concrete blocker or surface a material question rather than escalating further.

## Evidence boundaries

Evidence and testing standards are defined once: `AGENTS.md` Testing rules and hard rules 1-5 (constant sourcing, immutable recordings, core purity, read-only vehicle access), and `docs/WORKFLOW.md` "Hardware in the loop" section; follow them unchanged. Do not contact the vehicle without an owner-arranged session; clearing codes always requires the explicit confirmation required by `AGENTS.md`.

Before the scaffold exists, report absent commands as NOT RUN. Do not substitute this workflow's syntax checks for product `pnpm check`. The user's selection of this workflow authorizes routine work within the approved task; surface real scope, design, source, recording, or safety questions before dependent work. Keep the last valid spec and a precise blocker/next action so the same task can resume.
