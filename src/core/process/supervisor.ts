import { execa } from 'execa';
import { z } from 'zod';
import crypto from 'crypto';
import * as path from 'node:path';
import { ProcessRegistry } from './registry.js';

export interface ProcessConfig {
  command: string;
  args: string[];
  cwd?: string;
  maxBuffer?: number;
  runId?: string;
  exactSlug?: string;
  projectRoot?: string;
}

export const ProcessState = z.enum(['running', 'exited', 'signaled', 'cleaned']);

export interface ProcessInfo {
  pid: number;
  state: z.infer<typeof ProcessState>;
  startedAt: Date;
  exitedAt?: Date;
  exitCode?: number;
  signal?: string;
}

export const CAUTION_AUDIT_THRESHOLD_MS = 4_800_000;

export class ProcessSupervisor {
  private processes = new Map<string, ReturnType<typeof execa>>();
  private states = new Map<string, ProcessInfo>();

  constructor(private readonly registry?: ProcessRegistry) {}

  async start(config: ProcessConfig, id?: string): Promise<string> {
    const processId = id ?? crypto.randomUUID();
    const proc = execa(config.command, config.args, {
      cwd: config.cwd,
      maxBuffer: config.maxBuffer,
      killSignal: 'SIGTERM',
      windowsHide: true,
      detached: process.platform !== 'win32',
    });

    const processInfo: ProcessInfo = {
      pid: proc.pid ?? 0,
      state: 'running' as const,
      startedAt: new Date(),
    };

    const bindExit = ({ exitCode, signal }: { exitCode?: number; signal?: string }) => {
      if (this.states.get(processId)?.state === 'cleaned') return;
      const next = {
        ...processInfo,
        state: signal ? 'signaled' : 'exited',
        exitCode,
        signal,
        exitedAt: new Date(),
      } as ProcessInfo;
      this.states.set(processId, next);
      if (this.registry) {
        void this.registry.list().then(records => {
          const record = records.find(item => item.id === processId);
          if (record) return this.registry!.upsert({ ...record, state: next.state });
        });
      }
    };

    proc.then(result => bindExit({
      exitCode: result.exitCode,
      signal: result.signal,
    })).catch((error: { exitCode?: number; signal?: string }) => {
      bindExit({ exitCode: error.exitCode, signal: error.signal });
    });

    this.processes.set(processId, proc);
    this.states.set(processId, processInfo);
    if (this.registry && processInfo.pid > 0) {
      await this.registry.upsert({
        id: processId, pid: processInfo.pid, command: config.command, args: config.args,
        cwd: config.cwd ?? process.cwd(), started_at: processInfo.startedAt.toISOString(),
        project_root: config.projectRoot ? path.resolve(config.projectRoot) : undefined,
        state: 'running', run_id: config.runId, exact_slug: config.exactSlug,
      });
      const latest = this.states.get(processId);
      if (latest && latest.state !== 'running') {
        const record = (await this.registry.list()).find(item => item.id === processId);
        if (record) await this.registry.upsert({ ...record, state: latest.state });
      }
    }

    return processId;
  }

  getState(id: string): ProcessInfo | undefined {
    return this.states.get(id);
  }

  async stop(id: string): Promise<void> {
    const proc = this.processes.get(id);
    if (!proc) return;

    const state = this.states.get(id);
    if (!state || state.state !== 'running') return;

    const gracefulSignalAccepted = await this.signalTree(proc, 'SIGTERM');
    let exited = false;
    if (gracefulSignalAccepted) {
      await Promise.race([
        proc.then(() => { exited = true; }).catch(() => { exited = true; }),
        new Promise<void>(resolve => setTimeout(resolve, 5_000)),
      ]);
    }
    if (!gracefulSignalAccepted || !exited || this.processGroupIsAlive(state.pid)) {
      await this.signalTree(proc, 'SIGKILL');
    }
    await proc.catch(() => undefined);
    if (this.processGroupIsAlive(state.pid)) {
      throw new Error(`PROCESS_TREE_STILL_ALIVE: ${state.pid}`);
    }

    this.states.set(id, {
      ...state,
      state: 'cleaned',
      exitedAt: new Date(),
    });
    if (this.registry) {
      const record = (await this.registry.list()).find(item => item.id === id);
      if (record) await this.registry.upsert({ ...record, state: 'cleaned' });
    }
  }

  async stopAll(): Promise<void> {
    for (const id of this.processes.keys()) {
      await this.stop(id);
    }
  }

  async cleanupStale(now = Date.now(), auditThresholdMs = CAUTION_AUDIT_THRESHOLD_MS): Promise<string[]> {
    const stale: string[] = [];
    for (const [id, state] of this.states) {
      if (state.state === 'running' && now - state.startedAt.getTime() >= auditThresholdMs) {
        stale.push(id);
      }
    }
    return stale;
  }

  private async signalTree(proc: ReturnType<typeof execa>, signal: 'SIGTERM' | 'SIGKILL'): Promise<boolean> {
    const pid = proc.pid;
    if (!pid) throw new Error('PROCESS_PID_UNAVAILABLE');
    if (process.platform === 'win32') {
      const args = ['/PID', String(pid), '/T'];
      if (signal === 'SIGKILL') args.push('/F');
      try {
        await execa('taskkill', args, { windowsHide: true });
      } catch (error) {
        if (signal === 'SIGTERM') return false;
        if (this.pidIsAlive(pid)) throw error;
      }
      return true;
    }
    try {
      process.kill(-pid, signal);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH') throw error;
    }
    return true;
  }

  private processGroupIsAlive(pid: number): boolean {
    if (process.platform === 'win32' || pid <= 0) return false;
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  private pidIsAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }
}
