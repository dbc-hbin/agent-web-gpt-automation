import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateAuthSnapshot } from '../src/core/process/auth-preflight.js';
import { proveNoSubmission } from '../src/core/forensics/no-submission.js';
import { recoveryArgv } from '../src/core/forensics/recovery.js';
import { runLocalGate } from '../src/core/orchestrator/gate-runner.js';
import { installOrUpdate, recoverPendingInstalls, rollbackInstall } from '../src/cli/lifecycle.js';
import { OracleManifestSchema, parseTaskOutcome } from '../src/types/index.js';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

describe('remaining migration contracts', () => {
  it('accepts the authoritative minimal DevSpace manifest and rejects transport confusion', () => {
    expect(OracleManifestSchema.parse({
      schema: 'codex.chatgpt.oracle-run/v1', project_root: '/exact/root',
      mission_path: '/exact/root/mission.md', app_name: 'DevSpace', oracle_command: ['oracle'],
    }).transport).toBeUndefined();
    expect(() => OracleManifestSchema.parse({
      schema: 'codex.chatgpt.oracle-run/v1', project_root: '/exact/root',
      mission_path: '/exact/root/mission.md', transport: 'pro-attachment-only', app_name: 'DevSpace',
    })).toThrow();
  });

  it('parses exactly one terminal TASK_OUTCOME marker and bounded reference definitions', () => {
    expect(parseTaskOutcome('done\nTASK_OUTCOME: EXECUTED\n')).toMatchObject({ outcome: 'EXECUTED' });
    expect(parseTaskOutcome('done\nTASK_OUTCOME: NOT_EXECUTED\n[1]: https://example.com/a "source title"\n')).toMatchObject({ outcome: 'NOT_EXECUTED' });
    expect(() => parseTaskOutcome('TASK_OUTCOME: EXECUTED\nmore prose')).toThrow('TASK_OUTCOME_MARKER_NOT_FINAL');
    expect(() => parseTaskOutcome('TASK_OUTCOME: EXECUTED\nTASK_OUTCOME: BLOCKED')).toThrow('TASK_OUTCOME_MARKER_INVALID');
  });

  it('executes a local gate without a shell and hashes observable output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gate-runner-'));
    const result = await runLocalGate({
      argv: [process.execPath, '-e', 'process.stdout.write("gate-ok")'], projectRoot: root,
      env: { PHASE_GATE: '1' },
    });
    expect(result).toMatchObject({ ok: true, exit_code: 0, stdout: 'gate-ok', cwd: await realpath(root) });
    expect(result.output_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('requires authenticated composer, model, and thinking DOM evidence', () => {
    expect(evaluateAuthSnapshot({
      backend_status: 200, composer: true, model_selector: true, thinking_control: true, login_cta: false,
    }).code).toBe('AUTH_DOM_READY');
    expect(evaluateAuthSnapshot({
      backend_status: 401, composer: false, model_selector: false, thinking_control: false, login_cta: true,
    }).code).toBe('AUTH_LOGIN_REQUIRED');
  });

  it('builds exact-session recovery argv and refuses submission flags', () => {
    expect(recoveryArgv(['oracle'], 'oracle-exact', 'live', '/safe/output')).toEqual([
      'oracle', 'session', 'oracle-exact', '--live', '--write-output', '/safe/output',
    ]);
    expect(() => recoveryArgv(['oracle', '--prompt'], 'oracle-exact', 'harvest', '/safe/output'))
      .toThrow('RECOVERY_COMMAND_UNSAFE');
  });

  it('accepts no-submission only with exact hashed artifacts and recovery miss evidence', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'no-submit-'));
    const project = join(runDir, 'project');
    const stageDir = join(project, 'stage');
    await mkdir(stageDir, { recursive: true });
    const inputPath = join(project, 'input.md');
    const input = Buffer.from('input mission');
    await writeFile(inputPath, input);
    const runId = 'a'.repeat(32);
    const workflowId = 'b'.repeat(32);
    const mission = Buffer.from([
      '[HOST_STAGE_CONTRACT]',
      `workflow_id=${workflowId}`,
      'stage=review',
      `attempt_id=${runId}`,
      `input_mission_sha256=${hash(input)}`,
      `exact_project_root=${project}`,
      `exact_input_mission_path=${inputPath}`,
      `Write the small UTF-8 stage receipt to: ${join(stageDir, 'stage-result.json')}`,
      '[DEVSPACE_WORKSPACE_ENTRY_CONTRACT]',
    ].join('\n'));
    await writeFile(join(runDir, 'mission.md'), mission);
    await writeFile(join(stageDir, 'mission.md'), mission);
    await writeFile(join(runDir, 'stdout.log'), [
      'Session: oracle-exact',
      'Prompt did not appear in conversation before timeout (send may have failed)',
    ].join('\n'));
    await writeFile(join(runDir, 'stderr.log'), '');
    await writeFile(join(runDir, 'recovery-live-stdout.log'), [
      'No live ChatGPT tab matched session "oracle-exact"',
      'session metadata has no recoverable ChatGPT conversation URL',
    ].join('\n'));
    await writeFile(join(runDir, 'recovery-live-stderr.log'), '');
    const statePath = join(runDir, 'state.json');
    await writeFile(statePath, JSON.stringify({
      schema: 'codex.chatgpt.oracle-run-state/v1', run_id: runId, project_root: project,
      mode: 'browser', session_authority: 'submitted_unknown', transport_status: 'failed', task_outcome: 'pending',
      terminal_harvested: false,
      parallel_parent_id: hash(workflowId),
      mission: { path: join(stageDir, 'mission.md'), transport_path: join(runDir, 'mission.md'), sha256: hash(mission) },
      oracle: { resolved_version: '0.17.1', session_locator: 'oracle-exact', slug: 'oracle-exact', command: ['oracle'] },
      artifacts: { output: join(runDir, 'output.md'), stdout: join(runDir, 'stdout.log'), stderr: join(runDir, 'stderr.log') },
    }));
    expect(await proveNoSubmission(statePath)).toMatchObject({
      run_id: runId, oracle_locator: 'oracle-exact', output_absent: true,
    });
    await writeFile(join(runDir, 'output.md'), 'unexpected output');
    expect(await proveNoSubmission(statePath)).toBeUndefined();
  });

  it('installs from a manifest, rolls back created/overwritten files, and preserves conflicts', async () => {
    const source = await mkdtemp(join(tmpdir(), 'lifecycle-source-'));
    const home = await mkdtemp(join(tmpdir(), 'lifecycle-home-'));
    await mkdir(join(source, 'bin'));
    await writeFile(join(source, 'install-manifest.json'), JSON.stringify({ schema: 'fixture/v1', version: '1.0.0', include: ['bin/tool.txt'] }));
    await writeFile(join(source, 'bin', 'tool.txt'), 'new');
    await mkdir(join(home, 'bin'));
    await writeFile(join(home, 'bin', 'tool.txt'), 'old');
    const installed = await installOrUpdate('install', source, home);
    expect(await readFile(join(home, 'bin', 'tool.txt'), 'utf8')).toBe('new');
    expect((await rollbackInstall(home, installed.receipt)).ok).toBe(true);
    expect(await readFile(join(home, 'bin', 'tool.txt'), 'utf8')).toBe('old');

    const updated = await installOrUpdate('update', source, home);
    await writeFile(join(home, 'bin', 'tool.txt'), 'user-modified');
    const conflicted = await rollbackInstall(home, updated.receipt);
    expect(conflicted).toMatchObject({ ok: false, status: 'CONFLICT', conflicts: ['bin/tool.txt'] });
    expect(await readFile(join(home, 'bin', 'tool.txt'), 'utf8')).toBe('user-modified');
  });

  it('rolls back an ACTIVE lifecycle WAL before a later install', async () => {
    const home = await mkdtemp(join(tmpdir(), 'lifecycle-crash-'));
    const backup = join(home, 'backups', 'interrupted');
    await mkdir(join(home, 'bin'), { recursive: true });
    await mkdir(join(backup, 'bin'), { recursive: true });
    await writeFile(join(home, 'bin', 'tool.txt'), 'partial-new');
    await writeFile(join(backup, 'bin', 'tool.txt'), 'stable-old');
    await writeFile(join(backup, 'install.wal.json'), JSON.stringify({
      schema: 'codex.chatgpt.install-wal/v1', status: 'ACTIVE', action: 'update', backup,
      files: [{
        path: 'bin/tool.txt', action: 'overwritten', installed_sha256: hash('partial-new'),
        backup_sha256: hash('stable-old'),
      }],
    }));
    expect(await recoverPendingInstalls(home)).toEqual([join(backup, 'install.wal.json')]);
    expect(await readFile(join(home, 'bin', 'tool.txt'), 'utf8')).toBe('stable-old');
  });
});
