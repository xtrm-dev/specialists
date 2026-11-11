/**
 * `sp doctor --specialists` for the Claude Code route block (SPECIALISTS-4442).
 *
 * Doctor is the only place an operator sees that the block and the layers disagree, so each
 * warning is asserted as text: legacy shape without a list, a listed Specialist that cannot
 * resolve a bridged model, a definition flag on an unlisted Specialist, a bridged primary with
 * fallbacks, a redundant per-Specialist entry, and a malformed block read through the same reader
 * the route decision uses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { buildSpecialistOverrideTemplate } from '../../../src/specialist/global-config.js';

// Each test sees only the fixtures it writes: no installed package canonical dir.
vi.mock('../../../src/specialist/canonical-asset-resolver.js', () => ({
  resolveCanonicalAssetDir: () => null,
}));

const SPEC = (name: string, execution: Record<string, unknown>) => JSON.stringify({
  specialist: {
    metadata: { name, version: '1.0.0', description: 'demo', category: 'test' },
    execution: { permission_required: 'READ_ONLY', ...execution },
    prompt: { task_template: 'Do $prompt' },
  },
});

describe('doctor --specialists: claude_bridge block (SPECIALISTS-4442)', () => {
  let project: string;
  let home: string;
  let originalHome: string | undefined;
  let originalXdg: string | undefined;
  let originalCwd: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'doctor-bridge-proj-'));
    home = await mkdtemp(join(tmpdir(), 'doctor-bridge-home-'));
    mkdirSync(join(project, 'config', 'specialists'), { recursive: true });
    originalHome = process.env.HOME;
    originalXdg = process.env.XDG_CONFIG_HOME;
    originalCwd = process.cwd();
    process.env.HOME = home;
    delete process.env.XDG_CONFIG_HOME;
    process.chdir(project);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    vi.restoreAllMocks();
    vi.resetModules();
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  function writePackageSpec(name: string, execution: Record<string, unknown> = {}): void {
    writeFileSync(join(project, 'config', 'specialists', `${name}.specialist.json`), SPEC(name, execution));
  }
  function writeGlobal(document: Record<string, unknown>): void {
    const dir = join(home, '.config', 'specialists');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'user.json'), JSON.stringify(document));
  }
  function writeRepoSpec(name: string, execution: Record<string, unknown>): void {
    mkdirSync(join(project, '.specialists', 'user'), { recursive: true });
    writeFileSync(join(project, '.specialists', 'user', `${name}.specialist.json`), JSON.stringify({ specialist: { execution } }));
  }
  const model = (name: string) => 'anthropic/claude-sonnet-4-6';

  async function runDoctor(): Promise<string> {
    const output: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => output.push(String(msg ?? '')));
    const { run } = await import('../../../src/cli/doctor.js');
    await run(['--specialists']);
    log.mockRestore();
    return output.join('\n');
  }

  it('says the route is off when the block is absent', async () => {
    writePackageSpec('demo', { model: model('demo') });
    writeGlobal({ demo: { ...buildSpecialistOverrideTemplate(), execution: { ...buildSpecialistOverrideTemplate().execution, model: model('demo') } } });

    expect(await runDoctor()).toContain('Claude Code route: off (no claude_bridge block)');
  });

  it('reports a malformed block through the route reader', async () => {
    writePackageSpec('demo', { model: model('demo') });
    writeGlobal({ claude_bridge: { enabled: true, specialists: ['demo'], default_model: 'claude-bridge/x', surprise: true } });

    const out = await runDoctor();
    expect(out).toContain('claude_bridge block is invalid');
    expect(out).toContain('surprise');
  });

  it('reports the legacy shape (enabled, no allow list) and suggests the list', async () => {
    writePackageSpec('demo', { model: model('demo') });
    writeGlobal({ claude_bridge: { enabled: true } });

    const out = await runDoctor();
    expect(out).toContain('legacy shape');
    expect(out).toContain('claude_bridge.specialists');
  });

  it('fails a listed Specialist whose block entry is not a bridged model, naming it', async () => {
    writePackageSpec('demo', { model: model('demo') });
    writeGlobal({ claude_bridge: { enabled: true, specialists: ['demo'], models: { demo: 'anthropic/claude-sonnet-4-6' } } });

    const out = await runDoctor();
    expect(out).toContain('claude_bridge block is invalid');
    expect(out).toContain('demo: listed in claude_bridge.specialists');
    expect(out).toContain('resolves no claude-bridge/... model');
    expect(out).toContain('"anthropic/claude-sonnet-4-6"');
  });

  it('fails a listed Specialist whose block lists no model for it', async () => {
    writePackageSpec('demo', { model: model('demo') });
    writeGlobal({ claude_bridge: { enabled: true, specialists: ['demo'] } });

    const out = await runDoctor();
    expect(out).toContain('demo: listed in claude_bridge.specialists');
    expect(out).toContain('has no bridge model');
  });

  it('warns about a definition flag on a Specialist the allow list does not name', async () => {
    writePackageSpec('demo', { model: model('demo') });
    writeRepoSpec('demo', { claude_bridge: true, model: 'claude-bridge/claude-opus-5-5' });
    writeGlobal({ claude_bridge: { enabled: true, specialists: ['other'], default_model: 'claude-bridge/x' } });

    const out = await runDoctor();
    expect(out).toContain('demo: requests the Claude Code route');
    expect(out).toContain('the operator allow list does not name it');
  });

  it('warns that a bridged primary makes fallbacks inert instead of rewriting them', async () => {
    writePackageSpec('demo', { model: model('demo') });
    writeRepoSpec('demo', { model: 'claude-bridge/claude-opus-5-5', fallback_models: ['otherprov/other-model'] });
    writeGlobal({ claude_bridge: { enabled: true, specialists: ['demo'], default_model: 'claude-bridge/claude-sonnet-5-5' } });

    const out = await runDoctor();
    expect(out).toContain('primary claude-bridge/');
    expect(out).toContain('fallbacks never run');
  });

  it('reports a per-Specialist selection the allow list now owns as redundant', async () => {
    writePackageSpec('demo', { model: model('demo') });
    const template = buildSpecialistOverrideTemplate();
    writeGlobal({
      claude_bridge: { enabled: true, specialists: ['demo'], default_model: 'claude-bridge/x' },
      demo: { ...template, execution: { ...template.execution, model: model('demo'), claude_bridge: true } },
    });

    const out = await runDoctor();
    expect(out).toContain('claude_bridge.specialists owns the route for: demo');
  });

  it('warns about an allow-list name that resolves to no Specialist', async () => {
    writePackageSpec('demo', { model: model('demo') });
    writeGlobal({ claude_bridge: { enabled: true, specialists: ['demo', 'ghost'], default_model: 'claude-bridge/x' } });

    const out = await runDoctor();
    expect(out).toContain('allow list names Specialist(s) that do not resolve: ghost');
  });
});
