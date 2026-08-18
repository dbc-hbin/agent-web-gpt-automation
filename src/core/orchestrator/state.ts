import { z } from 'zod';

export const WorkflowState = z.enum(['plan', 'review', 'web-multi', 'pro', 'implementation', 'final-web-gate', 'complete', 'attention_required']);
export type WorkflowState = z.infer<typeof WorkflowState>;

export const Transition = z.object({
  from: WorkflowState,
  to: WorkflowState,
});
export type Transition = z.infer<typeof Transition>;

export const workflowTransitions: Transition[] = [
  { from: 'plan', to: 'plan' },
  { from: 'plan', to: 'review' },
  { from: 'plan', to: 'web-multi' },
  { from: 'plan', to: 'pro' },
  { from: 'pro', to: 'review' },
  { from: 'web-multi', to: 'review' },
  { from: 'review', to: 'implementation' },
  { from: 'implementation', to: 'final-web-gate' },
  { from: 'final-web-gate', to: 'complete' },
  { from: 'final-web-gate', to: 'implementation' },
];
export const validTransitions = workflowTransitions.map(t => `${t.from}->${t.to}`);

export function isValidTransition(from: WorkflowState, to: WorkflowState): boolean {
  return workflowTransitions.some(t => t.from === from && t.to === to);
}
