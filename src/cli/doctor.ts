import { z } from 'zod';
import { access, chmod, mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import {
  PersistentStateSchema,
  OracleSessionStateSchema,
  SessionAuthority,
  normalizeOracleSessionAuthority,
  validateWorkflowStateConsistency,
} from '../types/index.js';
import { LockManager } from '../core/state/locks.js';
import { ProcessRegistry, pidIsAlive, terminatePersistedProcess } from '../core/process/registry.js';
import { executeExactRecovery, planExactRecovery } from '../core/forensics/recovery.js';
import { qualifyExactProjectRoot, type DevSpaceClient } from '../core/devspace/qualification.js';

export const DoctorCheck = z.object({
  name: z.string(),
  status: z.enum(['PASS', 'BLOCKED', 'FAIL']),
  code: z.string(),
  message: z.string(),
});

export const DoctorReport = z.object({
  schema: z.literal('codex.chatgpt.agent-web-gpt-doctor/v1'),
  status: z.enum(['PASS', 'BLOCKED', 'FAIL']),
  checks: z.array(DoctorCheck),
  sessions: z.array(z.object({
    run_id: z.string(),
    session_authority: SessionAuthority,
    exact_slug: z.string().optional(),
    state_path: z.string(),
    state_schema: z.enum(['oracle-run', 'workflow']),
  })),
  locks_held: z.boolean(),
  next_actions: z.array(z.string()),
  recovery_action: z.object({
    kind: z.enum(['devspace_reconnect', 'profile_login', 'process_cleanup', 'exact_session_recovery']),
    status: z.enum(['COMPLETED', 'BLOCKED', 'FAILED']),
    detail: z.string(),
  }).strict().optional(),
});
export type DoctorReport = z.infer<typeof DoctorReport>;

export interface DoctorOptions {
  projectRoot: string;
  copyProfilePath?: string;
  devspaceUrl?: string;
  statePaths?: string[];
  oracleHome?: string;
  recover?: boolean;
  reconnectDevSpace?: (projectRoot: string) => Promise<boolean>;
  devspaceClient?: DevSpaceClient;
}

const DEVSPACE_ACCEPTED_STATUSES = new Set([200, 401, 403, 405, 406]);
const CHATGPT_LOGIN_URL = 'https://chatgpt.com/auth/login';

export interface ProfileLoginTarget {
  profile_path: string;
  url: typeof CHATGPT_LOGIN_URL;
}

export async function prepareProfileLogin(oracleHome = path.join(os.homedir(), '.oracle')): Promise<ProfileLoginTarget> {
  const root = path.resolve(oracleHome, 'login-profiles');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const profilePath = await mkdtemp(path.join(root, 'manual-login-'));
  if (process.platform !== 'win32') await chmod(profilePath, 0o700);
  return { profile_path: profilePath, url: CHATGPT_LOGIN_URL };
}

export async function launchProfileLogin(target: ProfileLoginTarget): Promise<void> {
  const profileArg = `--user-data-dir=${target.profile_path}`;
  const command = process.platform === 'darwin'
    ? { file: 'open', args: ['-na', 'Google Chrome', '--args', profileArg, target.url] }
    : process.platform === 'win32'
      ? { file: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', 'chrome.exe', profileArg, target.url] }
      : { file: 'google-chrome', args: [profileArg, target.url] };
  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    const onSpawn = () => {
      child.off('error', onError);
      resolve();
    };
    const onError = (error: Error) => {
      child.off('spawn', onSpawn);
      reject(error);
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
  child.unref();
}

export async function checkDevSpace(
  target = 'http://127.0.0.1:7676/mcp',
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetcher(target, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain;q=0.8' },
      signal: controller.signal,
    });
    return DEVSPACE_ACCEPTED_STATUSES.has(response.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkProfile(copyProfilePath: string): Promise<boolean> {
  const root = path.resolve(copyProfilePath);
  const cookieCandidates = [
    path.join(root, 'Default', 'Network', 'Cookies'),
    path.join(root, 'Default', 'Cookies'),
  ];
  try {
    await Promise.all([
      access(path.join(root, 'Local State'), constants.R_OK),
      access(path.join(root, 'Default', 'Local Storage'), constants.R_OK),
    ]);
    for (const candidate of cookieCandidates) {
      try {
        await access(candidate, constants.R_OK);
        return true;
      } catch {
        // Continue to the legacy Chrome cookie location.
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function defaultReconnectDevSpace(projectRoot: string): Promise<boolean> {
  void projectRoot;
  return false;
}

export async function auditOracleState(statePath: string): Promise<{
  run_id: string;
  session_authority: z.infer<typeof SessionAuthority>;
  exact_slug?: string;
  state_path: string;
  state_schema: 'oracle-run' | 'workflow';
}> {
  const content = await readFile(statePath, 'utf8');
  const raw = JSON.parse(content);
  const stateResult = PersistentStateSchema.safeParse(raw);
  if (!stateResult.success) {
    const sessionState = OracleSessionStateSchema.parse(raw);
    return {
      run_id: sessionState.run_id,
      session_authority: normalizeOracleSessionAuthority(sessionState.session_authority),
      exact_slug: sessionState.oracle?.slug,
      state_path: path.resolve(statePath),
      state_schema: 'oracle-run',
    };
  }
  const state = stateResult.data;
  if (state.schema === 'codex.chatgpt.oracle-workflow/v1') {
    validateWorkflowStateConsistency(state);
  }
  const exactSlug = state.schema === 'codex.chatgpt.oracle-run-state/v1'
    ? state.oracle?.slug
    : state.receipts.at(-1)?.recovery.exact_slug;
  return {
    run_id: state.run_id,
    session_authority: state.session_authority,
    exact_slug: exactSlug,
    state_path: path.resolve(statePath),
    state_schema: state.schema === 'codex.chatgpt.oracle-run-state/v1' ? 'oracle-run' : 'workflow',
  };
}

async function discoverStatePaths(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 6) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async entry => {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(candidate, depth + 1);
      else if (entry.isFile() && entry.name === 'state.json') found.push(candidate);
    }));
  }
  await walk(root, 0);
  return found.sort();
}

export async function runDoctor(options: DoctorOptions | string): Promise<DoctorReport> {
  const normalized: DoctorOptions = typeof options === 'string'
    ? { projectRoot: options }
    : options;
  const projectRoot = path.resolve(normalized.projectRoot);
  const profilePath = path.resolve(
    normalized.copyProfilePath ?? path.join(os.homedir(), '.oracle', 'browser-profile'),
  );
  const oracleHome = path.resolve(normalized.oracleHome ?? path.join(os.homedir(), '.oracle'));
  const checks: z.infer<typeof DoctorCheck>[] = [];
  const nextActions: string[] = [];

  if (normalized.devspaceClient) {
    const qualification = await qualifyExactProjectRoot(projectRoot, normalized.devspaceClient);
    checks.push({ name: 'devspace', status: qualification.ok ? 'PASS' : 'BLOCKED', code: qualification.code,
      message: qualification.ok ? 'DevSpace exact project root qualified with a read-only tool call.' : (qualification.detail ?? 'DevSpace exact-root qualification failed.') });
    if (!qualification.ok) return DoctorReport.parse({ schema: 'codex.chatgpt.agent-web-gpt-doctor/v1', status: 'BLOCKED', checks,
      sessions: [], locks_held: false, next_actions: ['Register the exact project root in DevSpace, then rerun doctor.'] });
  }

  let devspaceReachable = normalized.devspaceClient ? true : await checkDevSpace(normalized.devspaceUrl);
  if (!devspaceReachable && normalized.recover) {
    const reconnected = await (normalized.reconnectDevSpace ?? defaultReconnectDevSpace)(projectRoot);
    devspaceReachable = reconnected && await checkDevSpace(normalized.devspaceUrl);
    if (!devspaceReachable) {
      checks.push({
        name: 'devspace', status: 'BLOCKED', code: 'DEVSPACE_RECONNECT_FAILED',
        message: 'The exact-root DevSpace reconnect was attempted once and the listener remains unavailable.',
      });
      return DoctorReport.parse({
        schema: 'codex.chatgpt.agent-web-gpt-doctor/v1', status: 'BLOCKED', checks,
        sessions: [], locks_held: false,
        next_actions: ['Reconnect DevSpace manually for the exact project root, then rerun doctor --recover.'],
        recovery_action: { kind: 'devspace_reconnect', status: 'BLOCKED', detail: 'Exact-root reconnect attempt failed.' },
      });
    }
    checks.push({
      name: 'devspace', status: 'PASS', code: 'DEVSPACE_RECONNECTED',
      message: 'DevSpace was reconnected once for the exact project root.',
    });
    return DoctorReport.parse({
      schema: 'codex.chatgpt.agent-web-gpt-doctor/v1', status: 'PASS', checks,
      sessions: [], locks_held: false, next_actions: ['Rerun doctor --recover to continue with the next diagnosis.'],
      recovery_action: { kind: 'devspace_reconnect', status: 'COMPLETED', detail: 'Exact-root reconnect completed.' },
    });
  }
  checks.push({
    name: 'devspace',
    status: devspaceReachable ? 'PASS' : 'BLOCKED',
    code: devspaceReachable ? 'DEVSPACE_REACHABLE' : 'DEVSPACE_SERVICE_UNAVAILABLE',
    message: devspaceReachable
      ? 'DevSpace MCP listener is reachable.'
      : 'DevSpace MCP listener is unavailable or returned an unexpected response.',
  });
  if (!devspaceReachable) {
    nextActions.push('Reconnect DevSpace for the exact project root, then rerun doctor.');
    return DoctorReport.parse({
      schema: 'codex.chatgpt.agent-web-gpt-doctor/v1',
      status: 'BLOCKED', checks, sessions: [], locks_held: false, next_actions: nextActions,
    });
  }

  const profileValid = await checkProfile(profilePath);
  checks.push({
    name: 'copy-profile',
    status: profileValid ? 'PASS' : 'BLOCKED',
    code: profileValid ? 'PROFILE_LAYOUT_VALID' : 'PROFILE_LOGIN_REQUIRED',
    message: profileValid
      ? 'The manual-login seed has the required readable profile assets.'
      : 'The manual-login seed is missing required readable profile assets.',
  });
  if (!profileValid) {
    nextActions.push('Run doctor --open-profile-login and reuse the returned profile_path.');
    return DoctorReport.parse({
      schema: 'codex.chatgpt.agent-web-gpt-doctor/v1',
      status: 'BLOCKED', checks, sessions: [], locks_held: false, next_actions: nextActions,
      recovery_action: normalized.recover
        ? { kind: 'profile_login', status: 'BLOCKED', detail: 'Manual authentication is required.' }
        : undefined,
    });
  }

  const statePaths = normalized.statePaths
    ?? await discoverStatePaths(path.join(oracleHome, 'state', 'chatgpt-oracle'));
  const sessions: DoctorReport['sessions'] = [];
  try {
    for (const statePath of statePaths) sessions.push(await auditOracleState(statePath));
    checks.push({
      name: 'oracle-state', status: 'PASS', code: 'STATE_VALID',
      message: `Validated ${sessions.length} persisted Oracle state file(s).`,
    });
  } catch (error) {
    checks.push({
      name: 'oracle-state', status: 'FAIL', code: 'STATE_INVALID',
      message: error instanceof Error ? error.message : 'Oracle state is invalid.',
    });
    return DoctorReport.parse({
      schema: 'codex.chatgpt.agent-web-gpt-doctor/v1',
      status: 'FAIL', checks, sessions, locks_held: false,
      next_actions: ['Repair or restore the malformed state before recovery.'],
    });
  }

  if (normalized.recover) {
    const registry = new ProcessRegistry(path.join(oracleHome, 'processes.json'));
    const running = (await registry.list()).filter(record => (
      record.state === 'running' && record.project_root && path.resolve(record.project_root) === projectRoot
    ));
    if (running.length > 0) {
      const protectedOwners = new Set(sessions
        .filter(session => ['live', 'submitted_unknown'].includes(session.session_authority))
        .flatMap(session => [session.run_id, session.exact_slug].filter((value): value is string => Boolean(value))));
      const cleanableOwners = new Set(sessions
        .filter(session => ['pre_submit', 'terminal_observed', 'settled'].includes(session.session_authority))
        .flatMap(session => [session.run_id, session.exact_slug].filter((value): value is string => Boolean(value))));
      const candidate = running.find(record => (
        !protectedOwners.has(record.run_id ?? '') && !protectedOwners.has(record.exact_slug ?? '')
        && (
          !pidIsAlive(record.pid)
          || cleanableOwners.has(record.run_id ?? '')
          || cleanableOwners.has(record.exact_slug ?? '')
        )
      ));
      if (!candidate) {
        let ownershipProbe;
        try {
          ownershipProbe = await new LockManager({ projectRoot, retries: 0 }).tryAcquire();
        } catch (error) {
          checks.push({
            name: 'project-lock', status: 'FAIL', code: 'PROJECT_LOCK_PROBE_FAILED',
            message: error instanceof Error ? error.message : 'Project lock probe failed.',
          });
          return DoctorReport.parse({
            schema: 'codex.chatgpt.agent-web-gpt-doctor/v1', status: 'FAIL', checks, sessions,
            locks_held: false, next_actions: ['Repair the lock storage error before process recovery.'],
            recovery_action: { kind: 'process_cleanup', status: 'FAILED', detail: 'Project lock probe failed.' },
          });
        }
        const actuallyHeld = !ownershipProbe.held;
        if (ownershipProbe.held) await ownershipProbe.release();
        return DoctorReport.parse({
          schema: 'codex.chatgpt.agent-web-gpt-doctor/v1', status: 'BLOCKED', checks, sessions,
          locks_held: actuallyHeld,
          next_actions: ['Continue observing the recorded exact live/submitted-unknown owner; it was not stopped.'],
          recovery_action: { kind: 'process_cleanup', status: 'BLOCKED', detail: 'No unowned recorded process belongs to this exact project.' },
        });
      }
      let cleanupLock;
      try {
        cleanupLock = await new LockManager({ projectRoot, retries: 0 }).tryAcquire();
      } catch (error) {
        checks.push({
          name: 'project-lock', status: 'FAIL', code: 'PROJECT_LOCK_PROBE_FAILED',
          message: error instanceof Error ? error.message : 'Project lock probe failed.',
        });
        return DoctorReport.parse({
          schema: 'codex.chatgpt.agent-web-gpt-doctor/v1', status: 'FAIL', checks, sessions,
          locks_held: false, next_actions: ['Repair the lock storage error before process recovery.'],
          recovery_action: { kind: 'process_cleanup', status: 'FAILED', detail: 'Project lock probe failed.' },
        });
      }
      if (!cleanupLock.held) {
        return DoctorReport.parse({
          schema: 'codex.chatgpt.agent-web-gpt-doctor/v1', status: 'BLOCKED', checks, sessions,
          locks_held: true, next_actions: ['Wait for the exact project owner; no process was stopped.'],
          recovery_action: { kind: 'process_cleanup', status: 'BLOCKED', detail: 'Exact project lock is owned.' },
        });
      }
      try {
        if (pidIsAlive(candidate.pid)) await terminatePersistedProcess(candidate);
        await registry.upsert({ ...candidate, state: 'cleaned' });
      } finally {
        await cleanupLock.release();
      }
      checks.push({ name: 'process-registry', status: 'PASS', code: 'PROCESS_TREE_CLEANED', message: `Cleaned recorded process ${candidate.id}.` });
      return DoctorReport.parse({
        schema: 'codex.chatgpt.agent-web-gpt-doctor/v1', status: 'PASS', checks, sessions,
        locks_held: false, next_actions: ['Rerun doctor --recover to continue with exact-session recovery.'],
        recovery_action: { kind: 'process_cleanup', status: 'COMPLETED', detail: `Cleaned ${candidate.id}.` },
      });
    }
  }

  const lockProbe = new LockManager({ projectRoot, retries: 0 });
  let probe;
  try {
    probe = await lockProbe.tryAcquire();
  } catch (error) {
    checks.push({
      name: 'project-lock', status: 'FAIL', code: 'PROJECT_LOCK_PROBE_FAILED',
      message: error instanceof Error ? error.message : 'Project lock probe failed.',
    });
    return DoctorReport.parse({
      schema: 'codex.chatgpt.agent-web-gpt-doctor/v1', status: 'FAIL', checks, sessions,
      locks_held: false, next_actions: ['Repair the lock storage error before recovery.'],
    });
  }
  const locksHeld = !probe.held;
  if (probe.held && !normalized.recover) await probe.release();
  checks.push({
    name: 'project-lock', status: locksHeld ? 'BLOCKED' : 'PASS',
    code: locksHeld ? 'PROJECT_LOCK_HELD' : 'PROJECT_LOCK_AVAILABLE',
    message: locksHeld
      ? 'The exact project lock is owned; doctor did not release it.'
      : 'The exact project lock is available.',
  });
  if (locksHeld) {
    nextActions.push('Continue or settle the exact owned session; doctor did not release its lock.');
  }


  if (normalized.recover && probe.held) {
    try {
      const recoverable = sessions.find(session => (
        session.state_schema === 'oracle-run'
        && session.exact_slug && ['submitted_unknown', 'live', 'terminal_observed'].includes(session.session_authority)
      ));
      if (recoverable) {
        const action = recoverable.session_authority === 'terminal_observed' ? 'harvest' : 'live';
        const plan = await planExactRecovery(recoverable.state_path, action);
        const result = await executeExactRecovery(plan);
        const completed = result.status === 'complete';
        return DoctorReport.parse({
          schema: 'codex.chatgpt.agent-web-gpt-doctor/v1',
          status: completed ? 'PASS' : 'BLOCKED', checks, sessions, locks_held: false,
          next_actions: completed
            ? ['Audit the updated exact-session output and persisted state.']
            : ['Preserve the exact run and repeat exact-session observation; never resubmit.'],
          recovery_action: {
            kind: 'exact_session_recovery', status: completed ? 'COMPLETED' : 'BLOCKED',
            detail: `${action} ${plan.locator} exited ${result.exit_code}.`,
          },
        });
      }
      const workflowOnly = sessions.find(session => (
        session.state_schema === 'workflow' && session.exact_slug
        && ['submitted_unknown', 'live', 'terminal_observed'].includes(session.session_authority)
      ));
      if (workflowOnly) {
        return DoctorReport.parse({
          schema: 'codex.chatgpt.agent-web-gpt-doctor/v1', status: 'BLOCKED', checks, sessions,
          locks_held: false,
          next_actions: ['Locate the bound Oracle run state for this workflow before exact-session recovery.'],
          recovery_action: {
            kind: 'exact_session_recovery', status: 'BLOCKED',
            detail: `Workflow ${workflowOnly.run_id} has no bound Oracle run-state command.`,
          },
        });
      }
    } finally {
      await probe.release();
    }
  }

  return DoctorReport.parse({
    schema: 'codex.chatgpt.agent-web-gpt-doctor/v1',
    status: locksHeld ? 'BLOCKED' : 'PASS',
    checks, sessions, locks_held: locksHeld, next_actions: nextActions,
  });
}
