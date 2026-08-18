#!/usr/bin/env node

import { createCLI } from './cli/index.js';
export * from './cli/index.js';
export * from './cli/doctor.js';
export * from './cli/lifecycle.js';
export * from './types/index.js';
export * from './core/state/store.js';
export * from './core/state/locks.js';
export * from './core/state/lock-adapter.js';
export * from './core/orchestrator/state.js';
export * from './core/orchestrator/engine.js';
export * from './core/orchestrator/gate.js';
export * from './core/orchestrator/gate-runner.js';
export * from './core/process/supervisor.js';
export * from './core/process/profiles.js';
export * from './core/process/cookie-recovery.js';
export * from './core/process/auth-preflight.js';
export * from './core/process/registry.js';
export * from './core/forensics/no-submission.js';
export * from './core/forensics/recovery.js';
export * from './core/context/packer.js';
export * from './core/workspace/commands.js';
export * from './core/diagnostics/incident.js';
export * from './core/orchestration/config.js';

const program = createCLI();
await program.parseAsync(process.argv);
