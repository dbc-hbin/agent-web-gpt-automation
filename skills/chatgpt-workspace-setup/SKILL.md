 ---
 name: chatgpt-workspace-setup
 description: Part of the current Oracle path, perform the one-time, user-authorized DevSpace and stable HTTPS tunnel setup or read-only diagnosis for ChatGPT workspace access. Tailscale Funnel is the managed route. Never use this during ordinary GPT runs and never automate ChatGPT settings or app selection.
 ---

 # ChatGPT Workspace Setup

 Use this skill only for a first connection, an explicitly requested DevSpace/tunnel repair, or a read-only endpoint diagnosis. Ordinary ChatGPT modes must not call it. This package exposes bounded local checks; DevSpace initialization and Tailscale Funnel configuration remain explicit operator actions.

 ## One-time setup

 The user must provide every allowed project root and the Tailscale MagicDNS hostname. A drive root such as `C:\` is rejected. The setup process is intentionally interactive because DevSpace itself stores the Owner secret in its own standard location; never copy that secret into a manifest, log, or Git file.

 The preview reports the exact bounded diagnostic commands. It does not inspect
 or rewrite DevSpace configuration, manage credentials, restart services, or
 configure a Funnel.

 Preview the exact setup plan first, then explicitly execute the bounded setup
 commands only after operator approval:

 ```powershell
 awgpt workspace setup --root C:\projects\example
 awgpt workspace setup --root C:\projects\example --apply
 ```

 The helper does not run `devspace init`, manage Owner credentials, restart
 services, or create a Funnel.

 The TypeScript helper does not patch DevSpace or manage its service. It exposes
 the bounded commands that are actually implemented:

 ```powershell
 awgpt workspace setup --root C:\projects\example
 awgpt workspace setup --root C:\projects\example --apply
 awgpt workspace doctor --root C:\projects\example
 ```

 `workspace setup` previews `devspace doctor --root <root>` and
 `tailscale funnel status`; `--apply` explicitly executes those commands with
 the local process environment. `workspace doctor` executes the same bounded
 diagnostics, never accepts `--apply`, and never performs setup mutations. Use
 DevSpace's own interactive setup and the Tailscale CLI separately when a
 service or Funnel must be configured.

 On Windows, any Startup shortcut or service wrapper must read
 `%USERPROFILE%\.devspace\config.json` at every launch and derive
 `DEVSPACE_ALLOWED_ROOTS` from its current `allowedRoots`. Never hardcode a
 second root list in the startup wrapper: DevSpace gives the environment
 variable precedence over the persisted config, so a stale wrapper silently
 removes newer projects after every reboot.

 Every new or managed DevSpace service launch must set
 `DEVSPACE_TOOL_MODE=full`. This retains the approved-root boundary while
 making read-only workspace discovery tools such as `grep`, `glob`, and `ls`
 available. Do not change ChatGPT connector settings to compensate for a tool
 mode issue. `doctor` reports the managed launch setting and any persisted
 `toolMode`; an explicitly non-`full` persisted mode requires service setup
 review, while a running process environment is not inferred from an HTTP probe.

 Managed launches also set
 `DEVSPACE_OAUTH_SCOPES=devspace,offline_access`. DevSpace already issues refresh
 tokens; advertising `offline_access` lets ChatGPT request and renew them. If an
 older app registration was created before this metadata was exposed, the user
 must reconnect or recreate that app once. Never automate that settings action.

 Before every managed service launch, the helper loads `better-sqlite3` with the
 active Node runtime and opens an in-memory database. A missing npm 12 native
 binding fails closed with `DEVSPACE_NATIVE_BINDING_UNAVAILABLE`; never approve
 an unbounded list of install scripts automatically.

 The only app information to enter manually in ChatGPT Developer Mode is:

 - Recommended app name: `codex`
 - URL: `https://<hostname>/mcp`
 - Complete the first Owner-password approval page that DevSpace presents.

 Never open ChatGPT settings, register/delete an app, change permissions, inspect app lists, select an app name, or press Tab in the ChatGPT UI.

 After a manual first registration or requested reconnect, use the supported
 read-only workspace doctor to inspect the local state:

 ```powershell
 awgpt workspace doctor --root C:\projects\example
 ```

 The packaged helper does not restart or initialize DevSpace/Tailscale. Make
 those service changes with their own documented tools.

 Then verify the manually registered app with a fresh **regular, non-Pro**
 Oracle `@codex` read-only probe that opens the exact project root and reads a
 small directory listing. Codex Desktop's built-in `DevSpace` plugin is a
 different connector; its tools cannot prove that the manually registered
 ChatGPT app works. A Pro submission must never be the first connectivity test.

 Before the first DevSpace-backed Oracle question for a new project, the Oracle
 runner checks that the normalized exact project root is present in the local
 `allowedRoots`. Parent, child, and similarly named roots do not qualify. A
 successful qualification is cached against the exact config SHA-256; later
 questions for that project do not repeat endpoint, read, OAuth, or app-setting
 probes, while any config change triggers a lightweight recheck.

 ## Login Recovery

 If ChatGPT session expires in the isolated profile seed:
 1. Close all main Google Chrome windows first (to release SQLite file locks on Cookies database).
 2. Recover cookies from main Chrome: `awgpt auth-recover --copy-profile "$HOME/.oracle/login-profiles/manual-login-..."`
 3. Preflight check: `awgpt auth-preflight --copy-profile "$HOME/.oracle/login-profiles/manual-login-..."`
 4. Manual login fallback: `awgpt doctor --open-profile-login`

 ## Diagnosis

 This is read-only and checks only local DevSpace, then Funnel status, then the public `/mcp` endpoint:

 ```powershell
 awgpt doctor --project-root C:\projects\one
 ```

 If the public endpoint is healthy but a ChatGPT call still fails after manual
 registration, report the registration URL and stop; do not loop or invent a
 post-registration repair command.

 For an explicitly requested service/Funnel repair, use the native DevSpace and
 Tailscale tools, then rerun the read-only diagnostic:

 ```powershell
 awgpt workspace doctor --root C:\projects\one
 ```
