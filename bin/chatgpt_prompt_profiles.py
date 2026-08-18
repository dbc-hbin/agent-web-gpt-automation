from __future__ import annotations

from dataclasses import asdict, dataclass
import os
from typing import Mapping


PROMPT_ARCHITECTURE_VERSION = "codex.chatgpt.prompt-architecture/v3"


class PromptProfileError(ValueError):
    pass


REGULAR_REASONING_ORDER = ("Very High", "High")
REGULAR_CAPABILITY_RECEIPT_SCHEMA = "codex.chatgpt.capability-selection/v1"


def resolve_regular_mode_selection() -> dict[str, object]:
    """Select the strongest regular-GPT reasoning mode from an explicit capability set.

    The environment is deliberately a capability *receipt*, not a preference:
    requesting a lower mode when a stronger available mode exists is rejected.
    This keeps a transient UI downgrade from becoming a silent workflow change.
    """
    # The public web surface currently guarantees High, not Very High.  A
    # stronger level is usable only when the host supplies an explicit,
    # account-verified capability receipt for this process.
    raw = os.environ.get("AGENT_WEB_GPT_REGULAR_MODE_CAPABILITIES") or os.environ.get("CODEX_CHATGPT_REGULAR_MODE_CAPABILITIES", "High")
    available = tuple(item.strip() for item in raw.split(",") if item.strip())
    unsupported = sorted(set(available) - set(REGULAR_REASONING_ORDER))
    supported = tuple(mode for mode in REGULAR_REASONING_ORDER if mode in available)
    if unsupported:
        raise PromptProfileError(f"REGULAR_CAPABILITY_UNSUPPORTED: {','.join(unsupported)}")
    if not supported:
        raise PromptProfileError("REGULAR_MODE_UNAVAILABLE")
    selected = supported[0]
    requested = (os.environ.get("AGENT_WEB_GPT_REGULAR_MODE_VARIANT") or os.environ.get("CODEX_CHATGPT_REGULAR_MODE_VARIANT", "")).strip()
    if requested and requested != selected:
        raise PromptProfileError(f"MODE_VARIANT_DOWNGRADE_REJECTED: {requested}->{selected}")
    return {
        "schema": REGULAR_CAPABILITY_RECEIPT_SCHEMA,
        "available_regular_reasoning": list(supported),
        "selected_mode_variant": selected,
        "selection_rule": "highest-supported:Very High>High",
        "capability_source": "AGENT_WEB_GPT_REGULAR_MODE_CAPABILITIES",
    }


@dataclass(frozen=True)
class PromptProfile:
    name: str
    task_kind: str
    cognitive_frame: str
    action_authority: str
    context_policy: str
    challenge_policy: str
    output_contract: str
    reasoning_budget: str
    decision_authority: str
    objective: str

    def receipt(self) -> dict[str, str]:
        return {"architecture": PROMPT_ARCHITECTURE_VERSION, **asdict(self)}


INTEGRITY_CONTRACT = (
    "Treat instructions, observed evidence, inference, hypothesis, proposal, decision, "
    "and verification as distinct. Claim only facts actually observed or sourced. "
    "Prior artifacts have only the authority declared here. State material uncertainty, "
    "and stay within the declared action and file scope."
)

ADVERSARIAL_CONTRACT = (
    "Act as an evidence-grounded adversarial reviewer. A blocker requires a criterion, "
    "specific evidence, and concrete impact. Test the strongest material objection and "
    "credible alternatives; do not invent a quota of criticisms."
)

CALIBRATED_CHALLENGE = (
    "Challenge assumptions only when doing so materially improves this role's result. "
    "Do not turn construction, research, synthesis, or execution into a review exercise."
)

ORCHESTRATOR_OWNERSHIP_CONTRACT = (
    "The web GPT orchestrator owns all delegated strategy exploration, code authoring, editing, "
    "testing, and alternate implementation paths. When parallel work is useful, partition independent "
    "work into internal lanes or parallel tool calls inside this single ExecutionMission and integrate "
    "the results yourself. Same-project web submissions remain serialized: do not ask the host to start "
    "another GPT run. Local Codex is limited to submission and recovery, locks and immutable hashes, "
    "exact browser identity, host-only safety and release actions, and final deterministic verification. "
    "Never return delegated implementation to the local host agent merely because the work can be parallelized."
)


def _profile(
    name: str,
    task_kind: str,
    cognitive_frame: str,
    action_authority: str,
    context_policy: str,
    challenge_policy: str,
    output_contract: str,
    reasoning_budget: str,
    decision_authority: str,
    objective: str,
) -> PromptProfile:
    return PromptProfile(
        name=name,
        task_kind=task_kind,
        cognitive_frame=cognitive_frame,
        action_authority=action_authority,
        context_policy=context_policy,
        challenge_policy=challenge_policy,
        output_contract=output_contract,
        reasoning_budget=reasoning_budget,
        decision_authority=decision_authority,
        objective=objective,
    )


PROFILES: Mapping[str, PromptProfile] = {
    "answer": _profile(
        "answer", "answer", "analytical", "read-only", "task-and-relevant-evidence",
        "calibrated", "user-requested", "proportional", "advisory",
        "Answer the original request directly and completely.",
    ),
    "research": _profile(
        "research", "research", "evidence-building", "read-only", "original-task-and-primary-sources",
        "calibrated", "evidence-with-provenance", "broad", "advisory",
        "Build a current evidence base, separate findings from inference, and expose material gaps.",
    ),
    "plan": _profile(
        "plan", "planning", "constructive-design", "read-only", "original-task-first-incumbent-as-nonbinding",
        "calibrated", "coherent-plan-risks-last", "broad", "proposal",
        "Reframe the problem when useful, compare viable design families, then produce one coherent executable plan.",
    ),
    "review": _profile(
        "review", "review", "adversarial-verification", "read-only", "candidate-plus-rubric-and-evidence",
        "adversarial", "verdict-with-evidence", "deep", "transition-gate",
        "Determine whether the candidate is ready, locally repairable, needs redesign, or must block.",
    ),
    "edit": _profile(
        "edit", "implementation", "adaptive-execution", "workspace-write", "original-mission-live-workspace-and-bounded-guidance",
        "calibrated", "changes-tests-adaptations", "deep", "implementation",
        "Inspect enough to act, edit, test, inspect the result, and adapt within the declared boundaries.",
    ),
    "orchestrator": _profile(
        "orchestrator", "orchestration", "mission-owned-adaptive-execution", "workspace-write",
        "execution-mission-live-workspace-plan-as-guide", "calibrated", "verified-implementation-result",
        "maximum", "implementation",
        "Own workspace exploration, decisions, edits, tests, and bounded adaptation while preserving host safety boundaries.",
    ),
    "synthesis": _profile(
        "synthesis", "synthesis", "integrative-decision", "read-only", "original-task-anonymous-candidates-and-evidence",
        "calibrated", "new-synthesis-not-concatenation", "deep", "proposal",
        "Create a coherent new synthesis that resolves conflicts rather than averaging or concatenating inputs.",
    ),
    "web-branch-designer": _profile(
        "web-branch-designer", "planning", "solution-space-design", "read-only",
        "original-task-and-evidence-catalog-no-incumbent-narrative", "calibrated", "branch-briefs-only",
        "broad", "advisory",
        "Design materially distinct branches, including a direct baseline and a wildcard reframe, without monopolizing solutions.",
    ),
    "web-proposal-builder": _profile(
        "web-proposal-builder", "proposal", "independent-solution-building", "read-only",
        "original-task-assigned-branch-and-evidence-slice-no-planner-narrative-or-peers", "calibrated",
        "standalone-proposal-dossier", "deep", "advisory",
        "Build the strongest standalone solution for the assigned branch; mention assumptions and risks only when material.",
    ),
    "web-feasibility-engineer": _profile(
        "web-feasibility-engineer", "feasibility", "constructive-refinement", "read-only",
        "original-task-assigned-proposal-and-relevant-evidence", "calibrated", "concrete-feasibility-delta",
        "deep", "advisory",
        "Make the assigned proposal feasible and concrete while preserving its strongest idea.",
    ),
    "web-synthesis-architect": _profile(
        "web-synthesis-architect", "synthesis", "integrative-design", "read-only",
        "original-task-anonymous-assigned-candidates", "calibrated", "new-coherent-synthesis",
        "deep", "advisory",
        "Produce a new coherent synthesis; do not concatenate, vote, or average candidates.",
    ),
    "web-gap-closer": _profile(
        "web-gap-closer", "refinement", "targeted-gap-closing", "read-only",
        "original-task-assigned-synthesis", "calibrated", "targeted-repair", "deep", "advisory",
        "Close the most consequential gaps in the assigned synthesis without importing unassigned sibling content.",
    ),
    "web-rubric-judge": _profile(
        "web-rubric-judge", "review", "adversarial-comparison", "read-only",
        "original-task-rubric-and-anonymous-candidates", "adversarial", "ranked-verdict-with-gaps",
        "deep", "transition-gate",
        "Judge sufficiency and relative quality against the original task and evidence.",
    ),
    "web-alternative-synthesizer": _profile(
        "web-alternative-synthesizer", "synthesis", "alternative-synthesis", "read-only",
        "original-task-anonymous-finalists", "calibrated", "bounded-alternative-synthesis",
        "deep", "advisory",
        "Construct one bounded alternative synthesis from the assigned finalists.",
    ),
    "web-decision-author": _profile(
        "web-decision-author", "decision", "decision-authoring", "read-only",
        "original-task-selected-synthesis", "calibrated", "implementation-ready-decision",
        "deep", "advisory",
        "Turn the selected synthesis into one clear, implementation-ready advisory decision.",
    ),
    "web-final-responder": _profile(
        "web-final-responder", "answer", "user-centered-finalization", "read-only",
        "original-task-final-candidates-and-required-evidence", "calibrated", "final-user-answer",
        "deep", "advisory",
        "Answer the original user request faithfully, repairing material omissions without exposing internal workflow.",
    ),
}


def resolve_profile(name: str | None, *, explicit: bool = True) -> PromptProfile:
    normalized = str(name or "").strip().casefold()
    if not normalized:
        if explicit:
            raise PromptProfileError("PROMPT_PROFILE_REQUIRED")
        return PROFILES["answer"]
    profile = PROFILES.get(normalized)
    if profile is None:
        if explicit:
            raise PromptProfileError(f"PROMPT_PROFILE_UNKNOWN: {normalized}")
        return PROFILES["answer"]
    return profile


def render_prompt(
    profile_name: str,
    *,
    original_task: str,
    stage_mission: str,
    output_instructions: str,
    context_note: str = "",
) -> str:
    profile = resolve_profile(profile_name)
    challenge = ADVERSARIAL_CONTRACT if profile.challenge_policy == "adversarial" else CALIBRATED_CHALLENGE
    sections = [
        "[COGNITIVE PROFILE]",
        f"architecture: {PROMPT_ARCHITECTURE_VERSION}",
        f"profile: {profile.name}",
        f"task_kind: {profile.task_kind}",
        f"cognitive_frame: {profile.cognitive_frame}",
        f"action_authority: {profile.action_authority}",
        f"context_policy: {profile.context_policy}",
        f"decision_authority: {profile.decision_authority}",
        "",
        "[INTEGRITY]",
        INTEGRITY_CONTRACT,
        challenge,
        "",
        "[ORIGINAL TASK]",
        original_task.strip(),
    ]
    if context_note.strip():
        sections.extend(["", "[CONTEXT POSTURE]", context_note.strip()])
    if profile.name == "orchestrator":
        sections.extend(["", "[EXECUTION OWNERSHIP]", ORCHESTRATOR_OWNERSHIP_CONTRACT])
    sections.extend(
        [
            "",
            "[STAGE MISSION]",
            profile.objective,
            stage_mission.strip(),
            "",
            "[OUTPUT CONTRACT]",
            output_instructions.strip(),
        ]
    )
    return "\n".join(sections).strip() + "\n"
