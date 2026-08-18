import json
from pathlib import Path

ROOT = Path(__file__).parents[1]

RETIRED_PATHS = {
    'bin/chatgpt_browser_runtime.py',
    'bin/chatgpt_browser_runtime_server.py',
    'bin/chatgpt_browser_runtime_worker.py',
    'bin/chatgpt_agbrowse_bridge.py',
    'bin/chatgpt_agbrowse_run.py',
    'bin/codexpro_harness.py',
    'skills/chatgpt-pro-browser/SKILL.md',
    'skills/chatgpt-thinking-browser/SKILL.md',
    'skills/chatgpt-pro-plan-handoff/SKILL.md',
    'update.ps1',
}

def test_manifest_covers_runtime_and_schemas() -> None:
    manifest = json.loads((ROOT / 'install-manifest.json').read_text(encoding='utf-8'))
    assert manifest['schema'] == 'codexpro.install-manifest/v1'
    includes = set(manifest['include'])
    required = {
        'bin/chatgpt_oracle_run.py',
        'bin/chatgpt_oracle_state.py',
        'bin/chatgpt_oracle_dispatch.py',
        'bin/chatgpt_oracle_multi.py',
        'bin/chatgpt_oracle_comprehensive.py',
        'bin/agent_web_gpt_lifecycle.py',
        'bin/agent_web_gpt_onboarding.py',
        'docs/FIRST_INSTALL.md',
        'docs/ULTRA_ECONOMY_MODE.md',
        'skills/ultra-economy-mode/SKILL.md',
        'skills/ultra-economy-mode/agents/openai.yaml',
        'skills/chatgpt-oracle-runtime/SKILL.md',
        'skills/web-multi-gpt/SKILL.md',
        'contracts/install/*.json',
    }
    assert required <= includes
    package_files = set(json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['files'])
    assert {
        'README.md',
        'README.en.md',
        'CONTRIBUTING.md',
        'docs/',
        'bin/chatgpt_oracle_run.py',
        'bin/chatgpt_devspace_preflight.py',
        'bin/chatgpt_workspace_config.py',
        'bin/agent_web_gpt_lifecycle.py',
        'scripts/start_devspace_bootstrap.ps1',
        'install.py',
        'doctor.py',
        'onboard.py',
    } <= package_files

def test_public_install_and_npm_surface_exclude_legacy_browser_engines() -> None:
    manifest = json.loads((ROOT / 'install-manifest.json').read_text(encoding='utf-8'))
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    install_paths = set(manifest['include'])
    package_paths = set(package['files'])
    assert RETIRED_PATHS.isdisjoint(install_paths)
    assert RETIRED_PATHS.isdisjoint(package_paths)

def test_retired_automation_surface_is_absent_from_repository() -> None:
    assert not [path for path in RETIRED_PATHS if (ROOT / path).exists()]
    assert not (ROOT / 'bin/oracle-compat/0.16.1').exists()

def test_public_notices_and_no_vendoring() -> None:
    assert 'Copyright (c) 2026 dbc-hbin' in (ROOT / 'LICENSE').read_text(encoding='utf-8')
    notice = (ROOT / 'THIRD_PARTY_NOTICES.md').read_text(encoding='utf-8')
    assert '@steipete/oracle' in notice and '@waishnav/devspace' in notice
    assert not any((ROOT / name).exists() for name in ('node_modules', 'agbrowse', 'browser'))

def test_package_is_publishable_and_lockfile_matches() -> None:
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    lock = json.loads((ROOT / 'package-lock.json').read_text(encoding='utf-8'))
    assert package['private'] is False
    assert package['name'] == lock['name'] == lock['packages']['']['name']
    assert package['version'] == lock['version'] == lock['packages']['']['version']
    assert package['license'] == lock['packages']['']['license'] == 'MIT'
    assert package['repository']['url'] == 'git+https://github.com/dbc-hbin/agent-web-gpt-automation.git'
    assert package['homepage'].startswith('https://github.com/dbc-hbin/agent-web-gpt-automation')
    assert {
        'bin/chatgpt_oracle_run.py',
        'skills/chatgpt-oracle-runtime/SKILL.md',
        'install.ps1',
        'LICENSE',
        'scripts/run_fast_gate.py',
        'scripts/check_docs.py',
        'contracts/install/',
    } <= set(package['files'])

def test_release_workflow_installs_pytest_and_runs_checks() -> None:
    workflow = (ROOT / '.github/workflows/release-portability.yml').read_text(encoding='utf-8')
    assert 'python -m pip install "pytest>=8,<10"' in workflow
    assert 'python scripts/run_fast_gate.py --enforce-budget' in workflow
    assert 'pytest' in workflow
    assert 'windows-latest' in workflow
    assert 'macos-14' in workflow

def test_rebrand_and_package_metadata() -> None:
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    assert package['name'] == 'agent-web-gpt-automation'
    assert 'dbc-hbin' in package['repository']['url']
