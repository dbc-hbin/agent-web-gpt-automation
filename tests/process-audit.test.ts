import { describe, it, expect } from 'vitest';
import { ProcessSupervisor } from '../src/core/process/supervisor.js';

describe('ProcessSupervisor audit-only on 4800s', () => {
  it('cleanupStale is audit-only semantics', async () => {
    const supervisor = new ProcessSupervisor();
    // cleanupStale returns [] when no stale, and does not throw on these trivial states
    const stale = await supervisor.cleanupStale();
    expect(stale).toEqual([]);
  });

  it('does not auto-kill and returns zero for short run', async () => {
    const supervisor = new ProcessSupervisor();
    const id = await supervisor.start({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 100)'],
    });
    const stale = await supervisor.cleanupStale();
    expect(stale).toEqual([]);
    await supervisor.stop(id);
  });

  it('reports the 4,800-second audit without changing process state', async () => {
    const supervisor = new ProcessSupervisor();
    const id = await supervisor.start({
      command: 'node', args: ['-e', 'setTimeout(() => {}, 10000)'],
    });
    const state = supervisor.getState(id)!;
    const auditAt = state.startedAt.getTime() + 4_800_000;
    expect(await supervisor.cleanupStale(auditAt)).toEqual([id]);
    expect(supervisor.getState(id)?.state).toBe('running');
    await supervisor.stop(id);
  });
});
