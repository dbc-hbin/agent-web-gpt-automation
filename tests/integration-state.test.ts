import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { StateStore } from '../src/core/state/store.js';
import { createHttpDevSpaceClient } from '../src/core/devspace/http-client.js';

describe('integration persistence and DevSpace transport', () => {
  it('enforces monotonic authority through StateStore', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'awgpt-state-'));
    const store = new StateStore(path.join(dir, 'state.json'));
    const base = { schema:'codex.chatgpt.oracle-run-state/v1' as const, run_id:'run-test-1234', project_root:dir, mission_path:path.join(dir,'m.md'), mode:'browser' as const, session_authority:'pre_submit' as const, transport_status:'pending' as const, task_outcome:'pending' as const };
    await store.write(base);
    await expect(store.write({...base, session_authority:'settled', transport_status:'failed'}, {explicitSettle:true})).resolves.toBeUndefined();
    await expect(store.write({...base, session_authority:'pre_submit'})).rejects.toThrow();
  });

  it('uses JSON-RPC tools/call for exact DevSpace methods', async () => {
    const calls: any[] = [];
    let n=0;
    const client = createHttpDevSpaceClient('http://127.0.0.1:1', async (_u, init) => { const body=JSON.parse(String(init?.body)); calls.push(body); n++; if(n===1)return new Response(JSON.stringify({result:{protocolVersion:'2025-03-26'}}),{status:200,headers:{'mcp-session-id':'sess'}}); if(n===2)return new Response('',{status:202}); return new Response(JSON.stringify({result:{content:[{type:'text',text:JSON.stringify({allowedRoots:['/tmp/root']})}]}}),{status:200,headers:{'content-type':'application/json'}}); });
    await client.open_workspace({root:'/tmp/root'}); await client.list_directory({path:'/tmp/root'});
    expect(calls.map(c => c.method)).toEqual(['initialize','notifications/initialized','tools/call','tools/call']);
    expect(calls[2].params).toEqual({name:'open_workspace',arguments:{root:'/tmp/root'}});
    expect(calls[3].params.name).toBe('ls');
    expect(calls[2]).toBeTruthy();
  });

  it('parses SSE responses and propagates MCP tool errors', async () => {
    let n=0; const client=createHttpDevSpaceClient('http://mcp',async (_u,init)=>{n++; const b=JSON.parse(String(init?.body)); if(n===1)return new Response('event: message\ndata: {"result":{}}\n\n',{status:200,headers:{'content-type':'text/event-stream','mcp-session-id':'s'}}); if(n===2)return new Response('',{status:202}); expect(b.params.name).toBe('ls'); return new Response('data: {"result":{"isError":true,"content":[]}}\n\n',{status:200,headers:{'content-type':'text/event-stream'}})});
    await expect(client.list_directory({path:'/tmp'})).rejects.toThrow('DEVSPACE_TOOL_ERROR');
  });
});
