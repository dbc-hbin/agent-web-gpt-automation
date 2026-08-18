import { describe, expect, it } from 'vitest';
import { canAdvanceSessionAuthority } from '../src/types/index.js';

describe('session authority contract', () => {
  it('allows evidence-strengthening transitions', () => {
    expect(canAdvanceSessionAuthority('pre_submit', 'live')).toBe(true);
    expect(canAdvanceSessionAuthority('submitted_unknown', 'terminal_observed')).toBe(true);
    expect(canAdvanceSessionAuthority('terminal_observed', 'settled')).toBe(true);
  });

  it('rejects uncertain or terminal authority regressions', () => {
    expect(canAdvanceSessionAuthority('submitted_unknown', 'live')).toBe(false);
    expect(canAdvanceSessionAuthority('terminal_observed', 'live')).toBe(false);
    expect(canAdvanceSessionAuthority('settled', 'terminal_observed')).toBe(false);
  });
});
