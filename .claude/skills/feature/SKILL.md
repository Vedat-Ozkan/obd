---
name: feature
description: Drive one task through the architect → implementer → reviewer loop. Usage: /feature T0.4 (a task id from docs/PLAN.md) or /feature "free-text request".
---

Run the three-agent loop for the task given in the arguments. You are the orchestrator; you do not implement.

0. **Record.** Read `docs/task-runs/<task-id>.md` if it exists (for free-text requests the id is `X-<date>-<slug>`). If it exists, reconcile it against the spec, `git status --short`, and the recorded evidence, and resume at the first incomplete or invalidated stage; do not redo valid stages, and do not inherit an approval. If it does not exist, create it with the headings of an existing record (`docs/task-runs/T0.1.md`) and the minimum contents listed in `docs/WORKFLOW.md`, Handoff section, starting from the baseline `git status --short`. Update the record after every step below, on every blocker, and before you stop. Codex uses the same record; it is the only handoff between the two tools.
1. **Architect.** Spawn the `architect` subagent with the task id or text. When it returns, read the spec it wrote. If it lists open questions, put them to the user now with AskUserQuestion and record the answers in the spec's "Decisions" section before continuing. If the user is not available and a question is material, stop here and report.
2. **Confirm scope.** Show the user a condensed version of the spec's Goal, Non-goals, and Files sections and ask whether to proceed. Skip this step only if the user said "no confirmation" in the arguments.
3. **Implementer.** Spawn the `implementer` subagent with the spec path. Relay its report verbatim to the user.
4. **Reviewer.** Spawn the `reviewer` subagent with the spec path. Relay its verdict and findings verbatim.
5. **Loop.** On REQUEST_CHANGES, spawn a fresh `implementer` with the spec path plus the reviewer's findings, then review again. At most two loops in total across tools and resumptions (the record holds the count). If still not approved, stop and give the user the remaining findings; do not merge by fiat.
6. **Close.** On APPROVE: summarize what changed, what was verified (with the recording paths if hardware was involved), and what remains hardware-only. Do not commit unless the user asks. Do not tick the task in `docs/PLAN.md` yourself; tell the user it is ready to tick. Set the record's stage to closed with the verdict and any NOT RUN items.

Keep your own messages short. The subagents' reports are the content; your job is sequencing and surfacing decisions.
