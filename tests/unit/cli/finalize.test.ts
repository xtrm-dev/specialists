import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const state = {
  status: { status: 'waiting', fifo_path: '/tmp/fifo', started_at_ms: Date.now() - 1000 },
  result: '## Compliance Verdict\n- Verdict: PASS\n',
  finalizeCalls: 0,
  writes: [] as string[],
};

vi.mock('../../../src/specialist/supervisor.js', () => ({
  Supervisor: class {
    readStatus() {
      return state.status;
    }
    readResult() {
      return state.result;
    }
    finalizeWaitingJob() {
      state.finalizeCalls += 1;
      return state.status;
    }
    async dispose() {}
  },
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    writeFileSync: vi.fn((path: any, payload: any) => {
      state.writes.push(`${String(path)}:${String(payload).trim()}`);
    }),
  };
});

describe('finalize CLI', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    process.argv = ['node', 'specialists', 'finalize', 'job-a'];
    state.status = { status: 'waiting', fifo_path: '/tmp/fifo', started_at_ms: Date.now() - 1000 };
    state.result = '## Compliance Verdict\n- Verdict: PASS\n';
    state.finalizeCalls = 0;
    state.writes = [];
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('finalizes eligible PASS job through canonical path', async () => {
    const stdoutWrites: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });

    const { run } = await import('../../../src/cli/finalize.js');
    await run();

    expect(state.finalizeCalls).toBe(1);
    expect(state.writes).toEqual([]);
    expect(stdoutWrites.join('')).toContain('Finalized job job-a');
  });

  it('refuses non-PASS job', async () => {
    state.result = '## Compliance Verdict\n- Verdict: PARTIAL\n';
    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stderrWrites.push(String(chunk));
      return true;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as never);

    const { run } = await import('../../../src/cli/finalize.js');
    await expect(run()).rejects.toThrow('exit:1');

    expect(state.finalizeCalls).toBe(0);
    expect(stderrWrites.join('')).toContain('no PASS compliance verdict');
    exitSpy.mockRestore();
  });
});
