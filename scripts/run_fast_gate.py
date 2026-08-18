#!/usr/bin/env python
"""Sub-minute gate for Oracle automation changes.

The full suite takes many minutes, which pushed every repair into one-incident-
at-a-time edits.  This gate covers the contracts that actually broke runs before
submission - launch arguments, lifecycle authority, incident ownership,
compatibility patch shape, and release packaging - and must finish well inside
one minute so it can run after every batch of edits.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FAST_TARGETS = [
    "tests/test_chatgpt_oracle_state.py",
    "tests/test_chatgpt_oracle_run.py",
    "tests/test_chatgpt_oracle_diagnose.py",
    "tests/test_chatgpt_oracle_incident.py",
    "tests/test_chatgpt_oracle_compat.py",
    "tests/test_chatgpt_oracle_profiles.py",
    "tests/test_global_gpt_browser_policy.py",
    "tests/test_release_packaging.py",
    "tests/test_docs_contract.py",
    "tests/test_agent_web_gpt_onboarding.py",
    "tests/test_agent_web_gpt_paths.py",
    "tests/test_ultra_economy_mode.py",
]

DEFAULT_BUDGET_SECONDS = 60.0


def _hidden_process_kwargs() -> dict[str, object]:
    if os.name != "nt":
        return {}
    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = subprocess.SW_HIDE
    return {"creationflags": subprocess.CREATE_NO_WINDOW, "startupinfo": startupinfo}


def run_fast_gate(*, budget_seconds: float = DEFAULT_BUDGET_SECONDS) -> dict[str, object]:
    environment = dict(os.environ)
    environment.setdefault("PYTHONUTF8", "1")
    environment.setdefault("PYTHONIOENCODING", "utf-8")
    with tempfile.TemporaryDirectory(prefix="codex-oracle-fast-gate-") as basetemp:
        command = [
            sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
            *FAST_TARGETS,
            "--basetemp", basetemp,
        ]
        started = time.monotonic()
        completed = subprocess.run(
            command,
            cwd=str(ROOT),
            check=False,
            env=environment,
            **_hidden_process_kwargs(),
        )
        elapsed = time.monotonic() - started
    return {
        "exit_code": int(completed.returncode),
        "elapsed_seconds": round(elapsed, 2),
        "budget_seconds": budget_seconds,
        "within_budget": elapsed <= budget_seconds,
        "targets": list(FAST_TARGETS),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the sub-minute Oracle automation gate.")
    parser.add_argument("--budget-seconds", type=float, default=DEFAULT_BUDGET_SECONDS)
    parser.add_argument(
        "--enforce-budget",
        action="store_true",
        help="Fail when the gate exceeds its wall-clock budget even if tests pass.",
    )
    args = parser.parse_args(argv)
    result = run_fast_gate(budget_seconds=args.budget_seconds)
    print(
        f"fast-gate exit={result['exit_code']} "
        f"elapsed={result['elapsed_seconds']}s budget={result['budget_seconds']}s "
        f"within_budget={result['within_budget']}"
    )
    if result["exit_code"] != 0:
        return int(result["exit_code"])
    if args.enforce_budget and not result["within_budget"]:
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
