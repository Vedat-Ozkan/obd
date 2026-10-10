---
name: merge-task
description: Integrator workflow to merge one reviewer-approved implementer branch into main, run the full gate, and remove the worktree.
---
# Merge a task branch
1. Confirm the orchestrator gave you the branch, the task id, and a reviewer APPROVE for the branch's current head. If the head moved
   since that approval, stop and report.
2. `git log main..<branch> --oneline` and `git diff main...<branch> --stat`. Every file must be in the spec's Files list (or a test
   the spec names). Anything else: stop and report; do not merge.
3. `git status --short` on main. Merging must not touch uncommitted paths on main (another tool's in-flight work). If the branch
   overlaps one, stop and report.
4. `git merge --no-ff <branch> -m "<imperative subject> (<task-id>)" -m "<what was verified>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.
   On conflicts, stop and report; do not resolve protocol or decoding code yourself.
5. Gate on main: spawn `test-runner` with `pnpm check`. It returns only the failure list. Fix trivial breakage (an eslint autofix, an
   import path) in a follow-up commit by explicit path; otherwise `git revert -m 1 <merge sha>` and report the failing test.
6. On a green gate: `git worktree remove <path>` and `git branch -d <branch>`. Never push.
7. If the merge made `CLAUDE.md`, `AGENTS.md` or a doc wrong (a new package, a renamed command), report it; the orchestrator fixes it.
