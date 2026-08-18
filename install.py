#!/usr/bin/env python3
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "bin"))
from agent_web_gpt_lifecycle import main

raise SystemExit(main(["install", *sys.argv[1:]]))
