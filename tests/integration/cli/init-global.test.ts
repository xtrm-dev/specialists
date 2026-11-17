import { afterEach, describe, expect, it } from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { spawnSync } from 'node:child_process';
import { SpecialistLoader } from '../../../src/specialist/loader.js';
import {
  GLOBAL_USER_CONFIG_DOC,
  buildSpecialistOverrideTemplate,
} from '../../../src/specialist/global-config.js';
import { tempDir } from '../../utils/temp-dir.js';

const repoRoot = resolve(import.meta.dirname, '../../..');

function runInitGlobal(home: string) {
  return spawnSync('bun', ['run', join(repoRoot, 'src/index.ts'), 'init', '--global'], {
    cwd: repoRoot,
    encoding: 'utf-8',
    env: {
      ...process.env,
      HOME: home,
      NO_COLOR: '1',
      SPECIALISTS_INIT_FORCE: '1',
      XDG_CONFIG_HOME: '',
    },
  });
}

function runCli(home: string, args: string[]) {
  return spawnSync('bun', ['run', join(repoRoot, 'src/index.ts'), ...args], {
    cwd: repoRoot,
    encoding: 'utf-8',
    env: { ...process.env, HOME: home, NO_COLOR: '1', XDG_CONFIG_HOME: '' },
  });
}

describe('integration: specialists init --global', () => {
  let tempHome: string;

  afterEach(async () => {
    if (tempHome) await rm(tempHome, { recursive: true, force: true });
  });

  it('writes doc sentinel, full override templates, discovery hints, and stays idempotent', async () => {
    tempHome = tempDir('specialists-int-init-global-');
    // Hermetic HOME (unitAI-o1fs4): list() must see only the package layer, never the live
    // user.json — a legacy unpinned npm key there now fails closed at the merge boundary.
    const originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    const loader = new SpecialistLoader({ projectDir: repoRoot });
    const shipped = await loader.list();
    process.env.HOME = originalHome;
    const shippedNames = shipped.map(item => item.name).sort();

    expect(shippedNames).not.toContain('_doc');

    const first = runInitGlobal(tempHome);
    expect(first.status).toBe(0);
    expect(first.stderr).toBe('');
    expect(first.stdout).toContain('extensions');
    expect(first.stdout).toMatch(/fallback_models|fallback chains/);
    expect(first.stdout).toMatch(/@preset|preset refs|preset references/);

    const userConfigPath = join(tempHome, '.config', 'specialists', 'user.json');
    const firstParsed = JSON.parse(await readFile(userConfigPath, 'utf-8')) as Record<string, unknown>;
    const firstSpecialistNames = Object.keys(firstParsed).filter(name => !name.startsWith('_')).sort();

    expect(firstParsed._doc).toBe(GLOBAL_USER_CONFIG_DOC);
    expect(firstSpecialistNames).toEqual(shippedNames);
    expect(firstSpecialistNames).toHaveLength(shipped.length);

    for (const name of shippedNames) {
      expect(firstParsed[name]).toEqual(buildSpecialistOverrideTemplate());
    }

    firstParsed._doc = GLOBAL_USER_CONFIG_DOC;
    (firstParsed[shippedNames[0]] as Record<string, unknown>).beads_write_notes = false;
    const execution = (firstParsed[shippedNames[0]] as Record<string, unknown>).execution as Record<string, unknown>;
    execution.model = 'openai-codex/gpt-5.4-mini';
    execution.extensions = {
      gitnexus: false,
      'npm:@jaggerxtrm/pi-service-knowledge@1.0.0': true,
    };
    await writeFile(userConfigPath, `${JSON.stringify(firstParsed, null, 2)}\n`, 'utf-8');

    const second = runInitGlobal(tempHome);
    expect(second.status).toBe(0);
    expect(second.stderr).toBe('');

    const secondParsed = JSON.parse(await readFile(userConfigPath, 'utf-8')) as Record<string, unknown>;
    expect(secondParsed._doc).toBe(GLOBAL_USER_CONFIG_DOC);
    expect((secondParsed[shippedNames[0]] as Record<string, unknown>).beads_write_notes).toBe(false);
    const secondExecution = ((secondParsed[shippedNames[0]] as Record<string, unknown>).execution as Record<string, unknown>);
    expect(secondExecution.model).toBe('openai-codex/gpt-5.4-mini');
    expect(secondExecution.extensions).toEqual({
      gitnexus: false,
      'npm:@jaggerxtrm/pi-service-knowledge@1.0.0': true,
    });
    expect(Object.keys(secondParsed).filter(name => name === '_doc')).toHaveLength(1);
  });
});

describe('integration: short user.json entries (SPECIALISTS-4448)', () => {
  let tempHome: string;

  afterEach(async () => {
    if (tempHome) await rm(tempHome, { recursive: true, force: true });
  });

  const readConfig = async (home: string): Promise<Record<string, any>> =>
    JSON.parse(await readFile(join(home, '.config', 'specialists', 'user.json'), 'utf-8')) as Record<string, any>;

  const writeShort = async (home: string, config: Record<string, unknown>): Promise<void> => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(home, '.config', 'specialists'), { recursive: true });
    await writeFile(join(home, '.config', 'specialists', 'user.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  };

  it('sp init --global backfills a short entry for a Specialist this machine cannot resolve, keeping values', async () => {
    tempHome = tempDir('specialists-int-short-entry-');
    // `frontend-auditor` is deliberately a name no layer here defines: the defect was that such an
    // entry was copied verbatim while resolvable ones were backfilled.
    await writeShort(tempHome, {
      'pr-reviewer': { execution: { model: 'anthropic/claude-opus-4-6' } },
      'frontend-auditor': { execution: { timeout_ms: 900_000 } },
      'sre-coordinator': {},
    });

    const run = runInitGlobal(tempHome);
    expect(run.status).toBe(0);
    // init reports it through warn(), which writes stderr, so the notice is asserted there.
    expect(run.stderr).toContain('frontend-auditor is not installed on this machine');

    const parsed = await readConfig(tempHome);
    const template = buildSpecialistOverrideTemplate() as Record<string, any>;
    for (const name of ['pr-reviewer', 'frontend-auditor', 'sre-coordinator']) {
      expect(Object.keys(parsed[name]).sort(), name).toEqual(Object.keys(template).sort());
      expect(Object.keys(parsed[name].execution).sort(), name).toEqual(Object.keys(template.execution).sort());
    }
    // Every value the operator set is untouched; everything else is the inherit default.
    expect(parsed['pr-reviewer'].execution.model).toBe('anthropic/claude-opus-4-6');
    expect(parsed['frontend-auditor'].execution.timeout_ms).toBe(900_000);
    expect(parsed['frontend-auditor'].execution.model).toBeNull();
    expect(parsed['sre-coordinator'].execution.timeout_ms).toBeNull();
  });

  it('sp init --global keeps an unresolvable entry instead of dropping it', async () => {
    tempHome = tempDir('specialists-int-short-keep-');
    await writeShort(tempHome, { 'frontend-auditor': { execution: { timeout_ms: 900_000 } } });
    expect(runInitGlobal(tempHome).status).toBe(0);
    const parsed = await readConfig(tempHome);
    expect(parsed['frontend-auditor'].execution.timeout_ms).toBe(900_000);
  });

  it('repairs the file end to end: doctor reports the short entry, init fixes it, edit writes again', async () => {
    tempHome = tempDir('specialists-int-short-e2e-');
    await writeShort(tempHome, {
      'pr-reviewer': { execution: { model: 'anthropic/claude-opus-4-6' } },
      'sre-coordinator': {},
    });

    // Before: the file does not validate, so every sp edit --global write is refused. Doctor must
    // name the one-line repair rather than only printing "Required" six times.
    const doctorBefore = runCli(tempHome, ['doctor']);
    expect(doctorBefore.stdout).toContain('global user config failed validation');
    expect(doctorBefore.stdout).toContain('sp init --global');

    expect(runInitGlobal(tempHome).status).toBe(0);

    const doctorAfter = runCli(tempHome, ['doctor']);
    expect(doctorAfter.stdout).toContain('user config matches the current template');
    expect(doctorAfter.stdout).not.toContain('global user config failed validation');

    // After: the write that failed on the operator's machine succeeds, and it adds only its key.
    const edit = runCli(tempHome, ['edit', '--global', 'claude_bridge.default_model', 'claude-bridge/claude-sonnet-5-5']);
    expect(edit.status).toBe(0);
    const parsed = await readConfig(tempHome);
    expect(parsed.claude_bridge.default_model).toBe('claude-bridge/claude-sonnet-5-5');
    expect(parsed['pr-reviewer'].execution.model).toBe('anthropic/claude-opus-4-6');
    expect(parsed['sre-coordinator'].execution.timeout_ms).toBeNull();
  });
});
