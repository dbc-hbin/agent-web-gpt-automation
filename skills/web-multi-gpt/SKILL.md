---
name: web-multi-gpt
description: Advisory guidance for a single regular ChatGPT run; parallel web-multi orchestration is not implemented by this package.
---

# Oracle Web Multi-GPT

This compatibility skill is advisory only. The packaged CLI does not implement
parallel sessions, solver manifests, mergers, waves, or cross-session handoffs.
Use one exact project root and mission with the normal runner. Do not invent an
`oracle-multi` schema.

- absolute `project_root`, project-contained `output_dir`
- one mission path and one output directory

```powershell
awgpt run --project-root C:\project --mission C:\project\missions\task.md
```

Use one Oracle session and the normal exact-session recovery rules. No
attachments, app/settings automation, broad tab cleanup, `--force`, restart, or
silent resubmission.
