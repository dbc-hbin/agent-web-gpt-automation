import { WorkflowState, isValidTransition, workflowTransitions } from './state.js';
import { z } from 'zod';
import { Sha256 } from '../../types/index.js';

export interface WorkflowContext {
  workflow_id: string;
  stage: z.infer<typeof WorkflowState>;
  attempt_id: string;
  input_mission_sha256: string;
}

export const WorkflowContextSchema = z.object({
  workflow_id: z.string(),
  stage: WorkflowState,
  attempt_id: z.string(),
  input_mission_sha256: Sha256,
}).strict();

export const EngineReceiptSchema = z.object({
  workflow_id: z.string(),
  stage: WorkflowState,
  next_stage: WorkflowState,
  attempt_id: z.string(),
  input_mission_sha256: Sha256,
}).strict();

export class WorkflowEngine {
  private context: z.infer<typeof WorkflowContextSchema>;

  static readonly TRANSITIONS = workflowTransitions;

  constructor(context: WorkflowContext) {
    this.context = WorkflowContextSchema.parse(context);
  }

  getCurrentState(): z.infer<typeof WorkflowState> {
    return this.context.stage;
  }

  canTransition(to: z.infer<typeof WorkflowState>): boolean {
    return isValidTransition(this.getCurrentState(), to);
  }

  async transition(to: z.infer<typeof WorkflowState>): Promise<z.infer<typeof WorkflowContextSchema>> {
    if (!this.canTransition(to)) {
      throw new Error(`INVALID_WORKFLOW_TRANSITION: cannot transition ${this.context.stage} -> ${to}`);
    }
    const newContext = { ...this.context, stage: to };
    if (to === 'implementation' && this.context.stage === 'review') {
      newContext.stage = 'implementation';
    }
    const validated = WorkflowContextSchema.parse(newContext);
    this.context = validated;
    return validated;
  }

  async applyReceipt(receiptInput: z.infer<typeof EngineReceiptSchema>): Promise<z.infer<typeof WorkflowContextSchema>> {
    const receipt = EngineReceiptSchema.parse(receiptInput);
    const { stage, next_stage, input_mission_sha256, workflow_id, attempt_id } = receipt;
    const expectedIdentity = `${this.context.workflow_id}:${this.context.stage}:${this.context.attempt_id}:${this.context.input_mission_sha256}`;
    const actualIdentity = `${workflow_id}:${stage}:${attempt_id}:${input_mission_sha256}`;
    if (actualIdentity !== expectedIdentity) {
      throw new Error('RECEIPT_IDENTITY_MISMATCH');
    }
    if (!this.canTransition(next_stage)) {
      throw new Error('INVALID_NEXT_STAGE');
    }
    await this.transition(next_stage);
    return WorkflowContextSchema.parse(this.context);
  }
}
