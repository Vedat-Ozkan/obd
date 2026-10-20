#!/usr/bin/env python3
import glob, os, sys
sys.path.insert(0, os.path.dirname(__file__)); from _lib import *  # noqa
d = read_input(); root = project_root(d)
br = run("git rev-parse --abbrev-ref HEAD 2>/dev/null", cwd=root).stdout.strip()
lines = []
wt = run("git worktree list 2>/dev/null", cwd=root).stdout.strip().splitlines()
if len(wt) > 1: lines += ["worktrees:"] + wt
st = run("git status --short 2>/dev/null", cwd=root).stdout.rstrip().splitlines()
lines.append(f"git status --short ({len(st)} entries):")
lines += st[:15] + (["..."] if len(st) > 15 else [])
recs = sorted(glob.glob(os.path.join(root, "docs/task-runs/*.md")), key=os.path.getmtime, reverse=True)[:3]
for r in recs:
    nxt = [l.strip() for l in open(r, encoding="utf-8") if "Next action" in l]
    if nxt: lines.append(f"{os.path.relpath(r, root)}: {nxt[-1][:300]}")
print(f"[session-context] branch={br} cwd={root}\n" + "\n".join(lines))
