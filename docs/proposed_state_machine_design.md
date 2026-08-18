# Phase 4 proposed state-machine design

The comprehensive workflow is a deterministic, persisted FSM. The run lock is
held for every transition and the state plus receipt are atomically written
before the lock is released.

| From | Allowed next state | Guard |
| --- | --- | --- |
| `plan` | `review`, `pro`, `web-multi` | manifest/profile permits the optional lane |
| `pro` | `review` | Pro result receipt is complete |
| `web-multi` | `review` | advisory receipt is complete |
| `review` | `implementation` | review returns PASS |
| `implementation` | `final-web-gate` | implementation receipt and local checks pass |
| `final-web-gate` | `complete`, `implementation` | terminal observation + gate PASS, or explicit repair |
| any active state | `attention_required` | transport, contract, or integrity failure |

`complete` and `attention_required` are terminal for the current run. A run in
`attention_required` may only resume with the same run id, project root,
mission hash, and semantic revision. `submitted_unknown` never expires by time;
it advances only on terminal observation or explicit user-confirmed settle.

## CARE + PASS

Every stage follows CARE: **Capture** the input and immutable bindings,
**Act** through its injected effect, **Record** an append-only receipt, then
**Evaluate** the contract and gate before transitioning. The review stage must
return `PASS` (or a structured blocker); a prose response without the marker is
not a successful stage. The final-web-gate additionally requires a persisted
terminal observation and a valid `TASK_OUTCOME` marker before `complete`.

See [the machine-readable contract](../contracts/orchestrator/contract-definitions-v1.json)
for field-level validation.

## Implementation boundary

The implementation target is TypeScript on Node.js with Zod schemas generated
from this contract. `StateStore`, `LockManager`, `StageGate`,
`WorkflowEngine`, and `ProcessSupervisor` are specified contract-first and
tested behaviorally (including malformed receipt hash/session-authority cases,
which yield CARE rather than a blind submit). Windows uses the same file-lock
semantics as POSIX; the named-mutex bridge is transition-only in `install.ps1`
and is deleted at cutover. The 4,800-second threshold is status audit only,
and process cleanup is `child_process.kill()`.

Each run includes a `prologue` binding (root, mission, profile, model, and
semantic revision), an allow-listed `external_actions` log, and a
`recovery` record. Browser auth uses a `--copy-profile` throwaway profile
derived from a manually signed-in seed; credentials are never synchronized
back into the seed. `doctor --recover` may relaunch the same exact slug,
reconnect DevSpace, and clean child processes, but cannot create a replacement
submission.
