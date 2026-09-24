# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "List every invalid input it must reject, write tests for those, then the code"
- "Fix the bug" → "Reproduce it end to end (a recording or fixture replay) first, then make it pass"
- "Refactor X" → "Ensure the E2E tests pass before and after"

Tests come before the code, never after. See AGENTS.md, Testing rules.

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
---

## Project: obd

@AGENTS.md

Claude Code specifics for this repo:
- Subagents live in `.claude/agents/`: `architect` (spec, no code), `implementer` (build to spec), `reviewer` (read-only gate), plus two context firewalls: `test-runner` (runs checks, returns only failures) and `recording-analyst` (answers questions about `fixtures/recordings/` with line citations, never edits them). Use `/feature <task-id>` to run the loop for a task in `docs/PLAN.md`.
- Hardware access goes through the phone relay (ADR-013) or, for the spike, the laptop bridge; neither is in this WSL2 shell by default. If `pnpm hil:smoke` cannot reach the car, report NOT RUN; do not simulate.
- Before writing any OBD constant, open `docs/ELM327.md` and cite the section. See AGENTS.md hard rule 1.
- For BM1–BM9 and the LLM features (T2.10, T2.11), read `docs/ML.md` and `docs/EVAL.md`: preserve split isolation and provenance, separate real/synthetic results, and never treat a missing training or eval run as a vehicle hardware-only exception.
- Codex works in this repo too (`CODEX.md`). The shared handoff is `docs/task-runs/<task-id>.md`; `/feature` reads it before doing anything. Protocol in `docs/WORKFLOW.md`, Handoff section.
