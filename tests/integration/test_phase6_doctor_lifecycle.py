"""Phase 6 behaviour contracts (Python integration skeleton).

Implementations should replace the skips with subprocess calls to the
``python doctor.py`` and a temporary fake DevSpace server.
"""

import json
from pathlib import Path

import pytest


pytestmark = pytest.mark.integration


def invoke_doctor(*args: str, env: dict[str, str] | None = None):
    """Return CompletedProcess for the real CLI (implementation hook)."""
    pytest.skip("wire to the packaged doctor.py executable")


def json_output(result) -> dict:
    return json.loads(result.stdout)


def test_doctor_malformed_state_is_fail(tmp_path: Path):
    pytest.skip("fixture wiring pending")


def test_doctor_healthy_devspace_copy_profile_and_lock(tmp_path: Path):
    pytest.skip("fake DevSpace listener and profile fixture pending")


def test_doctor_missing_profile_is_blocked_and_offers_login(tmp_path: Path):
    pytest.skip("fixture wiring pending")


def test_open_profile_login_url_is_generic_and_secret_free(tmp_path: Path):
    pytest.skip("Chrome launcher assertion pending")


def test_stop_purges_orphan_zombie_and_semi_stale_but_keeps_owner(tmp_path: Path):
    pytest.skip("ProcessSupervisor fixture wiring pending")


def test_recover_after_devspace_process_crash_preserves_exact_slug(tmp_path: Path):
    pytest.skip("crash simulation and state fixture pending")
