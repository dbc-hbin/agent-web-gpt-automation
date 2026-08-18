import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { manifestFiles, installOrUpdate, rollbackInstall, resolvePackageSource } from '../src/cli/lifecycle.js';
import { setupWorkspace, doctorWorkspace } from '../src/core/workspace/commands.js';

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
    for (const name of skills) {
      expect(manifest.files).toContain(`skills/${name}/SKILL.md`);
      expect(manifest.files).toContain(`skills/${name}/agents/openai.yaml`);
    }
    expect(manifest.files.filter(file => file.endsWith('/agents/openai.yaml'))).toHaveLength(6);
  });

  it('accepts a validated manifest as the run binding source', async () => {
    const { createCLI } = await import('../src/cli/index.js');
    const help = createCLI().commands.find(command => command.name() === 'run')?.helpInformation() ?? '';
    expect(help).toContain('--manifest');
    expect(help).not.toContain('--project-root <path> (required)');
  });

  it('keeps documented awgpt commands reachable and free of retired binaries', async () => {
    const { createCLI } = await import('../src/cli/index.js');
    const cli = createCLI();
    const commands = new Map(cli.commands.map(command => [command.name(), command]));
    const retired = /(?:bin\/|chatgpt_context_packer|chatgpt_oracle_(?:multi|comprehensive)|--browser-timeout|post-register|\bensure\b)/i;
    for (const name of skills) {
      const text = await readFile(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
      expect(text).not.toMatch(retired);
      for (const match of text.matchAll(/\bawgpt\s+([a-z-]+)([^`\n]*)/g)) {
        const command = commands.get(match[1]);
        expect(command, `${name}: awgpt ${match[1]}`).toBeDefined();
        if (match[1] === 'workspace') {
          expect(command?.commands.map(child => child.name())).toEqual(expect.arrayContaining(['setup', 'doctor']));
        } else {
          const help = command?.helpInformation() ?? '';
          for (const option of (match[2].match(/--[a-z-]+/g) ?? [])) expect(help, `${name}: ${option}`).toContain(option);
        }
      }
    }
  });

  it('resolves packaged source independently of cwd', () => {
    expect(resolvePackageSource()).toBe(root);
  });

  it('supports injected workspace dry-run', async () => {
    const result = await setupWorkspace({ root: '/project', dryRun: true, runner: { run: async () => ({ code: 99, stdout: '', stderr: '' }) } });
    expect(result.status).toBe('DRY_RUN');
    expect(result.commands).toHaveLength(2);
  });

  it('keeps workspace doctor diagnostic and separate from setup apply', async () => {
    const calls: string[] = [];
    const runner = { run: async (command: string) => { calls.push(command); return { code: 0, stdout: '', stderr: '' }; } };
    const result = await doctorWorkspace('/project', runner);
    expect(result.status).toBe('READY');
    expect(calls).toEqual(['devspace', 'tailscale']);
    const setup = await setupWorkspace({ root: '/project', apply: true, runner });
    expect(setup.status).toBe('READY');
    const doctorHelp = (await import('../src/cli/index.js')).createCLI().commands.find(c => c.name() === 'workspace')?.commands.find(c => c.name() === 'doctor')?.helpInformation() ?? '';
    expect(doctorHelp).not.toContain('--apply');
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
