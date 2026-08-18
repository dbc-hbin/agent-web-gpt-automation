# Release checklist

This checklist defines maintainer release verification for Agent Web GPT Automation.

## Version and presentation

- Choose the SemVer impact using [VERSIONING.md](VERSIONING.md).
- Ensure version consistency across:
  - `package.json`
  - `install-manifest.json`
  - newest heading in `docs/CHANGELOG.md`
- Validate all Markdown links and committed brand assets (`logo.svg`, `banner.svg`, `social-preview.png`).
- Keep Korean and English README mode tables, requirements, and documentation maps semantically aligned.
- Confirm MIT copyright is `2026 dbc-hbin`.

## Verification gates

Run the mandatory release verification suite locally before tagging:

```bash
# Full unit and integration test suite
pytest

# Documentation contract and brand asset check
python3 scripts/check_docs.py

# Fast gate verification
python3 scripts/run_fast_gate.py

# Golden path smoke test
python3 scripts/run_golden_path_smoke.py
```

## Packaging and lifecycle

- Confirm `install-manifest.json` and `package.json` inventory every shipped runtime file.
- Verify portable lifecycle operations (`install.py`, `doctor.py`, `update.py`, `rollback.py`, `uninstall.py`).
- Ensure no temporary files, logs, or unmanaged test caches are committed.
- Create an annotated `vMAJOR.MINOR.PATCH` tag and GitHub Release only after CI passes.

