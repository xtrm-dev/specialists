import { describe, expect, it } from 'vitest';
import { dispatchInput } from '../../../src/cli/chat/control.js';

describe('chat mailbox routing boundary', () => {
  it('routes running text to steer and waiting text to resume', () => {
    expect(dispatchInput('move faster', { jobState: 'running' })).toEqual({ kind: 'steer', text: 'move faster' });
    expect(dispatchInput('continue', { jobState: 'waiting' })).toEqual({ kind: 'resume', text: 'continue' });
  });

  it('rejects freeform input for terminal jobs', () => {
    expect(dispatchInput('again', { jobState: 'done' })).toEqual({ kind: 'reject', message: 'freeform input rejected in terminal state' });
  });
});
