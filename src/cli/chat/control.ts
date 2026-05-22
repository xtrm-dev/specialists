import type { SupervisorStatus } from '../../specialist/supervisor.js';

const SLASH_COMMANDS = new Set(['stop', 'finalize', 'notes', 'show', 'quit']);

export type Result =
  | { ok: true; message?: string }
  | { ok: false; error_code: 'not_waiting' | 'already_stopped' | 'unknown_command' | 'missing_notes'; likely_cause: string; next_safe_action: 'none' | 'rejoin' };

export interface ControlOps {
  getJobState(jobId: string): Promise<ChatState | null>;
  stopJob(jobId: string): Promise<Result>;
  finalizeJob(jobId: string): Promise<Result>;
  appendBeadNote(beadId: string, text: string): Promise<Result>;
}

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

export interface ChatControl {
  dispatchInput(text: string, ctx: DispatchInputContext): ChatAction;
  executeInput(text: string, ctx: { jobId: string; jobState: ChatState; beadId?: string }): Promise<ChatAction>;
}

export function createChatControl(controlOps: ControlOps): ChatControl {
  // TODO(u4fdd.6): inject the real u4fdd.2 module that implements ControlOps.
  return {
    dispatchInput(text, ctx) {
      return dispatchInput(text, ctx);
    },
    async executeInput(text, ctx) {
      const liveState = isPlainText(text) ? await controlOps.getJobState(ctx.jobId) : ctx.jobState;
      const action = dispatchInput(text, { jobState: liveState ?? ctx.jobState });
      if (action.kind === 'info' || action.kind === 'error' || action.kind === 'reject') return action;
      if (isPlainText(text) && liveState && isTerminalState(liveState)) {
        return { kind: 'reject', message: 'freeform input rejected in terminal state' };
      }
      if (action.kind === 'stop') return handleResult(await controlOps.stopJob(ctx.jobId), 'stop');
      if (action.kind === 'finalize') return handleResult(await controlOps.finalizeJob(ctx.jobId), 'finalize');
      if (action.kind === 'notes') {
        if (!action.text.trim()) return errorEnvelope('missing_notes', 'notes body missing', 'none');
        if (!ctx.beadId) return errorEnvelope('missing_notes', 'bead id missing', 'none');
        return handleResult(await controlOps.appendBeadNote(ctx.beadId, action.text), 'notes');
      }
      return action;
    },
  };
}

export function dispatchInput(text: string, ctx: DispatchInputContext): ChatAction {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'info', message: 'empty input' };
  if (trimmed.startsWith('/')) return parseSlashCommand(trimmed);
  if (isTerminalState(ctx.jobState)) return { kind: 'reject', message: 'freeform input rejected in terminal state' };
  return ctx.jobState === 'waiting' ? { kind: 'resume', text } : { kind: 'steer', text };
}

function isPlainText(text: string): boolean {
  return !text.trim().startsWith('/');
}

function parseSlashCommand(text: string): ChatAction {
  const [command, ...rest] = text.slice(1).split(/\s+/);
  if (!command || !SLASH_COMMANDS.has(command)) return { kind: 'error', message: `unknown command: ${command ?? ''}`.trim() };
  if (command === 'notes') {
    const note = rest.join(' ').trim();
    return note ? { kind: 'notes', text: note } : { kind: 'error', message: 'usage: /notes <text>' };
  }
  if (command === 'stop') return { kind: 'stop' };
  if (command === 'finalize') return { kind: 'finalize' };
  if (command === 'show') return { kind: 'show' };
  return { kind: 'quit' };
}

function isTerminalState(state: ChatState): boolean {
  return state === 'done' || state === 'error' || state === 'cancelled';
}

function handleResult(result: Result, successKind: ChatAction['kind']): ChatAction {
  if (result.ok) return { kind: 'info', message: result.message ?? `${successKind} ok` };
  return errorEnvelope(result.error_code, result.likely_cause, result.next_safe_action);
}

function errorEnvelope(error_code: 'not_waiting' | 'already_stopped' | 'unknown_command' | 'missing_notes', likely_cause: string, next_safe_action: 'none' | 'rejoin'): ChatAction {
  return { kind: 'error', message: JSON.stringify({ ok: false, error_code, likely_cause, next_safe_action }) };
}
