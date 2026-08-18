import { afterEach, describe, it, expect } from 'vitest';
import { createServer, Server } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { prepareProfileLogin, runDoctor } from '../src/cli/doctor.js';
import { LockManager } from '../src/core/state/locks.js';
import { ProcessRegistry } from '../src/core/process/registry.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function listener(status = 401): Promise<string> {
  const server = createServer((_request, response) => {
    response.statusCode = status;
    response.end();
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('listener address unavailable');
  return `http://127.0.0.1:${address.port}/mcp`;
}

async function profileFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'doctor-profile-'));
  await mkdir(join(root, 'Default', 'Network'), { recursive: true });
  await mkdir(join(root, 'Default', 'Local Storage'), { recursive: true });
  await writeFile(join(root, 'Local State'), '{}');
  await writeFile(join(root, 'Default', 'Network', 'Cookies'), 'fixture');
  return root;
}

describe('doctor contract', () => {
  it('fails fast with one actionable BLOCKED result when DevSpace is unavailable', async () => {
    const report = await runDoctor({
      projectRoot: '/exact/root', copyProfilePath: '/does/not/exist',
      devspaceUrl: 'http://127.0.0.1:1/mcp', statePaths: [],
    });
    expect(report.status).toBe('BLOCKED');
    expect(report.checks.map(check => check.name)).toEqual(['devspace']);
    expect(report.next_actions).toHaveLength(1);
  });

  it('doctor --recover attempts exact-root DevSpace reconnect only once', async () => {
    let attempts = 0;
    const report = await runDoctor({
      projectRoot: '/exact/root', copyProfilePath: '/does/not/exist',
      devspaceUrl: 'http://127.0.0.1:1/mcp', statePaths: [], recover: true,
      reconnectDevSpace: async root => { attempts += 1; expect(root).toBe(join(parse(process.cwd()).root, 'exact', 'root')); return false; },
    });
    expect(attempts).toBe(1);
    expect(report.recovery_action).toMatchObject({ kind: 'devspace_reconnect', status: 'BLOCKED' });
  });

  it('returns PASS with authoritative checks for a healthy fixture', async () => {
    const report = await runDoctor({
      projectRoot: `/tmp/doctor-${Date.now()}`,
      copyProfilePath: await profileFixture(), devspaceUrl: await listener(), statePaths: [],
    });
    expect(report.status).toBe('PASS');
    expect(report.checks.map(check => check.name)).toEqual(['devspace', 'copy-profile', 'oracle-state', 'project-lock']);
  });

  it('reports an owned exact-project lock as BLOCKED without releasing it', async () => {
    const root = join(tmpdir(), `doctor-owned-${Date.now()}`);
    const owner = new LockManager({ projectRoot: root, retries: 0 });
    const release = await owner.acquire();
    try {
      const report = await runDoctor({
        projectRoot: root, copyProfilePath: await profileFixture(),
        devspaceUrl: await listener(), statePaths: [],
      });
      expect(report.status).toBe('BLOCKED');
      expect(report.locks_held).toBe(true);
      expect((await new LockManager({ projectRoot: root, retries: 0 }).tryAcquire()).held).toBe(false);
    } finally {
      await release();
    }
  });

  it('returns FAIL for malformed persisted state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctor-state-'));
    const statePath = join(root, 'state.json');
    await writeFile(statePath, '{not-json');
    const report = await runDoctor({
      projectRoot: root, copyProfilePath: await profileFixture(),
      devspaceUrl: await listener(200), statePaths: [statePath],
    });
    expect(report.status).toBe('FAIL');
    expect(report.checks.at(-1)?.code).toBe('STATE_INVALID');
  });

  it('audits the persisted Oracle session state shape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctor-session-state-'));
    const statePath = join(root, 'state.json');
    await writeFile(statePath, JSON.stringify({
      schema: 'codex.chatgpt.oracle-run-state/v1', run_id: 'legacy-run', project_root: root,
      mode: 'browser', transport_status: 'complete', task_outcome: 'executed',
      session_authority: 'terminal', terminal_harvested: true,
      mission: { path: join(root, 'mission.md'), sha256: 'a'.repeat(64) },
      oracle: { resolved_version: '0.16.1', session_locator: 'exact-slug', slug: 'exact-slug', command: [] },
      status: 'complete', artifacts: {},
    }));
    const report = await runDoctor({
      projectRoot: root, copyProfilePath: await profileFixture(),
      devspaceUrl: await listener(200), statePaths: [statePath],
    });
    expect(report.status).toBe('PASS');
    expect(report.sessions[0]).toMatchObject({
      run_id: 'legacy-run', session_authority: 'terminal_observed', exact_slug: 'exact-slug',
    });
  });

  it('prepares a secret-free isolated manual-login target', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-login-'));
    const target = await prepareProfileLogin(home);
    expect(target.url).toBe('https://chatgpt.com/auth/login');
    expect(target.url).not.toContain('run');
    expect(target.profile_path.startsWith(join(home, 'login-profiles'))).toBe(true);
  });

  it('doctor --recover cleans one persisted dead process and returns', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-recover-'));
    const registry = new ProcessRegistry(join(home, 'processes.json'));
    await registry.upsert({
      id: 'dead-process', pid: 2_147_483_647, command: process.execPath, args: [], cwd: home,
      project_root: join(home, 'project'), started_at: new Date(0).toISOString(), state: 'running',
    });
    const report = await runDoctor({
      projectRoot: join(home, 'project'), copyProfilePath: await profileFixture(),
      devspaceUrl: await listener(200), statePaths: [], oracleHome: home, recover: true,
    });
    expect(report.recovery_action).toMatchObject({ kind: 'process_cleanup', status: 'COMPLETED' });
    expect((await registry.list())[0].state).toBe('cleaned');
  });

  it('doctor --recover continues only the recorded exact slug under the project lock', async () => {
    const home = await mkdtemp(join(tmpdir(), 'doctor-exact-recovery-'));
    const project = join(home, 'project');
    const run = join(home, 'run');
    await mkdir(project);
    await mkdir(run);
    const body = [
      "import { writeFileSync } from 'node:fs';",
      "const at = process.argv.indexOf('--write-output');",
      "if (process.argv[2] !== 'session' || process.argv[3] !== 'oracle-exact' || at < 0) process.exit(9);",
      "writeFileSync(process.argv[at + 1], 'TASK_OUTCOME: EXECUTED\\n');",
      "console.log('State: complete');",
    ].join('\n');
    let oracleCommand: string;
    if (process.platform === 'win32') {
      const script = join(home, 'fake-oracle.mjs');
      await writeFile(script, body);
      oracleCommand = join(home, 'oracle.cmd');
      await writeFile(oracleCommand, `@"${process.execPath}" "${script}" %*\r\n`);
    } else {
      oracleCommand = join(home, 'oracle');
      await writeFile(oracleCommand, `#!${process.execPath}\n${body}\n`);
      await chmod(oracleCommand, 0o700);
    }
    const statePath = join(run, 'state.json');
    await writeFile(statePath, JSON.stringify({
      schema: 'codex.chatgpt.oracle-run-state/v1', run_id: 'exact-run', project_root: project,
      mode: 'browser', session_authority: 'live', transport_status: 'pending', task_outcome: 'pending',
      task_outcome_contract: 'v1', transport: 'devspace',
      mission: { path: join(project, 'mission.md'), sha256: 'a'.repeat(64) },
      oracle: {
        resolved_version: 'fixture', session_locator: 'oracle-exact', slug: 'oracle-exact',
        command: [oracleCommand],
      },
      artifacts: {},
    }));
    const report = await runDoctor({
      projectRoot: project, copyProfilePath: await profileFixture(),
      devspaceUrl: await listener(200), statePaths: [statePath], oracleHome: home, recover: true,
    });
    expect(report.recovery_action).toMatchObject({ kind: 'exact_session_recovery', status: 'COMPLETED' });
    expect(report.recovery_action?.detail).toContain('oracle-exact');
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({
      session_authority: 'terminal_observed', terminal_harvested: true,
      transport_status: 'complete', task_outcome: 'EXECUTED',
    });
    const reacquired = await new LockManager({ projectRoot: project, retries: 0 }).tryAcquire();
    expect(reacquired.held).toBe(true);
    await reacquired.release();
  });
});
