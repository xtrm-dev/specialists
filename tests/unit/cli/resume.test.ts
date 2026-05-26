import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({
  status: null as any,
  emitControlEvent: vi.fn(),
  dispose: vi.fn(async () => undefined),
  jobsDir: '',
}));

vi.mock('../../../src/specialist/job-root.js', () => ({
  resolveJobsDir: () => state.jobsDir,
}));

vi.mock('../../../src/specialist/supervisor.js', () => ({
  Supervisor: class {
    readStatus() {
      return state.status;
    }
    emitControlEvent(...args: unknown[]) {
      return state.emitControlEvent(...args);
    }
    dispose() {
      return state.dispose();
    }
  },
}));

describe('resume CLI', () => {
  const originalArgv = process.argv;
  let tmpDir: string;
  let stdoutWrites: string[];
  let stderrWrites: string[];

  beforeEach(() => {
    vi.resetModules();
    tmpDir = mkdtempSync(join(tmpdir(), 'resume-cli-'));
    state.jobsDir = join(tmpDir, 'jobs');
    state.emitControlEvent.mockReset();
    state.dispose.mockClear();
    stdoutWrites = [];
    stderrWrites = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stderrWrites.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports success when the resume payload is delivered but telemetry fails', async () => {
    const fifoPath = join(tmpDir, 'resume.fifo');
    writeFileSync(fifoPath, '', 'utf-8');
    state.status = {
      id: 'job-a',
      specialist: 'test',
      status: 'waiting',
      fifo_path: fifoPath,
      started_at_ms: Date.now(),
    };
    state.emitControlEvent.mockImplementation(() => {
      throw new Error('database unavailable');
    });
    process.argv = ['node', 'sp', 'resume', 'job-a', 'continue work'];

    const { run } = await import('../../../src/cli/resume.js');
    await run();

    expect(readFileSync(fifoPath, 'utf-8')).toContain('continue work');
    expect(stdoutWrites.join('')).toContain('Resume sent to job job-a');
    expect(stderrWrites.join('')).toContain('telemetry could not be recorded');
  });
});
