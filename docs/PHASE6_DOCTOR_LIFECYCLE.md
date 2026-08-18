# Phase 6 — Doctor and lifecycle architecture

This document defines the `awgpt` operator surface for health checks,
safe stopping, and recovery. It is an architecture/contract document; a
`PASS` means the checks below completed, not that an Oracle task succeeded.

## CLI contract

```text
awgpt doctor [--copy-profile <seed>] [--open-profile-login]
awgpt doctor --recover
```

`doctor` emits one JSON object with `schema`, `status` (`PASS`, `BLOCKED`, or
`FAIL`), `checks`, `sessions`, and `next_actions`. Malformed state is `FAIL`;
an unavailable DevSpace endpoint is `BLOCKED` (never converted to `200 OK` or
success by a Docker/proxy wrapper). Missing copy-profile is `BLOCKED` with a
re-login action.

Checks run in fail-fast order:

1. Probe `http://127.0.0.1:7676` and verify the expected DevSpace health
   response. No later mutation or recovery runs after a failed probe.
2. Validate the `--copy-profile` seed and create a throwaway profile. Check
   readable SQLite/Login Data and Local Storage metadata without writing back
   to the seed. Record profile path and hashes, never credentials. When the
   operator explicitly runs `awgpt auth-recover`, only scoped ChatGPT/OpenAI
   cookie rows and required Chrome key metadata may update the closed seed; a
   failed login validation must restore its original database and Local State.
3. Audit `.oracle` state and exact project lock ownership. A
   `submitted_unknown` session remains owned by its exact run/slug; authority
   may only advance to `terminal_observed`/`settled`, never regress.

`--open-profile-login` is only a recovery aid. If headless copy-profile
validation fails, create a user-scoped throwaway login path, open the generic
ChatGPT login deep link in Chrome, and print the generated path. The URL must
not embed a project root, run id, token, or exact slug. The command never
submits a workflow.

`--recover` performs one safe action per invocation: login/profile validation,
DevSpace diagnosis, exact-project dead-process cleanup, or exact-slug
live/harvest recovery. It preserves the persisted workflow/stage identity and
semantic revision budget. A `submitted_unknown` run is never retried as a new
submission.

## Lifecycle rules

Process liveness is sampled from the supervisor PID and descendants. A hung
task is flagged for operator attention; the 4,800-second audit threshold is
not an automatic kill. A hung root (transaction/crash-recovery marker without
live owner) is flagged and may be cleaned only after lock and state checks.
Orphan, zombie, and semi-stale processes are purge candidates only when they
are not descendants of a live exact-slug owner. Recovery remains exact-slug
and monotonic even after crashes, timeouts, or non-zero provider exits.

## Behaviour-based integration contract

The integration suite should exercise the real command boundary with temporary
agent homes and a fake DevSpace listener:

- malformed `.oracle` state → `FAIL`, diagnostic code, non-zero exit;
- healthy endpoint/profile/state → `PASS` and authoritative check details;
- missing/invalid profile → `BLOCKED` plus `--open-profile-login` action;
- generic login URL/path generation contains no secrets or run identifiers;
- `--recover` cleans a recorded dead exact-project process while preserving a
  live exact-slug owner and its lock;
- simulated DevSpace/process crash → `--recover` probes first, cleans the dead
  chain, and resumes only the recorded exact slug.

Tests must assert JSON fields and observable process/lock effects, not merely
exit codes. Keep fixtures opt-in and never use a real profile or credentials.
