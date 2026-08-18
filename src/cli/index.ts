import { Command } from 'commander';
import { launchProfileLogin, prepareProfileLogin, runDoctor } from './doctor.js';
import { installOrUpdate, rollbackInstall, resolvePackageSource } from './lifecycle.js';
import { ProfileManager } from '../core/process/profiles.js';
import { preflightCopiedProfile } from '../core/process/auth-preflight.js';
import { recoverChatGptLogin } from '../core/process/cookie-recovery.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { runOracle, loadRunState, stopRecorded } from '../core/run/runtime.js';
import { planExactRecovery, executeExactRecovery } from '../core/forensics/recovery.js';
import { proveNoSubmission } from '../core/forensics/no-submission.js';
import { createHttpDevSpaceClient } from '../core/devspace/http-client.js';
import { runLocalGate } from '../core/orchestrator/gate-runner.js';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setupWorkspace } from '../core/workspace/commands.js';
const execFileAsync = promisify(execFile);
const localCommandRunner = { run: async (command: string, args: string[]) => {
  try { const result = await execFileAsync(command, args, { encoding: 'utf8' }); return { code: 0, stdout: result.stdout, stderr: result.stderr }; }
  catch (error: any) { return { code: typeof error?.code === 'number' ? error.code : 1, stdout: error?.stdout ?? '', stderr: error?.stderr ?? error?.message ?? String(error) }; }
} };

const require = createRequire(import.meta.url);
let packageMetadata: { version?: string } = {};
try { packageMetadata = require('../../package.json') as { version?: string }; } catch { packageMetadata = { version: '1.0.0' }; }
export function publicVersion(): string {
  const version = packageMetadata.version;
  if (!version) throw new Error('PACKAGE_VERSION_MISSING');
  return version;
}

/** Return the user-facing argv, excluding the node executable and script path. */
export function publicArgv(argv = process.argv): string[] {
  return argv.slice(2);
}

export function createCLI(): Command {
  const program = new Command();
  program
    .name('awgpt')
    .description('Guarded, recoverable web GPT automation')
    .version(publicVersion());

  program
    .command('local-gate')
    .description('Run a deterministic local gate without a shell')
    .requiredOption('--project-root <path>', 'exact project root')
    .requiredOption('--argv <value...>', 'executable and arguments')
    .option('--env <key=value...>', 'environment additions')
    .option('--timeout-ms <milliseconds>', 'gate timeout')
    .action(async options => {
      try {
        const env: Record<string, string> = {};
        for (const item of options.env ?? []) {
          const separator = item.indexOf('=');
          if (separator <= 0) throw new Error('GATE_ENV_INVALID');
          env[item.slice(0, separator)] = item.slice(separator + 1);
        }
        const result = await runLocalGate({
          argv: options.argv,
          projectRoot: options.projectRoot,
          env,
          timeoutMs: options.timeoutMs === undefined ? undefined : Number(options.timeoutMs),
        });
        console.log(JSON.stringify({ schema: 'codex.chatgpt.local-gate/v1', ...result }, null, 2));
        if (!result.ok) process.exitCode = 2;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });

  program
    .command('doctor')
    .description('Check environment health')
    .option('--project-root <path>', 'exact project root', process.cwd())
    .option('--copy-profile <path>', 'manual-login profile seed')
    .option('--devspace-url <url>', 'local DevSpace MCP probe URL')
    .option('--oracle-home <path>', 'isolated Oracle home')
    .option('--state <path...>', 'specific Oracle state files to validate')
    .option('--recover', 'emit the single safe next recovery action')
    .option('--open-profile-login', 'open a generic ChatGPT login in a new isolated profile')
    .action(async options => {
      if (options.openProfileLogin) {
        const target = await prepareProfileLogin();
        await launchProfileLogin(target);
        console.log(JSON.stringify({
          schema: 'codex.chatgpt.profile-login/v1',
          status: 'USER_ACTION_REQUIRED',
          ...target,
        }, null, 2));
        return;
      }
      const report = await runDoctor({
        projectRoot: options.projectRoot,
        copyProfilePath: options.copyProfile,
        devspaceUrl: options.devspaceUrl,
        statePaths: options.state,
        recover: options.recover,
        oracleHome: options.oracleHome,
      });
      console.log(JSON.stringify(report, null, 2));
      if (report.status === 'FAIL') process.exitCode = 1;
      else if (report.status === 'BLOCKED') process.exitCode = 2;
    });

  const workspace = program.command('workspace').description('Configure and inspect the exact DevSpace workspace');
  for (const action of ['setup', 'doctor'] as const) {
    workspace.command(action)
      .description(action === 'setup' ? 'Preview workspace commands (use --apply to execute)' : 'Run workspace checks')
      .option('--root <path>', 'exact project root', process.cwd())
      .option('--apply', 'execute commands; preview is the default')
      .action(async options => {
        try {
          const result = await setupWorkspace({ root: options.root, apply: Boolean(options.apply), runner: localCommandRunner });
          console.log(JSON.stringify(result, null, 2));
          if (result.status === 'BLOCKED') process.exitCode = 2;
        } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
      });
  }

  program
    .command('auth-preflight')
    .description('Validate ChatGPT authentication and required composer DOM without submitting')
    .requiredOption('--copy-profile <path>', 'manual-login profile seed')
    .option('--oracle-home <path>', 'isolated Oracle home', path.join(os.homedir(), '.oracle'))
    .option('--chrome-path <path>', 'Chrome executable override')
    .action(async options => {
      const manager = new ProfileManager({ sourceProfilePath: options.copyProfile }, options.oracleHome);
      const id = `preflight-${Date.now()}`;
      const copied = await manager.createSession(id);
      try {
        const result = await preflightCopiedProfile(copied, options.chromePath);
        console.log(JSON.stringify({ schema: 'codex.chatgpt.auth-preflight/v1', ...result }, null, 2));
        if (!result.ok) process.exitCode = 2;
      } finally {
        await manager.removeProfile(id);
      }
    });

  program
    .command('auth-recover')
    .description('Recover the isolated login from ChatGPT cookies in the main Chrome profile')
    .requiredOption('--copy-profile <path>', 'manual-login profile seed to repair')
    .option('--chrome-user-data <path>', 'main Chrome user-data root')
    .option('--chrome-profile <name>', 'Chrome profile directory, such as Default or Profile 1')
    .option('--oracle-home <path>', 'isolated Oracle home', path.join(os.homedir(), '.oracle'))
    .option('--chrome-path <path>', 'Chrome executable override')
    .action(async options => {
      try {
        const result = await recoverChatGptLogin({
          seedPath: options.copyProfile,
          oracleHome: options.oracleHome,
          sourceUserDataRoot: options.chromeUserData,
          sourceProfile: options.chromeProfile,
          chromePath: options.chromePath,
        });
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) process.exitCode = 2;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Cookie recovery failed.';
        const rollbackFailed = message === 'COOKIE_RECOVERY_ROLLBACK_FAILED';
        console.log(JSON.stringify({
          schema: 'codex.chatgpt.auth-cookie-recovery/v1',
          ok: false,
          status: rollbackFailed ? 'ATTENTION_REQUIRED' : 'FAILED',
          code: rollbackFailed ? 'COOKIE_RECOVERY_ROLLBACK_FAILED' : 'COOKIE_RECOVERY_FAILED',
          message,
        }, null, 2));
        process.exitCode = 1;
      }
    });

  for (const action of ['install', 'update'] as const) {
    program.command(action)
      .description(`${action} repository-managed Agent Web GPT files with a receipt`)
      .option('--source <path>', 'repository source root (defaults to the installed package)')
      .option('--agent-home <path>', 'installation root', path.join(os.homedir(), '.codex'))
      .action(async options => {
        try {
          const result = await installOrUpdate(action, options.source ?? resolvePackageSource(), options.agentHome);
          console.log(JSON.stringify(result, null, 2));
        } catch (error) {
          console.log(JSON.stringify({ schema: 'codex.chatgpt.install/v1', ok: false, action, status: 'FAILED', code: errorCode(error), message: error instanceof Error ? error.message : String(error) }, null, 2));
          process.exitCode = 2;
        }
      });
  }

  program.command('rollback')
    .description('Rollback the latest receipt without overwriting modified files')
    .option('--agent-home <path>', 'installation root', path.join(os.homedir(), '.codex'))
    .option('--receipt <path>', 'specific owned receipt')
    .action(async options => {
      try {
        const result = await rollbackInstall(options.agentHome, options.receipt);
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) process.exitCode = 2;
      } catch (error) {
        console.log(JSON.stringify({ schema: 'codex.chatgpt.install/v1', ok: false, action: 'rollback', status: 'FAILED', code: errorCode(error), message: error instanceof Error ? error.message : String(error) }, null, 2));
        process.exitCode = 2;
      }
    });

  program
    .command('run')
    .description('Run Oracle workflow')
    .requiredOption('--project-root <path>')
    .requiredOption('--mission <path>')
    .option('--run-root <path>')
    .option('--manifest <path>')
    .option('--oracle-command <path>')
    .option('--oracle-arg <value...>')
    .option('--oracle-home <path>')
    .option('--dry-run', 'validate and plan without launching Oracle')
    .option('--devspace-url <url>', 'DevSpace MCP endpoint', 'http://127.0.0.1:7676/mcp')
    .action(async options => {
      try { const client = createHttpDevSpaceClient(options.devspaceUrl); const devspace = { qualify: async (root: string) => { const { qualifyExactProjectRoot } = await import('../core/devspace/qualification.js'); const result = await qualifyExactProjectRoot(root, client); return { ok: result.ok, reason: result.code }; } }; console.log(JSON.stringify(await runOracle({ projectRoot: options.projectRoot, missionPath: options.mission, runRoot: options.runRoot, manifestPath: options.manifest, oracleCommand: options.oracleCommand ? [options.oracleCommand] : undefined, oracleArgs: options.oracleArg, oracleHome: options.oracleHome, dryRun: options.dryRun === true, devspace }), null, 2)); }
      catch (e) { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }
    });

  program.command('recover').requiredOption('--state <path>').requiredOption('--action <action>', 'live or harvest')
    .action(async o => { try { const plan=await planExactRecovery(o.state,o.action); console.log(JSON.stringify(await executeExactRecovery(plan),null,2)); } catch(e){ console.error(e instanceof Error?e.message:e); process.exitCode=1; } });
  program.command('audit').requiredOption('--state <path>').description('Prove no submission without launching Oracle')
    .action(async o => { const evidence=await proveNoSubmission(o.state); console.log(JSON.stringify(evidence ?? {ok:false},null,2)); if(!evidence) process.exitCode=2; });
  program.command('stop').requiredOption('--state <path>').description('Refuse unsafe stop unless state is owned and live')
    .action(async o => { try { await stopRecorded(o.state); console.log(JSON.stringify({ok:true})); } catch(e){ console.error(e instanceof Error?e.message:e); process.exitCode=1; } });

  return program;
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('ENOENT') && message.includes('install-manifest.json')) return 'LIFECYCLE_MANIFEST_MISSING';
  if (message.includes('Expected') || message.includes('Invalid input') || message.includes('ZodError')) return 'LIFECYCLE_MANIFEST_INVALID';
  return message.split(':', 1)[0] || 'LIFECYCLE_FAILED';
}
