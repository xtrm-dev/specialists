import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRuntimeToolContract } from '../../../src/pi/session.js';
import { catalogVersion } from '../../utils/catalog-pin.js';

/**
 * The runtime gate is a compatibility check, not an identity check (SPECIALISTS-42).
 *
 * Before this change the gate compared with `!==`, so an extension one patch ahead of the
 * catalog pin resolved `loaded_unhealthy` and every tool it contributed disappeared from the
 * contract. That is exactly what happened in production: the gitnexus pin sat at 0.6.1 while
 * 0.6.2/0.6.3/0.6.4 shipped.
 *
 * The global module dir is supplied by the fixture rather than inherited from the host, so this
 * cannot become a machine-dependent test: it passes on a machine with no extensions installed.
 */
function withFakeGlobalDir<T>(version: string, run: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-compat-'));
  const previous = process.env.PI_NPM_GLOBAL_DIR;
  try {
    mkdirSync(join(dir, 'pi-gitnexus'), { recursive: true });
    writeFileSync(
      join(dir, 'pi-gitnexus', 'package.json'),
      JSON.stringify({ name: 'pi-gitnexus', version }),
    );
    process.env.PI_NPM_GLOBAL_DIR = dir;
    return run();
  } finally {
    if (previous === undefined) delete process.env.PI_NPM_GLOBAL_DIR;
    else process.env.PI_NPM_GLOBAL_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

function gitnexusContract() {
  return resolveRuntimeToolContract({
    level: 'READ_ONLY',
    specialistName: 'explorer',
    cwd: process.cwd(),
  })!;
}

const BASELINE = catalogVersion('gitnexus');

/** The next patch release on the baseline's own line — the case that used to break everything. */
function nextPatch(baseline: string): string {
  const [major, minor, patch] = baseline.split('.').map(Number);
  return `${major}.${minor}.${patch! + 1}`;
}

describe('catalog compatibility gate', () => {
  it('accepts a patch release above the pin, which the equality gate refused', () => {
    const ahead = nextPatch(BASELINE);
    const contract = withFakeGlobalDir(ahead, gitnexusContract);

    expect(contract.extensions.gitnexus.status).toBe('available');
    expect(contract.toolsList).toContain('gitnexus_query');
    expect(contract.warnings.join(' | ')).not.toContain('outside the compatible range');
  });

  it('still accepts the pinned build itself', () => {
    const contract = withFakeGlobalDir(BASELINE, gitnexusContract);
    expect(contract.extensions.gitnexus.status).toBe('available');
    expect(contract.warnings.join(' | ')).not.toContain('outside the compatible range');
  });

  it('refuses a version outside the line, and names why', () => {
    const [major, minor] = BASELINE.split('.').map(Number);
    const breaking = `${major}.${minor! + 1}.0`;
    const contract = withFakeGlobalDir(breaking, gitnexusContract);

    expect(contract.extensions.gitnexus.status).toBe('loaded_unhealthy');
    expect(contract.toolsList).not.toContain('gitnexus_query');
    const notes = [...contract.warnings, ...contract.downgradeReasons].join(' | ');
    expect(notes).toContain('outside the compatible range');
    expect(notes).toContain(breaking);
    expect(notes).toContain(BASELINE);
  });
});
