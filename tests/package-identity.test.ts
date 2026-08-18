import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCLI } from '../src/cli/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('npm package identity', () => {
  it('uses release version 1.0.0 consistently', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string };
    expect(manifest.version).toBe('1.0.0');
  });

  it('uses the short awgpt package and executable name', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      name: string;
      bin: Record<string, string>;
    };

    expect(manifest.name).toBe('awgpt');
    expect(manifest.bin).toEqual({ awgpt: 'dist/index.js' });
    expect(createCLI().name()).toBe('awgpt');
  });
});
