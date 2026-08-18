import { randomUUID } from 'node:crypto';
import type { DevSpaceClient } from './qualification.js';
type Rpc = { result?: unknown; error?: { code?: number; message?: string } };
export function createHttpDevSpaceClient(endpoint: string, fetcher: typeof fetch = fetch): DevSpaceClient {
  const url = new URL(endpoint).toString(); let session: string | undefined; let initialized = false;
  const headers = () => ({'content-type':'application/json',accept:'application/json, text/event-stream',...(session?{'mcp-session-id':session}:{})});
  async function parse(r:Response):Promise<Rpc>{const t=await r.text();if((r.headers.get('content-type')??'').includes('text/event-stream')){for(const l of t.split(/\r?\n/))if(l.startsWith('data:')){try{return JSON.parse(l.slice(5).trim()) as Rpc}catch{}}throw Error('DEVSPACE_MALFORMED_SSE')}try{return JSON.parse(t) as Rpc}catch{throw Error('DEVSPACE_MALFORMED_JSON')}}
  async function req(method:string,params?:unknown,notify=false):Promise<unknown>{const id=notify?undefined:randomUUID();const r=await fetcher(url,{method:'POST',headers:headers(),body:JSON.stringify({jsonrpc:'2.0',...(id?{id}:{}),method,...(params===undefined?{}:{params})})});const s=r.headers.get('mcp-session-id');if(s)session=s;if(!r.ok)throw Error(`DEVSPACE_HTTP_${r.status}`);if(notify||r.status===202||r.status===204)return;const x=await parse(r);if(x.error)throw Error(`DEVSPACE_RPC_${x.error.code??'ERROR'}:${x.error.message??'unknown'}`);return x.result}
  async function ensure(){if(initialized)return;await req('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'awgpt',version:'1.0.0'}});await req('notifications/initialized',undefined,true);initialized=true}
  async function call(name:string,args:Record<string,unknown>){await ensure();const result=await req('tools/call',{name,arguments:args});if(result&&typeof result==='object'&&(result as {isError?:boolean}).isError)throw Error('DEVSPACE_TOOL_ERROR');const c=(result as {content?:unknown}|undefined)?.content;if(Array.isArray(c)){const ts=c.filter((x):x is {text:string}=>!!x&&typeof x==='object'&&typeof (x as {text?:unknown}).text==='string');if(ts.length===1){try{return JSON.parse(ts[0].text)}catch{return ts[0].text}}if(ts.length)return ts.map(x=>x.text).join('\n')}return result}
  return {open_workspace:a=>call('open_workspace',a),list_directory:a=>call('ls',a)};
}
