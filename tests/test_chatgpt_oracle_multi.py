from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


PATH = Path(__file__).resolve().parents[1] / "bin" / "chatgpt_oracle_multi.py"


def load():
    spec = importlib.util.spec_from_file_location("oracle_multi_test", PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def make_manifest(tmp_path: Path, count: int = 7) -> Path:
    missions = []
    for index in range(count):
        path = tmp_path / f"solver-{index}.md"
        path.write_text(f"solve {index}", encoding="utf-8")
        missions.append({"id": f"s{index}", "mission_path": str(path.resolve())})
    merger = tmp_path / "merge.md"
    merger.write_text("Merge every listed handoff.", encoding="utf-8")
    manifest = tmp_path / "multi.json"
    manifest.write_text(json.dumps({
        "schema": "codex.chatgpt.oracle-multi/v1",
        "project_root": str(tmp_path.resolve()),
        "output_dir": str((tmp_path / "out").resolve()),
        "app_name": "DevSpace",
        "model": "gpt-5.6",
        "max_concurrency": 5,
        "solvers": missions,
        "merger_mission_path": str(merger.resolve()),
    }), encoding="utf-8")
    return manifest


def test_manifest_accepts_configured_workspace_app_name(tmp_path: Path) -> None:
    module = load()
    path = make_manifest(tmp_path, 2)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["app_name"] = "OtherWorkspace"
    path.write_text(json.dumps(payload), encoding="utf-8")

    assert module.load_manifest(path)["app_name"] == "OtherWorkspace"


def test_multi_uses_unique_child_manifests_waves_and_merger(tmp_path: Path) -> None:
    module = load()
    calls = []

    def fake_execute(path: Path, *, dry_run: bool):
        value = json.loads(path.read_text(encoding="utf-8"))
        calls.append(value)
        run_dir = path.parent / "fake-run"
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "output.md").write_text(f"answer {path.parent.name}", encoding="utf-8")
        return {"ok": True, "run_dir": str(run_dir)}

    result = module.run_multi(make_manifest(tmp_path), execute=fake_execute)
    assert result["ok"] is True
    assert result["status"] == "complete"
    assert len(result["lanes"]) == 7
    assert len(calls) == 8
    assert len({item["parallel_parent_id"] for item in calls}) == 1
    assert all(item["app_name"] == "DevSpace" for item in calls)
    assert all(item["model"] == "gpt-5.6" for item in calls)
    assert all(item["model_strategy"] == "select" for item in calls)
    assert all(item["thinking_time"] == "extra-high" for item in calls)
    assert all(item["copy_profile"] for item in calls)
    merger_text = Path(calls[-1]["mission_path"]).read_text(encoding="utf-8")
    assert merger_text.count(".md") == 7


def test_multi_preserves_partial_results_and_rejects_over_capacity(tmp_path: Path) -> None:
    module = load()
    manifest = make_manifest(tmp_path, 3)
    def fake_execute(path: Path, *, dry_run: bool):
        run_dir = path.parent / "fake-run"
        run_dir.mkdir(parents=True, exist_ok=True)
        if path.parent.name == "s1":
            return {"ok": False, "run_dir": str(run_dir)}
        (run_dir / "output.md").write_text("ok", encoding="utf-8")
        return {"ok": True, "run_dir": str(run_dir)}

    result = module.run_multi(manifest, execute=fake_execute)
    assert result["status"] == "partial"
    value = json.loads(manifest.read_text(encoding="utf-8"))
    value["max_concurrency"] = 6
    manifest.write_text(json.dumps(value), encoding="utf-8")
    try:
        module.load_manifest(manifest)
    except module.MultiError:
        pass
    else:
        raise AssertionError("capacity > 5 must fail")


def test_multi_rejects_lane_path_traversal(tmp_path: Path) -> None:
    module = load()
    manifest = make_manifest(tmp_path, 2)
    value = json.loads(manifest.read_text(encoding="utf-8"))
    value["solvers"][0]["id"] = "../../outside"
    manifest.write_text(json.dumps(value), encoding="utf-8")
    try:
        module.load_manifest(manifest)
    except module.MultiError:
        pass
    else:
        raise AssertionError("unsafe lane id must fail")


def test_reconcile_recovered_lanes_restores_stable_order_without_submission(tmp_path: Path, monkeypatch) -> None:
    module = load()
    monkeypatch.setenv("CODEX_ORACLE_STATE_ROOT", str((tmp_path / "state").resolve()))
    manifest = make_manifest(tmp_path, 3)
    config = module.load_manifest(manifest)
    parent_id = "a" * 64
    recorded = []
    for lane in reversed(config["solvers"]):
        run_dir = tmp_path / "state" / lane["id"]
        run_dir.mkdir(parents=True)
        output = run_dir / "output.md"
        output.write_text(f"answer {lane['id']}", encoding="utf-8")
        artifact_sha = module.hashlib.sha256(output.read_bytes()).hexdigest()
        locator = f"oracle-{lane['id']}"
        (run_dir / "state.json").write_text(json.dumps({
            "project_root": str(tmp_path.resolve()),
            "parallel_parent_id": parent_id,
            "status": "complete",
            "terminal_harvested": True,
            "artifact_sha256": artifact_sha,
            "mission": {"sha256": module.hashlib.sha256(lane["mission_path"].read_bytes()).hexdigest()},
            "oracle": {"session_locator": locator},
        }), encoding="utf-8")
        recorded.append({"id": lane["id"], "ok": False, "run_dir": str(run_dir), "session_locator": locator})
    module._write_json(config["output_dir"] / "result.json", {
        "schema": module.RESULT_SCHEMA,
        "status": "failed",
        "parent_id": parent_id,
        "lanes": recorded,
        "merger_run_dir": str(tmp_path / "failed-pre-submit-merger"),
    })

    result = module.reconcile_recovered_lanes(manifest)

    assert result["status"] == "merger_ready"
    assert [lane["id"] for lane in result["lanes"]] == ["s0", "s1", "s2"]
    assert result["successful_lane_count"] == 3
    merger_text = Path(result["merger_mission_path"]).read_text(encoding="utf-8")
    positions = [
        merger_text.index(str(config["output_dir"] / "handoffs" / f"s{index}.md"))
        for index in range(3)
    ]
    assert positions == sorted(positions)
    assert result["merger_run_dir"].endswith("failed-pre-submit-merger")


def test_reconcile_recovered_lanes_rejects_parent_identity_mismatch(tmp_path: Path, monkeypatch) -> None:
    module = load()
    monkeypatch.setenv("CODEX_ORACLE_STATE_ROOT", str(tmp_path.resolve()))
    manifest = make_manifest(tmp_path, 2)
    config = module.load_manifest(manifest)
    module._write_json(config["output_dir"] / "result.json", {
        "schema": module.RESULT_SCHEMA,
        "status": "failed",
        "parent_id": "a" * 64,
        "lanes": [
            {"id": lane["id"], "run_dir": str(tmp_path / lane["id"]), "session_locator": f"oracle-{lane['id']}"}
            for lane in config["solvers"]
        ],
    })
    first = config["solvers"][0]
    run_dir = tmp_path / first["id"]
    run_dir.mkdir()
    output = run_dir / "output.md"
    output.write_text("answer", encoding="utf-8")
    (run_dir / "state.json").write_text(json.dumps({
        "project_root": str(tmp_path.resolve()),
        "parallel_parent_id": "b" * 64,
        "status": "complete",
        "terminal_harvested": True,
        "artifact_sha256": module.hashlib.sha256(output.read_bytes()).hexdigest(),
        "mission": {"sha256": module.hashlib.sha256(first["mission_path"].read_bytes()).hexdigest()},
        "oracle": {"session_locator": f"oracle-{first['id']}"},
    }), encoding="utf-8")

    with pytest.raises(module.MultiError, match="parent identity mismatch"):
        module.reconcile_recovered_lanes(manifest)


def test_resume_recovered_merger_submits_only_stable_order_merger(tmp_path: Path, monkeypatch) -> None:
    module = load()
    monkeypatch.setenv("CODEX_ORACLE_STATE_ROOT", str((tmp_path / "state").resolve()))
    manifest = make_manifest(tmp_path, 2)
    config = module.load_manifest(manifest)
    parent_id = "c" * 64
    recorded = []
    for lane in config["solvers"]:
        run_dir = tmp_path / "state" / lane["id"]
        run_dir.mkdir(parents=True)
        output = run_dir / "output.md"
        output.write_text(f"answer {lane['id']}", encoding="utf-8")
        artifact_sha = module.hashlib.sha256(output.read_bytes()).hexdigest()
        locator = f"oracle-{lane['id']}"
        (run_dir / "state.json").write_text(json.dumps({
            "project_root": str(tmp_path.resolve()),
            "parallel_parent_id": parent_id,
            "status": "complete",
            "terminal_harvested": True,
            "artifact_sha256": artifact_sha,
            "mission": {"sha256": module.hashlib.sha256(lane["mission_path"].read_bytes()).hexdigest()},
            "oracle": {"session_locator": locator},
        }), encoding="utf-8")
        recorded.append({"id": lane["id"], "run_dir": str(run_dir), "session_locator": locator})
    module._write_json(config["output_dir"] / "result.json", {
        "schema": module.RESULT_SCHEMA,
        "status": "failed",
        "parent_id": parent_id,
        "lanes": recorded,
        "merger_run_dir": str(tmp_path / "old-pre-submit-merger"),
    })
    module.reconcile_recovered_lanes(manifest)
    calls = []

    def fake_execute(path: Path, *, dry_run: bool):
        calls.append(json.loads(path.read_text(encoding="utf-8")))
        return {"ok": True, "run_dir": str(tmp_path / "new-merger-run")}

    result = module.resume_recovered_merger(manifest, execute=fake_execute)

    assert result["status"] == "complete"
    assert len(calls) == 1
    assert calls[0]["parallel_parent_id"] == parent_id
    assert Path(calls[0]["mission_path"]).name == "mission.md"
    assert result["merger_run_dir"].endswith("new-merger-run")
    assert result["prior_merger_run_dirs"] == [str(tmp_path / "old-pre-submit-merger")]
