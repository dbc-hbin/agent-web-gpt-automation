 # Agent Web GPT Automation Repository Rules

 ## Authority Order & Scope Discipline

 1. Current explicit user instruction and confirmed product intent.
 2. Accepted product requirements and repository governance rules.
 3. Live TypeScript code, contracts, and runtime behavior.
 4. Tests, plans, reviews, fixtures, and documentation.
 - Make the smallest complete change that achieves the outcome. Do not silently broaden the task or build unrequested general-purpose infrastructure.

 ## TypeScript 1.0.0 Single Runtime & Branch Policy

 - Active development on `main` is **Pure Node.js/TypeScript 1.0.0 (`awgpt`)**.
 - Node.js LTS (`>=22.16.0`), npm, TypeScript 5.6, `tsup`, and Vitest constitute the official toolchain.
 - Do not reintroduce Python or PowerShell runtime files, scripts, or tests into `main`. Any legacy Python maintenance belongs exclusively on the `python` branch.
 - Keep wire contracts in `contracts/` and runtime schemas validated with Zod.

 ## GPT Automation Change Persistence & Verification Gates

 - Any durable change to GPT/ChatGPT skills, CLI commands, routing, recovery, state stores, locks, DevSpace adapters, or their tests must pass verification before reporting complete:
   - `npm run typecheck` (`tsc --noEmit`)
   - `npm run test:run` (Vitest unit & contract suites)
   - `npm run package:e2e` (Package build, installation, mock MCP & Oracle recovery E2E)
   - `npm run build` (`tsup` ESM bundle)
   - `npm run pack:check` (`npm pack --dry-run` tarball validation)
 - Files installed under `%USERPROFILE%\.codex` or `~/.codex` are deployment copies managed by receipts, not the primary source of truth. Synchronize reusable improvements back into this repository.
 - Changes committed to `main` must be public-safe, clean, and checked. Never commit secrets, tokens, credentials, machine-local browser profiles, or private history.

 ## Filesystem & Path Hygiene

 - Never create test output, temporary directories, logs, downloaded archives, or dependency checkouts directly under a drive root such as `C:\` or `/`.
 - Use the operating system's temp directory under a task-specific prefix (e.g., `join(tmpdir(), 'awgpt-...')`). When a project-contained scratch path is genuinely required, use the gitignored `.awgpt` or `.codex-tmp` directory.
 - Put reusable third-party source checkouts under `%LOCALAPPDATA%\Codex\Sources` or designated user paths, never on drive roots.
 - Before cleaning any directory, classify ownership and active references. Preserve user projects, system folders, credentials, and ambiguous items; use safe/recoverable operations over raw deletion.

 ## DevSpace & Exact-Root Qualification

 - Every DevSpace-backed session is bound to one exact project root.
 - Before the first DevSpace-backed Oracle submission for a project, verify exact equality against the current local DevSpace `allowedRoots`.
 - Never substitute a parent directory, child directory, similarly named folder, or active workspace workaround.
 - DevSpace connection failure before launch fails closed: do not launch Oracle or create orphan submission records if exact root qualification fails.
 - Do not mutate or automate ChatGPT UI settings, app creation/deletion, or app permissions per run.

 ## Oracle & Browser Profile Isolation

 - Every Oracle run must use a throwaway copy of the manual-login profile seed (`ProfileManager`) in an isolated hidden browser instance.
 - Never share an active manual-login Chrome profile across concurrent tasks or processes.
 - Reject symlinks, non-directory destinations, and path traversal during profile cloning and recovery auxiliary writes.
 - When running `awgpt auth-recover`, the host Google Chrome must be completely closed to avoid SQLite file lock conflicts on the source Cookies database.

 ## Monotonic Session Authority & Recovery

 - Session authority transitions are strictly monotonic:
   ```text
   pre_submit ─┬→ submitted_unknown ─→ terminal_observed ─→ settled
               ├→ live ──────────────→ terminal_observed ─→ settled
               ├→ terminal_observed
               └→ settled
   ```
 - `terminal_observed` cannot regress to `live`.
 - `submitted_unknown` is never treated as non-submission; automatic duplicate submission or replacement workflows are prohibited.
 - Recovery must always reuse the recorded exact Oracle slug via `awgpt recover --state <path> --action live|harvest`. Never pass replacement prompts or restart flags.
 - The 4,800-second mark is only a status-audit threshold, not a timeout or kill trigger. Elapsed time alone never releases ownership, marks failure, or authorizes replacement.
 - Output contract for regular direct/orchestrator runs requires a nonempty output file and exactly one `TASK_OUTCOME: EXECUTED|NOT_EXECUTED|BLOCKED` marker.
 - Disagreement between observers remains `attention_required` under the same project lock.

 ## Web Routing & Model Policy

 - **Default Web Work**: Regular web tasks default to `GPT-5.6` with reasoning tier `extra-high` (highest non-Pro tier). Do not downgrade or silently upgrade to Pro.
 - **Pro Model Guard**: Pro is quota-limited and strictly explicit-only. Only an explicit user request activates `GPT-5.6 Sol` at Pro effort with mission-scoped read/write DevSpace authority.
 - **Ultra Economy Mode**: Local commander runs on `gpt-5.6-luna` with `max` reasoning effort, while heavy planning, implementation, and review are delegated to separate web sessions.
 - **Composer Payload**: Regular web composer contains only `@DevSpace` plus the absolute UTF-8 mission path.

 ## Subagent Concurrency & Delegation

 - Do not blanket-fan-out native subagents. Normal operation starts with at most two concurrent workers with a global hard cap of three spawned threads.
 - Concurrent writers require explicit, non-overlapping file lists or distinct worktrees.
 - Local subagent execution and Oracle web phases do not overlap.
 - Default delegated subagents inherit `gpt-5.6-luna` at `max` reasoning effort unless explicitly overridden.
