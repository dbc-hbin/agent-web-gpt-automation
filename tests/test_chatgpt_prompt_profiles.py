from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "bin" / "chatgpt_prompt_profiles.py"
SPEC = importlib.util.spec_from_file_location("chatgpt_prompt_profiles_test", PATH)
assert SPEC and SPEC.loader
PROFILES = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PROFILES
SPEC.loader.exec_module(PROFILES)


def test_unknown_explicit_profile_fails_but_unclassified_language_is_safe_answer() -> None:
    with pytest.raises(PROFILES.PromptProfileError, match="PROMPT_PROFILE_UNKNOWN"):
        PROFILES.resolve_profile("advisory")
    fallback = PROFILES.resolve_profile("advisory", explicit=False)
    assert fallback.name == "answer"
    assert fallback.challenge_policy == "calibrated"
    assert fallback.action_authority == "read-only"


def test_read_only_and_research_do_not_collapse_to_review() -> None:
    assert PROFILES.resolve_profile("research").task_kind == "research"
    assert PROFILES.resolve_profile("plan").task_kind == "planning"
    assert PROFILES.resolve_profile("answer").name != "review"


def test_only_review_profiles_receive_adversarial_contract() -> None:
    review = PROFILES.render_prompt(
        "review", original_task="task", stage_mission="review", output_instructions="result"
    )
    judge = PROFILES.render_prompt(
        "web-rubric-judge", original_task="task", stage_mission="judge", output_instructions="result"
    )
    plan = PROFILES.render_prompt(
        "plan", original_task="task", stage_mission="plan", output_instructions="result"
    )
    solver = PROFILES.render_prompt(
        "web-proposal-builder", original_task="task", stage_mission="solve", output_instructions="result"
    )
    assert "strongest material objection" in review
    assert "strongest material objection" in judge
    assert "strongest material objection" not in plan
    assert "strongest material objection" not in solver
    assert "Do not turn construction" in plan


def test_orchestrator_profile_owns_adaptation_without_release_authority() -> None:
    receipt = PROFILES.resolve_profile("orchestrator").receipt()
    assert receipt["architecture"] == "codex.chatgpt.prompt-architecture/v3"
    assert receipt["action_authority"] == "workspace-write"
    assert receipt["context_policy"] == "execution-mission-live-workspace-plan-as-guide"

    prompt = PROFILES.render_prompt(
        "orchestrator",
        original_task="implement the task",
        stage_mission="execute",
        output_instructions="report",
    )
    assert "[EXECUTION OWNERSHIP]" in prompt
    assert "internal lanes or parallel tool calls inside this single ExecutionMission" in prompt
    assert "Same-project web submissions remain serialized" in prompt
    assert "Never return delegated implementation to the local host agent" in prompt


def test_regular_reasoning_selection_chooses_strongest_and_fails_closed(monkeypatch) -> None:
    monkeypatch.setenv("CODEX_CHATGPT_REGULAR_MODE_CAPABILITIES", "High,Very High")
    selection = PROFILES.resolve_regular_mode_selection()
    assert selection["selected_mode_variant"] == "Very High"
    assert selection["available_regular_reasoning"] == ["Very High", "High"]

    monkeypatch.setenv("CODEX_CHATGPT_REGULAR_MODE_CAPABILITIES", "")
    with pytest.raises(PROFILES.PromptProfileError, match="REGULAR_MODE_UNAVAILABLE"):
        PROFILES.resolve_regular_mode_selection()


def test_regular_reasoning_selection_defaults_to_guaranteed_high(monkeypatch) -> None:
    monkeypatch.delenv("CODEX_CHATGPT_REGULAR_MODE_CAPABILITIES", raising=False)

    selection = PROFILES.resolve_regular_mode_selection()

    assert selection["selected_mode_variant"] == "High"
    assert selection["available_regular_reasoning"] == ["High"]
