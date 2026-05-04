import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supervisorState = {
  liveJobs: [] as string[],
  status: { status: 'running', pid: 1234, bead_id: 'bead-x', tmux_session: undefined, started_at_ms: Date.now() - 1000 },
};

const beadsState = {
  closeCalls: [] as Array<{ beadId: string; reason: string }>,
  closeBeadIfInProgress: vi.fn((beadId: string, reason: string) => {
    beadsState.closeCalls.push({ beadId, reason });
    return true;
  }),
};

vi.mock('../../../src/specialist/supervisor.js', () => ({
  Supervisor: class {
    readStatus() {
      return supervisorState.status;
    }
    updateJobStatus() {
      return supervisorState.status;
    }
    aggregateJobMetricsBestEffort() {}
    listLiveJobsForBead() {
      return supervisorState.liveJobs;
    }
    async dispose() {}
  },
}));

vi.mock('../../../src/specialist/beads.js', () => ({
  BeadsClient: class {
    closeBeadIfInProgress(...args: [string, string]) {
      return beadsState.closeBeadIfInProgress(...args);
    }
  },
}));

vi.mock('../../../src/cli/tmux-utils.js', () => ({
  killTmuxSession: vi.fn(),
}));

describe('stop CLI', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    process.argv = ['node', 'specialists', 'stop', 'job-a'];
    supervisorState.liveJobs = [];
    supervisorState.status = { status: 'running', pid: 1234, bead_id: 'bead-x', tmux_session: undefined, started_at_ms: Date.now() - 1000 };
    beadsState.closeCalls = [];
    beadsState.closeBeadIfInProgress.mockClear();
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('skips bead close when sibling live jobs stay active', async () => {
    supervisorState.liveJobs = ['job-a', 'job-b', 'job-c'];

    const stdoutWrites: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process, 'kill').mockImplementation(() => true as never);

    const { run } = await import('../../../src/cli/stop.js');
    await run();

    expect(beadsState.closeBeadIfInProgress).not.toHaveBeenCalled();
    expect(stdoutWrites.join('')).toContain('bead_close_skipped: sibling-jobs-active [job-b, job-c]');
  });

  it('closes bead on last live job', async () => {
    supervisorState.liveJobs = ['job-a'];

    const stdoutWrites: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process, 'kill').mockImplementation(() => true as never);

    const { run } = await import('../../../src/cli/stop.js');
    await run();

    expect(beadsState.closeBeadIfInProgress).toHaveBeenCalledWith('bead-x', 'Job job-a stopped (running)');
    expect(stdoutWrites.join('')).toContain('auto-closed');
  });

  it('forces bead close anyway with override', async () => {
    supervisorState.liveJobs = ['job-a', 'job-b'];
    process.argv = ['node', 'specialists', 'stop', 'job-a', '--close-bead-anyway'];

    const stdoutWrites: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process, 'kill').mockImplementation(() => true as never);

    const { run } = await import('../../../src/cli/stop.js');
    await run();

    expect(beadsState.closeBeadIfInProgress).toHaveBeenCalledWith('bead-x', 'Job job-a stopped (running)');
    expect(stdoutWrites.join('')).toContain('auto-closed');
  });
});
