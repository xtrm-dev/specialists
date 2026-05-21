import { describe, expect, it } from 'vitest';
import { dispatchInput, type ChatAction } from '../../../src/cli/chat/control.js';

function expectAction(input: string, jobState: 'running' | 'waiting' | 'done', expected: ChatAction): void {
  expect(dispatchInput(input, { jobState })).toEqual(expected);
}

describe('dispatchInput', () => {
  it.each([
    ['/stop', 'running', { kind: 'stop' }],
    ['/finalize', 'waiting', { kind: 'finalize' }],
    ['/notes hello', 'running', { kind: 'notes', text: 'hello' }],
    ['/show', 'running', { kind: 'show' }],
    ['/quit', 'running', { kind: 'quit' }],
  ] as const)('parses %s', (input, jobState, expected) => {
    expectAction(input, jobState, expected);
  });

  it('returns error action for unknown slash', () => {
    expect(dispatchInput('/unknown', { jobState: 'running' })).toEqual({ kind: 'error', message: 'unknown command: unknown' });
  });

  it('returns error for empty notes body', () => {
    expect(dispatchInput('/notes', { jobState: 'running' })).toEqual({ kind: 'error', message: 'usage: /notes <text>' });
  });

  it('routes plain text by job state', () => {
    expect(dispatchInput('needs more context', { jobState: 'running' })).toEqual({ kind: 'steer', text: 'needs more context' });
    expect(dispatchInput('next step', { jobState: 'waiting' })).toEqual({ kind: 'resume', text: 'next step' });
    expect(dispatchInput('done input', { jobState: 'done' })).toEqual({ kind: 'reject', message: 'freeform input rejected in terminal state' });
  });
});
