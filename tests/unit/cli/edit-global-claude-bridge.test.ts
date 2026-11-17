/**
 * `sp edit --global claude_bridge.*` and `sp init --global` for the reserved route block
 * (SPECIALISTS-4442, D2 and D3).
 *
 * Before this, the switch could only be turned on by hand-editing user.json (resolveGlobalPath
 * always parsed the first segment as a Specialist name), and `sp init --global` announced the
 * operator's consent record as "no longer shipped", inviting its removal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  CLAUDE_BRIDGE_SWITCH_KEY,
  buildGlobalUserConfigTemplate,
  buildSpecialistOverrideTemplate,
  getGlobalUserConfigPath,
  mergeGlobalUserConfig,
  readClaudeBridgeBlock,
} from '../../../src/specialist/global-config.js';
import { tempDir } from '../../utils/temp-dir.js';

async function importEdit() {
  return import('../../../src/cli/edit.js');
}

/** A file with one real Specialist and no block: `init --global` and `edit --global` both run. */
async function seed(home: string, extra: Record<string, unknown> = {}): Promise<string> {
  process.env.HOME = home;
  delete process.env.XDG_CONFIG_HOME;
  const location = getGlobalUserConfigPath();
  await mkdir(dirname(location.path), { recursive: true });
  await writeFile(
    location.path,
    JSON.stringify(
      {
        executor: {
          ...buildSpecialistOverrideTemplate(),
          execution: { ...buildSpecialistOverrideTemplate().execution, model: 'anthropic/claude-sonnet-4-6' },
        },
        ...extra,
      },
      null,
      2,
    ),
    'utf-8',
  );
  return location.path;
}

async function readConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(getGlobalUserConfigPath().path, 'utf-8')) as Record<string, unknown>;
}

describe('sp edit --global claude_bridge.*', () => {
  let home: string;
  let previousHome: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    home = tempDir('edit-global-bridge-');
    previousHome = process.env.HOME;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code?: number | string) => {
      throw new Error(`exit:${code ?? 0}`);
    });
  });

  afterEach(async () => {
    process.env.HOME = previousHome;
    delete process.env.XDG_CONFIG_HOME;
    vi.restoreAllMocks();
    vi.resetModules();
    await rm(home, { recursive: true, force: true });
  });

  it('writes enabled, default_model, specialists and a per-name model, and reads them back', async () => {
    await seed(home);
    const { run } = await importEdit();

    process.argv = ['node', 'sp', 'edit', '--global', '--set', `${CLAUDE_BRIDGE_SWITCH_KEY}.enabled`, 'true'];
    await run();
    process.argv = ['node', 'sp', 'edit', '--global', '--set', `${CLAUDE_BRIDGE_SWITCH_KEY}.default_model`, 'claude-bridge/claude-sonnet-5-5'];
    await run();
    process.argv = ['node', 'sp', 'edit', '--global', '--set', `${CLAUDE_BRIDGE_SWITCH_KEY}.specialists`, '["explorer","reviewer"]'];
    await run();
    process.argv = ['node', 'sp', 'edit', '--global', '--set', `${CLAUDE_BRIDGE_SWITCH_KEY}.models.advisor`, 'claude-bridge/claude-opus-5-5'];
    await run();

    const config = await readConfig();
    expect(config[CLAUDE_BRIDGE_SWITCH_KEY]).toEqual({
      enabled: true,
      default_model: 'claude-bridge/claude-sonnet-5-5',
      specialists: ['explorer', 'reviewer'],
      models: { advisor: 'claude-bridge/claude-opus-5-5' },
    });
    // The written file is the file the route reads: one reader, one answer.
    expect(readClaudeBridgeBlock().error).toBeNull();
    expect(readClaudeBridgeBlock().block?.specialists).toEqual(['explorer', 'reviewer']);
    // The Specialist entry is untouched.
    expect((config.executor as { execution: { model: string } }).execution.model).toBe('anthropic/claude-sonnet-4-6');

    logSpy.mockClear();
    process.argv = ['node', 'sp', 'edit', '--global', '--get', `${CLAUDE_BRIDGE_SWITCH_KEY}.enabled`];
    await run();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('true'));
  });

  it('reports an unset block on --get instead of failing', async () => {
    await seed(home);
    process.argv = ['node', 'sp', 'edit', '--global', '--get', `${CLAUDE_BRIDGE_SWITCH_KEY}.enabled`];
    const { run } = await importEdit();
    await run();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('(not set)'));
  });

  it('rejects a non-boolean enabled and a non-bridged model without writing', async () => {
    await seed(home);
    const { run } = await importEdit();
    const before = await readFile(getGlobalUserConfigPath().path, 'utf-8');

    process.argv = ['node', 'sp', 'edit', '--global', '--set', `${CLAUDE_BRIDGE_SWITCH_KEY}.enabled`, 'yes'];
    await expect(run()).rejects.toThrow('exit:1');

    vi.resetModules();
    process.argv = ['node', 'sp', 'edit', '--global', '--set', `${CLAUDE_BRIDGE_SWITCH_KEY}.default_model`, 'anthropic/claude-sonnet-4-6'];
    const again = await importEdit();
    await expect(again.run()).rejects.toThrow('exit:1');

    expect(await readFile(getGlobalUserConfigPath().path, 'utf-8')).toBe(before);
  });

  it('refuses an unknown segment in the block and names the available ones', async () => {
    await seed(home);
    process.argv = ['node', 'sp', 'edit', '--global', '--set', `${CLAUDE_BRIDGE_SWITCH_KEY}.enable`, 'true'];
    const { run } = await importEdit();
    await expect(run()).rejects.toThrow('exit:1');
    const message = errorSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(message).toContain('Unknown segment "enable"');
    expect(message).toContain('specialists');
  });
});

describe('sp init --global preserves the reserved block', () => {
  it('keeps the block verbatim and never reports it as an unshipped Specialist', () => {
    const block = { enabled: true, specialists: ['explorer'], default_model: 'claude-bridge/claude-sonnet-5-5' };
    const existing = { executor: { execution: { model: 'anthropic/claude-sonnet-4-6' } }, claude_bridge: block };
    const template = buildGlobalUserConfigTemplate(['executor']);

    const result = mergeGlobalUserConfig(existing as Record<string, unknown>, template);

    expect(result.removed).not.toContain(CLAUDE_BRIDGE_SWITCH_KEY);
    expect(result.notInstalledHere).not.toContain(CLAUDE_BRIDGE_SWITCH_KEY);
    expect(result.config[CLAUDE_BRIDGE_SWITCH_KEY]).toEqual(block);
    // A Specialist this machine cannot resolve is still reported — against its own list, since the
    // entry is kept and backfilled rather than treated as retired (SPECIALISTS-4448).
    const withRetired = { ...existing, 'retired-name': { execution: { model: 'x' } } };
    const retiredResult = mergeGlobalUserConfig(withRetired as Record<string, unknown>, template);
    expect(retiredResult.notInstalledHere).toContain('retired-name');
    expect(retiredResult.removed).not.toContain('retired-name');
    // ...and its one set value survives the backfill.
    expect((retiredResult.config['retired-name'] as { execution: { model: unknown } }).execution.model).toBe('x');
  });
});
