export interface CommandRunner { run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> }
export interface WorkspaceSetupOptions { root: string; dryRun?: boolean; runner?: CommandRunner }
export async function setupWorkspace(options: WorkspaceSetupOptions) {
  const commands = [{ command: 'devspace', args: ['doctor', '--root', options.root] }, { command: 'tailscale', args: ['funnel', 'status'] }];
  if (options.dryRun || !options.runner) return { schema: 'codex.chatgpt.workspace/v1', status: 'DRY_RUN', commands };
  const results = []; for (const c of commands) results.push({ ...c, result: await options.runner.run(c.command, c.args) });
  return { schema: 'codex.chatgpt.workspace/v1', status: results.every(r => r.result.code === 0) ? 'READY' : 'BLOCKED', results };
}
