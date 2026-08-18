import { z } from 'zod';
import { createHash } from 'node:crypto';

export const SessionAuthority = z.enum(['live', 'submitted_unknown', 'terminal_observed', 'pre_submit', 'settled']);
export type SessionAuthority = z.infer<typeof SessionAuthority>;

export const sessionAuthorityTransitions: Record<SessionAuthority, readonly SessionAuthority[]> = {
  pre_submit: ['pre_submit', 'submitted_unknown', 'live', 'terminal_observed', 'settled'],
  submitted_unknown: ['submitted_unknown', 'terminal_observed', 'settled'],
  live: ['live', 'terminal_observed', 'settled'],
  terminal_observed: ['terminal_observed', 'settled'],
  settled: ['settled'],
};

export function canAdvanceSessionAuthority(from: SessionAuthority, to: SessionAuthority): boolean {
  return sessionAuthorityTransitions[from].includes(to);
}

export const TaskOutcome = z.enum(['EXECUTED', 'NOT_EXECUTED', 'BLOCKED', 'pending']);
export type TaskOutcome = z.infer<typeof TaskOutcome>;

export interface ParsedTaskOutcome {
  outcome: Exclude<TaskOutcome, 'pending'>;
  markerLine: number;
}

/** Parse the terminal TASK_OUTCOME contract from provider output. */
export function parseTaskOutcome(output: string): ParsedTaskOutcome {
  const lines = output.split(/\r?\n/);
  const nonempty = lines.map((text, index) => ({ text: text.trim(), index }))
    .filter(({ text }) => text.length > 0);
  const markers = nonempty.filter(({ text }) => /^TASK_OUTCOME:\s*(EXECUTED|NOT_EXECUTED|BLOCKED)\s*$/i.test(text));
  if (markers.length !== 1) throw new Error('TASK_OUTCOME_MARKER_INVALID');
  const marker = markers[0];
  const trailing = nonempty.filter(({ index }) => index > marker.index);
  const refsOnly = trailing.every(({ text }) => (
    /^\[[^\]\r\n]+\]:[ \t]+(?:<https?:\/\/[^>\s]+>|https?:\/\/\S+?)(?:[ \t]+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^\)\r\n]*\)))?[ \t]*$/i.test(text)
  ));
  if (trailing.length > 0 && !refsOnly) throw new Error('TASK_OUTCOME_MARKER_NOT_FINAL');
  const value = marker.text.match(/^TASK_OUTCOME:\s*(EXECUTED|NOT_EXECUTED|BLOCKED)\s*$/i)![1].toUpperCase() as Exclude<TaskOutcome, 'pending'>;
  return { outcome: value, markerLine: marker.index + 1 };
}

export const WorkflowStage = z.enum([
  'plan', 'review', 'web-multi', 'pro', 'implementation', 'final-web-gate', 'complete', 'attention_required'
]);
export type WorkflowStage = z.infer<typeof WorkflowStage>;

export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const StageStatus = z.enum(['started', 'completed', 'failed', 'blocked']);
export const WorkflowProfile = z.enum(['default', 'ultra-economy']);
export type WorkflowProfile = z.infer<typeof WorkflowProfile>;

/**
 * Immutable mission manifest consumed by an Oracle run.  Keep this contract
 * deliberately strict: a manifest is the binding between a run and the
 * project/mission it is authorized to operate on, so silently accepting
 * misspelled or unsupported fields would weaken that binding.
 */
export const OracleManifestSchema = z.object({
  schema: z.literal('codex.chatgpt.oracle-run/v1'),
  project_root: z.string().min(1),
  mission_path: z.string().min(1),
  mode: z.literal('browser').optional(),
  transport: z.enum([
    'devspace', 'deep-research-attachment-only', 'pro-devspace',
    'pro-attachment-only', 'pro-devspace-readonly',
  ]).optional(),
  app_name: z.string().min(1).optional(),
  attachments: z.array(z.string().min(1)).min(1).optional(),
  run_root: z.string().min(1).optional(),
  oracle_command: z.array(z.string().min(1)).min(1).optional(),
  oracle_args: z.array(z.string().min(1)).optional(),
  submit_mutex_timeout_seconds: z.number().positive().max(300).optional(),
  episode_policy: z.object({
    soft_checkpoint_seconds: z.number().int().positive().optional(),
    handoff_seconds: z.number().int().positive().optional(),
    observed_platform_limit_seconds: z.number().int().positive().optional(),
    max_total_concurrency: z.number().int().positive().optional(),
    web_answer_budget_seconds: z.number().int().positive().optional(),
    status_audit_seconds: z.number().int().positive().optional(),
  }).strict().optional(),
  model: z.string().min(1).optional(),
  model_strategy: z.enum(['select', 'auto']).optional(),
  thinking_time: z.string().min(1).optional(),
  copy_profile: z.string().min(1).optional(),
  research: z.enum(['off', 'deep']).optional(),
  archive: z.enum(['auto', 'always', 'never']).optional(),
  task_outcome_contract: z.enum(['legacy', 'v1']).optional(),
  parallel_parent_id: z.string().regex(/^[a-f0-9]{32,64}$/).optional(),
  run_id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,95}$/).optional(),
  web_multi_child_provenance_path: z.string().min(1).optional(),
}).strict().superRefine((manifest, context) => {
  const transport = manifest.transport ?? 'devspace';
  const attachmentOnly = transport.endsWith('attachment-only');
  if (attachmentOnly && (!manifest.attachments || manifest.app_name)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'attachment transport requires attachments and forbids app_name' });
  }
  if (!attachmentOnly && (!manifest.app_name || manifest.attachments)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'DevSpace transport requires app_name and forbids attachments' });
  }
  if (transport === 'pro-devspace' && manifest.task_outcome_contract !== 'v1') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'pro-devspace requires task_outcome_contract=v1' });
  }
  if (attachmentOnly && manifest.task_outcome_contract === 'v1') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'attachment transport forbids task_outcome_contract=v1' });
  }
});
export type OracleManifest = z.infer<typeof OracleManifestSchema>;

export const WorkflowReceiptSchema = z.object({
  receipt_id: z.string().min(1),
  run_id: z.string().min(1),
  stage: WorkflowStage.exclude(['complete', 'attention_required']),
  status: StageStatus,
  input_sha256: Sha256,
  output_sha256: Sha256,
  previous_receipt_sha256: Sha256.nullable(),
  next_stage: WorkflowStage,
  prologue: z.object({
    project_root: z.string().min(1),
    mission_sha256: Sha256,
    profile: WorkflowProfile,
    semantic_revision: z.number().int().nonnegative(),
  }).strict(),
  external_actions: z.array(z.object({
    kind: z.enum(['oracle', 'devspace', 'process', 'local_gate']),
    status: z.enum(['started', 'completed', 'failed', 'audited']),
  }).strict()),
  recovery: z.object({
    session_authority: SessionAuthority,
    attempt: z.number().int().nonnegative(),
    exact_slug: z.string().min(1).optional(),
  }).strict(),
}).strict();
export type WorkflowReceipt = z.infer<typeof WorkflowReceiptSchema>;

export const WorkflowRunStateSchema = z.object({
  schema: z.literal('codex.chatgpt.oracle-workflow/v1'),
  run_id: z.string().min(1),
  project_root: z.string().min(1),
  mission_path: z.string().min(1),
  profile: WorkflowProfile,
  stage: WorkflowStage,
  session_authority: SessionAuthority,
  task_outcome: TaskOutcome,
  revision: z.number().int().nonnegative(),
  receipts: z.array(WorkflowReceiptSchema),
}).strict();
export type WorkflowRunState = z.infer<typeof WorkflowRunStateSchema>;

export function receiptSha256(receipt: WorkflowReceipt): string {
  const validated = WorkflowReceiptSchema.parse(receipt);
  return createHash('sha256').update(JSON.stringify(validated)).digest('hex');
}

export function validateReceiptChain(receipts: readonly WorkflowReceipt[]): void {
  const seen = new Set<string>();
  receipts.forEach((rawReceipt, index) => {
    const receipt = WorkflowReceiptSchema.parse(rawReceipt);
    if (seen.has(receipt.receipt_id)) {
      throw new Error(`RECEIPT_ID_DUPLICATE: ${receipt.receipt_id}`);
    }
    seen.add(receipt.receipt_id);
    if (
      ['live', 'terminal_observed'].includes(receipt.recovery.session_authority)
      && !receipt.recovery.exact_slug
    ) {
      throw new Error('RECEIPT_EXACT_SLUG_REQUIRED');
    }
    if (index === 0) {
      if (receipt.previous_receipt_sha256 != null) {
        throw new Error('RECEIPT_CHAIN_INVALID: first receipt must not reference a predecessor');
      }
      return;
    }
    const previous = WorkflowReceiptSchema.parse(receipts[index - 1]);
    if (receipt.run_id !== previous.run_id) {
      throw new Error('RECEIPT_RUN_MISMATCH');
    }
    if (receipt.previous_receipt_sha256 !== receiptSha256(previous)) {
      throw new Error('RECEIPT_CHAIN_INVALID');
    }
    if (receipt.input_sha256 !== previous.output_sha256) {
      throw new Error('RECEIPT_ARTIFACT_CHAIN_INVALID');
    }
    if (previous.next_stage !== receipt.stage) throw new Error('RECEIPT_STAGE_CHAIN_INVALID');
    if (
      previous.prologue.project_root !== receipt.prologue.project_root
      || previous.prologue.mission_sha256 !== receipt.prologue.mission_sha256
      || previous.prologue.profile !== receipt.prologue.profile
    ) {
      throw new Error('RECEIPT_BINDINGS_MUTATED');
    }
    if (receipt.prologue.semantic_revision < previous.prologue.semantic_revision) {
      throw new Error('RECEIPT_REVISION_REGRESSION');
    }
    if (!canAdvanceSessionAuthority(
      previous.recovery.session_authority,
      receipt.recovery.session_authority,
    )) {
      throw new Error('RECEIPT_AUTHORITY_REGRESSION');
    }
    if (
      previous.recovery.exact_slug
      && receipt.recovery.exact_slug !== previous.recovery.exact_slug
    ) {
      throw new Error('RECEIPT_EXACT_SLUG_MUTATED');
    }
  });
}

export function validateWorkflowStateConsistency(state: WorkflowRunState): void {
  validateReceiptChain(state.receipts);
  if (state.receipts.length === 0) {
    if (
      state.stage !== 'plan'
      || state.session_authority !== 'pre_submit'
      || state.task_outcome !== 'pending'
      || state.revision !== 0
    ) {
      throw new Error('WORKFLOW_INITIAL_STATE_INVALID');
    }
    return;
  }

  const latest = state.receipts.at(-1)!;
  if (latest.run_id !== state.run_id) throw new Error('WORKFLOW_RECEIPT_RUN_MISMATCH');
  if (latest.status !== 'completed' && state.stage !== 'attention_required') {
    throw new Error('WORKFLOW_INCOMPLETE_RECEIPT_ADVANCE');
  }
  if (latest.next_stage !== state.stage) throw new Error('WORKFLOW_STAGE_RECEIPT_MISMATCH');
  if (latest.prologue.project_root !== state.project_root) {
    throw new Error('WORKFLOW_ROOT_RECEIPT_MISMATCH');
  }
  if (latest.prologue.profile !== state.profile) throw new Error('WORKFLOW_PROFILE_RECEIPT_MISMATCH');
  if (latest.prologue.semantic_revision !== state.revision) {
    throw new Error('WORKFLOW_REVISION_RECEIPT_MISMATCH');
  }
  if (latest.recovery.session_authority !== state.session_authority) {
    throw new Error('WORKFLOW_AUTHORITY_RECEIPT_MISMATCH');
  }
  if (
    ['live', 'terminal_observed'].includes(state.session_authority)
    && !latest.recovery.exact_slug
  ) {
    throw new Error('WORKFLOW_EXACT_SLUG_REQUIRED');
  }
  if (state.stage === 'complete') {
    if (!['terminal_observed', 'settled'].includes(state.session_authority)) {
      throw new Error('WORKFLOW_TERMINAL_AUTHORITY_REQUIRED');
    }
    if (state.task_outcome === 'pending') throw new Error('WORKFLOW_TASK_OUTCOME_REQUIRED');
  }
}

export const OracleRunStateSchema = z.object({
  schema: z.literal('codex.chatgpt.oracle-run-state/v1'),
  run_id: z.string(),
  project_root: z.string(),
  mission_path: z.string(),
  mission_sha256: Sha256.optional(),
  mission: z.object({ path: z.string().min(1), sha256: Sha256.optional() }).strict().optional(),
  mode: z.literal('browser'),
  session_authority: SessionAuthority,
  transport_status: z.enum(['complete', 'failed', 'pending']),
  task_outcome: TaskOutcome,
  process: z.object({ pid: z.number().int().positive(), command: z.string(), args: z.array(z.string()), cwd: z.string().optional(), started_at: z.string().datetime().optional() }).strict().optional(),
  oracle: z.object({
    resolved_version: z.string(),
    session_locator: z.string(),
    slug: z.string(),
    command: z.array(z.string()).optional(),
    conversation_url: z.string().url().optional(),
  }).strict().optional(),
  artifacts: z.object({
    output: z.string(),
    transcript: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    browser_temp: z.string(),
  }).strict().optional(),
}).strict();
export type OracleRunState = z.infer<typeof OracleRunStateSchema>;

export const OracleSessionStateSchema = z.object({
  schema: z.literal('codex.chatgpt.oracle-run-state/v1'),
  run_id: z.string().min(1),
  project_root: z.string().min(1),
  mode: z.string().min(1),
  session_authority: z.enum([
    'pre_submit', 'submitted_unknown', 'live', 'terminal_observed',
    'terminal', 'settled', 'settled_executed',
  ]),
  transport_status: z.string().min(1),
  task_outcome: z.string().min(1),
  terminal_harvested: z.boolean().optional(),
  mission: z.object({
    path: z.string().min(1),
    sha256: Sha256.optional(),
  }).passthrough(),
  oracle: z.object({
    resolved_version: z.string(),
    session_locator: z.string(),
    slug: z.string(),
  }).passthrough().optional(),
}).passthrough();
export type OracleSessionState = z.infer<typeof OracleSessionStateSchema>;

export function normalizeOracleSessionAuthority(
  authority: OracleSessionState['session_authority'],
): SessionAuthority {
  if (authority === 'terminal') return 'terminal_observed';
  if (authority === 'settled_executed') return 'settled';
  return authority;
}

export const PersistentStateSchema = z.union([WorkflowRunStateSchema, OracleRunStateSchema]);
export type PersistentState = z.infer<typeof PersistentStateSchema>;
