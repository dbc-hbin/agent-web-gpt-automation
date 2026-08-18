import { execa } from 'execa';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { OracleSessionStateSchema, parseTaskOutcome } from '../../types/index.js';

export type RecoveryAction = 'live' | 'harvest';

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
  const state = OracleSessionStateSchema.parse(JSON.parse(await readFile(absolute, 'utf8')));
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
  return {
    run_id: state.run_id,
    project_root: path.resolve(state.project_root),
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
  const pre = OracleSessionStateSchema.parse(preRaw);
  const mission = (pre.mission ?? {}) as Record<string, unknown>;
  if (typeof mission.path === 'string' && typeof mission.sha256 === 'string') {
    const root = await realpath(plan.project_root);
    const missionPath = await realpath(mission.path).catch(() => { throw new Error('RECOVERY_MISSION_INVALID'); });
    const rel = path.relative(root, missionPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('RECOVERY_MISSION_ROOT_MISMATCH');
    const currentSha = createHash('sha256').update(await readFile(missionPath)).digest('hex');
    if (currentSha !== mission.sha256) throw new Error('RECOVERY_MISSION_MUTATED');
  }
  const runDir = path.dirname(plan.output_path);
  await mkdir(runDir, { recursive: true });
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
  const output = await readFile(plan.output_path).catch(() => Buffer.alloc(0));
  const stdout = result.stdout ?? '';
  const states = [...stdout.matchAll(/^\s*State:\s*([a-z][a-z0-9_-]*)\s*$/gim)];
  const observedState = states.at(-1)?.[1].toLowerCase();
  const urls = [...stdout.matchAll(/^\s*URL:\s*(https:\/\/chatgpt\.com\/c\/[^\s?#]+)\s*$/gim)];
  const observedUrl = urls.at(-1)?.[1];
  const liveStates = new Set(['running', 'streaming', 'thinking', 'active', 'stalled']);
  const terminalStates = new Set(['complete', 'completed', 'done', 'finished', 'failed', 'error', 'cancelled', 'canceled']);
  const raw = JSON.parse(await readFile(plan.state_path, 'utf8')) as Record<string, unknown>;
  const before = OracleSessionStateSchema.parse(raw);
  if (before.run_id !== plan.run_id || path.resolve(before.project_root) !== plan.project_root) {
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
      if (destinationStat?.isSymbolicLink()) throw new Error('RECOVERY_OUTPUT_SYMLINK_FORBIDDEN');
      await rename(plan.output_path, plan.authoritative_output_path);
      authority = 'terminal_observed';
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
  OracleSessionStateSchema.parse(updated);
  await writeFileAtomic(plan.state_path, `${JSON.stringify(updated, null, 2)}\n`, { fsync: true });
  return {
    exit_code: result.exitCode ?? 1,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    output_nonempty: harvested,
    status,
    session_authority: authority,
  };
}
