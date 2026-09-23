# Workflow: architect, implementer, reviewer

Three roles, three subagents in `.claude/agents/`, one orchestrating skill (`/feature`). The pattern exists because coding agents are fast and confident, and this domain punishes confident guesses: a wrong PID scaling factor looks fine in a unit test and is wrong on every car.

## The roles

**Architect** reads the plan, the architecture doc, and the actual code, then writes a spec to `docs/specs/`. The spec's most important section is *Sources*: every OBD constant the task will introduce, and where it comes from. If a constant has no source, the spec says "capture on hardware first" and that becomes a prerequisite. The architect never writes code. It runs on the strongest model available because a bad spec wastes two more agents' time.

**Implementer** builds exactly the spec, tests first against recordings, runs `pnpm check`, and reports PASS / FAIL / NOT RUN per verification item. It does not get to mark the task done and it does not decide the spec was wrong on its own; it reports and stops. It can run on a cheaper model because the spec has already done the thinking, and the reviewer catches what it misses.

**Reviewer** is read-only. It reruns the checks itself rather than trusting the report, walks the verification plan item by item, and rejects any unsourced constant, any hand-edited recording, any scope creep, and any test that mocks the thing under test. It returns APPROVE or REQUEST_CHANGES with ranked findings. It runs on the strongest model available because review is where guessing gets caught.

## The loop

```
/feature T0.4
  → architect writes docs/specs/T0.4-elm327-session.md
  → orchestrator surfaces open questions to the user, records decisions in the spec
  → user confirms scope (Goal / Non-goals / Files)
  → implementer builds, reports
  → reviewer runs checks, returns verdict
  → on REQUEST_CHANGES: fresh implementer with findings, review again (max 2 loops)
  → on APPROVE: orchestrator summarizes; user commits and ticks the task
```

Fresh implementer per loop is deliberate: an implementer that just argued for its design is a worse fixer than one reading the findings cold.

## Definition of done

A task is done when all of these hold:

1. `pnpm check` is green in the reviewer's own run.
2. Every verification item in the spec is PASS, or is explicitly hardware-only with the command to run and no recording yet.
3. Every new OBD constant has a cited source in the spec.
4. The reviewer returned APPROVE.
5. The implementer's report lists what was not run. "Everything passed" without a NOT RUN section is treated as suspicious, not as good news.

## ML task verification

For BM1–BM9 and the LLM features (T2.10, T2.11), read [ML.md](ML.md) and [EVAL.md](EVAL.md). Milestones may need multiple bounded specs. The architect records model/data provenance, consent, licensing, split policy, exact dependencies, compute and spending decisions, evaluation controls, and required experiment artifacts. The implementer preserves held-out data and records all attempted configurations. The reviewer checks split leakage, target quality, matched baselines, and the link from measurements to claims.

Normal `pnpm check` stays fixture-based, including the LLM regression suite over saved responses. Model training and paid model evaluations run separately when a spec requires them. The reviewer reruns required checks or marks them NOT RUN; absent compute does not qualify for the vehicle hardware-only exception and leaves the experiment incomplete. A reproducible negative result can pass; an unrun experiment cannot. No model is promoted to the app merely because training completed.

## What each role must not do

- Architect: write code; leave a constant unsourced; spec more than one implementer-day of work.
- Implementer: expand scope; edit recordings; add dependencies; claim hardware verification without a recording path; edit the spec.
- Reviewer: edit anything; approve with blocking findings; soften a verdict because the work was mostly good.

## Hardware in the loop

CI has no Bluetooth. The phone relay (ADR-013; the laptop bridge for the spike) lets an agent send real commands to the real dongle through an MCP server with a read-only allowlist, and save the exchange as a recording. The cycle for anything protocol-related is: spike on hardware → recording → replay test → implementation → reviewer replays the recording. Agents never assert dongle behavior from memory; they assert it from a recording, or they say NOT RUN.

If the relay is unreachable (phone not in the car, app not in relay mode, car off), the implementer says so and the reviewer marks the item hardware-only. Nobody simulates the dongle to make a check pass.

## Handoff between Claude and Codex

Two tools run this loop: Claude Code (`/feature`, agents in `.claude/`) and Codex (`$obd-feature`, agents in `.codex/`; see `CODEX.md`). They share the specs, the gates above, and one progress record per task: `docs/task-runs/<task-id>.md`. The record is the handoff; nothing else is.

Rules, the same for both tools:

1. **One tool, one role at a time.** Never run Claude and Codex, or two roles, on the same task concurrently. A transfer stops the current role first.
2. **The orchestrator owns the record.** It creates the record at preflight and updates it at every role change, on every blocker, and before yielding. Minimum contents: last tool and role; current and completed stages; spec paths; approved decisions; baseline (`git status --short` at start) and touched files; exact verification commands with PASS / FAIL / NOT RUN; open review findings; repair count (max 2); escalation count and reason; blocker; next action. No secrets.
3. **Resume by reconciling, not by trusting.** The receiving tool reads the record, the spec, the working tree, and the evidence, then resumes at the first incomplete or invalidated stage. Completed architecture and implementation are reused while their evidence still holds. A recorded approval is never inherited: the receiving reviewer reruns every check the current changes affect and every check the spec requires.
4. **Missing record.** Reconstruct one from the spec, tree, and evidence only. Counters start at zero only for a genuinely new task; imported history with unknown counts stays unknown. Never invent approvals, completed stages, or findings.
5. **Counters do not reset** across tools or resumptions.

Takeover prompt for a Claude session: `/feature <task-id>` reads the record first and does the reconciliation itself. For Codex, `CODEX.md` has the equivalent.

## Parallel work

Not before the `obd-core` interfaces have survived two tasks unchanged (expected around T0.6). After that, independent tasks (for example a mobile screen and an eval feature) can run in git worktrees with separate `/feature` invocations. Protocol tasks stay serial; they share the same session and decoding code.

## Things this workflow deliberately does not include

- A separate "tester" agent: tests are the implementer's job and their adequacy is the reviewer's.
- A planner above the architect: `docs/PLAN.md` is the plan; the user reprioritizes it.
- Automated prompt optimization for the diagnostic turn: with fewer than fifty labeled cases it overfits.
- Auto-merge: the user commits.
