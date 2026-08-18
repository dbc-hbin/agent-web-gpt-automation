import { mkdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { z } from 'zod';
import { execa } from 'execa';
import * as lockFile from 'proper-lockfile';

export const PersistedProcessSchema = z.object({
  id: z.string().min(1),
  pid: z.number().int().positive(),
  command: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().min(1),
  project_root: z.string().min(1).optional(),
  started_at: z.string().datetime(),
  state: z.enum(['running', 'exited', 'signaled', 'cleaned']),
  run_id: z.string().min(1).optional(),
  exact_slug: z.string().min(1).optional(),
}).strict();
export type PersistedProcess = z.infer<typeof PersistedProcessSchema>;

const RegistrySchema = z.object({
  schema: z.literal('codex.chatgpt.process-registry/v1'),
  processes: z.array(PersistedProcessSchema),
}).strict();

export class ProcessRegistry {
  constructor(private readonly registryPath: string) {}

  async list(): Promise<PersistedProcess[]> {
    try {
      return RegistrySchema.parse(JSON.parse(await readFile(this.registryPath, 'utf8'))).processes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async upsert(process: PersistedProcess): Promise<void> {
    const parsed = PersistedProcessSchema.parse(process);
    await mkdir(path.dirname(this.registryPath), { recursive: true });
    const release = await lockFile.lock(this.registryPath, {
      realpath: false, retries: { retries: 20, minTimeout: 5, maxTimeout: 50 }, stale: 30_000,
    });
    try {
      const current = await this.list();
      const index = current.findIndex(item => item.id === parsed.id);
      if (index >= 0) current[index] = parsed;
      else current.push(parsed);
      await writeFileAtomic(this.registryPath, `${JSON.stringify({
        schema: 'codex.chatgpt.process-registry/v1', processes: current,
      }, null, 2)}\n`, { fsync: true });
    } finally {
      await release();
    }
  }
}

export function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function terminatePersistedProcess(record: PersistedProcess): Promise<void> {
  if (!pidIsAlive(record.pid)) return;
  const commandName = path.basename(record.command).toLowerCase();
  if (process.platform === 'win32') {
    const probe = await execa('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p=Get-CimInstance Win32_Process -Filter \"ProcessId=${record.pid}\"; if($null -eq $p){exit 3}; [string]$p.CommandLine`,
    ], { reject: false, windowsHide: true });
    if (probe.exitCode !== 0) return;
    if (!probe.stdout.toLowerCase().includes(commandName)) throw new Error('PROCESS_IDENTITY_MISMATCH');
    const stopped = await execa('taskkill', ['/PID', String(record.pid), '/T', '/F'], { reject: false, windowsHide: true });
    if (stopped.exitCode !== 0 && pidIsAlive(record.pid)) throw new Error('PROCESS_TREE_STILL_ALIVE');
    return;
  }
  const probe = await execa('ps', ['-p', String(record.pid), '-o', 'lstart=', '-o', 'command='], { reject: false });
  if (probe.exitCode !== 0) return;
  const line = probe.stdout.trim();
  if (!line.toLowerCase().includes(commandName)) throw new Error('PROCESS_IDENTITY_MISMATCH');
  const expectedStart = new Date(record.started_at).getTime();
  const observedStart = Date.parse(line.slice(0, 24));
  if (!Number.isFinite(observedStart) || Math.abs(observedStart - expectedStart) > 2_000) {
    throw new Error('PROCESS_IDENTITY_MISMATCH');
  }
  try { process.kill(-record.pid, 'SIGTERM'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  for (let attempt = 0; attempt < 50 && pidIsAlive(record.pid); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (pidIsAlive(record.pid)) {
    try { process.kill(-record.pid, 'SIGKILL'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  if (pidIsAlive(record.pid)) throw new Error('PROCESS_TREE_STILL_ALIVE');
}
