import { randomUUID } from 'node:crypto';
import type { DevSpaceClient } from './qualification.js';

export function createHttpDevSpaceClient(endpoint: string, fetcher: typeof fetch = fetch): DevSpaceClient {
  const url = new URL(endpoint).toString();
  async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }) });
    if (!response.ok) throw new Error(`DEVSPACE_HTTP_${response.status}`);
    const payload = await response.json() as { error?: { message?: string }; result?: unknown };
    if (payload.error) throw new Error(payload.error.message ?? 'DEVSPACE_RPC_ERROR');
    return payload.result;
  }
  return { open_workspace: args => call('open_workspace', args), list_directory: args => call('ls', args) };
}
