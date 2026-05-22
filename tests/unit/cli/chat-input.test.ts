import { describe, expect, it, vi } from 'vitest';
import { handleSubmittedInput } from '../../../src/cli/chat.js';
import { createChatControl } from '../../../src/cli/chat/control.js';

type SubmittedDeps = Parameters<typeof handleSubmittedInput>[0];

function baseDeps(overrides: Partial<SubmittedDeps> = {}): SubmittedDeps {
  return {
    text: '/quit',
    getJobId: () => 'job-1',
    getJobState: async () => 'running',
    getJobStatus: async () => ({ status: 'running', fifo_path: '/tmp/fifo' }),
    beadId: 'unitAI-test',
    control: createChatControl({
      getJobState: async () => 'running',
      stopJob: async () => ({ ok: true, message: 'stop ok' }),
      finalizeJob: async () => ({ ok: true, message: 'finalize ok' }),
      appendBeadNote: async () => ({ ok: true, message: 'note ok' }),
    }),
    appendEvent: vi.fn(),
    requestRender: vi.fn(),
    requestExit: vi.fn(),
    ...overrides,
  };
}

describe('handleSubmittedInput', () => {
  it('/quit detaches without consulting job control or status', async () => {
    const getJobStatus = vi.fn().mockResolvedValue({ status: 'running', fifo_path: '/tmp/fifo' });
    const deps = baseDeps({ text: '/quit', getJobStatus });

    await handleSubmittedInput(deps);

    expect(deps.appendEvent).toHaveBeenCalledWith('user', '/quit');
    expect(deps.appendEvent).toHaveBeenCalledWith('chat', 'detaching; specialist job left running');
    expect(deps.requestExit).toHaveBeenCalledTimes(1);
    expect(getJobStatus).not.toHaveBeenCalled();
  });

  it('/show displays job, bead, status, and fifo readiness', async () => {
    const deps = baseDeps({ text: '/show' });

    await handleSubmittedInput(deps);

    expect(deps.appendEvent).toHaveBeenCalledWith('chat', 'job=job-1 bead=unitAI-test state=running fifo=ready');
    expect(deps.requestRender).toHaveBeenCalled();
  });
});
