# Documentation

This index is the single map for Agent Web GPT Automation documentation.
Operational commands live in one authoritative guide and are linked instead of
being copied into several files.

## Start here

| Document | Language | Purpose |
|---|---|---|
| [Main README](../README.md) | 한국어 | Product overview, quick install, mode selection |
| [English README](../README.en.md) | English | English product overview and quick install |
| [First Install](FIRST_INSTALL.md) | 한국어 | Canonical install-to-ChatGPT connection sequence |
| [Contributing](../CONTRIBUTING.md) | English | Development, tests, pull requests, security boundary |

## Operate

Read operational policy in this order: complete first installation, use Global
ChatGPT Routing to select the highest-tier non-Pro default or an explicit Pro
route, then open a specialized guide only when that mode applies.

| Document | Language | Authority |
|---|---|---|
| [DevSpace + Tailscale](DEVSPACE_TAILSCALE_SETUP.md) | English | Managed DevSpace/Funnel setup and diagnosis |
| [Global ChatGPT Routing](GLOBAL_CHATGPT_ROUTING.md) | English | Mode-to-runner mapping and recovery boundaries |
| [Ultra Economy Mode](ULTRA_ECONOMY_MODE.md) | 한국어 | Luna Max local command with separate web stages |

## Understand the project

| Document | Purpose |
|---|---|
| [Architecture](ARCHITECTURE.md) | Current Oracle/DevSpace execution and lifecycle overview |
| [Brand guide](BRAND.md) | Product name, visual assets, terminology, attribution |
| [Versioning](VERSIONING.md) | SemVer policy and release source of truth |
| [Changelog](CHANGELOG.md) | User-visible changes by release |
| [Release checklist](RELEASE_CHECKLIST.md) | Maintainer verification before tags and releases |
| [Security policy](../SECURITY.md) | Supported versions and private reporting |
| [Third-party notices](../THIRD_PARTY_NOTICES.md) | Upstream licenses and provenance |

## Documentation conventions

- Product name: **Agent Web GPT Automation**
- Repository name: `agent-web-gpt-automation`
- Python package and CLI: `python doctor.py`
- Manually registered ChatGPT app name in examples: `codex`
- Current transport: Oracle + DevSpace
- Legacy identifiers remain lowercase/code-form and are explained as
  compatibility IDs on first use.
- README files summarize. `FIRST_INSTALL.md`, routing, architecture, versioning,
  and release documents own their respective details.
- Commands must use placeholders; never publish hostnames, passwords, tokens,
  browser profiles, or user-specific project paths.
