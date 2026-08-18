import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { readFile, rename, rm } from 'node:fs/promises';
import { SessionAuthority } from '../../types/index.js';
import { createLockAdapter, LockAdapter } from './lock-adapter.js';
import writeFileAtomic from 'write-file-atomic';

export interface LockConfig {
  projectRoot: string;
  retries?: number;
}

const MAX_TIMER_MS = 2_147_483_647;

export class ProjectLockHeldError extends Error {
  constructor(projectRoot: string) {
    super(`PROJECT_SESSION_STILL_LIVE: failed to acquire project lock for ${projectRoot}`);
    this.name = 'ProjectLockHeldError';
  }
}

export class LockManager {
  private readonly lockPath: string;
  private readonly name: string;
  private readonly lockAdapter: LockAdapter;
  private ownedRelease?: () => Promise<void>;

  constructor(private config: LockConfig) {
    const canonicalRoot = path.resolve(config.projectRoot);
    const hash = crypto.createHash('sha256').update(canonicalRoot).digest('hex');
    this.name = canonicalRoot.replace(/\W/g, '_');
    this.lockPath = path.join(os.tmpdir(), `agent-web-gpt-lock-${hash}.lock`);
    this.lockAdapter = createLockAdapter();
  }

  getName(): string {
    return this.name;
  }

  getLockPath(): string {
    return this.lockPath;
  }

  async acquire(): Promise<() => Promise<void>> {
    if (this.ownedRelease) {
      throw new ProjectLockHeldError(this.config.projectRoot);
    }
    let release: () => Promise<void>;
    try {
      release = await this.lockAdapter.acquire(this.lockPath, {
        realpath: false,
        retries: this.config.retries ?? 3,
        stale: Number.POSITIVE_INFINITY,
        update: MAX_TIMER_MS,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
        throw new ProjectLockHeldError(this.config.projectRoot);
      }
      throw error;
    }

    const ownerToken = crypto.randomUUID();
    const ownerPath = `${this.lockPath}.owner.json`;
    try {
      await writeFileAtomic(ownerPath, JSON.stringify({
        schema: 'codex.chatgpt.project-lock-owner/v1',
        pid: process.pid,
        token: ownerToken,
        project_root: path.resolve(this.config.projectRoot),
        acquired_at: new Date().toISOString(),
      }));
    } catch (error) {
      await release();
      throw error;
    }
    let releasePromise: Promise<void> | undefined;
    const ownedRelease = async () => {
      releasePromise ??= (async () => {
        const owner = JSON.parse(await readFile(ownerPath, 'utf8')) as { token?: string };
        if (owner.token !== ownerToken) throw new Error('PROJECT_LOCK_OWNER_MISMATCH');
        // Release the kernel lock first, then remove only our sidecar.  A
        // contender can acquire immediately after release and publish a new
        // owner; never delete that newer owner's evidence.
        await release();
        try {
          const currentOwner = JSON.parse(await readFile(ownerPath, 'utf8')) as { token?: string };
          if (currentOwner.token === ownerToken) await rm(ownerPath, { force: true });
        } catch {
          // The sidecar may already have been replaced or removed.  The lock
          // itself has been released, so cleanup is intentionally idempotent.
        }
        if (this.ownedRelease === ownedRelease) this.ownedRelease = undefined;
      })();
      await releasePromise;
    };
    this.ownedRelease = ownedRelease;
    return ownedRelease;
  }

  async tryAcquire(): Promise<{ release: () => Promise<void>; held: boolean }> {
    try {
      const release = await this.acquire();
      return { release, held: true };
    } catch (error) {
      if (!(error instanceof ProjectLockHeldError)) throw error;
      return { release: async () => {}, held: false };
    }
  }

  async release(): Promise<void> {
    const release = this.ownedRelease;
    if (!release) return;
    await release();
  }

  async reclaimAbandoned(sessionAuthority: SessionAuthority, options: { recoveryTakeover?: boolean } = {}): Promise<void> {
    if (sessionAuthority !== 'settled' && !options.recoveryTakeover) {
      throw new Error(`PROJECT_LOCK_RECLAIM_FORBIDDEN: ${sessionAuthority}`);
    }
    if (this.ownedRelease) throw new Error('PROJECT_LOCK_OWNER_STILL_ALIVE');
    const ownerPath = `${this.lockPath}.owner.json`;
    let ownerBytes: string;
    let owner: { pid?: number; project_root?: string; token?: string };
    try {
      ownerBytes = await readFile(ownerPath, 'utf8');
      owner = JSON.parse(ownerBytes) as typeof owner;
    } catch {
      throw new Error('PROJECT_LOCK_OWNER_EVIDENCE_INVALID');
    }
    if (owner.project_root !== path.resolve(this.config.projectRoot)) {
      throw new Error('PROJECT_LOCK_ROOT_MISMATCH');
    }
    if (!Number.isInteger(owner.pid) || (owner.pid ?? 0) <= 0 || !owner.token) {
      throw new Error('PROJECT_LOCK_OWNER_EVIDENCE_INVALID');
    }
    try {
      process.kill(owner.pid!, 0);
      throw new Error('PROJECT_LOCK_OWNER_STILL_ALIVE');
    } catch (error) {
      if (error instanceof Error && error.message === 'PROJECT_LOCK_OWNER_STILL_ALIVE') throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM') throw new Error('PROJECT_LOCK_OWNER_STILL_ALIVE');
      if (code !== 'ESRCH') throw error;
    }
    if (await readFile(ownerPath, 'utf8') !== ownerBytes) throw new Error('PROJECT_LOCK_OWNER_CHANGED');

    const lockDirectory = `${this.lockPath}.lock`;
    const quarantine = `${this.lockPath}.reclaim-${crypto.randomUUID()}`;
    let quarantined = false;
    try {
      // Close the check/rename window: a contender may have replaced the
      // sidecar since the dead-owner probe. Never quarantine on stale evidence.
      if (await readFile(ownerPath, 'utf8') !== ownerBytes) throw new Error('PROJECT_LOCK_OWNER_CHANGED');
      await rename(lockDirectory, quarantine);
      quarantined = true;
    } catch (error) {
      // A previous recovery may have already quarantined the lock.  Once the
      // dead-owner evidence has been validated, an absent lock directory is
      // an idempotent success rather than a storage failure.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!quarantined) {
      try {
        const currentOwner = JSON.parse(await readFile(ownerPath, 'utf8')) as { token?: string };
        if (currentOwner.token === owner.token) await rm(ownerPath, { force: true });
      } catch {
        // Sidecar was concurrently replaced or removed.
      }
      return;
    }
    try {
      // If a contender acquired and published a new owner after quarantine,
      // preserve its evidence and leave its lock directory untouched.
      const currentOwner = JSON.parse(await readFile(ownerPath, 'utf8')) as { token?: string };
      if (currentOwner.token !== owner.token) {
        await rm(quarantine, { recursive: true, force: true });
        throw new Error('PROJECT_LOCK_OWNER_CHANGED');
      }
      await rm(quarantine, { recursive: true, force: false });
      try {
        const currentOwner = JSON.parse(await readFile(ownerPath, 'utf8')) as { token?: string };
        if (currentOwner.token === owner.token) await rm(ownerPath, { force: true });
      } catch {
        // A concurrent new owner may have replaced the sidecar; never remove it blindly.
      }
    } catch (error) {
      await rename(quarantine, lockDirectory).catch(() => undefined);
      throw error;
    }
  }
}
