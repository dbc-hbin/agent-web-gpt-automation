from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import uuid
import re
from contextlib import nullcontext
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Iterable

SCHEMA = "codex.chatgpt.oracle-multi/v1"
RESULT_SCHEMA = "codex.chatgpt.oracle-multi-result/v1"
LANE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
BIN = Path(__file__).resolve().parent


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"module unavailable: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


RUNNER = _load("chatgpt_oracle_multi_runner", BIN / "chatgpt_oracle_run.py")
STATE = RUNNER.STATE
WORKSPACE_CONFIG = _load("chatgpt_oracle_multi_workspace_config", BIN / "chatgpt_workspace_config.py")


class MultiError(RuntimeError):
    pass


def _git_common_dir(root: Path) -> Path:
    completed = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--path-format=absolute", "--git-common-dir"],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        check=False,
        **STATE.windows_subprocess_kwargs(),
    )
    if completed.returncode != 0 or not (completed.stdout or "").strip():
        raise MultiError(f"write worktree is not a Git worktree: {root}")
    return Path(completed.stdout.strip()).resolve()


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise MultiError("manifest must be a JSON object")
    return value


def _inside(root: Path, value: Any, *, exists: bool = True) -> Path:
    path = Path(str(value or "")).expanduser()
    if not path.is_absolute():
        raise MultiError("all paths must be absolute")
    path = path.resolve(strict=exists)
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise MultiError(f"path outside project: {path}") from exc
    return path


def load_manifest(path: Path) -> dict[str, Any]:
    value = _read_json(path.resolve(strict=True))
    if value.get("schema") != SCHEMA:
        raise MultiError(f"schema must be {SCHEMA}")
    root = Path(str(value.get("project_root") or "")).expanduser().resolve(strict=True)
    output_dir = _inside(root, value.get("output_dir"), exists=False)
    allowed_worktrees = []
    for raw in value.get("allowed_worktree_roots") or []:
        candidate = Path(str(raw)).expanduser()
        if not candidate.is_absolute():
            raise MultiError("allowed worktree roots must be absolute")
        allowed_worktrees.append(candidate.resolve(strict=True))
    solvers = value.get("solvers")
    if not isinstance(solvers, list) or not 2 <= len(solvers) <= 25:
        raise MultiError("solvers must contain 2..25 lanes")
    normalized = []
    seen = set()
    for index, item in enumerate(solvers):
        if not isinstance(item, dict):
            raise MultiError("each solver must be an object")
        lane = str(item.get("id") or f"solver-{index}").strip()
        if LANE_RE.fullmatch(lane) is None or lane in seen:
            raise MultiError("solver ids must be unique")
        seen.add(lane)
        access = str(item.get("access") or "read-only")
        if access not in {"read-only", "worktree-write"}:
            raise MultiError("solver access must be read-only or worktree-write")
        lane_root = Path(str(item.get("project_root") or root)).expanduser().resolve(strict=True)
        if lane_root != root and lane_root not in allowed_worktrees:
            raise MultiError("external worktree root must be explicitly allowed")
        normalized.append({
            "id": lane,
            "mission_path": _inside(lane_root, item.get("mission_path")),
            "access": access,
            "project_root": lane_root,
        })
    write_roots = [item["project_root"] for item in normalized if item["access"] == "worktree-write"]
    if len(write_roots) != len(set(write_roots)) or any(path == root for path in write_roots):
        raise MultiError("write solvers require distinct pre-created worktree roots")
    if write_roots:
        canonical_common = _git_common_dir(root)
        if any(_git_common_dir(path) != canonical_common for path in write_roots):
            raise MultiError("write solver worktrees must belong to the canonical repository")
    merger = _inside(root, value.get("merger_mission_path"))
    next_stage_result = (
        _inside(root, value.get("next_stage_result_path"), exists=False)
        if value.get("next_stage_result_path")
        else None
    )
    concurrency = int(value.get("max_concurrency", 5))
    if not 1 <= concurrency <= 5:
        raise MultiError("max_concurrency must be within 1..5")
    try:
        app_name = WORKSPACE_CONFIG.normalize_app_name(
            value.get("app_name") or WORKSPACE_CONFIG.configured_app_name()
        )
    except ValueError as exc:
        raise MultiError(str(exc)) from exc
    return {
        **value,
        "project_root": root,
        "output_dir": output_dir,
        "solvers": normalized,
        "merger_mission_path": merger,
        "next_stage_result_path": next_stage_result,
        "max_concurrency": concurrency,
        "app_name": app_name,
        "model": str(value.get("model") or "gpt-5.6").strip(),
        "copy_profile": Path(
            str(value.get("copy_profile") or (Path.home() / ".oracle" / "browser-profile"))
        ).expanduser().resolve(),
        "allowed_worktree_roots": allowed_worktrees,
        "manifest_sha256": hashlib.sha256(path.resolve(strict=True).read_bytes()).hexdigest(),
        "manifest_path": path.resolve(strict=True),
        "next_stage_binding": value.get("next_stage_binding") if isinstance(value.get("next_stage_binding"), dict) else {},
    }


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _child_manifest(config: dict[str, Any], lane: dict[str, Any], parent_id: str) -> Path:
    lane_root = config["output_dir"] / "lanes" / lane["id"]
    manifest = lane_root / "oracle.json"
    provenance = lane_root / "child-provenance.json"
    _write_json(provenance, {
        "schema": "codex.chatgpt.oracle-multi-child-provenance/v1",
        "parent_id": parent_id,
        "parent_manifest_path": str(config["manifest_path"]),
        "parent_manifest_sha256": config["manifest_sha256"],
        "project_root": str(lane.get("project_root") or config["project_root"]),
        "lane_id": lane["id"],
        "mission_path": str(lane["mission_path"]),
        "mission_sha256": hashlib.sha256(lane["mission_path"].read_bytes()).hexdigest(),
    })
    _write_json(
        manifest,
        {
            "schema": STATE.SCHEMA,
            "project_root": str(lane.get("project_root") or config["project_root"]),
            "mission_path": str(lane["mission_path"]),
            "app_name": config["app_name"],
            "mode": "browser",
            "model": config["model"],
            "model_strategy": "select",
            "thinking_time": "extra-high",
            "copy_profile": str(config["copy_profile"]),
            "research": "off",
            "archive": "auto",
            "parallel_parent_id": parent_id,
            "web_multi_child_provenance_path": str(provenance),
        },
    )
    return manifest


def _run_lane(
    config: dict[str, Any],
    lane: dict[str, Any],
    parent_id: str,
    execute: Callable[..., dict[str, Any]],
    dry_run: bool,
) -> dict[str, Any]:
    manifest = _child_manifest(config, lane, parent_id)
    result = execute(manifest, dry_run=dry_run)
    output = None
    session_locator = None
    if not dry_run and result.get("run_dir"):
        run_dir = Path(str(result["run_dir"]))
        source = run_dir / "output.md"
        state_path = run_dir / "state.json"
        if state_path.is_file():
            state = _read_json(state_path)
            oracle = state.get("oracle") if isinstance(state.get("oracle"), dict) else {}
            session_locator = oracle.get("session_locator")
        if source.is_file() and source.read_bytes().strip():
            output = config["output_dir"] / "handoffs" / f"{lane['id']}.md"
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, output)
    return {
        "id": lane["id"],
        "ok": bool(result.get("ok")),
        "run_dir": result.get("run_dir"),
        "output_path": str(output) if output else None,
        "session_locator": session_locator,
    }


def _merger_transport(
    config: dict[str, Any],
    successful: list[dict[str, Any]],
    parent_id: str,
) -> Path:
    source = config["merger_mission_path"].read_text(encoding="utf-8")
    paths = "\n".join(f"- {item['output_path']}" for item in successful)
    target = config["output_dir"] / "merger" / "mission.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    receipt_line = (
        "\n[NEXT_STAGE_RECEIPT_BINDING]\n"
        f"workflow_id={config['next_stage_binding'].get('workflow_id', '')}\n"
        f"stage={config['next_stage_binding'].get('stage', '')}\n"
        f"attempt_id={parent_id}\n"
        f"input_mission_sha256={config['manifest_sha256']}\n"
        f"Write the bound next-stage receipt to: {config['next_stage_result_path']}\n"
        if config.get("next_stage_result_path")
        else ""
    )
    target.write_text(f"{source.rstrip()}\n\n[INPUT_HANDOFFS]\n{paths}\n{receipt_line}", encoding="utf-8")
    return target


def reconcile_recovered_lanes(manifest_path: Path) -> dict[str, Any]:
    """Rebind durable exact-run outputs to an interrupted parent without submitting.

    This is intentionally a host-only recovery step.  It validates every
    original lane against the persisted parent/lane/mission identity, restores
    stable-order handoffs, and prepares the merger mission.  It never calls the
    Oracle runner and therefore cannot create a replacement conversation.
    """
    config = load_manifest(manifest_path)
    result_path = config["output_dir"] / "result.json"
    result = _read_json(result_path)
    if result.get("schema") != RESULT_SCHEMA:
        raise MultiError("existing multi result schema is invalid")
    parent_id = str(result.get("parent_id") or "").strip()
    if len(parent_id) != 64:
        raise MultiError("existing multi result has no valid parent identity")
    recorded = result.get("lanes")
    if not isinstance(recorded, list):
        raise MultiError("existing multi result has no lane ledger")
    by_id = {str(item.get("id") or ""): item for item in recorded if isinstance(item, dict)}
    expected_ids = [lane["id"] for lane in config["solvers"]]
    if set(by_id) != set(expected_ids) or len(by_id) != len(expected_ids):
        raise MultiError("existing lane ledger does not match the manifest")
    reconciled: list[dict[str, Any]] = []
    for lane in config["solvers"]:
        prior = by_id[lane["id"]]
        run_dir = Path(str(prior.get("run_dir") or "")).expanduser()
        if not run_dir.is_absolute():
            raise MultiError(f"lane {lane['id']} has no absolute exact run directory")
        run_dir = run_dir.resolve()
        if not STATE.is_within(STATE.oracle_state_root(), run_dir):
            raise MultiError(f"lane {lane['id']} exact run directory is outside Oracle host state")
        state_path = run_dir / "state.json"
        output_path = run_dir / "output.md"
        if not state_path.is_file() or not output_path.is_file() or not output_path.read_bytes().strip():
            raise MultiError(f"lane {lane['id']} has no durable recovered output")
        state = _read_json(state_path)
        mission = state.get("mission") if isinstance(state.get("mission"), dict) else {}
        oracle = state.get("oracle") if isinstance(state.get("oracle"), dict) else {}
        if state.get("run_id") not in {None, run_dir.name}:
            raise MultiError(f"lane {lane['id']} run identity mismatch")
        if Path(str(state.get("project_root") or "")).resolve() != config["project_root"]:
            raise MultiError(f"lane {lane['id']} project identity mismatch")
        if state.get("parallel_parent_id") != parent_id:
            raise MultiError(f"lane {lane['id']} parent identity mismatch")
        expected_mission_sha = hashlib.sha256(lane["mission_path"].read_bytes()).hexdigest()
        if mission.get("sha256") != expected_mission_sha:
            raise MultiError(f"lane {lane['id']} mission identity mismatch")
        if state.get("status") != "complete" or state.get("terminal_harvested") is not True:
            raise MultiError(f"lane {lane['id']} is not terminally harvested")
        artifact_sha = hashlib.sha256(output_path.read_bytes()).hexdigest()
        if state.get("artifact_sha256") != artifact_sha:
            raise MultiError(f"lane {lane['id']} durable output hash mismatch")
        prior_locator = str(prior.get("session_locator") or "").strip()
        exact_locator = str(oracle.get("session_locator") or oracle.get("slug") or "").strip()
        if prior_locator and prior_locator != exact_locator:
            raise MultiError(f"lane {lane['id']} exact session identity mismatch")
        handoff = config["output_dir"] / "handoffs" / f"{lane['id']}.md"
        handoff.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(output_path, handoff)
        reconciled.append({
            "id": lane["id"],
            "ok": True,
            "run_dir": str(run_dir),
            "output_path": str(handoff),
            "session_locator": exact_locator,
            "artifact_sha256": artifact_sha,
        })
    merger_mission = _merger_transport(config, reconciled, parent_id)
    updated = {
        **result,
        "status": "merger_ready",
        "lanes": reconciled,
        "successful_lane_count": len(reconciled),
        "merger_mission_path": str(merger_mission),
        "recovery_mode": "exact-runs-no-submit",
    }
    _write_json(result_path, updated)
    return {"ok": True, **updated}


def resume_recovered_merger(
    manifest_path: Path,
    *,
    execute: Callable[..., dict[str, Any]] = RUNNER.execute_run,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Submit only the prepared merger after exact child recovery."""
    config = load_manifest(manifest_path)
    result_path = config["output_dir"] / "result.json"
    result = _read_json(result_path)
    if result.get("schema") != RESULT_SCHEMA or result.get("status") != "merger_ready":
        raise MultiError("multi result is not ready for merger-only resume")
    parent_id = str(result.get("parent_id") or "").strip()
    lanes = result.get("lanes")
    if len(parent_id) != 64 or not isinstance(lanes, list) or len(lanes) != len(config["solvers"]):
        raise MultiError("merger-ready result identity is incomplete")
    expected_ids = [lane["id"] for lane in config["solvers"]]
    if [str(lane.get("id") or "") for lane in lanes if isinstance(lane, dict)] != expected_ids:
        raise MultiError("merger-ready lane order does not match the manifest")
    merger_mission = Path(str(result.get("merger_mission_path") or "")).resolve(strict=True)
    expected_merger = (config["output_dir"] / "merger" / "mission.md").resolve(strict=True)
    if merger_mission != expected_merger:
        raise MultiError("merger mission identity mismatch")
    merger_text = merger_mission.read_text(encoding="utf-8")
    last_position = -1
    for lane in lanes:
        output_path = _inside(config["project_root"], lane.get("output_path"))
        artifact_sha = hashlib.sha256(output_path.read_bytes()).hexdigest()
        if lane.get("artifact_sha256") != artifact_sha:
            raise MultiError(f"lane {lane.get('id')} handoff hash mismatch")
        position = merger_text.find(str(output_path), last_position + 1)
        if position < 0:
            raise MultiError(f"lane {lane.get('id')} is absent or out of order in the merger mission")
        last_position = position
    merger_manifest = _child_manifest(
        config,
        {"id": "merger", "mission_path": merger_mission},
        parent_id,
    )
    merger = execute(merger_manifest, dry_run=dry_run)
    previous = [str(item) for item in result.get("prior_merger_run_dirs") or [] if str(item)]
    if result.get("merger_run_dir"):
        previous.append(str(result["merger_run_dir"]))
    updated = {
        **result,
        "status": "complete" if merger.get("ok") else "merger_attention_required",
        "merger_run_dir": merger.get("run_dir"),
        "prior_merger_run_dirs": list(dict.fromkeys(previous)),
    }
    _write_json(result_path, updated)
    return {"ok": bool(merger.get("ok")), **updated}


def run_multi(
    manifest_path: Path,
    *,
    dry_run: bool = False,
    execute: Callable[..., dict[str, Any]] = RUNNER.execute_run,
    parent_lock_held: bool = False,
) -> dict[str, Any]:
    config = load_manifest(manifest_path)
    parent_id = hashlib.sha256(f"{config['project_root']}:{uuid.uuid4().hex}".encode()).hexdigest()
    config["output_dir"].mkdir(parents=True, exist_ok=True)
    lanes: list[dict[str, Any]] = []
    # The parent owns normal same-project exclusion. Children use the separate
    # parent-scoped launch mutex and may wait concurrently after submission.
    lock = nullcontext() if parent_lock_held else STATE.project_submit_mutex(config["project_root"], timeout_seconds=30)
    with lock:
        for start in range(0, len(config["solvers"]), config["max_concurrency"]):
            wave = config["solvers"][start : start + config["max_concurrency"]]
            with ThreadPoolExecutor(max_workers=len(wave), thread_name_prefix="oracle-multi") as pool:
                futures = [pool.submit(_run_lane, config, lane, parent_id, execute, dry_run) for lane in wave]
                lanes.extend(future.result() for future in as_completed(futures))
        order = {item["id"]: index for index, item in enumerate(config["solvers"])}
        lanes.sort(key=lambda item: order[item["id"]])
        successful = [item for item in lanes if item["ok"] and (dry_run or item["output_path"])]
        if not successful:
            result = {"schema": RESULT_SCHEMA, "status": "failed", "parent_id": parent_id, "lanes": lanes}
            _write_json(config["output_dir"] / "result.json", result)
            return {"ok": False, **result}
        merger_mission = _merger_transport(config, successful, parent_id) if not dry_run else config["merger_mission_path"]
        merger_manifest = _child_manifest(
            config,
            {"id": "merger", "mission_path": merger_mission},
            parent_id,
        )
        merger = execute(merger_manifest, dry_run=dry_run)
    status = "complete" if merger.get("ok") and len(successful) == len(lanes) else (
        "partial" if merger.get("ok") else "failed"
    )
    result = {
        "schema": RESULT_SCHEMA,
        "status": status,
        "parent_id": parent_id,
        "lanes": lanes,
        "merger_run_dir": merger.get("run_dir"),
        "successful_lane_count": len(successful),
        "next_stage_result_path": (
            str(config["next_stage_result_path"])
            if config.get("next_stage_result_path") and config["next_stage_result_path"].is_file()
            else None
        ),
    }
    _write_json(config["output_dir"] / "result.json", result)
    return {"ok": status in {"complete", "partial"}, **result}


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run independent Oracle browser sessions in waves and merge handoffs.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--reconcile-recovered", action="store_true")
    parser.add_argument("--resume-merger", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.reconcile_recovered and args.resume_merger:
            raise MultiError("choose exactly one recovery action")
        if args.reconcile_recovered:
            if args.dry_run:
                raise MultiError("--reconcile-recovered cannot be combined with --dry-run")
            result = reconcile_recovered_lanes(args.manifest)
        elif args.resume_merger:
            result = resume_recovered_merger(args.manifest, dry_run=args.dry_run)
        else:
            result = run_multi(args.manifest, dry_run=args.dry_run)
    except Exception as exc:
        result = {"ok": False, "error": {"code": "ORACLE_MULTI_FAILED", "message": str(exc)}}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
