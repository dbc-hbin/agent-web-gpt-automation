import { execa } from 'execa';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { OracleSessionStateSchema, parseTaskOutcome, WorkflowRunStateSchema, receiptSha256, type WorkflowReceipt } from '../../types/index.js';
import { LockManager } from '../state/locks.js';
import { StateStore } from '../state/store.js';

export type RecoveryAction = 'live' | 'harvest';

async function assertSafeOutputPath(target: string, root: string): Promise<void> {
  const absolute = path.resolve(target);
  const rel = path.relative(path.resolve(root), absolute);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('RECOVERY_OUTPUT_OUTSIDE_RUN');
  let cursor = path.dirname(absolute);
  while (cursor !== path.dirname(cursor)) {
    const stat = await lstat(cursor).catch(() => undefined);
    if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) throw new Error('RECOVERY_OUTPUT_PARENT_INVALID');
    if (cursor === path.resolve(root)) break;
    cursor = path.dirname(cursor);
  }
  const existing = await lstat(absolute).catch(() => undefined);
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('RECOVERY_OUTPUT_INVALID');
}

export interface ExactRecoveryPlan {
  run_id: string;
  project_root: string;
  locator: string;
  action: RecoveryAction;
  argv: string[];
  output_path: string;
  state_path: string;
  authoritative_output_path: string;
}

function validateOracleCommand(command: readonly string[]): string[] {
  if (!command.length || command.some(part => !part)) throw new Error('ORACLE_COMMAND_INVALID');
  const executable = path.basename(command[0]).toLowerCase();
  if (['oracle', 'oracle.cmd', 'oracle.exe'].includes(executable) && command.length === 1) return [...command];
  if (['npx', 'npx.cmd', 'npx.exe'].includes(executable)) {
    const tail = command.slice(1).join('\0');
    if ([
      '-y\0@steipete/oracle@0.17.1', '--yes\0@steipete/oracle@0.17.1', '@steipete/oracle@0.17.1',
    ].includes(tail)) return [...command];
  }
  throw new Error('ORACLE_COMMAND_FORBIDDEN');
}

export function recoveryArgv(
  command: readonly string[], locator: string, action: RecoveryAction, outputPath: string,
): string[] {
  if (command.length === 0 || !locator.trim()) throw new Error('SESSION_LOCATOR_MISSING');
  if (action !== 'live' && action !== 'harvest') throw new Error('RECOVERY_ACTION_INVALID');
  const argv = [...command, 'session', locator, `--${action}`, '--write-output', outputPath];
  if (argv.includes('restart') || argv.includes('--prompt') || argv.includes('-p')) {
    throw new Error('RECOVERY_COMMAND_UNSAFE');
  }
  return argv;
}

export async function planExactRecovery(
  statePath: string, action: RecoveryAction = 'live', oracleCommand?: readonly string[],
): Promise<ExactRecoveryPlan> {
  const absolute = path.resolve(statePath);
  const parsedRaw = JSON.parse(await readFile(absolute, 'utf8')) as Record<string, unknown>;
  const { status: _status3, exit_code: _exitCode3, terminal_harvested: _harvested3, artifact_sha256: _artifactSha3, ...parsedEnvelope } = parsedRaw;
  const state = OracleSessionStateSchema.parse(parsedEnvelope);
  if (['settled','terminal_observed'].includes(state.session_authority) || state.terminal_harvested === true) throw new Error('RECOVERY_ALREADY_SETTLED');
  const mission = (state.mission ?? {}) as Record<string, unknown>;
  if (typeof mission.path !== 'string' || typeof mission.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(mission.sha256)) throw new Error('RECOVERY_MISSION_INVALID');
  const root = await realpath(path.resolve(state.project_root)).catch(() => { throw new Error('RECOVERY_PROJECT_ROOT_INVALID'); });
  const rootStat = await lstat(path.resolve(state.project_root));
  if (rootStat.isSymbolicLink()) throw new Error('RECOVERY_PROJECT_ROOT_INVALID');
  const missionAbs = path.resolve(mission.path);
  const ms = await lstat(missionAbs).catch(() => undefined);
  if (!ms?.isFile() || ms.isSymbolicLink()) throw new Error('RECOVERY_MISSION_INVALID');
  const missionReal = await realpath(missionAbs);
  const relMission = path.relative(root, missionReal);
  if (relMission.startsWith('..') || path.isAbsolute(relMission)) throw new Error('RECOVERY_MISSION_ROOT_MISMATCH');
  const currentSha = createHash('sha256').update(await readFile(missionReal)).digest('hex');
  if (currentSha !== mission.sha256) throw new Error('RECOVERY_MISSION_MUTATED');
  const oracle = (state.oracle ?? {}) as Record<string, unknown>;
  const locator = String(oracle.session_locator ?? oracle.slug ?? '').trim();
  const storedCommand = Array.isArray(oracle.command)
    ? oracle.command.filter((part): part is string => typeof part === 'string' && part.length > 0)
    : [];
  const command = validateOracleCommand(oracleCommand ?? storedCommand);
  const runDir = path.dirname(absolute);
  const outputPath = path.join(runDir, `recovery-${action}-candidate.md`);
  const artifacts = (state.artifacts ?? {}) as Record<string, unknown>;
  const authoritativeOutput = path.resolve(String(artifacts.output ?? path.join(runDir, 'output.md')));
  const relativeOutput = path.relative(runDir, authoritativeOutput);
  if (!relativeOutput || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
    throw new Error('RECOVERY_OUTPUT_OUTSIDE_RUN');
  }
  await assertSafeOutputPath(outputPath, runDir);
  await assertSafeOutputPath(authoritativeOutput, runDir);
  return {
    run_id: state.run_id,
    project_root: root,
    locator,
    action,
    argv: recoveryArgv(command, locator, action, outputPath),
    output_path: outputPath,
    state_path: absolute,
    authoritative_output_path: authoritativeOutput,
  };
}

export async function executeExactRecovery(plan: ExactRecoveryPlan): Promise<{
  exit_code: number;
  stdout_path: string;
  stderr_path: string;
  output_nonempty: boolean;
  status: 'complete' | 'session_live' | 'terminal_observed' | 'attention_required';
  session_authority: string;
}> {
  const preRaw = JSON.parse(await readFile(plan.state_path, 'utf8')) as Record<string, unknown>;
  const { status: _status4, exit_code: _exitCode4, terminal_harvested: _harvested4, artifact_sha256: _artifactSha4, ...preEnvelope } = preRaw;
  const pre = OracleSessionStateSchema.parse(preEnvelope);
  if (['settled','terminal_observed'].includes(pre.session_authority) || pre.terminal_harvested === true) throw new Error('RECOVERY_ALREADY_SETTLED');
  const mission = (pre.mission ?? {}) as Record<string, unknown>;
  if (typeof mission.path === 'string' && typeof mission.sha256 === 'string') {
    const root = await realpath(plan.project_root);
    const missionPath = await realpath(mission.path).catch(() => { throw new Error('RECOVERY_MISSION_INVALID'); });
    const rel = path.relative(root, missionPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('RECOVERY_MISSION_ROOT_MISMATCH');
    const currentSha = createHash('sha256').update(await readFile(missionPath)).digest('hex');
    if (currentSha !== mission.sha256) throw new Error('RECOVERY_MISSION_MUTATED');
  }
  else throw new Error('RECOVERY_MISSION_INVALID');
  const runDir = path.dirname(plan.output_path);
  await mkdir(runDir, { recursive: true });
  await assertSafeOutputPath(plan.output_path, runDir);
  await assertSafeOutputPath(plan.authoritative_output_path, runDir);
  // Validate the persisted run identity before any dead-owner takeover.  The
  // lock sidecar is project-scoped, so the state file is the authority that
  // binds this recovery attempt to one exact run and slug.
  const preLockRaw = JSON.parse(await readFile(plan.state_path, 'utf8')) as Record<string, unknown>;
  // Accept the historical run envelope's additive result fields for the
  // identity check; StateStore remains strict for canonical v1 writes.
  const { status: _status, exit_code: _exitCode, terminal_harvested: _harvested, artifact_sha256: _artifactSha, ...preLockEnvelope } = preLockRaw;
  const preLockState = OracleSessionStateSchema.parse(preLockEnvelope);
  const preLockRoot = await realpath(path.resolve(preLockState.project_root)).catch(() => path.resolve(preLockState.project_root));
  if (preLockState.run_id !== plan.run_id || preLockRoot !== plan.project_root) {
    throw new Error('RECOVERY_STATE_IDENTITY_MUTATED');
  }
  const preLockOracle = (preLockRaw.oracle ?? {}) as Record<string, unknown>;
  if (String(preLockOracle.slug ?? preLockOracle.session_locator ?? '') !== plan.locator) {
    throw new Error('EXACT_SLUG_MUTATED');
  }
  const lock = new LockManager({ projectRoot: plan.project_root });
  let acquired = await lock.tryAcquire();
  if (!acquired.held) {
    // The original submitter deliberately retains the lock while authority is
    // unknown. If its persisted identity still matches this exact recovery
    // plan and the owner process is dead, atomically quarantine that owner
    // lock, then acquire it for this recovery attempt. Live or mismatched
    // owners remain blocked by tryAcquire/reclaim evidence checks.
    await lock.reclaimAbandoned('submitted_unknown', { recoveryTakeover: true });
    acquired = await lock.tryAcquire();
  }
  if (!acquired.held) throw new Error('RECOVERY_PROJECT_LOCK_HELD');
  const release = acquired.release;
  try {
  const stdoutPath = path.join(runDir, `recovery-${plan.action}-stdout.log`);
  const stderrPath = path.join(runDir, `recovery-${plan.action}-stderr.log`);
  const [command, ...args] = plan.argv;
  const result = await execa(command, args, {
    cwd: plan.project_root,
    reject: false,
    shell: false,
    stdin: 'ignore',
    env: { ...process.env },
  });
  await Promise.all([
    writeFile(`${stdoutPath}.tmp`, result.stdout, 'utf8').then(() => rename(`${stdoutPath}.tmp`, stdoutPath)),
    writeFile(`${stderrPath}.tmp`, result.stderr, 'utf8').then(() => rename(`${stderrPath}.tmp`, stderrPath)),
  ]);
  const candidateStat = await lstat(plan.output_path).catch(() => undefined);
  if (candidateStat && (!candidateStat.isFile() || candidateStat.isSymbolicLink())) throw new Error('RECOVERY_OUTPUT_INVALID');
  const output = candidateStat ? await readFile(plan.output_path) : Buffer.alloc(0);
  const stdout = result.stdout ?? '';
  const states = [...stdout.matchAll(/^\s*State:\s*([a-z][a-z0-9_-]*)\s*$/gim)];
  const observedState = states.at(-1)?.[1].toLowerCase();
  const urls = [...stdout.matchAll(/^\s*URL:\s*(https:\/\/chatgpt\.com\/c\/[^\s?#]+)\s*$/gim)];
  const observedUrl = urls.at(-1)?.[1];
  const liveStates = new Set(['running', 'streaming', 'thinking', 'active', 'stalled']);
  const terminalStates = new Set(['complete', 'completed', 'done', 'finished', 'failed', 'error', 'cancelled', 'canceled']);
  const raw = JSON.parse(await readFile(plan.state_path, 'utf8')) as Record<string, unknown>;
  const { status: _status2, exit_code: _exitCode2, terminal_harvested: _harvested2, artifact_sha256: _artifactSha2, ...stateEnvelope } = raw;
  const before = OracleSessionStateSchema.parse(stateEnvelope);
  const beforeRoot = await realpath(path.resolve(before.project_root)).catch(() => path.resolve(before.project_root));
  if (before.run_id !== plan.run_id || beforeRoot !== plan.project_root) {
    throw new Error('RECOVERY_STATE_IDENTITY_MUTATED');
  }
  const oracle = { ...((raw.oracle ?? {}) as Record<string, unknown>) };
  if (String(oracle.slug ?? oracle.session_locator ?? '') !== plan.locator) throw new Error('EXACT_SLUG_MUTATED');
  const priorAuthority = before.session_authority === 'terminal' ? 'terminal_observed' : before.session_authority;
  const persistedUrl = String(oracle.conversation_url ?? '').trim();
  if (persistedUrl && observedUrl && persistedUrl !== observedUrl) throw new Error('RECOVERY_CONVERSATION_URL_CONFLICT');
  if (observedUrl) oracle.conversation_url = observedUrl;

  let status: 'complete' | 'session_live' | 'terminal_observed' | 'attention_required' = 'attention_required';
  let authority: string = priorAuthority;
  let taskOutcome = String(raw.task_outcome ?? 'pending');
  let harvested = false;
  if (observedState && liveStates.has(observedState)) {
    if (['terminal_observed', 'settled'].includes(priorAuthority)) {
      status = 'attention_required';
    } else {
      authority = 'live';
      status = 'session_live';
    }
  } else if (observedState && terminalStates.has(observedState)) {
    let semanticOutput = false;
    if (result.exitCode === 0 && output.length > 0) {
      try {
        const contract = String(raw.task_outcome_contract ?? 'legacy');
        if (contract === 'v1') {
          const parsed = parseTaskOutcome(new TextDecoder('utf-8', { fatal: true }).decode(output));
          taskOutcome = parsed.outcome;
        } else {
          taskOutcome = 'legacy_unclassified';
        }
        semanticOutput = true;
      } catch {
        semanticOutput = false;
      }
    }
    if (semanticOutput) {
      const destinationStat = await lstat(plan.authoritative_output_path).catch(() => undefined);
      if (destinationStat && (!destinationStat.isFile() || destinationStat.isSymbolicLink())) throw new Error('RECOVERY_OUTPUT_INVALID');
      if (destinationStat) throw new Error('RECOVERY_OUTPUT_ALREADY_AUTHORITATIVE');
      await rename(plan.output_path, plan.authoritative_output_path);
      authority = 'settled';
      status = ['EXECUTED', 'legacy_unclassified'].includes(taskOutcome) ? 'complete' : 'attention_required';
      harvested = true;
    } else {
      await rm(plan.output_path, { force: true });
      authority = priorAuthority === 'settled' ? 'settled' : 'terminal_observed';
      status = 'terminal_observed';
    }
  }

  const updated: Record<string, unknown> = {
    ...raw,
    oracle,
    status: status === 'session_live' ? 'running' : status === 'complete' ? 'complete' : 'attention_required',
    exit_code: result.exitCode ?? 1,
    session_authority: authority,
    terminal_harvested: harvested,
    transport_status: harvested ? 'complete' : status === 'session_live' ? 'pending' : 'failed',
    task_outcome: harvested ? taskOutcome : 'pending',
    artifact_sha256: harvested
      ? createHash('sha256').update(await readFile(plan.authoritative_output_path)).digest('hex')
      : undefined,
  };
  const { status: _status5, exit_code: _exitCode5, terminal_harvested: _harvested5, artifact_sha256: _artifactSha5, ...updatedEnvelope } = updated;
  OracleSessionStateSchema.parse(updatedEnvelope);
  try {
    await new StateStore(plan.state_path).write(updated as any, { explicitSettle: harvested });
  } catch (error) {
    // Older recovery fixtures may contain the pre-v1 run envelope; preserve
    // the monotonic authority guard for canonical state while retaining the
    // historical envelope's atomic write compatibility.
    if (!(error instanceof Error) || (!error.message.includes('Invalid input') && !error.message.includes('unrecognized_keys'))) throw error;
    await writeFileAtomic(plan.state_path, `${JSON.stringify(updated, null, 2)}\n`, { fsync: true });
  }
  if (harvested) {
    const workflowPath = path.join(path.dirname(plan.state_path), 'workflow.json');
    const workflowRaw = await readFile(workflowPath, 'utf8').catch(() => undefined);
    if (!workflowRaw) {
      return {
        exit_code: result.exitCode ?? 1, stdout_path: stdoutPath, stderr_path: stderrPath,
        output_nonempty: harvested, status, session_authority: authority,
      };
    }
    const workflow = WorkflowRunStateSchema.parse(JSON.parse(workflowRaw));
    const previous = workflow.receipts.at(-1);
    if (!previous) throw new Error('RECOVERY_WORKFLOW_MISSING_RECEIPT');
    const artifactHash = String(updated.artifact_sha256);
    const receipt: WorkflowReceipt = {
      receipt_id: randomUUID(), run_id: workflow.run_id, stage: 'recovery', status: 'completed',
      input_sha256: previous.output_sha256, output_sha256: artifactHash,
      previous_receipt_sha256: receiptSha256(previous), next_stage: status === 'complete' ? 'complete' : 'attention_required',
      prologue: { ...previous.prologue, semantic_revision: previous.prologue.semantic_revision + 1 }, external_actions: [{ kind: 'oracle', status: 'completed' }],
      recovery: { session_authority: 'settled', attempt: previous.recovery.attempt + 1, exact_slug: plan.locator },
    };
    const next = { ...workflow, stage: receipt.next_stage, session_authority: 'settled' as const,
      task_outcome: taskOutcome as any, revision: workflow.revision + 1, receipts: [...workflow.receipts, receipt] };
    await new StateStore(workflowPath).write(next, { explicitSettle: true });
  }
  return {
    exit_code: result.exitCode ?? 1,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    output_nonempty: harvested,
    status,
    session_authority: authority,
  };
  } finally { await release(); }
}
