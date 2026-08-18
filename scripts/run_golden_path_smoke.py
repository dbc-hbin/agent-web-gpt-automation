#!/usr/bin/env python
"""Golden-path smoke for the installed Oracle + DevSpace deployment.

Historically a broken launch contract, model label, profile-copy dependency, or
app-mention rule was only discovered by a real 40-minute web run.  This smoke
exercises the same code path end to end - mode contract, manifest compilation,
manifest loading, compatibility identity, and the exact Oracle argv - without
submitting a question or touching a browser, so those regressions surface in
seconds.

Use `--check-installed` to verify the deployed copy under the selected agent
home instead of the source tree.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

SOURCE_BIN = Path(__file__).resolve().parents[1] / "bin"
if str(SOURCE_BIN) not in sys.path:
    sys.path.insert(0, str(SOURCE_BIN))

from agent_web_gpt_paths import resolve_home


def _load(name: str, path: Path):
    if str(path.parent) not in sys.path:
        sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"module unavailable: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def installed_bin() -> Path:
    return resolve_home() / "bin"


def run_smoke(*, bin_root: Path) -> dict[str, Any]:
    """Drive one deterministic regular-GPT dispatch without submitting it."""
    dispatch = _load("golden_path_dispatch", bin_root / "chatgpt_oracle_dispatch.py")
    runner = dispatch.RUNNER
    state = runner.STATE
    checks: list[dict[str, Any]] = []

    def record(name: str, ok: bool, detail: Any = None) -> None:
        checks.append({"check": name, "ok": bool(ok), "detail": detail})

    with tempfile.TemporaryDirectory(prefix="codex-oracle-golden-path-") as workspace:
        base = Path(workspace)
        project = base / "project"
        project.mkdir()
        mission = project / "mission.md"
        mission.write_text("Golden path smoke mission. Do nothing.\n", encoding="utf-8")
        host_state = base / "host-state"
        os.environ["AGENT_WEB_GPT_ORACLE_STATE_ROOT"] = str(host_state.resolve())
        # This smoke compiles a no-submission dry run. Listener reachability is
        # covered separately; requiring a developer-local port would make the
        # portable CI smoke environment-dependent.
        os.environ["AGENT_WEB_GPT_DEVSPACE_PROBE_DISABLED"] = "1"

        compiled = dispatch.compile_manifest(
            mode="direct",
            project_root=project,
            mission_path=mission,
            output_path=base / "oracle.json",
        )
        manifest_path = Path(str(compiled["oracle_manifest_path"]))
        record("mode_contract_compiles", bool(compiled.get("ok")) and manifest_path.is_file())

        config = state.load_manifest(manifest_path)
        record("manifest_loads", True, {"transport": config.transport, "app_name": config.app_name})
        record("devspace_transport_selected", config.transport == "devspace" and bool(config.app_name))

        prompt = state.composer_prompt(config) if hasattr(state, "composer_prompt") else None
        if prompt is None:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            prompt = f"@{payload['app_name']} {payload['mission_path']}"
        record(
            "prompt_is_one_line_with_app_mention",
            "\n" not in prompt and f"@{config.app_name}" in prompt and str(mission.resolve()) in prompt,
        )

        preview = runner.execute_run(manifest_path, dry_run=True)
        argv = [str(item) for item in (preview.get("argv") or [])]
        record("dry_run_preview_ok", bool(preview.get("ok")), {"argv_length": len(argv)})
        record("argv_never_submits_files", "--file" not in argv)
        record("argv_hides_browser_window", argv.count("--browser-hide-window") == 1)
        record("argv_selects_a_model", "--model" in argv and "--browser-model-strategy" in argv)
        record("argv_requests_extra_high_thinking", "extra-high" in argv)
        profile_copy_supported = state.profile_copy_is_supported()
        record(
            "profile_copy_matches_host_capability",
            ("--copy-profile" in argv) == bool(profile_copy_supported and config.copy_profile is not None),
            {"host_supports_copy": bool(profile_copy_supported)},
        )
        record("lifecycle_vocabulary_is_bounded", len(state.LIFECYCLE_STATES) == 4)

    ok = all(item["ok"] for item in checks)
    return {
        "schema": "codex.chatgpt.oracle-golden-path/v1",
        "ok": ok,
        "bin_root": str(bin_root),
        "submitted_question": False,
        "checks": checks,
        "failed_checks": [item["check"] for item in checks if not item["ok"]],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the no-submission Oracle golden-path smoke.")
    parser.add_argument("--check-installed", action="store_true")
    args = parser.parse_args(argv)
    bin_root = installed_bin() if args.check_installed else SOURCE_BIN
    try:
        result = run_smoke(bin_root=bin_root)
    except Exception as exc:  # noqa: BLE001 - the smoke must report, not traceback
        result = {
            "schema": "codex.chatgpt.oracle-golden-path/v1",
            "ok": False,
            "bin_root": str(bin_root),
            "submitted_question": False,
            "error": {"type": type(exc).__name__, "message": str(exc)},
        }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
