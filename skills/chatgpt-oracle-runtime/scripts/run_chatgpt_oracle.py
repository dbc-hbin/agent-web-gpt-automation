from __future__ import annotations

import runpy
import sys
from pathlib import Path


AUTOMATION_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(AUTOMATION_ROOT / "bin"))
from agent_web_gpt_paths import resolve_home

RUNNER = resolve_home() / "bin" / "chatgpt_oracle_run.py"
if not RUNNER.is_file():
    RUNNER = AUTOMATION_ROOT / "bin" / "chatgpt_oracle_run.py"


if __name__ == "__main__":
    runpy.run_path(str(RUNNER), run_name="__main__")
