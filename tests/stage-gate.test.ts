import { describe, it, expect } from 'vitest';
import { StageGate } from '../src/core/orchestrator/gate.js';
import { WorkflowReceipt, receiptSha256 } from '../src/types/index.js';

function finalReceipt(next: 'complete' | 'review' = 'complete'): WorkflowReceipt {
  return {
    receipt_id: 'final-1', run_id: 'run-1', stage: 'final-web-gate', status: 'completed',
    input_sha256: 'a'.repeat(64), output_sha256: 'b'.repeat(64),
    previous_receipt_sha256: null, next_stage: next,
    prologue: {
      project_root: '/exact/root', mission_sha256: 'a'.repeat(64),
      profile: 'default', semantic_revision: 0,
    },
    external_actions: [{ kind: 'local_gate', status: 'completed' }],
    recovery: { session_authority: 'terminal_observed', attempt: 0, exact_slug: 'exact-slug' },
  };
}

const bindings = {
  runId: 'run-1', currentStage: 'final-web-gate' as const, projectRoot: '/exact/root',
  missionSha256: 'a'.repeat(64), profile: 'default' as const, semanticRevision: 0,
};

describe('StageGate', () => {
  it('requires terminal observation and a durable outcome before complete', () => {
    const gate = new StageGate();
    expect(() => gate.validate({
      receipt: { ...finalReceipt(), recovery: { session_authority: 'live', attempt: 0, exact_slug: 'exact-slug' } }, previousReceipts: [], bindings,
      sessionAuthority: 'live', taskOutcome: 'EXECUTED',
    })).toThrow('GATE_TERMINAL_OBSERVATION_REQUIRED');
    expect(() => gate.validate({
      receipt: finalReceipt(), previousReceipts: [], bindings,
      sessionAuthority: 'terminal_observed', taskOutcome: 'pending',
    })).toThrow('GATE_TASK_OUTCOME_REQUIRED');
    expect(gate.validate({
      receipt: finalReceipt(), previousReceipts: [], bindings,
      sessionAuthority: 'terminal_observed', taskOutcome: 'EXECUTED',
    }).next_stage).toBe('complete');
  });

  it('rejects an unknown correction edge', () => {
    expect(() => new StageGate().validate({
      receipt: finalReceipt('review'), previousReceipts: [], bindings,
      sessionAuthority: 'terminal_observed', taskOutcome: 'EXECUTED',
    })).toThrow('GATE_TRANSITION_INVALID');
  });

  it('rejects a receipt whose input is not the predecessor output', () => {
    const previous: WorkflowReceipt = {
      ...finalReceipt('complete'), receipt_id: 'implementation-1', stage: 'implementation',
      next_stage: 'final-web-gate', recovery: { session_authority: 'terminal_observed', attempt: 0, exact_slug: 'exact-slug' },
    };
    const current = {
      ...finalReceipt(), previous_receipt_sha256: receiptSha256(previous),
      input_sha256: 'c'.repeat(64),
    };
    expect(() => new StageGate().validate({
      receipt: current, previousReceipts: [previous], bindings,
      sessionAuthority: 'terminal_observed', taskOutcome: 'EXECUTED',
    })).toThrow('RECEIPT_ARTIFACT_CHAIN_INVALID');
  });
});
