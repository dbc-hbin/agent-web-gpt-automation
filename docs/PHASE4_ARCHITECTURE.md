# Phase 4 architecture: Comprehensive workflow state machine

Phase 4 owns deterministic orchestration of a comprehensive Oracle run. It
coordinates plan, review, implementation, and final verification while
preserving the session-authority and exact-root invariants established by
Phases 2 and 3. The orchestrator is a pure state machine: effects (browser
submission, DevSpace calls, and local gates) are injected behind stage
handlers and are recorded in a receipt before the next transition is
attempted.

## Components

* `ComprehensiveOrchestrator` loads a validated run manifest, acquires the
  project lock, and drives the finite-state machine.
* `StageRunner` executes one stage, validates its result, and writes an
  append-only receipt containing the input hash, output hash, and transition.
* `PromptBuilder` renders the next mission from the previous receipt. It must
  use the completing stage's output as data; it never silently invents a new
  mission or project root.
* `GateRunner` runs deterministic local checks and returns a structured pass or
  fail result. A failed gate moves the run to `attention_required` (or back to
  `implementation` when explicitly authorised by the manifest).
* `StateStore` is the atomic persistence boundary. State and receipts are
  written before releasing the lock, so a crash can be resumed from the last
  committed transition.

## State flow

The normative transition relation is:

```text
plan             -> plan | review | web-multi | pro
pro              -> review
web-multi        -> review
review           -> implementation
implementation   -> final-web-gate
final-web-gate   -> complete | implementation
```

`plan -> plan` is a bounded semantic revision. The correction edge from
`final-web-gate` to `implementation` requires a receipt naming the failed
gate; no other edge is legal.

The default flow is `plan → review → implementation → final-web-gate →
complete`. The `pro` and `web-multi` stages are optional inputs to review and
cannot bypass review. Any transport failure after submission is represented as
`attention_required`; it is never treated as a fresh submission. Terminal
session authority remains monotonic (`submitted_unknown` can only advance to
`terminal_observed` or an explicit user-confirmed `settled` state).

Each transition is validated against `contracts/oracle/phase4-workflow-v1.schema.json`.
Unknown stages, mismatched roots, stale receipt hashes, and duplicate stage
completion fail closed.

## Receipt and recovery rules

Receipts are immutable records identified by `receipt_id` and chained with
`previous_receipt_sha256`. A stage may be retried only when its prior attempt
is non-terminal and the retry has the same run, root, mission, and semantic
revision. On restart, the orchestrator reads the last valid receipt and resumes
at its recorded `next_stage`; it does not submit a replacement workflow.

The final receipt must contain a `TASK_OUTCOME` value (`EXECUTED`,
`NOT_EXECUTED`, or `BLOCKED`). `complete` is legal only after the final local
gate passes and the authoritative terminal observation has been persisted.

Every stage envelope explicitly contains `prologue`, `external_actions`, and
`recovery`. Malformed receipt hashes or non-monotonic session authority are
evaluated contextually: CARE (`attention_required`, ownership and evidence
preserved) or PASS only when authoritative evidence and contract checks agree.
The 4,800-second mark is a caution/status audit, never a timeout. Process-tree
cleanup uses Node `child_process.kill()`; the Windows named-mutex helper is
kept only as an `install.ps1` transition helper and is removed at final
cutover in favor of file-lock semantics.

Contract-first behavior tests cover `StateStore`, `LockManager`, `StageGate`,
`WorkflowEngine`, and `ProcessSupervisor`, including crash-safe writes,
single-owner locking, legal edges, monotonic authority, audit continuation,
and `doctor --recover` exact-slug recovery.

## Profile selection

`default` uses the bounded plan/review/implementation/final-gate flow.
`ultra-economy` may add a web-multi advisory lane and a Pro planning lane, but
both converge at review and use the same transition contract. Profile data is
part of the manifest hash, making a profile change a new run rather than an
implicit mutation of an active run.
