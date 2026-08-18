import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';
import { LockManager } from '../state/locks.js';
import { ProcessRegistry, terminatePersistedProcess } from '../process/registry.js';
import { parseTaskOutcome, OracleRunStateSchema, type OracleRunState, type SessionAuthority } from '../../types/index.js';

export interface DevSpaceQualifier { qualify(root: string, manifest?: string): Promise<{ ok: boolean; reason?: string }> }
export interface RunOptions { projectRoot: string; missionPath: string; runRoot?: string; oracleCommand?: string[]; oracleArgs?: string[]; manifestPath?: string; localGate?: string[]; oracleHome?: string; devspace?: DevSpaceQualifier; runId?: string }
export interface RunResult { statePath: string; state: OracleRunState }
const sha = (b: Buffer|string) => createHash('sha256').update(b).digest('hex');
async function exactDir(p: string) { const s = await lstat(p).catch(() => undefined); if (!s?.isDirectory() || s.isSymbolicLink()) throw new Error('PROJECT_ROOT_INVALID'); return path.resolve(p); }
async function exactFile(p: string) { const s = await lstat(p).catch(() => undefined); if (!s?.isFile() || s.isSymbolicLink()) throw new Error('MISSION_PATH_INVALID'); const b=await readFile(p); new TextDecoder('utf-8',{fatal:true}).decode(b); return b; }
export async function runOracle(options: RunOptions): Promise<RunResult> {
  const root = await exactDir(options.projectRoot); const mission = path.resolve(options.missionPath);
  if (!path.relative(root, mission) || path.relative(root, mission).startsWith('..')) throw new Error('MISSION_ROOT_MISMATCH');
  const bytes = await exactFile(mission); const runId = options.runId ?? `run-${randomUUID()}`;
  const dir = path.resolve(options.runRoot ?? path.join(root, '.awgpt', runId)); await mkdir(dir,{recursive:true});
  const statePath = path.join(dir,'state.json');
  const initial: OracleRunState = { schema:'codex.chatgpt.oracle-run-state/v1', run_id:runId, project_root:root, mission_path:mission, mode:'browser', session_authority:'pre_submit', transport_status:'pending', task_outcome:'pending' };
  const lock = new LockManager({ projectRoot: root }); const release = await lock.acquire();
  let retainLock = false;
  try {
    await writeFile(statePath, JSON.stringify(initial,null,2)+'\n');
    if (options.devspace) { const q=await options.devspace.qualify(root, options.manifestPath); if (!q.ok) { const failed={...initial,session_authority:'settled' as SessionAuthority,transport_status:'failed' as const}; await writeFile(statePath,JSON.stringify(failed,null,2)); return {statePath,state:failed}; } }
    if (options.localGate) { const gate=await execa(options.localGate[0], options.localGate.slice(1),{cwd:root,shell:false,reject:false}); if (gate.exitCode!==0) throw new Error('LOCAL_GATE_FAILED'); }
    const command = options.oracleCommand ?? ['oracle']; const args=[...command.slice(1), ...(options.oracleArgs??[]), '--project-root',root,'--mission',mission,'--run-id',runId];
    const child=execa(command[0],args,{cwd:root,shell:false,reject:false,env:{...process.env, ...(options.oracleHome?{ORACLE_HOME:options.oracleHome}:{})}});
    const registry = new ProcessRegistry(path.join(dir,'processes.json'));
    if (child.pid) await registry.upsert({id:runId,pid:child.pid,command:command[0],args,cwd:root,project_root:root,run_id:runId,started_at:new Date().toISOString(),state:'running'});
    const out=await child;
    if (child.pid) { const rec=(await registry.list()).find(r=>r.id===runId); if(rec) await registry.upsert({...rec,state:'exited'}); }
    const stdout=out.stdout??''; const stderr=out.stderr??''; await writeFile(path.join(dir,'stdout.log'),stdout); await writeFile(path.join(dir,'stderr.log'),stderr);
    let outcome:'EXECUTED'|'NOT_EXECUTED'|'BLOCKED'|'pending'='pending'; let authority: SessionAuthority=out.exitCode===0?'terminal_observed':'submitted_unknown';
    if (out.exitCode===0) { try { outcome=parseTaskOutcome(stdout).outcome; } catch { authority='submitted_unknown'; } }
    if (out.exitCode===0) await writeFile(path.join(dir,'output.md'), stdout);
    retainLock = (authority as SessionAuthority) === 'submitted_unknown' || (authority as SessionAuthority) === 'live';
    const state: OracleRunState={...initial,session_authority:authority,transport_status:out.exitCode===0?'complete':'failed',task_outcome:outcome,artifacts:{output:path.join(dir,'output.md'),transcript:path.join(dir,'transcript.md'),stdout:path.join(dir,'stdout.log'),stderr:path.join(dir,'stderr.log'),browser_temp:dir}};
    await writeFile(statePath,JSON.stringify(state,null,2)+'\n'); return {statePath,state};
  } finally { if (!retainLock) await release(); }
}
export async function loadRunState(statePath:string){ return OracleRunStateSchema.parse(JSON.parse(await readFile(path.resolve(statePath),'utf8'))) }
export async function stopRecorded(statePath:string): Promise<void> {
  const state = await loadRunState(statePath);
  if (!['live','submitted_unknown'].includes(state.session_authority)) throw new Error('STOP_UNSAFE_AUTHORITY');
  const registry = new ProcessRegistry(path.join(path.dirname(path.resolve(statePath)), 'processes.json'));
  const records = (await registry.list()).filter(r => r.run_id === state.run_id && path.resolve(r.project_root ?? '') === path.resolve(state.project_root) && r.state === 'running');
  if (records.length !== 1) throw new Error('STOP_OWNERSHIP_AMBIGUOUS');
  await terminatePersistedProcess(records[0]);
}
