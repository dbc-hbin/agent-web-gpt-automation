import { randomUUID } from 'node:crypto';
import { backup, DatabaseSync } from 'node:sqlite';
import {
  chmod, copyFile, lstat, mkdir, readFile, rename, rm,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import writeFileAtomic from 'write-file-atomic';
import { ProfileManager } from './profiles.js';
import {
  preflightCopiedProfile,
  type BrowserAuthPreflightResult,
} from './auth-preflight.js';

const COOKIE_SCOPE_SQL = `(
  host_key = 'chatgpt.com' OR host_key LIKE '%.chatgpt.com'
  OR host_key = 'openai.com' OR host_key LIKE '%.openai.com'
)`;

type SqlValue = string | number | bigint | Uint8Array | null;

export interface CookieRecoveryOptions {
  seedPath: string;
  oracleHome?: string;
  sourceUserDataRoot?: string;
  sourceProfile?: string;
  chromePath?: string;
  validateProfile?: (profilePath: string) => Promise<BrowserAuthPreflightResult>;
}

export interface CookieRecoveryResult {
  schema: 'codex.chatgpt.auth-cookie-recovery/v1';
  ok: boolean;
  status: 'RECOVERED' | 'BLOCKED';
  code: 'LOGIN_RECOVERED' | 'CHATGPT_COOKIES_NOT_FOUND' | 'IMPORTED_COOKIES_REJECTED';
  cookies_copied: number;
  source_profile: string;
  auth?: BrowserAuthPreflightResult;
}

interface ColumnInfo { name: string }

export function defaultChromeUserDataRoot(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (!local) throw new Error('CHROME_USER_DATA_ROOT_UNAVAILABLE');
    return path.join(local, 'Google', 'Chrome', 'User Data');
  }
  return path.join(os.homedir(), '.config', 'google-chrome');
}

async function assertRegularFile(file: string, code: string): Promise<void> {
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(code);
}

async function assertDirectory(directory: string, code: string): Promise<void> {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(code);
}

function validateProfileName(value: string): string {
  if (!value || value === '.' || value === '..' || /[\\/\0]/.test(value)) {
    throw new Error('CHROME_PROFILE_NAME_INVALID');
  }
  return value;
}

async function discoverSourceProfile(root: string, explicit?: string): Promise<string> {
  if (explicit) return validateProfileName(explicit);
  try {
    const localState = JSON.parse(await readFile(path.join(root, 'Local State'), 'utf8')) as {
      profile?: { last_used?: unknown };
    };
    if (typeof localState.profile?.last_used === 'string') {
      return validateProfileName(localState.profile.last_used);
    }
  } catch {
    // Default is Chrome's canonical first-profile directory.
  }
  return 'Default';
}

async function findCookies(profileRoot: string): Promise<string> {
  const candidates = [
    path.join(profileRoot, 'Network', 'Cookies'),
    path.join(profileRoot, 'Cookies'),
  ];
  for (const candidate of candidates) {
    try {
      await assertRegularFile(candidate, 'CHROME_COOKIES_INVALID');
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('CHROME_COOKIES_MISSING');
}

async function assertSeedClosed(seedPath: string): Promise<void> {
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort']) {
    try {
      await lstat(path.join(seedPath, name));
      throw new Error('PROFILE_SEED_IN_USE');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

// Chrome may keep SQLite/WAL files changing while either the user-data root or
// profile is open.  Treat any of Chrome's quiescence markers as authoritative;
// copying a live cookie database can otherwise produce a self-consistent but
// unusable snapshot.
async function assertQuiescent(directory: string): Promise<void> {
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort']) {
    try {
      await lstat(path.join(directory, name));
      throw new Error('CHROME_PROFILE_IN_USE');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function cookieColumns(db: DatabaseSync): string[] {
  return (db.prepare('PRAGMA table_info(cookies)').all() as unknown as ColumnInfo[])
    .map(column => column.name)
    .filter(name => /^[a-z_][a-z0-9_]*$/i.test(name));
}

function quoted(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function importCookieRows(sourcePath: string, targetPath: string): number {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  let target: DatabaseSync | undefined;
  try {
    target = new DatabaseSync(targetPath);
    const sourceColumns = cookieColumns(source);
    const targetColumns = new Set(cookieColumns(target));
    const columns = sourceColumns.filter(column => targetColumns.has(column));
    for (const required of ['host_key', 'name', 'path', 'encrypted_value']) {
      if (!columns.includes(required)) throw new Error(`COOKIE_SCHEMA_MISSING_COLUMN: ${required}`);
    }

    const names = columns.map(quoted).join(', ');
    const select = source.prepare(`SELECT ${names} FROM cookies WHERE ${COOKIE_SCOPE_SQL}`);
    select.setReadBigInts(true);
    const rows = select.all() as unknown as Array<Record<string, SqlValue>>;
    if (!rows.length) return 0;

    const insert = target.prepare(
      `INSERT OR REPLACE INTO cookies (${names}) VALUES (${columns.map(() => '?').join(', ')})`,
    );
    target.exec('BEGIN IMMEDIATE');
    try {
      target.prepare(`DELETE FROM cookies WHERE ${COOKIE_SCOPE_SQL}`).run();
      for (const row of rows) insert.run(...columns.map(column => row[column]));
      const integrity = target.prepare('PRAGMA integrity_check').get() as { integrity_check?: unknown } | undefined;
      if (integrity?.integrity_check !== 'ok') throw new Error('COOKIE_DATABASE_INTEGRITY_FAILED');
      target.exec('COMMIT');
    } catch (error) {
      target.exec('ROLLBACK');
      throw error;
    }
    target.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return rows.length;
  } finally {
    source.close();
    target?.close();
  }
}

async function buildMergedCookieKey(
  sourceLocalState: string, targetLocalState: string,
): Promise<{ original: Buffer; merged: string }> {
  const original = await readFile(targetLocalState);
  const source = JSON.parse(await readFile(sourceLocalState, 'utf8')) as {
    os_crypt?: Record<string, unknown>;
  };
  const sourceKeys = Object.fromEntries(
    ['encrypted_key', 'app_bound_encrypted_key']
      .filter(key => typeof source.os_crypt?.[key] === 'string')
      .map(key => [key, source.os_crypt![key]]),
  );
  if (Object.keys(sourceKeys).length === 0) {
    return { original, merged: original.toString('utf8') };
  }
  const target = JSON.parse(original.toString('utf8')) as Record<string, unknown>;
  target.os_crypt = { ...((target.os_crypt ?? {}) as Record<string, unknown>), ...sourceKeys };
  return { original, merged: `${JSON.stringify(target)}\n` };
}

async function copyCookieSidecars(
  source: string, destination: string, copied: string[],
): Promise<void> {
  for (const suffix of ['-wal', '-shm']) {
    try {
      await copyFile(`${source}${suffix}`, `${destination}${suffix}`);
      copied.push(suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

async function restoreCookieFiles(
  target: string, original: string, sidecars: readonly string[], originalLocalState: Buffer,
  targetLocalState: string,
): Promise<void> {
  try {
    await rm(target, { force: true });
    await Promise.all(['-wal', '-shm'].map(suffix => rm(`${target}${suffix}`, { force: true })));
    await copyFile(original, target);
    for (const suffix of sidecars) await copyFile(`${original}${suffix}`, `${target}${suffix}`);
    await writeFileAtomic(targetLocalState, originalLocalState, { fsync: true, mode: 0o600 });
  } catch (error) {
    throw new Error('COOKIE_RECOVERY_ROLLBACK_FAILED', { cause: error });
  }
}

export async function recoverChatGptLogin(options: CookieRecoveryOptions): Promise<CookieRecoveryResult> {
  const seed = path.resolve(options.seedPath);
  const oracleHome = path.resolve(options.oracleHome ?? path.join(os.homedir(), '.oracle'));
  const sourceRoot = path.resolve(options.sourceUserDataRoot ?? defaultChromeUserDataRoot());
  await Promise.all([
    assertDirectory(seed, 'PROFILE_SEED_INVALID'),
    assertDirectory(sourceRoot, 'CHROME_USER_DATA_ROOT_INVALID'),
    assertSeedClosed(seed),
  ]);
  if (seed === sourceRoot) throw new Error('COOKIE_RECOVERY_SOURCE_EQUALS_SEED');

  const sourceProfile = await discoverSourceProfile(sourceRoot, options.sourceProfile);
  await assertQuiescent(sourceRoot);
  await assertQuiescent(path.join(sourceRoot, sourceProfile));
  const sourceCookies = await findCookies(path.join(sourceRoot, sourceProfile));
  const targetCookies = await findCookies(path.join(seed, 'Default'));
  const sourceLocalState = path.join(sourceRoot, 'Local State');
  const targetLocalState = path.join(seed, 'Local State');
  await Promise.all([
    assertRegularFile(sourceLocalState, 'CHROME_LOCAL_STATE_INVALID'),
    assertRegularFile(targetLocalState, 'PROFILE_LOCAL_STATE_INVALID'),
  ]);

  const work = path.join(path.dirname(seed), `.cookie-recovery-${randomUUID()}`);
  await mkdir(work, { recursive: false, mode: 0o700 });
  const sourceSnapshot = path.join(work, 'source-cookies.sqlite');
  const candidate = path.join(work, 'candidate-cookies.sqlite');
  const originalCookies = path.join(work, 'original-cookies.sqlite');
  const displacedCookies = path.join(work, 'displaced-cookies.sqlite');
  let originalLocalState: Buffer | undefined;
  let replaced = false;
  const originalSidecars: string[] = [];
  try {
    const sourceDb = new DatabaseSync(sourceCookies, { readOnly: true });
    try {
      await backup(sourceDb, sourceSnapshot).catch(error => {
        throw new Error('CHROME_COOKIES_SNAPSHOT_FAILED', { cause: error });
      });
    } finally { sourceDb.close(); }
    // Preserve the exact closed seed files before SQLite can update a stale SHM file.
    await copyFile(targetCookies, originalCookies);
    await copyCookieSidecars(targetCookies, originalCookies, originalSidecars);
    const targetDb = new DatabaseSync(targetCookies, { readOnly: true });
    try {
      await backup(targetDb, candidate).catch(error => {
        throw new Error('PROFILE_COOKIES_SNAPSHOT_FAILED', { cause: error });
      });
    } finally { targetDb.close(); }
    await chmod(sourceSnapshot, 0o600);
    await chmod(candidate, 0o600);

    const count = importCookieRows(sourceSnapshot, candidate);
    if (count === 0) {
      return {
        schema: 'codex.chatgpt.auth-cookie-recovery/v1', ok: false, status: 'BLOCKED',
        code: 'CHATGPT_COOKIES_NOT_FOUND', cookies_copied: 0, source_profile: sourceProfile,
      };
    }

    const localState = await buildMergedCookieKey(sourceLocalState, targetLocalState);
    originalLocalState = localState.original;
    await writeFileAtomic(targetLocalState, localState.merged, { fsync: true, mode: 0o600 });
    replaced = true;
    await rename(targetCookies, displacedCookies);
    await Promise.all(['-wal', '-shm'].map(suffix => rm(`${targetCookies}${suffix}`, { force: true })));
    await rename(candidate, targetCookies);
    if (process.platform !== 'win32') await chmod(targetCookies, 0o600);

    const manager = new ProfileManager({ sourceProfilePath: seed }, oracleHome);
    const id = `cookie-recovery-${Date.now()}-${randomUUID()}`;
    const copied = await manager.createSession(id);
    let auth: BrowserAuthPreflightResult;
    try {
      auth = await (options.validateProfile ?? (profile => preflightCopiedProfile(profile, options.chromePath)))(copied);
    } finally {
      await manager.removeProfile(id);
    }
    // `ok` is the single auth-preflight authority.  Requiring only a 200
    // backend response would accept a partially rendered/logged-out session.
    const loginRecovered = auth.ok;
    if (!loginRecovered) {
      await restoreCookieFiles(
        targetCookies, originalCookies, originalSidecars, originalLocalState, targetLocalState,
      );
      replaced = false;
      return {
        schema: 'codex.chatgpt.auth-cookie-recovery/v1', ok: false, status: 'BLOCKED',
        code: 'IMPORTED_COOKIES_REJECTED', cookies_copied: count,
        source_profile: sourceProfile, auth,
      };
    }

    replaced = false;
    return {
      schema: 'codex.chatgpt.auth-cookie-recovery/v1', ok: true, status: 'RECOVERED',
      code: 'LOGIN_RECOVERED', cookies_copied: count, source_profile: sourceProfile, auth,
    };
  } catch (error) {
    try {
      if (replaced && originalLocalState) {
        await restoreCookieFiles(
          targetCookies, originalCookies, originalSidecars, originalLocalState, targetLocalState,
        );
      } else if (originalLocalState) {
        await writeFileAtomic(targetLocalState, originalLocalState, { fsync: true, mode: 0o600 });
      }
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'COOKIE_RECOVERY_ROLLBACK_FAILED');
    }
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
