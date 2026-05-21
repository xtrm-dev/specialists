import { describe, expect, it, vi } from 'vitest';
import { createChatControl, dispatchInput, type ControlOps, type Result } from '../../../src/cli/chat/control.js';

function ok(message?: string): Result { return { ok: true, message }; }
function err(error_code: 'not_waiting' | 'already_stopped' | 'unknown_command' | 'missing_notes', likely_cause: string, next_safe_action: 'none' | 'rejoin'): Result {
  return { ok: false, error_code, likely_cause, next_safe_action };
}

describe('dispatchInput', () => {
  it.each([
    ['/stop', 'running', { kind: 'stop' }],
    ['/finalize', 'waiting', { kind: 'finalize' }],
    ['/notes hello', 'running', { kind: 'notes', text: 'hello' }],
    ['/show', 'running', { kind: 'show' }],
    ['/quit', 'running', { kind: 'quit' }],
  ])('parses %s', (input, jobState, expected) => {
    expect(dispatchInput(input as string, { jobState: jobState as any })).toEqual(expected);
  });

  it('returns error action for unknown slash', () => {
    expect(dispatchInput('/bogus', { jobState: 'running' })).toEqual({ kind: 'error', message: 'unknown command: bogus' });
  });

  it('routes plain text to steer when running', () => {
    expect(dispatchInput('focus on supervisor', { jobState: 'running' })).toEqual({ kind: 'steer', text: 'focus on supervisor' });
  });

  it('routes plain text to resume when waiting', () => {
    expect(dispatchInput('next task', { jobState: 'waiting' })).toEqual({ kind: 'resume', text: 'next task' });
  });

  it('rejects freeform input in terminal state', () => {
    expect(dispatchInput('next task', { jobState: 'done' })).toEqual({ kind: 'reject', message: 'freeform input rejected in terminal state' });
  });

  it('requires notes body', () => {
    expect(dispatchInput('/notes   ', { jobState: 'running' })).toEqual({ kind: 'info', message: 'usage: /notes <text>' });
  });
});

describe('ControlOps contract', () => {
  it('/stop on already-stopped job is no-op info', async () => {
    const controlOps: ControlOps = {
      stopJob: vi.fn().mockResolvedValue(ok('already stopped')),
      finalizeJob: vi.fn().mockResolvedValue(ok()),
      appendBeadNote: vi.fn().mockResolvedValue(ok()),
    };

    const chat = createChatControl(controlOps);
    expect(await chat.executeInput('/stop', { jobId: 'job-1', jobState: 'running' })).toEqual({ kind: 'info', message: 'already stopped' });
    expect(controlOps.stopJob).toHaveBeenCalledWith('job-1');
  });

  it('/finalize on non-waiting job returns structured error envelope', async () => {
    const controlOps: ControlOps = {
      stopJob: vi.fn().mockResolvedValue(ok()),
      finalizeJob: vi.fn().mockResolvedValue(err('not_waiting', 'job is running', 'rejoin')),
      appendBeadNote: vi.fn().mockResolvedValue(ok()),
    };

    const chat = createChatControl(controlOps);
    const action = await chat.executeInput('/finalize', { jobId: 'job-1', jobState: 'running' });
    expect(action).toEqual({ kind: 'error', message: JSON.stringify({ ok: false, error_code: 'not_waiting', likely_cause: 'job is running', next_safe_action: 'rejoin' }) });
  });

  it('empty /notes returns error before ControlOps.appendBeadNote', async () => {
    const controlOps: ControlOps = {
      stopJob: vi.fn().mockResolvedValue(ok()),
      finalizeJob: vi.fn().mockResolvedValue(ok()),
      appendBeadNote: vi.fn().mockResolvedValue(ok()),
    };

    const chat = createChatControl(controlOps);
    expect(await chat.executeInput('/notes   ', { jobId: 'job-1', jobState: 'running', beadId: 'bd.1' })).toEqual({ kind: 'info', message: 'usage: /notes <text>' });
    expect(controlOps.appendBeadNote).not.toHaveBeenCalled();
  });
});
