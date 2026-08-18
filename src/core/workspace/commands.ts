export interface CommandRunner { run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> }
export interface WorkspaceSetupOptions { root: string; /** Preview is the safe default. */ dryRun?: boolean; /** Explicitly opt into command execution. */ apply?: boolean; runner?: CommandRunner }
export const workspaceCommands = (root: string) => [
  { command: 'devspace', args: ['doctor', '--root', root] },
  { command: 'tailscale', args: ['funnel', 'status'] },
] as const;

export async function setupWorkspace(options: WorkspaceSetupOptions) {
  const root = options.root?.trim();
  if (!root) throw new Error('WORKSPACE_ROOT_REQUIRED');
  const commands = workspaceCommands(root);
  const dryRun = options.apply !== true && options.dryRun !== false;
  if (dryRun) return { schema: 'codex.chatgpt.workspace/v1' as const, status: 'DRY_RUN' as const, commands };
  if (!options.runner) throw new Error('WORKSPACE_RUNNER_REQUIRED');
  const results = [];
  for (const c of commands) results.push({ ...c, result: await options.runner.run(c.command, [...c.args]) });
  return { schema: 'codex.chatgpt.workspace/v1' as const, status: results.every(r => r.result.code === 0) ? 'READY' as const : 'BLOCKED' as const, results };
}

/** Doctor is intentionally the same bounded, read-only command set as setup preview. */
export const doctorWorkspace = (root: string, runner?: CommandRunner) =>
  setupWorkspace({ root, runner, dryRun: runner === undefined });
