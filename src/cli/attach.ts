import { readFileSync } from 'node:fs';
import { loadStatuses } from '../specialist/status-load.js';
import type { ChatState } from './chat/control.js';

interface JobStatus {
  status?: ChatState;
  bead_id?: string;
  specialist?: string;
  fifo_path?: string;
}

interface AttachTarget {
  id: string;
  status: JobStatus['status'];
  specialist: string;
  beadId?: string;
  fifoPath?: string;
  terminal: boolean;
}

export interface AttachRuntimeDeps {
  runTui?: (target: AttachTarget) => Promise<void>;
}

function exitWithError(message: string): never {
  console.error(message);
  process.exit(1);
}

function isTerminalStatus(status?: string): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled';
}

function toTarget(status: { id: string; status: ChatState; specialist?: string; bead_id?: string; fifo_path?: string }): AttachTarget {
  return {
    id: status.id,
    status: status.status,
    specialist: status.specialist ?? 'job',
    beadId: status.bead_id,
    fifoPath: status.fifo_path,
    terminal: isTerminalStatus(status.status),
  };
}

function loadTarget(jobId: string): AttachTarget {
  const status = loadStatuses().find((item) => item.id === jobId);
  if (!status) exitWithError(`Job \`${jobId}\` not found. Run \`specialists status\` to see active jobs in current mode.`);
  return toTarget(status);
}

function loadTargets(): AttachTarget[] {
  return loadStatuses()
    .map(toTarget)
    .sort((left, right) => priorityOf(left.status) - priorityOf(right.status) || left.id.localeCompare(right.id));
}

function priorityOf(status?: string): number {
  if (status === 'running') return 0;
  if (status === 'waiting') return 1;
  if (status === 'starting') return 2;
  if (status === 'done') return 3;
  if (status === 'error') return 4;
  if (status === 'cancelled') return 5;
  return 6;
}

function pickTarget(targets: AttachTarget[]): AttachTarget {
  console.log('Attach job:');
  for (const [index, target] of targets.entries()) {
    console.log(`  ${index + 1}. ${target.id}  ${target.specialist}  ${target.status}`);
  }
  const input = readFileSync(0, 'utf8').trim();
  const choice = Number(input);
  if (!Number.isInteger(choice) || choice < 1 || choice > targets.length) exitWithError('Invalid selection.');
  return targets[choice - 1]!;
}

export async function run(deps: AttachRuntimeDeps = {}): Promise<void> {
  const [jobId] = process.argv.slice(3);
  if (!jobId) {
    if (!process.stdout.isTTY || !process.stdin.isTTY) exitWithError('Usage: specialists attach <job-id>');
    const targets = loadTargets();
    if (targets.length === 0) exitWithError('No jobs found. Run `specialists status` to see active jobs in current mode.');
    return attachTarget(pickTarget(targets), deps);
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) exitWithError('Usage: specialists attach <job-id>');
  return attachTarget(loadTarget(jobId), deps);
}

async function attachTarget(target: AttachTarget, deps: AttachRuntimeDeps): Promise<void> {
  const runTui = deps.runTui ?? (async (resolvedTarget: AttachTarget) => {
    const { run } = await import('./attach-tui.js');
    return run(resolvedTarget, deps);
  });
  return runTui(target);
}
