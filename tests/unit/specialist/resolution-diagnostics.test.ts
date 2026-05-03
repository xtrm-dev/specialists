import { classifyExtensionProbe, formatResolvedConfigReport } from '../../../src/specialist/resolution-diagnostics.js';

const CATALOG = {
  catalog: 'serena',
  package: 'pi-serena-tools',
  version: '0.1.0',
  precedence: 2,
  source_tiers: {
    READ_ONLY: ['serena_list_tools'],
    LOW: ['serena_list_tools'],
    MEDIUM: ['serena_list_tools'],
    HIGH: ['serena_list_tools'],
  },
} as const;

describe('resolution diagnostics', () => {
  it('classifies missing package, mismatch, degraded, and healthy probes', () => {
    expect(classifyExtensionProbe(CATALOG, {})).toMatchObject({ health: 'not_installed', drift: 'none' });
    expect(classifyExtensionProbe(CATALOG, { installedVersion: '9.9.9', entrypointExists: true })).toMatchObject({ health: 'loaded_unhealthy', drift: 'catalog_mismatch' });
    expect(classifyExtensionProbe(CATALOG, { installedVersion: '0.1.0', entrypointExists: false })).toMatchObject({ health: 'loaded_unhealthy', drift: 'degraded' });
    expect(classifyExtensionProbe(CATALOG, { installedVersion: '0.1.0', entrypointExists: true })).toMatchObject({ health: 'loaded_healthy', drift: 'none' });
  });

  it('formats resolved report with attribution and tools', () => {
    const output = formatResolvedConfigReport({
      specialist: 'executor',
      manifest: { specialist: { metadata: { name: 'executor' } } },
      catalogs: [CATALOG],
      extensionAvailability: [classifyExtensionProbe(CATALOG, { installedVersion: '0.1.0', entrypointExists: true })],
      catalogCompatibility: [],
      resolver: {
        tools: 'read,ls,serena_list_tools',
        toolsList: ['read', 'ls', 'serena_list_tools'],
        deniedNatives: [],
        deniedNativesMode: 'soft',
        preferenceSignals: [],
        downgradeReasons: ['restored native fallback for read due to loaded_unhealthy'],
        warnings: [],
        attribution: [{ layer: 'tier_policy', source: 'manifest policy', tools: ['read', 'ls'] }],
      },
    });

    expect(output).toContain('specialist: executor');
    expect(output).toContain('layer attribution:');
    expect(output).toContain('downgrade reasons: restored native fallback for read due to loaded_unhealthy');
    expect(output).toContain('--tools: read,ls,serena_list_tools');
  });
});
