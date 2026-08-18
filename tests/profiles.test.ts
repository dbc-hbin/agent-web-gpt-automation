import { describe, it, expect } from 'vitest';
import { access, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileManager } from '../src/core/process/profiles.js';

async function profileFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'profile-seed-'));
  await mkdir(join(root, 'Default', 'Network'), { recursive: true });
  await mkdir(join(root, 'Default', 'Local Storage'), { recursive: true });
  await writeFile(join(root, 'Local State'), '{}');
  await writeFile(join(root, 'Default', 'Network', 'Cookies'), 'sqlite-fixture');
  return root;
}

describe('ProfileManager', () => {
  it('creates, validates, and removes a throwaway copy without mutating the seed', async () => {
    const seed = await profileFixture();
    const home = await mkdtemp(join(tmpdir(), 'oracle-home-'));
    const manager = new ProfileManager({ sourceProfilePath: seed }, home);
    const copied = await manager.createSession('run-1');
    expect(copied.startsWith(join(home, 'browser-sessions'))).toBe(true);
    if (process.platform !== 'win32') {
      expect((await stat(copied)).mode & 0o777).toBe(0o700);
      expect((await stat(join(copied, 'Default', 'Network', 'Cookies'))).mode & 0o777).toBe(0o600);
    }
    await expect(access(join(seed, 'Local State'))).resolves.toBeUndefined();
    expect(await manager.validateProfile('run-1')).toBe(true);
    await manager.removeProfile('run-1');
    await expect(access(copied)).rejects.toThrow();
    await expect(access(seed)).resolves.toBeUndefined();
  });

  it('does not swallow copy failures or accept path-like profile ids', async () => {
    const home = await mkdtemp(join(tmpdir(), 'oracle-home-'));
    const missing = new ProfileManager({ sourceProfilePath: join(home, 'missing') }, home);
    await expect(missing.createSession('run-1')).rejects.toThrow();
    const valid = new ProfileManager({ sourceProfilePath: await profileFixture() }, home);
    await expect(valid.createSession('../escape')).rejects.toThrow('PROFILE_ID_INVALID');
  });
});
