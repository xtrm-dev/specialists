import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

let statuses: Array<Record<string, unknown>> = [];

vi.mock('../../../src/specialist/status-load.js', () => ({
  loadStatuses: vi.fn(() => statuses),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
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
    (spawnSync as unknown as { mockReset: () => void }).mockReset();
    (execFileSync as unknown as { mockReset: () => void }).mockReset();
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('exits with usage when job-id is missing', async () => {
    process.argv = ['node', 'specialists', 'attach'];

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    const { run } = await import('../../../src/cli/attach.js');
    await expect(run()).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Usage: specialists attach <job-id>');
  });

  it('exits when the job is not found', async () => {
    process.argv = ['node', 'specialists', 'attach', 'job-missing'];

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    const { run } = await import('../../../src/cli/attach.js');
    await expect(run()).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Job `job-missing` not found. Run `specialists status` to see active jobs in current mode.');
  });

  it('exits when the job is already completed', async () => {
    statuses = [{ id: 'job-done', status: 'done', tmux_session: 'sess-1' }];
    process.argv = ['node', 'specialists', 'attach', 'job-done'];

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    const { run } = await import('../../../src/cli/attach.js');
    await expect(run()).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Job `job-done` has already completed (status: done). Use `specialists result job-done` to read output.');
  });

  it('exits when tmux session is missing', async () => {
    statuses = [{ id: 'job-no-session', status: 'running' }];
    process.argv = ['node', 'specialists', 'attach', 'job-no-session'];

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    const { run } = await import('../../../src/cli/attach.js');
    await expect(run()).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Job `job-no-session` has no tmux session. It may have been started without tmux or tmux was not installed.');
  });

  it('exits with usage when no tty is available', async () => {
    statuses = [{ id: 'job-running', status: 'running', tmux_session: 'sess-live' }];
    setTty(false, false);
    process.argv = ['node', 'specialists', 'attach', 'job-running'];

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    const { run } = await import('../../../src/cli/attach.js');
    await expect(run()).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('Usage: specialists attach <job-id>');
  });
});
