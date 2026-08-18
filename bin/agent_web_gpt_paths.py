from __future__ import annotations

"""Compatibility-aware paths for Agent Web GPT Automation."""

import os
from pathlib import Path


DEFAULT_APP_NAME = "codex"


def resolve_home(explicit: str | os.PathLike[str] | None = None) -> Path:
    """Resolve the selected automation home without breaking existing installs."""
    if explicit is not None and str(explicit).strip():
        return Path(explicit).expanduser().resolve()
    for name in ("AGENT_WEB_GPT_HOME", "CODEX_HOME"):
        value = os.environ.get(name, "").strip()
        if value:
            return Path(value).expanduser().resolve()
    legacy = Path.home() / ".codex"
    return legacy.resolve() if legacy.is_dir() else (Path.home() / ".agent-web-gpt").resolve()


def resolve_app_name(explicit: str | None = None) -> str:
    """Resolve the registered ChatGPT app display name."""
    if explicit and explicit.strip():
        return explicit.strip()
    for name in ("AGENT_WEB_GPT_APP_NAME", "CODEX_CHATGPT_APP_NAME"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return DEFAULT_APP_NAME


def state_root(neutral_env: str, legacy_env: str, *default_parts: str) -> Path:
    """Resolve a complete state-root override or a home-relative default."""
    value = os.environ.get(neutral_env, "").strip() or os.environ.get(legacy_env, "").strip()
    if value:
        return Path(value).expanduser().resolve()
    return (resolve_home() / "state").joinpath(*default_parts).resolve()
