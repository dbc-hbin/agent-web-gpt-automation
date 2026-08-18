---
name: mcp-update-guard
description: Part of the current Oracle automation path, safely update MCP servers, shared harness helpers, Oracle GPT runners, global skills, plugins, and related automation while preserving local customizations.
---

# MCP update guard

Use this skill for shared/global automation changes. Read the applicable
`AGENTS.md`, identify the authoritative source and installed deployment, and
preserve unrelated local customizations.

## Workflow

1. Classify the exact component and whether the work is an update,
   compatibility repair, policy refresh, or recovery fix.
2. Inspect source Git status and the installed file identity before editing.
   Never overwrite credentials, browser profiles, runtime state, or unrelated
   user changes.
3. For non-trivial GPT automation design or implementation, use the selected
   current GPT workflow only when the user asked for web delegation. Every new
   ChatGPT run uses Oracle:
   - regular modes, comprehensive stages, and Web Multi use Oracle plus the manually registered DevSpace app;
   - Deep Research operates without DevSpace using attachment/ZIP transport;
   - regular web work defaults to the highest supported non-Pro reasoning tier;
     only explicit user opt-in selects qualified Pro with `GPT-5.6 Sol` at the
     Pro effort and read/write DevSpace; explicit `pro-attachment` is limited to immutable or
     DevSpace-unreadable evidence and is never an automatic fallback.
4. Prefer small compatibility changes over wholesale replacement. Preserve
   local ports, names, roots, tokens, routing, and hooks unless the task
   explicitly changes them.
5. Batch coherent edits, inspect the final diff once, run focused regression
   tests, then broader tests according to blast radius.
6. Synchronize reusable GPT automation changes to the authoritative
   `agent-web-gpt-automation` source, install the verified bytes, commit with a
   descriptive message, push public-safe changes, and check CI.

## Single repair owner

Automation sources have exactly one repair owner. A project session that hits an
automation defect reports it and stops; it does not edit runners, state, patches,
or their tests. Cross-session patching previously produced duplicate fixes,
conflicting state rules, and repairs aimed at the layer that reported the symptom
instead of the layer that failed.

- Build the handover with
  `python "$env:AGENT_WEB_GPT_HOME\bin\chatgpt_oracle_incident.py" report --run-dir <exact-run-dir>`.
  The packet carries the exact run directory, the classified bucket, the
  lifecycle verdict with its authority source, and existing evidence paths.
- Classify before repairing. Run
  `python "$env:AGENT_WEB_GPT_HOME\bin\chatgpt_oracle_diagnose.py" --summary-only`
  and fix the largest bucket rather than the newest report. A `pre-submit-*`
  bucket proves no web submission occurred and is safe to retry; a
  `post-submit-*` bucket requires exact-slug recovery and never a replacement
  submission.
- Treat `safe_for_fresh_run: false` as binding. Do not resubmit, stop, or close
  another session's work while repairing code.

## Safety boundaries

- Do not delete or recreate credential-bearing state during a normal update.
- Do not use resource pressure as authority to block, terminate, downgrade, or
  duplicate user-visible work.
- Do not silently switch Oracle model, reasoning level, transport, or browser
  backend.
- Do not create a new legacy agbrowse/CodexPro run while repairing recovery
  code.
- Stop and report exact dirty files when authoritative persistence, push, or CI
  cannot be completed.

## Report

Report updated components, preserved customizations, focused and broad
verification, installed/source synchronization, commit/push/CI state, rollback
evidence, and any remaining risk.
