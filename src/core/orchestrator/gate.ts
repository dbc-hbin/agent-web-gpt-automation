import {
  TaskOutcome,
  WorkflowProfile,
  WorkflowReceipt,
  WorkflowReceiptSchema,
  WorkflowStage,
  SessionAuthority,
  validateReceiptChain,
} from '../../types/index.js';
import { isValidTransition } from './state.js';

export interface StageGateBindings {
  runId: string;
  currentStage: WorkflowStage;
  projectRoot: string;
  missionSha256: string;
  profile: WorkflowProfile;
  semanticRevision: number;
}

export interface StageGateInput {
  receipt: WorkflowReceipt;
  previousReceipts: readonly WorkflowReceipt[];
  bindings: StageGateBindings;
  sessionAuthority: SessionAuthority;
  taskOutcome: TaskOutcome;
}

export class StageGate {
  validate(input: StageGateInput): WorkflowReceipt {
    const receipt = WorkflowReceiptSchema.parse(input.receipt);
    if (receipt.run_id !== input.bindings.runId) throw new Error('GATE_RUN_ID_MISMATCH');
    if (receipt.stage !== input.bindings.currentStage) throw new Error('GATE_STAGE_MISMATCH');
    if (receipt.status !== 'completed') throw new Error('GATE_STAGE_NOT_COMPLETED');
    if (receipt.prologue.project_root !== input.bindings.projectRoot) {
      throw new Error('GATE_PROJECT_ROOT_MISMATCH');
    }
    if (receipt.prologue.mission_sha256 !== input.bindings.missionSha256) {
      throw new Error('GATE_MISSION_HASH_MISMATCH');
    }
    if (receipt.prologue.profile !== input.bindings.profile) throw new Error('GATE_PROFILE_MISMATCH');
    if (receipt.prologue.semantic_revision !== input.bindings.semanticRevision) {
      throw new Error('GATE_SEMANTIC_REVISION_MISMATCH');
    }
    if (receipt.recovery.session_authority !== input.sessionAuthority) {
      throw new Error('GATE_AUTHORITY_MISMATCH');
    }
    if (!isValidTransition(receipt.stage, receipt.next_stage)) {
      throw new Error(`GATE_TRANSITION_INVALID: ${receipt.stage} -> ${receipt.next_stage}`);
    }
    validateReceiptChain([...input.previousReceipts, receipt]);

    if (receipt.next_stage === 'complete') {
      if (!['terminal_observed', 'settled'].includes(receipt.recovery.session_authority)) {
        throw new Error('GATE_TERMINAL_OBSERVATION_REQUIRED');
      }
      if (input.taskOutcome === 'pending') throw new Error('GATE_TASK_OUTCOME_REQUIRED');
      if (!receipt.external_actions.some(action => (
        action.kind === 'local_gate' && action.status === 'completed'
      ))) {
        throw new Error('GATE_LOCAL_VERIFICATION_REQUIRED');
      }
    }
    return receipt;
  }
}
