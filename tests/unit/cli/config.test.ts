import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = process.cwd();

vi.mock('../../../src/cli/edit.js', () => ({
  run: vi.fn(async () => {}),
}));

describe('config CLI', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'specialists-config-test-'));
    const configDir = join(tempDir, 'config', 'specialists');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'executor.specialist.json'), await readFile(join(REPO_ROOT, 'config', 'specialists', 'executor.specialist.json'), 'utf-8'), 'utf-8');
    await writeFile(join(configDir, 'explorer.specialist.json'), await readFile(join(REPO_ROOT, 'config', 'specialists', 'explorer.specialist.json'), 'utf-8'), 'utf-8');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('gets a key across all specialists', async () => {
    process.argv = ['node', 'specialists', 'config', 'get', 'specialist.execution.stall_timeout_ms'];

    const { run } = await import('../../../src/cli/config.js');
    await run();

    expect(process.argv).toEqual(['node', 'specialists', 'edit', '--all', '--get', 'specialist.execution.stall_timeout_ms']);
  });

  it('sets a key across all specialists by default', async () => {
    process.argv = ['node', 'specialists', 'config', 'set', 'specialist.execution.stall_timeout_ms', '180000'];

    const { run } = await import('../../../src/cli/config.js');
    await run();

    expect(process.argv).toEqual(['node', 'specialists', 'edit', '--all', '--set', 'specialist.execution.stall_timeout_ms', '180000']);
  });

  it('sets a key for one specialist with --name', async () => {
    process.argv = [
      'node',
      'specialists',
      'config',
      'set',
      'specialist.execution.stall_timeout_ms',
      '210000',
      '--name',
      'executor',
    ];

    const { run } = await import('../../../src/cli/config.js');
    await run();

    expect(process.argv).toEqual(['node', 'specialists', 'edit', 'executor', '--set', 'specialist.execution.stall_timeout_ms', '210000']);
  });

  it('exits with code 1 on invalid arguments', async () => {
    process.argv = ['node', 'specialists', 'config', 'set', 'specialist.execution.stall_timeout_ms'];

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number | string) => {
      throw new Error(`exit:${code}`);
    });

    const { run } = await import('../../../src/cli/config.js');
    await expect(run()).rejects.toThrow('exit:1');

    exitSpy.mockRestore();
  });
});
