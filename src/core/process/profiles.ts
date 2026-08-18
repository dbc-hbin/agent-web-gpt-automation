import { z } from 'zod';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { access, chmod, cp, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';

export const ProfileConfig = z.object({
  sourceProfilePath: z.string(),
  maxAgeMinutes: z.number().optional(),
});

export interface ProfileInfo {
  id: string;
  sourcePath: string;
  copiedAt: Date;
  copiedPath: string;
  lastValidated: Date;
  isValid: boolean;
}

export class ProfileManager {
  private profiles = new Map<string, ProfileInfo>();
  private readonly seedPath: string;
  private readonly sessionRoot: string;

  constructor(config: z.infer<typeof ProfileConfig>, private readonly oracleHome: string) {
    this.seedPath = path.resolve(config.sourceProfilePath);
    this.sessionRoot = path.resolve(oracleHome, 'browser-sessions');
  }

  async createSession(profileId?: string): Promise<string> {
    const id = profileId ?? crypto.randomUUID();
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('PROFILE_ID_INVALID');
    const source = await lstat(this.seedPath);
    if (!source.isDirectory() || source.isSymbolicLink()) throw new Error('PROFILE_SEED_INVALID');

    await mkdir(this.sessionRoot, { recursive: true, mode: 0o700 });
    const copyTo = path.join(this.sessionRoot, `${id}-${crypto.randomUUID()}`);
    try {
      await cp(this.seedPath, copyTo, {
        recursive: true,
        force: false,
        errorOnExist: true,
        dereference: false,
        filter: async sourcePath => {
          if ((await lstat(sourcePath)).isSymbolicLink()) throw new Error('PROFILE_SEED_SYMLINK_FORBIDDEN');
          return true;
        },
      });
      await this.hardenProfileTree(copyTo);
    } catch (error) {
      await rm(copyTo, { recursive: true, force: true });
      throw error;
    }

    const info: ProfileInfo = {
      id,
      sourcePath: this.seedPath,
      copiedAt: new Date(),
      copiedPath: copyTo,
      lastValidated: new Date(),
      isValid: false,
    };

    this.profiles.set(id, info);
    return copyTo;
  }

  async validateProfile(profileId: string): Promise<boolean> {
    const info = this.profiles.get(profileId);
    if (!info) return false;

    try {
      await Promise.all([
        access(path.join(info.copiedPath, 'Local State'), constants.R_OK),
        access(path.join(info.copiedPath, 'Default', 'Local Storage'), constants.R_OK),
        this.findReadableCookies(info.copiedPath),
      ]);
      info.isValid = true;
    } catch {
      info.isValid = false;
    }

    info.lastValidated = new Date();
    return info.isValid;
  }

  async removeProfile(profileId: string): Promise<void> {
    const info = this.profiles.get(profileId);
    if (!info) return;

    const relative = path.relative(this.sessionRoot, info.copiedPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('PROFILE_PATH_OUTSIDE_SESSION_ROOT');
    }
    await rm(info.copiedPath, { recursive: true, force: true });
    this.profiles.delete(profileId);
  }

  getProfile(profileId: string): ProfileInfo | undefined {
    return this.profiles.get(profileId);
  }

  private async findReadableCookies(profileRoot: string): Promise<void> {
    const candidates = [
      path.join(profileRoot, 'Default', 'Network', 'Cookies'),
      path.join(profileRoot, 'Default', 'Cookies'),
    ];
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.R_OK);
        return;
      } catch {
        // Try the legacy Chrome cookie location next.
      }
    }
    throw new Error('PROFILE_COOKIES_MISSING');
  }

  private async hardenProfileTree(target: string): Promise<void> {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) throw new Error('PROFILE_COPY_SYMLINK_FORBIDDEN');
    if (metadata.isDirectory()) {
      await chmod(target, 0o700);
      const entries = await readdir(target);
      for (const entry of entries) await this.hardenProfileTree(path.join(target, entry));
      return;
    }
    await chmod(target, 0o600);
  }
}
