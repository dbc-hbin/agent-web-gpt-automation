import { describe, it, expect } from 'vitest';
import { ProcessSupervisor } from '../src/core/process/supervisor.js';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function waitFor<T>(read: () => Promise<T | undefined>, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for fixture');
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

describe('ProcessSupervisor', () => {
  it('captures state transitions from running to cleaned', async () => {
    const supervisor = new ProcessSupervisor();
    const id = await supervisor.start({
      command: 'node',
      args: ['-e', 'console.log("test")'],
    });

    const state = supervisor.getState(id);
    expect(state).toBeDefined();
    expect(state?.state).toBe('running');

    await supervisor.stop(id);
    const after = supervisor.getState(id);
    expect(after?.state).toBe('cleaned');
  });

  it('tracks multiple concurrent processes', async () => {
    const supervisor = new ProcessSupervisor();
    const id1 = await supervisor.start({ command: 'node', args: ['-e', 'setTimeout(() => {}, 10000)'] });
    const id2 = await supervisor.start({ command: 'node', args: ['-e', 'setTimeout(() => {}, 10000)'] });

    expect(supervisor.getState(id1)?.state).toBe('running');
    expect(supervisor.getState(id2)?.state).toBe('running');

    await supervisor.stopAll();
    expect(supervisor.getState(id1)?.state).toBe('cleaned');
    expect(supervisor.getState(id2)?.state).toBe('cleaned');
  });

  it('terminates a spawned descendant before reporting cleaned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supervisor-tree-'));
    const pidPath = join(root, 'child.pid');
    const program = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      `writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
      'setInterval(() => {}, 1000);',
    ].join(' ');
    const supervisor = new ProcessSupervisor();
    const id = await supervisor.start({ command: process.execPath, args: ['-e', program] });
    const childPid = await waitFor(async () => {
      try {
        return Number(await readFile(pidPath, 'utf8'));
      } catch {
        return undefined;
      }
    });
    expect(pidIsAlive(childPid)).toBe(true);
    await supervisor.stop(id);
    await waitFor(async () => pidIsAlive(childPid) ? undefined : false);
    expect(pidIsAlive(childPid)).toBe(false);
    expect(supervisor.getState(id)?.state).toBe('cleaned');
  });
});
