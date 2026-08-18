import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recoverChatGptLogin } from '../src/core/process/cookie-recovery.js';

interface CookieFixture { host: string; name: string; encrypted: string }

function createCookies(file: string, cookies: CookieFixture[]): void {
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      CREATE TABLE cookies (
        creation_utc INTEGER NOT NULL,
        host_key TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        encrypted_value BLOB NOT NULL,
        path TEXT NOT NULL,
        UNIQUE(host_key, name, path)
      );
    `);
    const insert = db.prepare(`
      INSERT INTO cookies (creation_utc, host_key, name, value, encrypted_value, path)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const cookie of cookies) {
      insert.run(13_000_000_000_000_000n, cookie.host, cookie.name, '', Buffer.from(cookie.encrypted), '/');
    }
  } finally {
    db.close();
  }
}

function readCookies(file: string): Array<{ host_key: string; name: string; encrypted: string }> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare('SELECT host_key, name, encrypted_value FROM cookies ORDER BY host_key, name').all() as Array<{
      host_key: string; name: string; encrypted_value: Uint8Array;
    }>).map(row => ({
      host_key: row.host_key,
      name: row.name,
      encrypted: Buffer.from(row.encrypted_value).toString(),
    }));
  } finally {
    db.close();
  }
}

async function fixture(): Promise<{
  root: string; source: string; seed: string; sourceCookies: string; targetCookies: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'cookie-recovery-'));
  const source = join(root, 'chrome');
  const seed = join(root, 'seed');
  const sourceCookies = join(source, 'Profile 1', 'Network', 'Cookies');
  const targetCookies = join(seed, 'Default', 'Network', 'Cookies');
  await Promise.all([
    mkdir(join(source, 'Profile 1', 'Network'), { recursive: true }),
    mkdir(join(source, 'Profile 1', 'Local Storage'), { recursive: true }),
    mkdir(join(seed, 'Default', 'Network'), { recursive: true }),
    mkdir(join(seed, 'Default', 'Local Storage'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(source, 'Local State'), JSON.stringify({
      profile: { last_used: 'Profile 1' }, os_crypt: { encrypted_key: 'source-key' },
    })),
    writeFile(join(seed, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: 'seed-key' } })),
  ]);
  return { root, source, seed, sourceCookies, targetCookies };
}

describe('ChatGPT cookie recovery', () => {
  it('imports only ChatGPT/OpenAI cookies and accepts login-only recovery', async () => {
    const setup = await fixture();
    createCookies(setup.sourceCookies, [
      { host: '.chatgpt.com', name: 'chat-session', encrypted: 'chat-new' },
      { host: 'auth.openai.com', name: 'auth-session', encrypted: 'auth-new' },
      { host: '.example.com', name: 'unrelated', encrypted: 'never-copy' },
    ]);
    createCookies(setup.targetCookies, [
      { host: '.chatgpt.com', name: 'chat-session', encrypted: 'chat-old' },
      { host: '.example.com', name: 'keep', encrypted: 'keep-existing' },
    ]);

    const result = await recoverChatGptLogin({
      seedPath: setup.seed, sourceUserDataRoot: setup.source,
      oracleHome: join(setup.root, 'oracle'),
      validateProfile: async copied => {
        expect(readCookies(join(copied, 'Default', 'Network', 'Cookies'))).toEqual([
          { host_key: '.chatgpt.com', name: 'chat-session', encrypted: 'chat-new' },
          { host_key: '.example.com', name: 'keep', encrypted: 'keep-existing' },
          { host_key: 'auth.openai.com', name: 'auth-session', encrypted: 'auth-new' },
        ]);
        return {
          ok: false, code: 'AUTH_DOM_INCOMPLETE', backend_status: 200,
          composer: false, model_selector: false, thinking_control: false, login_cta: false,
        };
      },
    });

    expect(result).toMatchObject({
      ok: false, status: 'BLOCKED', code: 'IMPORTED_COOKIES_REJECTED', cookies_copied: 2,
      source_profile: 'Profile 1',
    });
    expect(readCookies(setup.targetCookies)).toEqual([
      { host_key: '.chatgpt.com', name: 'chat-session', encrypted: 'chat-old' },
      { host_key: '.example.com', name: 'keep', encrypted: 'keep-existing' },
    ]);
    expect(JSON.parse(await readFile(join(setup.seed, 'Local State'), 'utf8')).os_crypt)
      .toEqual({ encrypted_key: 'seed-key' });
  });

  it('restores the seed cookies and key metadata when imported cookies do not log in', async () => {
    const setup = await fixture();
    createCookies(setup.sourceCookies, [
      { host: '.chatgpt.com', name: 'chat-session', encrypted: 'chat-new' },
    ]);
    createCookies(setup.targetCookies, [
      { host: '.chatgpt.com', name: 'chat-session', encrypted: 'chat-old' },
    ]);
    await writeFile(`${setup.targetCookies}-wal`, 'wal-before');
    await writeFile(`${setup.targetCookies}-shm`, 'shm-before');

    const result = await recoverChatGptLogin({
      seedPath: setup.seed, sourceUserDataRoot: setup.source,
      oracleHome: join(setup.root, 'oracle'),
      validateProfile: async () => ({
        ok: false, code: 'AUTH_LOGIN_REQUIRED', backend_status: 401,
        composer: false, model_selector: false, thinking_control: false, login_cta: true,
      }),
    });

    expect(result).toMatchObject({
      ok: false, status: 'BLOCKED', code: 'IMPORTED_COOKIES_REJECTED', cookies_copied: 1,
    });
    expect(await readFile(`${setup.targetCookies}-wal`, 'utf8')).toBe('wal-before');
    expect(await readFile(`${setup.targetCookies}-shm`, 'utf8')).toBe('shm-before');
    expect(readCookies(setup.targetCookies)).toEqual([
      { host_key: '.chatgpt.com', name: 'chat-session', encrypted: 'chat-old' },
    ]);
    expect(JSON.parse(await readFile(join(setup.seed, 'Local State'), 'utf8')).os_crypt)
      .toEqual({ encrypted_key: 'seed-key' });
  });

  it('does not mutate the seed when the main profile has no scoped cookies', async () => {
    const setup = await fixture();
    createCookies(setup.sourceCookies, [
      { host: '.example.com', name: 'unrelated', encrypted: 'never-copy' },
    ]);
    createCookies(setup.targetCookies, [
      { host: '.chatgpt.com', name: 'chat-session', encrypted: 'chat-old' },
    ]);
    const beforeState = await readFile(join(setup.seed, 'Local State'), 'utf8');

    const result = await recoverChatGptLogin({
      seedPath: setup.seed, sourceUserDataRoot: setup.source,
      oracleHome: join(setup.root, 'oracle'),
      validateProfile: async () => { throw new Error('validator must not run'); },
    });

    expect(result.code).toBe('CHATGPT_COOKIES_NOT_FOUND');
    expect(readCookies(setup.targetCookies)[0].encrypted).toBe('chat-old');
    expect(await readFile(join(setup.seed, 'Local State'), 'utf8')).toBe(beforeState);
  });

  it('refuses to mutate a seed with a live Chrome marker', async () => {
    const setup = await fixture();
    createCookies(setup.sourceCookies, [
      { host: '.chatgpt.com', name: 'chat-session', encrypted: 'chat-new' },
    ]);
    createCookies(setup.targetCookies, [
      { host: '.chatgpt.com', name: 'chat-session', encrypted: 'chat-old' },
    ]);
    await writeFile(join(setup.seed, 'SingletonLock'), 'active');

    await expect(recoverChatGptLogin({
      seedPath: setup.seed, sourceUserDataRoot: setup.source,
      oracleHome: join(setup.root, 'oracle'),
      validateProfile: async () => { throw new Error('validator must not run'); },
    })).rejects.toThrow('PROFILE_SEED_IN_USE');
    expect(readCookies(setup.targetCookies)[0].encrypted).toBe('chat-old');
  });
});
