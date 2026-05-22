import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let statuses: Array<Record<string, unknown>> = [];

vi.mock('../../../src/specialist/status-load.js', () => ({
  loadStatuses: vi.fn(() => statuses),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, readFileSync: vi.fn(() => '1') };
});

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

  it('attaches terminal job in read-only mode through injected TUI runner', async () => {
    statuses = [{ id: 'job-done', status: 'done', specialist: 'reviewer' }];
    process.argv = ['node', 'specialists', 'attach', 'job-done'];
    const runTui = vi.fn().mockResolvedValue(undefined);

    const { run } = await import('../../../src/cli/attach.js');
    await run({ runTui });

    expect(runTui).toHaveBeenCalledWith({
      id: 'job-done',
      status: 'done',
      specialist: 'reviewer',
      beadId: undefined,
      terminal: true,
    });
  });

  it('picker selects highest-priority job in tty mode', async () => {
    statuses = [
      { id: 'job-done', status: 'done', specialist: 'reviewer' },
      { id: 'job-running', status: 'running', specialist: 'executor' },
      { id: 'job-waiting', status: 'waiting', specialist: 'planner' },
    ];
    process.argv = ['node', 'specialists', 'attach'];
    const runTui = vi.fn().mockResolvedValue(undefined);

    const { run } = await import('../../../src/cli/attach.js');
    await run({ runTui });

    expect(runTui).toHaveBeenCalledWith({
      id: 'job-running',
      status: 'running',
      specialist: 'executor',
      beadId: undefined,
      terminal: false,
    });
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
