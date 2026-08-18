import { describe, expect, it } from 'vitest';
import { lstat, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoveryArgv, writeRecoveryAuxiliary } from '../src/core/forensics/recovery.js';
describe('exact recovery argv',()=>{ it('uses saved slug and only live/harvest',()=>{ for(const a of ['live','harvest'] as const){ const v=recoveryArgv(['oracle'],'slug-123',a,'/tmp/out'); expect(v).toEqual(['oracle','session','slug-123',`--${a}`,'--write-output','/tmp/out']); expect(v.join(' ')).not.toMatch(/prompt|restart/); } }); });

describe('recovery auxiliary writes', () => {
  it('rejects a precreated destination symlink without touching its sentinel', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'recovery-aux-'));
    const external = await mkdtemp(join(tmpdir(), 'recovery-aux-external-'));
    const sentinel = join(external, 'stdout.log');
    await writeFile(sentinel, 'sentinel');
    await symlink(sentinel, join(dir, 'stdout.log'));
    const stat = await lstat(dir);
    await expect(writeRecoveryAuxiliary(dir, 'stdout.log', 'replacement', { dev: stat.dev, ino: stat.ino, real: await realpath(dir) }))
      .rejects.toThrow('RECOVERY_AUXILIARY_PATH_INVALID');
    expect(await readFile(sentinel, 'utf8')).toBe('sentinel');
  });

  it('does not follow a precreated fixed .tmp symlink', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'recovery-aux-'));
    const external = await mkdtemp(join(tmpdir(), 'recovery-aux-external-'));
    const sentinel = join(external, 'tmp-target');
    await writeFile(sentinel, 'sentinel');
    await symlink(sentinel, join(dir, 'stdout.log.tmp'));
    const stat = await lstat(dir);
    await writeRecoveryAuxiliary(dir, 'stdout.log', 'replacement', { dev: stat.dev, ino: stat.ino, real: await realpath(dir) });
    expect(await readFile(sentinel, 'utf8')).toBe('sentinel');
    expect(await readFile(join(dir, 'stdout.log'), 'utf8')).toBe('replacement');
  });
});
