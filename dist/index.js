#!/usr/bin/env node
import {
  qualifyExactProjectRoot
} from "./chunk-FOSMXQO6.js";

// src/cli/index.ts
import { Command } from "commander";

// src/cli/doctor.ts
import { z as z3 } from "zod";
import { access, chmod, mkdir as mkdir3, mkdtemp, readdir, readFile as readFile4 } from "node:fs/promises";
import { constants } from "node:fs";
import * as path4 from "node:path";
import * as os2 from "node:os";
import { spawn } from "node:child_process";

// src/types/index.ts
import { z } from "zod";
import { createHash } from "node:crypto";
var SessionAuthority = z.enum(["live", "submitted_unknown", "terminal_observed", "pre_submit", "settled"]);
var sessionAuthorityTransitions = {
  pre_submit: ["pre_submit", "submitted_unknown", "live", "terminal_observed", "settled"],
  submitted_unknown: ["submitted_unknown", "terminal_observed", "settled"],
  live: ["live", "terminal_observed", "settled"],
  terminal_observed: ["terminal_observed", "settled"],
  settled: ["settled"]
};
function canAdvanceSessionAuthority(from, to) {
  return sessionAuthorityTransitions[from].includes(to);
}
var TaskOutcome = z.enum(["EXECUTED", "NOT_EXECUTED", "BLOCKED", "pending"]);
function parseTaskOutcome(output) {
  const lines = output.split(/\r?\n/);
  const nonempty = lines.map((text, index) => ({ text: text.trim(), index })).filter(({ text }) => text.length > 0);
  const markers = nonempty.filter(({ text }) => /^TASK_OUTCOME:\s*(EXECUTED|NOT_EXECUTED|BLOCKED)\s*$/i.test(text));
  if (markers.length !== 1) throw new Error("TASK_OUTCOME_MARKER_INVALID");
  const marker = markers[0];
  const trailing = nonempty.filter(({ index }) => index > marker.index);
  const refsOnly = trailing.every(({ text }) => /^\[[^\]\r\n]+\]:[ \t]+(?:<https?:\/\/[^>\s]+>|https?:\/\/\S+?)(?:[ \t]+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^\)\r\n]*\)))?[ \t]*$/i.test(text));
  if (trailing.length > 0 && !refsOnly) throw new Error("TASK_OUTCOME_MARKER_NOT_FINAL");
  const value = marker.text.match(/^TASK_OUTCOME:\s*(EXECUTED|NOT_EXECUTED|BLOCKED)\s*$/i)[1].toUpperCase();
  return { outcome: value, markerLine: marker.index + 1 };
}
var WorkflowStage = z.enum([
  "plan",
  "review",
  "web-multi",
  "pro",
  "implementation",
  "final-web-gate",
  "complete",
  "attention_required"
]);
var Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
var StageStatus = z.enum(["started", "completed", "failed", "blocked"]);
var WorkflowProfile = z.enum(["default", "ultra-economy"]);
var OracleManifestSchema = z.object({
  schema: z.literal("codex.chatgpt.oracle-run/v1"),
  project_root: z.string().min(1),
  mission_path: z.string().min(1),
  mode: z.literal("browser").optional(),
  transport: z.enum([
    "devspace",
    "deep-research-attachment-only",
    "pro-devspace",
    "pro-attachment-only",
    "pro-devspace-readonly"
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
    status_audit_seconds: z.number().int().positive().optional()
  }).strict().optional(),
  model: z.string().min(1).optional(),
  model_strategy: z.enum(["select", "auto"]).optional(),
  thinking_time: z.string().min(1).optional(),
  copy_profile: z.string().min(1).optional(),
  research: z.enum(["off", "deep"]).optional(),
  archive: z.enum(["auto", "always", "never"]).optional(),
  task_outcome_contract: z.enum(["legacy", "v1"]).optional(),
  parallel_parent_id: z.string().regex(/^[a-f0-9]{32,64}$/).optional(),
  run_id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,95}$/).optional(),
  web_multi_child_provenance_path: z.string().min(1).optional()
}).strict().superRefine((manifest, context) => {
  const transport = manifest.transport ?? "devspace";
  const attachmentOnly = transport.endsWith("attachment-only");
  if (attachmentOnly && (!manifest.attachments || manifest.app_name)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "attachment transport requires attachments and forbids app_name" });
  }
  if (!attachmentOnly && (!manifest.app_name || manifest.attachments)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "DevSpace transport requires app_name and forbids attachments" });
  }
  if (transport === "pro-devspace" && manifest.task_outcome_contract !== "v1") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "pro-devspace requires task_outcome_contract=v1" });
  }
  if (attachmentOnly && manifest.task_outcome_contract === "v1") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "attachment transport forbids task_outcome_contract=v1" });
  }
});
var WorkflowReceiptSchema = z.object({
  receipt_id: z.string().min(1),
  run_id: z.string().min(1),
  stage: WorkflowStage.exclude(["complete", "attention_required"]),
  status: StageStatus,
  input_sha256: Sha256,
  output_sha256: Sha256,
  previous_receipt_sha256: Sha256.nullable(),
  next_stage: WorkflowStage,
  prologue: z.object({
    project_root: z.string().min(1),
    mission_sha256: Sha256,
    profile: WorkflowProfile,
    semantic_revision: z.number().int().nonnegative()
  }).strict(),
  external_actions: z.array(z.object({
    kind: z.enum(["oracle", "devspace", "process", "local_gate"]),
    status: z.enum(["started", "completed", "failed", "audited"])
  }).strict()),
  recovery: z.object({
    session_authority: SessionAuthority,
    attempt: z.number().int().nonnegative(),
    exact_slug: z.string().min(1).optional()
  }).strict()
}).strict();
var WorkflowRunStateSchema = z.object({
  schema: z.literal("codex.chatgpt.oracle-workflow/v1"),
  run_id: z.string().min(1),
  project_root: z.string().min(1),
  mission_path: z.string().min(1),
  profile: WorkflowProfile,
  stage: WorkflowStage,
  session_authority: SessionAuthority,
  task_outcome: TaskOutcome,
  revision: z.number().int().nonnegative(),
  receipts: z.array(WorkflowReceiptSchema)
}).strict();
function receiptSha256(receipt) {
  const validated = WorkflowReceiptSchema.parse(receipt);
  return createHash("sha256").update(JSON.stringify(validated)).digest("hex");
}
function validateReceiptChain(receipts) {
  const seen = /* @__PURE__ */ new Set();
  receipts.forEach((rawReceipt, index) => {
    const receipt = WorkflowReceiptSchema.parse(rawReceipt);
    if (seen.has(receipt.receipt_id)) {
      throw new Error(`RECEIPT_ID_DUPLICATE: ${receipt.receipt_id}`);
    }
    seen.add(receipt.receipt_id);
    if (["live", "terminal_observed"].includes(receipt.recovery.session_authority) && !receipt.recovery.exact_slug) {
      throw new Error("RECEIPT_EXACT_SLUG_REQUIRED");
    }
    if (index === 0) {
      if (receipt.previous_receipt_sha256 != null) {
        throw new Error("RECEIPT_CHAIN_INVALID: first receipt must not reference a predecessor");
      }
      return;
    }
    const previous = WorkflowReceiptSchema.parse(receipts[index - 1]);
    if (receipt.run_id !== previous.run_id) {
      throw new Error("RECEIPT_RUN_MISMATCH");
    }
    if (receipt.previous_receipt_sha256 !== receiptSha256(previous)) {
      throw new Error("RECEIPT_CHAIN_INVALID");
    }
    if (receipt.input_sha256 !== previous.output_sha256) {
      throw new Error("RECEIPT_ARTIFACT_CHAIN_INVALID");
    }
    if (previous.next_stage !== receipt.stage) throw new Error("RECEIPT_STAGE_CHAIN_INVALID");
    if (previous.prologue.project_root !== receipt.prologue.project_root || previous.prologue.mission_sha256 !== receipt.prologue.mission_sha256 || previous.prologue.profile !== receipt.prologue.profile) {
      throw new Error("RECEIPT_BINDINGS_MUTATED");
    }
    if (receipt.prologue.semantic_revision < previous.prologue.semantic_revision) {
      throw new Error("RECEIPT_REVISION_REGRESSION");
    }
    if (!canAdvanceSessionAuthority(
      previous.recovery.session_authority,
      receipt.recovery.session_authority
    )) {
      throw new Error("RECEIPT_AUTHORITY_REGRESSION");
    }
    if (previous.recovery.exact_slug && receipt.recovery.exact_slug !== previous.recovery.exact_slug) {
      throw new Error("RECEIPT_EXACT_SLUG_MUTATED");
    }
  });
}
function validateWorkflowStateConsistency(state) {
  validateReceiptChain(state.receipts);
  if (state.receipts.length === 0) {
    if (state.stage !== "plan" || state.session_authority !== "pre_submit" || state.task_outcome !== "pending" || state.revision !== 0) {
      throw new Error("WORKFLOW_INITIAL_STATE_INVALID");
    }
    return;
  }
  const latest = state.receipts.at(-1);
  if (latest.run_id !== state.run_id) throw new Error("WORKFLOW_RECEIPT_RUN_MISMATCH");
  if (latest.status !== "completed" && state.stage !== "attention_required") {
    throw new Error("WORKFLOW_INCOMPLETE_RECEIPT_ADVANCE");
  }
  if (latest.next_stage !== state.stage) throw new Error("WORKFLOW_STAGE_RECEIPT_MISMATCH");
  if (latest.prologue.project_root !== state.project_root) {
    throw new Error("WORKFLOW_ROOT_RECEIPT_MISMATCH");
  }
  if (latest.prologue.profile !== state.profile) throw new Error("WORKFLOW_PROFILE_RECEIPT_MISMATCH");
  if (latest.prologue.semantic_revision !== state.revision) {
    throw new Error("WORKFLOW_REVISION_RECEIPT_MISMATCH");
  }
  if (latest.recovery.session_authority !== state.session_authority) {
    throw new Error("WORKFLOW_AUTHORITY_RECEIPT_MISMATCH");
  }
  if (["live", "terminal_observed"].includes(state.session_authority) && !latest.recovery.exact_slug) {
    throw new Error("WORKFLOW_EXACT_SLUG_REQUIRED");
  }
  if (state.stage === "complete") {
    if (!["terminal_observed", "settled"].includes(state.session_authority)) {
      throw new Error("WORKFLOW_TERMINAL_AUTHORITY_REQUIRED");
    }
    if (state.task_outcome === "pending") throw new Error("WORKFLOW_TASK_OUTCOME_REQUIRED");
  }
}
var OracleRunStateSchema = z.object({
  schema: z.literal("codex.chatgpt.oracle-run-state/v1"),
  run_id: z.string(),
  project_root: z.string(),
  mission_path: z.string(),
  mission_sha256: Sha256.optional(),
  mission: z.object({ path: z.string().min(1), sha256: Sha256.optional() }).strict().optional(),
  mode: z.literal("browser"),
  session_authority: SessionAuthority,
  transport_status: z.enum(["complete", "failed", "pending"]),
  task_outcome: TaskOutcome,
  process: z.object({ pid: z.number().int().positive(), command: z.string(), args: z.array(z.string()) }).strict().optional(),
  oracle: z.object({
    resolved_version: z.string(),
    session_locator: z.string(),
    slug: z.string(),
    command: z.array(z.string()).optional(),
    conversation_url: z.string().url().optional()
  }).strict().optional(),
  artifacts: z.object({
    output: z.string(),
    transcript: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    browser_temp: z.string()
  }).strict().optional()
}).strict();
var OracleSessionStateSchema = z.object({
  schema: z.literal("codex.chatgpt.oracle-run-state/v1"),
  run_id: z.string().min(1),
  project_root: z.string().min(1),
  mode: z.string().min(1),
  session_authority: z.enum([
    "pre_submit",
    "submitted_unknown",
    "live",
    "terminal_observed",
    "terminal",
    "settled",
    "settled_executed"
  ]),
  transport_status: z.string().min(1),
  task_outcome: z.string().min(1),
  terminal_harvested: z.boolean().optional(),
  mission: z.object({
    path: z.string().min(1),
    sha256: Sha256.optional()
  }).passthrough(),
  oracle: z.object({
    resolved_version: z.string(),
    session_locator: z.string(),
    slug: z.string()
  }).passthrough().optional()
}).passthrough();
function normalizeOracleSessionAuthority(authority) {
  if (authority === "terminal") return "terminal_observed";
  if (authority === "settled_executed") return "settled";
  return authority;
}
var PersistentStateSchema = z.union([WorkflowRunStateSchema, OracleRunStateSchema]);

// src/core/state/locks.ts
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { readFile, rename, rm } from "node:fs/promises";

// src/core/state/lock-adapter.ts
import * as lockFile from "proper-lockfile";
var ProperFileLockAdapter = class {
  async acquire(lockPath, options) {
    return lockFile.lock(lockPath, options);
  }
};
var PosixFileLockAdapter = class extends ProperFileLockAdapter {
};
var WindowsFileLockAdapter = class extends ProperFileLockAdapter {
};
function createLockAdapter(platform = process.platform) {
  return platform === "win32" ? new WindowsFileLockAdapter() : new PosixFileLockAdapter();
}

// src/core/state/locks.ts
import writeFileAtomic from "write-file-atomic";
var MAX_TIMER_MS = 2147483647;
var ProjectLockHeldError = class extends Error {
  constructor(projectRoot) {
    super(`PROJECT_SESSION_STILL_LIVE: failed to acquire project lock for ${projectRoot}`);
    this.name = "ProjectLockHeldError";
  }
};
var LockManager = class {
  constructor(config) {
    this.config = config;
    const canonicalRoot = path.resolve(config.projectRoot);
    const hash = crypto.createHash("sha256").update(canonicalRoot).digest("hex");
    this.name = canonicalRoot.replace(/\W/g, "_");
    this.lockPath = path.join(os.tmpdir(), `agent-web-gpt-lock-${hash}.lock`);
    this.lockAdapter = createLockAdapter();
  }
  config;
  lockPath;
  name;
  lockAdapter;
  ownedRelease;
  getName() {
    return this.name;
  }
  getLockPath() {
    return this.lockPath;
  }
  async acquire() {
    if (this.ownedRelease) {
      throw new ProjectLockHeldError(this.config.projectRoot);
    }
    let release;
    try {
      release = await this.lockAdapter.acquire(this.lockPath, {
        realpath: false,
        retries: this.config.retries ?? 3,
        stale: Number.POSITIVE_INFINITY,
        update: MAX_TIMER_MS
      });
    } catch (error) {
      if (error.code === "ELOCKED") {
        throw new ProjectLockHeldError(this.config.projectRoot);
      }
      throw error;
    }
    const ownerToken = crypto.randomUUID();
    const ownerPath = `${this.lockPath}.owner.json`;
    try {
      await writeFileAtomic(ownerPath, JSON.stringify({
        schema: "codex.chatgpt.project-lock-owner/v1",
        pid: process.pid,
        token: ownerToken,
        project_root: path.resolve(this.config.projectRoot),
        acquired_at: (/* @__PURE__ */ new Date()).toISOString()
      }));
    } catch (error) {
      await release();
      throw error;
    }
    let releasePromise;
    const ownedRelease = async () => {
      releasePromise ??= (async () => {
        const owner = JSON.parse(await readFile(ownerPath, "utf8"));
        if (owner.token !== ownerToken) throw new Error("PROJECT_LOCK_OWNER_MISMATCH");
        await release();
        try {
          const currentOwner = JSON.parse(await readFile(ownerPath, "utf8"));
          if (currentOwner.token === ownerToken) await rm(ownerPath, { force: true });
        } catch {
        }
        if (this.ownedRelease === ownedRelease) this.ownedRelease = void 0;
      })();
      await releasePromise;
    };
    this.ownedRelease = ownedRelease;
    return ownedRelease;
  }
  async tryAcquire() {
    try {
      const release = await this.acquire();
      return { release, held: true };
    } catch (error) {
      if (!(error instanceof ProjectLockHeldError)) throw error;
      return { release: async () => {
      }, held: false };
    }
  }
  async release() {
    const release = this.ownedRelease;
    if (!release) return;
    await release();
  }
  async reclaimAbandoned(sessionAuthority) {
    if (sessionAuthority !== "settled") {
      throw new Error(`PROJECT_LOCK_RECLAIM_FORBIDDEN: ${sessionAuthority}`);
    }
    if (this.ownedRelease) throw new Error("PROJECT_LOCK_OWNER_STILL_ALIVE");
    const ownerPath = `${this.lockPath}.owner.json`;
    let ownerBytes;
    let owner;
    try {
      ownerBytes = await readFile(ownerPath, "utf8");
      owner = JSON.parse(ownerBytes);
    } catch {
      throw new Error("PROJECT_LOCK_OWNER_EVIDENCE_INVALID");
    }
    if (owner.project_root !== path.resolve(this.config.projectRoot)) {
      throw new Error("PROJECT_LOCK_ROOT_MISMATCH");
    }
    if (!Number.isInteger(owner.pid) || (owner.pid ?? 0) <= 0 || !owner.token) {
      throw new Error("PROJECT_LOCK_OWNER_EVIDENCE_INVALID");
    }
    try {
      process.kill(owner.pid, 0);
      throw new Error("PROJECT_LOCK_OWNER_STILL_ALIVE");
    } catch (error) {
      if (error instanceof Error && error.message === "PROJECT_LOCK_OWNER_STILL_ALIVE") throw error;
      const code = error.code;
      if (code === "EPERM") throw new Error("PROJECT_LOCK_OWNER_STILL_ALIVE");
      if (code !== "ESRCH") throw error;
    }
    if (await readFile(ownerPath, "utf8") !== ownerBytes) throw new Error("PROJECT_LOCK_OWNER_CHANGED");
    const lockDirectory = `${this.lockPath}.lock`;
    const quarantine = `${this.lockPath}.reclaim-${crypto.randomUUID()}`;
    let quarantined = false;
    try {
      await rename(lockDirectory, quarantine);
      quarantined = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!quarantined) {
      try {
        const currentOwner = JSON.parse(await readFile(ownerPath, "utf8"));
        if (currentOwner.token === owner.token) await rm(ownerPath, { force: true });
      } catch {
      }
      return;
    }
    try {
      await rm(quarantine, { recursive: true, force: false });
      try {
        const currentOwner = JSON.parse(await readFile(ownerPath, "utf8"));
        if (currentOwner.token === owner.token) await rm(ownerPath, { force: true });
      } catch {
      }
    } catch (error) {
      await rename(quarantine, lockDirectory).catch(() => void 0);
      throw error;
    }
  }
};

// src/core/process/registry.ts
import { mkdir, readFile as readFile2 } from "node:fs/promises";
import * as path2 from "node:path";
import writeFileAtomic2 from "write-file-atomic";
import { z as z2 } from "zod";
import { execa } from "execa";
import * as lockFile2 from "proper-lockfile";
var PersistedProcessSchema = z2.object({
  id: z2.string().min(1),
  pid: z2.number().int().positive(),
  command: z2.string().min(1),
  args: z2.array(z2.string()),
  cwd: z2.string().min(1),
  project_root: z2.string().min(1).optional(),
  started_at: z2.string().datetime(),
  state: z2.enum(["running", "exited", "signaled", "cleaned"]),
  run_id: z2.string().min(1).optional(),
  exact_slug: z2.string().min(1).optional()
}).strict();
var RegistrySchema = z2.object({
  schema: z2.literal("codex.chatgpt.process-registry/v1"),
  processes: z2.array(PersistedProcessSchema)
}).strict();
var ProcessRegistry = class {
  constructor(registryPath) {
    this.registryPath = registryPath;
  }
  registryPath;
  async list() {
    try {
      return RegistrySchema.parse(JSON.parse(await readFile2(this.registryPath, "utf8"))).processes;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
  async upsert(process2) {
    const parsed = PersistedProcessSchema.parse(process2);
    await mkdir(path2.dirname(this.registryPath), { recursive: true });
    const release = await lockFile2.lock(this.registryPath, {
      realpath: false,
      retries: { retries: 20, minTimeout: 5, maxTimeout: 50 },
      stale: 3e4
    });
    try {
      const current = await this.list();
      const index = current.findIndex((item) => item.id === parsed.id);
      if (index >= 0) current[index] = parsed;
      else current.push(parsed);
      await writeFileAtomic2(this.registryPath, `${JSON.stringify({
        schema: "codex.chatgpt.process-registry/v1",
        processes: current
      }, null, 2)}
`, { fsync: true });
    } finally {
      await release();
    }
  }
};
function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
async function terminatePersistedProcess(record) {
  if (!pidIsAlive(record.pid)) return;
  const commandName = path2.basename(record.command).toLowerCase();
  if (process.platform === "win32") {
    const probe2 = await execa("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${record.pid}"; if($null -eq $p){exit 3}; [string]$p.CommandLine`
    ], { reject: false, windowsHide: true });
    if (probe2.exitCode !== 0) return;
    if (!probe2.stdout.toLowerCase().includes(commandName)) throw new Error("PROCESS_IDENTITY_MISMATCH");
    const stopped = await execa("taskkill", ["/PID", String(record.pid), "/T", "/F"], { reject: false, windowsHide: true });
    if (stopped.exitCode !== 0 && pidIsAlive(record.pid)) throw new Error("PROCESS_TREE_STILL_ALIVE");
    return;
  }
  const probe = await execa("ps", ["-p", String(record.pid), "-o", "lstart=", "-o", "command="], { reject: false });
  if (probe.exitCode !== 0) return;
  const line = probe.stdout.trim();
  if (!line.toLowerCase().includes(commandName)) throw new Error("PROCESS_IDENTITY_MISMATCH");
  const expectedStart = new Date(record.started_at).getTime();
  const observedStart = Date.parse(line.slice(0, 24));
  if (!Number.isFinite(observedStart) || Math.abs(observedStart - expectedStart) > 2e3) {
    throw new Error("PROCESS_IDENTITY_MISMATCH");
  }
  try {
    process.kill(-record.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  for (let attempt = 0; attempt < 50 && pidIsAlive(record.pid); attempt += 1) {
    await new Promise((resolve13) => setTimeout(resolve13, 100));
  }
  if (pidIsAlive(record.pid)) {
    try {
      process.kill(-record.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  if (pidIsAlive(record.pid)) throw new Error("PROCESS_TREE_STILL_ALIVE");
}

// src/core/forensics/recovery.ts
import { execa as execa2 } from "execa";
import { createHash as createHash3 } from "node:crypto";
import { lstat, mkdir as mkdir2, readFile as readFile3, rename as rename2, rm as rm2, writeFile } from "node:fs/promises";
import * as path3 from "node:path";
import writeFileAtomic3 from "write-file-atomic";
function validateOracleCommand(command) {
  if (!command.length || command.some((part) => !part)) throw new Error("ORACLE_COMMAND_INVALID");
  const executable = path3.basename(command[0]).toLowerCase();
  if (["oracle", "oracle.cmd", "oracle.exe"].includes(executable) && command.length === 1) return [...command];
  if (["npx", "npx.cmd", "npx.exe"].includes(executable)) {
    const tail = command.slice(1).join("\0");
    if ([
      "-y\0@steipete/oracle@0.17.1",
      "--yes\0@steipete/oracle@0.17.1",
      "@steipete/oracle@0.17.1"
    ].includes(tail)) return [...command];
  }
  throw new Error("ORACLE_COMMAND_FORBIDDEN");
}
function recoveryArgv(command, locator, action, outputPath) {
  if (command.length === 0 || !locator.trim()) throw new Error("SESSION_LOCATOR_MISSING");
  if (action !== "live" && action !== "harvest") throw new Error("RECOVERY_ACTION_INVALID");
  const argv = [...command, "session", locator, `--${action}`, "--write-output", outputPath];
  if (argv.includes("restart") || argv.includes("--prompt") || argv.includes("-p")) {
    throw new Error("RECOVERY_COMMAND_UNSAFE");
  }
  return argv;
}
async function planExactRecovery(statePath, action = "live", oracleCommand) {
  const absolute = path3.resolve(statePath);
  const state = OracleSessionStateSchema.parse(JSON.parse(await readFile3(absolute, "utf8")));
  const oracle = state.oracle ?? {};
  const locator = String(oracle.session_locator ?? oracle.slug ?? "").trim();
  const storedCommand = Array.isArray(oracle.command) ? oracle.command.filter((part) => typeof part === "string" && part.length > 0) : [];
  const command = validateOracleCommand(oracleCommand ?? storedCommand);
  const runDir = path3.dirname(absolute);
  const outputPath = path3.join(runDir, `recovery-${action}-candidate.md`);
  const artifacts = state.artifacts ?? {};
  const authoritativeOutput = path3.resolve(String(artifacts.output ?? path3.join(runDir, "output.md")));
  const relativeOutput = path3.relative(runDir, authoritativeOutput);
  if (!relativeOutput || relativeOutput.startsWith("..") || path3.isAbsolute(relativeOutput)) {
    throw new Error("RECOVERY_OUTPUT_OUTSIDE_RUN");
  }
  return {
    run_id: state.run_id,
    project_root: path3.resolve(state.project_root),
    locator,
    action,
    argv: recoveryArgv(command, locator, action, outputPath),
    output_path: outputPath,
    state_path: absolute,
    authoritative_output_path: authoritativeOutput
  };
}
async function executeExactRecovery(plan) {
  const runDir = path3.dirname(plan.output_path);
  await mkdir2(runDir, { recursive: true });
  const stdoutPath = path3.join(runDir, `recovery-${plan.action}-stdout.log`);
  const stderrPath = path3.join(runDir, `recovery-${plan.action}-stderr.log`);
  const [command, ...args] = plan.argv;
  const result = await execa2(command, args, {
    cwd: plan.project_root,
    reject: false,
    shell: false,
    stdin: "ignore",
    env: { ...process.env }
  });
  await Promise.all([
    writeFile(`${stdoutPath}.tmp`, result.stdout, "utf8").then(() => rename2(`${stdoutPath}.tmp`, stdoutPath)),
    writeFile(`${stderrPath}.tmp`, result.stderr, "utf8").then(() => rename2(`${stderrPath}.tmp`, stderrPath))
  ]);
  const output = await readFile3(plan.output_path).catch(() => Buffer.alloc(0));
  const stdout = result.stdout ?? "";
  const states = [...stdout.matchAll(/^\s*State:\s*([a-z][a-z0-9_-]*)\s*$/gim)];
  const observedState = states.at(-1)?.[1].toLowerCase();
  const urls = [...stdout.matchAll(/^\s*URL:\s*(https:\/\/chatgpt\.com\/c\/[^\s?#]+)\s*$/gim)];
  const observedUrl = urls.at(-1)?.[1];
  const liveStates = /* @__PURE__ */ new Set(["running", "streaming", "thinking", "active", "stalled"]);
  const terminalStates = /* @__PURE__ */ new Set(["complete", "completed", "done", "finished", "failed", "error", "cancelled", "canceled"]);
  const raw = JSON.parse(await readFile3(plan.state_path, "utf8"));
  const before = OracleSessionStateSchema.parse(raw);
  if (before.run_id !== plan.run_id || path3.resolve(before.project_root) !== plan.project_root) {
    throw new Error("RECOVERY_STATE_IDENTITY_MUTATED");
  }
  const oracle = { ...raw.oracle ?? {} };
  if (String(oracle.slug ?? oracle.session_locator ?? "") !== plan.locator) throw new Error("EXACT_SLUG_MUTATED");
  const priorAuthority = before.session_authority === "terminal" ? "terminal_observed" : before.session_authority;
  const persistedUrl = String(oracle.conversation_url ?? "").trim();
  if (persistedUrl && observedUrl && persistedUrl !== observedUrl) throw new Error("RECOVERY_CONVERSATION_URL_CONFLICT");
  if (observedUrl) oracle.conversation_url = observedUrl;
  let status = "attention_required";
  let authority = priorAuthority;
  let taskOutcome = String(raw.task_outcome ?? "pending");
  let harvested = false;
  if (observedState && liveStates.has(observedState)) {
    if (["terminal_observed", "settled"].includes(priorAuthority)) {
      status = "attention_required";
    } else {
      authority = "live";
      status = "session_live";
    }
  } else if (observedState && terminalStates.has(observedState)) {
    let semanticOutput = false;
    if (result.exitCode === 0 && output.length > 0) {
      try {
        const contract = String(raw.task_outcome_contract ?? "legacy");
        if (contract === "v1") {
          const parsed = parseTaskOutcome(new TextDecoder("utf-8", { fatal: true }).decode(output));
          taskOutcome = parsed.outcome;
        } else {
          taskOutcome = "legacy_unclassified";
        }
        semanticOutput = true;
      } catch {
        semanticOutput = false;
      }
    }
    if (semanticOutput) {
      const destinationStat = await lstat(plan.authoritative_output_path).catch(() => void 0);
      if (destinationStat?.isSymbolicLink()) throw new Error("RECOVERY_OUTPUT_SYMLINK_FORBIDDEN");
      await rename2(plan.output_path, plan.authoritative_output_path);
      authority = "terminal_observed";
      status = ["EXECUTED", "legacy_unclassified"].includes(taskOutcome) ? "complete" : "attention_required";
      harvested = true;
    } else {
      await rm2(plan.output_path, { force: true });
      authority = priorAuthority === "settled" ? "settled" : "terminal_observed";
      status = "terminal_observed";
    }
  }
  const updated = {
    ...raw,
    oracle,
    status: status === "session_live" ? "running" : status === "complete" ? "complete" : "attention_required",
    exit_code: result.exitCode ?? 1,
    session_authority: authority,
    terminal_harvested: harvested,
    transport_status: harvested ? "complete" : status === "session_live" ? "pending" : "failed",
    task_outcome: harvested ? taskOutcome : "pending",
    artifact_sha256: harvested ? createHash3("sha256").update(await readFile3(plan.authoritative_output_path)).digest("hex") : void 0
  };
  OracleSessionStateSchema.parse(updated);
  await writeFileAtomic3(plan.state_path, `${JSON.stringify(updated, null, 2)}
`, { fsync: true });
  return {
    exit_code: result.exitCode ?? 1,
    stdout_path: stdoutPath,
    stderr_path: stderrPath,
    output_nonempty: harvested,
    status,
    session_authority: authority
  };
}

// src/cli/doctor.ts
var DoctorCheck = z3.object({
  name: z3.string(),
  status: z3.enum(["PASS", "BLOCKED", "FAIL"]),
  code: z3.string(),
  message: z3.string()
});
var DoctorReport = z3.object({
  schema: z3.literal("codex.chatgpt.agent-web-gpt-doctor/v1"),
  status: z3.enum(["PASS", "BLOCKED", "FAIL"]),
  checks: z3.array(DoctorCheck),
  sessions: z3.array(z3.object({
    run_id: z3.string(),
    session_authority: SessionAuthority,
    exact_slug: z3.string().optional(),
    state_path: z3.string(),
    state_schema: z3.enum(["oracle-run", "workflow"])
  })),
  locks_held: z3.boolean(),
  next_actions: z3.array(z3.string()),
  recovery_action: z3.object({
    kind: z3.enum(["devspace_reconnect", "profile_login", "process_cleanup", "exact_session_recovery"]),
    status: z3.enum(["COMPLETED", "BLOCKED", "FAILED"]),
    detail: z3.string()
  }).strict().optional()
});
var DEVSPACE_ACCEPTED_STATUSES = /* @__PURE__ */ new Set([200, 401, 403, 405, 406]);
var CHATGPT_LOGIN_URL = "https://chatgpt.com/auth/login";
async function prepareProfileLogin(oracleHome = path4.join(os2.homedir(), ".oracle")) {
  const root = path4.resolve(oracleHome, "login-profiles");
  await mkdir3(root, { recursive: true, mode: 448 });
  const profilePath = await mkdtemp(path4.join(root, "manual-login-"));
  if (process.platform !== "win32") await chmod(profilePath, 448);
  return { profile_path: profilePath, url: CHATGPT_LOGIN_URL };
}
async function launchProfileLogin(target) {
  const profileArg = `--user-data-dir=${target.profile_path}`;
  const command = process.platform === "darwin" ? { file: "open", args: ["-na", "Google Chrome", "--args", profileArg, target.url] } : process.platform === "win32" ? { file: "cmd.exe", args: ["/d", "/s", "/c", "start", "", "chrome.exe", profileArg, target.url] } : { file: "google-chrome", args: [profileArg, target.url] };
  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  await new Promise((resolve13, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve13();
    };
    const onError = (error) => {
      child.off("spawn", onSpawn);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
  child.unref();
}
async function checkDevSpace(target = "http://127.0.0.1:7676/mcp", fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3e3);
  try {
    const response = await fetcher(target, {
      method: "GET",
      headers: { Accept: "application/json, text/plain;q=0.8" },
      signal: controller.signal
    });
    return DEVSPACE_ACCEPTED_STATUSES.has(response.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
async function checkProfile(copyProfilePath) {
  const root = path4.resolve(copyProfilePath);
  const cookieCandidates = [
    path4.join(root, "Default", "Network", "Cookies"),
    path4.join(root, "Default", "Cookies")
  ];
  try {
    await Promise.all([
      access(path4.join(root, "Local State"), constants.R_OK),
      access(path4.join(root, "Default", "Local Storage"), constants.R_OK)
    ]);
    for (const candidate of cookieCandidates) {
      try {
        await access(candidate, constants.R_OK);
        return true;
      } catch {
      }
    }
    return false;
  } catch {
    return false;
  }
}
async function defaultReconnectDevSpace(projectRoot) {
  void projectRoot;
  return false;
}
async function auditOracleState(statePath) {
  const content = await readFile4(statePath, "utf8");
  const raw = JSON.parse(content);
  const stateResult = PersistentStateSchema.safeParse(raw);
  if (!stateResult.success) {
    const sessionState = OracleSessionStateSchema.parse(raw);
    return {
      run_id: sessionState.run_id,
      session_authority: normalizeOracleSessionAuthority(sessionState.session_authority),
      exact_slug: sessionState.oracle?.slug,
      state_path: path4.resolve(statePath),
      state_schema: "oracle-run"
    };
  }
  const state = stateResult.data;
  if (state.schema === "codex.chatgpt.oracle-workflow/v1") {
    validateWorkflowStateConsistency(state);
  }
  const exactSlug = state.schema === "codex.chatgpt.oracle-run-state/v1" ? state.oracle?.slug : state.receipts.at(-1)?.recovery.exact_slug;
  return {
    run_id: state.run_id,
    session_authority: state.session_authority,
    exact_slug: exactSlug,
    state_path: path4.resolve(statePath),
    state_schema: state.schema === "codex.chatgpt.oracle-run-state/v1" ? "oracle-run" : "workflow"
  };
}
async function discoverStatePaths(root) {
  const found = [];
  async function walk(directory, depth) {
    if (depth > 6) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      const candidate = path4.join(directory, entry.name);
      if (entry.isDirectory()) await walk(candidate, depth + 1);
      else if (entry.isFile() && entry.name === "state.json") found.push(candidate);
    }));
  }
  await walk(root, 0);
  return found.sort();
}
async function runDoctor(options) {
  const normalized = typeof options === "string" ? { projectRoot: options } : options;
  const projectRoot = path4.resolve(normalized.projectRoot);
  const profilePath = path4.resolve(
    normalized.copyProfilePath ?? path4.join(os2.homedir(), ".oracle", "browser-profile")
  );
  const oracleHome = path4.resolve(normalized.oracleHome ?? path4.join(os2.homedir(), ".oracle"));
  const checks = [];
  const nextActions = [];
  if (normalized.devspaceClient) {
    const qualification = await qualifyExactProjectRoot(projectRoot, normalized.devspaceClient);
    checks.push({
      name: "devspace",
      status: qualification.ok ? "PASS" : "BLOCKED",
      code: qualification.code,
      message: qualification.ok ? "DevSpace exact project root qualified with a read-only tool call." : qualification.detail ?? "DevSpace exact-root qualification failed."
    });
    if (!qualification.ok) return DoctorReport.parse({
      schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
      status: "BLOCKED",
      checks,
      sessions: [],
      locks_held: false,
      next_actions: ["Register the exact project root in DevSpace, then rerun doctor."]
    });
  }
  let devspaceReachable = normalized.devspaceClient ? true : await checkDevSpace(normalized.devspaceUrl);
  if (!devspaceReachable && normalized.recover) {
    const reconnected = await (normalized.reconnectDevSpace ?? defaultReconnectDevSpace)(projectRoot);
    devspaceReachable = reconnected && await checkDevSpace(normalized.devspaceUrl);
    if (!devspaceReachable) {
      checks.push({
        name: "devspace",
        status: "BLOCKED",
        code: "DEVSPACE_RECONNECT_FAILED",
        message: "The exact-root DevSpace reconnect was attempted once and the listener remains unavailable."
      });
      return DoctorReport.parse({
        schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
        status: "BLOCKED",
        checks,
        sessions: [],
        locks_held: false,
        next_actions: ["Reconnect DevSpace manually for the exact project root, then rerun doctor --recover."],
        recovery_action: { kind: "devspace_reconnect", status: "BLOCKED", detail: "Exact-root reconnect attempt failed." }
      });
    }
    checks.push({
      name: "devspace",
      status: "PASS",
      code: "DEVSPACE_RECONNECTED",
      message: "DevSpace was reconnected once for the exact project root."
    });
    return DoctorReport.parse({
      schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
      status: "PASS",
      checks,
      sessions: [],
      locks_held: false,
      next_actions: ["Rerun doctor --recover to continue with the next diagnosis."],
      recovery_action: { kind: "devspace_reconnect", status: "COMPLETED", detail: "Exact-root reconnect completed." }
    });
  }
  checks.push({
    name: "devspace",
    status: devspaceReachable ? "PASS" : "BLOCKED",
    code: devspaceReachable ? "DEVSPACE_REACHABLE" : "DEVSPACE_SERVICE_UNAVAILABLE",
    message: devspaceReachable ? "DevSpace MCP listener is reachable." : "DevSpace MCP listener is unavailable or returned an unexpected response."
  });
  if (!devspaceReachable) {
    nextActions.push("Reconnect DevSpace for the exact project root, then rerun doctor.");
    return DoctorReport.parse({
      schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
      status: "BLOCKED",
      checks,
      sessions: [],
      locks_held: false,
      next_actions: nextActions
    });
  }
  const profileValid = await checkProfile(profilePath);
  checks.push({
    name: "copy-profile",
    status: profileValid ? "PASS" : "BLOCKED",
    code: profileValid ? "PROFILE_LAYOUT_VALID" : "PROFILE_LOGIN_REQUIRED",
    message: profileValid ? "The manual-login seed has the required readable profile assets." : "The manual-login seed is missing required readable profile assets."
  });
  if (!profileValid) {
    nextActions.push("Run doctor --open-profile-login and reuse the returned profile_path.");
    return DoctorReport.parse({
      schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
      status: "BLOCKED",
      checks,
      sessions: [],
      locks_held: false,
      next_actions: nextActions,
      recovery_action: normalized.recover ? { kind: "profile_login", status: "BLOCKED", detail: "Manual authentication is required." } : void 0
    });
  }
  const statePaths = normalized.statePaths ?? await discoverStatePaths(path4.join(oracleHome, "state", "chatgpt-oracle"));
  const sessions = [];
  try {
    for (const statePath of statePaths) sessions.push(await auditOracleState(statePath));
    checks.push({
      name: "oracle-state",
      status: "PASS",
      code: "STATE_VALID",
      message: `Validated ${sessions.length} persisted Oracle state file(s).`
    });
  } catch (error) {
    checks.push({
      name: "oracle-state",
      status: "FAIL",
      code: "STATE_INVALID",
      message: error instanceof Error ? error.message : "Oracle state is invalid."
    });
    return DoctorReport.parse({
      schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
      status: "FAIL",
      checks,
      sessions,
      locks_held: false,
      next_actions: ["Repair or restore the malformed state before recovery."]
    });
  }
  if (normalized.recover) {
    const registry = new ProcessRegistry(path4.join(oracleHome, "processes.json"));
    const running = (await registry.list()).filter((record) => record.state === "running" && record.project_root && path4.resolve(record.project_root) === projectRoot);
    if (running.length > 0) {
      const protectedOwners = new Set(sessions.filter((session) => ["live", "submitted_unknown"].includes(session.session_authority)).flatMap((session) => [session.run_id, session.exact_slug].filter((value) => Boolean(value))));
      const cleanableOwners = new Set(sessions.filter((session) => ["pre_submit", "terminal_observed", "settled"].includes(session.session_authority)).flatMap((session) => [session.run_id, session.exact_slug].filter((value) => Boolean(value))));
      const candidate = running.find((record) => !protectedOwners.has(record.run_id ?? "") && !protectedOwners.has(record.exact_slug ?? "") && (!pidIsAlive(record.pid) || cleanableOwners.has(record.run_id ?? "") || cleanableOwners.has(record.exact_slug ?? "")));
      if (!candidate) {
        let ownershipProbe;
        try {
          ownershipProbe = await new LockManager({ projectRoot, retries: 0 }).tryAcquire();
        } catch (error) {
          checks.push({
            name: "project-lock",
            status: "FAIL",
            code: "PROJECT_LOCK_PROBE_FAILED",
            message: error instanceof Error ? error.message : "Project lock probe failed."
          });
          return DoctorReport.parse({
            schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
            status: "FAIL",
            checks,
            sessions,
            locks_held: false,
            next_actions: ["Repair the lock storage error before process recovery."],
            recovery_action: { kind: "process_cleanup", status: "FAILED", detail: "Project lock probe failed." }
          });
        }
        const actuallyHeld = !ownershipProbe.held;
        if (ownershipProbe.held) await ownershipProbe.release();
        return DoctorReport.parse({
          schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
          status: "BLOCKED",
          checks,
          sessions,
          locks_held: actuallyHeld,
          next_actions: ["Continue observing the recorded exact live/submitted-unknown owner; it was not stopped."],
          recovery_action: { kind: "process_cleanup", status: "BLOCKED", detail: "No unowned recorded process belongs to this exact project." }
        });
      }
      let cleanupLock;
      try {
        cleanupLock = await new LockManager({ projectRoot, retries: 0 }).tryAcquire();
      } catch (error) {
        checks.push({
          name: "project-lock",
          status: "FAIL",
          code: "PROJECT_LOCK_PROBE_FAILED",
          message: error instanceof Error ? error.message : "Project lock probe failed."
        });
        return DoctorReport.parse({
          schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
          status: "FAIL",
          checks,
          sessions,
          locks_held: false,
          next_actions: ["Repair the lock storage error before process recovery."],
          recovery_action: { kind: "process_cleanup", status: "FAILED", detail: "Project lock probe failed." }
        });
      }
      if (!cleanupLock.held) {
        return DoctorReport.parse({
          schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
          status: "BLOCKED",
          checks,
          sessions,
          locks_held: true,
          next_actions: ["Wait for the exact project owner; no process was stopped."],
          recovery_action: { kind: "process_cleanup", status: "BLOCKED", detail: "Exact project lock is owned." }
        });
      }
      try {
        if (pidIsAlive(candidate.pid)) await terminatePersistedProcess(candidate);
        await registry.upsert({ ...candidate, state: "cleaned" });
      } finally {
        await cleanupLock.release();
      }
      checks.push({ name: "process-registry", status: "PASS", code: "PROCESS_TREE_CLEANED", message: `Cleaned recorded process ${candidate.id}.` });
      return DoctorReport.parse({
        schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
        status: "PASS",
        checks,
        sessions,
        locks_held: false,
        next_actions: ["Rerun doctor --recover to continue with exact-session recovery."],
        recovery_action: { kind: "process_cleanup", status: "COMPLETED", detail: `Cleaned ${candidate.id}.` }
      });
    }
  }
  const lockProbe = new LockManager({ projectRoot, retries: 0 });
  let probe;
  try {
    probe = await lockProbe.tryAcquire();
  } catch (error) {
    checks.push({
      name: "project-lock",
      status: "FAIL",
      code: "PROJECT_LOCK_PROBE_FAILED",
      message: error instanceof Error ? error.message : "Project lock probe failed."
    });
    return DoctorReport.parse({
      schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
      status: "FAIL",
      checks,
      sessions,
      locks_held: false,
      next_actions: ["Repair the lock storage error before recovery."]
    });
  }
  const locksHeld = !probe.held;
  if (probe.held && !normalized.recover) await probe.release();
  checks.push({
    name: "project-lock",
    status: locksHeld ? "BLOCKED" : "PASS",
    code: locksHeld ? "PROJECT_LOCK_HELD" : "PROJECT_LOCK_AVAILABLE",
    message: locksHeld ? "The exact project lock is owned; doctor did not release it." : "The exact project lock is available."
  });
  if (locksHeld) {
    nextActions.push("Continue or settle the exact owned session; doctor did not release its lock.");
  }
  if (normalized.recover && probe.held) {
    try {
      const recoverable = sessions.find((session) => session.state_schema === "oracle-run" && session.exact_slug && ["submitted_unknown", "live", "terminal_observed"].includes(session.session_authority));
      if (recoverable) {
        const action = recoverable.session_authority === "terminal_observed" ? "harvest" : "live";
        const plan = await planExactRecovery(recoverable.state_path, action);
        const result = await executeExactRecovery(plan);
        const completed = result.status === "complete";
        return DoctorReport.parse({
          schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
          status: completed ? "PASS" : "BLOCKED",
          checks,
          sessions,
          locks_held: false,
          next_actions: completed ? ["Audit the updated exact-session output and persisted state."] : ["Preserve the exact run and repeat exact-session observation; never resubmit."],
          recovery_action: {
            kind: "exact_session_recovery",
            status: completed ? "COMPLETED" : "BLOCKED",
            detail: `${action} ${plan.locator} exited ${result.exit_code}.`
          }
        });
      }
      const workflowOnly = sessions.find((session) => session.state_schema === "workflow" && session.exact_slug && ["submitted_unknown", "live", "terminal_observed"].includes(session.session_authority));
      if (workflowOnly) {
        return DoctorReport.parse({
          schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
          status: "BLOCKED",
          checks,
          sessions,
          locks_held: false,
          next_actions: ["Locate the bound Oracle run state for this workflow before exact-session recovery."],
          recovery_action: {
            kind: "exact_session_recovery",
            status: "BLOCKED",
            detail: `Workflow ${workflowOnly.run_id} has no bound Oracle run-state command.`
          }
        });
      }
    } finally {
      await probe.release();
    }
  }
  return DoctorReport.parse({
    schema: "codex.chatgpt.agent-web-gpt-doctor/v1",
    status: locksHeld ? "BLOCKED" : "PASS",
    checks,
    sessions,
    locks_held: locksHeld,
    next_actions: nextActions
  });
}

// src/cli/lifecycle.ts
import { createHash as createHash4, randomUUID as randomUUID2 } from "node:crypto";
import { copyFile, lstat as lstat2, mkdir as mkdir4, readFile as readFile5, readdir as readdir2, rm as rm3 } from "node:fs/promises";
import { accessSync } from "node:fs";
import * as path5 from "node:path";
import { fileURLToPath } from "node:url";
import writeFileAtomic4 from "write-file-atomic";
import { z as z4 } from "zod";
function resolvePackageSource(metaUrl = import.meta.url) {
  let cursor = path5.dirname(fileURLToPath(metaUrl));
  for (let i = 0; i < 5; i += 1) {
    if (path5.basename(cursor) !== "node_modules" && pathExists(path5.join(cursor, "install-manifest.json"))) return cursor;
    cursor = path5.dirname(cursor);
  }
  return path5.resolve(fileURLToPath(new URL("../", metaUrl)));
}
function pathExists(file) {
  try {
    accessSync(file);
    return true;
  } catch {
    return false;
  }
}
var RECEIPT_SCHEMA = "codex.chatgpt.install-receipt/v1";
var WAL_SCHEMA = "codex.chatgpt.install-wal/v1";
var InstallManifestSchema = z4.object({
  schema: z4.string().min(1),
  version: z4.string().min(1),
  include: z4.array(z4.string().min(1))
}).passthrough();
async function readInstallManifest(sourceRoot) {
  const root = path5.resolve(sourceRoot);
  return InstallManifestSchema.parse(JSON.parse(await readFile5(path5.join(root, "install-manifest.json"), "utf8")));
}
async function manifestVersion(sourceRoot) {
  return (await readInstallManifest(sourceRoot)).version;
}
var InstallRecordSchema = z4.object({
  path: z4.string().min(1),
  action: z4.enum(["created", "overwritten"]),
  installed_sha256: z4.string().regex(/^[a-f0-9]{64}$/),
  backup_sha256: z4.string().regex(/^[a-f0-9]{64}$/).nullable()
}).strict();
var InstallReceiptSchema = z4.object({
  schema: z4.literal(RECEIPT_SCHEMA),
  action: z4.enum(["install", "update"]),
  installed_at: z4.string().datetime(),
  manifest_version: z4.string().min(1),
  source_root: z4.string().min(1),
  agent_home: z4.string().min(1),
  backup: z4.string().min(1),
  wal: z4.string().min(1),
  files: z4.array(InstallRecordSchema)
}).strict();
var InstallWalSchema = z4.object({
  schema: z4.literal(WAL_SCHEMA),
  status: z4.enum(["ACTIVE", "COMPLETE", "ROLLED_BACK_AFTER_CRASH"]),
  action: z4.enum(["install", "update"]),
  backup: z4.string().min(1),
  files: z4.array(InstallRecordSchema)
}).passthrough();
function sha256(bytes) {
  return createHash4("sha256").update(bytes).digest("hex");
}
async function sha256File(file) {
  return sha256(await readFile5(file));
}
async function writeJsonAtomic(file, value) {
  await mkdir4(path5.dirname(file), { recursive: true });
  await writeFileAtomic4(file, `${JSON.stringify(value, null, 2)}
`, { fsync: true });
}
function safeChild(root, relative5) {
  if (!relative5 || path5.isAbsolute(relative5) || relative5.split(/[\\/]/).some((part) => !part || part === "." || part === "..")) {
    throw new Error(`LIFECYCLE_PATH_UNSAFE: ${relative5}`);
  }
  const absoluteRoot = path5.resolve(root);
  const candidate = path5.resolve(absoluteRoot, relative5);
  if (candidate === absoluteRoot || !candidate.startsWith(`${absoluteRoot}${path5.sep}`)) {
    throw new Error(`LIFECYCLE_PATH_ESCAPE: ${relative5}`);
  }
  return candidate;
}
async function assertNoSymlink(root, candidate) {
  let cursor = candidate;
  while (cursor !== root) {
    const stat = await lstat2(cursor).catch(() => void 0);
    if (stat?.isSymbolicLink()) throw new Error(`LIFECYCLE_SYMLINK_REFUSED: ${cursor}`);
    cursor = path5.dirname(cursor);
  }
}
async function copyAtomic(source, destination) {
  await mkdir4(path5.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID2()}.tmp`;
  try {
    await copyFile(source, temporary);
    await import("node:fs/promises").then((fs) => fs.rename(temporary, destination));
  } finally {
    await rm3(temporary, { force: true });
  }
}
async function expandPattern(root, pattern) {
  if (!pattern.includes("*")) return [pattern];
  const directory = path5.dirname(pattern);
  const basename4 = path5.basename(pattern);
  if ((basename4.match(/\*/g) ?? []).length !== 1 || basename4 !== `*.${basename4.split(".").at(-1)}`) {
    throw new Error(`LIFECYCLE_GLOB_UNSUPPORTED: ${pattern}`);
  }
  const suffix = basename4.slice(1);
  const names = await readdir2(safeChild(root, directory));
  return names.filter((name) => name.endsWith(suffix)).sort().map((name) => path5.join(directory, name));
}
async function manifestFiles(sourceRoot) {
  const root = path5.resolve(sourceRoot);
  const manifest = await readInstallManifest(root);
  const files = /* @__PURE__ */ new Set();
  for (const pattern of manifest.include) {
    for (const relative5 of await expandPattern(root, pattern)) {
      const source = safeChild(root, relative5);
      await assertNoSymlink(root, source);
      const stat = await lstat2(source);
      if (!stat.isFile()) throw new Error(`LIFECYCLE_SOURCE_NOT_FILE: ${relative5}`);
      files.add(relative5);
    }
  }
  return { version: manifest.version, files: [...files].sort() };
}
async function latestReceipt(agentHome) {
  const root = path5.join(agentHome, "receipts");
  const names = (await readdir2(root)).filter((name) => /^agent-web-gpt-.+\.json$/.test(name)).sort();
  if (!names.length) throw new Error("LIFECYCLE_RECEIPT_MISSING");
  return path5.join(root, names.at(-1));
}
async function recoverPendingInstalls(agentHome) {
  const home = path5.resolve(agentHome);
  const backupsRoot = path5.join(home, "backups");
  const names = await readdir2(backupsRoot).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const recovered = [];
  for (const name of names.sort()) {
    const walPath = path5.join(backupsRoot, name, "install.wal.json");
    let wal;
    try {
      wal = InstallWalSchema.parse(JSON.parse(await readFile5(walPath, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (wal.status !== "ACTIVE") continue;
    const backup2 = path5.resolve(wal.backup);
    if (!backup2.startsWith(`${backupsRoot}${path5.sep}`)) throw new Error("LIFECYCLE_WAL_NOT_OWNED");
    const conflicts = [];
    for (const record of [...wal.files].reverse()) {
      const destination = safeChild(home, record.path);
      const actual = await sha256File(destination).catch(() => void 0);
      if (actual !== record.installed_sha256) continue;
      if (record.action === "created") await rm3(destination);
      else {
        const backupFile = safeChild(backup2, record.path);
        if (await sha256File(backupFile).catch(() => void 0) !== record.backup_sha256) conflicts.push(record.path);
        else await copyAtomic(backupFile, destination);
      }
    }
    if (conflicts.length) throw new Error(`LIFECYCLE_CRASH_RECOVERY_CONFLICT: ${conflicts.join(",")}`);
    await writeJsonAtomic(walPath, { ...wal, status: "ROLLED_BACK_AFTER_CRASH", recovered_at: (/* @__PURE__ */ new Date()).toISOString() });
    recovered.push(walPath);
  }
  return recovered;
}
async function installOrUpdate(action, sourceRoot, agentHome) {
  const source = path5.resolve(sourceRoot);
  const home = path5.resolve(agentHome);
  const manifest = await manifestFiles(source);
  await mkdir4(home, { recursive: true });
  await recoverPendingInstalls(home);
  const stamp = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:.TZ]/g, "")}-${randomUUID2()}`;
  const backup2 = path5.join(home, "backups", `agent-web-gpt-${stamp}`);
  const receiptPath = path5.join(home, "receipts", `agent-web-gpt-${stamp}.json`);
  const walPath = path5.join(backup2, "install.wal.json");
  const records = [];
  const wal = { schema: WAL_SCHEMA, status: "ACTIVE", action, backup: backup2, files: records };
  await writeJsonAtomic(walPath, wal);
  try {
    for (const relative5 of manifest.files) {
      const sourceFile = safeChild(source, relative5);
      const destination = safeChild(home, relative5);
      await assertNoSymlink(home, destination);
      const existing = await lstat2(destination).catch(() => void 0);
      let backupHash = null;
      let recordAction = "created";
      if (existing) {
        if (!existing.isFile() || existing.isSymbolicLink()) throw new Error(`LIFECYCLE_DESTINATION_INVALID: ${relative5}`);
        recordAction = "overwritten";
        const backupFile = safeChild(backup2, relative5);
        await copyAtomic(destination, backupFile);
        backupHash = await sha256File(backupFile);
      }
      const installedHash = await sha256File(sourceFile);
      records.push({ path: relative5, action: recordAction, installed_sha256: installedHash, backup_sha256: backupHash });
      await writeJsonAtomic(walPath, wal);
      await copyAtomic(sourceFile, destination);
      if (await sha256File(destination) !== installedHash) throw new Error(`LIFECYCLE_COMMIT_HASH_MISMATCH: ${relative5}`);
    }
  } catch (error) {
    await rollbackRecords(home, backup2, records);
    throw error;
  }
  await writeJsonAtomic(walPath, { ...wal, status: "COMPLETE", completed_at: (/* @__PURE__ */ new Date()).toISOString() });
  const receipt = InstallReceiptSchema.parse({
    schema: RECEIPT_SCHEMA,
    action,
    installed_at: (/* @__PURE__ */ new Date()).toISOString(),
    manifest_version: manifest.version,
    source_root: source,
    agent_home: home,
    backup: backup2,
    wal: walPath,
    files: records
  });
  await writeJsonAtomic(receiptPath, receipt);
  return { ok: true, action, status: "COMPLETE", receipt: receiptPath, count: records.length };
}
async function rollbackRecords(home, backup2, records) {
  const conflicts = [];
  for (const record of [...records].reverse()) {
    const destination = safeChild(home, record.path);
    const actual = await sha256File(destination).catch(() => void 0);
    if (actual !== record.installed_sha256) {
      conflicts.push(record.path);
      continue;
    }
    if (record.action === "created") {
      await rm3(destination);
    } else {
      const backupFile = safeChild(backup2, record.path);
      if (await sha256File(backupFile).catch(() => void 0) !== record.backup_sha256) {
        conflicts.push(record.path);
        continue;
      }
      await copyAtomic(backupFile, destination);
    }
  }
  return conflicts;
}
async function rollbackInstall(agentHome, requestedReceipt) {
  const home = path5.resolve(agentHome);
  const receiptPath = path5.resolve(requestedReceipt ?? await latestReceipt(home));
  const receiptsRoot = path5.join(home, "receipts");
  if (!receiptPath.startsWith(`${receiptsRoot}${path5.sep}`)) throw new Error("LIFECYCLE_RECEIPT_NOT_OWNED");
  const receipt = InstallReceiptSchema.parse(JSON.parse(await readFile5(receiptPath, "utf8")));
  if (path5.resolve(receipt.agent_home) !== home || !path5.resolve(receipt.backup).startsWith(`${path5.join(home, "backups")}${path5.sep}`)) {
    throw new Error("LIFECYCLE_RECEIPT_NOT_OWNED");
  }
  const conflicts = await rollbackRecords(home, receipt.backup, receipt.files);
  return {
    ok: conflicts.length === 0,
    action: "rollback",
    status: conflicts.length ? "CONFLICT" : "COMPLETE",
    receipt: receiptPath,
    conflicts
  };
}

// src/core/process/profiles.ts
import { z as z5 } from "zod";
import * as crypto2 from "node:crypto";
import * as path6 from "node:path";
import { access as access2, chmod as chmod2, cp, lstat as lstat3, mkdir as mkdir5, readdir as readdir3, rm as rm4 } from "node:fs/promises";
import { constants as constants2 } from "node:fs";
var ProfileConfig = z5.object({
  sourceProfilePath: z5.string(),
  maxAgeMinutes: z5.number().optional()
});
var ProfileManager = class {
  constructor(config, oracleHome) {
    this.oracleHome = oracleHome;
    this.seedPath = path6.resolve(config.sourceProfilePath);
    this.sessionRoot = path6.resolve(oracleHome, "browser-sessions");
  }
  oracleHome;
  profiles = /* @__PURE__ */ new Map();
  seedPath;
  sessionRoot;
  async createSession(profileId) {
    const id = profileId ?? crypto2.randomUUID();
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("PROFILE_ID_INVALID");
    const source = await lstat3(this.seedPath);
    if (!source.isDirectory() || source.isSymbolicLink()) throw new Error("PROFILE_SEED_INVALID");
    await mkdir5(this.sessionRoot, { recursive: true, mode: 448 });
    const copyTo = path6.join(this.sessionRoot, `${id}-${crypto2.randomUUID()}`);
    try {
      await cp(this.seedPath, copyTo, {
        recursive: true,
        force: false,
        errorOnExist: true,
        dereference: false,
        filter: async (sourcePath) => {
          if ((await lstat3(sourcePath)).isSymbolicLink()) throw new Error("PROFILE_SEED_SYMLINK_FORBIDDEN");
          return true;
        }
      });
      await this.hardenProfileTree(copyTo);
    } catch (error) {
      await rm4(copyTo, { recursive: true, force: true });
      throw error;
    }
    const info = {
      id,
      sourcePath: this.seedPath,
      copiedAt: /* @__PURE__ */ new Date(),
      copiedPath: copyTo,
      lastValidated: /* @__PURE__ */ new Date(),
      isValid: false
    };
    this.profiles.set(id, info);
    return copyTo;
  }
  async validateProfile(profileId) {
    const info = this.profiles.get(profileId);
    if (!info) return false;
    try {
      await Promise.all([
        access2(path6.join(info.copiedPath, "Local State"), constants2.R_OK),
        access2(path6.join(info.copiedPath, "Default", "Local Storage"), constants2.R_OK),
        this.findReadableCookies(info.copiedPath)
      ]);
      info.isValid = true;
    } catch {
      info.isValid = false;
    }
    info.lastValidated = /* @__PURE__ */ new Date();
    return info.isValid;
  }
  async removeProfile(profileId) {
    const info = this.profiles.get(profileId);
    if (!info) return;
    const relative5 = path6.relative(this.sessionRoot, info.copiedPath);
    if (relative5.startsWith("..") || path6.isAbsolute(relative5)) {
      throw new Error("PROFILE_PATH_OUTSIDE_SESSION_ROOT");
    }
    await rm4(info.copiedPath, { recursive: true, force: true });
    this.profiles.delete(profileId);
  }
  getProfile(profileId) {
    return this.profiles.get(profileId);
  }
  async findReadableCookies(profileRoot) {
    const candidates = [
      path6.join(profileRoot, "Default", "Network", "Cookies"),
      path6.join(profileRoot, "Default", "Cookies")
    ];
    for (const candidate of candidates) {
      try {
        await access2(candidate, constants2.R_OK);
        return;
      } catch {
      }
    }
    throw new Error("PROFILE_COOKIES_MISSING");
  }
  async hardenProfileTree(target) {
    const metadata = await lstat3(target);
    if (metadata.isSymbolicLink()) throw new Error("PROFILE_COPY_SYMLINK_FORBIDDEN");
    if (metadata.isDirectory()) {
      await chmod2(target, 448);
      const entries = await readdir3(target);
      for (const entry of entries) await this.hardenProfileTree(path6.join(target, entry));
      return;
    }
    await chmod2(target, 384);
  }
};

// src/core/process/auth-preflight.ts
import { execa as execa3 } from "execa";
import { access as access3, readFile as readFile6 } from "node:fs/promises";
import * as path7 from "node:path";
function evaluateAuthSnapshot(snapshot) {
  if ([401, 403].includes(snapshot.backend_status) || snapshot.login_cta) {
    return { ...snapshot, ok: false, code: "AUTH_LOGIN_REQUIRED" };
  }
  const ok = snapshot.backend_status === 200 && snapshot.composer && snapshot.model_selector && snapshot.thinking_control;
  return { ...snapshot, ok, code: ok ? "AUTH_DOM_READY" : "AUTH_DOM_INCOMPLETE" };
}
async function cdpEvaluate(webSocketUrl) {
  const Socket = globalThis.WebSocket;
  if (!Socket) throw new Error("AUTH_PREFLIGHT_WEBSOCKET_UNAVAILABLE");
  const socket = new Socket(webSocketUrl);
  let nextId = 0;
  const pending = /* @__PURE__ */ new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id != null) pending.get(message.id)?.(message.error ? { error: message.error } : message.result);
  });
  await new Promise((resolve13, reject) => {
    socket.addEventListener("open", () => resolve13());
    socket.addEventListener("error", () => reject(new Error("AUTH_PREFLIGHT_CDP_CONNECT_FAILED")));
  });
  const call = (method, params = {}) => new Promise((resolve13, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`AUTH_PREFLIGHT_CDP_TIMEOUT: ${method}`));
    }, 15e3);
    pending.set(id, (value) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve13(value);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    await call("Page.enable");
    await call("Runtime.enable");
    await call("Page.navigate", { url: "https://chatgpt.com/" });
    const expression = `(async () => {
      const status = await fetch('/backend-api/me', { credentials: 'include' }).then(r => r.status).catch(() => 0);
      const text = document.body?.innerText || '';
      const exactLogin = [...document.querySelectorAll('a,button')].some(el => /^(log in|sign in)$/i.test((el.textContent || '').trim()));
      const composer = !!document.querySelector('#prompt-textarea, textarea, [contenteditable="true"][data-testid*="prompt"]');
      const model = !!document.querySelector('[data-testid*="model-switcher"], button[aria-label*="model" i]');
      const thinking = !!document.querySelector('[data-testid*="thinking"], button[aria-label*="thinking" i]') || /thinking|extra high/i.test(text);
      return { backend_status: status, composer, model_selector: model, thinking_control: thinking, login_cta: exactLogin };
    })()`;
    let latest;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve13) => setTimeout(resolve13, 1e3));
      const response = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (!response.exceptionDetails && response.result?.value) {
        latest = response.result.value;
        const evaluated = evaluateAuthSnapshot(latest);
        if (evaluated.code !== "AUTH_DOM_INCOMPLETE") return latest;
      }
    }
    if (!latest) throw new Error("AUTH_PREFLIGHT_DOM_EVALUATION_FAILED");
    return latest;
  } finally {
    socket.close();
  }
}
async function probeBrowserAuth(devtoolsBaseUrl) {
  const response = await fetch(`${devtoolsBaseUrl.replace(/\/$/, "")}/json/new?https://chatgpt.com/`, {
    method: "PUT",
    signal: AbortSignal.timeout(5e3)
  });
  if (!response.ok) throw new Error(`AUTH_PREFLIGHT_TARGET_FAILED: ${response.status}`);
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) throw new Error("AUTH_PREFLIGHT_TARGET_MISSING");
  return evaluateAuthSnapshot(await cdpEvaluate(target.webSocketDebuggerUrl));
}
async function preflightCopiedProfile(profilePath, chromePath) {
  const executable = chromePath ?? await findChrome();
  const proc = execa3(executable, [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${path7.resolve(profilePath)}`,
    "about:blank"
  ], { reject: false, windowsHide: true, detached: process.platform !== "win32" });
  try {
    const portFile = path7.join(path7.resolve(profilePath), "DevToolsActivePort");
    let port;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        port = (await readFile6(portFile, "utf8")).split(/\r?\n/, 1)[0];
        if (/^\d+$/.test(port)) break;
      } catch {
      }
      await new Promise((resolve13) => setTimeout(resolve13, 100));
    }
    if (!port || !/^\d+$/.test(port)) throw new Error("AUTH_PREFLIGHT_CHROME_START_TIMEOUT");
    return await probeBrowserAuth(`http://127.0.0.1:${port}`);
  } finally {
    proc.kill("SIGTERM");
    await Promise.race([
      proc.catch(() => void 0),
      new Promise((resolve13) => setTimeout(resolve13, 5e3))
    ]);
    if (proc.exitCode == null) proc.kill("SIGKILL");
  }
}
async function findChrome() {
  const candidates = process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] : process.platform === "win32" ? [
    path7.join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
    path7.join(process.env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
    path7.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe")
  ] : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
  for (const candidate of candidates) {
    try {
      await access3(candidate);
      return candidate;
    } catch {
    }
  }
  throw new Error("AUTH_PREFLIGHT_CHROME_NOT_FOUND");
}

// src/core/process/cookie-recovery.ts
import { randomUUID as randomUUID4 } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import {
  chmod as chmod3,
  copyFile as copyFile2,
  lstat as lstat4,
  mkdir as mkdir6,
  readFile as readFile7,
  rename as rename3,
  rm as rm5
} from "node:fs/promises";
import * as os3 from "node:os";
import * as path8 from "node:path";
import writeFileAtomic5 from "write-file-atomic";
var COOKIE_SCOPE_SQL = `(
  host_key = 'chatgpt.com' OR host_key LIKE '%.chatgpt.com'
  OR host_key = 'openai.com' OR host_key LIKE '%.openai.com'
)`;
function defaultChromeUserDataRoot() {
  if (process.platform === "darwin") {
    return path8.join(os3.homedir(), "Library", "Application Support", "Google", "Chrome");
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (!local) throw new Error("CHROME_USER_DATA_ROOT_UNAVAILABLE");
    return path8.join(local, "Google", "Chrome", "User Data");
  }
  return path8.join(os3.homedir(), ".config", "google-chrome");
}
async function assertRegularFile(file, code) {
  const metadata = await lstat4(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(code);
}
async function assertDirectory(directory, code) {
  const metadata = await lstat4(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(code);
}
function validateProfileName(value) {
  if (!value || value === "." || value === ".." || /[\\/\0]/.test(value)) {
    throw new Error("CHROME_PROFILE_NAME_INVALID");
  }
  return value;
}
async function discoverSourceProfile(root, explicit) {
  if (explicit) return validateProfileName(explicit);
  try {
    const localState = JSON.parse(await readFile7(path8.join(root, "Local State"), "utf8"));
    if (typeof localState.profile?.last_used === "string") {
      return validateProfileName(localState.profile.last_used);
    }
  } catch {
  }
  return "Default";
}
async function findCookies(profileRoot) {
  const candidates = [
    path8.join(profileRoot, "Network", "Cookies"),
    path8.join(profileRoot, "Cookies")
  ];
  for (const candidate of candidates) {
    try {
      await assertRegularFile(candidate, "CHROME_COOKIES_INVALID");
      return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error("CHROME_COOKIES_MISSING");
}
async function assertSeedClosed(seedPath) {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie", "DevToolsActivePort"]) {
    try {
      await lstat4(path8.join(seedPath, name));
      throw new Error("PROFILE_SEED_IN_USE");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
async function assertQuiescent(directory) {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie", "DevToolsActivePort"]) {
    try {
      await lstat4(path8.join(directory, name));
      throw new Error("CHROME_PROFILE_IN_USE");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
function cookieColumns(db) {
  return db.prepare("PRAGMA table_info(cookies)").all().map((column) => column.name).filter((name) => /^[a-z_][a-z0-9_]*$/i.test(name));
}
function quoted(name) {
  return `"${name.replaceAll('"', '""')}"`;
}
function importCookieRows(sourcePath, targetPath) {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  let target;
  try {
    target = new DatabaseSync(targetPath);
    const sourceColumns = cookieColumns(source);
    const targetColumns = new Set(cookieColumns(target));
    const columns = sourceColumns.filter((column) => targetColumns.has(column));
    for (const required of ["host_key", "name", "path", "encrypted_value"]) {
      if (!columns.includes(required)) throw new Error(`COOKIE_SCHEMA_MISSING_COLUMN: ${required}`);
    }
    const names = columns.map(quoted).join(", ");
    const select = source.prepare(`SELECT ${names} FROM cookies WHERE ${COOKIE_SCOPE_SQL}`);
    select.setReadBigInts(true);
    const rows = select.all();
    if (!rows.length) return 0;
    const insert = target.prepare(
      `INSERT OR REPLACE INTO cookies (${names}) VALUES (${columns.map(() => "?").join(", ")})`
    );
    target.exec("BEGIN IMMEDIATE");
    try {
      target.prepare(`DELETE FROM cookies WHERE ${COOKIE_SCOPE_SQL}`).run();
      for (const row of rows) insert.run(...columns.map((column) => row[column]));
      const integrity = target.prepare("PRAGMA integrity_check").get();
      if (integrity?.integrity_check !== "ok") throw new Error("COOKIE_DATABASE_INTEGRITY_FAILED");
      target.exec("COMMIT");
    } catch (error) {
      target.exec("ROLLBACK");
      throw error;
    }
    target.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return rows.length;
  } finally {
    source.close();
    target?.close();
  }
}
async function buildMergedCookieKey(sourceLocalState, targetLocalState) {
  const original = await readFile7(targetLocalState);
  const source = JSON.parse(await readFile7(sourceLocalState, "utf8"));
  const sourceKeys = Object.fromEntries(
    ["encrypted_key", "app_bound_encrypted_key"].filter((key) => typeof source.os_crypt?.[key] === "string").map((key) => [key, source.os_crypt[key]])
  );
  if (Object.keys(sourceKeys).length === 0) {
    return { original, merged: original.toString("utf8") };
  }
  const target = JSON.parse(original.toString("utf8"));
  target.os_crypt = { ...target.os_crypt ?? {}, ...sourceKeys };
  return { original, merged: `${JSON.stringify(target)}
` };
}
async function copyCookieSidecars(source, destination, copied) {
  for (const suffix of ["-wal", "-shm"]) {
    try {
      await copyFile2(`${source}${suffix}`, `${destination}${suffix}`);
      copied.push(suffix);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
async function restoreCookieFiles(target, original, sidecars, originalLocalState, targetLocalState) {
  try {
    await rm5(target, { force: true });
    await Promise.all(["-wal", "-shm"].map((suffix) => rm5(`${target}${suffix}`, { force: true })));
    await copyFile2(original, target);
    for (const suffix of sidecars) await copyFile2(`${original}${suffix}`, `${target}${suffix}`);
    await writeFileAtomic5(targetLocalState, originalLocalState, { fsync: true, mode: 384 });
  } catch (error) {
    throw new Error("COOKIE_RECOVERY_ROLLBACK_FAILED", { cause: error });
  }
}
async function recoverChatGptLogin(options) {
  const seed = path8.resolve(options.seedPath);
  const oracleHome = path8.resolve(options.oracleHome ?? path8.join(os3.homedir(), ".oracle"));
  const sourceRoot = path8.resolve(options.sourceUserDataRoot ?? defaultChromeUserDataRoot());
  await Promise.all([
    assertDirectory(seed, "PROFILE_SEED_INVALID"),
    assertDirectory(sourceRoot, "CHROME_USER_DATA_ROOT_INVALID"),
    assertSeedClosed(seed)
  ]);
  if (seed === sourceRoot) throw new Error("COOKIE_RECOVERY_SOURCE_EQUALS_SEED");
  const sourceProfile = await discoverSourceProfile(sourceRoot, options.sourceProfile);
  await assertQuiescent(sourceRoot);
  await assertQuiescent(path8.join(sourceRoot, sourceProfile));
  const sourceCookies = await findCookies(path8.join(sourceRoot, sourceProfile));
  const targetCookies = await findCookies(path8.join(seed, "Default"));
  const sourceLocalState = path8.join(sourceRoot, "Local State");
  const targetLocalState = path8.join(seed, "Local State");
  await Promise.all([
    assertRegularFile(sourceLocalState, "CHROME_LOCAL_STATE_INVALID"),
    assertRegularFile(targetLocalState, "PROFILE_LOCAL_STATE_INVALID")
  ]);
  const work = path8.join(path8.dirname(seed), `.cookie-recovery-${randomUUID4()}`);
  await mkdir6(work, { recursive: false, mode: 448 });
  const sourceSnapshot = path8.join(work, "source-cookies.sqlite");
  const candidate = path8.join(work, "candidate-cookies.sqlite");
  const originalCookies = path8.join(work, "original-cookies.sqlite");
  const displacedCookies = path8.join(work, "displaced-cookies.sqlite");
  let originalLocalState;
  let replaced = false;
  const originalSidecars = [];
  try {
    const sourceDb = new DatabaseSync(sourceCookies, { readOnly: true });
    try {
      await backup(sourceDb, sourceSnapshot).catch((error) => {
        throw new Error("CHROME_COOKIES_SNAPSHOT_FAILED", { cause: error });
      });
    } finally {
      sourceDb.close();
    }
    await copyFile2(targetCookies, originalCookies);
    await copyCookieSidecars(targetCookies, originalCookies, originalSidecars);
    const targetDb = new DatabaseSync(targetCookies, { readOnly: true });
    try {
      await backup(targetDb, candidate).catch((error) => {
        throw new Error("PROFILE_COOKIES_SNAPSHOT_FAILED", { cause: error });
      });
    } finally {
      targetDb.close();
    }
    await chmod3(sourceSnapshot, 384);
    await chmod3(candidate, 384);
    const count = importCookieRows(sourceSnapshot, candidate);
    if (count === 0) {
      return {
        schema: "codex.chatgpt.auth-cookie-recovery/v1",
        ok: false,
        status: "BLOCKED",
        code: "CHATGPT_COOKIES_NOT_FOUND",
        cookies_copied: 0,
        source_profile: sourceProfile
      };
    }
    const localState = await buildMergedCookieKey(sourceLocalState, targetLocalState);
    originalLocalState = localState.original;
    await writeFileAtomic5(targetLocalState, localState.merged, { fsync: true, mode: 384 });
    replaced = true;
    await rename3(targetCookies, displacedCookies);
    await Promise.all(["-wal", "-shm"].map((suffix) => rm5(`${targetCookies}${suffix}`, { force: true })));
    await rename3(candidate, targetCookies);
    if (process.platform !== "win32") await chmod3(targetCookies, 384);
    const manager = new ProfileManager({ sourceProfilePath: seed }, oracleHome);
    const id = `cookie-recovery-${Date.now()}-${randomUUID4()}`;
    const copied = await manager.createSession(id);
    let auth;
    try {
      auth = await (options.validateProfile ?? ((profile) => preflightCopiedProfile(profile, options.chromePath)))(copied);
    } finally {
      await manager.removeProfile(id);
    }
    const loginRecovered = auth.ok;
    if (!loginRecovered) {
      await restoreCookieFiles(
        targetCookies,
        originalCookies,
        originalSidecars,
        originalLocalState,
        targetLocalState
      );
      replaced = false;
      return {
        schema: "codex.chatgpt.auth-cookie-recovery/v1",
        ok: false,
        status: "BLOCKED",
        code: "IMPORTED_COOKIES_REJECTED",
        cookies_copied: count,
        source_profile: sourceProfile,
        auth
      };
    }
    replaced = false;
    return {
      schema: "codex.chatgpt.auth-cookie-recovery/v1",
      ok: true,
      status: "RECOVERED",
      code: "LOGIN_RECOVERED",
      cookies_copied: count,
      source_profile: sourceProfile,
      auth
    };
  } catch (error) {
    try {
      if (replaced && originalLocalState) {
        await restoreCookieFiles(
          targetCookies,
          originalCookies,
          originalSidecars,
          originalLocalState,
          targetLocalState
        );
      } else if (originalLocalState) {
        await writeFileAtomic5(targetLocalState, originalLocalState, { fsync: true, mode: 384 });
      }
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "COOKIE_RECOVERY_ROLLBACK_FAILED");
    }
    throw error;
  } finally {
    await rm5(work, { recursive: true, force: true });
  }
}

// src/cli/index.ts
import * as os4 from "node:os";
import * as path12 from "node:path";

// src/core/run/runtime.ts
import { createHash as createHash5, randomUUID as randomUUID5 } from "node:crypto";
import { lstat as lstat5, mkdir as mkdir8, readFile as readFile9, writeFile as writeFile2, realpath } from "node:fs/promises";
import * as path9 from "node:path";
import { execa as execa4 } from "execa";

// src/core/state/store.ts
import writeFileAtomic6 from "write-file-atomic";
import { mkdir as mkdir7, readFile as readFile8 } from "node:fs/promises";
import { dirname as dirname5, resolve as resolve8 } from "node:path";
import * as lockFile3 from "proper-lockfile";
var IMMUTABLE_FIELDS = ["run_id", "project_root", "mission_path"];
var StateStore = class {
  statePath;
  constructor(statePath) {
    this.statePath = resolve8(statePath);
  }
  async write(data, options = {}) {
    const validated = PersistentStateSchema.parse(data);
    if (validated.schema === "codex.chatgpt.oracle-workflow/v1") {
      validateWorkflowStateConsistency(validated);
    }
    await mkdir7(dirname5(this.statePath), { recursive: true });
    const release = await lockFile3.lock(this.statePath, {
      realpath: false,
      retries: { retries: 20, minTimeout: 5, maxTimeout: 50 },
      stale: 3e4,
      update: 1e4
    });
    try {
      const current = await this.readIfPresent();
      if (current) {
        this.assertUpdateAllowed(current, validated, options);
      }
      await writeFileAtomic6(this.statePath, `${JSON.stringify(validated, null, 2)}
`, {
        fsync: true
      });
    } finally {
      await release();
    }
  }
  async read() {
    const raw = await readFile8(this.statePath, "utf8");
    const parsed = PersistentStateSchema.parse(JSON.parse(raw));
    if (parsed.schema === "codex.chatgpt.oracle-workflow/v1") {
      validateWorkflowStateConsistency(parsed);
    }
    return parsed;
  }
  async readIfPresent() {
    try {
      return await this.read();
    } catch (error) {
      if (error.code === "ENOENT") return void 0;
      throw error;
    }
  }
  assertUpdateAllowed(current, next, options) {
    if (current.schema !== next.schema) {
      throw new Error("STATE_SCHEMA_CHANGE_FORBIDDEN");
    }
    for (const field of IMMUTABLE_FIELDS) {
      if (field in current && field in next && current[field] !== next[field]) {
        throw new Error(`STATE_IDENTITY_MISMATCH: ${field}`);
      }
    }
    if (!canAdvanceSessionAuthority(current.session_authority, next.session_authority)) {
      throw new Error(
        `SESSION_AUTHORITY_REGRESSION: ${current.session_authority} -> ${next.session_authority}`
      );
    }
    if (current.session_authority !== "settled" && next.session_authority === "settled" && options.explicitSettle !== true) {
      throw new Error("EXPLICIT_SETTLE_EVIDENCE_REQUIRED");
    }
    if (current.task_outcome !== "pending" && current.task_outcome !== next.task_outcome) {
      throw new Error("TASK_OUTCOME_MUTATED");
    }
    if (current.schema === "codex.chatgpt.oracle-run-state/v1" && next.schema === "codex.chatgpt.oracle-run-state/v1" && current.oracle?.slug && next.oracle?.slug !== current.oracle.slug) {
      throw new Error("EXACT_SLUG_MUTATED");
    }
    if (current.schema === "codex.chatgpt.oracle-workflow/v1" && next.schema === "codex.chatgpt.oracle-workflow/v1") {
      if (next.revision < current.revision) throw new Error("SEMANTIC_REVISION_REGRESSION");
      if (next.receipts.length < current.receipts.length) throw new Error("RECEIPT_HISTORY_TRUNCATED");
      current.receipts.forEach((receipt, index) => {
        if (JSON.stringify(receipt) !== JSON.stringify(next.receipts[index])) {
          throw new Error("RECEIPT_HISTORY_MUTATED");
        }
      });
    }
  }
};

// src/core/run/runtime.ts
var sha = (b) => createHash5("sha256").update(b).digest("hex");
async function exactDir(p) {
  const s = await lstat5(p).catch(() => void 0);
  if (!s?.isDirectory() || s.isSymbolicLink()) throw new Error("PROJECT_ROOT_INVALID");
  return await realpath(p);
}
async function exactFile(p) {
  const s = await lstat5(p).catch(() => void 0);
  if (!s?.isFile() || s.isSymbolicLink()) throw new Error("MISSION_PATH_INVALID");
  const b = await readFile9(p);
  new TextDecoder("utf-8", { fatal: true }).decode(b);
  return b;
}
async function runOracle(options) {
  const root = await exactDir(options.projectRoot);
  const requestedMission = path9.resolve(options.missionPath);
  const requestedRel = path9.relative(path9.resolve(options.projectRoot), requestedMission);
  if (requestedRel === ".." || requestedRel.startsWith(`..${path9.sep}`) || path9.isAbsolute(requestedRel)) throw new Error("MISSION_ROOT_MISMATCH");
  const requestedStat = await lstat5(requestedMission).catch(() => void 0);
  if (!requestedStat?.isFile() || requestedStat.isSymbolicLink()) throw new Error("MISSION_PATH_INVALID");
  const mission = await realpath(requestedMission).catch(() => {
    throw new Error("MISSION_PATH_INVALID");
  });
  const rel = path9.relative(root, mission);
  if (rel === ".." || rel.startsWith(`..${path9.sep}`) || path9.isAbsolute(rel)) throw new Error("MISSION_ROOT_MISMATCH");
  const bytes = await exactFile(mission);
  const runId = options.runId ?? `run-${randomUUID5()}`;
  let manifest;
  if (options.manifestPath) {
    const mp = path9.resolve(options.manifestPath);
    const ms = await lstat5(mp).catch(() => void 0);
    if (!ms?.isFile() || ms.isSymbolicLink()) throw new Error("MANIFEST_PATH_INVALID");
    manifest = OracleManifestSchema.parse(JSON.parse(await readFile9(await realpath(mp), "utf8")));
    if (path9.resolve(manifest.project_root) !== root || path9.resolve(manifest.mission_path) !== mission) throw new Error("MANIFEST_BINDING_MISMATCH");
  }
  const dir = path9.resolve(options.runRoot ?? path9.join(root, ".awgpt", runId));
  await mkdir8(path9.dirname(dir), { recursive: true });
  await mkdir8(dir, { recursive: false }).catch((e) => {
    if (e.code === "EEXIST") throw new Error("RUN_ID_COLLISION");
    throw e;
  });
  const statePath = path9.join(dir, "state.json");
  const workflowPath = path9.join(dir, "workflow.json");
  const stateStore = new StateStore(statePath);
  const slug = `run-${sha(bytes).slice(0, 4)}-${sha(runId).slice(0, 4)}-${sha(root).slice(0, 4)}`;
  const command = options.oracleCommand ?? (process.platform === "win32" ? ["npx.cmd", "--yes", "@steipete/oracle@0.17.1"] : ["npx", "--yes", "@steipete/oracle@0.17.1"]);
  const versionCheck = await execa4(command[0], [...command.slice(1), ...options.oracleArgs ?? [], "--version"], { cwd: root, shell: false, reject: false });
  if (versionCheck.exitCode !== 0 || !/\b0\.17\.1\b/.test(`${versionCheck.stdout}
${versionCheck.stderr}`)) throw new Error("ORACLE_VERSION_UNSUPPORTED");
  const outputPath = path9.join(dir, "output.md");
  const initial = { schema: "codex.chatgpt.oracle-run-state/v1", run_id: runId, project_root: root, mission_path: mission, mission_sha256: sha(bytes), mission: { path: mission, sha256: sha(bytes) }, mode: "browser", session_authority: "pre_submit", transport_status: "pending", task_outcome: "pending", oracle: { resolved_version: "0.17.1", session_locator: slug, slug, command } };
  const lock4 = new LockManager({ projectRoot: root });
  const release = await lock4.acquire();
  let retainLock = false;
  try {
    await stateStore.write(initial);
    const wfBase = { schema: "codex.chatgpt.oracle-workflow/v1", run_id: runId, project_root: root, mission_path: mission, profile: "default", stage: "plan", session_authority: "pre_submit", task_outcome: "pending", revision: 0, receipts: [] };
    await new StateStore(workflowPath).write(wfBase);
    const preSubmitFailure = async (reason) => {
      const failed = { ...initial, session_authority: "settled", transport_status: "failed", task_outcome: "NOT_EXECUTED" };
      const receipt2 = { receipt_id: randomUUID5(), run_id: runId, stage: "plan", status: "failed", input_sha256: sha(bytes), output_sha256: sha(reason), previous_receipt_sha256: null, next_stage: "attention_required", prologue: { project_root: root, mission_sha256: sha(bytes), profile: "default", semantic_revision: 0 }, external_actions: [{ kind: "devspace", status: "failed" }], recovery: { session_authority: "settled", attempt: 0, exact_slug: slug } };
      await new StateStore(workflowPath).write({ ...wfBase, stage: "attention_required", session_authority: "settled", task_outcome: "NOT_EXECUTED", receipts: [receipt2] }, { explicitSettle: true });
      await stateStore.write(failed, { explicitSettle: true });
      return { statePath, state: failed };
    };
    if (options.devspace) {
      const q = await options.devspace.qualify(root, options.manifestPath);
      if (!q.ok) return await preSubmitFailure(q.reason ?? "QUALIFICATION_FAILED");
    }
    if (options.localGate) {
      const gate = await execa4(options.localGate[0], options.localGate.slice(1), { cwd: root, shell: false, reject: false });
      if (gate.exitCode !== 0) return await preSubmitFailure("LOCAL_GATE_FAILED");
    }
    const args = [
      ...command.slice(1),
      "--engine",
      "browser",
      "--slug",
      slug,
      "--prompt",
      bytes.toString("utf8"),
      "--write-output",
      outputPath,
      ...manifest?.model ? ["--model", manifest.model] : [],
      ...manifest?.model_strategy ? ["--model-strategy", manifest.model_strategy] : [],
      ...manifest?.research ? ["--research", manifest.research] : [],
      ...manifest?.archive ? ["--archive", manifest.archive] : [],
      ...manifest?.copy_profile ? ["--copy-profile", manifest.copy_profile] : [],
      ...(manifest?.attachments ?? []).flatMap((a) => ["--attachment", a]),
      ...options.oracleArgs ?? []
    ];
    const child = execa4(command[0], args, { cwd: root, shell: false, reject: false, env: { ...process.env, ...options.oracleHome ? { ORACLE_HOME: options.oracleHome } : {} } });
    await stateStore.write({ ...initial, session_authority: "submitted_unknown", transport_status: "pending", process: child.pid ? { pid: child.pid, command: command[0], args } : void 0 }, { explicitSettle: false });
    const registry = new ProcessRegistry(path9.join(dir, "processes.json"));
    if (child.pid) await registry.upsert({ id: runId, pid: child.pid, command: command[0], args, cwd: root, project_root: root, run_id: runId, started_at: (/* @__PURE__ */ new Date()).toISOString(), state: "running" });
    const out = await child;
    if (child.pid) {
      const rec = (await registry.list()).find((r) => r.id === runId);
      if (rec) await registry.upsert({ ...rec, state: "exited" });
    }
    const stdout = out.stdout ?? "";
    const stderr = out.stderr ?? "";
    await writeFile2(path9.join(dir, "stdout.log"), stdout);
    await writeFile2(path9.join(dir, "stderr.log"), stderr);
    const durable = await readFile9(outputPath).catch(() => Buffer.from(""));
    let outcome = "pending";
    let authority = out.exitCode === 0 ? "terminal_observed" : "submitted_unknown";
    if (out.exitCode === 0) {
      try {
        outcome = parseTaskOutcome(durable.toString("utf8")).outcome;
      } catch {
        authority = "submitted_unknown";
      }
    }
    if (out.exitCode === 0 && durable.length === 0) authority = "submitted_unknown";
    await writeFile2(path9.join(dir, "transcript.md"), stdout);
    if (authority === "terminal_observed" && outcome !== "pending") authority = "settled";
    retainLock = ["submitted_unknown", "live", "terminal_observed"].includes(authority);
    const state = { ...initial, session_authority: authority, transport_status: authority === "settled" || authority === "terminal_observed" ? "complete" : out.exitCode === 0 ? "pending" : "failed", task_outcome: outcome, process: child.pid ? { pid: child.pid, command: command[0], args } : void 0, artifacts: { output: outputPath, transcript: path9.join(dir, "transcript.md"), stdout: path9.join(dir, "stdout.log"), stderr: path9.join(dir, "stderr.log"), browser_temp: dir } };
    const settled = authority === "settled";
    const outputSha = sha(durable);
    const receipt = { receipt_id: randomUUID5(), run_id: runId, stage: "plan", status: settled ? "completed" : "failed", input_sha256: sha(bytes), output_sha256: outputSha, previous_receipt_sha256: null, next_stage: settled ? "complete" : "attention_required", prologue: { project_root: root, mission_sha256: sha(bytes), profile: "default", semantic_revision: 0 }, external_actions: [{ kind: "oracle", status: settled ? "completed" : "failed" }], recovery: { session_authority: authority, attempt: 0, exact_slug: slug } };
    await new StateStore(workflowPath).write({ ...wfBase, stage: receipt.next_stage, session_authority: authority, task_outcome: outcome, receipts: [receipt] }, { explicitSettle: settled });
    await stateStore.write(state, { explicitSettle: authority === "settled" });
    return { statePath, state };
  } finally {
    if (!retainLock) await release();
  }
}
async function loadRunState(statePath) {
  return OracleRunStateSchema.parse(JSON.parse(await readFile9(path9.resolve(statePath), "utf8")));
}
async function stopRecorded(statePath) {
  const state = await loadRunState(statePath);
  if (!["live", "submitted_unknown"].includes(state.session_authority)) throw new Error("STOP_UNSAFE_AUTHORITY");
  const registry = new ProcessRegistry(path9.join(path9.dirname(path9.resolve(statePath)), "processes.json"));
  const records = (await registry.list()).filter((r) => r.run_id === state.run_id && path9.resolve(r.project_root ?? "") === path9.resolve(state.project_root) && r.state === "running");
  let record = records[0];
  if (records.length === 0 && state.process) {
    const p = state.process;
    let startedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (process.platform !== "win32") {
      const probe = await execa4("ps", ["-p", String(p.pid), "-o", "lstart="], { reject: false });
      if (probe.exitCode !== 0 || !probe.stdout.trim()) throw new Error("STOP_OWNERSHIP_AMBIGUOUS");
      const observed = Date.parse(probe.stdout.trim());
      if (!Number.isFinite(observed)) throw new Error("STOP_OWNERSHIP_AMBIGUOUS");
      startedAt = new Date(observed).toISOString();
    }
    record = {
      id: state.run_id,
      pid: p.pid,
      command: p.command,
      args: p.args,
      cwd: state.project_root,
      project_root: state.project_root,
      run_id: state.run_id,
      started_at: startedAt,
      state: "running"
    };
  }
  if (!record || records.length > 1) throw new Error("STOP_OWNERSHIP_AMBIGUOUS");
  await terminatePersistedProcess(record);
  const settled = { ...state, session_authority: "settled", transport_status: "failed" };
  await new StateStore(path9.resolve(statePath)).write(settled, { explicitSettle: true });
}

// src/core/forensics/no-submission.ts
import { createHash as createHash6 } from "node:crypto";
import { lstat as lstat6, readFile as readFile10, readdir as readdir4 } from "node:fs/promises";
import * as path10 from "node:path";
var PROMPT_NOT_OBSERVED = "Prompt did not appear in conversation before timeout (send may have failed)";
var NO_LIVE_TAB = "No live ChatGPT tab matched session";
var NO_RECOVERABLE_URL = "session metadata has no recoverable ChatGPT conversation URL";
var RECOVERY_STATE = /^\s*State:\s*[a-z][a-z0-9_-]*\s*$/im;
function sha2562(bytes) {
  return createHash6("sha256").update(bytes).digest("hex");
}
async function exactRegularFile(candidate, expected) {
  if (path10.resolve(candidate) !== path10.resolve(expected)) return void 0;
  try {
    const stat = await lstat6(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return void 0;
    return await readFile10(candidate);
  } catch {
    return void 0;
  }
}
function exactlyOne(text, pattern) {
  const matches = [...text.matchAll(pattern)];
  return matches.length === 1 ? matches[0][1] : void 0;
}
function isWithin(root, candidate) {
  const relative5 = path10.relative(root, candidate);
  return Boolean(relative5) && !relative5.startsWith("..") && !path10.isAbsolute(relative5);
}
async function proveNoSubmission(statePath) {
  const absoluteState = path10.resolve(statePath);
  const runDir = path10.dirname(absoluteState);
  const stateStat = await lstat6(absoluteState).catch(() => void 0);
  if (!stateStat?.isFile() || stateStat.isSymbolicLink()) return void 0;
  let raw;
  try {
    raw = JSON.parse(await readFile10(absoluteState, "utf8"));
  } catch {
    return void 0;
  }
  const parsed = OracleSessionStateSchema.safeParse(raw);
  if (!parsed.success) return void 0;
  const state = parsed.data;
  if (!["pre_submit", "submitted_unknown"].includes(state.session_authority)) return void 0;
  if (state.terminal_harvested === true) return void 0;
  const oracle = state.oracle ?? {};
  const locator = String(oracle.session_locator ?? oracle.slug ?? "").trim();
  const conversationUrl = String(oracle.conversation_url ?? "").trim();
  if (!locator || conversationUrl) return void 0;
  const artifacts = state.artifacts ?? {};
  const outputPath = String(artifacts.output ?? path10.join(runDir, "output.md"));
  if (path10.resolve(outputPath) !== path10.join(runDir, "output.md")) return void 0;
  const outputStat = await lstat6(outputPath).catch(() => void 0);
  if (outputStat?.isSymbolicLink() || outputStat?.isFile() && outputStat.size > 0) return void 0;
  const stdoutPath = String(artifacts.stdout ?? "");
  const stderrPath = String(artifacts.stderr ?? "");
  const stdout = await exactRegularFile(stdoutPath, path10.join(runDir, "stdout.log"));
  const stderr = await exactRegularFile(stderrPath, path10.join(runDir, "stderr.log"));
  if (!stdout || !stderr) return void 0;
  let stdoutText;
  try {
    stdoutText = new TextDecoder("utf-8", { fatal: true }).decode(stdout);
    new TextDecoder("utf-8", { fatal: true }).decode(stderr);
  } catch {
    return void 0;
  }
  if (!stdoutText.includes(PROMPT_NOT_OBSERVED) || !stdoutText.includes(`Session: ${locator}`)) {
    return void 0;
  }
  const mission = state.mission;
  const transportPath = String(mission.transport_path ?? "");
  const missionBytes = await exactRegularFile(transportPath, path10.join(runDir, "mission.md"));
  if (!missionBytes || sha2562(missionBytes) !== mission.sha256) return void 0;
  let missionText;
  try {
    missionText = new TextDecoder("utf-8", { fatal: true }).decode(missionBytes);
  } catch {
    return void 0;
  }
  const hostMarker = "[HOST_STAGE_CONTRACT]";
  const workspaceMarker = "[DEVSPACE_WORKSPACE_ENTRY_CONTRACT]";
  if (missionText.split(hostMarker).length !== 2 || missionText.split(workspaceMarker).length !== 2) return void 0;
  const hostStart = missionText.indexOf(hostMarker) + hostMarker.length;
  const workspaceStart = missionText.indexOf(workspaceMarker);
  if (workspaceStart <= hostStart) return void 0;
  const contract = missionText.slice(hostStart, workspaceStart);
  const workflowId = exactlyOne(contract, /^workflow_id=([a-f0-9]{32,64}|[a-f0-9-]{36})\r?$/gm);
  const attemptId = exactlyOne(contract, /^attempt_id=([a-f0-9]{32,64})\r?$/gm);
  const inputHash = exactlyOne(contract, /^input_mission_sha256=([a-f0-9]{64})\r?$/gm);
  const exactRoot = exactlyOne(contract, /^exact_project_root=([^\r\n]+)\r?$/gm);
  const inputMission = exactlyOne(contract, /^exact_input_mission_path=([^\r\n]+)\r?$/gm);
  const receiptPath = exactlyOne(contract, /^Write the small UTF-8 stage receipt to: ([^\r\n]+)\r?$/gm);
  if (!workflowId || !attemptId || !inputHash || !exactRoot || !inputMission || !receiptPath) return void 0;
  if (attemptId !== state.run_id || state.parallel_parent_id !== sha2562(Buffer.from(workflowId))) return void 0;
  const canonicalRoot = path10.resolve(state.project_root);
  if (path10.resolve(exactRoot) !== canonicalRoot) return void 0;
  const rootStat = await lstat6(canonicalRoot).catch(() => void 0);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return void 0;
  const sourceMissionPath = path10.resolve(String(mission.path));
  const inputMissionPath = path10.resolve(inputMission);
  const receipt = path10.resolve(receiptPath);
  if (!isWithin(canonicalRoot, sourceMissionPath) || !isWithin(canonicalRoot, inputMissionPath) || !isWithin(canonicalRoot, receipt)) return void 0;
  const sourceMission = await exactRegularFile(sourceMissionPath, sourceMissionPath);
  const inputBytes = await exactRegularFile(inputMissionPath, inputMissionPath);
  if (!sourceMission || !inputBytes || !sourceMission.equals(missionBytes) || sha2562(inputBytes) !== inputHash) return void 0;
  if (receipt !== path10.join(path10.dirname(sourceMissionPath), "stage-result.json")) return void 0;
  const names = await readdir4(runDir);
  const recoveryEvidence = [];
  for (const stdoutName of names.filter((name) => /^recovery-.+-stdout\.log$/.test(name)).sort()) {
    const stderrName = stdoutName.replace(/-stdout\.log$/, "-stderr.log");
    const recoveryStdout = await exactRegularFile(path10.join(runDir, stdoutName), path10.join(runDir, stdoutName));
    const recoveryStderr = await exactRegularFile(path10.join(runDir, stderrName), path10.join(runDir, stderrName));
    if (!recoveryStdout || !recoveryStderr) return void 0;
    let combined;
    try {
      combined = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat([recoveryStdout, Buffer.from("\n"), recoveryStderr])
      );
    } catch {
      return void 0;
    }
    if (RECOVERY_STATE.test(combined) || !combined.includes(NO_LIVE_TAB) || !combined.includes(`"${locator}"`) || !combined.includes(NO_RECOVERABLE_URL)) return void 0;
    recoveryEvidence.push({
      stdout_name: stdoutName,
      stdout_sha256: sha2562(recoveryStdout),
      stderr_name: stderrName,
      stderr_sha256: sha2562(recoveryStderr)
    });
  }
  if (recoveryEvidence.length === 0) return void 0;
  return {
    schema: "codex.chatgpt.no-submission-evidence/v1",
    run_id: state.run_id,
    project_root: state.project_root,
    oracle_locator: locator,
    mission_sha256: String(mission.sha256),
    stdout_sha256: sha2562(stdout),
    stderr_sha256: sha2562(stderr),
    recovery_evidence: recoveryEvidence,
    output_absent: true,
    conversation_url_absent: true
  };
}

// src/core/devspace/http-client.ts
import { randomUUID as randomUUID6 } from "node:crypto";
function createHttpDevSpaceClient(endpoint, fetcher = fetch) {
  const url = new URL(endpoint).toString();
  async function call(name, args) {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID6(), method: "tools/call", params: { name, arguments: args } })
    });
    if (!response.ok) throw new Error(`DEVSPACE_HTTP_${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message ?? "DEVSPACE_RPC_ERROR");
    return payload.result;
  }
  return { open_workspace: (args) => call("open_workspace", args), list_directory: (args) => call("ls", args) };
}

// src/core/orchestrator/gate-runner.ts
import { createHash as createHash7 } from "node:crypto";
import * as path11 from "node:path";
import { lstat as lstat7, realpath as realpath2 } from "node:fs/promises";
import { execa as execa5 } from "execa";
function sha2563(value) {
  return createHash7("sha256").update(value, "utf8").digest("hex");
}
function environmentHash(env) {
  const canonical = Object.keys(env).sort().map((key) => `${key}=${env[key] ?? ""}`).join("\n");
  return sha2563(canonical);
}
async function runLocalGate(request) {
  if (!Array.isArray(request.argv) || request.argv.length === 0 || request.argv.some((item) => typeof item !== "string")) {
    throw new Error("GATE_ARGV_INVALID");
  }
  const suppliedRoot = path11.resolve(request.projectRoot);
  let cwd;
  try {
    const metadata = await lstat7(suppliedRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("GATE_PROJECT_ROOT_INVALID");
    cwd = await realpath2(suppliedRoot);
  } catch {
    throw new Error("GATE_PROJECT_ROOT_INVALID");
  }
  const mergedEnv = { ...process.env, ...request.env ?? {} };
  const started = Date.now();
  try {
    const result = await execa5(request.argv[0], request.argv.slice(1), {
      cwd,
      env: mergedEnv,
      shell: false,
      reject: false,
      timeout: request.timeoutMs,
      stripFinalNewline: false
    });
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    return {
      ok: result.exitCode === 0,
      argv: [...request.argv],
      cwd,
      exit_code: result.exitCode ?? null,
      signal: result.signal ?? null,
      stdout,
      stderr,
      output_sha256: sha2563(`${stdout}\0${stderr}`),
      env_sha256: environmentHash(mergedEnv),
      duration_ms: Date.now() - started
    };
  } catch (error) {
    const execaError = error;
    const stdout = String(execaError.stdout ?? "");
    const stderr = String(execaError.stderr ?? "");
    return {
      ok: false,
      argv: [...request.argv],
      cwd,
      exit_code: typeof execaError.exitCode === "number" ? execaError.exitCode : null,
      signal: execaError.signal ?? null,
      stdout,
      stderr,
      output_sha256: sha2563(`${stdout}\0${stderr}`),
      env_sha256: environmentHash(mergedEnv),
      duration_ms: Date.now() - started
    };
  }
}
var runGate = runLocalGate;

// src/cli/index.ts
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// src/core/workspace/commands.ts
var workspaceCommands = (root) => [
  { command: "devspace", args: ["doctor", "--root", root] },
  { command: "tailscale", args: ["funnel", "status"] }
];
async function setupWorkspace(options) {
  const root = options.root?.trim();
  if (!root) throw new Error("WORKSPACE_ROOT_REQUIRED");
  const commands = workspaceCommands(root);
  const dryRun = options.apply !== true && options.dryRun !== false;
  if (dryRun) return { schema: "codex.chatgpt.workspace/v1", status: "DRY_RUN", commands };
  if (!options.runner) throw new Error("WORKSPACE_RUNNER_REQUIRED");
  const results = [];
  for (const c of commands) results.push({ ...c, result: await options.runner.run(c.command, [...c.args]) });
  return { schema: "codex.chatgpt.workspace/v1", status: results.every((r) => r.result.code === 0) ? "READY" : "BLOCKED", results };
}
var doctorWorkspace = (root, runner) => setupWorkspace({ root, runner, dryRun: runner === void 0 });

// src/cli/index.ts
var execFileAsync = promisify(execFile);
var localCommandRunner = { run: async (command, args) => {
  try {
    const result = await execFileAsync(command, args, { encoding: "utf8" });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: typeof error?.code === "number" ? error.code : 1, stdout: error?.stdout ?? "", stderr: error?.stderr ?? error?.message ?? String(error) };
  }
} };
var require2 = createRequire(import.meta.url);
var packageMetadata = {};
try {
  packageMetadata = require2("../../package.json");
} catch {
  packageMetadata = { version: "1.0.0" };
}
function publicVersion() {
  const version = packageMetadata.version;
  if (!version) throw new Error("PACKAGE_VERSION_MISSING");
  return version;
}
function publicArgv(argv = process.argv) {
  return argv.slice(2);
}
function createCLI() {
  const program2 = new Command();
  program2.name("awgpt").description("Guarded, recoverable web GPT automation").version(publicVersion());
  program2.command("local-gate").description("Run a deterministic local gate without a shell").requiredOption("--project-root <path>", "exact project root").requiredOption("--argv <value...>", "executable and arguments").option("--env <key=value...>", "environment additions").option("--timeout-ms <milliseconds>", "gate timeout").action(async (options) => {
    try {
      const env = {};
      for (const item of options.env ?? []) {
        const separator = item.indexOf("=");
        if (separator <= 0) throw new Error("GATE_ENV_INVALID");
        env[item.slice(0, separator)] = item.slice(separator + 1);
      }
      const result = await runLocalGate({
        argv: options.argv,
        projectRoot: options.projectRoot,
        env,
        timeoutMs: options.timeoutMs === void 0 ? void 0 : Number(options.timeoutMs)
      });
      console.log(JSON.stringify({ schema: "codex.chatgpt.local-gate/v1", ...result }, null, 2));
      if (!result.ok) process.exitCode = 2;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });
  program2.command("doctor").description("Check environment health").option("--project-root <path>", "exact project root", process.cwd()).option("--copy-profile <path>", "manual-login profile seed").option("--devspace-url <url>", "local DevSpace MCP probe URL").option("--oracle-home <path>", "isolated Oracle home").option("--state <path...>", "specific Oracle state files to validate").option("--recover", "emit the single safe next recovery action").option("--open-profile-login", "open a generic ChatGPT login in a new isolated profile").action(async (options) => {
    if (options.openProfileLogin) {
      const target = await prepareProfileLogin();
      await launchProfileLogin(target);
      console.log(JSON.stringify({
        schema: "codex.chatgpt.profile-login/v1",
        status: "USER_ACTION_REQUIRED",
        ...target
      }, null, 2));
      return;
    }
    const report = await runDoctor({
      projectRoot: options.projectRoot,
      copyProfilePath: options.copyProfile,
      devspaceUrl: options.devspaceUrl,
      statePaths: options.state,
      recover: options.recover,
      oracleHome: options.oracleHome
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.status === "FAIL") process.exitCode = 1;
    else if (report.status === "BLOCKED") process.exitCode = 2;
  });
  const workspace = program2.command("workspace").description("Configure and inspect the exact DevSpace workspace");
  for (const action of ["setup", "doctor"]) {
    workspace.command(action).description(action === "setup" ? "Preview workspace commands (use --apply to execute)" : "Run workspace checks").option("--root <path>", "exact project root", process.cwd()).option("--apply", "execute commands; preview is the default").action(async (options) => {
      try {
        const result = await setupWorkspace({ root: options.root, apply: Boolean(options.apply), runner: localCommandRunner });
        console.log(JSON.stringify(result, null, 2));
        if (result.status === "BLOCKED") process.exitCode = 2;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
  }
  program2.command("auth-preflight").description("Validate ChatGPT authentication and required composer DOM without submitting").requiredOption("--copy-profile <path>", "manual-login profile seed").option("--oracle-home <path>", "isolated Oracle home", path12.join(os4.homedir(), ".oracle")).option("--chrome-path <path>", "Chrome executable override").action(async (options) => {
    const manager = new ProfileManager({ sourceProfilePath: options.copyProfile }, options.oracleHome);
    const id = `preflight-${Date.now()}`;
    const copied = await manager.createSession(id);
    try {
      const result = await preflightCopiedProfile(copied, options.chromePath);
      console.log(JSON.stringify({ schema: "codex.chatgpt.auth-preflight/v1", ...result }, null, 2));
      if (!result.ok) process.exitCode = 2;
    } finally {
      await manager.removeProfile(id);
    }
  });
  program2.command("auth-recover").description("Recover the isolated login from ChatGPT cookies in the main Chrome profile").requiredOption("--copy-profile <path>", "manual-login profile seed to repair").option("--chrome-user-data <path>", "main Chrome user-data root").option("--chrome-profile <name>", "Chrome profile directory, such as Default or Profile 1").option("--oracle-home <path>", "isolated Oracle home", path12.join(os4.homedir(), ".oracle")).option("--chrome-path <path>", "Chrome executable override").action(async (options) => {
    try {
      const result = await recoverChatGptLogin({
        seedPath: options.copyProfile,
        oracleHome: options.oracleHome,
        sourceUserDataRoot: options.chromeUserData,
        sourceProfile: options.chromeProfile,
        chromePath: options.chromePath
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 2;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cookie recovery failed.";
      const rollbackFailed = message === "COOKIE_RECOVERY_ROLLBACK_FAILED";
      console.log(JSON.stringify({
        schema: "codex.chatgpt.auth-cookie-recovery/v1",
        ok: false,
        status: rollbackFailed ? "ATTENTION_REQUIRED" : "FAILED",
        code: rollbackFailed ? "COOKIE_RECOVERY_ROLLBACK_FAILED" : "COOKIE_RECOVERY_FAILED",
        message
      }, null, 2));
      process.exitCode = 1;
    }
  });
  for (const action of ["install", "update"]) {
    program2.command(action).description(`${action} repository-managed Agent Web GPT files with a receipt`).option("--source <path>", "repository source root (defaults to the installed package)").option("--agent-home <path>", "installation root", path12.join(os4.homedir(), ".codex")).action(async (options) => {
      try {
        const result = await installOrUpdate(action, options.source ?? resolvePackageSource(), options.agentHome);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.log(JSON.stringify({ schema: "codex.chatgpt.install/v1", ok: false, action, status: "FAILED", code: errorCode(error), message: error instanceof Error ? error.message : String(error) }, null, 2));
        process.exitCode = 2;
      }
    });
  }
  program2.command("rollback").description("Rollback the latest receipt without overwriting modified files").option("--agent-home <path>", "installation root", path12.join(os4.homedir(), ".codex")).option("--receipt <path>", "specific owned receipt").action(async (options) => {
    try {
      const result = await rollbackInstall(options.agentHome, options.receipt);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 2;
    } catch (error) {
      console.log(JSON.stringify({ schema: "codex.chatgpt.install/v1", ok: false, action: "rollback", status: "FAILED", code: errorCode(error), message: error instanceof Error ? error.message : String(error) }, null, 2));
      process.exitCode = 2;
    }
  });
  program2.command("run").description("Run Oracle workflow").requiredOption("--project-root <path>").requiredOption("--mission <path>").option("--run-root <path>").option("--manifest <path>").option("--oracle-command <path>").option("--oracle-arg <value...>").option("--oracle-home <path>").option("--dry-run", "validate and plan without launching Oracle").option("--devspace-url <url>", "DevSpace MCP endpoint", "http://127.0.0.1:7676/mcp").action(async (options) => {
    try {
      const client = createHttpDevSpaceClient(options.devspaceUrl);
      const devspace = { qualify: async (root) => {
        const { qualifyExactProjectRoot: qualifyExactProjectRoot2 } = await import("./qualification-PPG2UOJ3.js");
        const result = await qualifyExactProjectRoot2(root, client);
        return { ok: result.ok, reason: result.code };
      } };
      console.log(JSON.stringify(await runOracle({ projectRoot: options.projectRoot, missionPath: options.mission, runRoot: options.runRoot, manifestPath: options.manifest, oracleCommand: options.oracleCommand ? [options.oracleCommand] : void 0, oracleArgs: options.oracleArg, oracleHome: options.oracleHome, dryRun: options.dryRun === true, devspace }), null, 2));
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    }
  });
  program2.command("recover").requiredOption("--state <path>").requiredOption("--action <action>", "live or harvest").action(async (o) => {
    try {
      const plan = await planExactRecovery(o.state, o.action);
      console.log(JSON.stringify(await executeExactRecovery(plan), null, 2));
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    }
  });
  program2.command("audit").requiredOption("--state <path>").description("Prove no submission without launching Oracle").action(async (o) => {
    const evidence = await proveNoSubmission(o.state);
    console.log(JSON.stringify(evidence ?? { ok: false }, null, 2));
    if (!evidence) process.exitCode = 2;
  });
  program2.command("stop").requiredOption("--state <path>").description("Refuse unsafe stop unless state is owned and live").action(async (o) => {
    try {
      await stopRecorded(o.state);
      console.log(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    }
  });
  return program2;
}
function errorCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("ENOENT") && message.includes("install-manifest.json")) return "LIFECYCLE_MANIFEST_MISSING";
  if (message.includes("Expected") || message.includes("Invalid input") || message.includes("ZodError")) return "LIFECYCLE_MANIFEST_INVALID";
  return message.split(":", 1)[0] || "LIFECYCLE_FAILED";
}

// src/core/orchestrator/state.ts
import { z as z6 } from "zod";
var WorkflowState = z6.enum(["plan", "review", "web-multi", "pro", "implementation", "final-web-gate", "complete", "attention_required"]);
var Transition = z6.object({
  from: WorkflowState,
  to: WorkflowState
});
var workflowTransitions = [
  { from: "plan", to: "plan" },
  { from: "plan", to: "review" },
  { from: "plan", to: "web-multi" },
  { from: "plan", to: "pro" },
  { from: "pro", to: "review" },
  { from: "web-multi", to: "review" },
  { from: "review", to: "implementation" },
  { from: "implementation", to: "final-web-gate" },
  { from: "final-web-gate", to: "complete" },
  { from: "final-web-gate", to: "implementation" }
];
var validTransitions = workflowTransitions.map((t) => `${t.from}->${t.to}`);
function isValidTransition(from, to) {
  return workflowTransitions.some((t) => t.from === from && t.to === to);
}

// src/core/orchestrator/engine.ts
import { z as z7 } from "zod";
var WorkflowContextSchema = z7.object({
  workflow_id: z7.string(),
  stage: WorkflowState,
  attempt_id: z7.string(),
  input_mission_sha256: Sha256
}).strict();
var EngineReceiptSchema = z7.object({
  workflow_id: z7.string(),
  stage: WorkflowState,
  next_stage: WorkflowState,
  attempt_id: z7.string(),
  input_mission_sha256: Sha256
}).strict();
var WorkflowEngine = class {
  context;
  static TRANSITIONS = workflowTransitions;
  constructor(context) {
    this.context = WorkflowContextSchema.parse(context);
  }
  getCurrentState() {
    return this.context.stage;
  }
  canTransition(to) {
    return isValidTransition(this.getCurrentState(), to);
  }
  async transition(to) {
    if (!this.canTransition(to)) {
      throw new Error(`INVALID_WORKFLOW_TRANSITION: cannot transition ${this.context.stage} -> ${to}`);
    }
    const newContext = { ...this.context, stage: to };
    if (to === "implementation" && this.context.stage === "review") {
      newContext.stage = "implementation";
    }
    const validated = WorkflowContextSchema.parse(newContext);
    this.context = validated;
    return validated;
  }
  async applyReceipt(receiptInput) {
    const receipt = EngineReceiptSchema.parse(receiptInput);
    const { stage, next_stage, input_mission_sha256, workflow_id, attempt_id } = receipt;
    const expectedIdentity = `${this.context.workflow_id}:${this.context.stage}:${this.context.attempt_id}:${this.context.input_mission_sha256}`;
    const actualIdentity = `${workflow_id}:${stage}:${attempt_id}:${input_mission_sha256}`;
    if (actualIdentity !== expectedIdentity) {
      throw new Error("RECEIPT_IDENTITY_MISMATCH");
    }
    if (!this.canTransition(next_stage)) {
      throw new Error("INVALID_NEXT_STAGE");
    }
    await this.transition(next_stage);
    return WorkflowContextSchema.parse(this.context);
  }
};

// src/core/orchestrator/gate.ts
var StageGate = class {
  validate(input) {
    const receipt = WorkflowReceiptSchema.parse(input.receipt);
    if (receipt.run_id !== input.bindings.runId) throw new Error("GATE_RUN_ID_MISMATCH");
    if (receipt.stage !== input.bindings.currentStage) throw new Error("GATE_STAGE_MISMATCH");
    if (receipt.status !== "completed") throw new Error("GATE_STAGE_NOT_COMPLETED");
    if (receipt.prologue.project_root !== input.bindings.projectRoot) {
      throw new Error("GATE_PROJECT_ROOT_MISMATCH");
    }
    if (receipt.prologue.mission_sha256 !== input.bindings.missionSha256) {
      throw new Error("GATE_MISSION_HASH_MISMATCH");
    }
    if (receipt.prologue.profile !== input.bindings.profile) throw new Error("GATE_PROFILE_MISMATCH");
    if (receipt.prologue.semantic_revision !== input.bindings.semanticRevision) {
      throw new Error("GATE_SEMANTIC_REVISION_MISMATCH");
    }
    if (receipt.recovery.session_authority !== input.sessionAuthority) {
      throw new Error("GATE_AUTHORITY_MISMATCH");
    }
    if (!isValidTransition(receipt.stage, receipt.next_stage)) {
      throw new Error(`GATE_TRANSITION_INVALID: ${receipt.stage} -> ${receipt.next_stage}`);
    }
    validateReceiptChain([...input.previousReceipts, receipt]);
    if (receipt.next_stage === "complete") {
      if (!["terminal_observed", "settled"].includes(receipt.recovery.session_authority)) {
        throw new Error("GATE_TERMINAL_OBSERVATION_REQUIRED");
      }
      if (input.taskOutcome === "pending") throw new Error("GATE_TASK_OUTCOME_REQUIRED");
      if (!receipt.external_actions.some((action) => action.kind === "local_gate" && action.status === "completed")) {
        throw new Error("GATE_LOCAL_VERIFICATION_REQUIRED");
      }
    }
    return receipt;
  }
};

// src/core/process/supervisor.ts
import { execa as execa6 } from "execa";
import { z as z8 } from "zod";
import crypto3 from "crypto";
import * as path13 from "node:path";
var ProcessState = z8.enum(["running", "exited", "signaled", "cleaned"]);
var CAUTION_AUDIT_THRESHOLD_MS = 48e5;
var ProcessSupervisor = class {
  constructor(registry) {
    this.registry = registry;
  }
  registry;
  processes = /* @__PURE__ */ new Map();
  states = /* @__PURE__ */ new Map();
  async start(config, id) {
    const processId = id ?? crypto3.randomUUID();
    const proc = execa6(config.command, config.args, {
      cwd: config.cwd,
      maxBuffer: config.maxBuffer,
      killSignal: "SIGTERM",
      windowsHide: true,
      detached: process.platform !== "win32"
    });
    const processInfo = {
      pid: proc.pid ?? 0,
      state: "running",
      startedAt: /* @__PURE__ */ new Date()
    };
    const bindExit = ({ exitCode, signal }) => {
      if (this.states.get(processId)?.state === "cleaned") return;
      const next = {
        ...processInfo,
        state: signal ? "signaled" : "exited",
        exitCode,
        signal,
        exitedAt: /* @__PURE__ */ new Date()
      };
      this.states.set(processId, next);
      if (this.registry) {
        void this.registry.list().then((records) => {
          const record = records.find((item) => item.id === processId);
          if (record) return this.registry.upsert({ ...record, state: next.state });
        });
      }
    };
    proc.then((result) => bindExit({
      exitCode: result.exitCode,
      signal: result.signal
    })).catch((error) => {
      bindExit({ exitCode: error.exitCode, signal: error.signal });
    });
    this.processes.set(processId, proc);
    this.states.set(processId, processInfo);
    if (this.registry && processInfo.pid > 0) {
      await this.registry.upsert({
        id: processId,
        pid: processInfo.pid,
        command: config.command,
        args: config.args,
        cwd: config.cwd ?? process.cwd(),
        started_at: processInfo.startedAt.toISOString(),
        project_root: config.projectRoot ? path13.resolve(config.projectRoot) : void 0,
        state: "running",
        run_id: config.runId,
        exact_slug: config.exactSlug
      });
      const latest = this.states.get(processId);
      if (latest && latest.state !== "running") {
        const record = (await this.registry.list()).find((item) => item.id === processId);
        if (record) await this.registry.upsert({ ...record, state: latest.state });
      }
    }
    return processId;
  }
  getState(id) {
    return this.states.get(id);
  }
  async stop(id) {
    const proc = this.processes.get(id);
    if (!proc) return;
    const state = this.states.get(id);
    if (!state || state.state !== "running") return;
    const gracefulSignalAccepted = await this.signalTree(proc, "SIGTERM");
    let exited = false;
    if (gracefulSignalAccepted) {
      await Promise.race([
        proc.then(() => {
          exited = true;
        }).catch(() => {
          exited = true;
        }),
        new Promise((resolve13) => setTimeout(resolve13, 5e3))
      ]);
    }
    if (!gracefulSignalAccepted || !exited || this.processGroupIsAlive(state.pid)) {
      await this.signalTree(proc, "SIGKILL");
    }
    await proc.catch(() => void 0);
    if (this.processGroupIsAlive(state.pid)) {
      throw new Error(`PROCESS_TREE_STILL_ALIVE: ${state.pid}`);
    }
    this.states.set(id, {
      ...state,
      state: "cleaned",
      exitedAt: /* @__PURE__ */ new Date()
    });
    if (this.registry) {
      const record = (await this.registry.list()).find((item) => item.id === id);
      if (record) await this.registry.upsert({ ...record, state: "cleaned" });
    }
  }
  async stopAll() {
    for (const id of this.processes.keys()) {
      await this.stop(id);
    }
  }
  async cleanupStale(now = Date.now(), auditThresholdMs = CAUTION_AUDIT_THRESHOLD_MS) {
    const stale = [];
    for (const [id, state] of this.states) {
      if (state.state === "running" && now - state.startedAt.getTime() >= auditThresholdMs) {
        stale.push(id);
      }
    }
    return stale;
  }
  async signalTree(proc, signal) {
    const pid = proc.pid;
    if (!pid) throw new Error("PROCESS_PID_UNAVAILABLE");
    if (process.platform === "win32") {
      const args = ["/PID", String(pid), "/T"];
      if (signal === "SIGKILL") args.push("/F");
      try {
        await execa6("taskkill", args, { windowsHide: true });
      } catch (error) {
        if (signal === "SIGTERM") return false;
        if (this.pidIsAlive(pid)) throw error;
      }
      return true;
    }
    try {
      process.kill(-pid, signal);
    } catch (error) {
      const code = error.code;
      if (code !== "ESRCH") throw error;
    }
    return true;
  }
  processGroupIsAlive(pid) {
    if (process.platform === "win32" || pid <= 0) return false;
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  }
  pidIsAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  }
};

// src/core/context/packer.ts
import { readFile as readFile11 } from "node:fs/promises";
async function packContext(inputs, maxBytes = 2e5) {
  const files = [];
  let used = 0;
  for (const input of inputs) {
    const content = await readFile11(input.path, "utf8");
    const bytes = Buffer.byteLength(content);
    if (used + bytes > maxBytes) break;
    files.push({ path: input.path, content });
    used += bytes;
  }
  const text = files.map((f) => `## ${f.path}

${f.content}`).join("\n\n");
  return { schema: "codex.chatgpt.context/v1", files, text };
}

// src/core/diagnostics/incident.ts
function diagnoseIncident(evidence) {
  return { schema: "codex.chatgpt.incident/v1", status: evidence.length ? "ATTENTION_REQUIRED" : "HEALTHY", evidence };
}

// src/core/orchestration/config.ts
var comprehensiveConfig = (lanes = 1) => ({ kind: "comprehensive", lanes, runtime: "common-run" });
var multiConfig = (lanes = 2) => ({ kind: "multi", lanes, runtime: "common-run" });

// src/index.ts
var program = createCLI();
await program.parseAsync(process.argv);
export {
  CAUTION_AUDIT_THRESHOLD_MS,
  DoctorCheck,
  DoctorReport,
  EngineReceiptSchema,
  LockManager,
  OracleManifestSchema,
  OracleRunStateSchema,
  OracleSessionStateSchema,
  PersistedProcessSchema,
  PersistentStateSchema,
  PosixFileLockAdapter,
  ProcessRegistry,
  ProcessState,
  ProcessSupervisor,
  ProfileConfig,
  ProfileManager,
  ProjectLockHeldError,
  SessionAuthority,
  Sha256,
  StageGate,
  StageStatus,
  StateStore,
  TaskOutcome,
  Transition,
  WindowsFileLockAdapter,
  WorkflowContextSchema,
  WorkflowEngine,
  WorkflowProfile,
  WorkflowReceiptSchema,
  WorkflowRunStateSchema,
  WorkflowStage,
  WorkflowState,
  auditOracleState,
  canAdvanceSessionAuthority,
  checkDevSpace,
  checkProfile,
  comprehensiveConfig,
  createCLI,
  createHttpDevSpaceClient,
  createLockAdapter,
  defaultChromeUserDataRoot,
  diagnoseIncident,
  doctorWorkspace,
  evaluateAuthSnapshot,
  executeExactRecovery,
  installOrUpdate,
  isValidTransition,
  launchProfileLogin,
  manifestFiles,
  manifestVersion,
  multiConfig,
  normalizeOracleSessionAuthority,
  packContext,
  parseTaskOutcome,
  pidIsAlive,
  planExactRecovery,
  preflightCopiedProfile,
  prepareProfileLogin,
  probeBrowserAuth,
  proveNoSubmission,
  publicArgv,
  publicVersion,
  qualifyExactProjectRoot,
  readInstallManifest,
  receiptSha256,
  recoverChatGptLogin,
  recoverPendingInstalls,
  recoveryArgv,
  resolvePackageSource,
  rollbackInstall,
  runDoctor,
  runGate,
  runLocalGate,
  sessionAuthorityTransitions,
  setupWorkspace,
  terminatePersistedProcess,
  validTransitions,
  validateReceiptChain,
  validateWorkflowStateConsistency,
  workflowTransitions,
  workspaceCommands
};
//# sourceMappingURL=index.js.map