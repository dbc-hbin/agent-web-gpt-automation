import * as lockFile from 'proper-lockfile';

/** Options shared by the platform lock implementations. */
export interface LockAdapterOptions {
  retries?: number;
  stale?: number;
  update?: number;
  realpath?: boolean;
}

export type LockRelease = () => Promise<void>;

/**
 * The lock contract used by state/session ownership.
 *
 * Both platform implementations intentionally expose the same file-lock
 * semantics: acquisition is atomic, contention is reported as ELOCKED, and
 * release is delegated to proper-lockfile. Keeping this boundary explicit
 * prevents callers from depending on Win32/POSIX details.
 */
export interface LockAdapter {
  acquire(lockPath: string, options: LockAdapterOptions): Promise<LockRelease>;
}

abstract class ProperFileLockAdapter implements LockAdapter {
  async acquire(lockPath: string, options: LockAdapterOptions): Promise<LockRelease> {
    return lockFile.lock(lockPath, options);
  }
}

/** POSIX file-lock semantics (implemented via proper-lockfile's atomic lock directory). */
export class PosixFileLockAdapter extends ProperFileLockAdapter {}

/** Windows file-lock semantics (same contract; proper-lockfile handles Win32 details). */
export class WindowsFileLockAdapter extends ProperFileLockAdapter {}

export function createLockAdapter(platform: NodeJS.Platform = process.platform): LockAdapter {
  return platform === 'win32' ? new WindowsFileLockAdapter() : new PosixFileLockAdapter();
}
