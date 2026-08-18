import { describe, expect, it } from 'vitest';
import {
  PosixFileLockAdapter,
  WindowsFileLockAdapter,
  createLockAdapter,
} from '../src/core/state/lock-adapter.js';

describe('lock adapter', () => {
  it('selects the Windows adapter only for win32', () => {
    expect(createLockAdapter('win32')).toBeInstanceOf(WindowsFileLockAdapter);
    expect(createLockAdapter('linux')).toBeInstanceOf(PosixFileLockAdapter);
    expect(createLockAdapter('darwin')).toBeInstanceOf(PosixFileLockAdapter);
  });

  it('exposes one shared acquire contract for both platforms', () => {
    expect(typeof new PosixFileLockAdapter().acquire).toBe('function');
    expect(typeof new WindowsFileLockAdapter().acquire).toBe('function');
  });
});
