# CLAUDE.md

Project-specific notes for Claude Code in this repo. Behavioral rules live in @AGENTS.md and are not restated here; for a trivial task, judgment beats ceremony.

Claude Code specifics:

- Subagents live in `.claude/agents/`: `architect` (spec, no code), `implementer` (build to spec), `reviewer` (read-only gate), plus two context firewalls: `test-runner` (runs checks, returns only failures) and `recording-analyst` (answers questions about `fixtures/recordings/` with line citations, never edits them). Use `/feature <task-id>` to run the loop for a task in `docs/PLAN.md`.
- Hardware access goes through the phone relay (ADR-013) or, for the spike, the laptop bridge; neither is in this WSL2 shell by default. If `pnpm hil:smoke` cannot reach the car, report NOT RUN; do not simulate.
- Before writing any OBD constant, open `docs/ELM327.md` and cite the section (hard rule 1).
- For BM1–BM9 and the LLM features (T2.10, T2.11), read `docs/ML.md` and `docs/EVAL.md`: preserve split isolation and provenance, separate real/synthetic results, and never treat a missing training or eval run as a vehicle hardware-only exception.
- Codex works in this repo too (`CODEX.md`). The shared handoff is `docs/task-runs/<task-id>.md`; `/feature` reads it before doing anything. Protocol in `docs/WORKFLOW.md`, Handoff section.
