import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { OracleSessionStateSchema } from '../../types/index.js';

const PROMPT_NOT_OBSERVED = 'Prompt did not appear in conversation before timeout (send may have failed)';
const NO_LIVE_TAB = 'No live ChatGPT tab matched session';
const NO_RECOVERABLE_URL = 'session metadata has no recoverable ChatGPT conversation URL';
const RECOVERY_STATE = /^\s*State:\s*[a-z][a-z0-9_-]*\s*$/im;

export interface NoSubmissionEvidence {
  schema: 'codex.chatgpt.no-submission-evidence/v1';
  run_id: string;
  project_root: string;
  oracle_locator: string;
  mission_sha256: string;
  stdout_sha256: string;
  stderr_sha256: string;
  recovery_evidence: Array<{
    stdout_name: string;
    stdout_sha256: string;
    stderr_name: string;
    stderr_sha256: string;
  }>;
  output_absent: true;
  conversation_url_absent: true;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exactRegularFile(candidate: string, expected: string): Promise<Buffer | undefined> {
  if (path.resolve(candidate) !== path.resolve(expected)) return undefined;
  try {
    const stat = await lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
    return await readFile(candidate);
  } catch {
    return undefined;
  }
}

function exactlyOne(text: string, pattern: RegExp): string | undefined {
  const matches = [...text.matchAll(pattern)];
  return matches.length === 1 ? matches[0][1] : undefined;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Proves only the narrow persisted no-submission case. A timeout by itself is
 * never evidence: the exact state, mission bytes, Oracle locator, empty output,
 * and at least one exact-session recovery miss must all agree.
 */
export async function proveNoSubmission(statePath: string): Promise<NoSubmissionEvidence | undefined> {
  const absoluteState = path.resolve(statePath);
  const runDir = path.dirname(absoluteState);
  const stateStat = await lstat(absoluteState).catch(() => undefined);
  if (!stateStat?.isFile() || stateStat.isSymbolicLink()) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(absoluteState, 'utf8'));
  } catch {
    return undefined;
  }
  const parsed = OracleSessionStateSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const state = parsed.data as typeof parsed.data & Record<string, unknown>;
  if (!['pre_submit', 'submitted_unknown'].includes(state.session_authority)) return undefined;
  if (state.terminal_harvested === true) return undefined;

  const oracle = (state.oracle ?? {}) as Record<string, unknown>;
  const locator = String(oracle.session_locator ?? oracle.slug ?? '').trim();
  const conversationUrl = String(oracle.conversation_url ?? '').trim();
  if (!locator || conversationUrl) return undefined;

  const artifacts = (state.artifacts ?? {}) as Record<string, unknown>;
  const outputPath = String(artifacts.output ?? path.join(runDir, 'output.md'));
  if (path.resolve(outputPath) !== path.join(runDir, 'output.md')) return undefined;
  const outputStat = await lstat(outputPath).catch(() => undefined);
  if (outputStat?.isSymbolicLink() || (outputStat?.isFile() && outputStat.size > 0)) return undefined;

  const stdoutPath = String(artifacts.stdout ?? '');
  const stderrPath = String(artifacts.stderr ?? '');
  const stdout = await exactRegularFile(stdoutPath, path.join(runDir, 'stdout.log'));
  const stderr = await exactRegularFile(stderrPath, path.join(runDir, 'stderr.log'));
  if (!stdout || !stderr) return undefined;
  let stdoutText: string;
  try {
    stdoutText = new TextDecoder('utf-8', { fatal: true }).decode(stdout);
    new TextDecoder('utf-8', { fatal: true }).decode(stderr);
  } catch {
    return undefined;
  }
  if (!stdoutText.includes(PROMPT_NOT_OBSERVED) || !stdoutText.includes(`Session: ${locator}`)) {
    return undefined;
  }

  const mission = state.mission as Record<string, unknown>;
  const transportPath = String(mission.transport_path ?? '');
  const missionBytes = await exactRegularFile(transportPath, path.join(runDir, 'mission.md'));
  if (!missionBytes || sha256(missionBytes) !== mission.sha256) return undefined;
  let missionText: string;
  try {
    missionText = new TextDecoder('utf-8', { fatal: true }).decode(missionBytes);
  } catch {
    return undefined;
  }
  const hostMarker = '[HOST_STAGE_CONTRACT]';
  const workspaceMarker = '[DEVSPACE_WORKSPACE_ENTRY_CONTRACT]';
  if (missionText.split(hostMarker).length !== 2 || missionText.split(workspaceMarker).length !== 2) return undefined;
  const hostStart = missionText.indexOf(hostMarker) + hostMarker.length;
  const workspaceStart = missionText.indexOf(workspaceMarker);
  if (workspaceStart <= hostStart) return undefined;
  const contract = missionText.slice(hostStart, workspaceStart);
  const workflowId = exactlyOne(contract, /^workflow_id=([a-f0-9]{32,64}|[a-f0-9-]{36})\r?$/gm);
  const attemptId = exactlyOne(contract, /^attempt_id=([a-f0-9]{32,64})\r?$/gm);
  const inputHash = exactlyOne(contract, /^input_mission_sha256=([a-f0-9]{64})\r?$/gm);
  const exactRoot = exactlyOne(contract, /^exact_project_root=([^\r\n]+)\r?$/gm);
  const inputMission = exactlyOne(contract, /^exact_input_mission_path=([^\r\n]+)\r?$/gm);
  const receiptPath = exactlyOne(contract, /^Write the small UTF-8 stage receipt to: ([^\r\n]+)\r?$/gm);
  if (!workflowId || !attemptId || !inputHash || !exactRoot || !inputMission || !receiptPath) return undefined;
  if (attemptId !== state.run_id || state.parallel_parent_id !== sha256(Buffer.from(workflowId))) return undefined;
  const canonicalRoot = path.resolve(state.project_root);
  if (path.resolve(exactRoot) !== canonicalRoot) return undefined;
  const rootStat = await lstat(canonicalRoot).catch(() => undefined);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return undefined;
  const sourceMissionPath = path.resolve(String(mission.path));
  const inputMissionPath = path.resolve(inputMission);
  const receipt = path.resolve(receiptPath);
  if (!isWithin(canonicalRoot, sourceMissionPath) || !isWithin(canonicalRoot, inputMissionPath) || !isWithin(canonicalRoot, receipt)) return undefined;
  const sourceMission = await exactRegularFile(sourceMissionPath, sourceMissionPath);
  const inputBytes = await exactRegularFile(inputMissionPath, inputMissionPath);
  if (!sourceMission || !inputBytes || !sourceMission.equals(missionBytes) || sha256(inputBytes) !== inputHash) return undefined;
  if (receipt !== path.join(path.dirname(sourceMissionPath), 'stage-result.json')) return undefined;

  const names = await readdir(runDir);
  const recoveryEvidence: NoSubmissionEvidence['recovery_evidence'] = [];
  for (const stdoutName of names.filter(name => /^recovery-.+-stdout\.log$/.test(name)).sort()) {
    const stderrName = stdoutName.replace(/-stdout\.log$/, '-stderr.log');
    const recoveryStdout = await exactRegularFile(path.join(runDir, stdoutName), path.join(runDir, stdoutName));
    const recoveryStderr = await exactRegularFile(path.join(runDir, stderrName), path.join(runDir, stderrName));
    if (!recoveryStdout || !recoveryStderr) return undefined;
    let combined: string;
    try {
      combined = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat([recoveryStdout, Buffer.from('\n'), recoveryStderr]),
      );
    } catch {
      return undefined;
    }
    if (
      RECOVERY_STATE.test(combined)
      || !combined.includes(NO_LIVE_TAB)
      || !combined.includes(`"${locator}"`)
      || !combined.includes(NO_RECOVERABLE_URL)
    ) return undefined;
    recoveryEvidence.push({
      stdout_name: stdoutName,
      stdout_sha256: sha256(recoveryStdout),
      stderr_name: stderrName,
      stderr_sha256: sha256(recoveryStderr),
    });
  }
  if (recoveryEvidence.length === 0) return undefined;

  return {
    schema: 'codex.chatgpt.no-submission-evidence/v1',
    run_id: state.run_id,
    project_root: state.project_root,
    oracle_locator: locator,
    mission_sha256: String(mission.sha256),
    stdout_sha256: sha256(stdout),
    stderr_sha256: sha256(stderr),
    recovery_evidence: recoveryEvidence,
    output_absent: true,
    conversation_url_absent: true,
  };
}
