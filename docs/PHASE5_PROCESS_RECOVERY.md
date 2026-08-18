# Phase 5: process supervision and session recovery

Phase 5 defines the process and session boundary around the Phase 4
comprehensive workflow. Recovery is continuation of the same `run_id`, exact
project root, mission hash, semantic revision, and (when a browser session was
created) exact Oracle slug. It is never an implicit new submission.

## Authoritative stage transitions

The review contract allows exactly these edges:

```text
plan             -> plan | review | web-multi | pro
pro              -> review
web-multi        -> review
review           -> implementation
implementation   -> final-web-gate
final-web-gate   -> complete | implementation
```

`plan -> plan` is a bounded semantic correction. The repair edge from
`final-web-gate` to `implementation` must cite the failed gate in its receipt.
Unknown edges, stale receipt hashes, changed roots, or changed mission bytes
fail closed into `attention_required`. Optional `pro` and `web-multi` lanes
must converge at `review`; they cannot bypass it.

## Stable session tools

* **StateStore** persists validated state and append-only receipts with
  `write-file-atomic`. The state is written before releasing the run lock;
  readers reject malformed JSON, schema violations, and non-monotonic session
  authority.
* **LockManager** uses `proper-lockfile` on a project-derived lock path. A
  second submit for the same project is refused while the first owner is live;
  release is idempotent and stale-lock handling is explicit and auditable.
* **StageGate** is a deterministic local gate. It validates the legal edge,
  immutable prologue, receipt hash chain, required marker (`PASS` or
  `TASK_OUTCOME`), and terminal observation before allowing the next stage.
* **ProcessSupervisor** starts browser/DevSpace children with `execa`, records
  the process tree, and terminates the complete tree (including descendants)
  before a retry. A process that remains present blocks retry until clean-up is
  confirmed.
* **ProfileManager** creates a throwaway browser profile with `--copy-profile`
  from a manually signed-in seed. Cookies and credentials are never copied
  back to the seed; recovery may reopen only the persisted conversation URL.

## 4,800-second caution/status audit

Elapsed time reaching 4,800 seconds emits a caution/status-audit event. It is
not a timeout: elapsed time alone never marks failure, releases ownership,
settles `submitted_unknown`, or authorizes a new submission. The supervisor
audits process liveness, output/log progress, known conversation binding, and
terminal evidence, then continues the same process or exact-slug recovery while
the run is live or uncertain. Only provider hard limits, explicit terminal
evidence, user stop, or verified inability can terminate that observation path.

## `doctor --recover` automatic strategy

Recovery selects one action from the persisted diagnosis, retaining the same
run identity:

1. **Login failure**: return an actionable `--open-profile-login` link and
   pause for the user to re-authenticate the manual-login seed.
2. **DevSpace unreachable**: retry the exact-root connection once. If the
   connector remains unreachable, return `BLOCKED` and retain ownership and
   receipts for a later exact retry.
3. **Process exists**: ask `ProcessSupervisor` to clean the entire recorded
   child tree; retry only after all descendants are gone.

These actions are mutually exclusive per recovery invocation. Recovery never
restarts or resubmits an already submitted Oracle prompt and never substitutes
a parent/child workspace.

## Behaviour-based contract tests

The test suite should exercise observable contracts rather than implementation
details:

* orphan/stale state resumes only from the last valid receipt; every allowed
  stage edge passes and every other edge is rejected;
* concurrent `StateStore` writes leave one complete JSON document (no partial
  file) and preserve the receipt hash chain;
* concurrent `LockManager` acquisition permits one submit, while release and
  stale recovery remain idempotent and projects remain isolated;
* `ProcessSupervisor` termination removes the root and all descendants before
  retry, with surviving children producing a blocked result;
* `doctor --recover` chooses the login, DevSpace, or process action above,
  preserves exact-slug/session authority, and never creates a duplicate
  submission;
* the 4,800-second audit emits status only and does not alter ownership or
  stage state.

The machine-readable contract is
[`contracts/orchestrator/phase5-recovery-v1.json`](../contracts/orchestrator/phase5-recovery-v1.json).
