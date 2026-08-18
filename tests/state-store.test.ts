import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../src/core/state/store.js';
import { OracleRunState, WorkflowReceipt, WorkflowRunState, receiptSha256 } from '../src/types/index.js';

function baseState(): WorkflowRunState {
  return {
    schema: 'codex.chatgpt.oracle-workflow/v1', run_id: 'run-1',
    project_root: '/exact/root', mission_path: '/exact/root/mission.md',
    profile: 'default', stage: 'plan', session_authority: 'pre_submit',
    task_outcome: 'pending', revision: 0, receipts: [],
  };
}

function receipt(overrides: Partial<WorkflowReceipt> = {}): WorkflowReceipt {
  return {
    receipt_id: 'receipt-1', run_id: 'run-1', stage: 'plan', status: 'completed',
    input_sha256: 'a'.repeat(64), output_sha256: 'b'.repeat(64),
    previous_receipt_sha256: null, next_stage: 'review', ...overrides,
    prologue: {
      project_root: '/exact/root', mission_sha256: 'a'.repeat(64),
      profile: 'default', semantic_revision: 0,
    },
    external_actions: [],
    recovery: { session_authority: 'pre_submit', attempt: 0 },
    ...overrides,
  };
}

describe('StateStore', () => {
  it('leaves one complete JSON document under concurrent atomic writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'state-store-'));
    const statePath = join(root, 'nested', 'state.json');
    const stores = Array.from({ length: 8 }, () => new StateStore(statePath));
    await Promise.all(stores.map(store => store.write(baseState())));
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual(baseState());
  });

  it('rejects session-authority regression and immutable identity changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'state-store-'));
    const store = new StateStore(join(root, 'state.json'));
    const terminal: OracleRunState = {
      schema: 'codex.chatgpt.oracle-run-state/v1', run_id: 'run-1',
      project_root: '/exact/root', mission_path: '/exact/root/mission.md', mode: 'browser',
      session_authority: 'terminal_observed', transport_status: 'complete', task_outcome: 'EXECUTED',
      oracle: { resolved_version: '1.0.0', session_locator: 'conversation', slug: 'exact-slug' },
    };
    await store.write(terminal);
    await expect(store.write({ ...terminal, session_authority: 'live' }))
      .rejects.toThrow('SESSION_AUTHORITY_REGRESSION');
    await expect(store.write({ ...terminal, run_id: 'replacement', session_authority: 'settled' }, { explicitSettle: true }))
      .rejects.toThrow('STATE_IDENTITY_MISMATCH');
  });

  it('keeps receipts append-only and validates their hash chain', async () => {
    const root = await mkdtemp(join(tmpdir(), 'state-store-'));
    const store = new StateStore(join(root, 'state.json'));
    const first = receipt();
    await store.write({ ...baseState(), stage: 'review', receipts: [first] });
    const second = receipt({
      receipt_id: 'receipt-2', stage: 'review', next_stage: 'implementation',
      input_sha256: first.output_sha256,
      previous_receipt_sha256: receiptSha256(first),
    });
    await expect(store.write({
      ...baseState(), stage: 'implementation', receipts: [first, second],
    })).resolves.toBeUndefined();
    await expect(store.write({
      ...baseState(), stage: 'implementation',
      receipts: [{ ...first, output_sha256: 'c'.repeat(64) }, second],
    })).rejects.toThrow();
  });

  it('rejects top-level workflow state that contradicts its latest receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'state-store-'));
    const store = new StateStore(join(root, 'state.json'));
    const first = receipt();
    await expect(store.write({
      ...baseState(), stage: 'complete', session_authority: 'terminal_observed',
      task_outcome: 'EXECUTED', receipts: [first],
    })).rejects.toThrow('WORKFLOW_STAGE_RECEIPT_MISMATCH');
  });

  it('keeps an observed exact slug and terminal task outcome immutable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'state-store-'));
    const store = new StateStore(join(root, 'state.json'));
    const state: OracleRunState = {
      schema: 'codex.chatgpt.oracle-run-state/v1', run_id: 'run-1',
      project_root: '/exact/root', mission_path: '/exact/root/mission.md', mode: 'browser',
      session_authority: 'terminal_observed', transport_status: 'complete', task_outcome: 'EXECUTED',
      oracle: { resolved_version: '1.0.0', session_locator: 'conversation', slug: 'exact-slug' },
    };
    await store.write(state);
    await expect(store.write({
      ...state, session_authority: 'settled',
      oracle: { ...state.oracle!, slug: 'replacement-slug' },
    }, { explicitSettle: true })).rejects.toThrow('EXACT_SLUG_MUTATED');
    await expect(store.write({
      ...state, session_authority: 'settled', task_outcome: 'BLOCKED',
    }, { explicitSettle: true })).rejects.toThrow('TASK_OUTCOME_MUTATED');
    await expect(store.write({ ...state, session_authority: 'settled' }))
      .rejects.toThrow('EXPLICIT_SETTLE_EVIDENCE_REQUIRED');
  });
});
