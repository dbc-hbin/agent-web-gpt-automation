from __future__ import annotations

import contextlib
import io
import importlib.util
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def test_portable_lifecycle_is_exact_inverse(tmp_path: Path) -> None:
    module = load("portable_lifecycle_test", ROOT / "bin" / "agent_web_gpt_lifecycle.py")
    codex_home = tmp_path / "codex"
    prior = codex_home / "bin" / "chatgpt_oracle_state.py"
    prior.parent.mkdir(parents=True)
    prior.write_bytes(b"user-owned-before\n")

    plan = module.install(ROOT, codex_home, dry_run=True)
    assert plan["ok"] and "bin/chatgpt_oracle_run.py" in plan["files"]
    assert not (codex_home / "receipts").exists()

    installed = module.install(ROOT, codex_home)
    assert installed["ok"] and installed["count"] > 30
    receipt = Path(installed["receipt"])
    assert module.doctor(codex_home)["status"] == "PASS"

    rolled_back = module.rollback(codex_home, receipt)
    assert rolled_back == {"ok": True, "status": "COMPLETE", "receipt": str(receipt), "conflicts": []}
    assert prior.read_bytes() == b"user-owned-before\n"
    assert not (codex_home / "bin" / "chatgpt_oracle_run.py").exists()


def test_windows_doctor_uses_running_interpreter_without_python3_alias(monkeypatch) -> None:
    module = load("portable_lifecycle_windows_python_test", ROOT / "bin" / "agent_web_gpt_lifecycle.py")
    monkeypatch.setattr(module.shutil, "which", lambda name: None if name == "python3" else f"tool/{name}")

    required = module._required_tools(platform_name="nt")

    assert required["python3"] == sys.executable
    assert required["node"] == "tool/node"
    assert required["npx"] == "tool/npx"


def test_posix_doctor_preserves_python3_path_check(monkeypatch) -> None:
    module = load("portable_lifecycle_posix_python_test", ROOT / "bin" / "agent_web_gpt_lifecycle.py")
    monkeypatch.setattr(module.shutil, "which", lambda name: f"tool/{name}")

    required = module._required_tools(platform_name="posix")

    assert required["python3"] == "tool/python3"


def test_doctor_has_no_retired_agbrowse_warning(tmp_path: Path, monkeypatch) -> None:
    module = load("portable_lifecycle_no_legacy_warning_test", ROOT / "bin" / "agent_web_gpt_lifecycle.py")
    codex_home = tmp_path / "codex"
    module.install(ROOT, codex_home)
    original_which = module.shutil.which
    monkeypatch.setattr(
        module.shutil,
        "which",
        lambda name: None if name == "agbrowse" else original_which(name),
    )

    result = module.doctor(codex_home)

    assert all(item.get("code") != "LEGACY_AGBROWSE_MISSING" for item in result["warnings"])


def test_install_parser_has_no_retired_local_multi_switches() -> None:
    module = load("portable_lifecycle_no_legacy_switch_test", ROOT / "bin" / "agent_web_gpt_lifecycle.py")

    parser = module.build_parser()
    for retired_flag in ("--enable-local-multi-gpt", "--disable-local-multi-gpt"):
        with contextlib.redirect_stderr(io.StringIO()):
            try:
                parser.parse_args(["install", retired_flag])
            except SystemExit as exc:
                assert exc.code != 0
            else:
                raise AssertionError(f"retired flag was accepted: {retired_flag}")


def test_portable_rollback_preserves_modified_managed_file(tmp_path: Path) -> None:
    module = load("portable_lifecycle_conflict_test", ROOT / "bin" / "agent_web_gpt_lifecycle.py")
    codex_home = tmp_path / "codex"
    installed = module.install(ROOT, codex_home)
    managed = codex_home / "bin" / "chatgpt_oracle_run.py"
    managed.write_text("user changed\n", encoding="utf-8")

    result = module.rollback(codex_home, Path(installed["receipt"]))

    assert result["ok"] is False
    assert any(item["path"] == "bin/chatgpt_oracle_run.py" for item in result["conflicts"])
    assert managed.read_text(encoding="utf-8") == "user changed\n"


def test_portable_receipt_rejects_external_backup(tmp_path: Path) -> None:
    module = load("portable_lifecycle_forgery_test", ROOT / "bin" / "agent_web_gpt_lifecycle.py")
    codex_home = tmp_path / "codex"
    receipt = codex_home / "receipts" / "codexpro-automation-forged.json"
    receipt.parent.mkdir(parents=True)
    receipt.write_text(json.dumps({"schema": module.RECEIPT_SCHEMA, "backup": str(tmp_path / "outside"), "files": []}), encoding="utf-8")

    try:
        module.rollback(codex_home, receipt)
    except module.LifecycleError as exc:
        assert "backup must be owned" in str(exc)
    else:
        raise AssertionError("forged receipt was accepted")
