import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { runOracle, stopRecorded, loadRunState } from '../src/core/run/runtime.js';

async function fixture(output:string, code=0){ const d=await mkdtemp(join(tmpdir(),'awgpt-')); const root=join(d,'root'); await (await import('node:fs/promises')).mkdir(root); const mission=join(root,'mission.md'); await writeFile(mission,'hello','utf8'); const exe=join(d,'oracle.cjs'); await writeFile(exe,`const fs=require('fs'); const a=process.argv; if(a.includes('--version')) { console.log('0.17.1'); process.exit(0); } const i=a.indexOf('--write-output'); if(i>=0) fs.writeFileSync(a[i+1],${JSON.stringify(output)}); process.stdout.write('observer'); process.exit(${code})`); return {root,mission,exe}; }
describe('TypeScript runtime',()=>{
 it('qualifier failure launches zero Oracle processes',async()=>{ const f=await fixture('TASK_OUTCOME: EXECUTED\n'); let called=0; const r=await runOracle({projectRoot:f.root,missionPath:f.mission,oracleCommand:[process.execPath,f.exe],devspace:{qualify:async()=>{called++;return {ok:false}}}}); expect(called).toBe(1); expect(r.state.transport_status).toBe('failed'); });
 it('launches once and settles valid terminal output',async()=>{ const f=await fixture('TASK_OUTCOME: EXECUTED\n'); const r=await runOracle({projectRoot:f.root,missionPath:f.mission,oracleCommand:[process.execPath,f.exe]}); expect(r.state.session_authority).toBe('settled'); expect(r.state.task_outcome).toBe('EXECUTED'); expect(await readFile(r.state.artifacts!.output,'utf8')).toContain('TASK_OUTCOME'); });
 it('invalid marker does not settle',async()=>{ const f=await fixture('no marker\n'); const r=await runOracle({projectRoot:f.root,missionPath:f.mission,oracleCommand:[process.execPath,f.exe]}); expect(r.state.session_authority).toBe('submitted_unknown'); expect(r.state.task_outcome).toBe('pending'); });
 it('rejects mission symlink and traversal',async()=>{ const f=await fixture(''); const link=join(f.root,'link'); await symlink(f.mission,link); await expect(runOracle({projectRoot:f.root,missionPath:link,oracleCommand:[process.execPath,f.exe]})).rejects.toThrow('MISSION_PATH_INVALID'); await expect(runOracle({projectRoot:f.root,missionPath:join(f.root,'..','x'),oracleCommand:[process.execPath,f.exe]})).rejects.toThrow('MISSION_ROOT_MISMATCH'); });
 it('stops from durable state.process when the registry is missing',async()=>{
   const f=await fixture(''); const child=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{cwd:f.root,detached:true,stdio:'ignore'});
   await mkdir(join(f.root,'.awgpt','run-fallback'),{recursive:true});
   const statePath=join(f.root,'.awgpt','run-fallback','state.json');
   await writeFile(statePath,JSON.stringify({schema:'codex.chatgpt.oracle-run-state/v1',run_id:'run-fallback',project_root:f.root,mission_path:f.mission,mission_sha256:'a'.repeat(64),mode:'browser',session_authority:'submitted_unknown',transport_status:'pending',task_outcome:'pending',oracle:{resolved_version:'0.17.1',session_locator:'slug',slug:'slug',command:[process.execPath]},process:{pid:child.pid,command:process.execPath,args:['-e','setTimeout(()=>{},60000)'],cwd:f.root,started_at:new Date().toISOString()}}));
   await stopRecorded(statePath); expect((await loadRunState(statePath)).session_authority).toBe('settled');
 });
});
