#!/usr/bin/env python3
"""PreToolUse: kill switch, dangerous git/rm, immutable recordings (hard rule 2), toolchain files (hard rule 7)."""
import os, re, sys
sys.path.insert(0, os.path.dirname(__file__)); from _lib import *  # noqa

d = read_input(); root = project_root(d); tool = d.get("tool_name", ""); ti = d.get("tool_input", {}) or {}
launch_root = os.environ.get("CLAUDE_PROJECT_DIR", root)
if os.path.exists(os.path.join(launch_root, "AGENT_STOP")):
    deny("AGENT_STOP file present: all tool calls are halted. Remove the file to continue.")
toolchain_ok = os.path.exists(os.path.join(launch_root, ".claude/ALLOW_TOOLCHAIN"))

if tool == "Bash":
    c = ti.get("command", "")
    if re.search(r"git\s+push\b.*(\s--force\b|\s-f\b)", c): deny("Force-push is not allowed.")
    if re.search(r"git\s+reset\s+--hard|git\s+checkout\s+--\s+\.|git\s+clean\s+-[a-z]*f", c): deny("Destructive git reset/checkout/clean is not allowed; ask the lead.")
    if re.search(r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(/|~|\$HOME|\.\.)", c): deny("Recursive delete outside the repo is not allowed.")
    if re.search(r"(sed\s+-i|>>?|\btee\b|\btruncate\b|\brm\b|\bmv\b)[^|;&]*fixtures/recordings/", c):
        deny("fixtures/recordings/ is immutable (AGENTS.md hard rule 2). Add recordings with the recording tool; redact with tools/spike/redact_vin.py.")
    # Hard rule 7: dependency changes need a spec that lists them, so the lead unlocks them.
    if re.search(r"\bpnpm\s+(add|remove|rm|up|update|uninstall)\b|\bnpm\s+(i|install|uninstall)\s+\S|\buv\s+(add|remove)\b", c) and not toolchain_ok:
        deny("Dependency changes are lead-only (AGENTS.md hard rule 7). Report the need; the lead creates .claude/ALLOW_TOOLCHAIN if the spec lists it.")
    if ".claude/worktrees" in root and re.search(r"\bpnpm\s+(run\s+)?check\b", c):
        deny("Full `pnpm check` is not run in a worktree; the integrator runs it on main. Use scoped checks (fast-checks skill).")
    sys.exit(0)

path = ti.get("file_path") or ti.get("notebook_path") or ""
if not path: sys.exit(0)
rel = os.path.relpath(path, root) if os.path.isabs(path) else path
rel = rel.replace("\\", "/")
if rel.startswith("fixtures/recordings/"):
    deny("fixtures/recordings/ is immutable (AGENTS.md hard rule 2). Hand-written data goes in fixtures/synthetic/.")
protected = ("pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "eslint.config.js", ".claude/settings.json", ".github/")
if (rel in protected or rel.startswith(".github/") or rel.endswith("package.json") or rel.endswith("pyproject.toml") or rel.endswith("uv.lock")) and not toolchain_ok:
    deny(f"{rel} is a toolchain file owned by the lead (AGENTS.md hard rule 7). Report the need; the lead creates .claude/ALLOW_TOOLCHAIN if the spec lists it.")
sys.exit(0)
