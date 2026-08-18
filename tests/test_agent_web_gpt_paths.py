from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bin" / "agent_web_gpt_paths.py"


def load_module():
    name = "agent_web_gpt_paths_test"
    spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def clear_home_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "AGENT_WEB_GPT_HOME",
        "CODEX_HOME",
        "AGENT_WEB_GPT_APP_NAME",
        "CODEX_CHATGPT_APP_NAME",
        "AGENT_WEB_GPT_ORACLE_STATE_ROOT",
        "CODEX_ORACLE_STATE_ROOT",
    ):
        monkeypatch.delenv(name, raising=False)


def test_home_precedence_is_explicit_neutral_then_legacy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_module()
    clear_home_env(monkeypatch)
    neutral = tmp_path / "neutral"
    legacy = tmp_path / "legacy"
    explicit = tmp_path / "explicit"
    monkeypatch.setenv("AGENT_WEB_GPT_HOME", str(neutral))
    monkeypatch.setenv("CODEX_HOME", str(legacy))

    assert module.resolve_home() == neutral.resolve()
    assert module.resolve_home(explicit) == explicit.resolve()

    monkeypatch.delenv("AGENT_WEB_GPT_HOME")
    assert module.resolve_home() == legacy.resolve()


def test_fresh_host_uses_neutral_home_but_existing_codex_home_is_preserved(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = load_module()
    clear_home_env(monkeypatch)
    monkeypatch.setattr(module.Path, "home", classmethod(lambda cls: tmp_path))

    assert module.resolve_home() == (tmp_path / ".agent-web-gpt").resolve()
    (tmp_path / ".codex").mkdir()
    assert module.resolve_home() == (tmp_path / ".codex").resolve()


def test_neutral_app_and_state_variables_precede_legacy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_module()
    clear_home_env(monkeypatch)
    neutral_state = tmp_path / "neutral-state"
    legacy_state = tmp_path / "legacy-state"
    monkeypatch.setenv("AGENT_WEB_GPT_APP_NAME", "agent-app")
    monkeypatch.setenv("CODEX_CHATGPT_APP_NAME", "legacy-app")
    monkeypatch.setenv("AGENT_WEB_GPT_ORACLE_STATE_ROOT", str(neutral_state))
    monkeypatch.setenv("CODEX_ORACLE_STATE_ROOT", str(legacy_state))

    assert module.resolve_app_name() == "agent-app"
    assert module.state_root(
        "AGENT_WEB_GPT_ORACLE_STATE_ROOT", "CODEX_ORACLE_STATE_ROOT", "runs"
    ) == neutral_state.resolve()


def test_default_app_name_matches_onboarding() -> None:
    module = load_module()
    assert module.resolve_app_name() == "codex"
