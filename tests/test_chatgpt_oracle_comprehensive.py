from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


PATH = Path(__file__).resolve().parents[1] / "bin" / "chatgpt_oracle_comprehensive.py"


def load():
    spec = importlib.util.spec_from_file_location("oracle_comprehensive_test", PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def manifest(tmp_path: Path) -> Path:
    os.environ["CODEX_ORACLE_STATE_ROOT"] = str((tmp_path.parent / f"{tmp_path.name}-host-state").resolve())
    mission = tmp_path / "initial.md"
    mission.write_text("Plan the work broadly.", encoding="utf-8")
    path = tmp_path / "workflow.json"
    path.write_text(json.dumps({
        "schema": "codex.chatgpt.oracle-comprehensive/v1",
        "workflow_id": "a" * 32,
        "project_root": str(tmp_path.resolve()),
        "workflow_dir": str((tmp_path / "workflow").resolve()),
        "initial_mission_path": str(mission.resolve()),
        "app_name": "DevSpace",
        "model": "gpt-5.6",
        "local_gate_command": ["python", "-c", "raise SystemExit(0)"],
    }), encoding="utf-8")
    return path


def ultra_economy_manifest(tmp_path: Path) -> Path:
    path = manifest(tmp_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload.update({
        "workflow_profile": "ultra-economy",
        "initial_stage": "pro",
    })
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_ultra_economy_manifest_rejects_handshake_self_declaration(tmp_path: Path) -> None:
    module = load()
    path = ultra_economy_manifest(tmp_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["local_runtime_contract"] = {
        "model": "gpt-5.6-luna",
        "reasoning_effort": "max",
        "source": "current-task-runtime",
    }
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(module.WorkflowError, match="one-time conversational handshake"):
        module.load_manifest(path)

def test_ultra_economy_dry_run_starts_with_explicit_pro_design(tmp_path: Path, monkeypatch) -> None:
    module = load()
    seen: dict[str, object] = {}

    def preview(oracle_manifest: Path, *, dry_run: bool):
        seen.update(json.loads(oracle_manifest.read_text(encoding="utf-8")))
        mission = Path(str(seen["mission_path"])).read_text(encoding="utf-8")
        assert "stage=pro\n" in mission
        assert "[ULTRA_ECONOMY_DESIGN_CONTRACT]" in mission
        return {"ok": True}

    result = module.run_workflow(
        ultra_economy_manifest(tmp_path), dry_run=True, oracle_execute=preview
    )

    assert result["ok"] is True
    assert result["stage"] == "pro"
    assert result["workflow_profile"] == "ultra-economy"
    assert seen["model"] == "gpt-5.6-sol"
    assert seen["thinking_time"] == "heavy"
    assert seen["transport"] == "pro-devspace"


def test_standard_workflow_cannot_skip_plan_with_initial_pro(tmp_path: Path) -> None:
    module = load()
    path = manifest(tmp_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["initial_stage"] = "pro"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(module.WorkflowError, match="standard workflow initial_stage must be plan"):
        module.load_manifest(path)


def test_manifest_accepts_configured_workspace_app_before_workflow_creation(tmp_path: Path) -> None:
    module = load()
    path = manifest(tmp_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["app_name"] = "OtherWorkspace"
    path.write_text(json.dumps(payload), encoding="utf-8")

    assert module.load_manifest(path)["app_name"] == "OtherWorkspace"


def test_web_authored_relay_reaches_complete_without_host_semantic_rewrite(tmp_path: Path) -> None:
    module = load()
    order = ["plan", "review", "implementation", "final-web-gate"]
    seen = []

    def fake_execute(path: Path, *, dry_run: bool):
        config = json.loads(path.read_text(encoding="utf-8"))
        assert config["model_strategy"] == "select"
        assert config["thinking_time"] == "extra-high"
        mission = Path(config["mission_path"])
        text = mission.read_text(encoding="utf-8")
        stage = next(item for item in order if f"stage={item}\n" in text)
        attempt_id = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("attempt_id="))
        input_sha = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("input_mission_sha256="))
        seen.append(stage)
        stage_dir = mission.parent
        output = stage_dir / "web-output.md"
        output.write_text(f"{stage} output", encoding="utf-8")
        next_stage = order[order.index(stage) + 1] if stage != order[-1] else "complete"
        next_mission = tmp_path / f"next-{stage}.md"
        next_mission.write_text(f"web-authored mission after {stage}", encoding="utf-8")
        receipt = {
            "schema": "codex.chatgpt.oracle-stage-result/v1",
            "workflow_id": "a" * 32,
            "stage": stage,
            "attempt_id": attempt_id,
            "input_mission_sha256": input_sha,
            "status": "PASS",
            "output_path": str(output),
            "output_sha256": module.sha(output),
            "next_stage": next_stage,
            "next_mission_path": str(next_mission),
            "next_mission_sha256": module.sha(next_mission),
            "ready_for_next": True,
            "blocker": "",
        }
        (stage_dir / "stage-result.json").write_text(json.dumps(receipt), encoding="utf-8")
        run_dir = stage_dir / "run"
        run_dir.mkdir()
        return {"ok": True, "run_dir": str(run_dir)}

    result = module.run_workflow(
        manifest(tmp_path),
        oracle_execute=fake_execute,
        local_gate_runner=lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, "gate ok", ""),
    )
    assert result["ok"] is True
    assert seen == order
    assert result["status"] == "complete"


def test_explicit_pro_stage_runs_writable_devspace_and_materializes_bound_receipt(tmp_path: Path) -> None:
    module = load()
    stages = []
    workflow_manifest = manifest(tmp_path)
    workflow_payload = json.loads(workflow_manifest.read_text(encoding="utf-8"))
    workflow_payload["allow_pro"] = True
    workflow_manifest.write_text(json.dumps(workflow_payload), encoding="utf-8")

    def regular_receipt(mission: Path, stage: str, next_stage: str, next_mission: Path) -> None:
        text = mission.read_text(encoding="utf-8")
        attempt = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("attempt_id="))
        input_sha = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("input_mission_sha256="))
        output = mission.parent / "regular-output.md"
        output.write_text(stage, encoding="utf-8")
        (mission.parent / "stage-result.json").write_text(json.dumps({
            "schema": module.RECEIPT_SCHEMA, "workflow_id": "a" * 32, "stage": stage,
            "attempt_id": attempt, "input_mission_sha256": input_sha, "status": "PASS",
            "output_path": str(output), "output_sha256": module.sha(output),
            "next_stage": next_stage, "next_mission_path": str(next_mission),
            "next_mission_sha256": module.sha(next_mission), "ready_for_next": True, "blocker": "",
        }), encoding="utf-8")

    def fake_execute(path: Path, *, dry_run: bool):
        payload = json.loads(path.read_text(encoding="utf-8"))
        mission = Path(payload["mission_path"])
        text = mission.read_text(encoding="utf-8")
        stage = next(item for item in ("plan", "pro", "review", "implementation", "final-web-gate") if f"stage={item}\n" in text)
        stages.append(stage)
        if stage == "pro":
            assert payload["transport"] == "pro-devspace"
            assert payload["task_outcome_contract"] == "v1"
            assert payload["model"] == "gpt-5.6-sol"
            assert payload["app_name"] == "DevSpace"
            assert "attachments" not in payload
            attempt = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("attempt_id="))
            input_sha = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("input_mission_sha256="))
            oracle_output = mission.parent / "oracle-output.json"
            oracle_output.write_text(json.dumps({
                "schema": module.PRO_OUTPUT_SCHEMA, "workflow_id": "a" * 32, "stage": "pro",
                "attempt_id": attempt, "input_mission_sha256": input_sha, "status": "PASS",
                "output_text": "Pro decision\nsecond line\n", "next_stage": "review",
                "next_mission_text": "Review the Pro decision independently.\nPreserve LF.\n",
                "ready_for_next": True, "blocker": "",
            }), encoding="utf-8")
            return {"ok": True, "run_dir": str(mission.parent / "run"), "output_path": str(oracle_output)}
        next_stage = {
            "plan": "pro", "review": "implementation",
            "implementation": "final-web-gate", "final-web-gate": "complete",
        }[stage]
        next_mission = tmp_path / f"next-{stage}.md"
        next_mission.write_text(f"mission after {stage}", encoding="utf-8")
        regular_receipt(mission, stage, next_stage, next_mission)
        return {"ok": True, "run_dir": str(mission.parent / "run")}

    result = module.run_workflow(
        workflow_manifest,
        oracle_execute=fake_execute,
        local_gate_runner=lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, "", ""),
    )
    assert result["ok"] is True, result
    assert stages == ["plan", "pro", "review", "implementation", "final-web-gate"]
    pro_stage = next((tmp_path / "workflow" / "stages").glob("01-pro-*"))
    assert (pro_stage / "output.md").read_bytes() == b"Pro decision\nsecond line\n"
    assert (pro_stage / "next-mission.md").read_bytes() == b"Review the Pro decision independently.\nPreserve LF.\n"
    receipt = json.loads((pro_stage / "stage-result.json").read_text(encoding="utf-8"))
    assert receipt["stage"] == "pro"
    assert receipt["next_stage"] == "review"


def test_standard_workflow_blocks_plan_selected_pro_without_explicit_opt_in(tmp_path: Path) -> None:
    module = load()
    calls: list[str] = []

    def fake_execute(path: Path, *, dry_run: bool):
        payload = json.loads(path.read_text(encoding="utf-8"))
        mission = Path(payload["mission_path"])
        text = mission.read_text(encoding="utf-8")
        calls.append("plan")
        assert "pro_selection_allowed=false" in text
        output = mission.parent / "plan-output.md"
        next_mission = tmp_path / "unauthorized-pro.md"
        output.write_text("plan", encoding="utf-8")
        next_mission.write_text("pro request", encoding="utf-8")
        attempt = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("attempt_id="))
        input_sha = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("input_mission_sha256="))
        (mission.parent / "stage-result.json").write_text(json.dumps({
            "schema": module.RECEIPT_SCHEMA,
            "workflow_id": "a" * 32,
            "stage": "plan",
            "attempt_id": attempt,
            "input_mission_sha256": input_sha,
            "status": "PLAN_READY",
            "output_path": str(output),
            "output_sha256": module.sha(output),
            "next_stage": "pro",
            "next_mission_path": str(next_mission),
            "next_mission_sha256": module.sha(next_mission),
            "ready_for_next": True,
            "blocker": "",
        }), encoding="utf-8")
        return {"ok": True, "run_dir": str(mission.parent / "run")}

    with pytest.raises(module.WorkflowError, match="PRO_EXPLICIT_OPT_IN_REQUIRED"):
        module.run_workflow(manifest(tmp_path), oracle_execute=fake_execute)
    assert calls == ["plan"]


def test_pro_exact_recovery_materializes_output_without_resubmission(tmp_path: Path) -> None:
    module = load()
    workflow_path = manifest(tmp_path)
    config = module.load_manifest(workflow_path)
    config["_parallel_parent_id"] = "b" * 64
    attempt = "c" * 32
    source = tmp_path / "pro-source.md"
    source.write_text("Pro review request", encoding="utf-8")
    mission, receipt, input_sha = module._pro_stage_mission(config, "a" * 32, 1, source, attempt)
    oracle_manifest = module._oracle_manifest(config, mission, mission.parent, attempt, stage="pro")
    run_dir = _oracle_running_state(module, oracle_manifest)
    state_path = module._state_path(config, "a" * 32)
    module._write(state_path, {
        "schema": module.STATE_SCHEMA, "status": "attention_required", "workflow_id": "a" * 32,
        "manifest_sha256": config["manifest_sha256"], "current_stage": "pro",
        "current_attempt_id": attempt, "current_input_sha256": input_sha,
        "current_mission_path": str(source), "receipt_path": str(receipt),
        "oracle_run_id": attempt, "oracle_run_dir": str(run_dir),
        "oracle_manifest_path": str(oracle_manifest), "next_index": 1, "records": [],
    })
    oracle_output = run_dir / "recovered-output.json"
    oracle_output.write_text(json.dumps({
        "schema": module.PRO_OUTPUT_SCHEMA, "workflow_id": "a" * 32, "stage": "pro",
        "attempt_id": attempt, "input_mission_sha256": input_sha, "status": "PASS",
        "output_text": "Recovered Pro result", "next_stage": "review",
        "next_mission_text": "Review recovered Pro result.",
        "ready_for_next": True, "blocker": "",
    }), encoding="utf-8")
    submissions = 0

    def no_pro_resubmit(path: Path, *, dry_run: bool):
        nonlocal submissions
        submissions += 1
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["transport"] == "devspace"
        return {"ok": False, "run_dir": str(_oracle_running_state(module, path))}

    def fake_recover(exact_run_dir: Path, *, action: str, dry_run: bool):
        assert exact_run_dir == run_dir
        assert action == "live"
        return {"ok": True, "status": "complete", "run_dir": str(run_dir), "output_path": str(oracle_output)}

    result = module.run_workflow(
        workflow_path, oracle_execute=no_pro_resubmit, oracle_recover=fake_recover
    )
    assert result["status"] == "attention_required"
    assert result["current_stage"] == "review"
    assert submissions == 1
    assert receipt.is_file()
    assert (receipt.parent / "output.md").read_text(encoding="utf-8") == "Recovered Pro result"


@pytest.mark.parametrize("mutation", ["duplicate", "additional"])
def test_pro_output_rejects_duplicate_or_additional_keys(tmp_path: Path, mutation: str) -> None:
    module = load()
    workflow_path = manifest(tmp_path)
    config = module.load_manifest(workflow_path)
    config["_parallel_parent_id"] = "b" * 64
    attempt = "d" * 32
    source = tmp_path / "pro-source.md"
    source.write_text("Pro request", encoding="utf-8")
    mission, receipt, input_sha = module._pro_stage_mission(config, "a" * 32, 1, source, attempt)
    output = tmp_path / "pro-output.json"
    base = {
        "schema": module.PRO_OUTPUT_SCHEMA, "workflow_id": "a" * 32, "stage": "pro",
        "attempt_id": attempt, "input_mission_sha256": input_sha, "status": "PASS",
        "output_text": "result", "next_stage": "review", "next_mission_text": "review",
        "ready_for_next": True, "blocker": "",
    }
    if mutation == "additional":
        base["unexpected"] = "forbidden"
        output.write_text(json.dumps(base), encoding="utf-8")
    else:
        valid = json.dumps(base)
        output.write_text(valid[:-1] + ',"status":"PASS"}', encoding="utf-8")
    with pytest.raises(module.WorkflowError, match="duplicate key|closed key set"):
        module._materialize_pro_receipt(
            config, receipt, "a" * 32, attempt, input_sha,
            {"output_path": str(output)},
        )
    assert not receipt.exists()


def test_missing_receipt_fails_closed_without_duplicate_stage(tmp_path: Path) -> None:
    module = load()
    calls = 0

    def fake_execute(path: Path, *, dry_run: bool):
        nonlocal calls
        calls += 1
        return {"ok": True, "run_dir": str(tmp_path / "run")}

    result = module.run_workflow(manifest(tmp_path), oracle_execute=fake_execute)
    assert result["ok"] is False
    assert result["status"] == "awaiting_receipt"
    assert calls == 1


def test_failing_receipt_cannot_complete(tmp_path: Path) -> None:
    module = load()

    def fake_execute(path: Path, *, dry_run: bool):
        config = json.loads(path.read_text(encoding="utf-8"))
        mission = Path(config["mission_path"])
        text = mission.read_text(encoding="utf-8")
        attempt_id = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("attempt_id="))
        input_sha = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("input_mission_sha256="))
        output = mission.parent / "output.md"
        output.write_text("bad", encoding="utf-8")
        (mission.parent / "stage-result.json").write_text(json.dumps({
            "schema": "codex.chatgpt.oracle-stage-result/v1",
            "workflow_id": "a" * 32,
            "stage": "plan",
            "attempt_id": attempt_id,
            "input_mission_sha256": input_sha,
            "status": "FAIL",
            "output_path": str(output),
            "output_sha256": module.sha(output),
            "next_stage": "review",
            "next_mission_path": str(tmp_path / "none.md"),
            "next_mission_sha256": "0" * 64,
            "ready_for_next": False,
            "blocker": "not ready",
        }), encoding="utf-8")
        return {"ok": True, "run_dir": str(mission.parent / "run")}

    try:
        module.run_workflow(manifest(tmp_path), oracle_execute=fake_execute)
    except module.WorkflowError as exc:
        assert "did not pass" in str(exc)
    else:
        raise AssertionError("FAIL receipt must not advance")


def test_web_multi_branch_is_bound_and_resumes_at_review(tmp_path: Path) -> None:
    module = load()
    workflow_path = manifest(tmp_path)
    lane_one = tmp_path / "lane-one.md"
    lane_two = tmp_path / "lane-two.md"
    merger = tmp_path / "merger.md"
    for path, body in ((lane_one, "one"), (lane_two, "two"), (merger, "merge")):
        path.write_text(body, encoding="utf-8")
    multi_manifest = tmp_path / "multi.json"
    multi_manifest.write_text(json.dumps({
        "schema": module.MULTI.SCHEMA,
        "project_root": str(tmp_path),
        "output_dir": str(tmp_path / "multi-output"),
        "solvers": [
            {"id": "one", "mission_path": str(lane_one)},
            {"id": "two", "mission_path": str(lane_two)},
        ],
        "merger_mission_path": str(merger),
        "next_stage_result_path": str(tmp_path / "multi-next-receipt.json"),
        "next_stage_binding": {"workflow_id": "a" * 32, "stage": "web-multi"},
    }), encoding="utf-8")
    review_mission = tmp_path / "review-after-multi.md"
    review_mission.write_text("review merged advice", encoding="utf-8")
    stages_seen = []

    def write_receipt(mission: Path, stage: str, next_stage: str, next_path: Path) -> None:
        text = mission.read_text(encoding="utf-8")
        attempt = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("attempt_id="))
        input_sha = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("input_mission_sha256="))
        output = mission.parent / "output.md"
        output.write_text(stage, encoding="utf-8")
        (mission.parent / "stage-result.json").write_text(json.dumps({
            "schema": "codex.chatgpt.oracle-stage-result/v1",
            "workflow_id": "a" * 32,
            "stage": stage,
            "attempt_id": attempt,
            "input_mission_sha256": input_sha,
            "status": "PASS",
            "output_path": str(output),
            "output_sha256": module.sha(output),
            "next_stage": next_stage,
            "next_mission_path": str(next_path),
            "next_mission_sha256": module.sha(next_path),
            "ready_for_next": True,
            "blocker": "",
        }), encoding="utf-8")

    def fake_oracle(path: Path, *, dry_run: bool):
        value = json.loads(path.read_text(encoding="utf-8"))
        mission = Path(value["mission_path"])
        stage = next(item for item in ("plan", "review", "implementation", "final-web-gate") if f"stage={item}\n" in mission.read_text(encoding="utf-8"))
        stages_seen.append(stage)
        if stage == "plan":
            write_receipt(mission, stage, "web-multi", multi_manifest)
        else:
            next_stage = {"review": "implementation", "implementation": "final-web-gate", "final-web-gate": "complete"}[stage]
            next_path = tmp_path / f"next-{stage}.md"
            next_path.write_text(f"after {stage}", encoding="utf-8")
            write_receipt(mission, stage, next_stage, next_path)
        return {"ok": True, "run_dir": str(mission.parent / "run")}

    def fake_multi(path: Path, *, dry_run: bool, parent_lock_held: bool):
        assert parent_lock_held is True
        workflow_config = module.load_manifest(workflow_path)
        stored = module._json(module._state_path(workflow_config, "a" * 32))
        assert stored["multi_execution_id"]
        assert stored["multi_manifest_sha256"] == module.sha(multi_manifest)
        assert Path(stored["multi_result_path"]).name == "result.json"
        receipt = tmp_path / "multi-result.json"
        output = tmp_path / "multi-output.md"
        output.write_text("merged", encoding="utf-8")
        receipt.write_text(json.dumps({
            "schema": "codex.chatgpt.oracle-stage-result/v1",
            "workflow_id": "a" * 32,
            "stage": "web-multi",
            "attempt_id": "b" * 64,
            "input_mission_sha256": module.sha(multi_manifest),
            "status": "PASS",
            "output_path": str(output),
            "output_sha256": module.sha(output),
            "next_stage": "review",
            "next_mission_path": str(review_mission),
            "next_mission_sha256": module.sha(review_mission),
            "ready_for_next": True,
            "blocker": "",
        }), encoding="utf-8")
        return {"ok": True, "parent_id": "b" * 64, "next_stage_result_path": str(receipt)}

    result = module.run_workflow(
        workflow_path,
        oracle_execute=fake_oracle,
        multi_execute=fake_multi,
        local_gate_runner=lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, "", ""),
    )
    assert result["ok"] is True
    assert stages_seen == ["plan", "review", "implementation", "final-web-gate"]


def test_dry_run_leaves_no_host_workflow_state_and_real_run_can_follow(tmp_path: Path) -> None:
    module = load()
    path = manifest(tmp_path)
    previews = []

    def fake_preview(oracle_manifest: Path, *, dry_run: bool):
        previews.append(dry_run)
        return {"ok": True, "status": "dry-run"}

    preview = module.run_workflow(path, dry_run=True, oracle_execute=fake_preview)
    assert preview["ok"] is True
    assert previews == [True]
    config = module.load_manifest(path)
    assert not module._state_path(config, "a" * 32).exists()

    calls = 0

    def fake_real(oracle_manifest: Path, *, dry_run: bool):
        nonlocal calls
        calls += 1
        return {"ok": True, "run_dir": str(tmp_path / "fake-run")}

    real = module.run_workflow(path, oracle_execute=fake_real)
    assert real["status"] == "awaiting_receipt"
    assert calls == 1


def _oracle_running_state(module, oracle_manifest: Path) -> Path:
    config = module.RUNNER.STATE.load_manifest(oracle_manifest)
    layout = module.RUNNER.STATE.create_layout(config, run_id=config.requested_run_id)
    layout.run_dir.mkdir(parents=True)
    module.RUNNER.STATE.write_json_atomic(
        layout.state_path,
        module.RUNNER.STATE.state_payload(config, layout, status="running", resolved_version="test"),
    )
    return layout.run_dir


def test_running_oracle_stage_recovers_exact_run_without_resubmission(tmp_path: Path) -> None:
    module = load()
    submitted = 0
    recovered = []

    def fake_execute(oracle_manifest: Path, *, dry_run: bool):
        nonlocal submitted
        submitted += 1
        return {"ok": False, "run_dir": str(_oracle_running_state(module, oracle_manifest))}

    def fake_recover(run_dir: Path, *, action: str, dry_run: bool):
        recovered.append((run_dir, action, dry_run))
        return {"ok": True, "status": "complete", "run_dir": str(run_dir)}

    path = manifest(tmp_path)
    first = module.run_workflow(path, oracle_execute=fake_execute, oracle_recover=fake_recover)
    assert first["status"] == "attention_required"
    assert first["oracle_run_id"] == first["current_attempt_id"]
    second = module.run_workflow(path, oracle_execute=fake_execute, oracle_recover=fake_recover)
    assert second["status"] == "awaiting_receipt"
    assert submitted == 1
    assert [item[1:] for item in recovered] == [("live", False)]
    assert second["recovery"]["status"] == "recovered"


def test_post_submit_watchdog_persists_same_attempt_and_only_exact_recovers(
    tmp_path: Path,
) -> None:
    module = load()
    submissions: list[Path] = []
    recoveries: list[tuple[Path, str]] = []

    def watchdog_execute(oracle_manifest: Path, *, dry_run: bool):
        run_dir = _oracle_running_state(module, oracle_manifest)
        submissions.append(run_dir)
        state_path = run_dir / "state.json"
        state = module.RUNNER.STATE.load_state(state_path)
        state.update({
            "status": "attention_required",
            "session_authority": "submitted_unknown",
            "transport_status": "post_submit_watchdog_timeout",
            "task_outcome_reason": "host-wall-clock-expired-process-preserved",
            "host_watchdog": {
                "status": "expired",
                "process_action": "preserved",
            },
        })
        module.RUNNER.STATE.write_json_atomic(state_path, state)
        return {
            "ok": False,
            "status": "post_submit_watchdog_timeout",
            "safe_for_fresh_run": False,
            "process_preserved": True,
            "run_dir": str(run_dir),
            "result": state,
        }

    def exact_recover(run_dir: Path, *, action: str, dry_run: bool):
        recoveries.append((run_dir, action))
        return {"ok": True, "status": "complete", "run_dir": str(run_dir)}

    workflow_manifest = manifest(tmp_path)
    first = module.run_workflow(
        workflow_manifest,
        oracle_execute=watchdog_execute,
        oracle_recover=exact_recover,
    )
    second = module.run_workflow(
        workflow_manifest,
        oracle_execute=watchdog_execute,
        oracle_recover=exact_recover,
    )

    assert first["status"] == "attention_required"
    assert first["current_attempt_id"] == first["oracle_run_id"]
    assert first["oracle_run_dir"] == str(submissions[0])
    assert len(submissions) == 1
    assert recoveries == [(submissions[0], "live")]
    assert second["status"] == "awaiting_receipt"
    assert second["recovery"]["status"] == "recovered"


def test_unambiguous_app_mention_pre_submit_failure_retries_once(tmp_path: Path) -> None:
    module = load()
    submitted = 0

    def fake_execute(oracle_manifest: Path, *, dry_run: bool):
        nonlocal submitted
        submitted += 1
        run_dir = _oracle_running_state(module, oracle_manifest)
        stdout = run_dir / "stdout.log"
        if submitted == 1:
            stdout.write_text(
                "ERROR: ChatGPT app mention suggestion did not appear.\n",
                encoding="utf-8",
            )
        else:
            stdout.write_text("ERROR: unrelated terminal failure\n", encoding="utf-8")
        return {"ok": False, "run_dir": str(run_dir)}

    result = module.run_workflow(manifest(tmp_path), oracle_execute=fake_execute)

    assert result["status"] == "attention_required"
    assert submitted == 2
    assert result["next_index"] == 0


@pytest.mark.parametrize(
    "marker",
    [
        'Unable to find model option matching "GPT-5.6 Sol" in the model switcher.',
        "--copy-profile requires rsync on PATH (spawn failed): spawn rsync ENOENT",
        "--copy-profile cannot be combined with --browser-manual-login",
    ],
)
def test_launch_time_pre_submit_failures_also_retry_once(tmp_path: Path, marker: str) -> None:
    module = load()
    submitted = 0

    def fake_execute(oracle_manifest: Path, *, dry_run: bool):
        nonlocal submitted
        submitted += 1
        run_dir = _oracle_running_state(module, oracle_manifest)
        stdout = run_dir / "stdout.log"
        if submitted == 1:
            stdout.write_text(f"ERROR: {marker}\n", encoding="utf-8")
        else:
            stdout.write_text("ERROR: unrelated terminal failure\n", encoding="utf-8")
        return {"ok": False, "run_dir": str(run_dir)}

    result = module.run_workflow(manifest(tmp_path), oracle_execute=fake_execute)

    assert submitted == 2
    assert result["status"] == "attention_required"
    assert result["next_index"] == 0


def test_version_resolution_prelaunch_failure_retries_same_stage_once_then_stops(tmp_path: Path) -> None:
    module = load()
    submissions = 0
    recoveries = 0

    def fake_execute(oracle_manifest: Path, *, dry_run: bool):
        nonlocal submissions
        submissions += 1
        run_dir = _oracle_running_state(module, oracle_manifest)
        state_path = run_dir / "state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["status"] = "attention_required"
        state["session_authority"] = "pre_submit"
        state["oracle"]["resolved_version"] = "unresolved"
        state_path.write_text(json.dumps(state), encoding="utf-8")
        (run_dir / "stdout.log").write_bytes(b"")
        (run_dir / "stderr.log").write_text(
            "version resolution failed: Command ['npx.cmd', '-y', '@steipete/oracle', '--version'] timed out after 30 seconds\n",
            encoding="utf-8",
        )
        return {"ok": False, "run_dir": str(run_dir)}

    def forbidden_recover(*args, **kwargs):
        nonlocal recoveries
        recoveries += 1
        raise AssertionError("proven pre-submit failures must not invoke exact-session recovery")

    workflow_manifest = manifest(tmp_path)
    result = module.run_workflow(
        workflow_manifest,
        oracle_execute=fake_execute,
        oracle_recover=forbidden_recover,
    )
    config = module.load_manifest(workflow_manifest)

    assert submissions == 2
    assert recoveries == 0
    assert result["status"] == "attention_required"
    assert result["current_stage"] == "plan"
    assert result["next_index"] == 0
    assert result["pre_submit_retries"] == 1
    assert result["current_binding_source_sha256"] == module.sha(config["initial_mission_path"])


def test_pre_submit_retry_budget_is_stage_input_scoped_and_counts_started_replacement(tmp_path: Path) -> None:
    module = load()
    failed_plan = tmp_path / "plan-failed"
    failed_implementation = tmp_path / "implementation-failed"
    replacement = tmp_path / "implementation-replacement"
    for path in (failed_plan, failed_implementation, replacement):
        path.mkdir()
    plan_input = "a" * 64
    implementation_input = "b" * 64
    records = [
        {
            "stage": "plan",
            "run_dir": str(failed_plan),
            "pre_submit_failure": True,
            "pre_submit_retry_consumed": True,
            "input_mission_sha256": plan_input,
        },
        {
            "stage": "implementation",
            "run_dir": str(failed_implementation),
            "settlement": "user-confirmed-no-submission",
        },
    ]

    assert module._pre_submit_retry_count(
        records,
        stage="plan",
        input_sha256=plan_input,
        current_run_dir=failed_plan,
    ) == 1
    # The plan retry does not consume the implementation binding's budget.
    assert module._pre_submit_retry_count(
        records,
        stage="implementation",
        input_sha256=implementation_input,
        current_run_dir=failed_implementation,
    ) == 0
    # Once a different attempt is current, the recorded settlement has already
    # produced its one replacement and no second submission is permitted.
    assert module._pre_submit_retry_count(
        records,
        stage="implementation",
        input_sha256=implementation_input,
        current_run_dir=replacement,
    ) == 1
    # An unattributed legacy global retry is conservatively treated as spent.
    assert module._pre_submit_retry_count(
        [{"stage": "plan", "run_dir": str(failed_plan), "ok": False}],
        stage="implementation",
        input_sha256=implementation_input,
        current_run_dir=failed_implementation,
        legacy_total=1,
    ) == 1


def test_user_confirmed_settlement_submits_one_bound_replacement_then_never_a_second(tmp_path: Path) -> None:
    module = load()
    submissions: list[Path] = []

    def fake_execute(oracle_manifest: Path, *, dry_run: bool):
        run_dir = _oracle_running_state(module, oracle_manifest)
        submissions.append(run_dir)
        state_path = run_dir / "state.json"
        state = module.RUNNER.STATE.load_state(state_path)
        state.update({
            "status": "attention_required",
            "exit_code": 1,
            "session_authority": "submitted_unknown",
            "transport_status": "incomplete",
        })
        module.RUNNER.STATE.write_json_atomic(state_path, state)
        Path(state["mission"]["transport_path"]).write_bytes(
            Path(state["mission"]["path"]).read_bytes()
        )
        if len(submissions) == 1:
            slug = state["oracle"]["slug"]
            (run_dir / "stdout.log").write_text(
                f"Session: {slug}\n"
                "ERROR: Prompt did not appear in conversation before timeout (send may have failed)\n",
                encoding="utf-8",
            )
            (run_dir / "stderr.log").write_text("", encoding="utf-8")
            (run_dir / "recovery-harvest-stdout.log").write_text(
                f'No live ChatGPT tab matched session "{slug}". Attempting recovery.\n',
                encoding="utf-8",
            )
            (run_dir / "recovery-harvest-stderr.log").write_text(
                "Cannot recover conversation: session metadata has no recoverable ChatGPT conversation URL.\n",
                encoding="utf-8",
            )
        else:
            (run_dir / "stdout.log").write_text("unrelated failure\n", encoding="utf-8")
            (run_dir / "stderr.log").write_text("", encoding="utf-8")
        return {"ok": False, "run_dir": str(run_dir)}

    workflow_manifest = manifest(tmp_path)
    first = module.run_workflow(workflow_manifest, oracle_execute=fake_execute)
    assert first["status"] == "attention_required"
    assert len(submissions) == 1

    module.RUNNER.STATE.settle_user_confirmed_no_submission(
        submissions[0] / "state.json",
        confirmation=module.RUNNER.STATE.USER_CONFIRMED_NO_SUBMISSION,
        reason="user confirmed the exact attempt was not submitted",
    )
    second = module.run_workflow(workflow_manifest, oracle_execute=fake_execute)
    assert second["status"] == "attention_required"
    assert len(submissions) == 2
    settlement_records = [
        record for record in second["records"]
        if isinstance(record, dict) and record.get("settlement") == "user-confirmed-no-submission"
    ]
    assert len(settlement_records) == 1
    assert settlement_records[0]["settlement_path"]
    assert settlement_records[0]["settlement_sha256"]

    recoveries: list[Path] = []

    def exact_recovery_only(run_dir: Path, *, action: str, dry_run: bool):
        recoveries.append(run_dir)
        return {"ok": False, "status": "attention_required", "run_dir": str(run_dir)}

    third = module.run_workflow(
        workflow_manifest,
        oracle_execute=lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("a second replacement must never be submitted")
        ),
        oracle_recover=exact_recovery_only,
    )
    assert third["status"] == "attention_required"
    assert recoveries == [submissions[1]]
    assert len(submissions) == 2


def test_user_confirmed_retry_binding_rejects_any_identity_drift(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    module = load()
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    project_root = tmp_path / "project"
    project_root.mkdir()
    attempt = "a" * 32
    workflow_id = "b" * 32
    input_path = project_root / "input.md"
    input_path.write_text("input", encoding="utf-8")
    input_sha = module.sha(input_path)
    augmented_path = project_root / "augmented.md"
    augmented_path.write_text("augmented", encoding="utf-8")
    augmented_sha = module.sha(augmented_path)
    proof = {
        "project_root": str(project_root.resolve()),
        "workflow_id": workflow_id,
        "stage": "implementation",
        "attempt_id": attempt,
        "run_id": attempt,
        "input_mission_sha256": input_sha,
        "mission_sha256": augmented_sha,
        "_augmented_mission_path": str(augmented_path.resolve()),
        "_input_mission_path": str(input_path.resolve()),
    }
    monkeypatch.setattr(module.RUNNER.STATE, "proven_user_confirmed_no_submission", lambda path: dict(proof))
    config = {"project_root": project_root.resolve()}

    assert module._user_confirmed_retry_binding_matches(
        run_dir,
        config=config,
        workflow_id=workflow_id,
        stage="implementation",
        attempt_id=attempt,
        input_sha256=input_sha,
        augmented_mission_path=augmented_path,
        augmented_mission_sha256=augmented_sha,
        binding_source_path=input_path,
    ) is True
    for field, wrong in (
        ("workflow_id", "d" * 32),
        ("stage", "review"),
        ("attempt_id", "e" * 32),
        ("run_id", "f" * 32),
        ("input_mission_sha256", "0" * 64),
        ("mission_sha256", "1" * 64),
        ("_augmented_mission_path", str(project_root / "wrong-augmented.md")),
        ("_input_mission_path", str(project_root / "wrong-input.md")),
    ):
        changed = dict(proof)
        changed[field] = wrong
        monkeypatch.setattr(
            module.RUNNER.STATE,
            "proven_user_confirmed_no_submission",
            lambda path, value=changed: value,
        )
        assert module._user_confirmed_retry_binding_matches(
            run_dir,
            config=config,
            workflow_id=workflow_id,
            stage="implementation",
            attempt_id=attempt,
            input_sha256=input_sha,
            augmented_mission_path=augmented_path,
            augmented_mission_sha256=augmented_sha,
            binding_source_path=input_path,
        ) is False

    monkeypatch.setattr(
        module.RUNNER.STATE,
        "proven_user_confirmed_no_submission",
        lambda path: dict(proof),
    )
    assert module._user_confirmed_retry_binding_matches(
        run_dir,
        config=config,
        workflow_id=workflow_id,
        stage="implementation",
        attempt_id=attempt,
        input_sha256=input_sha,
        augmented_mission_path=augmented_path,
        augmented_mission_sha256="2" * 64,
        binding_source_path=input_path,
    ) is False


def test_durable_output_prevents_pre_submit_retry_even_with_a_launch_marker(tmp_path: Path) -> None:
    module = load()
    submitted = 0

    def fake_execute(oracle_manifest: Path, *, dry_run: bool):
        nonlocal submitted
        submitted += 1
        run_dir = _oracle_running_state(module, oracle_manifest)
        (run_dir / "stdout.log").write_text(
            'ERROR: Unable to find model option matching "GPT-5.6 Sol" in the model switcher.\n',
            encoding="utf-8",
        )
        (run_dir / "output.md").write_text("partial provider answer", encoding="utf-8")
        return {"ok": False, "run_dir": str(run_dir)}

    result = module.run_workflow(manifest(tmp_path), oracle_execute=fake_execute)

    assert submitted == 1
    assert result["status"] == "attention_required"


def test_running_stage_does_not_trust_existing_receipt_before_terminal_authority(tmp_path: Path) -> None:
    module = load()
    submitted = []
    recovered = []
    next_mission = tmp_path / "review.md"
    next_mission.write_text("review", encoding="utf-8")

    def fake_execute(oracle_manifest: Path, *, dry_run: bool):
        config = json.loads(oracle_manifest.read_text(encoding="utf-8"))
        mission = Path(config["mission_path"])
        submitted.append(mission)
        return {"ok": False, "run_dir": str(_oracle_running_state(module, oracle_manifest))}

    def fake_recover(*args, **kwargs):
        recovered.append((args, kwargs))
        return {"ok": False, "status": "session_live", "run_dir": str(args[0])}

    path = manifest(tmp_path)
    first = module.run_workflow(path, oracle_execute=fake_execute, oracle_recover=fake_recover)
    receipt_path = Path(first["receipt_path"])
    output = receipt_path.parent / "output.md"
    output.write_text("plan", encoding="utf-8")
    receipt_path.write_text(json.dumps({
        "schema": module.RECEIPT_SCHEMA,
        "workflow_id": "a" * 32,
        "stage": "plan",
        "attempt_id": first["current_attempt_id"],
        "input_mission_sha256": first["current_input_sha256"],
        "status": "PASS",
        "output_path": str(output),
        "output_sha256": module.sha(output),
        "next_stage": "review",
        "next_mission_path": str(next_mission),
        "next_mission_sha256": module.sha(next_mission),
        "ready_for_next": True,
        "blocker": "",
    }), encoding="utf-8")

    second = module.run_workflow(path, oracle_execute=fake_execute, oracle_recover=fake_recover)

    assert second["status"] == "running"
    assert second["current_stage"] == "plan"
    assert len(submitted) == 1
    assert len(recovered) == 1
    assert recovered[0][1]["action"] == "live"


def test_review_revise_receipt_is_terminal_legacy_compatibility(tmp_path: Path) -> None:
    module = load()
    output = tmp_path / "review-output.md"
    output.write_text("revise", encoding="utf-8")
    next_mission = tmp_path / "next-plan.md"
    next_mission.write_text("fix the plan", encoding="utf-8")
    receipt = tmp_path / "stage-result.json"
    receipt.write_text(json.dumps({
        "schema": module.RECEIPT_SCHEMA,
        "workflow_id": "a" * 32,
        "stage": "review",
        "attempt_id": "b" * 32,
        "input_mission_sha256": "c" * 64,
        "status": "REVISE",
        "output_path": str(output),
        "output_sha256": module.sha(output),
        "next_stage": "plan",
        "next_mission_path": str(next_mission),
        "next_mission_sha256": module.sha(next_mission),
        "ready_for_next": True,
        "blocker": "",
    }), encoding="utf-8")

    value = module._validate_receipt(
        {"project_root": tmp_path},
        receipt,
        "a" * 32,
        "review",
        "b" * 32,
        "c" * 64,
    )

    assert value["status"] == "REVISE"
    assert value["next_stage"] == "plan"
    assert value["_next_mission"] is None
    assert "cannot create a new plan" in value["_terminal_attention"]


def _review_receipt(
    module,
    tmp_path: Path,
    *,
    status: str,
    attempt: str,
    ids: list[str],
    next_stage: str,
    blocker: str = "",
) -> Path:
    output = tmp_path / f"{attempt}-output.md"
    output.write_text(status, encoding="utf-8")
    next_mission = tmp_path / f"{attempt}-next.md"
    next_mission.write_text(next_stage, encoding="utf-8")
    receipt = tmp_path / f"{attempt}-receipt.json"
    value = {
        "schema": module.RECEIPT_SCHEMA,
        "workflow_id": "a" * 32,
        "stage": "review",
        "attempt_id": attempt,
        "input_mission_sha256": "c" * 64,
        "status": status,
        "output_path": str(output),
        "output_sha256": module.sha(output),
        "next_stage": next_stage,
        "next_mission_path": str(next_mission),
        "next_mission_sha256": module.sha(next_mission),
        "ready_for_next": status != "FAIL",
        "blocker": blocker,
        "critical_finding_ids": ids,
        "critical_findings_sha256": module._finding_hash(ids),
    }
    receipt.write_text(json.dumps(value), encoding="utf-8")
    return receipt


def test_legacy_revise_never_creates_another_plan(tmp_path: Path) -> None:
    module = load()
    config = {
        "project_root": tmp_path,
        "_review_policy": module._default_review_policy(),
    }
    first = _review_receipt(
        module, tmp_path, status="REVISE", attempt="1" * 32,
        ids=["critical-input"], next_stage="plan",
    )
    second = _review_receipt(
        module, tmp_path, status="REVISE", attempt="2" * 32,
        ids=["critical-input"], next_stage="plan",
    )
    third = _review_receipt(
        module, tmp_path, status="REVISE", attempt="3" * 32,
        ids=["critical-input"], next_stage="plan",
    )

    values = [
        module._validate_receipt(config, first, "a" * 32, "review", "1" * 32, "c" * 64),
        module._validate_receipt(config, second, "a" * 32, "review", "2" * 32, "c" * 64),
        module._validate_receipt(config, third, "a" * 32, "review", "3" * 32, "c" * 64),
    ]

    assert all(value["_next_mission"] is None for value in values)
    assert all("cannot create a new plan" in value["_terminal_attention"] for value in values)
    assert config["_review_policy"]["plan_revisions_used"] == 0
    assert config["_review_policy"]["plan_revisions_remaining"] == 2


def test_review_mission_assigns_inline_plan_repair_and_exact_workspace_entry(tmp_path: Path) -> None:
    module = load()
    source = tmp_path / "검토-입력.md"
    source.write_text("계획을 검토하세요.", encoding="utf-8")
    config = {
        "project_root": tmp_path,
        "workflow_dir": tmp_path / "workflow",
        "_review_policy": {
            **module._default_review_policy(),
            "plan_revisions_used": 2,
            "plan_revisions_remaining": 0,
        },
    }

    mission, _, _ = module._stage_mission(
        config, "a" * 32, 2, "review", source, "b" * 32
    )
    text = mission.read_text(encoding="utf-8")

    assert f"exact_project_root={tmp_path}" in text
    assert f"exact_input_mission_path={source}" in text
    assert "retry the same exact root at most once" in text
    assert "Never substitute a parent root, child directory" in text
    assert "plan repair and finalization owner" in text
    assert "write the corrected final plan as your output" in text
    assert "next_stage=implementation" in text
    assert "REVISE is legacy compatibility only" in text
    assert "review_repair_owner=review" in text
    assert "new_plan_transition_allowed=false" in text
    assert "plan_revisions_remaining=0" in text


def test_pass_with_notes_proceeds_to_implementation(tmp_path: Path) -> None:
    module = load()
    receipt = _review_receipt(
        module, tmp_path, status="PASS_WITH_NOTES", attempt="4" * 32,
        ids=[], next_stage="implementation",
    )
    value = module._validate_receipt(
        {"project_root": tmp_path},
        receipt,
        "a" * 32,
        "review",
        "4" * 32,
        "c" * 64,
    )
    assert value["status"] == "PASS_WITH_NOTES"
    assert value["next_stage"] == "implementation"


def test_legacy_revise_is_terminal_and_duplicate_finding_ids_are_rejected(tmp_path: Path) -> None:
    module = load()
    config = {
        "project_root": tmp_path,
        "_review_policy": {
            **module._default_review_policy(),
            "plan_revisions_used": 1,
            "plan_revisions_remaining": 1,
            "baseline_critical_finding_ids": ["fixed-a"],
            "baseline_critical_findings_sha256": module._finding_hash(["fixed-a"]),
        },
    }
    added = _review_receipt(
        module, tmp_path, status="REVISE", attempt="5" * 32,
        ids=["new-b"], next_stage="plan",
    )
    added_value = module._validate_receipt(
        config, added, "a" * 32, "review", "5" * 32, "c" * 64
    )
    assert added_value["_next_mission"] is None
    assert "cannot create a new plan" in added_value["_terminal_attention"]

    duplicate = json.loads(added.read_text(encoding="utf-8"))
    duplicate["attempt_id"] = "6" * 32
    duplicate["critical_finding_ids"] = ["fixed-a", "fixed-a"]
    duplicate["critical_findings_sha256"] = module._finding_hash(["fixed-a", "fixed-a"])
    duplicate_path = tmp_path / "duplicate.json"
    duplicate_path.write_text(json.dumps(duplicate), encoding="utf-8")
    with pytest.raises(module.WorkflowError, match="unique and sorted"):
        module._validate_receipt(
            config, duplicate_path, "a" * 32, "review", "6" * 32, "c" * 64
        )


def test_active_scope_blocks_retry_workflow_and_exposes_revision_budget(tmp_path: Path) -> None:
    module = load()
    first_path = manifest(tmp_path)
    first = module.load_manifest(first_path)
    first["_review_policy"] = {
        **module._default_review_policy(),
        "plan_revisions_used": 2,
        "plan_revisions_remaining": 0,
    }
    module._claim_scope(first, first["workflow_id"])
    scope = module._json(module._scope_path(first))
    assert scope["review_policy"]["plan_revisions_remaining"] == 0

    second = dict(first)
    second["workflow_id"] = "b" * 32
    with pytest.raises(module.WorkflowError, match="recover that exact workflow"):
        module._claim_scope(second, second["workflow_id"])


def test_review_history_budget_spans_retry_workflow_directories(tmp_path: Path) -> None:
    module = load()
    root = tmp_path / "project"
    root.mkdir()
    for index, attempt in enumerate(("1" * 32, "2" * 32, "3" * 32), start=1):
        stage_dir = tmp_path / f"workflow-retry{index}" / "stages" / f"001-review-{attempt}"
        stage_dir.mkdir(parents=True)
        output = stage_dir / "review.md"
        output.write_text("critical", encoding="utf-8")
        receipt = {
            "schema": module.RECEIPT_SCHEMA,
            "workflow_id": str(index) * 32,
            "stage": "review",
            "attempt_id": attempt,
            "input_mission_sha256": "c" * 64,
            "status": "REVISE",
            "output_path": str(output),
            "output_sha256": module.sha(output),
            "next_stage": "plan",
            "next_mission_path": str(output),
            "next_mission_sha256": module.sha(output),
            "ready_for_next": True,
            "blocker": "",
        }
        (stage_dir / "stage-result.json").write_text(json.dumps(receipt), encoding="utf-8")

    config = {
        "project_root": root,
        "workflow_dir": tmp_path / "workflow-retry11",
    }
    policy = module._review_policy_from_history(config)

    assert policy["plan_revisions_used"] == 3
    assert policy["plan_revisions_remaining"] == 0
    assert policy["baseline_critical_finding_ids"] == [
        f"legacy-{module.sha(tmp_path / 'workflow-retry1' / 'stages' / ('001-review-' + '1' * 32) / 'review.md')[:24]}"
    ]


def test_blocked_plan_receipt_can_continue_to_bound_source_repair_plan(tmp_path: Path) -> None:
    module = load()
    output = tmp_path / "blocked-plan.md"
    output.write_text("source evidence is incomplete", encoding="utf-8")
    next_mission = tmp_path / "source-repair.md"
    next_mission.write_text("repair the source evidence", encoding="utf-8")
    receipt = tmp_path / "stage-result.json"
    receipt.write_text(json.dumps({
        "schema": module.RECEIPT_SCHEMA,
        "workflow_id": "a" * 32,
        "stage": "plan",
        "attempt_id": "b" * 32,
        "input_mission_sha256": "c" * 64,
        "status": "BLOCKED_PLAN",
        "output_path": str(output),
        "output_sha256": module.sha(output),
        "next_stage": "plan",
        "next_mission_path": str(next_mission),
        "next_mission_sha256": module.sha(next_mission),
        "ready_for_next": True,
        "blocker": "first-party historical rule evidence is incomplete",
    }), encoding="utf-8")

    value = module._validate_receipt(
        {"project_root": tmp_path},
        receipt,
        "a" * 32,
        "plan",
        "b" * 32,
        "c" * 64,
    )

    assert value["status"] == "BLOCKED_PLAN"
    assert value["next_stage"] == "plan"


def test_source_repair_plan_ready_receipt_can_continue_to_review(tmp_path: Path) -> None:
    module = load()
    output = tmp_path / "source-repair-plan.md"
    output.write_text("ready", encoding="utf-8")
    next_mission = tmp_path / "next-review.md"
    next_mission.write_text("review the source repair", encoding="utf-8")
    receipt = tmp_path / "stage-result.json"
    receipt.write_text(json.dumps({
        "schema": module.RECEIPT_SCHEMA,
        "workflow_id": "a" * 32,
        "stage": "plan",
        "attempt_id": "b" * 32,
        "input_mission_sha256": "c" * 64,
        "status": "SOURCE_REPAIR_PLAN_READY",
        "output_path": str(output),
        "output_sha256": module.sha(output),
        "next_stage": "review",
        "next_mission_path": str(next_mission),
        "next_mission_sha256": module.sha(next_mission),
        "ready_for_next": True,
        "blocker": "",
    }), encoding="utf-8")

    value = module._validate_receipt(
        {"project_root": tmp_path},
        receipt,
        "a" * 32,
        "plan",
        "b" * 32,
        "c" * 64,
    )

    assert value["status"] == "SOURCE_REPAIR_PLAN_READY"
    assert value["next_stage"] == "review"


def test_awaiting_receipt_rebind_advances_to_next_stage_without_replaying_plan(tmp_path: Path) -> None:
    module = load()
    calls = []
    review = tmp_path / "review.md"
    review.write_text("review", encoding="utf-8")

    def fake_execute(oracle_manifest: Path, *, dry_run: bool):
        config = json.loads(oracle_manifest.read_text(encoding="utf-8"))
        mission = Path(config["mission_path"])
        text = mission.read_text(encoding="utf-8")
        stage = "plan" if "stage=plan\n" in text else "review"
        calls.append(stage)
        run_dir = _oracle_running_state(module, oracle_manifest)
        if stage == "plan":
            attempt = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("attempt_id="))
            input_sha = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("input_mission_sha256="))
            output = mission.parent / "out.md"
            output.write_text("plan", encoding="utf-8")
            (mission.parent / "stage-result.json").write_text(json.dumps({
                "schema": "codex.chatgpt.oracle-stage-result/v1", "workflow_id": "a" * 32,
                "stage": "plan", "attempt_id": attempt, "input_mission_sha256": input_sha,
                "status": "PASS", "output_path": str(output), "output_sha256": module.sha(output),
                "next_stage": "review", "next_mission_path": str(review), "next_mission_sha256": module.sha(review),
                "ready_for_next": True, "blocker": "",
            }), encoding="utf-8")
            return {"ok": True, "run_dir": str(run_dir)}
        return {"ok": False, "run_dir": str(run_dir)}

    result = module.run_workflow(manifest(tmp_path), oracle_execute=fake_execute)
    assert result["status"] == "attention_required"
    assert result["current_stage"] == "review"
    assert calls == ["plan", "review"]
    assert result["next_index"] == 1


def test_awaiting_relative_receipt_resumes_same_workflow_without_replaying_plan(tmp_path: Path) -> None:
    module = load()
    workflow_path = manifest(tmp_path)
    config = module.load_manifest(workflow_path)
    workflow_id = config["workflow_id"]
    attempt_id = "b" * 32
    mission, receipt_path, input_sha = module._stage_mission(
        config, workflow_id, 0, "plan", config["initial_mission_path"], attempt_id
    )
    output = mission.parent / "plan.md"
    review = mission.parent / "review.md"
    output.write_text("plan", encoding="utf-8")
    review.write_text("review", encoding="utf-8")
    receipt_path.write_text(json.dumps({
        "schema": module.RECEIPT_SCHEMA,
        "workflow_id": workflow_id,
        "stage": "plan",
        "attempt_id": attempt_id,
        "input_mission_sha256": input_sha,
        "status": "PLAN_READY",
        "output_path": str(output.relative_to(tmp_path)),
        "output_sha256": module.sha(output),
        "next_stage": "review",
        "next_mission_path": str(review.relative_to(tmp_path)),
        "next_mission_sha256": module.sha(review),
        "ready_for_next": True,
        "blocker": None,
    }), encoding="utf-8")
    state_path = module._state_path(config, workflow_id)
    module._write(state_path, {
        "schema": module.STATE_SCHEMA,
        "status": "awaiting_receipt",
        "workflow_id": workflow_id,
        "manifest_sha256": config["manifest_sha256"],
        "current_stage": "plan",
        "current_attempt_id": attempt_id,
        "current_input_sha256": input_sha,
        "current_mission_path": str(config["initial_mission_path"]),
        "receipt_path": str(receipt_path),
        "next_index": 0,
        "records": [],
    })
    calls: list[str] = []

    def review_only(oracle_manifest: Path, *, dry_run: bool):
        data = json.loads(oracle_manifest.read_text(encoding="utf-8"))
        stage_mission = Path(data["mission_path"])
        text = stage_mission.read_text(encoding="utf-8")
        assert "stage=plan\n" not in text
        assert "stage=review\n" in text
        calls.append("review")
        return {"ok": False, "run_dir": str(_oracle_running_state(module, oracle_manifest))}

    result = module.run_workflow(workflow_path, oracle_execute=review_only)

    assert result["status"] == "attention_required"
    assert result["current_stage"] == "review"
    assert calls == ["review"]


def test_running_web_multi_rebinds_only_persisted_parent_result(tmp_path: Path) -> None:
    module = load()
    path = manifest(tmp_path)
    config = module.load_manifest(path)
    multi_source = tmp_path / "multi.json"
    multi_source.write_text("{}", encoding="utf-8")
    review = tmp_path / "review.md"
    review.write_text("review", encoding="utf-8")
    output = tmp_path / "multi-output.md"
    output.write_text("merged", encoding="utf-8")
    receipt = tmp_path / "multi-receipt.json"
    parent_id = "b" * 64
    receipt.write_text(json.dumps({
        "schema": "codex.chatgpt.oracle-stage-result/v1", "workflow_id": "a" * 32,
        "stage": "web-multi", "attempt_id": parent_id, "input_mission_sha256": module.sha(multi_source),
        "status": "PASS", "output_path": str(output), "output_sha256": module.sha(output),
        "next_stage": "review", "next_mission_path": str(review), "next_mission_sha256": module.sha(review),
        "ready_for_next": True, "blocker": "",
    }), encoding="utf-8")
    result_path = tmp_path / "multi-result.json"
    result_path.write_text(json.dumps({
        "schema": module.MULTI.RESULT_SCHEMA, "status": "complete", "parent_id": parent_id,
        "next_stage_result_path": str(receipt),
    }), encoding="utf-8")
    state_path = module._state_path(config, "a" * 32)
    module._write(state_path, {
        "schema": module.STATE_SCHEMA, "status": "running", "workflow_id": "a" * 32,
        "manifest_sha256": config["manifest_sha256"], "current_stage": "web-multi",
        "current_mission_path": str(multi_source), "next_index": 0, "records": [],
        "multi_execution_id": "c" * 64, "multi_manifest_sha256": module.sha(multi_source),
        "multi_result_path": str(result_path), "multi_receipt_path": str(receipt),
    })
    calls = 0

    def fake_oracle(oracle_manifest: Path, *, dry_run: bool):
        nonlocal calls
        calls += 1
        return {"ok": False, "run_dir": str(_oracle_running_state(module, oracle_manifest))}

    def never_multi(*args, **kwargs):
        raise AssertionError("stored Web Multi result must be rebound, not resubmitted")

    result = module.run_workflow(path, oracle_execute=fake_oracle, multi_execute=never_multi)
    assert result["status"] == "attention_required"
    assert result["current_stage"] == "review"
    assert calls == 1
    assert result["records"][0]["parent_id"] == parent_id


def test_default_recovery_uses_the_persisted_parallel_child_mutex(monkeypatch, tmp_path: Path) -> None:
    module = load()
    calls = []
    run_dir = tmp_path / "exact-run"
    run_dir.mkdir()
    (run_dir / "state.json").write_text(
        json.dumps({"schema": module.RUNNER.STATE.STATE_SCHEMA, "parallel_parent_id": "a" * 64}),
        encoding="utf-8",
    )

    def fake_recover(run_dir: Path, *, action: str, dry_run: bool):
        calls.append((run_dir, action, dry_run))
        return {"ok": True}

    monkeypatch.setattr(module.RUNNER, "recover_run", fake_recover)
    value = module._recover_oracle_under_workflow_mutex(run_dir, action="harvest", dry_run=False)
    assert value["ok"] is True
    assert calls == [(run_dir.resolve(), "harvest", False)]


def test_default_recovery_rejects_a_nonparallel_child(tmp_path: Path) -> None:
    module = load()
    run_dir = tmp_path / "exact-run"
    run_dir.mkdir()
    (run_dir / "state.json").write_text(
        json.dumps({"schema": module.RUNNER.STATE.STATE_SCHEMA, "run_id": "x"}),
        encoding="utf-8",
    )
    value = module._recover_oracle_under_workflow_mutex(run_dir, action="harvest", dry_run=False)
    assert value["ok"] is False
    assert value["error"] == "ORACLE_RECOVERY_PARALLEL_PARENT_MISSING"


def _pro_attachment_mission(module, tmp_path: Path, attachments: list[dict[str, str]]) -> Path:
    mission = tmp_path / "pro-next.md"
    mission.write_text(
        "Pro decision mission\n\n"
        "[PRO_ATTACHMENT_CONTRACT]\n"
        + json.dumps({"schema": module.PRO_ATTACHMENT_SCHEMA, "attachments": attachments})
        + "\n[/PRO_ATTACHMENT_CONTRACT]\n",
        encoding="utf-8",
    )
    return mission


def test_pro_attachment_contract_includes_only_declared_exact_packet(tmp_path: Path) -> None:
    module = load()
    config = module.load_manifest(manifest(tmp_path))
    config["_parallel_parent_id"] = "b" * 64
    packet = tmp_path / "packet.zip"
    packet.write_bytes(b"exact packet")
    source = _pro_attachment_mission(module, tmp_path, [{"path": str(packet), "sha256": module.sha(packet)}])
    extras = module._declared_pro_attachments(config, source)
    augmented = tmp_path / "augmented-mission.md"
    augmented.write_text("bound pro mission", encoding="utf-8")
    payload = json.loads(module._oracle_manifest(
        config, augmented, tmp_path, "c" * 32, stage="pro", pro_attachments=extras
    ).read_text(encoding="utf-8"))
    assert payload["attachments"] == [str(augmented), str(packet.resolve())]


def test_pro_attachment_contract_rejects_hash_mismatch_before_submission(tmp_path: Path) -> None:
    module = load()
    config = module.load_manifest(manifest(tmp_path))
    packet = tmp_path / "packet.zip"
    packet.write_bytes(b"exact packet")
    source = _pro_attachment_mission(module, tmp_path, [{"path": str(packet), "sha256": "0" * 64}])
    with pytest.raises(module.WorkflowError, match="hash mismatch"):
        module._declared_pro_attachments(config, source)


def test_pro_attachment_contract_rejects_outside_project_and_symlink(tmp_path: Path) -> None:
    module = load()
    config = module.load_manifest(manifest(tmp_path))
    outside = tmp_path.parent / "outside-packet.zip"
    outside.write_bytes(b"outside")
    source = _pro_attachment_mission(module, tmp_path, [{"path": str(outside)}])
    with pytest.raises(module.WorkflowError, match="outside project"):
        module._declared_pro_attachments(config, source)

    target = tmp_path / "packet.zip"
    target.write_bytes(b"packet")
    link = tmp_path / "packet-link.zip"
    try:
        link.symlink_to(target)
    except OSError as exc:
        pytest.skip(f"symlink creation unavailable: {exc}")
    source = _pro_attachment_mission(module, tmp_path, [{"path": str(link)}])
    with pytest.raises(module.WorkflowError, match="non-symlink"):
        module._declared_pro_attachments(config, source)


def test_regular_manifest_never_attaches_pro_packets_and_default_pro_uses_devspace(tmp_path: Path) -> None:
    module = load()
    config = module.load_manifest(manifest(tmp_path))
    config["_parallel_parent_id"] = "b" * 64
    mission = tmp_path / "mission.md"
    mission.write_text("mission", encoding="utf-8")
    packet = tmp_path / "packet.zip"
    packet.write_bytes(b"packet")
    regular = json.loads(module._oracle_manifest(
        config, mission, tmp_path / "regular", "c" * 32, stage="plan", pro_attachments=(packet,)
    ).read_text(encoding="utf-8"))
    assert "attachments" not in regular
    assert regular["transport"] == "devspace"
    default_pro = json.loads(module._oracle_manifest(
        config, mission, tmp_path / "legacy-pro", "d" * 32, stage="pro"
    ).read_text(encoding="utf-8"))
    assert default_pro["transport"] == "pro-devspace"
    assert default_pro["task_outcome_contract"] == "v1"
    assert default_pro["app_name"] == config["app_name"]
    assert "attachments" not in default_pro


def test_plan_mission_teaches_declared_packet_contract(tmp_path: Path) -> None:
    module = load()
    config = module.load_manifest(manifest(tmp_path))
    mission, _, _ = module._stage_mission(
        config, "a" * 32, 0, "plan", config["initial_mission_path"], "b" * 32
    )
    text = mission.read_text(encoding="utf-8")
    assert "[PRO_ATTACHMENT_AUTHORING_CONTRACT]" in text
    assert module.PRO_ATTACHMENT_SCHEMA in text
    assert "Canonical plan receipt status is PLAN_READY" in text
    assert "output_path and next_mission_path MUST be absolute paths" in text


def test_receipt_compatibly_resolves_project_relative_paths_with_hash_binding(tmp_path: Path) -> None:
    module = load()
    config = module.load_manifest(manifest(tmp_path))
    output = tmp_path / "artifacts" / "plan.md"
    next_mission = tmp_path / "missions" / "review.md"
    output.parent.mkdir(parents=True)
    next_mission.parent.mkdir(parents=True)
    output.write_text("plan", encoding="utf-8")
    next_mission.write_text("review", encoding="utf-8")
    receipt_path = tmp_path / "stage-result.json"
    receipt_path.write_text(json.dumps({
        "schema": module.RECEIPT_SCHEMA,
        "workflow_id": "a" * 32,
        "stage": "plan",
        "attempt_id": "b" * 32,
        "input_mission_sha256": "c" * 64,
        "status": "PLAN_READY",
        "output_path": str(output.relative_to(tmp_path)),
        "output_sha256": module.sha(output),
        "next_stage": "review",
        "next_mission_path": str(next_mission.relative_to(tmp_path)),
        "next_mission_sha256": module.sha(next_mission),
        "ready_for_next": True,
        "blocker": None,
    }), encoding="utf-8")

    value = module._validate_receipt(
        config, receipt_path, "a" * 32, "plan", "b" * 32, "c" * 64
    )

    assert value["output_path"] == str(output.resolve())
    assert value["next_mission_path"] == str(next_mission.resolve())
    assert value["_next_mission"] == next_mission.resolve()
    assert set(value["_receipt_path_compatibility"]) == {"output_path", "next_mission_path"}
    persisted = json.loads(receipt_path.read_text(encoding="utf-8"))
    assert persisted["output_path"] == str(output.relative_to(tmp_path))
    assert persisted["next_mission_path"] == str(next_mission.relative_to(tmp_path))


def test_receipt_relative_path_escape_remains_fail_closed(tmp_path: Path) -> None:
    module = load()
    root = tmp_path / "project"
    root.mkdir()
    outside = tmp_path / "outside.md"
    outside.write_text("outside", encoding="utf-8")
    with pytest.raises(module.WorkflowError, match="path outside project"):
        module._receipt_path(root.resolve(), Path("..") / outside.name)


def test_completed_plan_receipt_is_compatibly_normalized_only_when_fully_valid(tmp_path: Path) -> None:
    module = load()
    config = module.load_manifest(manifest(tmp_path))
    config["allow_pro"] = True
    output = tmp_path / "plan-output.md"
    next_mission = tmp_path / "pro-next.md"
    output.write_text("plan", encoding="utf-8")
    next_mission.write_text("pro", encoding="utf-8")
    receipt_path = tmp_path / "stage-result.json"
    receipt = {
        "schema": module.RECEIPT_SCHEMA,
        "workflow_id": "a" * 32,
        "stage": "plan",
        "attempt_id": "b" * 32,
        "input_mission_sha256": "c" * 64,
        "status": "completed",
        "output_path": str(output),
        "output_sha256": module.sha(output),
        "next_stage": "pro",
        "next_mission_path": str(next_mission),
        "next_mission_sha256": module.sha(next_mission),
        "ready_for_next": True,
        "blocker": "",
    }
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
    value = module._validate_receipt(
        config, receipt_path, "a" * 32, "plan", "b" * 32, "c" * 64
    )
    assert value["_receipt_status_original"] == "completed"
    assert value["_receipt_status_normalized"] == "PLAN_READY"
    assert value["_next_mission"] == next_mission.resolve()

    receipt["next_mission_sha256"] = "0" * 64
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
    with pytest.raises(module.WorkflowError, match="next mission hash mismatch"):
        module._validate_receipt(config, receipt_path, "a" * 32, "plan", "b" * 32, "c" * 64)


def test_regular_stage_rejects_pro_attachment_contract_before_submission(tmp_path: Path) -> None:
    module = load()
    workflow = manifest(tmp_path)
    config = module.load_manifest(workflow)
    config["initial_mission_path"].write_text(
        "regular plan\n[PRO_ATTACHMENT_CONTRACT]\n{}\n[/PRO_ATTACHMENT_CONTRACT]\n",
        encoding="utf-8",
    )
    payload = json.loads(workflow.read_text(encoding="utf-8"))
    payload["initial_mission_path"] = str(config["initial_mission_path"])
    workflow.write_text(json.dumps(payload), encoding="utf-8")
    calls = 0

    def never_submit(*args, **kwargs):
        nonlocal calls
        calls += 1
        raise AssertionError("regular stage contract must fail before submission")

    with pytest.raises(module.WorkflowError, match="forbidden for regular DevSpace stages"):
        module.run_workflow(workflow, oracle_execute=never_submit)
    assert calls == 0


def _pro_envelope(module, *, workflow_id: str = "a" * 32, output_text: str = "decision") -> dict[str, object]:
    return {
        "schema": module.PRO_OUTPUT_SCHEMA,
        "workflow_id": workflow_id,
        "stage": "pro",
        "attempt_id": "b" * 32,
        "input_mission_sha256": "c" * 64,
        "status": "PASS",
        "output_text": output_text,
        "next_stage": "review",
        "next_mission_text": "Review the exact Pro decision.",
        "ready_for_next": True,
        "blocker": "",
    }


def _malformed_pro_output(module, *, workflow_id: str = "a" * 32, truncated: bool = False) -> str:
    value = _pro_envelope(module, workflow_id=workflow_id)
    prefix = {
        key: value[key]
        for key in module.PRO_OUTPUT_PREFIX_KEYS
    }
    serialized = json.dumps(prefix, ensure_ascii=False, separators=(",", ":"))
    nested = 'Decision body\\n\\n{\\n  "schema": "nested/v1",\\n  "verdict": "PASS"\\n}'
    tail = (
        ',"next_stage":"review","next_mission_text":"Review the exact Pro decision.",'
        '"ready_for_next":true,"blocker":""}'
    )
    text = serialized[:-1] + ',"output_text":"' + nested + '"' + tail
    return text[:-24] if truncated else text


def test_malformed_nested_json_in_pro_output_is_recovered_with_audit_receipt(tmp_path: Path) -> None:
    module = load()
    config = module.load_manifest(manifest(tmp_path))
    stage_dir = tmp_path / "pro-stage"
    stage_dir.mkdir()
    output = stage_dir / "oracle-output.md"
    output.write_text(_malformed_pro_output(module), encoding="utf-8")
    receipt = stage_dir / "stage-result.json"
    module._materialize_pro_receipt(
        config,
        receipt,
        "a" * 32,
        "b" * 32,
        "c" * 64,
        {"output_path": str(output)},
    )
    value = json.loads(receipt.read_text(encoding="utf-8"))
    recovered = value["pro_output_recovery"]
    assert recovered["schema"] == module.PRO_OUTPUT_RECOVERY_SCHEMA
    assert recovered["source_output_sha256"] == module.sha(output)
    assert recovered["strict_error_position"] > 0
    assert '"schema": "nested/v1"' in Path(value["output_path"]).read_text(encoding="utf-8")


def test_malformed_pro_output_recovery_rejects_identity_mismatch(tmp_path: Path) -> None:
    module = load()
    config = module.load_manifest(manifest(tmp_path))
    output = tmp_path / "oracle-output.md"
    output.write_text(_malformed_pro_output(module, workflow_id="d" * 32), encoding="utf-8")
    receipt = tmp_path / "stage-result.json"
    with pytest.raises(module.WorkflowError, match="identity mismatch"):
        module._materialize_pro_receipt(
            config, receipt, "a" * 32, "b" * 32, "c" * 64, {"output_path": str(output)}
        )
    assert not receipt.exists()


def test_truncated_malformed_pro_output_remains_fail_closed(tmp_path: Path) -> None:
    module = load()
    output = tmp_path / "oracle-output.md"
    output.write_text(_malformed_pro_output(module, truncated=True), encoding="utf-8")
    with pytest.raises(module.WorkflowError, match="ambiguous|incomplete"):
        module._load_pro_envelope(output)


def test_strict_pro_output_uses_original_parser_without_recovery_metadata(tmp_path: Path) -> None:
    module = load()
    config = module.load_manifest(manifest(tmp_path))
    stage_dir = tmp_path / "strict-pro"
    stage_dir.mkdir()
    output = stage_dir / "oracle-output.md"
    output.write_text(json.dumps(_pro_envelope(module), ensure_ascii=False), encoding="utf-8")
    receipt = stage_dir / "stage-result.json"
    module._materialize_pro_receipt(
        config, receipt, "a" * 32, "b" * 32, "c" * 64, {"output_path": str(output)}
    )
    value = json.loads(receipt.read_text(encoding="utf-8"))
    assert "pro_output_recovery" not in value
    assert value["status"] == "PASS"


def test_web_multi_preflight_failure_stays_prepared_and_rejects_changed_mission(tmp_path: Path) -> None:
    module = load()
    workflow_path = manifest(tmp_path)
    invalid_multi = tmp_path / "multi.json"
    invalid_multi.write_text(json.dumps({"next_stage_binding": {"workflow_id": "wrong", "stage": "web-multi"}}), encoding="utf-8")

    def fake_plan(oracle_manifest: Path, *, dry_run: bool):
        payload = json.loads(oracle_manifest.read_text(encoding="utf-8"))
        mission = Path(payload["mission_path"])
        text = mission.read_text(encoding="utf-8")
        assert "stage=plan\n" in text
        attempt = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("attempt_id="))
        input_sha = next(line.split("=", 1)[1] for line in text.splitlines() if line.startswith("input_mission_sha256="))
        output = mission.parent / "plan-out.md"
        output.write_text("plan", encoding="utf-8")
        (mission.parent / "stage-result.json").write_text(json.dumps({
            "schema": module.RECEIPT_SCHEMA, "workflow_id": "a" * 32, "stage": "plan",
            "attempt_id": attempt, "input_mission_sha256": input_sha, "status": "PASS",
            "output_path": str(output), "output_sha256": module.sha(output), "next_stage": "web-multi",
            "next_mission_path": str(invalid_multi), "next_mission_sha256": module.sha(invalid_multi),
            "ready_for_next": True, "blocker": "",
        }), encoding="utf-8")
        return {"ok": True, "run_dir": str(mission.parent / "run")}

    with pytest.raises(module.MULTI.MultiError):
        module.run_workflow(workflow_path, oracle_execute=fake_plan)
    config = module.load_manifest(workflow_path)
    stored = module._json(module._state_path(config, "a" * 32))
    assert stored["status"] == "prepared"
    assert stored["next_stage"] == "web-multi"
    assert "multi_execution_id" not in stored

    lane_one = tmp_path / "one.md"
    lane_two = tmp_path / "two.md"
    merger = tmp_path / "merger.md"
    for path in (lane_one, lane_two, merger):
        path.write_text(path.stem, encoding="utf-8")
    invalid_multi.write_text(json.dumps({
        "schema": module.MULTI.SCHEMA, "project_root": str(tmp_path),
        "output_dir": str(tmp_path / "multi-output"),
        "solvers": [{"id": "one", "mission_path": str(lane_one)}, {"id": "two", "mission_path": str(lane_two)}],
        "merger_mission_path": str(merger),
        "next_stage_binding": {"workflow_id": "a" * 32, "stage": "web-multi"},
    }), encoding="utf-8")
    calls = 0

    def fake_multi(path: Path, *, dry_run: bool, parent_lock_held: bool):
        nonlocal calls
        calls += 1
        return {"ok": False, "parent_id": "d" * 64}

    with pytest.raises(module.WorkflowError, match="prepared next mission changed"):
        module.run_workflow(workflow_path, oracle_execute=fake_plan, multi_execute=fake_multi)
    assert calls == 0


def test_stage_contract_preserves_upstream_input_mission_hash_semantics(tmp_path: Path) -> None:
    module = load()
    path = manifest(tmp_path)
    config = module.load_manifest(path)
    source = config["initial_mission_path"]
    mission, _, input_sha = module._stage_mission(
        config,
        config["workflow_id"],
        0,
        "plan",
        source,
        "b" * 32,
    )
    text = mission.read_text(encoding="utf-8")

    assert input_sha == module.sha(source)
    assert f"input_mission_sha256={input_sha}" in text
    assert "binds the upstream source mission bytes" in text
    assert "do not replace it with a hash of this augmented mission.md" in text


def test_receipt_accepts_legacy_schema_version_but_keeps_upstream_hash_binding(tmp_path: Path) -> None:
    module = load()
    path = manifest(tmp_path)
    config = module.load_manifest(path)
    source = config["initial_mission_path"]
    mission, receipt_path, input_sha = module._stage_mission(
        config, config["workflow_id"], 0, "plan", source, "b" * 32
    )
    output = config["project_root"] / "plan.md"
    output.write_text("plan", encoding="utf-8")
    next_mission = config["project_root"] / "review.md"
    next_mission.write_text("review", encoding="utf-8")
    receipt_path.write_text(json.dumps({
        "schema_version": module.RECEIPT_SCHEMA,
        "workflow_id": config["workflow_id"],
        "stage": "plan",
        "attempt_id": "b" * 32,
        "input_mission_sha256": input_sha,
        "status": "PLAN_READY",
        "output_path": str(output),
        "output_sha256": module.sha(output),
        "next_stage": "review",
        "next_mission_path": str(next_mission),
        "next_mission_sha256": module.sha(next_mission),
        "ready_for_next": True,
        "blocker": None,
    }), encoding="utf-8")

    receipt = module._validate_receipt(
        config, receipt_path, config["workflow_id"], "plan", "b" * 32, input_sha
    )
    assert receipt["_next_mission"] == next_mission

    value = json.loads(receipt_path.read_text(encoding="utf-8"))
    value["input_mission_sha256"] = module.sha(mission)
    receipt_path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(module.WorkflowError, match="stage receipt identity mismatch"):
        module._validate_receipt(
            config, receipt_path, config["workflow_id"], "plan", "b" * 32, input_sha
        )


def test_receipt_rejects_conflicting_schema_aliases(tmp_path: Path) -> None:
    module = load()
    path = manifest(tmp_path)
    config = module.load_manifest(path)
    receipt = config["project_root"] / "stage-result.json"
    receipt.write_text(json.dumps({
        "schema": module.RECEIPT_SCHEMA,
        "schema_version": "different",
    }), encoding="utf-8")
    with pytest.raises(module.WorkflowError, match="schema keys conflict"):
        module._validate_receipt(
            config, receipt, config["workflow_id"], "plan", "b" * 32, "c" * 64
        )

    receipt.write_text(json.dumps({
        "schema": None,
        "schema_version": module.RECEIPT_SCHEMA,
    }), encoding="utf-8")
    with pytest.raises(module.WorkflowError, match="schema keys conflict"):
        module._validate_receipt(
            config, receipt, config["workflow_id"], "plan", "b" * 32, "c" * 64
        )


def test_awaiting_receipt_preserves_source_and_augmented_mission_bindings(tmp_path: Path) -> None:
    module = load()
    path = manifest(tmp_path)

    def fake_oracle(oracle_manifest: Path, *, dry_run: bool):
        data = json.loads(oracle_manifest.read_text(encoding="utf-8"))
        mission = Path(data["mission_path"])
        contract = mission.read_text(encoding="utf-8")
        receipt_path = Path(next(
            line.split(": ", 1)[1]
            for line in contract.splitlines()
            if line.startswith("Write the small UTF-8 stage receipt to: ")
        ))
        return {"ok": True, "run_dir": str(receipt_path.parent / "oracle-run")}

    result = module.run_workflow(path, oracle_execute=fake_oracle)
    assert result["status"] == "awaiting_receipt"
    source = Path(result["current_binding_source_path"])
    augmented = Path(result["current_augmented_mission_path"])
    assert result["current_binding_source_sha256"] == module.sha(source)
    assert result["current_augmented_mission_sha256"] == module.sha(augmented)
    assert result["current_binding_source_sha256"] != result["current_augmented_mission_sha256"]
