#!/usr/bin/env python
from __future__ import annotations

import argparse
import sys
from pathlib import Path


DENY_PATTERNS = [
    "C:\\Users\\GPUVM",
    "C:/Users/GPUVM",
    "C:\\programo",
    "C:/programo",
    "GPUVM",
    "택톡",
    "BB-torres",
    "문제출제",
]

SKIP_DIRS = {
    ".git",
    ".pytest_cache",
    "__pycache__",
    "node_modules",
    ".tmp",
    "data",
    "profile",
    "state",
    "runtime",
    "logs",
    ".testdeps",
    ".global-policy-staging",
}

SKIP_SUFFIXES = {
    ".pyc",
    ".pyo",
    ".sqlite",
    ".db",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".zip",
}

ALLOWLIST = {
    Path("scripts/check_portability.py"),
    Path("install-manifest.json"),
    Path("tests/fixtures/planner-v7-app-trace-quiescent-incident.json"),
    Path("tests/fixtures/planner-v8-app-trace-quiescent-incident.json"),
}


def iter_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if rel in ALLOWLIST:
            continue
        if any(
            part in SKIP_DIRS
            or part.startswith(".pytest")
            for part in rel.parts
        ):
            continue
        if path.suffix.lower() in SKIP_SUFFIXES:
            continue
        yield path


def main() -> int:
    parser = argparse.ArgumentParser(description="Fail when machine-specific local paths leak into the portable repo.")
    parser.add_argument("--root", default=".", help="Repository root to scan.")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    findings: list[str] = []
    for path in iter_files(root):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        rel = path.relative_to(root)
        for lineno, line in enumerate(text.splitlines(), start=1):
            for pattern in DENY_PATTERNS:
                if pattern in line:
                    findings.append(f"{rel}:{lineno}: contains {pattern!r}")

    if findings:
        print("portability check failed:", file=sys.stderr)
        for finding in findings:
            print(finding, file=sys.stderr)
        return 1
    print("portability check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
