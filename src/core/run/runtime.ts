import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';
import { LockManager } from '../state/locks.js';
import { ProcessRegistry, terminatePersistedProcess } from '../process/registry.js';
import { parseTaskOutcome, OracleRunStateSchema, OracleManifestSchema, receiptSha256, type OracleRunState, type SessionAuthority, type WorkflowRunState } from '../../types/index.js';
import { StateStore } from '../state/store.js';

export interface DevSpaceQualifier { qualify(root: string, manifest?: string): Promise<{ ok: boolean; reason?: string }> }
export interface RunOptions { projectRoot: string; missionPath: string; runRoot?: string; oracleCommand?: string[]; oracleArgs?: string[]; manifestPath?: string; localGate?: string[]; oracleHome?: string; devspace?: DevSpaceQualifier; runId?: string; dryRun?: boolean }
export interface RunResult { statePath: string; state: OracleRunState }
const sha = (b: Buffer|string) => createHash('sha256').update(b).digest('hex');
async function exactDir(p: string) { const s = await lstat(p).catch(() => undefined); if (!s?.isDirectory() || s.isSymbolicLink()) throw new Error('PROJECT_ROOT_INVALID'); return await realpath(p); }
async function exactFile(p: string) { const s = await lstat(p).catch(() => undefined); if (!s?.isFile() || s.isSymbolicLink()) throw new Error('MISSION_PATH_INVALID'); const b=await readFile(p); new TextDecoder('utf-8',{fatal:true}).decode(b); return b; }
export async function runOracle(options: RunOptions): Promise<RunResult> {
  const root = await exactDir(options.projectRoot); const requestedMission = path.resolve(options.missionPath);
  const requestedRel = path.relative(path.resolve(options.projectRoot), requestedMission);
  if (requestedRel === '..' || requestedRel.startsWith(`..${path.sep}`) || path.isAbsolute(requestedRel)) throw new Error('MISSION_ROOT_MISMATCH');
  const requestedStat = await lstat(requestedMission).catch(() => undefined);
  if (!requestedStat?.isFile() || requestedStat.isSymbolicLink()) throw new Error('MISSION_PATH_INVALID');
  const mission = await realpath(requestedMission).catch(() => { throw new Error('MISSION_PATH_INVALID'); });
  const rel = path.relative(root, mission);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('MISSION_ROOT_MISMATCH');
  const bytes = await exactFile(mission); const runId = options.runId ?? `run-${randomUUID()}`;
  let manifest: any;
  if (options.manifestPath) { const mp=path.resolve(options.manifestPath); const ms=await lstat(mp).catch(()=>undefined); if(!ms?.isFile()||ms.isSymbolicLink()) throw new Error('MANIFEST_PATH_INVALID'); manifest = OracleManifestSchema.parse(JSON.parse(await readFile(await realpath(mp),'utf8'))); if (path.resolve(manifest.project_root)!==root || path.resolve(manifest.mission_path)!==mission) throw new Error('MANIFEST_BINDING_MISMATCH'); }
  const dir = path.resolve(options.runRoot ?? path.join(root, '.awgpt', runId));
  await mkdir(path.dirname(dir), { recursive: true });
  await mkdir(dir,{recursive:false}).catch((e: any) => { if (e.code === 'EEXIST') throw new Error('RUN_ID_COLLISION'); throw e; });
  const statePath = path.join(dir,'state.json');
  const workflowPath = path.join(dir,'workflow.json');
  const stateStore = new StateStore(statePath);
  const slug = `run-${sha(bytes).slice(0,4)}-${sha(runId).slice(0,4)}-${sha(root).slice(0,4)}`;
  const defaultCommand = process.platform === 'win32' ? ['npx.cmd','--yes','@steipete/oracle@0.17.1'] : ['npx','--yes','@steipete/oracle@0.17.1'];
  const command = manifest?.oracle_command ?? options.oracleCommand ?? defaultCommand;
  if (manifest?.oracle_command && options.oracleCommand && JSON.stringify(manifest.oracle_command) !== JSON.stringify(options.oracleCommand)) throw new Error('ORACLE_COMMAND_CONFLICT');
  if (manifest?.oracle_args && options.oracleArgs && JSON.stringify(manifest.oracle_args) !== JSON.stringify(options.oracleArgs)) throw new Error('ORACLE_ARGS_CONFLICT');
  const oracleArgs = manifest?.oracle_args ?? options.oracleArgs ?? [];
  const versionCheck = await execa(command[0], [...command.slice(1), ...oracleArgs, '--version'], { cwd: root, shell: false, reject: false });
  const version = `${versionCheck.stdout}\n${versionCheck.stderr}`.trim();
  if (versionCheck.exitCode !== 0 || !/(^|\n|\s)v?0\.17\.1(?:\s|$)/.test(version) || /0\.17\.1-(?:beta|rc|alpha)/i.test(version)) throw new Error('ORACLE_VERSION_UNSUPPORTED');
  const outputPath = path.join(dir,'output.md');
  if (manifest?.copy_profile) { const s=await lstat(manifest.copy_profile).catch(()=>undefined); if (!s || s.isSymbolicLink() || !s.isDirectory()) throw new Error('COPY_PROFILE_INVALID'); }
  if (manifest?.attachments) for (const attachment of manifest.attachments) { const s=await lstat(attachment).catch(()=>undefined); if (!s || s.isSymbolicLink() || !s.isFile()) throw new Error('ATTACHMENT_INVALID'); }
  const initial: OracleRunState = { schema:'codex.chatgpt.oracle-run-state/v1', run_id:runId, project_root:root, mission_path:mission, mission_sha256:sha(bytes), mission:{path:mission,sha256:sha(bytes)}, mode:'browser', session_authority:'pre_submit', transport_status:'pending', task_outcome:'pending', oracle:{resolved_version:'0.17.1',session_locator:slug,slug,command} };
  if (options.dryRun) return { statePath, state: initial };
  const lock = new LockManager({ projectRoot: root }); const release = await lock.acquire();
  let retainLock = false;
  try {
    await stateStore.write(initial);
    const wfBase: WorkflowRunState = { schema:'codex.chatgpt.oracle-workflow/v1', run_id:runId, project_root:root, mission_path:mission, profile:'default', stage:'plan', session_authority:'pre_submit', task_outcome:'pending', revision:0, receipts:[] };
    await new StateStore(workflowPath).write(wfBase);
    const preSubmitFailure = async (reason: string) => {
      const failed={...initial,session_authority:'settled' as SessionAuthority,transport_status:'failed' as const,task_outcome:'NOT_EXECUTED' as const};
      const receipt = { receipt_id: randomUUID(), run_id: runId, stage:'plan' as const, status:'failed' as const, input_sha256: sha(bytes), output_sha256: sha(reason), previous_receipt_sha256:null, next_stage:'attention_required' as const, prologue:{project_root:root,mission_sha256:sha(bytes),profile:'default' as const,semantic_revision:0}, external_actions:[{kind:(reason === 'LOCAL_GATE_FAILED' ? 'local_gate' : 'devspace') as 'local_gate'|'devspace',status:'failed' as const}], recovery:{session_authority:'settled' as const,attempt:0,exact_slug:slug} };
      await new StateStore(workflowPath).write({...wfBase,stage:'attention_required',session_authority:'settled',task_outcome:'NOT_EXECUTED',receipts:[receipt]}, { explicitSettle: true });
      await stateStore.write(failed, { explicitSettle: true });
      return {statePath,state:failed};
    };
    if (options.devspace) { const q=await options.devspace.qualify(root, options.manifestPath); if (!q.ok) return await preSubmitFailure(q.reason ?? 'QUALIFICATION_FAILED'); }
    if (options.localGate) { const gate=await execa(options.localGate[0], options.localGate.slice(1),{cwd:root,shell:false,reject:false}); if (gate.exitCode!==0) return await preSubmitFailure('LOCAL_GATE_FAILED'); }
    const args=[...command.slice(1), '--engine','browser','--slug',slug,'--prompt',bytes.toString('utf8'),'--write-output',outputPath,
      ...(manifest?.model ? ['--model',manifest.model] : []),
      ...(manifest?.model_strategy ? ['--browser-model-strategy',manifest.model_strategy] : []),
      ...(manifest?.research ? ['--browser-research',manifest.research] : []), ...(manifest?.archive ? ['--browser-archive',manifest.archive] : []),
      ...(manifest?.attachments ?? []).flatMap((a:string)=>['--attachment',a]), ...(manifest?.attachments ? ['--file', ...manifest.attachments] : []),
      ...(manifest?.copy_profile ? ['--copy-profile',manifest.copy_profile] : []), ...oracleArgs];
    const child=execa(command[0],args,{cwd:root,shell:false,reject:false,env:{...process.env, ...(options.oracleHome?{ORACLE_HOME:options.oracleHome}:{})}});
    const startedAt = new Date().toISOString();
    await stateStore.write({...initial, session_authority:'submitted_unknown', transport_status:'pending', process: child.pid ? { pid: child.pid, command: command[0], args, cwd: root, started_at: startedAt } : undefined }, { explicitSettle: false });
    const registry = new ProcessRegistry(path.join(dir,'processes.json'));
    if (child.pid) await registry.upsert({id:runId,pid:child.pid,command:command[0],args,cwd:root,project_root:root,run_id:runId,started_at:new Date().toISOString(),state:'running'});
    const out=await child;
    if (child.pid) { const rec=(await registry.list()).find(r=>r.id===runId); if(rec) await registry.upsert({...rec,state:'exited'}); }
    const stdout=out.stdout??''; const stderr=out.stderr??''; await writeFile(path.join(dir,'stdout.log'),stdout); await writeFile(path.join(dir,'stderr.log'),stderr);
    const durable = await readFile(outputPath).catch(() => Buffer.from(''));
    let outcome:'EXECUTED'|'NOT_EXECUTED'|'BLOCKED'|'pending'='pending'; let authority: SessionAuthority=out.exitCode===0?'terminal_observed':'submitted_unknown';
    if (out.exitCode===0) { try { outcome=parseTaskOutcome(durable.toString('utf8')).outcome; } catch { authority='submitted_unknown'; } }
    if (out.exitCode===0 && durable.length===0) authority='submitted_unknown';
    await writeFile(path.join(dir,'transcript.md'), stdout);
    if (authority === 'terminal_observed' && outcome !== 'pending') authority = 'settled';
    retainLock = ['submitted_unknown','live','terminal_observed'].includes(authority);
    const state: OracleRunState={...initial,session_authority:authority,transport_status: (authority === 'settled' || authority === 'terminal_observed') ? 'complete' : out.exitCode===0?'pending':'failed',task_outcome:outcome,process: child.pid ? {pid:child.pid,command:command[0],args} : undefined,artifacts:{output:outputPath,transcript:path.join(dir,'transcript.md'),stdout:path.join(dir,'stdout.log'),stderr:path.join(dir,'stderr.log'),browser_temp:dir}};
    const settled = authority === 'settled';
    const outputSha = sha(durable); const receipt = { receipt_id: randomUUID(), run_id: runId, stage:'plan' as const, status: settled?'completed' as const:'failed' as const, input_sha256: sha(bytes), output_sha256: outputSha, previous_receipt_sha256:null, next_stage: settled?'complete' as const:'attention_required' as const, prologue:{project_root:root,mission_sha256:sha(bytes),profile:'default' as const,semantic_revision:0}, external_actions:[{kind:'oracle' as const,status: settled?'completed' as const:'failed' as const}], recovery:{session_authority:authority,attempt:0,exact_slug:slug} };
    await new StateStore(workflowPath).write({...wfBase, stage:receipt.next_stage, session_authority:authority, task_outcome:outcome, receipts:[receipt]}, { explicitSettle: settled });
    await stateStore.write(state, { explicitSettle: authority === 'settled' }); return {statePath,state};
  } finally { if (!retainLock) await release(); }
}
export async function loadRunState(statePath:string){ return OracleRunStateSchema.parse(JSON.parse(await readFile(path.resolve(statePath),'utf8'))) }
export async function stopRecorded(statePath:string): Promise<void> {
  const state = await loadRunState(statePath);
  if (!['live','submitted_unknown'].includes(state.session_authority)) throw new Error('STOP_UNSAFE_AUTHORITY');
  const registry = new ProcessRegistry(path.join(path.dirname(path.resolve(statePath)), 'processes.json'));
  const records = (await registry.list()).filter(r => r.run_id === state.run_id && path.resolve(r.project_root ?? '') === path.resolve(state.project_root) && r.state === 'running');
  let record = records[0];
  // The registry can be lost while the run state remains durable.  In that
  // case recover the persisted PID, but only after proving its live command
  // identity (and process start time on POSIX) so a recycled PID is never
  // terminated accidentally.
  if (records.length === 0 && state.process) {
    const p = state.process;
    if (!p.started_at || !p.cwd) throw new Error('STOP_OWNERSHIP_AMBIGUOUS');
    let startedAt = p.started_at;
    if (process.platform !== 'win32') {
      const probe = await execa('ps', ['-p', String(p.pid), '-o', 'lstart='], { reject: false });
      if (probe.exitCode !== 0 || !probe.stdout.trim()) throw new Error('STOP_OWNERSHIP_AMBIGUOUS');
      const observed = Date.parse(probe.stdout.trim());
      if (!Number.isFinite(observed)) throw new Error('STOP_OWNERSHIP_AMBIGUOUS');
      startedAt = new Date(observed).toISOString();
    }
    record = { id: state.run_id, pid: p.pid, command: p.command, args: p.args,
      cwd: p.cwd, project_root: state.project_root, run_id: state.run_id,
      started_at: startedAt, state: 'running' };
  }
  if (!record || records.length > 1) throw new Error('STOP_OWNERSHIP_AMBIGUOUS');
  await terminatePersistedProcess(record);
  const settled = { ...state, session_authority: 'settled' as const, transport_status: 'failed' as const };
  await new StateStore(path.resolve(statePath)).write(settled, { explicitSettle: true });
  const workflowPath = path.join(path.dirname(path.resolve(statePath)), 'workflow.json');
  try {
    const workflow = await new StateStore(workflowPath).read() as WorkflowRunState;
    const previous = workflow.receipts.at(-1);
    if (previous) {
      const receipt = { receipt_id: randomUUID(), run_id: workflow.run_id, stage:'recovery' as const, status:'failed' as const,
        input_sha256: previous.output_sha256, output_sha256: sha('STOP_REQUESTED'), previous_receipt_sha256: receiptSha256(previous),
        next_stage:'attention_required' as const, prologue:{...previous.prologue, semantic_revision: workflow.revision + 1},
        external_actions:[{kind:'process' as const,status:'audited' as const}], recovery:{session_authority:'settled' as const,attempt:previous.recovery.attempt + 1,exact_slug: state.oracle?.slug} };
      await new StateStore(workflowPath).write({...workflow,stage:'attention_required',session_authority:'settled',task_outcome:'NOT_EXECUTED',revision:workflow.revision + 1,receipts:[...workflow.receipts, receipt]}, { explicitSettle: true });
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const lockManager = new LockManager({ projectRoot: state.project_root });
  if (await lstat(`${lockManager.getLockPath()}.owner.json`).catch(() => undefined)) {
    await lockManager.reclaimAbandoned('settled');
  }
}
