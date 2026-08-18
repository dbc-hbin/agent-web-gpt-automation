import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOracle } from '../src/core/run/runtime.js';

async function fixture(output:string, code=0){ const d=await mkdtemp(join(tmpdir(),'awgpt-')); const root=join(d,'root'); await (await import('node:fs/promises')).mkdir(root); const mission=join(root,'mission.md'); await writeFile(mission,'hello','utf8'); const exe=join(d,'oracle.mjs'); await writeFile(exe,`process.stdout.write(${JSON.stringify(output)}); process.exit(${code})`); return {root,mission,exe}; }
describe('TypeScript runtime',()=>{
 it('qualifier failure launches zero Oracle processes',async()=>{ const f=await fixture('TASK_OUTCOME: EXECUTED\n'); let called=0; const r=await runOracle({projectRoot:f.root,missionPath:f.mission,oracleCommand:[process.execPath,f.exe],devspace:{qualify:async()=>{called++;return {ok:false}}}}); expect(called).toBe(1); expect(r.state.transport_status).toBe('failed'); });
 it('launches once and settles valid terminal output',async()=>{ const f=await fixture('TASK_OUTCOME: EXECUTED\n'); const r=await runOracle({projectRoot:f.root,missionPath:f.mission,oracleCommand:[process.execPath,f.exe]}); expect(r.state.session_authority).toBe('terminal_observed'); expect(r.state.task_outcome).toBe('EXECUTED'); expect(await readFile(r.state.artifacts!.output,'utf8')).toContain('TASK_OUTCOME'); });
 it('invalid marker does not settle',async()=>{ const f=await fixture('no marker\n'); const r=await runOracle({projectRoot:f.root,missionPath:f.mission,oracleCommand:[process.execPath,f.exe]}); expect(r.state.session_authority).toBe('submitted_unknown'); expect(r.state.task_outcome).toBe('pending'); });
 it('rejects mission symlink and traversal',async()=>{ const f=await fixture(''); const link=join(f.root,'link'); await symlink(f.mission,link); await expect(runOracle({projectRoot:f.root,missionPath:link,oracleCommand:[process.execPath,f.exe]})).rejects.toThrow('MISSION_PATH_INVALID'); await expect(runOracle({projectRoot:f.root,missionPath:join(f.root,'..','x'),oracleCommand:[process.execPath,f.exe]})).rejects.toThrow('MISSION_ROOT_MISMATCH'); });
});
