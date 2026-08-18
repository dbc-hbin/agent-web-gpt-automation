#!/usr/bin/env python
from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_LIMITS = {
    "multi_gpt_mcp_count": 2,
    "notebooklm_chain_roots": 2,
    "chatgpt_runner_count": 2,
    "chrome_ws_mb": 1800.0,
    "helper_ws_mb": 3000.0,
    "non_gpt_idle_cpu_percent": 10.0,
    "multi_gpt_ws_mb": 512.0,
    "notebooklm_ws_mb": 1024.0,
}

SHELL_PROCESS_NAMES = {"cmd.exe", "powershell.exe", "pwsh.exe"}
HELPER_CLEANUP_ROLES = {"multi-gpt-mcp", "notebooklm-mcp", "chatgpt-runner", "playwright-driver"}


@dataclass
class Proc:
    pid: int
    parent_pid: int
    name: str
    command_line: str
    working_set_mb: float
    cpu_percent: float = 0.0
    creation_date: str | None = None


def _run_powershell_json(script: str) -> Any:
    completed = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip())
    text = completed.stdout.strip()
    if not text:
        return []
    return json.loads(text)


def list_processes() -> list[Proc]:
    if os.name != "nt":
        completed = subprocess.run(
            ["ps", "-axo", "pid=,ppid=,rss=,%cpu=,lstart=,command="],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or "ps inventory failed")
        result: list[Proc] = []
        for line in completed.stdout.splitlines():
            parts = line.strip().split(None, 10)
            if len(parts) < 11:
                continue
            try:
                pid, parent_pid = int(parts[0]), int(parts[1])
                rss_mb, cpu = float(parts[2]) / 1024.0, float(parts[3])
                started = datetime.strptime(" ".join(parts[4:9]), "%a %b %d %H:%M:%S %Y").astimezone(timezone.utc)
            except ValueError:
                continue
            command = parts[10]
            lowered = command.casefold()
            if "google chrome" in lowered:
                name = "google chrome"
            else:
                name = Path(command.split(None, 1)[0]).name if command else ""
            result.append(Proc(pid, parent_pid, name, command, round(rss_mb, 1), cpu, started.isoformat()))
        return result
    script = r"""
$ErrorActionPreference = 'Stop'
$cpuRows = @{}
Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ForEach-Object {
  if ($_.IDProcess -ne $null) {
    $cpuRows[[int]$_.IDProcess] = [double]$_.PercentProcessorTime
  }
}
$rows = Get-CimInstance Win32_Process | ForEach-Object {
  $gp = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  $procId = [int]$_.ProcessId
  [pscustomobject]@{
    pid = $procId
    parent_pid = [int]$_.ParentProcessId
    name = [string]$_.Name
    command_line = [string]$_.CommandLine
    working_set_mb = if ($gp) { [math]::Round($gp.WorkingSet64 / 1MB, 1) } else { 0 }
    cpu_percent = if ($cpuRows.ContainsKey($procId)) { [math]::Round($cpuRows[$procId], 1) } else { 0 }
    creation_date = if ($_.CreationDate) { $_.CreationDate.ToString('o') } else { $null }
  }
}
$rows | ConvertTo-Json -Depth 3
"""
    raw = _run_powershell_json(script)
    if isinstance(raw, dict):
        raw = [raw]
    return [
        Proc(
            pid=int(item.get("pid") or 0),
            parent_pid=int(item.get("parent_pid") or 0),
            name=str(item.get("name") or ""),
            command_line=str(item.get("command_line") or ""),
            working_set_mb=float(item.get("working_set_mb") or 0.0),
            cpu_percent=float(item.get("cpu_percent") or 0.0),
            creation_date=item.get("creation_date"),
        )
        for item in raw
        if item.get("pid")
    ]


def _elapsed_seconds(value: str) -> float:
    day_split = value.split("-", 1)
    days = 0
    clock = value
    if len(day_split) == 2:
        days = int(day_split[0])
        clock = day_split[1]
    fields = [int(part) for part in clock.split(":")]
    if len(fields) == 3:
        hours, minutes, seconds = fields
    elif len(fields) == 2:
        hours, minutes, seconds = 0, fields[0], fields[1]
    else:
        hours, minutes, seconds = 0, 0, fields[0]
    return float(days * 86400 + hours * 3600 + minutes * 60 + seconds)


def classify_process(proc: Proc) -> str:
    cmd = proc.command_line.lower()
    name = proc.name.lower()
    if name in SHELL_PROCESS_NAMES:
        return "other"
    if "notebooklm-mcp" in cmd:
        if name not in {"node.exe", "node", "nodejs.exe", "python.exe", "python", "python3.exe", "uv.exe", "uvx.exe"}:
            return "other"
        return "notebooklm-mcp"
    if "codexpro" in cmd or "cloudflared" in name:
        return "codexpro"
    if "chatgpt_browser_runtime_worker.py" in cmd or "run_chatgpt_" in cmd:
        if name not in {"python.exe", "python", "python3.exe", "py.exe"}:
            return "other"
        return "chatgpt-runner"
    if "playwright" in cmd and "run-driver" in cmd:
        return "playwright-driver"
    if name in {"chrome.exe", "google chrome"}:
        if "chatgpt-shared\\data\\profile" in cmd or "chatgpt-shared/data/profile" in cmd:
            return "chatgpt-shared-chrome"
        return "chrome"
    if "memento" in cmd or "wslrelay" in name:
        return "memento"
    return "other"


def is_root_for_role(proc: Proc, role: str, by_pid: dict[int, Proc]) -> bool:
    parent = by_pid.get(proc.parent_pid)
    if not parent:
        return True
    return classify_process(parent) != role


def summarize(processes: list[Proc], limits: dict[str, float]) -> dict[str, Any]:
    by_pid = {p.pid: p for p in processes}
    roles: dict[str, dict[str, Any]] = {}
    for proc in processes:
        role = classify_process(proc)
        entry = roles.setdefault(role, {"count": 0, "working_set_mb": 0.0, "cpu_percent": 0.0, "pids": []})
        entry["count"] += 1
        entry["working_set_mb"] = round(entry["working_set_mb"] + proc.working_set_mb, 1)
        entry["cpu_percent"] = round(entry["cpu_percent"] + proc.cpu_percent, 1)
        entry["pids"].append(proc.pid)

    notebook_roots = [
        p.pid for p in processes
        if classify_process(p) == "notebooklm-mcp" and is_root_for_role(p, "notebooklm-mcp", by_pid)
    ]
    multi_gpt = [p.pid for p in processes if classify_process(p) == "multi-gpt-mcp"]
    chatgpt_runners = [p.pid for p in processes if classify_process(p) == "chatgpt-runner"]
    gpt_helper_roles = {
        "chatgpt-runner",
        "playwright-driver",
        "codexpro",
        "chatgpt-shared-chrome",
    }
    non_gpt_advisory_roles = {
        "multi-gpt-mcp",
        "notebooklm-mcp",
    }
    gpt_helper_ws = sum(
        p.working_set_mb
        for p in processes
        if classify_process(p) in gpt_helper_roles
    )
    non_gpt_helper_ws = sum(
        p.working_set_mb
        for p in processes
        if classify_process(p) in non_gpt_advisory_roles
    )
    non_gpt_helper_cpu = sum(
        p.cpu_percent
        for p in processes
        if classify_process(p) in non_gpt_advisory_roles
    )
    chrome_ws = roles.get("chatgpt-shared-chrome", {}).get("working_set_mb", 0.0)

    warnings: list[dict[str, Any]] = []
    observations: list[dict[str, Any]] = []
    if len(multi_gpt) > limits["multi_gpt_mcp_count"]:
        observations.append({
            "kind": "multi-gpt-mcp-count-high-idle-observation",
            "count": len(multi_gpt),
            "limit": limits["multi_gpt_mcp_count"],
            "pids": multi_gpt,
            "note": "count-only; not treated as pressure unless CPU or memory is high",
        })
    if len(notebook_roots) > limits["notebooklm_chain_roots"]:
        observations.append({
            "kind": "notebooklm-chain-root-count-high-idle-observation",
            "count": len(notebook_roots),
            "limit": limits["notebooklm_chain_roots"],
            "pids": notebook_roots,
            "note": "count-only; not treated as pressure unless CPU or memory is high",
        })
    multi_ws = roles.get("multi-gpt-mcp", {}).get("working_set_mb", 0.0)
    multi_cpu = roles.get("multi-gpt-mcp", {}).get("cpu_percent", 0.0)
    notebook_ws = roles.get("notebooklm-mcp", {}).get("working_set_mb", 0.0)
    notebook_cpu = roles.get("notebooklm-mcp", {}).get("cpu_percent", 0.0)
    if multi_cpu > limits["non_gpt_idle_cpu_percent"] or multi_ws > limits["multi_gpt_ws_mb"]:
        warnings.append({
            "kind": "multi-gpt-mcp-load-high",
            "count": len(multi_gpt),
            "cpu_percent": round(multi_cpu, 1),
            "cpu_limit": limits["non_gpt_idle_cpu_percent"],
            "working_set_mb": round(multi_ws, 1),
            "memory_limit_mb": limits["multi_gpt_ws_mb"],
            "pids": multi_gpt,
        })
    if notebook_cpu > limits["non_gpt_idle_cpu_percent"] or notebook_ws > limits["notebooklm_ws_mb"]:
        warnings.append({
            "kind": "notebooklm-mcp-load-high",
            "count": len(notebook_roots),
            "cpu_percent": round(notebook_cpu, 1),
            "cpu_limit": limits["non_gpt_idle_cpu_percent"],
            "working_set_mb": round(notebook_ws, 1),
            "memory_limit_mb": limits["notebooklm_ws_mb"],
            "pids": notebook_roots,
        })
    if len(chatgpt_runners) > limits["chatgpt_runner_count"]:
        warnings.append({
            "kind": "chatgpt-runner-count-high",
            "count": len(chatgpt_runners),
            "limit": limits["chatgpt_runner_count"],
            "pids": chatgpt_runners,
        })
    if chrome_ws > limits["chrome_ws_mb"]:
        warnings.append({
            "kind": "chatgpt-shared-chrome-memory-high",
            "working_set_mb": round(chrome_ws, 1),
            "limit_mb": limits["chrome_ws_mb"],
        })
    if gpt_helper_ws > limits["helper_ws_mb"]:
        warnings.append({
            "kind": "gpt-helper-runtime-memory-high",
            "working_set_mb": round(gpt_helper_ws, 1),
            "limit_mb": limits["helper_ws_mb"],
        })

    return {
        "roles": roles,
        "notebooklm_chain_roots": notebook_roots,
        "multi_gpt_mcp_pids": multi_gpt,
        "chatgpt_runner_pids": chatgpt_runners,
        "gpt_helper_working_set_mb": round(gpt_helper_ws, 1),
        "non_gpt_advisory_working_set_mb": round(non_gpt_helper_ws, 1),
        "non_gpt_advisory_cpu_percent": round(non_gpt_helper_cpu, 1),
        "helper_working_set_mb": round(gpt_helper_ws + non_gpt_helper_ws, 1),
        "observations": observations,
        "warnings": warnings,
    }


def _parse_creation_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _process_age_seconds(proc: Proc, now: datetime) -> float | None:
    created = _parse_creation_date(proc.creation_date)
    if created is None:
        return None
    return (now - created).total_seconds()


def cleanup_candidates(
    processes: list[Proc],
    *,
    orphan_grace_seconds: int = 300,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    by_pid = {p.pid: p for p in processes}
    now = now or datetime.now(timezone.utc)
    candidates: list[dict[str, Any]] = []
    for proc in processes:
        role = classify_process(proc)
        if role not in HELPER_CLEANUP_ROLES:
            continue
        age_seconds = _process_age_seconds(proc, now)
        if age_seconds is None or age_seconds < orphan_grace_seconds:
            continue
        if proc.parent_pid and proc.parent_pid not in by_pid:
            candidates.append({
                "pid": proc.pid,
                "role": role,
                "reason": "parent-process-missing",
                "creation_date": proc.creation_date,
                "age_seconds": round(age_seconds, 1),
                "command_line": redact_command(proc.command_line),
            })
    return candidates


def redact_command(command: str) -> str:
    command = re.sub(r"(?i)(codexpro_token=)[^\s\"'&]+", r"\1REDACTED", command)
    command = re.sub(r"(?i)(authorization:\s*bearer\s+)[^\s\"']+", r"\1REDACTED", command)
    command = re.sub(r"(?i)(--(?:api-key|token|access-key|secret|password))(=|\s+)[^\s\"']+", r"\1\2REDACTED", command)
    command = re.sub(r"(?i)\b((?:api[_-]?key|access[_-]?key|secret|password|token)=)[^\s\"'&]+", r"\1REDACTED", command)
    return command


def _candidate_still_valid(candidate: dict[str, Any], processes: list[Proc], orphan_grace_seconds: int) -> bool:
    by_pid = {p.pid: p for p in processes}
    proc = by_pid.get(int(candidate["pid"]))
    if not proc:
        return False
    if proc.creation_date != candidate.get("creation_date"):
        return False
    if classify_process(proc) != candidate.get("role"):
        return False
    if not proc.parent_pid or proc.parent_pid in by_pid:
        return False
    age_seconds = _process_age_seconds(proc, datetime.now(timezone.utc))
    return age_seconds is not None and age_seconds >= orphan_grace_seconds


def kill_tree(pid: int) -> dict[str, Any]:
    if os.name != "nt":
        processes = list_processes()
        by_parent: dict[int, list[int]] = {}
        for process in processes:
            by_parent.setdefault(process.parent_pid, []).append(process.pid)
        ordered: list[int] = []
        def visit(current: int) -> None:
            for child in by_parent.get(current, []):
                visit(child)
            ordered.append(current)
        visit(pid)
        errors: list[str] = []
        for target in ordered:
            try:
                os.kill(target, signal.SIGTERM)
            except ProcessLookupError:
                continue
            except OSError as exc:
                errors.append(f"{target}:{type(exc).__name__}")
        return {
            "pid": pid,
            "returncode": 0 if not errors else 1,
            "stdout": f"sent SIGTERM to {len(ordered) - len(errors)} exact tree members",
            "stderr": ",".join(errors),
        }
    completed = subprocess.run(
        ["taskkill", "/PID", str(pid), "/T", "/F"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
    )
    return {
        "pid": pid,
        "returncode": completed.returncode,
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Diagnose and conservatively clean up Codex MCP helper process accumulation.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    parser.add_argument("--cleanup-orphans", action="store_true", help="Kill only helper process trees whose parent process is missing.")
    parser.add_argument("--fail-on-pressure", action="store_true", help="Exit nonzero when helper runtime pressure warnings are present.")
    parser.add_argument("--max-multi-gpt", type=int, default=int(DEFAULT_LIMITS["multi_gpt_mcp_count"]))
    parser.add_argument("--max-notebooklm-roots", type=int, default=int(DEFAULT_LIMITS["notebooklm_chain_roots"]))
    parser.add_argument("--max-chatgpt-runner", type=int, default=int(DEFAULT_LIMITS["chatgpt_runner_count"]))
    parser.add_argument("--max-chrome-mb", type=float, default=float(DEFAULT_LIMITS["chrome_ws_mb"]))
    parser.add_argument("--max-helper-mb", type=float, default=float(DEFAULT_LIMITS["helper_ws_mb"]))
    parser.add_argument("--max-non-gpt-idle-cpu", type=float, default=float(DEFAULT_LIMITS["non_gpt_idle_cpu_percent"]))
    parser.add_argument("--max-multi-gpt-mb", type=float, default=float(DEFAULT_LIMITS["multi_gpt_ws_mb"]))
    parser.add_argument("--max-notebooklm-mb", type=float, default=float(DEFAULT_LIMITS["notebooklm_ws_mb"]))
    parser.add_argument("--orphan-grace-seconds", type=int, default=300, help="Require a missing-parent helper to be this old before cleanup.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    limits = {
        "multi_gpt_mcp_count": args.max_multi_gpt,
        "notebooklm_chain_roots": args.max_notebooklm_roots,
        "chatgpt_runner_count": args.max_chatgpt_runner,
        "chrome_ws_mb": args.max_chrome_mb,
        "helper_ws_mb": args.max_helper_mb,
        "non_gpt_idle_cpu_percent": args.max_non_gpt_idle_cpu,
        "multi_gpt_ws_mb": args.max_multi_gpt_mb,
        "notebooklm_ws_mb": args.max_notebooklm_mb,
    }
    processes = list_processes()
    report = summarize(processes, limits)
    report["ok"] = not report["warnings"]
    report["checked_at"] = datetime.now(timezone.utc).isoformat()
    report["cleanup_candidates"] = cleanup_candidates(
        processes,
        orphan_grace_seconds=args.orphan_grace_seconds,
    )
    report["cleanup_results"] = []

    if args.cleanup_orphans:
        for candidate in report["cleanup_candidates"]:
            fresh_processes = list_processes()
            if not _candidate_still_valid(candidate, fresh_processes, args.orphan_grace_seconds):
                report["cleanup_results"].append({
                    "pid": candidate["pid"],
                    "returncode": 3,
                    "skipped": True,
                    "reason": "candidate-changed-before-kill",
                })
                continue
            report["cleanup_results"].append(kill_tree(int(candidate["pid"])))

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(
            f"ok={str(report['ok']).lower()} "
            f"gpt_helper_ws_mb={report['gpt_helper_working_set_mb']} "
            f"non_gpt_advisory_ws_mb={report['non_gpt_advisory_working_set_mb']}"
        )
        for role, info in sorted(report["roles"].items()):
            if role == "other":
                continue
            print(f"{role}: count={info['count']} ws_mb={info['working_set_mb']} pids={','.join(map(str, info['pids']))}")
        for warning in report["warnings"]:
            print(f"WARNING {warning}")
        for observation in report["observations"]:
            print(f"OBSERVATION {observation}")
        for candidate in report["cleanup_candidates"]:
            print(f"CLEANUP_CANDIDATE {candidate['role']} pid={candidate['pid']} reason={candidate['reason']}")

    cleanup_failed = any(int(result.get("returncode", 0)) != 0 for result in report["cleanup_results"])
    if cleanup_failed:
        return 4
    if args.fail_on_pressure and report["warnings"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
