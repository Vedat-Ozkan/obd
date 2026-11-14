# Workflow: architect, implementer, reviewer

Three roles, three subagents in `.claude/agents/`, one orchestrating skill (`/feature`). The pattern exists because coding agents are fast and confident, and this domain punishes confident guesses: a wrong PID scaling factor looks fine in a unit test and is wrong on every car.

## The roles

**Architect** reads the plan, the architecture doc, and the actual code, then writes a spec to `docs/specs/`. The spec's most important section is *Sources*: every OBD constant the task will introduce, and where it comes from. If a constant has no source, the spec says "capture on hardware first" and that becomes a prerequisite. The architect never writes code. A bad spec wastes two more agents' time, so this is the stage to spend care on.

**Implementer** builds exactly the spec in its own git worktree and never expands its scope, writes tests first (E2E replays of recordings by default, never unit tests after the code), runs the scoped checks for the packages it touched, commits on its branch, and reports PASS / FAIL / NOT RUN per verification item. It does not get to mark the task done and it does not decide the spec was wrong on its own; it reports and stops. The spec has already done the thinking, and the reviewer catches what it misses.

**Reviewer** is read-only. It reruns the checks itself rather than trusting the report, walks the verification plan item by item, and rejects any unsourced constant, any hand-edited recording, any scope creep, any test that mocks the thing under test, and any unit test that restates the code or covers no failure the spec lists. It returns APPROVE or REQUEST_CHANGES with ranked findings. Review is where guessing gets caught. 

**Integrator** merges an approved branch into main, runs the full `pnpm check` gate there, and reverts the merge if the gate fails. There are two cheap helpers: `quick-fix` for small mechanical fixes and `scribe` for task-record bookkeeping. Model and effort per role are set in the agent definitions (`.claude/agents/*.md` frontmatter), not here.

## The loop

```
/feature T0.4
  → architect writes docs/specs/T0.4-elm327-session.md
  → orchestrator surfaces open questions to the user, records decisions in the spec
  → user confirms scope (Goal / Non-goals / Files)
  → implementer builds in its worktree, commits on its branch, reports
  → reviewer reviews the branch diff, reruns the scoped checks and E2E items, returns verdict
  → on REQUEST_CHANGES: fresh implementer on the same branch with findings, review again (max 2 loops)
  → on APPROVE: integrator merges into main, runs pnpm check (revert on failure counts as a loop)
  → orchestrator summarizes; the user ticks the task
```

Fresh implementer per loop is deliberate: an implementer that just argued for its design is a worse fixer than one reading the findings cold.

## Definition of done

A task is done when all of these hold:

1. The scoped checks are green in the reviewer's own run, and `pnpm check` is green on main after the merge.
2. Every verification item in the spec is PASS, or is explicitly hardware-only with the command to run and no recording yet.
3. Every new OBD constant has a cited source in the spec.
4. The reviewer returned APPROVE.
5. Each E2E verification item produces its named artifact (replay summary, report, recording path, eval scores), and the reviewer reran the test and checked it. Byte or hash identity across runs is not required.
6. The implementer's report lists what was not run. "Everything passed" without a NOT RUN section is treated as suspicious, not as good news.

## ML task verification

For BM1–BM9 and the LLM features (T2.10, T2.11), see AGENTS.md hard rule 11, [ML.md](ML.md), and [EVAL.md](EVAL.md) for provenance, split isolation, real/synthetic separation, and the limits of the hardware-only exception. Beyond that: the implementer records every attempted configuration, not just the winner, and preserves held-out data untouched; the reviewer checks for split leakage, target quality, and matched baselines, and that the measurements actually support the claims made; no model is promoted to the app merely because training completed.

## Hardware in the loop

CI has no Bluetooth. The phone relay (ADR-013; the laptop bridge for the spike) lets an agent send real commands to the real dongle through an MCP server with a read-only allowlist, and save the exchange as a recording. The cycle for anything protocol-related is: spike on hardware → recording → replay test → implementation → reviewer replays the recording. Agents never assert dongle behavior from memory; they assert it from a recording, or they say NOT RUN.

If the relay is unreachable (phone not in the car, app not in relay mode, car off), the implementer says so and the reviewer marks the item hardware-only. Nobody simulates the dongle to make a check pass: simulated runs (`tools/sim/`) may de-risk a check at the desk, but they are labelled simulated and never tick an item or close an OWNER-QUEUE row.

## Hardware before desk (ADR-024)

The reviewer cannot see the phone or the car, and the defects that got past review were found there. So:

- No new desk task starts while more than three merged tasks are waiting for a phone or car check in `docs/OWNER-QUEUE.md`. `/feature` checks this before the architect runs and stops if the limit is exceeded.
- The exceptions are a fix that unblocks a queued check, and work that needs no car at all (for example an LLM eval run).
- Before a phone check, run the flow on the emulator with the simulated car (`tools/sim/`). It closes nothing; it keeps the phone session for what only the phone can show.

## Size limits

Paper is a cost: every later agent reads it.

- A spec is at most about 150 lines. Interfaces shows only the public signatures that change; it is not a draft of the code. Each verification check is stated once. A spec has no decisions log: a decision made after kickoff is recorded in the task record and the spec's governing section is edited in place.
- A task that does not fit is split.
- A closed task's record is a few lines (rule 4 below).

## Task records

One record per task, `docs/task-runs/<task-id>.md`, owned by the orchestrator. `/feature` reads it before doing anything.

**One home per kind of fact.** Duplicated state is how records and specs balloon, and divergent copies are how agents act on stale decisions:

- **Decisions** live in the task record (and in an ADR when they change the roadmap).
- **Scope, sources, and verification items** live in the spec, not restated in the record.
- **Verification evidence** lives in the record as PASS/FAIL/NOT RUN lines plus the named artifact, not as command transcripts.

When a document would restate another, cite it instead.

Rules:

1. **One role at a time** on a task.
2. **An open task's record is one `## Current state (<date>)` block:** stage, per-stage verdicts, repair count (max 2), commit SHAs, PASS / FAIL / NOT RUN per verification item, open findings, decisions in effect, owner items, next action. No transcripts and no secrets.
3. **Resume by reconciling, not by trusting.** Read the record, the spec, the working tree, and the evidence, then resume at the first incomplete or invalidated stage. A recorded approval is never inherited: the reviewer reruns every check the current changes affect.
4. **Close by collapsing.** When a task closes, the record becomes one line per stage (`<stage> <role>: <VERDICT> (repairs N/2) — commit <sha>`), the NOT RUN items with reasons, and the open owner items. Git history keeps the rest.
5. **Owner-only items also go in `docs/OWNER-QUEUE.md`,** one row each with a link back to the record line. When one is done, record the result in the record and delete the row.
6. Other files never cite a record's history; cite the spec, a commit, or `git show <sha>:docs/task-runs/<id>.md`.

## Parallel work

In Claude Code each implementer runs in its own git worktree (`.claude/worktrees/`, gitignored) made from `HEAD`, so independent tasks (for example a mobile screen and an eval feature) can run in parallel `/feature` invocations. Protocol tasks stay serial; they share the same session and decoding code. A worktree does not see uncommitted work on main, so commit what a task builds on first.

## Things this workflow deliberately does not include

- A separate "tester" agent: tests are the implementer's job and their adequacy is the reviewer's.
- A planner above the architect: `docs/PLAN.md` is the plan; the user reprioritizes it.
- Automated prompt optimization for the diagnostic turn: with fewer than fifty labeled cases it overfits.
- Auto-merge or unreviewed commits: implementers commit only on their own worktree branch, and the integrator merges into main only after APPROVE, never touching other uncommitted paths on main; pushing stays with the user.
