import { afterEach, describe, it, expect, vi } from 'vitest';
import { LockManager } from '../src/core/state/locks.js';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';

const releases: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (releases.length) await releases.pop()?.();
});

describe('LockManager', () => {
  it('uses a stable canonical project-derived lock path', () => {
    const root = path.resolve('/path/to/project');
    const mgr = new LockManager({ projectRoot: root });
    const hash = crypto.createHash('sha256').update(root).digest('hex');
    expect(mgr.getLockPath()).toBe(path.join(tmpdir(), `agent-web-gpt-lock-${hash}.lock`));
  });

  it('permits exactly one owner for the same project', async () => {
    const root = path.join(tmpdir(), `lock-contract-${crypto.randomUUID()}`);
    const first = new LockManager({ projectRoot: root, retries: 0 });
    const second = new LockManager({ projectRoot: root, retries: 0 });
    const firstRelease = await first.acquire();
    releases.push(firstRelease);
    expect((await second.tryAcquire()).held).toBe(false);

    await second.release();
    expect((await second.tryAcquire()).held).toBe(false);

    await firstRelease();
    const acquired = await second.tryAcquire();
    expect(acquired.held).toBe(true);
    releases.push(acquired.release);
  });

  it('isolates different projects and makes owner release idempotent', async () => {
    const first = new LockManager({ projectRoot: `/tmp/a-${crypto.randomUUID()}`, retries: 0 });
    const second = new LockManager({ projectRoot: `/tmp/b-${crypto.randomUUID()}`, retries: 0 });
    const firstRelease = await first.acquire();
    const secondRelease = await second.acquire();
    await firstRelease();
    await firstRelease();
    await secondRelease();
    await secondRelease();
  });

  it('reclaims only a proven dead owner after authority is explicitly settled', async () => {
    const root = `/tmp/reclaim-${crypto.randomUUID()}`;
    const manager = new LockManager({ projectRoot: root, retries: 0 });
    const lockDirectory = `${manager.getLockPath()}.lock`;
    await mkdir(lockDirectory);
    const ownerPath = `${manager.getLockPath()}.owner.json`;
    await writeFile(ownerPath, JSON.stringify({
      schema: 'codex.chatgpt.project-lock-owner/v1',
      pid: 2_000_000_000,
      token: crypto.randomUUID(),
      project_root: path.resolve(root),
    }));
    await expect(manager.reclaimAbandoned('submitted_unknown'))
      .rejects.toThrow('PROJECT_LOCK_RECLAIM_FORBIDDEN');
    await manager.reclaimAbandoned('settled');
    await expect(access(lockDirectory)).rejects.toThrow();
  });

  it('does not misreport storage failures as a held lock', async () => {
    const manager = new LockManager({ projectRoot: `/tmp/io-${crypto.randomUUID()}`, retries: 0 });
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const acquire = vi.spyOn(manager, 'acquire').mockRejectedValueOnce(failure);
    await expect(manager.tryAcquire()).rejects.toMatchObject({ code: 'EACCES' });
    acquire.mockRestore();
  });

  it('refuses reclaim when owner evidence changes in the check/rename window', async () => {
    const root = `/tmp/reclaim-race-${crypto.randomUUID()}`;
    const manager = new LockManager({ projectRoot: root, retries: 0 });
    const lockDirectory = `${manager.getLockPath()}.lock`;
    await mkdir(lockDirectory);
    const ownerPath = `${manager.getLockPath()}.owner.json`;
    const replacement = { schema: 'codex.chatgpt.project-lock-owner/v1', pid: 2_000_000_001, token: crypto.randomUUID(), project_root: path.resolve(root) };
    await writeFile(ownerPath, JSON.stringify({ ...replacement, pid: 2_000_000_000, token: crypto.randomUUID() }));
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { writeFile(ownerPath, JSON.stringify(replacement)); const error = Object.assign(new Error('dead'), { code: 'ESRCH' }); throw error; });
    await expect(manager.reclaimAbandoned('settled')).rejects.toThrow('PROJECT_LOCK_OWNER_CHANGED');
    await access(lockDirectory);
    kill.mockRestore();
  });
});
