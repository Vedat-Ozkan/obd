# CLAUDE.md

Project-specific notes for Claude Code in this repo. Behavioral rules live in @AGENTS.md and are not restated here; for a trivial task, judgment beats ceremony.

Claude Code specifics:

- Subagents live in `.claude/agents/`: `architect` (spec, no code), `implementer` (builds to spec in its own worktree), `reviewer` (read-only gate on the branch), `integrator` (merges an approved branch into main and runs the full gate), plus `quick-fix` (small mechanical fixes), `scribe` (task-record and docs bookkeeping), and two context firewalls: `test-runner` (runs checks, returns only failures) and `recording-analyst` (answers questions about `fixtures/recordings/` with line citations, never edits them). Use `/feature <task-id>` to run the loop for a task in `docs/PLAN.md`.
- Path-scoped rules in `.claude/rules/` load only when matching files are touched: `protocol.md` (ELM327 constants, recordings, hardware) and `ml.md` (BM1–BM9, LLM features). Hooks in `.claude/hooks/` block destructive git, edits to `fixtures/recordings/`, and toolchain/dependency changes (the lead unlocks those with `.claude/ALLOW_TOOLCHAIN` when a spec lists them; delete it after), run `eslint --fix` on edit, and rerun the changed packages' tests on stop (`OBD_SKIP_GATE=1` bypasses). An `AGENT_STOP` file at the repo root halts every tool call.
- Codex works in this repo too (`CODEX.md`). The shared handoff is `docs/task-runs/<task-id>.md`; `/feature` reads it before doing anything. Protocol in `docs/WORKFLOW.md`, Handoff section.

## Model tiering (the heaviest model anywhere is Opus 5.5 at medium effort)

Set in `.claude/settings.json` (`model`, `effortLevel`, `availableModels`, `CLAUDE_CODE_SUBAGENT_MODEL`) and `.claude/agents/*.md` frontmatter, which is the single source for each agent's model; this list must match it. Never use Fable, and never raise effort above medium.

- Lead session (orchestration, decisions, checking results): Opus 5.5, medium. It delegates the doing.
- Sonnet 5.5, medium: `architect`, `implementer`, `reviewer`, `integrator`, `recording-analyst`. If one stalls on genuinely hard logic, it reports back rather than retrying; the lead decides whether one Opus pass is worth it.
- Sonnet 5.5, low: `quick-fix`. Haiku, low: `test-runner`, `scribe`.
- Always pick the cheapest agent that can do the job. Ad hoc subagents default to Sonnet; pass `model: "haiku"` for searches and lookups (`Explore`, `claude-code-guide`), `model: "opus"` only for design-heavy work.
- Mechanical work with an exact spec goes to the Codex CLI first (no Claude usage), `quick-fix` second; the `/feature` skill has the `codex exec` command. A Claude reviewer checks it before merge.

## Keeping context small

- Ask subagents for conclusions in a fixed shape, not file dumps. Never `cat` a file over about 200 lines; `tail -40` command output.
- Never run `pnpm check` or a package's full tests inline in the lead; use `test-runner`. Never paste its raw output into the lead.
- Never read a `docs/task-runs/` record whole: the session hook injects each recent record's next action; `grep` for the rest.
- Verify subagent claims cheaply (`git diff --name-only`, `git status --short`) before trusting them. `/compact` after each integrate cycle.

## Worktree etiquette

- The implementer works in its own worktree made from `HEAD`, so commit (or have the user commit) anything a task builds on first.
- Each agent owns only the spec's Files; it commits on its branch by explicit path. Only the integrator merges into main, and only after reviewer APPROVE.
- Full `pnpm check` runs only on main, by the integrator, through `test-runner`; worktrees use the scoped checks in the `fast-checks` skill.
