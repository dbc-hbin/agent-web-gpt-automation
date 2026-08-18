import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { accessSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import writeFileAtomic from 'write-file-atomic';
import { z } from 'zod';

/** Resolve the packaged source root independently of the caller's cwd. */
export function resolvePackageSource(metaUrl = import.meta.url): string {
  let cursor = path.dirname(fileURLToPath(metaUrl));
  for (let i = 0; i < 5; i += 1) {
    if (path.basename(cursor) !== 'node_modules' && pathExists(path.join(cursor, 'install-manifest.json'))) return cursor;
    cursor = path.dirname(cursor);
  }
  return path.resolve(fileURLToPath(new URL('../', metaUrl)));
}

function pathExists(file: string): boolean {
  try { accessSync(file); return true; } catch { return false; }
}

const RECEIPT_SCHEMA = 'codex.chatgpt.install-receipt/v1' as const;
const WAL_SCHEMA = 'codex.chatgpt.install-wal/v1' as const;

const InstallManifestSchema = z.object({
  schema: z.string().min(1),
  version: z.string().min(1),
  include: z.array(z.string().min(1)),
}).passthrough();

export async function readInstallManifest(sourceRoot: string): Promise<z.infer<typeof InstallManifestSchema>> {
  const root = path.resolve(sourceRoot);
  return InstallManifestSchema.parse(JSON.parse(await readFile(path.join(root, 'install-manifest.json'), 'utf8')));
}

export async function manifestVersion(sourceRoot: string): Promise<string> {
  return (await readInstallManifest(sourceRoot)).version;
}

const InstallRecordSchema = z.object({
  path: z.string().min(1),
  action: z.enum(['created', 'overwritten']),
  installed_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  backup_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict();

const InstallReceiptSchema = z.object({
  schema: z.literal(RECEIPT_SCHEMA),
  action: z.enum(['install', 'update']),
  installed_at: z.string().datetime(),
  manifest_version: z.string().min(1),
  source_root: z.string().min(1),
  agent_home: z.string().min(1),
  backup: z.string().min(1),
  wal: z.string().min(1),
  files: z.array(InstallRecordSchema),
}).strict();

export interface LifecycleResult {
  ok: boolean;
  action: 'install' | 'update' | 'rollback';
  status: 'COMPLETE' | 'CONFLICT';
  receipt: string;
  count?: number;
  conflicts?: string[];
}

const InstallWalSchema = z.object({
  schema: z.literal(WAL_SCHEMA),
  status: z.enum(['ACTIVE', 'COMPLETE', 'ROLLED_BACK_AFTER_CRASH']),
  action: z.enum(['install', 'update']),
  backup: z.string().min(1),
  files: z.array(InstallRecordSchema),
}).passthrough();

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function sha256File(file: string): Promise<string> {
  return sha256(await readFile(file));
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, { fsync: true });
}

function safeChild(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) {
    throw new Error(`LIFECYCLE_PATH_UNSAFE: ${relative}`);
  }
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, relative);
  if (candidate === absoluteRoot || !candidate.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`LIFECYCLE_PATH_ESCAPE: ${relative}`);
  }
  return candidate;
}

async function assertNoSymlink(root: string, candidate: string): Promise<void> {
  let cursor = candidate;
  while (cursor !== root) {
    const stat = await lstat(cursor).catch(() => undefined);
    if (stat?.isSymbolicLink()) throw new Error(`LIFECYCLE_SYMLINK_REFUSED: ${cursor}`);
    cursor = path.dirname(cursor);
  }
}

async function copyAtomic(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary);
    await import('node:fs/promises').then(fs => fs.rename(temporary, destination));
  } finally {
    await rm(temporary, { force: true });
  }
}

async function expandPattern(root: string, pattern: string): Promise<string[]> {
  if (!pattern.includes('*')) return [pattern];
  const directory = path.dirname(pattern);
  const basename = path.basename(pattern);
  if ((basename.match(/\*/g) ?? []).length !== 1 || basename !== `*.${basename.split('.').at(-1)}`) {
    throw new Error(`LIFECYCLE_GLOB_UNSUPPORTED: ${pattern}`);
  }
  const suffix = basename.slice(1);
  const names = await readdir(safeChild(root, directory));
  return names.filter(name => name.endsWith(suffix)).sort().map(name => path.join(directory, name));
}

export async function manifestFiles(sourceRoot: string): Promise<{ version: string; files: string[] }> {
  const root = path.resolve(sourceRoot);
  const manifest = await readInstallManifest(root);
  const files = new Set<string>();
  for (const pattern of manifest.include) {
    for (const relative of await expandPattern(root, pattern)) {
      const source = safeChild(root, relative);
      await assertNoSymlink(root, source);
      const stat = await lstat(source);
      if (!stat.isFile()) throw new Error(`LIFECYCLE_SOURCE_NOT_FILE: ${relative}`);
      files.add(relative);
    }
  }
  return { version: manifest.version, files: [...files].sort() };
}

async function latestReceipt(agentHome: string): Promise<string> {
  const root = path.join(agentHome, 'receipts');
  const names = (await readdir(root)).filter(name => /^agent-web-gpt-.+\.json$/.test(name)).sort();
  if (!names.length) throw new Error('LIFECYCLE_RECEIPT_MISSING');
  return path.join(root, names.at(-1)!);
}

export async function recoverPendingInstalls(agentHome: string): Promise<string[]> {
  const home = path.resolve(agentHome);
  const backupsRoot = path.join(home, 'backups');
  const names = await readdir(backupsRoot).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[];
    throw error;
  });
  const recovered: string[] = [];
  for (const name of names.sort()) {
    const walPath = path.join(backupsRoot, name, 'install.wal.json');
    let wal: z.infer<typeof InstallWalSchema>;
    try {
      wal = InstallWalSchema.parse(JSON.parse(await readFile(walPath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (wal.status !== 'ACTIVE') continue;
    const backup = path.resolve(wal.backup);
    if (!backup.startsWith(`${backupsRoot}${path.sep}`)) throw new Error('LIFECYCLE_WAL_NOT_OWNED');
    const conflicts: string[] = [];
    for (const record of [...wal.files].reverse()) {
      const destination = safeChild(home, record.path);
      const actual = await sha256File(destination).catch(() => undefined);
      // An ACTIVE record whose installed bytes are absent never reached mutation.
      if (actual !== record.installed_sha256) continue;
      if (record.action === 'created') await rm(destination);
      else {
        const backupFile = safeChild(backup, record.path);
        if (await sha256File(backupFile).catch(() => undefined) !== record.backup_sha256) conflicts.push(record.path);
        else await copyAtomic(backupFile, destination);
      }
    }
    if (conflicts.length) throw new Error(`LIFECYCLE_CRASH_RECOVERY_CONFLICT: ${conflicts.join(',')}`);
    await writeJsonAtomic(walPath, { ...wal, status: 'ROLLED_BACK_AFTER_CRASH', recovered_at: new Date().toISOString() });
    recovered.push(walPath);
  }
  return recovered;
}

export async function installOrUpdate(
  action: 'install' | 'update', sourceRoot: string, agentHome: string,
): Promise<LifecycleResult> {
  const source = path.resolve(sourceRoot);
  const home = path.resolve(agentHome);
  const manifest = await manifestFiles(source);
  await mkdir(home, { recursive: true });
  await recoverPendingInstalls(home);
  const stamp = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID()}`;
  const backup = path.join(home, 'backups', `agent-web-gpt-${stamp}`);
  const receiptPath = path.join(home, 'receipts', `agent-web-gpt-${stamp}.json`);
  const walPath = path.join(backup, 'install.wal.json');
  const records: z.infer<typeof InstallRecordSchema>[] = [];
  const wal = { schema: WAL_SCHEMA, status: 'ACTIVE', action, backup, files: records };
  await writeJsonAtomic(walPath, wal);
  try {
    for (const relative of manifest.files) {
      const sourceFile = safeChild(source, relative);
      const destination = safeChild(home, relative);
      await assertNoSymlink(home, destination);
      const existing = await lstat(destination).catch(() => undefined);
      let backupHash: string | null = null;
      let recordAction: 'created' | 'overwritten' = 'created';
      if (existing) {
        if (!existing.isFile() || existing.isSymbolicLink()) throw new Error(`LIFECYCLE_DESTINATION_INVALID: ${relative}`);
        recordAction = 'overwritten';
        const backupFile = safeChild(backup, relative);
        await copyAtomic(destination, backupFile);
        backupHash = await sha256File(backupFile);
      }
      const installedHash = await sha256File(sourceFile);
      records.push({ path: relative, action: recordAction, installed_sha256: installedHash, backup_sha256: backupHash });
      await writeJsonAtomic(walPath, wal);
      await copyAtomic(sourceFile, destination);
      if (await sha256File(destination) !== installedHash) throw new Error(`LIFECYCLE_COMMIT_HASH_MISMATCH: ${relative}`);
    }
  } catch (error) {
    await rollbackRecords(home, backup, records);
    throw error;
  }
  await writeJsonAtomic(walPath, { ...wal, status: 'COMPLETE', completed_at: new Date().toISOString() });
  const receipt = InstallReceiptSchema.parse({
    schema: RECEIPT_SCHEMA, action, installed_at: new Date().toISOString(),
    manifest_version: manifest.version, source_root: source, agent_home: home,
    backup, wal: walPath, files: records,
  });
  await writeJsonAtomic(receiptPath, receipt);
  return { ok: true, action, status: 'COMPLETE', receipt: receiptPath, count: records.length };
}

async function rollbackRecords(home: string, backup: string, records: z.infer<typeof InstallRecordSchema>[]): Promise<string[]> {
  const conflicts: string[] = [];
  for (const record of [...records].reverse()) {
    const destination = safeChild(home, record.path);
    const actual = await sha256File(destination).catch(() => undefined);
    if (actual !== record.installed_sha256) {
      conflicts.push(record.path);
      continue;
    }
    if (record.action === 'created') {
      await rm(destination);
    } else {
      const backupFile = safeChild(backup, record.path);
      if (await sha256File(backupFile).catch(() => undefined) !== record.backup_sha256) {
        conflicts.push(record.path);
        continue;
      }
      await copyAtomic(backupFile, destination);
    }
  }
  return conflicts;
}

export async function rollbackInstall(agentHome: string, requestedReceipt?: string): Promise<LifecycleResult> {
  const home = path.resolve(agentHome);
  const receiptPath = path.resolve(requestedReceipt ?? await latestReceipt(home));
  const receiptsRoot = path.join(home, 'receipts');
  if (!receiptPath.startsWith(`${receiptsRoot}${path.sep}`)) throw new Error('LIFECYCLE_RECEIPT_NOT_OWNED');
  const receipt = InstallReceiptSchema.parse(JSON.parse(await readFile(receiptPath, 'utf8')));
  if (path.resolve(receipt.agent_home) !== home || !path.resolve(receipt.backup).startsWith(`${path.join(home, 'backups')}${path.sep}`)) {
    throw new Error('LIFECYCLE_RECEIPT_NOT_OWNED');
  }
  const conflicts = await rollbackRecords(home, receipt.backup, receipt.files);
  return {
    ok: conflicts.length === 0,
    action: 'rollback',
    status: conflicts.length ? 'CONFLICT' : 'COMPLETE',
    receipt: receiptPath,
    conflicts,
  };
}
