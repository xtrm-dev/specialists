import { appendFile } from 'node:fs/promises';
import type { SupervisorStatus } from '../../specialist/supervisor.js';
import { Supervisor } from '../../specialist/supervisor.js';
import { resolveJobsDir } from '../../specialist/job-root.js';
import { BeadsClient } from '../../specialist/beads.js';
import { JobControl } from '../../specialist/job-control.js';

const SLASH_COMMANDS = new Set(['stop', 'finalize', 'notes', 'show', 'quit']);

export type ChatState = SupervisorStatus['status'];

export type ChatAction =
  | { kind: 'stop' }
  | { kind: 'finalize' }
  | { kind: 'notes'; text: string }
  | { kind: 'show' }
  | { kind: 'quit' }
  | { kind: 'steer'; text: string }
  | { kind: 'resume'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'info'; message: string }
  | { kind: 'reject'; message: string };

export interface DispatchInputContext {
  jobState: ChatState;
}

export function dispatchInput(text: string, ctx: DispatchInputContext): { action: ChatAction } {
  const trimmed = text.trim();
  if (!trimmed) return { action: { kind: 'info', message: 'empty input' } };

  if (trimmed.startsWith('/')) return { action: parseSlashCommand(trimmed) };
  if (isTerminalState(ctx.jobState)) return { action: { kind: 'reject', message: 'freeform input rejected in terminal state' } };
  return { action: ctx.jobState === 'waiting' ? { kind: 'resume', text } : { kind: 'steer', text } };
}

export interface ChatExecutorDeps {
  jobId: string;
  jobsDir?: string;
  readStatus?: () => Promise<SupervisorStatus | null> | SupervisorStatus | null;
  stopJob?: (jobId: string) => Promise<void>;
  finalizeJob?: (jobId: string) => Promise<void>;
  appendBeadNote?: (beadId: string, note: string) => Promise<void> | void;
  mailboxPost?: (input: { jobId: string; kind: 'steer' | 'resume'; text: string }) => Promise<void>;
  writeHint?: (message: string) => void;
  fifoTimeoutMs?: number;
}

export async function executeInput(text: string, deps: ChatExecutorDeps): Promise<ChatAction> {
  const status = await readCurrentStatus(deps);
  const action = dispatchInput(text, { jobState: status?.status ?? 'error' }).action;

  if (action.kind === 'reject' || action.kind === 'error' || action.kind === 'info') {
    deps.writeHint?.(action.message);
    return action;
  }

  if (action.kind === 'stop') {
    await (deps.stopJob ?? defaultStopJob)(deps.jobId, deps.jobsDir);
    return action;
  }

  if (action.kind === 'finalize') {
    await (deps.finalizeJob ?? defaultFinalizeJob)(deps.jobId, deps.jobsDir);
    return action;
  }

  if (action.kind === 'notes') {
    if (!status?.bead_id) throw new Error('No bead id available for /notes');
    await (deps.appendBeadNote ?? defaultAppendBeadNote)(status.bead_id, action.text);
    return action;
  }

  if (action.kind === 'show' || action.kind === 'quit') return action;

  const mailboxPost = deps.mailboxPost ?? defaultMailboxPost(deps.jobsDir, deps.fifoTimeoutMs);
  await mailboxPost({ jobId: deps.jobId, kind: action.kind, text: action.text });
  return action;
}

function parseSlashCommand(text: string): ChatAction {
  const [command, ...rest] = text.slice(1).split(/\s+/);
  if (!command || !SLASH_COMMANDS.has(command)) return { kind: 'error', message: `unknown command: ${command ?? ''}`.trim() };
  if (command === 'notes') {
    const note = rest.join(' ').trim();
    return note ? { kind: 'notes', text: note } : { kind: 'info', message: 'usage: /notes <text>' };
  }
  if (command === 'stop') return { kind: 'stop' };
  if (command === 'finalize') return { kind: 'finalize' };
  if (command === 'show') return { kind: 'show' };
  return { kind: 'quit' };
}

function isTerminalState(state: ChatState): boolean {
  return state === 'done' || state === 'error' || state === 'cancelled';
}

async function readCurrentStatus(deps: ChatExecutorDeps): Promise<SupervisorStatus | null> {
  if (deps.readStatus) return await deps.readStatus();
  const supervisor = new Supervisor({ runner: null as any, runOptions: null as any, jobsDir: deps.jobsDir ?? resolveJobsDir() });
  try {
    return supervisor.readStatus(deps.jobId);
  } finally {
    await supervisor.dispose();
  }
}

async function defaultStopJob(jobId: string, jobsDir?: string): Promise<void> {
  const control = new JobControl({ runner: null as any, runOptions: null as any, jobsDir });
  await control.stopJob(jobId);
}

async function defaultFinalizeJob(jobId: string, jobsDir?: string): Promise<void> {
  const supervisor = new Supervisor({ runner: null as any, runOptions: null as any, jobsDir: jobsDir ?? resolveJobsDir() });
  try {
    const status = supervisor.readStatus(jobId);
    if (!status) throw new Error(`No job found: ${jobId}`);
    if (status.status !== 'waiting') throw new Error(`Job ${jobId} is not waiting (status: ${status.status})`);
    supervisor.finalizeWaitingJob(jobId);
  } finally {
    await supervisor.dispose();
  }
}

async function defaultAppendBeadNote(beadId: string, note: string): Promise<void> {
  const beads = new BeadsClient();
  const result = beads.updateBeadNotes(beadId, note);
  if (!result.ok) throw new Error(result.error ?? `Failed to append notes to bead ${beadId}`);
}

function defaultMailboxPost(jobsDir: string | undefined, timeoutMs = 1_000): (input: { jobId: string; kind: 'steer' | 'resume'; text: string }) => Promise<void> {
  return async ({ jobId, kind, text }) => {
    const supervisor = new Supervisor({ runner: null as any, runOptions: null as any, jobsDir: jobsDir ?? resolveJobsDir() });
    try {
      const status = supervisor.readStatus(jobId);
      if (!status?.fifo_path) throw new Error(`Job ${jobId} has no FIFO`);
      await appendWithTimeout(status.fifo_path, JSON.stringify({ type: kind, ...(kind === 'resume' ? { task: text } : { message: text }) }) + '\n', timeoutMs);
    } finally {
      await supervisor.dispose();
    }
  };
}

async function appendWithTimeout(path: string, contents: string, timeoutMs: number): Promise<void> {
  await Promise.race([
    appendFile(path, contents),
    new Promise<never>((_, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out writing FIFO after ms`)), timeoutMs);
      timeout.unref?.();
    }),
  ]);
}
