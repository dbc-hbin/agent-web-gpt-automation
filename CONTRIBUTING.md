# Contributing

Thanks for improving Agent Web GPT Automation. Changes are reviewed against a
strict rule: automation must preserve user data, exact session identity, and
recoverability before it optimizes convenience.

## Before you start

- Read [Architecture](docs/ARCHITECTURE.md), [Documentation](docs/README.md),
  and the repository `AGENTS.md`.
- Search existing issues and state the exact platform, Oracle version,
  DevSpace version, and failing boundary.
- Never attach credentials, Owner passwords, OAuth data, browser profiles,
  private mission contents, or host-specific URLs.
- Use a clean branch or worktree. Do not mix unrelated user changes.

## Development setup

```powershell
git clone https://github.com/dbc-hbin/agent-web-gpt-automation.git
cd agent-web-gpt-automation
python -m pytest -q
python scripts/run_fast_gate.py
python scripts/check_docs.py
python scripts/run_golden_path_smoke.py
```

Use `npm.cmd` on Windows when PowerShell execution policy blocks `npm.ps1`.
Temporary output belongs under the OS temp directory in a task-specific
`Codex` child, never directly under `C:\` or `D:\`.

## Change rules

- Keep current Oracle/DevSpace routes clean and maintain exact recovery contracts.
- Preserve unrelated global configuration and credential-bearing state.
- Add focused regression tests for behavior changes and fail-closed boundaries.
- Update both README languages when a landing-page fact or mode table changes.
- Put detailed operational instructions in one canonical document and link it
  elsewhere instead of copying commands.
- Follow [Brand Guide](docs/BRAND.md) for product naming and assets.
- Follow [Versioning](docs/VERSIONING.md) when a change warrants a release.

## Pull requests

Describe the problem, safety boundary, changed files, focused tests, full gates,
and rollback behavior. A pull request must not claim successful web execution
from exit code alone; include the exact durable outcome evidence relevant to the
change.

## Security

Do not open a public issue for a vulnerability or exposed secret. Follow the
private reporting instructions in [SECURITY.md](SECURITY.md).
