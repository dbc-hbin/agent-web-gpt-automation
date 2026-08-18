---
name: chatgpt-oracle-runtime
description: "Current Oracle runtime path for new ChatGPT work: regular modes use highest-tier non-Pro DevSpace, explicitly requested qualified Pro uses read/write DevSpace, and explicit Pro attachments remain for bounded evidence."
---

# ChatGPT Oracle Runtime

Resolve `AGENT_WEB_GPT_HOME` before using installed-path examples: honor an
explicit value, then `CODEX_HOME`, then an existing `~/.codex`, and otherwise
use `~/.agent-web-gpt`.

This is the active browser path for GPT work. Regular modes use DevSpace;
explicitly requested qualified Pro uses the same app with mission-scoped
read/write authority. `deep-research` and `pro-attachment` use Oracle
attachment transport: `deep-research` passes the mission and analysis evidence/code
as attachments (or ZIP) without DevSpace. When passing code and analysis documents,
keep attachments to the files explicitly requested by the supported Oracle transport; this package does not ship a context packer.

`chatgpt_oracle_dispatch` supports exactly `direct`, `plan`, `review`, `edit`,
`orchestrator`, `deep-research`, `manual`, and `pro`. `manual` is a supported
`manual-no-launch` profile, not a new submission route. `answer` in
`chatgpt-question-designer` is the prompt-design alias for dispatcher mode
`direct`, not a separate dispatcher key. Regular routes
select `gpt-5.6` and send only `@DevSpace` plus the absolute project mission
path and a compact exact-workspace guard. The web GPT must use only the exact
project root recorded in that mission, read the mission and applicable
`AGENTS.md` completely first, and may retry that same root once after a timeout.
It must not substitute a parent, child, active workspace, or shell boundary
workaround. Regular routes default to `gpt-5.6` with `extra-high`, the highest
supported non-Pro reasoning tier, and never auto-upgrade to Pro. Only explicit
`pro` mode selects `GPT-5.6 Sol` at the Pro effort. It uses DevSpace at the same
exact root and may perform mission-authorized writes and commands under the
repository safety policy. Explicit
`pro-attachment` sends one short instruction plus exact attachment files.
Never infer Pro from task difficulty, invent xhigh, or silently downgrade.

On the first DevSpace-backed submission for a new project, the runner checks
exact equality with local DevSpace `allowedRoots` before creating the Oracle
run directory or browser session. It caches success against the config hash
and rechecks only after config changes. This is a local root guard, not a
repeated endpoint/read probe or ChatGPT app/settings inspection.
Before browser launch, the runner also verifies that the local DevSpace service
(127.0.0.1:7676) is running, and catches pre-submit login expiration, Cloudflare
challenges, or Pro quota exhaustion without consuming browser time or locking the project.

## Manifest

Require schema `codex.chatgpt.oracle-run/v1` with:

- `project_root`: absolute existing directory.
- `mission_path`: absolute UTF-8 regular file inside the project.
- `app_name`: one-line app name, without a leading `@`, for regular routes.
- `task_kind: pro`; qualified Pro uses `app_name: DevSpace`, while explicit
  `pro-attachment` includes one or more exact `attachments`.
- `mode`: `browser`.
- Optional `run_root`, `oracle_command`, `oracle_args`, `thinking_time`,
  hash-validated `copy_profile`, and mutex timeout.
- Regular direct/orchestrator manifests use `task_outcome_contract: "v1"`.

## Run

Preview first:

```powershell
awgpt run --manifest C:\absolute\oracle-job.json --dry-run
```

The preview must include final argv, prompt first line, absolute mission path, SHA-256, and artifact paths without launching Oracle or a browser.
Use this wrapper preview only. Do not substitute Oracle's own browser `--dry-run`, because Oracle 0.17.1 may still enter browser preflight.

Execute only after an explicit live-run request:

```powershell
awgpt run --manifest C:\absolute\oracle-job.json
```

Complete requires Oracle exit code zero, a nonempty `--write-output` artifact,
and—for regular direct/orchestrator routes—a final `TASK_OUTCOME: EXECUTED` marker.
Pro and Deep Research sessions are unconstrained and freeform: any nonempty,
substantive response is accepted without enforcing rigid output markers or heading labels.
A nonzero Oracle exit after launch, including a browser response timeout, is
`attention_required` rather than proof that the web session failed. It retains
same-project ownership and permits only exact-slug `live` or `harvest`
recovery; it never authorizes a replacement submission.
The `awgpt` wrapper exposes no browser observation-duration switch. Observe long
runs with `awgpt doctor`, and recover only the recorded session with `awgpt recover`.

## Recovery

Recovery always reuses the stored Oracle slug and never restarts or submits:

```powershell
awgpt recover --state C:\absolute\run\state.json --action harvest
```

Use `--action live` only to keep following the same stored session. A successful recovery must write a nonempty stored `output.md`, update `state.json` to `complete`, and refresh `transcript.md`; exit code zero without output is `attention_required`.
The CLI keeps `--action live` bound to the same exact slug. At each 80-minute
caution interval it records a status audit and, if the observer process must
return while the session is still live, automatically opens another live
observer for that same saved session. Transient `stalled`, `running`, or
provider-delivery-timeout states keep the same authority and project lock.
There is no time-based replacement, ownership release, or new prompt.
If Oracle proves both that no live tab matches the exact slug and that its
metadata has no recoverable canonical conversation URL, the runner returns
`recovery_binding_unavailable` immediately instead of repeating that invariant
failure. It preserves `submitted_unknown` ownership; restore the
exact persisted conversation URL before recovering the same slug, and never
replace or resubmit it.

Oracle's `Prompt did not appear in conversation before timeout (send may have
failed)` message is likewise submission-uncertain. No-live-tab plus missing
saved-URL recovery evidence does not mechanically prove non-submission. A
maintenance owner may release that exact run only after explicit user
confirmation through `chatgpt_oracle_run settle-no-submission` with the
exact run directory, `--confirmation user-confirmed-no-submission`, and a
concise reason. The settlement is hash-bound to the comprehensive stage,
direct Web Multi child, or standalone qualified-Pro identity and immutable
mission evidence and does not launch Oracle. Comprehensive mode may consume
only one replacement for its binding; standalone qualified Pro permits only
the separately authorized single fresh retry with identical mission bytes.
For `pro-attachment-only`, the supported Oracle 0.17.1 attachment-upload
timeout additionally requires an exact immutable attachment manifest (path,
size, and SHA-256 for every file), the upload-timeout marker, matching
stdout/transcript, no stderr, and exact no-live-tab/no-saved-URL recovery hashes.
It remains ineligible without the same explicit user token or if any artifact
has changed.

Direct same-project runs hold one cross-process mutex for the entire Oracle
process lifetime. A Multi parent owns that project mutex while authorized
children use a short parent-scoped launch mutex and isolated copied Chrome
profiles, then wait concurrently.
Control state, Oracle output, and transcripts live under
`%AGENT_WEB_GPT_HOME%\state\chatgpt-oracle`, outside the DevSpace-writable
project.

Comprehensive and multi-session orchestration are not packaged CLI capabilities
in this release. Use one supported `awgpt run` mission at a time; staged or
parallel workflows require an external orchestrator and must not be represented
as an `awgpt` subcommand.
