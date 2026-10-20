"""Shared helpers for Claude Code hooks. Hooks read one JSON object from stdin."""
import json, os, subprocess, sys

def read_input():
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}

def project_root(data):
    return data.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()

def deny(reason, event="PreToolUse"):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "permissionDecision": "deny",
                                             "permissionDecisionReason": reason}}))
    sys.exit(0)

def run(cmd, cwd, timeout=600):
    return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout)
