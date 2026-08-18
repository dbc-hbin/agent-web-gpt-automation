import { Command } from 'commander';
import { launchProfileLogin, prepareProfileLogin, runDoctor } from './doctor.js';
import { installOrUpdate, rollbackInstall } from './lifecycle.js';
import { ProfileManager } from '../core/process/profiles.js';
import { preflightCopiedProfile } from '../core/process/auth-preflight.js';
import { recoverChatGptLogin } from '../core/process/cookie-recovery.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { runOracle, loadRunState } from '../core/run/runtime.js';
import { planExactRecovery, executeExactRecovery } from '../core/forensics/recovery.js';
import { proveNoSubmission } from '../core/forensics/no-submission.js';

export function createCLI(): Command {
  const program = new Command();
  program
    .name('awgpt')
    .description('Guarded, recoverable web GPT automation')
    .version('1.0.0');

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
      .option('--source <path>', 'repository source root', process.cwd())
      .option('--agent-home <path>', 'installation root', path.join(os.homedir(), '.codex'))
      .action(async options => {
        const result = await installOrUpdate(action, options.source, options.agentHome);
        console.log(JSON.stringify(result, null, 2));
      });
  }

  program.command('rollback')
    .description('Rollback the latest receipt without overwriting modified files')
    .option('--agent-home <path>', 'installation root', path.join(os.homedir(), '.codex'))
    .option('--receipt <path>', 'specific owned receipt')
    .action(async options => {
      const result = await rollbackInstall(options.agentHome, options.receipt);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 2;
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
    .action(async options => {
      try { console.log(JSON.stringify(await runOracle({ projectRoot: options.projectRoot, missionPath: options.mission, runRoot: options.runRoot, manifestPath: options.manifest, oracleCommand: options.oracleCommand ? [options.oracleCommand] : undefined, oracleArgs: options.oracleArg, oracleHome: options.oracleHome }), null, 2)); }
      catch (e) { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }
    });

  program.command('recover').requiredOption('--state <path>').requiredOption('--action <action>', 'live or harvest')
    .action(async o => { try { const plan=await planExactRecovery(o.state,o.action); console.log(JSON.stringify(await executeExactRecovery(plan),null,2)); } catch(e){ console.error(e instanceof Error?e.message:e); process.exitCode=1; } });
  program.command('audit').requiredOption('--state <path>').description('Prove no submission without launching Oracle')
    .action(async o => { const evidence=await proveNoSubmission(o.state); console.log(JSON.stringify(evidence ?? {ok:false},null,2)); if(!evidence) process.exitCode=2; });
  program.command('stop').requiredOption('--state <path>').description('Refuse unsafe stop unless state is owned and live')
    .action(async o => { try { const state=await loadRunState(o.state); if(state.session_authority!=='live' && state.session_authority!=='submitted_unknown') throw new Error('STOP_UNSAFE_AUTHORITY'); throw new Error('STOP_REQUIRES_ACTIVE_SUPERVISOR'); } catch(e){ console.error(e instanceof Error?e.message:e); process.exitCode=1; } });

  return program;
}
