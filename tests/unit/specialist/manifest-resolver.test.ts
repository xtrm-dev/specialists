import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LEGACY_PERMISSION_TOOL_STRINGS,
  resolveManifestTools,
  type ToolCatalog,
  type ToolTier,
} from '../../../src/specialist/manifest-resolver.js';

const TIERS: readonly ToolTier[] = ['READ_ONLY', 'LOW', 'MEDIUM', 'HIGH'];
const HEALTHS = ['loaded_healthy', 'loaded_unhealthy', 'not_installed', 'unknown'] as const;

async function loadCatalogs(): Promise<readonly ToolCatalog[]> {
  const index = JSON.parse(await readFile(join(process.cwd(), '.specialists/catalog/index.json'), 'utf8')) as { catalogs: ToolCatalog[] };
  return index.catalogs;
}

function makeHealthyState() {
  return {
    gitnexus: { health: 'loaded_healthy' as const },
    serena: { health: 'loaded_healthy' as const },
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
  });

  it('hard deny strips natives only when replacement extensions are healthy', async () => {
    const catalogs = await loadCatalogs();
    const healthy = resolveManifestTools({
      tier: 'READ_ONLY',
      catalogs,
      manifestPolicy: {
        permissions: {
          READ_ONLY: {
            denied_natives_when_extension: ['grep', 'find', 'ls'],
            denied_natives_mode: 'hard',
          },
        },
      },
      extensionState: makeHealthyState(),
    });

    expect(healthy.tools).not.toContain('grep');
    expect(healthy.deniedNatives).toEqual(['grep', 'find', 'ls']);

    for (const health of HEALTHS) {
      if (health === 'loaded_healthy') continue;
      const degraded = resolveManifestTools({
        tier: 'READ_ONLY',
        catalogs,
        manifestPolicy: {
          permissions: {
            READ_ONLY: {
              denied_natives_when_extension: ['grep', 'find', 'ls'],
              denied_natives_mode: 'hard',
            },
          },
        },
        extensionState: {
          gitnexus: { health },
          serena: { health },
        },
      });

      expect(degraded.tools).toBe(LEGACY_PERMISSION_TOOL_STRINGS.READ_ONLY);
      expect(degraded.deniedNatives).toEqual([]);
    }
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
        gitnexus: { health: 'loaded_healthy' },
        serena: { health: 'disabled' },
      },
    });

    expect(resolved.warnings.some(w => w.includes('yaml exclusions'))).toBe(true);
    expect(resolved.attribution.some(entry => entry.layer === 'yaml_exclusion')).toBe(true);
    expect(resolved.tools).toContain('gitnexus_query');
    expect(resolved.tools).not.toContain('find_file');
  });
});
