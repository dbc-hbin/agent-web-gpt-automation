from __future__ import annotations

"""Lightweight first-use exact-root qualification for DevSpace transports."""

import hashlib
import json
import os
import urllib.error
import urllib.request
from agent_web_gpt_paths import resolve_home
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


QUALIFICATION_SCHEMA = "codex.chatgpt.devspace-root-qualification/v1"


class DevSpacePreflightError(RuntimeError):
    def __init__(self, code: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.evidence = evidence or {}


def _path_key(path: Path) -> str:
    return os.path.normcase(os.path.normpath(str(path)))


def check_devspace_service_live(
    port: int = 7676,
    *,
    timeout: float = 1.0,
    probe_url: str | None = None,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> bool:
    """Fail-fast check to ensure DevSpace service is running before browser launch."""
    if (
        os.environ.get("AGENT_WEB_GPT_DEVSPACE_PROBE_DISABLED") == "1"
        or os.environ.get("CODEX_DEVSPACE_PROBE_DISABLED") == "1"
    ):
        return True
    target_url = probe_url or f"http://127.0.0.1:{port}/mcp"
    request = urllib.request.Request(
        target_url,
        method="GET",
        headers={"Accept": "application/json, text/plain;q=0.8"},
    )
    try:
        with opener(request, timeout=timeout) as response:
            if response.status in {200, 401, 403, 405, 406}:
                return True
    except urllib.error.HTTPError as error:
        if error.code in {401, 403, 405, 406}:
            return True
    except Exception as exc:
        raise DevSpacePreflightError(
            "DEVSPACE_SERVICE_UNAVAILABLE",
            f"DevSpace local server is not running on 127.0.0.1:{port}. Start DevSpace with `devspace serve` before running ChatGPT DevSpace missions.",
            {"port": port, "target_url": target_url, "error": str(exc)},
        ) from exc
    raise DevSpacePreflightError(
        "DEVSPACE_SERVICE_UNAVAILABLE",
        f"DevSpace local server on 127.0.0.1:{port} returned an unexpected status.",
        {"port": port, "target_url": target_url},
    )


def _registration_url(bootstrap_path: Path) -> str | None:
    try:
        payload = json.loads(bootstrap_path.read_text(encoding="utf-8"))
        hostname = str(payload.get("hostname") or "").strip().lower().rstrip(".")
        public_port = int(payload.get("public_port") or 443)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None
    if not hostname:
        return None
    suffix = "" if public_port == 443 else f":{public_port}"
    return f"https://{hostname}{suffix}/mcp"


def _next_action(
    project_root: Path,
    configured_roots: list[Path],
    *,
    registration_url: str | None,
) -> dict[str, Any]:
    roots = [*configured_roots]
    if all(_path_key(root) != _path_key(project_root) for root in roots):
        roots.append(project_root)
    setup_script = (
        Path(__file__).resolve().parents[1]
        / "skills"
        / "chatgpt-workspace-setup"
        / "scripts"
        / "devspace_tailscale_setup.py"
    )
    setup_argv = [sys.executable, str(setup_script), "setup"]
    for root in roots:
        setup_argv.extend(["--root", str(root)])
    if registration_url:
        hostname = registration_url.split("//", 1)[-1].split("/", 1)[0].split(":", 1)[0]
        setup_argv.extend(["--hostname", hostname])
    setup_argv.append("--dry-run")
    return {
        "next_action": "REGISTER_EXACT_DEVSPACE_ROOT_BEFORE_ORACLE_SUBMISSION",
        "setup_argv": setup_argv,
        "doctor_after_registration": True,
        "registration_url": registration_url,
    }


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, raw = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(raw)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def ensure_exact_root_qualified(
    project_root: Path,
    *,
    config_path: Path | None = None,
    qualification_root: Path | None = None,
    bootstrap_path: Path | None = None,
    json_loader: Callable[[str], Any] = json.loads,
) -> dict[str, Any]:
    """Qualify an exact root from local config, caching by config byte hash.

    This is deliberately not an endpoint, OAuth, ChatGPT-app, or read probe.
    The first use parses the current allowedRoots.  Later uses reuse the receipt
    while the exact config bytes remain unchanged; a config change revalidates.
    """
    try:
        root = project_root.expanduser().resolve(strict=True)
    except OSError as exc:
        raise DevSpacePreflightError(
            "DEVSPACE_EXACT_ROOT_UNAVAILABLE",
            "the exact project root does not exist",
            {"missing_root": str(project_root)},
        ) from exc
    if not root.is_dir():
        raise DevSpacePreflightError(
            "DEVSPACE_EXACT_ROOT_UNAVAILABLE",
            "the exact project root is not a directory",
            {"missing_root": str(root)},
        )

    config_file = (config_path or (Path.home() / ".devspace" / "config.json")).resolve()
    bootstrap_file = (
        bootstrap_path
        or (resolve_home() / "config" / "codexpro-devspace-bootstrap.json")
    ).resolve()
    registration_url = _registration_url(bootstrap_file)
    try:
        config_bytes = config_file.read_bytes()
    except OSError as exc:
        action = _next_action(root, [], registration_url=registration_url)
        raise DevSpacePreflightError(
            "DEVSPACE_EXACT_ROOT_UNAVAILABLE",
            "DevSpace config is unavailable before the first submission for this project",
            {"missing_root": str(root), "config_path": str(config_file), **action},
        ) from exc

    config_sha256 = hashlib.sha256(config_bytes).hexdigest()
    state_root = (
        qualification_root
        or Path(
            os.environ.get("AGENT_WEB_GPT_DEVSPACE_QUALIFICATION_ROOT")
            or os.environ.get("CODEX_DEVSPACE_QUALIFICATION_ROOT")
            or (resolve_home() / "state" / "chatgpt-oracle" / "devspace-qualifications")
        )
    ).resolve()
    receipt_path = state_root / f"{hashlib.sha256(_path_key(root).encode('utf-8')).hexdigest()[:24]}.json"
    try:
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        receipt = None
    if (
        isinstance(receipt, dict)
        and receipt.get("schema") == QUALIFICATION_SCHEMA
        and _path_key(Path(str(receipt.get("project_root") or ""))) == _path_key(root)
        and receipt.get("config_sha256") == config_sha256
        and receipt.get("qualified") is True
    ):
        return {**receipt, "cached": True, "receipt_path": str(receipt_path)}

    try:
        payload = json_loader(config_bytes.decode("utf-8", errors="strict"))
        values = payload.get("allowedRoots") if isinstance(payload, dict) else None
        if not isinstance(values, list) or not values:
            raise ValueError("allowedRoots missing")
        configured_roots = [Path(str(value)).expanduser().resolve() for value in values]
    except (UnicodeDecodeError, ValueError, TypeError, OSError, json.JSONDecodeError) as exc:
        action = _next_action(root, [], registration_url=registration_url)
        raise DevSpacePreflightError(
            "DEVSPACE_EXACT_ROOT_UNAVAILABLE",
            "DevSpace allowedRoots cannot be verified",
            {"missing_root": str(root), "config_path": str(config_file), **action},
        ) from exc

    exact = next((item for item in configured_roots if _path_key(item) == _path_key(root)), None)
    if exact is None:
        action = _next_action(root, configured_roots, registration_url=registration_url)
        raise DevSpacePreflightError(
            "DEVSPACE_EXACT_ROOT_UNAVAILABLE",
            "the exact project root is not registered in DevSpace allowedRoots",
            {
                "missing_root": str(root),
                "configured_roots": [str(item) for item in configured_roots],
                "config_path": str(config_file),
                **action,
            },
        )

    receipt = {
        "schema": QUALIFICATION_SCHEMA,
        "qualified": True,
        "project_root": str(root),
        "allowed_root": str(exact),
        "config_path": str(config_file),
        "config_sha256": config_sha256,
        "qualified_at": datetime.now(timezone.utc).isoformat(),
        "registration_url": registration_url,
    }
    _write_json_atomic(receipt_path, receipt)
    return {**receipt, "cached": False, "receipt_path": str(receipt_path)}
