import { execa } from 'execa';
import { access, readFile } from 'node:fs/promises';
import * as path from 'node:path';

export interface BrowserAuthSnapshot {
  backend_status: number;
  composer: boolean;
  model_selector: boolean;
  thinking_control: boolean;
  login_cta: boolean;
}

export interface BrowserAuthPreflightResult extends BrowserAuthSnapshot {
  ok: boolean;
  code: 'AUTH_DOM_READY' | 'AUTH_LOGIN_REQUIRED' | 'AUTH_DOM_INCOMPLETE';
}

export function evaluateAuthSnapshot(snapshot: BrowserAuthSnapshot): BrowserAuthPreflightResult {
  if ([401, 403].includes(snapshot.backend_status) || snapshot.login_cta) {
    return { ...snapshot, ok: false, code: 'AUTH_LOGIN_REQUIRED' };
  }
  const ok = snapshot.backend_status === 200
    && snapshot.composer && snapshot.model_selector && snapshot.thinking_control;
  return { ...snapshot, ok, code: ok ? 'AUTH_DOM_READY' : 'AUTH_DOM_INCOMPLETE' };
}

interface CdpTarget { webSocketDebuggerUrl?: string }

async function cdpEvaluate(webSocketUrl: string): Promise<BrowserAuthSnapshot> {
  const Socket = (globalThis as unknown as { WebSocket?: new (url: string) => {
    addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
    send(value: string): void;
    close(): void;
  } }).WebSocket;
  if (!Socket) throw new Error('AUTH_PREFLIGHT_WEBSOCKET_UNAVAILABLE');
  const socket = new Socket(webSocketUrl);
  let nextId = 0;
  const pending = new Map<number, (value: unknown) => void>();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: unknown };
    if (message.id != null) pending.get(message.id)?.(message.error ? { error: message.error } : message.result);
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('AUTH_PREFLIGHT_CDP_CONNECT_FAILED')));
  });
  const call = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`AUTH_PREFLIGHT_CDP_TIMEOUT: ${method}`));
    }, 15_000);
    pending.set(id, value => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(value);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Page.navigate', { url: 'https://chatgpt.com/' });
    const expression = `(async () => {
      const status = await fetch('/backend-api/me', { credentials: 'include' }).then(r => r.status).catch(() => 0);
      const text = document.body?.innerText || '';
      const exactLogin = [...document.querySelectorAll('a,button')].some(el => /^(log in|sign in)$/i.test((el.textContent || '').trim()));
      const composer = !!document.querySelector('#prompt-textarea, textarea, [contenteditable="true"][data-testid*="prompt"]');
      const model = !!document.querySelector('[data-testid*="model-switcher"], button[aria-label*="model" i]');
      const thinking = !!document.querySelector('[data-testid*="thinking"], button[aria-label*="thinking" i]') || /thinking|extra high/i.test(text);
      return { backend_status: status, composer, model_selector: model, thinking_control: thinking, login_cta: exactLogin };
    })()`;
    let latest: BrowserAuthSnapshot | undefined;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }) as {
        result?: { value?: BrowserAuthSnapshot };
        exceptionDetails?: unknown;
      };
      if (!response.exceptionDetails && response.result?.value) {
        latest = response.result.value;
        const evaluated = evaluateAuthSnapshot(latest);
        if (evaluated.code !== 'AUTH_DOM_INCOMPLETE') return latest;
      }
    }
    if (!latest) throw new Error('AUTH_PREFLIGHT_DOM_EVALUATION_FAILED');
    return latest;
  } finally {
    socket.close();
  }
}

export async function probeBrowserAuth(devtoolsBaseUrl: string): Promise<BrowserAuthPreflightResult> {
  const response = await fetch(`${devtoolsBaseUrl.replace(/\/$/, '')}/json/new?https://chatgpt.com/`, {
    method: 'PUT', signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`AUTH_PREFLIGHT_TARGET_FAILED: ${response.status}`);
  const target = await response.json() as CdpTarget;
  if (!target.webSocketDebuggerUrl) throw new Error('AUTH_PREFLIGHT_TARGET_MISSING');
  return evaluateAuthSnapshot(await cdpEvaluate(target.webSocketDebuggerUrl));
}

export async function preflightCopiedProfile(profilePath: string, chromePath?: string): Promise<BrowserAuthPreflightResult> {
  const executable = chromePath ?? await findChrome();
  const proc = execa(executable, [
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${path.resolve(profilePath)}`, 'about:blank',
  ], { reject: false, windowsHide: true, detached: process.platform !== 'win32' });
  try {
    const portFile = path.join(path.resolve(profilePath), 'DevToolsActivePort');
    let port: string | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        port = (await readFile(portFile, 'utf8')).split(/\r?\n/, 1)[0];
        if (/^\d+$/.test(port)) break;
      } catch {
        // Chrome has not published the debugging port yet.
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!port || !/^\d+$/.test(port)) throw new Error('AUTH_PREFLIGHT_CHROME_START_TIMEOUT');
    return await probeBrowserAuth(`http://127.0.0.1:${port}`);
  } finally {
    proc.kill('SIGTERM');
    await Promise.race([
      proc.catch(() => undefined),
      new Promise<void>(resolve => setTimeout(resolve, 5_000)),
    ]);
    if (proc.exitCode == null) proc.kill('SIGKILL');
  }
}

async function findChrome(): Promise<string> {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : process.platform === 'win32'
      ? [
          path.join(process.env.PROGRAMFILES ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next platform location.
    }
  }
  throw new Error('AUTH_PREFLIGHT_CHROME_NOT_FOUND');
}
