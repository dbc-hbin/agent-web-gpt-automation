from __future__ import annotations

import json
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "start_devspace_bootstrap.ps1"


def test_bootstrap_script_uses_live_devspace_allowed_roots_contract() -> None:
    text = SCRIPT.read_text(encoding="utf-8")

    assert "$DevSpaceConfigPath" in text
    assert "$DevSpaceConfig.allowedRoots" in text
    assert "foreach ($Root in $AllowedRoots)" in text
    assert "foreach ($Root in @($Config.roots))" not in text
    assert "[ValidateSet('Once', 'Watch')]" in text
    assert "$Mode = 'Once'" in text
    assert "while ($true)" in text
    assert "watchdog remains active" in text


@pytest.mark.skipif(shutil.which("powershell.exe") is None, reason="PowerShell is unavailable")
def test_bootstrap_smoke_passes_every_live_devspace_root_to_recover(tmp_path: Path) -> None:
    codex_home = tmp_path / "codex-home"
    helper = codex_home / "skills" / "chatgpt-workspace-setup" / "scripts" / "devspace_tailscale_setup.py"
    helper.parent.mkdir(parents=True)
    capture = tmp_path / "captured.json"
    helper.write_text(
        "import json, sys\n"
        f"open({str(capture)!r}, 'w', encoding='utf-8').write(json.dumps(sys.argv[1:], ensure_ascii=False))\n",
        encoding="utf-8",
    )
    bootstrap = tmp_path / "bootstrap.json"
    bootstrap.write_text(
        json.dumps(
            {
                "schema": "codexpro.devspace-bootstrap/v1",
                "python_path": sys.executable,
                "roots": [r"C:\stale-root-must-not-be-used"],
                "hostname": "device.example.ts.net",
                "local_port": 7676,
                "public_port": 443,
            }
        ),
        encoding="utf-8",
    )
    devspace = tmp_path / "devspace.json"
    roots = [tmp_path / "one", tmp_path / "two", tmp_path / "unicode-여행"]
    for root in roots:
        root.mkdir()
    devspace.write_text(
        json.dumps({"allowedRoots": [str(root.resolve()) for root in roots]}, ensure_ascii=False),
        encoding="utf-8",
    )

    completed = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(SCRIPT),
            "-AgentHome",
            str(codex_home),
            "-ConfigPath",
            str(bootstrap),
            "-DevSpaceConfigPath",
            str(devspace),
            "-Mode",
            "Once",
            "-MutexName",
            f"CodexProDevSpaceBootstrapTest-{uuid.uuid4().hex}",
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    argv = json.loads(capture.read_text(encoding="utf-8"))
    passed_roots = [argv[index + 1] for index, value in enumerate(argv) if value == "--root"]
    assert passed_roots == [str(root.resolve()) for root in roots]
    assert r"C:\stale-root-must-not-be-used" not in argv
    assert argv[-6:] == [
        "--hostname",
        "device.example.ts.net",
        "--local-port",
        "7676",
        "--public-port",
        "443",
    ]


@pytest.mark.skipif(shutil.which("powershell.exe") is None, reason="PowerShell is unavailable")
def test_watch_mode_rechecks_health_without_losing_live_roots(tmp_path: Path) -> None:
    codex_home = tmp_path / "codex-home"
    helper = codex_home / "skills" / "chatgpt-workspace-setup" / "scripts" / "devspace_tailscale_setup.py"
    helper.parent.mkdir(parents=True)
    capture = tmp_path / "watch-calls.jsonl"
    helper.write_text(
        "import json, sys\n"
        f"with open({str(capture)!r}, 'a', encoding='utf-8') as stream:\n"
        "    stream.write(json.dumps(sys.argv[1:], ensure_ascii=False) + '\\n')\n",
        encoding="utf-8",
    )
    root = tmp_path / "unicode-여행"
    root.mkdir()
    bootstrap = tmp_path / "bootstrap.json"
    bootstrap.write_text(
        json.dumps(
            {
                "schema": "codexpro.devspace-bootstrap/v1",
                "python_path": sys.executable,
                "roots": [r"C:\stale-root-must-not-be-used"],
                "hostname": "device.example.ts.net",
                "local_port": 7676,
                "public_port": 443,
            }
        ),
        encoding="utf-8",
    )
    devspace = tmp_path / "devspace.json"
    devspace.write_text(
        json.dumps({"allowedRoots": [str(root.resolve())]}, ensure_ascii=False),
        encoding="utf-8",
    )

    completed = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(SCRIPT),
            "-AgentHome",
            str(codex_home),
            "-ConfigPath",
            str(bootstrap),
            "-DevSpaceConfigPath",
            str(devspace),
            "-Mode",
            "Watch",
            "-WatchIntervalSeconds",
            "0",
            "-MaxCycles",
            "2",
            "-MutexName",
            f"CodexProDevSpaceBootstrapTest-{uuid.uuid4().hex}",
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    calls = [json.loads(line) for line in capture.read_text(encoding="utf-8").splitlines()]
    assert len(calls) == 2
    assert all(str(root.resolve()) in call for call in calls)
