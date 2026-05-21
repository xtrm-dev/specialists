import { describe, expect, it, vi } from 'vitest';
import { dispatchInput, executeInput } from '../../../src/cli/chat/control.js';

function status(status: 'running' | 'waiting' | 'done' | 'error' | 'cancelled' = 'running', bead_id = 'bd.1') {
  return { status, bead_id, fifo_path: '/tmp/fifo' } as const;
}

describe('dispatchInput', () => {
  it.each([
    ['/stop', 'running', { kind: 'stop' }],
    ['/finalize', 'waiting', { kind: 'finalize' }],
    ['/notes hello', 'running', { kind: 'notes', text: 'hello' }],
    ['/show', 'running', { kind: 'show' }],
    ['/quit', 'running', { kind: 'quit' }],
  ])('parses %s', (input, jobState, expected) => {
    expect(dispatchInput(input as string, { jobState: jobState as any }).action).toEqual(expected);
  });

  it('returns error action for unknown slash', () => {
    expect(dispatchInput('/bogus', { jobState: 'running' }).action).toEqual({ kind: 'error', message: 'unknown command: bogus' });
  });

  it('routes plain text to steer when running', () => {
    expect(dispatchInput('focus on supervisor', { jobState: 'running' }).action).toEqual({ kind: 'steer', text: 'focus on supervisor' });
  });

  it('routes plain text to resume when waiting', () => {
    expect(dispatchInput('next task', { jobState: 'waiting' }).action).toEqual({ kind: 'resume', text: 'next task' });
  });

  it('rejects freeform input in terminal state', () => {
    expect(dispatchInput('next task', { jobState: 'done' }).action).toEqual({ kind: 'reject', message: 'freeform input rejected in terminal state' });
  });

  it('requires notes body', () => {
    expect(dispatchInput('/notes   ', { jobState: 'running' }).action).toEqual({ kind: 'info', message: 'usage: /notes <text>' });
  });
});

describe('executeInput', () => {
  it('posts plain text as steer when job is running', async () => {
    const mailboxPost = vi.fn();
    const action = await executeInput('keep going', {
      jobId: 'job-1',
      readStatus: () => status('running'),
      mailboxPost,
    });

    expect(action).toEqual({ kind: 'steer', text: 'keep going' });
    expect(mailboxPost).toHaveBeenCalledWith({ jobId: 'job-1', kind: 'steer', text: 'keep going' });
  });

  it('does not call appendBeadNote for empty /notes', async () => {
    const appendBeadNote = vi.fn();
    const action = await executeInput('/notes', {
      jobId: 'job-1',
      readStatus: () => status('running'),
      appendBeadNote,
      writeHint: vi.fn(),
    });

    expect(action).toEqual({ kind: 'info', message: 'usage: /notes <text>' });
    expect(appendBeadNote).not.toHaveBeenCalled();
  });

  it('matches integration snapshot for running state plain text submit', async () => {
    const action = await executeInput('resume this', {
      jobId: 'job-7',
      readStatus: () => status('running'),
      mailboxPost: vi.fn(),
    });

    expect(action).toMatchInlineSnapshot(`
      {
        "kind": "steer",
        "text": "resume this",
      }
    `);
  });
});
