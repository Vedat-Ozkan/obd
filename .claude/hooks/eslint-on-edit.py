#!/usr/bin/env python3
"""PostToolUse(Edit|Write): eslint --fix the edited TS/JS file. Non-blocking."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__)); from _lib import *  # noqa
d = read_input(); root = project_root(d)
p = (d.get("tool_input") or {}).get("file_path", "")
if not p.endswith((".ts", ".tsx", ".js", ".mjs")) or not os.path.exists(p): sys.exit(0)
# A fresh worktree has no node_modules until `pnpm install`; skip rather than fail.
if not os.path.exists(os.path.join(root, "node_modules/.bin/eslint")): sys.exit(0)
r = run(f'node_modules/.bin/eslint --fix "{p}"', cwd=root, timeout=55)
if r.returncode != 0:
    msg = (r.stdout + r.stderr).strip().splitlines()[-8:]
    print("eslint could not auto-fix:\n" + "\n".join(msg))
sys.exit(0)
