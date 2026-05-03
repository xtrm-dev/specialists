import { readFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LEGACY_PERMISSION_TOOL_STRINGS, resolveManifestTools, type ToolCatalog, type ToolTier } from '../../../src/specialist/manifest-resolver.js';

const TIERS: readonly ToolTier[] = ['READ_ONLY', 'LOW', 'MEDIUM', 'HIGH'];
async function loadCatalogs(): Promise<readonly ToolCatalog[]> {
  const index = JSON.parse(await readFile(join(process.cwd(), '.specialists/catalog/index.json'), 'utf8')) as { catalogs: ToolCatalog[] };
  return index.catalogs;
}

function makeHealthyState() {
  return {
    gitnexus: { health: 'loaded_healthy' as const, catalogCompatible: true },
    serena: { health: 'loaded_healthy' as const, catalogCompatible: true },
  };
}

describe('manifest resolver', () => {
  it.each(TIERS)('matches legacy tools byte-for-byte for %s', async tier => {
    const catalogs = await loadCatalogs();
    const resolved = resolveManifestTools({ tier, catalogs, extensionState: makeHealthyState() });
    expect(resolved.tools).toBe(LEGACY_PERMISSION_TOOL_STRINGS[tier]);
    expect(resolved.deniedNatives).toEqual([]);
  });

  it('keeps soft deny from changing --tools', async () => {
    const catalogs = await loadCatalogs();
    const resolved = resolveManifestTools({
      tier: 'READ_ONLY',
      catalogs,
      manifestPolicy: {
        permissions: {
          READ_ONLY: {
            denied_natives_when_extension: ['grep', 'find', 'ls'],
            denied_natives_mode: 'soft',
          },
        },
      },
      extensionState: makeHealthyState(),
    });

    expect(resolved.tools).toBe(LEGACY_PERMISSION_TOOL_STRINGS.READ_ONLY);
    expect(resolved.deniedNatives).toEqual([]);
    expect(resolved.deniedNativesMode).toBe('soft');
    expect(resolved.preferenceSignals).toEqual(['soft deny prefers extension tools for: grep,find,ls']);
    expect(resolved.downgradeReasons).toEqual([]);
  });

  it('hard deny strips natives only when replacement extensions are healthy', async () => {
    const catalogs = await loadCatalogs();
    const policy = {
      permissions: {
        READ_ONLY: {
          denied_natives_when_extension: ['grep', 'find', 'ls'],
          denied_natives_mode: 'hard' as const,
        },
      },
    };

    const healthy = resolveManifestTools({
      tier: 'READ_ONLY',
      catalogs,
      manifestPolicy: policy,
      extensionState: makeHealthyState(),
    });

    expect(healthy.tools).not.toContain('grep');
    expect(healthy.deniedNatives).toEqual(['grep', 'find', 'ls']);
    expect(healthy.downgradeReasons).toEqual([]);

    const restoreStates = [
      { extensionState: { gitnexus: { health: 'loaded_unhealthy' as const }, serena: { health: 'loaded_healthy' as const, catalogCompatible: true } } },
      { extensionState: { gitnexus: { health: 'loaded_healthy' as const, catalogCompatible: false }, serena: { health: 'loaded_healthy' as const, catalogCompatible: true } } },
      { extensionState: { gitnexus: { health: 'unknown' as const }, serena: { health: 'loaded_healthy' as const, catalogCompatible: true } } },
      { extensionState: { gitnexus: { health: 'disabled' as const }, serena: { health: 'loaded_healthy' as const, catalogCompatible: true } } },
    ] as const;

    for (const { extensionState } of restoreStates) {
      const restored = resolveManifestTools({
        tier: 'READ_ONLY',
        catalogs,
        manifestPolicy: policy,
        extensionState,
      });

      expect(restored.tools).toBe(LEGACY_PERMISSION_TOOL_STRINGS.READ_ONLY);
      expect(restored.deniedNatives).toEqual([]);
      expect(restored.downgradeReasons.join(' ')).toContain('restored native fallback');
      expect(restored.warnings.join(' ')).toContain('hard deny restored native fallback');
    }
  });

  it('enables explorer hard deny for grep, find, and ls only when replacement extensions are healthy', async () => {
    const catalogs = await loadCatalogs();
    const explorer = JSON.parse(await readFile(join(process.cwd(), 'config', 'specialists', 'explorer.specialist.json'), 'utf8')) as {
      specialist?: { permissions?: { READ_ONLY?: { denied_natives_when_extension?: readonly string[]; denied_natives_mode?: 'soft' | 'hard' } } };
    };
    const policy = explorer.specialist?.permissions;
    expect(policy?.READ_ONLY?.denied_natives_when_extension).toEqual(['grep', 'find', 'ls']);
    expect(policy?.READ_ONLY?.denied_natives_mode).toBe('hard');

    const healthy = resolveManifestTools({
      tier: 'READ_ONLY',
      catalogs,
      manifestPolicy: policy ? { permissions: policy } : undefined,
      extensionState: makeHealthyState(),
    });

    expect(healthy.toolsList).not.toContain('grep');
    expect(healthy.toolsList).not.toContain('find');
    expect(healthy.toolsList).not.toContain('ls');
    expect(healthy.toolsList).toContain('read');
    expect(healthy.deniedNatives).toEqual(['grep', 'find', 'ls']);

    const restored = resolveManifestTools({
      tier: 'READ_ONLY',
      catalogs,
      manifestPolicy: policy ? { permissions: policy } : undefined,
      extensionState: {
        gitnexus: { health: 'loaded_unhealthy' as const },
        serena: { health: 'loaded_healthy' as const, catalogCompatible: true },
      },
    });

    expect(restored.tools).toContain('grep');
    expect(restored.tools).toContain('find');
    expect(restored.tools).toContain('ls');
    expect(restored.tools).toContain('read');
    expect(restored.deniedNatives).toEqual([]);
    expect(restored.downgradeReasons.join(' ')).toContain('restored native fallback');
  });

  it('tracks extension state, specialist override, and yaml exclusions in resolved output', async () => {
    const catalogs = await loadCatalogs();
    const resolved = resolveManifestTools({
      tier: 'READ_ONLY',
      catalogs,
      manifestPolicy: {
        permissions: {
          READ_ONLY: {
            denied_natives_when_extension: ['grep'],
            denied_natives_mode: 'soft',
          },
        },
      },
      specialistOverride: {
        denied_natives_when_extension: ['find'],
        denied_natives_mode: 'hard',
      },
      yamlExclusions: {
        disabledExtensions: ['serena'],
        deniedNatives: ['ls'],
      },
      extensionState: {
        gitnexus: { health: 'loaded_healthy', catalogCompatible: true },
        serena: { health: 'disabled' },
      },
    });

    expect(resolved.warnings.some(w => w.includes('yaml exclusions'))).toBe(true);
    expect(resolved.attribution.some(entry => entry.layer === 'yaml_exclusion')).toBe(true);
    expect(resolved.tools).toContain('gitnexus_query');
    expect(resolved.tools).not.toContain('find_file');
  });
});
