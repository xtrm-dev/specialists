/**
 * The Claude Code route as an operator allow list (SPECIALISTS-4442, Option A).
 *
 * The properties that matter:
 *  - one block in ~/.config/specialists/user.json selects the route for named Specialists;
 *  - the block is authoritative BOTH ways after every layer, so a repository layer can neither
 *    enable the route nor redirect a listed Specialist's model;
 *  - absent/malformed/invalid content fails closed, and a listed Specialist that cannot resolve a
 *    bridged model is refused with a dedicated error instead of running on another provider.
 *
 * Every test is hermetic: HOME and XDG_CONFIG_HOME are pointed at a temp dir, so no real operator
 * file is read and no real consent record is touched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ClaudeBridgeRouteModelMismatchError,
  SpecialistLoader,
  resolveClaudeBridgeRoute,
  type ClaudeBridgeRouteDecision,
} from '../../../src/specialist/loader.js';
import {
  CLAUDE_BRIDGE_SWITCH_KEY,
  ClaudeBridgeBlockSchema,
  readClaudeBridgeBlock,
  validateGlobalUserConfig,
} from '../../../src/specialist/global-config.js';
import {
  claudeBridgeRouteEnabled,
  claudeBridgeSessionOption,
  operatorClaudeBridgeEnabled,
} from '../../../src/pi/claude-bridge.js';

const spec = (name: string, execution: Record<string, unknown> = {}) => JSON.stringify({
  specialist: {
    metadata: { name, version: '1.0.0', description: 'Test Specialist', category: 'test' },
    execution: { model: 'anthropic/claude-sonnet-4-6', ...execution },
    prompt: { task_template: 'Do $prompt' },
  },
});

describe('claude_bridge allow list (SPECIALISTS-4442)', () => {
  let root: string;
  let xdg: string;
  let project: string;
  let previousHome: string | undefined;
  let previousXdg: string | undefined;
  let stderr: ReturnType<typeof vi.spyOn>;

  const writePackageSpec = (name: string, execution: Record<string, unknown> = {}) => {
    mkdirSync(join(project, 'config', 'specialists'), { recursive: true });
    writeFileSync(join(project, 'config', 'specialists', `${name}.specialist.json`), spec(name, execution));
  };
  const writeHomeSpec = (name: string, execution: Record<string, unknown>) => {
    mkdirSync(join(project, '..', 'home', '.specialists', 'user'), { recursive: true });
    writeFileSync(
      join(project, '..', 'home', '.specialists', 'user', `${name}.specialist.json`),
      JSON.stringify({ specialist: { execution } }),
    );
  };
  const writeRepoSpec = (name: string, execution: Record<string, unknown>) => {
    mkdirSync(join(project, '.specialists', 'user'), { recursive: true });
    writeFileSync(join(project, '.specialists', 'user', `${name}.specialist.json`), JSON.stringify({ specialist: { execution } }));
  };
  const writeUserJson = (document: Record<string, unknown>) => {
    mkdirSync(join(xdg, 'specialists'), { recursive: true });
    writeFileSync(join(xdg, 'specialists', 'user.json'), JSON.stringify(document, null, 2));
  };
  const loader = () => new SpecialistLoader({ projectDir: project });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'claude-bridge-allow-'));
    xdg = join(root, 'xdg');
    project = join(root, 'project');
    mkdirSync(project, { recursive: true });
    previousHome = process.env.HOME;
    previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.HOME = join(root, 'home');
    process.env.XDG_CONFIG_HOME = xdg;
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    rmSync(root, { recursive: true, force: true });
  });

  it('applies the block to a shipped Specialist: bridged model, flag on, one entry instead of 25', async () => {
    writePackageSpec('explorer');
    writeUserJson({
      claude_bridge: {
        enabled: true,
        default_model: 'claude-bridge/claude-sonnet-5-5',
        specialists: ['explorer', 'reviewer'],
      },
    });

    const merged = await loader().get('explorer');

    expect(merged.specialist.execution.model).toBe('claude-bridge/claude-sonnet-5-5');
    expect(merged.specialist.execution.claude_bridge).toBe(true);
    // The per-run/per-runtime readers consume this one merged spec.
    expect(claudeBridgeRouteEnabled(merged.specialist.execution)).toBe(true);
    expect(claudeBridgeSessionOption(merged.specialist.execution)).toEqual({ claudeBridge: true });
    expect(operatorClaudeBridgeEnabled()).toBe(true);
  });

  it('honours a per-name model over default_model', async () => {
    writePackageSpec('advisor');
    writeUserJson({
      claude_bridge: {
        enabled: true,
        default_model: 'claude-bridge/claude-sonnet-5-5',
        specialists: ['advisor'],
        models: { advisor: 'claude-bridge/claude-opus-5-5' },
      },
    });

    const merged = await loader().get('advisor');

    expect(merged.specialist.execution.model).toBe('claude-bridge/claude-opus-5-5');
    expect(merged.specialist.execution.claude_bridge).toBe(true);
  });

  it('is authoritative both ways: a repo layer cannot disable or redirect a listed Specialist', async () => {
    writePackageSpec('explorer');
    writeUserJson({
      claude_bridge: {
        enabled: true,
        default_model: 'claude-bridge/claude-sonnet-5-5',
        specialists: ['explorer'],
      },
    });
    // Both fields are override-allowed and this layer outranks user.json everywhere else.
    writeRepoSpec('explorer', { model: 'anthropic/claude-sonnet-4-6', claude_bridge: false });

    const instance = loader();
    const merged = await instance.get('explorer');

    expect(merged.specialist.execution.model).toBe('claude-bridge/claude-sonnet-5-5');
    expect(merged.specialist.execution.claude_bridge).toBe(true);

    const decision = instance.getClaudeBridgeDecision('explorer');
    expect(decision?.reason).toBe('listed');
    expect(decision?.shadowed).toEqual([
      { field: 'execution.claude_bridge', layerValue: false, blockValue: true },
      { field: 'execution.model', layerValue: 'anthropic/claude-sonnet-4-6', blockValue: 'claude-bridge/claude-sonnet-5-5' },
    ]);
    // Provenance warning is visible without running doctor.
    const written = stderr.mock.calls.map(call => String(call[0])).join('');
    expect(written).toContain("overrides 'explorer'");
    expect(written).toContain('execution.model');
  });

  it('turns the route OFF for an unlisted Specialist even when a repo layer sets the flag', async () => {
    writePackageSpec('explorer');
    writeRepoSpec('explorer', { model: 'claude-bridge/claude-opus-5-5', claude_bridge: true });
    writeUserJson({
      claude_bridge: {
        enabled: true,
        default_model: 'claude-bridge/claude-sonnet-5-5',
        specialists: ['advisor'],
      },
    });

    const instance = loader();
    const merged = await instance.get('explorer');

    expect(merged.specialist.execution.claude_bridge).toBe(false);
    expect(claudeBridgeRouteEnabled(merged.specialist.execution)).toBe(false);
    expect(minimal(instance.getClaudeBridgeDecision('explorer'))).toMatchObject({
      reason: 'unlisted',
      listed: false,
      enabled: false,
    });
  });

  it('enabled: false is a kill switch for every Specialist', async () => {
    writePackageSpec('explorer', { model: 'claude-bridge/claude-opus-5-5', claude_bridge: true });
    writeUserJson({
      claude_bridge: { enabled: false, default_model: 'claude-bridge/claude-sonnet-5-5', specialists: ['explorer'] },
    });

    const instance = loader();
    const merged = await instance.get('explorer');

    expect(claudeBridgeRouteEnabled(merged.specialist.execution)).toBe(false);
    expect(operatorClaudeBridgeEnabled()).toBe(false);
    expect(instance.getClaudeBridgeDecision('explorer')?.reason).toBe('block_disabled');
  });

  it('specialists: [] means no Specialist, never all', async () => {
    writePackageSpec('explorer', { model: 'claude-bridge/claude-opus-5-5', claude_bridge: true });
    writeUserJson({
      claude_bridge: { enabled: true, default_model: 'claude-bridge/claude-sonnet-5-5', specialists: [] },
    });

    const instance = loader();
    const merged = await instance.get('explorer');

    expect(merged.specialist.execution.claude_bridge).toBe(false);
    expect(claudeBridgeRouteEnabled(merged.specialist.execution)).toBe(false);
  });

  it('keeps the legacy rule when the block has no allow list', async () => {
    writePackageSpec('explorer', { model: 'claude-bridge/claude-opus-5-5', claude_bridge: true });
    writeUserJson({ claude_bridge: { enabled: true } });

    const instance = loader();
    const merged = await instance.get('explorer');

    expect(merged.specialist.execution.claude_bridge).toBe(true);
    expect(instance.getClaudeBridgeDecision('explorer')?.reason).toBe('legacy_no_list');
  });

  it('home-layer consent still works when the block has no allow list (migration window)', async () => {
    writePackageSpec('advisor');
    writeHomeSpec('advisor', { model: 'claude-bridge/claude-opus-5-5', claude_bridge: true });
    writeUserJson({ claude_bridge: { enabled: true } });

    const merged = await loader().get('advisor');

    expect(merged.specialist.execution.model).toBe('claude-bridge/claude-opus-5-5');
    expect(claudeBridgeRouteEnabled(merged.specialist.execution)).toBe(true);
  });

  it('refuses a wildcard allow-list entry at write time', () => {
    const result = validateGlobalUserConfig(JSON.stringify({
      claude_bridge: { enabled: true, default_model: 'claude-bridge/claude-sonnet-5-5', specialists: ['*'] },
    }));

    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.path.startsWith('claude_bridge.specialists'))).toBe(true);
    expect(ClaudeBridgeBlockSchema.safeParse({ enabled: true, specialists: ['*'] }).success).toBe(false);
  });

  it('refuses a non-bridged model in the block at write time', () => {
    const result = validateGlobalUserConfig(JSON.stringify({
      claude_bridge: { enabled: true, specialists: ['explorer'], default_model: 'anthropic/claude-sonnet-4-6' },
    }));

    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.path === 'claude_bridge.default_model')).toBe(true);
  });

  it('fails closed on a hand-edited block that cannot give a listed Specialist a bridged model', async () => {
    writePackageSpec('explorer');
    writeUserJson({
      // Hand-edited: the per-name model is not a bridge model, so the block is invalid as a whole.
      claude_bridge: { enabled: true, specialists: ['explorer'], models: { explorer: 'anthropic/claude-sonnet-4-6' } },
    });

    const instance = loader();
    const refusal = await instance.get('explorer').catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ClaudeBridgeRouteModelMismatchError);
    expect((refusal as ClaudeBridgeRouteModelMismatchError).code).toBe('claude_bridge_route_model_mismatch');
    expect((refusal as Error).message).toContain('explorer');
    expect((refusal as Error).message).toContain('anthropic/claude-sonnet-4-6');
    expect((refusal as Error).message).toContain(join(xdg, 'specialists', 'user.json'));

    const read = readClaudeBridgeBlock();
    expect(read.error).not.toBeNull();
    expect(read.listedNames).toEqual(['explorer']);
  });

  it('does not break an unlisted Specialist when the block is malformed', async () => {
    writePackageSpec('explorer');
    writeUserJson({
      claude_bridge: { enabled: true, specialists: ['advisor'], models: { advisor: 'nope' }, surprise: true },
    });

    const instance = loader();
    const merged = await instance.get('explorer');

    expect(merged.specialist.execution.model).toBe('anthropic/claude-sonnet-4-6');
    expect(merged.specialist.execution.claude_bridge).toBe(false);
    expect(instance.getClaudeBridgeDecision('explorer')?.reason).toBe('block_invalid');
  });
});

describe('resolveClaudeBridgeRoute (pure precedence)', () => {
  const read = (block: unknown) => block === undefined
    ? { present: false, block: null, error: null, listedNames: [], path: '/tmp/user.json' }
    : (() => {
        const parsed = ClaudeBridgeBlockSchema.safeParse(block);
        return parsed.success
          ? { present: true, block: parsed.data, error: null, listedNames: [], path: '/tmp/user.json' }
          : { present: true, block: null, error: 'invalid', listedNames: [], path: '/tmp/user.json' };
      })();

  it.each<[string, unknown, { claude_bridge?: unknown; model?: unknown } | undefined, Partial<ClaudeBridgeRouteDecision>]>([
    ['absent block keeps the definition flag', undefined, { claude_bridge: true, model: 'claude-bridge/x' }, { reason: 'block_absent', source: 'legacy', enabled: true }],
    ['disabled block is off', { enabled: false, specialists: [], default_model: 'claude-bridge/x' }, { claude_bridge: true }, { reason: 'block_disabled', enabled: false }],
    ['no list keeps the legacy rule', { enabled: true }, { claude_bridge: true }, { reason: 'legacy_no_list', enabled: true }],
    ['listed is on with the block model', { enabled: true, specialists: ['a'], default_model: 'claude-bridge/x' }, { model: 'anthropic/y' }, { reason: 'listed', enabled: true, model: 'claude-bridge/x' }],
    ['unlisted is off even with the definition flag', { enabled: true, specialists: ['b'], default_model: 'claude-bridge/x' }, { claude_bridge: true }, { reason: 'unlisted', enabled: false }],
  ])('%s', (_label, block, execution, expected) => {
    const decision = resolveClaudeBridgeRoute('a', execution, read(block) as never);
    expect(decision).toMatchObject(expected);
  });
});

function minimal(decision: ClaudeBridgeRouteDecision | undefined) {
  return decision && {
    reason: decision.reason,
    listed: decision.listed,
    enabled: decision.enabled,
    model: decision.model,
  };
}
