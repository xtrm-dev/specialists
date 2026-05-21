import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Supervisor } from './supervisor.js';
import type { SpecialistLoader } from './loader.js';
import type { HookEmitter } from './hooks.js';
import type { CircuitBreaker } from '../utils/circuitBreaker.js';
import type { BeadsClient as BeadsClientType } from './beads.js';
import type { RunArgs } from '../cli/run.js';
import type { SpecialistRecord } from './schema.js';
import { SpecialistRunner } from './runner.js';

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

export interface LaunchSpecialistOptions {
  args: RunArgs;
  specialist: SpecialistRecord;
  loader: SpecialistLoader;
  hooks: HookEmitter;
  circuitBreaker: CircuitBreaker;
  beadsClient?: BeadsClientType;
  workingDirectory?: string;
  reusedFromJobId?: string;
  worktreeOwnerJobId?: string;
  effectiveBeadId?: string;
  prompt: string;
  variables?: Record<string, string>;
  epicId?: string;
  beadsWriteNotes: boolean;
  perm: 'READ_ONLY' | 'LOW' | 'MEDIUM' | 'HIGH';
  jobsDir: string;
  stopTailer?: (() => void) | undefined;
  startEventTailer: (jobId: string, jobsDir: string) => (() => void) | undefined;
  formatFooterModel: (backend?: string, model?: string) => string;
}

export async function launchSpecialist(opts: LaunchSpecialistOptions): Promise<void> {
  const runner = new SpecialistRunner({
    loader: opts.loader,
    hooks: opts.hooks,
    circuitBreaker: opts.circuitBreaker,
    beadsClient: opts.beadsClient,
  });

  const supervisor = new Supervisor({
    runner,
    runOptions: {
      name: opts.args.name,
      prompt: opts.prompt,
      variables: opts.variables,
      backendOverride: opts.args.model,
      inputBeadId: opts.effectiveBeadId,
      epicId: opts.epicId,
      keepAlive: opts.args.keepAlive,
      noKeepAlive: opts.args.noKeepAlive,
      beadsWriteNotes: opts.beadsWriteNotes,
      forceJob: opts.args.forceJob,
      permissionRequired: opts.perm,
      workingDirectory: opts.workingDirectory,
      reusedFromJobId: opts.reusedFromJobId,
      worktreeOwnerJobId: opts.worktreeOwnerJobId,
    },
    beadsClient: opts.beadsClient,
    stallDetection: opts.specialist.specialist.stall_detection,
    onProgress: opts.args.outputMode === 'raw' ? (delta) => process.stdout.write(delta) : undefined,
    onMeta: opts.args.outputMode !== 'human'
      ? (meta) => process.stderr.write(dim(`\n[${meta.backend} / ${meta.model}]\n\n`))
      : undefined,
    onJobStarted: ({ id }) => {
      process.stderr.write(dim(`[job started: ${id}]\n`));
      const handoffPath = process.env.SPECIALISTS_BG_JOB_ID_PATH;
      if (handoffPath) {
        try { writeFileSync(handoffPath, `${id}\n`, 'utf-8'); } catch { /* best effort */ }
      }
      if (opts.args.outputMode !== 'raw') {
        opts.stopTailer = opts.startEventTailer(id, opts.jobsDir);
      }
    },
  });

  if (opts.effectiveBeadId && opts.workingDirectory) {
    try {
      execSync(`bd kv set "bead-claim:${opts.effectiveBeadId}" "active"`, {
        cwd: opts.workingDirectory,
        stdio: 'pipe',
        timeout: 5000,
      });
    } catch {
      // Non-fatal — edit gate falls back to in_progress check.
    }
  }

  process.stderr.write(`\n${bold(`Running ${cyan(opts.args.name)}`)}\n\n`);

  let jobId = '';
  let runError: unknown;
  try {
    jobId = await supervisor.run();
  } catch (error: any) {
    runError = error;
    opts.stopTailer?.();
  }

  opts.stopTailer?.();

  if (opts.effectiveBeadId && opts.workingDirectory) {
    try {
      execSync(`bd kv clear "bead-claim:${opts.effectiveBeadId}"`, {
        cwd: opts.workingDirectory,
        stdio: 'pipe',
        timeout: 5000,
      });
    } catch {
      // Non-fatal — stale claim will be overwritten on next run.
    }
  }

  if (runError) {
    const message = runError instanceof Error ? runError.message : String(runError);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  }

  const status = supervisor.readStatus(jobId);
  const secs = ((status?.last_event_at_ms ?? Date.now()) - (status?.started_at_ms ?? Date.now())) / 1000;
  const modelLabel = opts.formatFooterModel(status?.backend, status?.model);
  const footer = [
    `job ${jobId}`,
    status?.bead_id ? `bead ${status.bead_id}` : '',
    `${secs.toFixed(1)}s`,
    modelLabel ? dim(modelLabel) : '',
  ].filter(Boolean).join('  ');

  process.stderr.write(`\n${green('✓')} ${footer}\n\n`);
  process.stderr.write(dim(`Status: specialists ps ${jobId} --json`) + '\n');
  process.stderr.write(dim(`Events: specialists feed ${jobId}`) + '\n\n');
  process.exit(0);
}
