import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let statuses: Array<Record<string, unknown>> = [];

vi.mock('../../../src/specialist/status-load.js', () => ({
  loadStatuses: vi.fn(() => statuses),
}));


let tempRoot: string;

function setTty(stdout: boolean, stdin: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: stdout });
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: stdin });
}

describe('attach CLI', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'sp-attach-test-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);
    setTty(true, true);
    statuses = [];
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('exits with usage when job-id is missing and tty absent', async () => {
    setTty(false, false);
    process.argv = ['node', 'specialists', 'attach'];

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as never);

    const { run } = await import('../../../src/cli/attach.js');
    await expect(run()).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Usage: specialists attach <job-id>');
  });

  it('attaches to running job through injected TUI runner', async () => {
    statuses = [{ id: 'job-running', status: 'running', specialist: 'reviewer', bead_id: 'bd.1' }];
    process.argv = ['node', 'specialists', 'attach', 'job-running'];
    const runTui = vi.fn().mockResolvedValue(undefined);

    const { run } = await import('../../../src/cli/attach.js');
    await run({ runTui });

    expect(runTui).toHaveBeenCalledWith({
      id: 'job-running',
      status: 'running',
      specialist: 'reviewer',
      beadId: 'bd.1',
      terminal: false,
    });
  });

  it.each([
    ['job-done', 'done'],
    ['job-error', 'error'],
    ['job-cancelled', 'cancelled'],
    ['job-stopped', 'stopped'],
  ])('rejects terminal job attach explicitly for %s', async (jobId, status) => {
    statuses = [{ id: jobId, status, specialist: 'reviewer' }];
    process.argv = ['node', 'specialists', 'attach', jobId];

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as never);

    const { run } = await import('../../../src/cli/attach.js');
    await expect(run()).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith(`Job \`${jobId}\` is terminal. Attach only supports running, waiting, starting jobs.`);
  });

  it('picker only shows active jobs', async () => {
    statuses = [
      { id: 'job-done', status: 'done', specialist: 'reviewer' },
      { id: 'job-running', status: 'running', specialist: 'executor' },
      { id: 'job-waiting', status: 'waiting', specialist: 'planner' },
      { id: 'job-starting', status: 'starting', specialist: 'ops' },
      { id: 'job-error', status: 'error', specialist: 'reviewer' },
      { id: 'job-cancelled', status: 'cancelled', specialist: 'reviewer' },
      { id: 'job-stopped', status: 'stopped', specialist: 'reviewer' },
    ];
    process.argv = ['node', 'specialists', 'attach'];
    const runTui = vi.fn().mockResolvedValue(undefined);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { run } = await import('../../../src/cli/attach.js');
    const runPromise = run({ runTui });
    process.stdin.emit('keypress', '', { name: 'return' });
    await runPromise;

    const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('Attach job (↑/↓, Enter to select, Ctrl+C to cancel)');
    expect(output).toContain('job-running  executor  running');
    expect(output).toContain('job-waiting  planner  waiting');
    expect(output).toContain('job-starting  ops  starting');
    expect(output).not.toContain('job-done');
    expect(output).not.toContain('job-error');
    expect(runTui).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-running', terminal: false }));
  });

  it('picker moves selection with arrow keys before attaching', async () => {
    statuses = [
      { id: 'job-running', status: 'running', specialist: 'executor' },
      { id: 'job-waiting', status: 'waiting', specialist: 'planner' },
      { id: 'job-starting', status: 'starting', specialist: 'ops' },
    ];
    process.argv = ['node', 'specialists', 'attach'];
    const runTui = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { run } = await import('../../../src/cli/attach.js');
    const runPromise = run({ runTui });
    process.stdin.emit('keypress', '', { name: 'down' });
    process.stdin.emit('keypress', '', { name: 'return' });
    await runPromise;

    expect(runTui).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-waiting', terminal: false }));
  });

  it('exits with usage when no tty is available for explicit job id', async () => {
    setTty(false, false);
    statuses = [{ id: 'job-running', status: 'running' }];
    process.argv = ['node', 'specialists', 'attach', 'job-running'];

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as never);

    const { run } = await import('../../../src/cli/attach.js');
    await expect(run()).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Usage: specialists attach <job-id>');
  });
});
