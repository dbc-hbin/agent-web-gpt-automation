import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { workflowTransitions } from '../src/core/orchestrator/state.js';
import { CAUTION_AUDIT_THRESHOLD_MS } from '../src/core/process/supervisor.js';

interface RecoveryContract {
  transitions: Record<string, string[]>;
  audit: {
    seconds: number;
    kind: string;
    effects: Record<string, boolean>;
  };
  invariants: string[];
}

async function contract(): Promise<RecoveryContract> {
  const path = fileURLToPath(new URL('../contracts/orchestrator/phase5-recovery-v1.json', import.meta.url));
  const schema = JSON.parse(await readFile(path, 'utf8')) as {
    properties: {
      transitions: { const: RecoveryContract['transitions'] };
      audit: { properties: {
        seconds: { const: number };
        kind: { const: string };
        effects: { properties: Record<string, { const: boolean }> };
      } };
      invariants: { const: string[] };
    };
  };
  const audit = schema.properties.audit.properties;
  return {
    transitions: schema.properties.transitions.const,
    audit: {
      seconds: audit.seconds.const,
      kind: audit.kind.const,
      effects: Object.fromEntries(
        Object.entries(audit.effects.properties).map(([key, value]) => [key, value.const]),
      ),
    },
    invariants: schema.properties.invariants.const,
  };
}

describe('authoritative recovery contract parity', () => {
  it('matches the authoritative workflow transition relation', async () => {
    const expected = (await contract()).transitions;
    const actual: Record<string, string[]> = {};
    for (const transition of workflowTransitions) {
      (actual[transition.from] ??= []).push(transition.to);
    }
    expect(actual).toEqual(expected);
  });

  it('keeps 4,800 seconds as an audit with no terminal effects', async () => {
    const audit = (await contract()).audit;
    expect(CAUTION_AUDIT_THRESHOLD_MS).toBe(audit.seconds * 1_000);
    expect(audit.kind).toBe('caution/status-audit');
    expect(audit.effects).toEqual({
      is_timeout: false,
      releases_ownership: false,
      authorizes_new_submission: false,
      marks_failure: false,
    });
  });

  it('retains the monotonic authority and exact-slug invariants', async () => {
    const invariants = (await contract()).invariants;
    expect(invariants).toContain('session authority is monotonic');
    expect(invariants).toContain('exact-slug recovery cannot create a replacement submission');
    expect(invariants).toContain('submitted_unknown is never expired by elapsed time');
  });
});
