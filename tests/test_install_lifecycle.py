import json
from pathlib import Path
import subprocess
import shutil
import tempfile

import pytest

ROOT = Path(__file__).parents[1]


def run_powershell(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    if shutil.which("powershell") is None:
        pytest.skip("PowerShell lifecycle compatibility runs on Windows")
    return subprocess.run(
        ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', *args],
        text=True,
        encoding='utf-8',
        errors='replace',
        capture_output=True,
        env=env,
    )

def test_lifecycle_scripts_share_manifest_and_support_whatif() -> None:
    for name in ('install.ps1', 'doctor.ps1', 'uninstall.ps1', 'rollback.ps1'):
        text = (ROOT / name).read_text(encoding='utf-8')
        assert 'WhatIf' in text or 'SupportsShouldProcess' in text
    assert 'install-manifest.json' in (ROOT / 'install.ps1').read_text(encoding='utf-8')
    assert 'Get-ManifestFiles' in (ROOT / 'install.ps1').read_text(encoding='utf-8')
    assert 'git ' not in (ROOT / 'install.ps1').read_text(encoding='utf-8').lower()


def test_public_lifecycle_home_contract_is_agent_neutral() -> None:
    for name in ('install.ps1', 'doctor.ps1', 'uninstall.ps1', 'rollback.ps1'):
        text = (ROOT / name).read_text(encoding='utf-8')
        assert '$AgentHome' in text
        assert 'AGENT_WEB_GPT_HOME' in text
        assert "Alias('CodexHome')" not in text
        assert '-CodexHome' not in text
    lifecycle = (ROOT / 'bin' / 'agent_web_gpt_lifecycle.py').read_text(encoding='utf-8')
    assert '"--agent-home"' in lifecycle
    assert 'value.add_argument("--codex-home"' not in lifecycle
    bootstrap = (ROOT / 'scripts' / 'start_devspace_bootstrap.ps1').read_text(encoding='utf-8')
    assert '$AgentHome' in bootstrap
    assert '-CodexHome' not in bootstrap


def test_public_file_hash_helpers_are_dotnet_stream_based() -> None:
    for name in ('install.ps1', 'rollback.ps1', 'doctor.ps1'):
        text = (ROOT / name).read_text(encoding='utf-8')
        assert 'Get-FileHash' not in text
        assert '[IO.File]::Open' in text
        assert '[Security.Cryptography.SHA256]::Create()' in text
        assert '.Dispose()' in text
        assert '.ToLowerInvariant()' in text

def test_update_is_explicit_not_scheduled() -> None:
    workflows = list((ROOT / '.github/workflows').glob('*'))
    assert workflows
    assert all('schedule' not in path.read_text(encoding='utf-8').lower() for path in workflows)

def test_installer_wal_records_actual_per_file_transition_order() -> None:
    with tempfile.TemporaryDirectory() as home:
        installed = run_powershell(
            '-File', str(ROOT / 'install.ps1'), '-AgentHome', home,
        )
        assert installed.returncode == 0, installed.stderr
        receipt = json.loads(next((Path(home) / 'receipts').glob('codexpro-automation-*.json')).read_text(encoding='utf-8-sig'))
        wal = json.loads(Path(receipt['wal']).read_text(encoding='utf-8'))
        assert wal['schema'] == 'codexpro.install-wal/v1'
        assert wal['status'] == 'COMPLETE'
        assert wal['files']
        for index, entry in enumerate(wal['files']):
            assert entry['phase'] == 'COMPLETE'
            assert entry['transitions'] == ['INTENT', 'MUTATED', 'VERIFIED', 'COMPLETE']
            replacement = Path(entry['replacement'])
            assert replacement.name == 'replacement.json'
            assert replacement.parent.name == str(index)
            assert replacement.is_file()


def test_interrupted_install_recovery_rolls_back_completed_steps_and_preserves_unmutated_intent() -> None:
    with tempfile.TemporaryDirectory() as home:
        codex_home = Path(home)
        backup_root = codex_home / 'backups' / 'interrupted'
        completed_path = codex_home / 'bin' / 'completed.py'
        intent_path = codex_home / 'bin' / 'intent.py'
        completed_backup = backup_root / 'bin' / 'completed.py'
        intent_backup = backup_root / 'bin' / 'intent.py'
        for path in (completed_path, intent_path, completed_backup, intent_backup):
            path.parent.mkdir(parents=True, exist_ok=True)
        completed_path.write_bytes(b'new-completed\n')
        intent_path.write_bytes(b'old-intent\n')
        completed_backup.write_bytes(b'old-completed\n')
        intent_backup.write_bytes(b'old-intent\n')

        import hashlib
        digest = lambda value: hashlib.sha256(value).hexdigest()
        journal = {
            'schema': 'codexpro.install-wal/v1',
            'status': 'ACTIVE',
            'backup': str(backup_root),
            'files': [
                {
                    'path': 'bin/completed.py', 'action': 'overwritten',
                    'installed_sha256': digest(b'new-completed\n'),
                    'backup_sha256': digest(b'old-completed\n'),
                    'phase': 'COMPLETE', 'transitions': ['INTENT', 'MUTATED', 'VERIFIED', 'COMPLETE'],
                },
                {
                    'path': 'bin/intent.py', 'action': 'overwritten',
                    'installed_sha256': digest(b'new-intent\n'),
                    'backup_sha256': digest(b'old-intent\n'),
                    'phase': 'INTENT', 'transitions': ['INTENT'],
                },
            ],
        }
        wal = backup_root / 'install.wal.json'
        wal.write_text(json.dumps(journal), encoding='utf-8')

        recovered = run_powershell(
            '-File', str(ROOT / 'install.ps1'), '-AgentHome', home,
        )
        assert recovered.returncode == 0, recovered.stderr
        assert completed_path.read_bytes() == b'old-completed\n'
        assert intent_path.read_bytes() == b'old-intent\n'
        assert json.loads(wal.read_text(encoding='utf-8'))['status'] == 'ROLLED_BACK_AFTER_CRASH'


def test_doctor_accepts_current_v3_install_receipt_schema() -> None:
    with tempfile.TemporaryDirectory() as home:
        root = Path(home)
        receipt = root / 'receipts' / 'codexpro-automation-current.json'
        receipt.parent.mkdir(parents=True)
        receipt.write_text(
            json.dumps({
                'schema': 'codexpro.install-receipt/v3',
                'backup': str(root / 'backups' / 'owned'),
                'files': [],
            }),
            encoding='utf-8',
        )

        result = run_powershell('-File', str(ROOT / 'doctor.ps1'), '-AgentHome', home)

        assert 'RECEIPT_INVALID' not in result.stdout
        assert 'unsupported install receipt schema' not in result.stdout
        assert 'CONTRACT_UNVERIFIED' not in result.stdout


def test_uninstall_and_rollback_require_receipt_ownership() -> None:
    rollback = (ROOT / 'rollback.ps1').read_text(encoding='utf-8')
    uninstall = (ROOT / 'uninstall.ps1').read_text(encoding='utf-8')
    assert 'receipt must be owned by this agent home' in rollback
    assert 'codexpro.install-receipt/v3' in rollback
    assert "'rollback.ps1'" in uninstall

def test_receipt_lifecycle_rejects_forged_traversal_and_preserves_modified_file() -> None:
    with tempfile.TemporaryDirectory() as home:
        root = Path(home)
        receipt = root / 'receipts' / 'codexpro-automation-forged.json'
        receipt.parent.mkdir()
        receipt.write_text('{"schema":"codexpro.install-receipt/v2","backup":"'+str(root / 'backups').replace('\\','\\\\')+'","files":[{"path":"../outside","action":"created","installed_sha256":"0"}]}', encoding='utf-8')
        result = run_powershell('-File', str(ROOT/'rollback.ps1'), '-AgentHome', home, '-Receipt', str(receipt))
        assert result.returncode != 0


def test_temp_codex_home_install_and_rollback_is_exact_inverse() -> None:
    with tempfile.TemporaryDirectory() as home:
        codex_home = Path(home)
        overwritten = codex_home / 'bin' / 'chatgpt_oracle_run.py'
        overwritten.parent.mkdir(parents=True)
        original = b'user-owned-original\n'
        overwritten.write_bytes(original)

        installed = run_powershell(
            '-File', str(ROOT / 'install.ps1'),
            '-AgentHome', home,
        )
        assert installed.returncode == 0, installed.stderr
        receipts = sorted((codex_home / 'receipts').glob('codexpro-automation-*.json'))
        assert len(receipts) == 1
        created = codex_home / 'bin' / 'chatgpt_devspace_compat.py'
        installed_pro_skill = codex_home / 'skills' / 'chatgpt-oracle-runtime' / 'SKILL.md'
        installed_pro_metadata = codex_home / 'skills' / 'chatgpt-oracle-runtime' / 'agents' / 'openai.yaml'
        assert overwritten.read_bytes() != original
        assert created.is_file()
        assert installed_pro_skill.read_bytes() == (
            ROOT / 'skills' / 'chatgpt-oracle-runtime' / 'SKILL.md'
        ).read_bytes()
        assert installed_pro_metadata.read_bytes() == (
            ROOT / 'skills' / 'chatgpt-oracle-runtime' / 'agents' / 'openai.yaml'
        ).read_bytes()
        assert b'allow_implicit_invocation: false' in installed_pro_metadata.read_bytes()

        rolled_back = run_powershell(
            '-File', str(ROOT / 'rollback.ps1'),
            '-AgentHome', home,
            '-Receipt', str(receipts[0]),
        )
        assert rolled_back.returncode == 0, rolled_back.stderr
        assert overwritten.read_bytes() == original
        assert not created.exists()
        assert not installed_pro_skill.exists()
        assert not installed_pro_metadata.exists()
        assert json.loads(rolled_back.stdout)['status'] == 'COMPLETE'

def test_uninstall_preserves_modified_created_file_and_reports_conflict() -> None:
    with tempfile.TemporaryDirectory() as home:
        codex_home = Path(home)
        installed = run_powershell(
            '-File', str(ROOT / 'install.ps1'),
            '-AgentHome', home,
        )
        assert installed.returncode == 0, installed.stderr
        receipt = next((codex_home / 'receipts').glob('codexpro-automation-*.json'))
        modified = codex_home / 'bin' / 'chatgpt_oracle_run.py'
        modified.write_text('user modified after install\n', encoding='utf-8')

        uninstalled = run_powershell(
            '-File', str(ROOT / 'uninstall.ps1'),
            '-AgentHome', home,
            '-Receipt', str(receipt),
        )

        assert uninstalled.returncode == 2
        assert modified.read_text(encoding='utf-8') == 'user modified after install\n'
        assert 'preserved_modified_created' in uninstalled.stdout


def test_receipt_sibling_prefix_and_external_backup_are_rejected() -> None:
    with tempfile.TemporaryDirectory() as home:
        codex_home = Path(home)
        sibling = codex_home / 'receipts-evil' / 'forged.json'
        sibling.parent.mkdir()
        sibling.write_text(json.dumps({
            'schema': 'codexpro.install-receipt/v2',
            'backup': str(codex_home / 'backups' / 'owned'),
            'files': [],
        }), encoding='utf-8')
        sibling_result = run_powershell(
            '-File', str(ROOT / 'rollback.ps1'), '-AgentHome', home, '-Receipt', str(sibling)
        )
        assert sibling_result.returncode != 0

        receipt = codex_home / 'receipts' / 'forged.json'
        receipt.parent.mkdir()
        receipt.write_text(json.dumps({
            'schema': 'codexpro.install-receipt/v2',
            'backup': str(codex_home.parent / 'external-backup'),
            'files': [],
        }), encoding='utf-8')
        backup_result = run_powershell(
            '-File', str(ROOT / 'rollback.ps1'), '-AgentHome', home, '-Receipt', str(receipt)
        )
        assert backup_result.returncode != 0
