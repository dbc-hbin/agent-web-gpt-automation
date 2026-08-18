#!/usr/bin/env python3
"""Portable, receipt-backed lifecycle for Agent Web GPT Automation.

The codexpro-* receipt and schema identifiers are stable compatibility IDs
retained for exact rollback and recovery of older installations.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from agent_web_gpt_paths import resolve_home
import shutil
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


RECEIPT_SCHEMA = "codexpro.install-receipt/v3"
WAL_SCHEMA = "codexpro.install-wal/v1"
SUPPORTED_ROOTS = {
    "bin",
    "skills",
    "mcp_servers",
    "scripts",
    "contracts",
    "docs",
    "tests",
    "plugins",
    "marketplace",
}


class LifecycleError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    payload = json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    try:
        with temporary.open("xb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            pass
    finally:
        temporary.unlink(missing_ok=True)


def _copy_file_atomic(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
    try:
        with source.open("rb") as input_stream, temporary.open("xb") as output_stream:
            shutil.copyfileobj(input_stream, output_stream)
            output_stream.flush()
            os.fsync(output_stream.fileno())
        shutil.copymode(source, temporary)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def _is_within(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return candidate != root
    except ValueError:
        return False


def safe_child(root: Path, relative: str) -> Path:
    if not relative or Path(relative).is_absolute() or any(part in {"", ".", ".."} for part in Path(relative).parts):
        raise LifecycleError(f"unsafe relative path: {relative}")
    root = root.expanduser().resolve()
    candidate = (root / relative).resolve(strict=False)
    if not _is_within(root, candidate):
        raise LifecycleError(f"path escapes root: {relative}")
    cursor = candidate.parent
    while cursor != root:
        if cursor.exists() and cursor.is_symlink():
            raise LifecycleError(f"symlink path refused: {cursor}")
        cursor = cursor.parent
    if candidate.exists() and candidate.is_symlink():
        raise LifecycleError(f"symlink destination refused: {candidate}")
    return candidate


def manifest_files(repo_root: Path) -> list[str]:
    manifest = json.loads((repo_root / "install-manifest.json").read_text(encoding="utf-8"))
    result: set[str] = set()
    patterns = list(manifest.get("include", []))
    for pattern in patterns:
        path = Path(str(pattern))
        if path.is_absolute() or any(part in {".", ".."} for part in path.parts):
            raise LifecycleError(f"unsafe manifest pattern: {pattern}")
        if not path.parts or path.parts[0] not in SUPPORTED_ROOTS:
            raise LifecycleError(f"unsupported manifest root: {pattern}")
        matches = [item for item in repo_root.glob(str(pattern)) if item.is_file()]
        if not matches:
            raise LifecycleError(f"manifest pattern matched no files: {pattern}")
        for item in matches:
            if item.is_symlink():
                raise LifecycleError(f"manifest refuses symlink: {item}")
            result.add(item.relative_to(repo_root).as_posix())
    return sorted(result)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise LifecycleError(f"invalid JSON: {path}") from exc
    if not isinstance(value, dict):
        raise LifecycleError(f"JSON object required: {path}")
    return value


def _active_wals(codex_home: Path) -> Iterable[Path]:
    backup_root = codex_home / "backups"
    if not backup_root.is_dir():
        return ()
    return sorted(backup_root.glob("**/install.wal.json"))


def recover_pending_installs(codex_home: Path) -> list[str]:
    recovered: list[str] = []
    for wal_path in _active_wals(codex_home):
        wal = _read_json(wal_path)
        if wal.get("schema") != WAL_SCHEMA or wal.get("status") in {"COMPLETE", "ROLLED_BACK_AFTER_CRASH"}:
            continue
        backup = Path(str(wal.get("backup") or "")).expanduser().resolve()
        if not _is_within((codex_home / "backups").resolve(), backup):
            raise LifecycleError("interrupted install backup escapes CODEX_HOME")
        conflicts: list[str] = []
        for entry in reversed(list(wal.get("files") or [])):
            relative = str(entry.get("path") or "")
            destination = safe_child(codex_home, relative)
            installed_hash = str(entry.get("installed_sha256") or "")
            if not destination.exists():
                continue
            actual = sha256_file(destination)
            if entry.get("phase") == "INTENT" and actual != installed_hash:
                continue
            if actual != installed_hash:
                conflicts.append(relative)
                continue
            if entry.get("action") == "created":
                destination.unlink()
            else:
                source = safe_child(backup, relative)
                if not source.is_file() or sha256_file(source) != entry.get("backup_sha256"):
                    conflicts.append(relative)
                    continue
                _copy_file_atomic(source, destination)
        if conflicts:
            raise LifecycleError(f"INSTALL_CRASH_RECOVERY_CONFLICT: {','.join(conflicts)}")
        wal["status"] = "ROLLED_BACK_AFTER_CRASH"
        wal["recovered_at"] = utc_now()
        _write_json_atomic(wal_path, wal)
        recovered.append(str(wal_path))
    return recovered


def install(repo_root: Path, codex_home: Path, *, dry_run: bool = False) -> dict[str, Any]:
    repo_root = repo_root.resolve()
    codex_home = codex_home.expanduser().resolve()
    files = manifest_files(repo_root)
    if dry_run:
        return {"ok": True, "action": "install-plan", "agent_home": str(codex_home), "files": files}
    codex_home.mkdir(parents=True, exist_ok=True)
    recovered = recover_pending_installs(codex_home)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S%f")
    nonce = uuid.uuid4().hex
    backup_root = codex_home / "backups" / f"codexpro-automation-{stamp}-{nonce}"
    receipt_path = codex_home / "receipts" / f"codexpro-automation-{stamp}-{nonce}.json"
    wal_path = backup_root / "install.wal.json"
    wal: dict[str, Any] = {
        "schema": WAL_SCHEMA,
        "status": "ACTIVE",
        "backup": str(backup_root),
        "created_at": utc_now(),
        "files": [],
    }
    records: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="codexpro-stage-") as stage_text:
        stage_root = Path(stage_text)
        for relative in files:
            source = safe_child(repo_root, relative)
            staged = safe_child(stage_root, relative)
            _copy_file_atomic(source, staged)
            if sha256_file(source) != sha256_file(staged):
                raise LifecycleError(f"staging hash verification failed: {relative}")
        _write_json_atomic(wal_path, wal)
        try:
            for index, relative in enumerate(files):
                destination = safe_child(codex_home, relative)
                staged = safe_child(stage_root, relative)
                action = "created"
                backup_hash: str | None = None
                if destination.exists():
                    action = "overwritten"
                    backup = safe_child(backup_root, relative)
                    _copy_file_atomic(destination, backup)
                    backup_hash = sha256_file(backup)
                installed_hash = sha256_file(staged)
                replacement_path = backup_root / "steps" / str(index) / "replacement.json"
                entry: dict[str, Any] = {
                    "path": relative,
                    "action": action,
                    "installed_sha256": installed_hash,
                    "backup_sha256": backup_hash,
                    "phase": "INTENT",
                    "transitions": ["INTENT"],
                    "replacement": str(replacement_path),
                }
                wal["files"].append(entry)
                _write_json_atomic(wal_path, wal)
                _copy_file_atomic(staged, destination)
                entry["phase"] = "MUTATED"
                entry["transitions"].append("MUTATED")
                _write_json_atomic(wal_path, wal)
                _write_json_atomic(replacement_path, {
                    "schema": "codexpro.install-replacement/v1",
                    "path": relative,
                    "action": action,
                    "installed_sha256": installed_hash,
                    "backup_sha256": backup_hash,
                    "mutated_at": utc_now(),
                })
                if sha256_file(destination) != installed_hash:
                    raise LifecycleError(f"commit hash verification failed: {relative}")
                entry["phase"] = "VERIFIED"
                entry["transitions"].append("VERIFIED")
                _write_json_atomic(wal_path, wal)
                entry["phase"] = "COMPLETE"
                entry["transitions"].append("COMPLETE")
                _write_json_atomic(wal_path, wal)
                records.append({key: entry[key] for key in ("path", "action", "installed_sha256", "backup_sha256")})
        except Exception:
            _rollback_records(codex_home, backup_root, records)
            raise
    wal["status"] = "COMPLETE"
    wal["completed_at"] = utc_now()
    _write_json_atomic(wal_path, wal)
    receipt = {
        "schema": RECEIPT_SCHEMA,
        "installed_at": utc_now(),
        "manifest_version": json.loads((repo_root / "install-manifest.json").read_text(encoding="utf-8"))["version"],
        "backup": str(backup_root),
        "files": records,
        "dependency": {"mode": "skipped", "reason": "legacy-recovery-dependencies-frozen"},
        "wal": str(wal_path),
        "installer": "python-portable",
    }
    _write_json_atomic(receipt_path, receipt)
    return {"ok": True, "action": "installed", "count": len(records), "receipt": str(receipt_path), "recovered": recovered}


def _rollback_records(codex_home: Path, backup_root: Path, records: Iterable[dict[str, Any]]) -> list[dict[str, str]]:
    conflicts: list[dict[str, str]] = []
    for record in reversed(list(records)):
        relative = str(record["path"])
        destination = safe_child(codex_home, relative)
        if not destination.exists() or sha256_file(destination) != record.get("installed_sha256"):
            conflicts.append({"path": relative, "action": "preserved_modified_or_missing"})
            continue
        if record.get("action") == "created":
            destination.unlink()
            continue
        backup = safe_child(backup_root, relative)
        if not backup.is_file() or sha256_file(backup) != record.get("backup_sha256"):
            conflicts.append({"path": relative, "action": "missing_backup"})
            continue
        _copy_file_atomic(backup, destination)
    return conflicts


def latest_receipt(codex_home: Path) -> Path:
    receipts = sorted((codex_home / "receipts").glob("codexpro-automation-*.json"), key=lambda path: path.stat().st_mtime_ns)
    if not receipts:
        raise LifecycleError("RECEIPT_MISSING")
    return receipts[-1]


def rollback(codex_home: Path, receipt_path: Path | None = None) -> dict[str, Any]:
    codex_home = codex_home.expanduser().resolve()
    receipt_path = (receipt_path or latest_receipt(codex_home)).expanduser().resolve()
    receipt_root = (codex_home / "receipts").resolve()
    if not _is_within(receipt_root, receipt_path):
        raise LifecycleError("receipt must be owned by this agent home")
    receipt = _read_json(receipt_path)
    if receipt.get("schema") not in {"codexpro.install-receipt/v2", RECEIPT_SCHEMA}:
        raise LifecycleError("unsupported install receipt schema")
    backup_root = Path(str(receipt.get("backup") or "")).expanduser().resolve()
    if not _is_within((codex_home / "backups").resolve(), backup_root):
        raise LifecycleError("receipt backup must be owned by this agent home")
    conflicts = _rollback_records(codex_home, backup_root, receipt.get("files") or [])
    status = "CONFLICT" if conflicts else "COMPLETE"
    return {"ok": not conflicts, "status": status, "receipt": str(receipt_path), "conflicts": conflicts}


def doctor(codex_home: Path) -> dict[str, Any]:
    codex_home = codex_home.expanduser().resolve()
    issues: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    receipt_path: Path | None = None
    devspace_native_runtime: dict[str, Any] | None = None
    try:
        receipt_path = latest_receipt(codex_home)
        receipt = _read_json(receipt_path)
        for record in receipt.get("files") or []:
            path = safe_child(codex_home, str(record.get("path") or ""))
            if not path.is_file():
                issues.append({"code": "FILE_MISSING", "path": str(record.get("path"))})
            elif sha256_file(path) != record.get("installed_sha256"):
                issues.append({"code": "HASH_MISMATCH", "path": str(record.get("path"))})
    except LifecycleError as exc:
        issues.append({"code": "RECEIPT_INVALID", "detail": str(exc)})
    required = _required_tools()
    for name, path in required.items():
        if path is None:
            issues.append({"code": "TOOL_MISSING", "tool": name})
    compat_helper = codex_home / "bin" / "chatgpt_devspace_compat.py"
    if compat_helper.is_file() and required.get("node"):
        native = subprocess.run(
            [
                sys.executable,
                str(compat_helper),
                "--check-native-runtime",
                "--allow-package-absent",
            ],
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            check=False,
            timeout=45,
        )
        try:
            devspace_native_runtime = json.loads(native.stdout)
        except json.JSONDecodeError:
            devspace_native_runtime = None
        if native.returncode != 0 or not isinstance(devspace_native_runtime, dict) or not devspace_native_runtime.get("ok"):
            error = (
                devspace_native_runtime.get("error")
                if isinstance(devspace_native_runtime, dict)
                else None
            )
            issues.append(
                {
                    "code": "DEVSPACE_NATIVE_RUNTIME_INVALID",
                    "detail": error or (native.stderr or "invalid native-runtime probe").strip()[-1200:],
                }
            )
    if os.name != "nt" and shutil.which("rsync") is None:
        issues.append({"code": "ORACLE_PROFILE_COPY_RSYNC_MISSING"})
    if sys.platform == "darwin":
        for tool in ("launchctl", "plutil", "lsof", "ps"):
            if shutil.which(tool) is None:
                issues.append({"code": "MACOS_TOOL_MISSING", "tool": tool})
        if shutil.which("tailscale") is None:
            warnings.append({"code": "TAILSCALE_NOT_INSTALLED", "next_action": "install tailscale-app and sign in"})
    return {
        "schema": "codexpro.doctor/v3",
        "status": "FAIL" if issues else "PASS",
        "platform": sys.platform,
        "agent_home": str(codex_home),
        "receipt": str(receipt_path) if receipt_path else None,
            "issues": issues,
            "warnings": warnings,
            "tools": required,
            "devspace_native_runtime": devspace_native_runtime,
        }


def _required_tools(platform_name: str | None = None) -> dict[str, str | None]:
    platform_name = os.name if platform_name is None else platform_name
    python_path = sys.executable if platform_name == "nt" else shutil.which("python3")
    return {"python3": python_path, "node": shutil.which("node"), "npx": shutil.which("npx")}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    def common(value: argparse.ArgumentParser) -> None:
        value.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
        value.add_argument("--agent-home", type=Path, dest="codex_home", default=resolve_home())
    for name in ("install", "update"):
        value = commands.add_parser(name)
        common(value)
        value.add_argument("--dry-run", action="store_true")
    value = commands.add_parser("doctor")
    common(value)
    for name in ("rollback", "uninstall"):
        value = commands.add_parser(name)
        common(value)
        value.add_argument("--receipt", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command in {"install", "update"}:
            result = install(args.repo_root, args.codex_home, dry_run=args.dry_run)
        elif args.command == "doctor":
            result = doctor(args.codex_home)
        else:
            result = rollback(args.codex_home, args.receipt)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get("ok", result.get("status") == "PASS") else 2
    except LifecycleError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
