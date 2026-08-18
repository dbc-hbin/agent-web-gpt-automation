import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { execa, type ExecaError } from 'execa';

export interface LocalGateRequest {
  /** Command and arguments. The first item is the executable. */
  argv: readonly string[];
  /** The only directory from which the command may be run. */
  projectRoot: string;
  /** Optional environment additions (the ambient environment is retained). */
  env?: Readonly<Record<string, string | undefined>>;
  timeoutMs?: number;
}

export interface LocalGateResult {
  ok: boolean;
  argv: string[];
  cwd: string;
  exit_code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  output_sha256: string;
  env_sha256: string;
  duration_ms: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function environmentHash(env: Record<string, string | undefined>): string {
  const canonical = Object.keys(env).sort().map(key => `${key}=${env[key] ?? ''}`).join('\n');
  return sha256(canonical);
}

/** Execute a deterministic local gate without invoking a shell. */
export async function runLocalGate(request: LocalGateRequest): Promise<LocalGateResult> {
  if (!Array.isArray(request.argv) || request.argv.length === 0 || request.argv.some(item => typeof item !== 'string')) {
    throw new Error('GATE_ARGV_INVALID');
  }
  const suppliedRoot = path.resolve(request.projectRoot);
  let cwd: string;
  try {
    const metadata = await lstat(suppliedRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('GATE_PROJECT_ROOT_INVALID');
    cwd = await realpath(suppliedRoot);
  } catch {
    throw new Error('GATE_PROJECT_ROOT_INVALID');
  }

  const mergedEnv: Record<string, string | undefined> = { ...process.env, ...(request.env ?? {}) };
  const started = Date.now();
  try {
    const result = await execa(request.argv[0], request.argv.slice(1), {
      cwd,
      env: mergedEnv,
      shell: false,
      reject: false,
      timeout: request.timeoutMs,
      stripFinalNewline: false,
    });
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    return {
      ok: result.exitCode === 0,
      argv: [...request.argv], cwd,
      exit_code: result.exitCode ?? null,
      signal: result.signal ?? null,
      stdout, stderr,
      output_sha256: sha256(`${stdout}\0${stderr}`),
      env_sha256: environmentHash(mergedEnv),
      duration_ms: Date.now() - started,
    };
  } catch (error) {
    const execaError = error as ExecaError;
    const stdout = String(execaError.stdout ?? '');
    const stderr = String(execaError.stderr ?? '');
    return {
      ok: false, argv: [...request.argv], cwd,
      exit_code: typeof execaError.exitCode === 'number' ? execaError.exitCode : null,
      signal: execaError.signal ?? null, stdout, stderr,
      output_sha256: sha256(`${stdout}\0${stderr}`),
      env_sha256: environmentHash(mergedEnv),
      duration_ms: Date.now() - started,
    };
  }
}

export const runGate = runLocalGate;
