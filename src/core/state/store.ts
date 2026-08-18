import writeFileAtomic from 'write-file-atomic';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as lockFile from 'proper-lockfile';
import {
  PersistentState,
  PersistentStateSchema,
  canAdvanceSessionAuthority,
  validateWorkflowStateConsistency,
} from '../../types/index.js';

const IMMUTABLE_FIELDS = ['run_id', 'project_root', 'mission_path'] as const;

export class StateStore {
  private readonly statePath: string;

  constructor(statePath: string) {
    this.statePath = resolve(statePath);
  }

  async write(data: PersistentState, options: { explicitSettle?: boolean } = {}): Promise<void> {
    const validated = PersistentStateSchema.parse(data);
    if (validated.schema === 'codex.chatgpt.oracle-workflow/v1') {
      validateWorkflowStateConsistency(validated);
    }

    await mkdir(dirname(this.statePath), { recursive: true });
    const release = await lockFile.lock(this.statePath, {
      realpath: false,
      retries: { retries: 20, minTimeout: 5, maxTimeout: 50 },
      stale: 30_000,
      update: 10_000,
    });
    try {
      const current = await this.readIfPresent();
      if (current) {
        this.assertUpdateAllowed(current, validated, options);
      }
      await writeFileAtomic(this.statePath, `${JSON.stringify(validated, null, 2)}\n`, {
        fsync: true,
      });
    } finally {
      await release();
    }
  }

  async read(): Promise<PersistentState> {
    const raw = await readFile(this.statePath, 'utf8');
    const parsed = PersistentStateSchema.parse(JSON.parse(raw));
    if (parsed.schema === 'codex.chatgpt.oracle-workflow/v1') {
      validateWorkflowStateConsistency(parsed);
    }
    return parsed;
  }

  private async readIfPresent(): Promise<PersistentState | undefined> {
    try {
      return await this.read();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private assertUpdateAllowed(
    current: PersistentState,
    next: PersistentState,
    options: { explicitSettle?: boolean },
  ): void {
    if (current.schema !== next.schema) {
      throw new Error('STATE_SCHEMA_CHANGE_FORBIDDEN');
    }
    for (const field of IMMUTABLE_FIELDS) {
      if (field in current && field in next && current[field] !== next[field]) {
        throw new Error(`STATE_IDENTITY_MISMATCH: ${field}`);
      }
    }
    if (!canAdvanceSessionAuthority(current.session_authority, next.session_authority)) {
      throw new Error(
        `SESSION_AUTHORITY_REGRESSION: ${current.session_authority} -> ${next.session_authority}`,
      );
    }
    if (
      current.session_authority !== 'settled'
      && next.session_authority === 'settled'
      && options.explicitSettle !== true
    ) {
      throw new Error('EXPLICIT_SETTLE_EVIDENCE_REQUIRED');
    }
    if (current.task_outcome !== 'pending' && current.task_outcome !== next.task_outcome) {
      throw new Error('TASK_OUTCOME_MUTATED');
    }
    if (
      current.schema === 'codex.chatgpt.oracle-run-state/v1'
      && next.schema === 'codex.chatgpt.oracle-run-state/v1'
      && current.oracle?.slug
      && next.oracle?.slug !== current.oracle.slug
    ) {
      throw new Error('EXACT_SLUG_MUTATED');
    }
    if (
      current.schema === 'codex.chatgpt.oracle-workflow/v1'
      && next.schema === 'codex.chatgpt.oracle-workflow/v1'
    ) {
      if (next.revision < current.revision) throw new Error('SEMANTIC_REVISION_REGRESSION');
      if (next.receipts.length < current.receipts.length) throw new Error('RECEIPT_HISTORY_TRUNCATED');
      current.receipts.forEach((receipt, index) => {
        if (JSON.stringify(receipt) !== JSON.stringify(next.receipts[index])) {
          throw new Error('RECEIPT_HISTORY_MUTATED');
        }
      });
    }
  }
}
