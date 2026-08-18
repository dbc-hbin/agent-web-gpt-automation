import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, existsSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
const root=process.cwd(), temp=mkdtempSync(join(tmpdir(),'awgpt-package-e2e-')); let cli,server;
const run=async (a,o={})=>{ try { const r=await promisify(execFile)(process.execPath,[cli,...a],{cwd:temp,encoding:'utf8',timeout:10000,...o}); return r.stdout; } catch (e) { e.stdout=e.stdout??''; e.stderr=e.stderr??''; throw e; } };
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
try {
 const packed=execFileSync('npm',['pack','--json','--pack-destination',temp],{cwd:root,encoding:'utf8'}); const p=JSON.parse(packed.slice(packed.indexOf('[')))[0];
 const tar=execFileSync('tar',['-tf',join(temp,p.filename)],{encoding:'utf8'}); const prefix=join(temp,'prefix');
 execFileSync('npm',['install','--prefix',prefix,'--ignore-scripts',join(temp,p.filename)],{cwd:root,stdio:'pipe'}); const installed=join(prefix,'node_modules','awgpt'); cli=join(installed,'dist','index.js');
 if(!(await run(['install','--help'])).includes('--source')) throw Error('packaged help missing lifecycle options');
 const manifest=JSON.parse(readFileSync(join(installed,'install-manifest.json'),'utf8')); const skills=manifest.include.filter(x=>x.startsWith('skills/')).map(x=>x.split('/')[1]); if(skills.length!==6) throw Error('skill manifest mismatch'); for(const s of skills) if(!tar.split('\n').includes(`package/skills/${s}/SKILL.md`)) throw Error(`tar missing ${s}`);
 const home=join(temp,'home'), install=JSON.parse(await run(['install','--agent-home',home])); if(!install.ok||install.count<6) throw Error('packaged install failed'); const receipt=JSON.parse(readFileSync(install.receipt,'utf8')); if(realpathSync(receipt.source_root)!==realpathSync(installed)) throw Error('wrong source_root');
 const project=join(temp,'project'); execFileSync('mkdir',['-p',project]); const mission=join(project,'mission.md'); writeFileSync(mission,'# smoke\n'); const counters={open:0,ls:0};
 server=createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{const n=JSON.parse(b).params.name;if(n==='open_workspace'){counters.open++;r.setHeader('content-type','application/json'); r.end(JSON.stringify({result:{allowedRoots:[project]}}));}else{counters.ls++;r.setHeader('content-type','application/json'); r.end(JSON.stringify({result:{entries:[]}}));}})}); await listen(server); const ep=`http://127.0.0.1:${server.address().port}/mcp`;
 const fake=join(temp,'oracle.mjs'), cf=join(temp,'oracle-counter'); writeFileSync(fake,"import {appendFileSync,writeFileSync} from 'node:fs'; if(process.argv.includes('--version')) { console.log('0.17.1'); process.exit(0); } appendFileSync(process.env.E2E_COUNTER,JSON.stringify(process.argv.slice(2))+'\\n'); const i=process.argv.indexOf('--write-output'); if(i>=0) writeFileSync(process.argv[i+1],'TASK_OUTCOME: EXECUTED\\n'); console.log('TASK_OUTCOME: EXECUTED');"); const env={...process.env,E2E_COUNTER:cf};
 const pos=JSON.parse(await run(['run','--project-root',project,'--mission',mission,'--devspace-url',ep,'--oracle-command',process.execPath,'--oracle-arg',fake],{env})); if(pos.state.task_outcome!=='EXECUTED'||counters.open!==1||counters.ls!==1||!existsSync(cf)) throw Error('positive E2E failed '+JSON.stringify({pos,counters,exists:existsSync(cf)}));
 const project2=join(temp,'project2'); execFileSync('mkdir',['-p',project2]); const mission2=join(project2,'mission.md'); writeFileSync(mission2,'# smoke\n'); const bad=createServer((q,r)=>{q.resume();q.on('end',()=>r.end(JSON.stringify({result:{allowedRoots:[]}})));}); await listen(bad); const nep=`http://127.0.0.1:${bad.address().port}/mcp`; const neg=JSON.parse(await run(['run','--project-root',project2,'--mission',mission2,'--devspace-url',nep,'--oracle-command',process.execPath,'--oracle-arg',fake],{env})); bad.close(); if(neg.state.transport_status!=='failed') throw Error('negative gate failed');
 const rec=await run(['recover','--state',pos.statePath,'--action','live']); if(!rec.includes('EXACT_SESSION')) throw Error('recovery evidence missing'); if(!JSON.parse(await run(['rollback','--agent-home',home])).ok) throw Error('rollback failed'); console.log(`package e2e ok (mcp_open=${counters.open}, mcp_ls=${counters.ls}, oracle=1, negative=1, recovery=1)`);
} finally {server?.close();rmSync(temp,{recursive:true,force:true});}
