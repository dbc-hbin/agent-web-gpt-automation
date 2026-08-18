---
name: web-multi-gpt
description: Run genuine parallel regular ChatGPT sessions through Oracle, with stable solver lanes, waves of at most five, file handoffs, and one merger. No single-GPT role simulation.
---

# Oracle Web Multi-GPT

This identity is retained for compatibility, but the packaged CLI does not
implement a multi-session runner, solver manifest, or merger. Do not invoke
the retired multi runner or invent an `oracle-multi` schema.

- absolute `project_root`, project-contained `output_dir`
- `solvers`: 2..25 unique safe lane IDs and absolute mission paths
- `merger_mission_path`
- `max_concurrency`: 1..5
- optional `next_stage_result_path` for comprehensive relay

Advisory lanes are `access: read-only`. A write lane must declare
`access: worktree-write` and a distinct pre-created worktree `project_root`;
the canonical root is forbidden for write lanes.

```powershell
awgpt run --project-root C:\project --mission C:\project\missions\multi.md --manifest C:\project\multi.json
```

Each lane receives its own Oracle slug/run/output and only `@DevSpace` plus its
mission path. Lanes run in stable waves of at most five; a larger topology is
not reduced. Successful handoffs are preserved and exactly one merger consumes
their paths in lane order. The parent holds same-project exclusion while child
launches use a short parent-scoped mutex. On Windows each lane uses a separate
throwaway copy of the signed-in Oracle profile, preventing one solver from
closing or taking over another solver's Chrome session.

Parallel solvers, mergers, and cross-session handoffs are staged/unsupported in
this package. No attachments, app/settings automation, broad tab cleanup,
`--force`, restart, or silent resubmission.
