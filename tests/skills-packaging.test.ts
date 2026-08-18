import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { manifestFiles, installOrUpdate, rollbackInstall, resolvePackageSource } from '../src/cli/lifecycle.js';
import { setupWorkspace } from '../src/core/workspace/commands.js';

const root = path.resolve(import.meta.dirname, '..');
const skills = ['chatgpt-oracle-runtime','chatgpt-question-designer','chatgpt-workspace-setup','mcp-update-guard','ultra-economy-mode','web-multi-gpt'];

describe('TS-native package surfaces', () => {
  it('covers exactly six skills and no Python runtime commands', async () => {
    const names = (await readdir(path.join(root, 'skills'))).sort();
    expect(names).toEqual([...skills].sort());
    for (const name of skills) {
      const text = await readFile(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
      expect(text).not.toMatch(/python|\.py/i);
    }
    const manifest = await manifestFiles(root);
    for (const name of skills) expect(manifest.files).toContain(`skills/${name}/SKILL.md`);
  });

  it('resolves packaged source independently of cwd', () => {
    expect(resolvePackageSource()).toBe(root);
  });

  it('supports injected workspace dry-run', async () => {
    const result = await setupWorkspace({ root: '/project', dryRun: true, runner: { run: async () => ({ code: 99, stdout: '', stderr: '' }) } });
    expect(result.status).toBe('DRY_RUN');
    expect(result.commands).toHaveLength(2);
  });

  it('installs and rolls back using receipt/WAL lifecycle', async () => {
    const source = await mkdtemp(path.join(tmpdir(), 'awgpt-source-'));
    const home = await mkdtemp(path.join(tmpdir(), 'awgpt-home-'));
    await cp(path.join(root, 'install-manifest.json'), path.join(source, 'install-manifest.json'));
    await cp(path.join(root, 'package.json'), path.join(source, 'package.json'));
    await cp(path.join(root, 'dist'), path.join(source, 'dist'), { recursive: true });
    await cp(path.join(root, 'contracts'), path.join(source, 'contracts'), { recursive: true });
    await cp(path.join(root, 'skills'), path.join(source, 'skills'), { recursive: true });
    const result = await installOrUpdate('install', source, home);
    expect(result.ok).toBe(true);
    const rolled = await rollbackInstall(home);
    expect(rolled.ok).toBe(true);
  });
});
