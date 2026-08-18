import { readFile } from 'node:fs/promises';

export interface ContextInput { path: string; label?: string }
export interface PackedContext { schema: 'codex.chatgpt.context/v1'; files: Array<{ path: string; content: string }>; text: string }

export async function packContext(inputs: ContextInput[], maxBytes = 200_000): Promise<PackedContext> {
  const files: PackedContext['files'] = [];
  let used = 0;
  for (const input of inputs) {
    const content = await readFile(input.path, 'utf8');
    const bytes = Buffer.byteLength(content);
    if (used + bytes > maxBytes) break;
    files.push({ path: input.path, content }); used += bytes;
  }
  const text = files.map(f => `## ${f.path}\n\n${f.content}`).join('\n\n');
  return { schema: 'codex.chatgpt.context/v1', files, text };
}
