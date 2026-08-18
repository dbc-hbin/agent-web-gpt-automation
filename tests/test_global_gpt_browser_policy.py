from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MULTI = ROOT / 'skills' / 'web-multi-gpt' / 'SKILL.md'
ORACLE = ROOT / 'skills' / 'chatgpt-oracle-runtime' / 'SKILL.md'
DESIGNER = ROOT / 'skills' / 'chatgpt-question-designer' / 'SKILL.md'
SETUP = ROOT / 'skills' / 'chatgpt-workspace-setup' / 'SKILL.md'
ULTRA = ROOT / 'skills' / 'ultra-economy-mode' / 'SKILL.md'


def text(path: Path) -> str:
    return path.read_text(encoding='utf-8')


def test_oracle_runtime_routes_to_oracle_devspace() -> None:
    value = text(ORACLE)
    assert 'chatgpt_oracle_dispatch.py' in value
    assert 'DevSpace' in value
    assert 'TASK_OUTCOME: EXECUTED' in value


def test_web_multi_is_genuine_sessions_with_wave_cap_and_worktrees() -> None:
    value = text(MULTI)
    assert 'chatgpt_oracle_multi.py' in value
    assert 'waves of at most five' in value
    assert 'worktree-write' in value
    assert 'distinct pre-created worktree' in value
    assert 'single-GPT role simulation' in value


def test_host_control_state_is_outside_devspace_project() -> None:
    value = text(ORACLE)
    assert '%AGENT_WEB_GPT_HOME%\\state\\chatgpt-oracle' in value
    source = text(ROOT / 'bin' / 'chatgpt_oracle_state.py')
    assert 'HOST_STATE_OVERLAPS_PROJECT' in source


def test_oracle_recovery_is_exact_slug_no_restart_and_monotonic() -> None:
    runtime = text(ORACLE)
    assert '`recovery_binding_unavailable`' in runtime
    assert 'restore the\nexact persisted conversation URL' in runtime


def test_install_inventory_contains_new_active_runtime() -> None:
    manifest = json.loads((ROOT / 'install-manifest.json').read_text(encoding='utf-8'))
    include = set(manifest['include'])
    for path in (
        'bin/chatgpt_oracle_dispatch.py',
        'bin/chatgpt_oracle_multi.py',
        'bin/chatgpt_oracle_comprehensive.py',
        'bin/devspace-compat/1.0.4/directory-read.patch',
        'skills/chatgpt-workspace-setup/SKILL.md',
    ):
        assert path in include
    assert manifest['routing'] == {
        'new_work_engine': 'oracle',
        'regular_workspace_transport': 'devspace',
        'pro_transport': 'oracle-devspace-readwrite-explicit',
        'pro_attachment_transport': 'oracle-attachment-only-explicit',
    }
    assert manifest['external']['oracle']['license'] == 'MIT'
    assert manifest['external']['devspace']['license'] == 'MIT'


def test_no_skill_routes_to_chrome_playwright_or_in_app_fallback() -> None:
    combined = '\n'.join(text(path) for path in (ORACLE, MULTI, DESIGNER, SETUP, ULTRA)).casefold()
    assert 'never authorizes' in combined and 'playwright' in combined


def test_readme_declares_manual_one_time_registration_not_ui_automation() -> None:
    value = text(ROOT / 'README.md')
    assert '최초 한 번 수동 등록' in value
    assert 'ChatGPT 설정·앱 목록·권한·삭제·선택 UI를 자동화하지 않습니다' in value
    assert '실행 신원으로 정확히 복구' in value
    assert '최초 설치 가이드' in value
    assert 'ChatGPT 앱 `codex` 등록' in value


def test_english_readme_maps_modes_to_the_same_oracle_routes() -> None:
    value = text(ROOT / 'README.en.md')
    assert 'Oracle + DevSpace' in value
    assert '`orchestrator` / orchestrator' in value
    assert '`deep-research` / deep research' in value
    assert 'comprehensive mode' in value
    assert 'Web Multi-GPT' in value
    assert 'Pro is quota-limited, never auto-selected' in value
    assert 'Oracle + read/write DevSpace' in value
    assert 'never resubmits the task' in value


def test_agent_metadata_exposes_oracle_active_routes() -> None:
    multi = text(ROOT / 'skills' / 'web-multi-gpt' / 'agents' / 'openai.yaml')
    designer = text(ROOT / 'skills' / 'chatgpt-question-designer' / 'agents' / 'openai.yaml')
    assert 'parallel Oracle GPT sessions' in multi
    assert 'Oracle+DevSpace' in designer

