import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '../src/core/orchestrator/engine.js';
import { WorkflowState, isValidTransition } from '../src/core/orchestrator/state.js';

const ALL_STATES = [
  'plan', 'review', 'web-multi', 'pro', 'implementation',
  'final-web-gate', 'complete', 'attention_required',
] as WorkflowState[];

const LEGAL = new Set([
  'plan->plan', 'plan->review', 'plan->web-multi', 'plan->pro',
  'pro->review', 'web-multi->review', 'review->implementation',
  'implementation->final-web-gate', 'final-web-gate->complete',
  'final-web-gate->implementation',
]);

describe('WorkflowState transitions', () => {
  it('accepts every normative edge and rejects every other edge', () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        expect(isValidTransition(from, to), `${from}->${to}`).toBe(LEGAL.has(`${from}->${to}`));
      }
    }
  });

  it('applies a receipt only when exact identity and current stage match', async () => {
    const engine = new WorkflowEngine({
      workflow_id: 'run-1', stage: 'review', attempt_id: 'attempt-1', input_mission_sha256: 'a'.repeat(64),
    });
    await expect(engine.applyReceipt({
      workflow_id: 'run-1', stage: 'review', next_stage: 'implementation',
      attempt_id: 'attempt-1', input_mission_sha256: 'a'.repeat(64),
    })).resolves.toMatchObject({ stage: 'implementation' });

    await expect(engine.applyReceipt({
      workflow_id: 'run-1', stage: 'review', next_stage: 'implementation',
      attempt_id: 'attempt-1', input_mission_sha256: 'a'.repeat(64),
    })).rejects.toThrow('RECEIPT_IDENTITY_MISMATCH');
  });
});
