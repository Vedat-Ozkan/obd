#!/usr/bin/env python3
"""Stop: block finishing while the tests of the changed packages fail. Skips docs-only changes."""
import os, re, sys
sys.path.insert(0, os.path.dirname(__file__)); from _lib import *  # noqa
d = read_input(); root = project_root(d)
if d.get("stop_hook_active") or os.environ.get("OBD_SKIP_GATE") == "1": sys.exit(0)
if not os.path.exists(os.path.join(root, "node_modules")): sys.exit(0)
base = run("git merge-base HEAD main 2>/dev/null || git rev-parse HEAD~1 2>/dev/null", cwd=root).stdout.strip()
changed = run(f"git diff --name-only {base} HEAD 2>/dev/null; git diff --name-only; git ls-files --others --exclude-standard", cwd=root).stdout.split()
# Bookkeeping, specs, recordings and agent config never need a test run.
changed = [c for c in changed if c and not (c.endswith(".md") or c.startswith(("docs/", "fixtures/", "reports/", ".claude/", ".codex/", ".agents/")))]
cmds = set()
for c in changed:
    m = re.match(r"^packages/([^/]+)/", c)
    if m: cmds.add(f"pnpm -F {m.group(1)} test")
    if c.startswith("apps/mobile/"): cmds.add("pnpm -F mobile test")
    m = re.match(r"^tools/(relay|beta-backend|beta-intake|summary-backend)/", c)
    if m: cmds.add(f"pnpm exec vitest run tools/{m.group(1)}")
    if c.startswith("tools/hil-bridge/"): cmds.add("(cd tools/hil-bridge && uv run pytest -q)")
if not cmds: sys.exit(0)
failed = []
for cmd in sorted(cmds):
    r = run(f"bash -c '{cmd} 2>&1 | tail -40; exit ${{PIPESTATUS[0]}}'", cwd=root, timeout=280)
    if r.returncode != 0: failed.append(f"$ {cmd}\n{r.stdout[-2500:]}")
if failed:
    print("Stop gate: tests failed for the changed packages. Fix before finishing (OBD_SKIP_GATE=1 to bypass).\n" + "\n".join(failed), file=sys.stderr)
    sys.exit(2)
sys.exit(0)
