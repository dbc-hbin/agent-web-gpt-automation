#!/usr/bin/env python3
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "bin"))
from agent_web_gpt_onboarding import main

raise SystemExit(main(sys.argv[1:]))
