import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatControl, dispatchInput, type ControlOps } from '../../../src/cli/chat/control.js';

function ok(message?: string) { return { ok: true as const, message }; }
function err(error_code: 'not_waiting' | 'already_stopped' | 'unknown_command' | 'missing_notes', likely_cause: string, next_safe_action: 'none' | 'rejoin') {
  return { ok: false as const, error_code, likely_cause, next_safe_action };
}

describe('chat control boundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('routes plain text by live state', () => {
    expect(dispatchInput('run it', { jobState: 'running' })).toEqual({ kind: 'steer', text: 'run it' });
    expect(dispatchInput('next', { jobState: 'waiting' })).toEqual({ kind: 'resume', text: 'next' });
  });

  it('stop/finalize/notes helpers surface envelopes on no-op cases', async () => {
    const stopJob = vi.fn().mockResolvedValueOnce(ok('stopped')).mockResolvedValueOnce(ok('already stopped'));
    const finalizeJob = vi.fn().mockResolvedValue(err('not_waiting', 'job not waiting', 'rejoin'));
    const appendBeadNote = vi.fn().mockResolvedValue(err('missing_notes', 'empty note', 'none'));
    const chat = createChatControl({ getJobState: vi.fn().mockResolvedValue('running'), stopJob, finalizeJob, appendBeadNote } satisfies ControlOps);
    expect(await chat.executeInput('/stop', { jobId: 'job-1', jobState: 'running' })).toEqual({ kind: 'info', message: 'stopped' });
    expect(await chat.executeInput('/stop', { jobId: 'job-1', jobState: 'running' })).toEqual({ kind: 'info', message: 'already stopped' });
    expect(await chat.executeInput('/finalize', { jobId: 'job-1', jobState: 'running' })).toEqual({ kind: 'error', message: JSON.stringify({ ok: false, error_code: 'not_waiting', likely_cause: 'job not waiting', next_safe_action: 'rejoin' }) });
    expect(await chat.executeInput('/notes text', { jobId: 'job-1', jobState: 'running', beadId: 'bd-1' })).toEqual({ kind: 'error', message: JSON.stringify({ ok: false, error_code: 'missing_notes', likely_cause: 'empty note', next_safe_action: 'none' }) });
  });
});
