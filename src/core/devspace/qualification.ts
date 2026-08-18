import * as path from 'node:path';

export interface DevSpaceClient {
  open_workspace(args: { root: string }): Promise<unknown>;
  list_directory(args: { path: string }): Promise<unknown>;
}

export interface DevSpaceQualification {
  ok: boolean;
  code: string;
  projectRoot: string;
  allowedRoots?: string[];
  detail?: string;
}

function rootsFrom(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  const roots = obj.allowedRoots ?? obj.allowed_roots ?? (obj.result as Record<string, unknown> | undefined)?.allowedRoots;
  return Array.isArray(roots) ? roots.filter((v): v is string => typeof v === 'string').map(v => path.resolve(v)) : [];
}

export async function qualifyExactProjectRoot(
  projectRoot: string,
  client: DevSpaceClient,
): Promise<DevSpaceQualification> {
  const root = path.resolve(projectRoot);
  let opened: unknown;
  try { opened = await client.open_workspace({ root }); }
  catch (error) { return { ok: false, code: 'DEVSPACE_OPEN_WORKSPACE_FAILED', projectRoot: root, detail: String(error) }; }
  const allowedRoots = rootsFrom(opened);
  if (allowedRoots.length !== 1 || allowedRoots[0] !== root) {
    return { ok: false, code: 'DEVSPACE_EXACT_ROOT_MISMATCH', projectRoot: root, allowedRoots };
  }
  try {
    await client.list_directory({ path: root });
  } catch (error) {
    return { ok: false, code: 'DEVSPACE_READONLY_TOOL_FAILED', projectRoot: root, allowedRoots, detail: String(error) };
  }
  return { ok: true, code: 'DEVSPACE_EXACT_ROOT_QUALIFIED', projectRoot: root, allowedRoots };
}
