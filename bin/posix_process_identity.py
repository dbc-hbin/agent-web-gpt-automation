#!/usr/bin/env python3
"""Fail-closed POSIX process identity and termination helpers."""

from __future__ import annotations

import hashlib
import os
import signal
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence


class ProcessIdentityError(RuntimeError):
    pass


def _run(argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(list(argv), capture_output=True, text=True, check=False, timeout=10)


def listener_pids(port: int) -> list[int]:
    completed = _run(["lsof", "-nP", f"-iTCP:{int(port)}", "-sTCP:LISTEN", "-Fp"])
    if completed.returncode not in {0, 1}:
        raise ProcessIdentityError("listener inventory failed")
    return sorted({int(line[1:]) for line in completed.stdout.splitlines() if line.startswith("p") and line[1:].isdigit()})


def _executable_path(pid: int) -> str | None:
    completed = _run(["lsof", "-a", "-p", str(pid), "-d", "txt", "-Fn"])
    for line in completed.stdout.splitlines():
        if line.startswith("n/"):
            return str(Path(line[1:]).resolve(strict=False))
    return None


def process_identity(pid: int, *, local_port: int | None = None) -> dict[str, Any] | None:
    completed = _run(["ps", "-p", str(int(pid)), "-o", "ppid=", "-o", "lstart=", "-o", "command="])
    if completed.returncode != 0 or not completed.stdout.strip():
        return None
    parts = completed.stdout.strip().split(None, 6)
    if len(parts) < 7:
        raise ProcessIdentityError("process inventory shape changed")
    parent_pid = int(parts[0])
    started = datetime.strptime(" ".join(parts[1:6]), "%a %b %d %H:%M:%S %Y").astimezone()
    command_line = parts[6]
    return {
        "pid": int(pid),
        "parent_pid": parent_pid,
        "command_line": command_line,
        "command_sha256": hashlib.sha256(command_line.encode("utf-8", errors="replace")).hexdigest(),
        "started_at_unix_ns": int(started.timestamp() * 1_000_000_000),
        "executable_final_path": _executable_path(int(pid)),
        "local_port": local_port,
    }


def listener_identity(port: int) -> dict[str, Any] | None:
    pids = listener_pids(port)
    if not pids:
        return None
    if len(pids) != 1:
        raise ProcessIdentityError(f"multiple listeners own port {port}: {pids}")
    return process_identity(pids[0], local_port=port)


def identity_matches(expected: dict[str, Any], actual: dict[str, Any] | None) -> bool:
    if actual is None:
        return False
    return all(
        actual.get(key) == expected.get(key)
        for key in ("pid", "started_at_unix_ns", "command_sha256", "executable_final_path")
    )


def terminate_exact_process(
    expected: dict[str, Any],
    *,
    grace_seconds: float = 8.0,
    sleeper=time.sleep,
) -> dict[str, Any]:
    pid = int(expected["pid"])
    if not identity_matches(expected, process_identity(pid, local_port=expected.get("local_port"))):
        raise ProcessIdentityError("process identity changed before termination")
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + max(0.0, grace_seconds)
    while time.monotonic() < deadline:
        if process_identity(pid) is None:
            return {"ok": True, "pid": pid, "signal": "SIGTERM"}
        sleeper(0.1)
    actual = process_identity(pid, local_port=expected.get("local_port"))
    if not identity_matches(expected, actual):
        raise ProcessIdentityError("process identity changed after SIGTERM")
    os.kill(pid, signal.SIGKILL)
    return {"ok": True, "pid": pid, "signal": "SIGKILL"}
