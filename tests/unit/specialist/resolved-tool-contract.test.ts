import { describe, expect, it } from 'vitest';
import { buildResolvedToolContract, formatResolvedToolContract, withDiscoveredExtensionTools } from '../../../src/specialist/resolved-tool-contract.js';
import type { ToolCatalog } from '../../../src/specialist/manifest-resolver.js';

const catalogs: readonly ToolCatalog[] = [
  {
    catalog: 'native',
    precedence: 0,
    source_tiers: {
      READ_ONLY: ['read', 'grep', 'find', 'ls'],
      LOW: ['read', 'grep', 'find', 'ls', 'bash'],
      MEDIUM: ['read', 'grep', 'find', 'ls', 'bash', 'edit'],
      HIGH: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'],
    },
  },
  {
    catalog: 'gitnexus',
    precedence: 1,
    source_tiers: {
      READ_ONLY: ['gitnexus_query', 'gitnexus_context'],
      LOW: ['gitnexus_query', 'gitnexus_context'],
      MEDIUM: ['gitnexus_query', 'gitnexus_context', 'gitnexus_rename'],
      HIGH: ['gitnexus_query', 'gitnexus_context', 'gitnexus_rename', 'gitnexus_cypher'],
    },
  },
];

describe('resolved tool contract', () => {
  it('matches healthy hard-deny runtime without pretending native search exists', () => {
    const contract = buildResolvedToolContract({
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
        gitnexus: { health: 'loaded_healthy', catalogCompatible: true },
      },
      extensionPackages: {
        gitnexus: { packageName: 'pi-gitnexus', packagePath: '/tmp/pi-gitnexus' },
      },
    });

    expect(contract.toolsFlag).toBe('read,gitnexus_query,gitnexus_context');
    expect(contract.nativeTools).toEqual(['read']);
    expect(contract.extensionTools).toEqual(['gitnexus_query', 'gitnexus_context']);
    expect(contract.deniedNativeTools).toEqual(['grep', 'find', 'ls']);
    expect(contract.extensions.gitnexus.status).toBe('available');
    expect(contract.extensions.gitnexus.packageName).toBe('pi-gitnexus');
    expect(contract.extensions.gitnexus.packagePath).toBe('/tmp/pi-gitnexus');
    expect(formatResolvedToolContract(contract)).toContain('actual native tools: read');
    expect(formatResolvedToolContract(contract)).toContain('active extension tools: gitnexus_query, gitnexus_context');
  });

  it('surfaces fallback restore when extension disabled', () => {
    const contract = buildResolvedToolContract({
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
      specialistExclusions: { disabledExtensions: ['gitnexus'] },
      extensionState: {
        gitnexus: { health: 'loaded_healthy', catalogCompatible: true },
      },
      extensionPackages: {
        gitnexus: { packageName: 'pi-gitnexus' },
      },
    });

    expect(contract.toolsFlag).toBe('read,grep,find,ls');
    expect(contract.nativeTools).toEqual(['read', 'grep', 'find', 'ls']);
    expect(contract.extensionTools).toEqual([]);
    expect(contract.deniedNativeTools).toEqual([]);
    expect(contract.extensions.gitnexus.status).toBe('disabled');
    expect(contract.downgradeReasons).toEqual(['restored native fallback for grep,find,ls due to disabled']);
    expect(formatResolvedToolContract(contract)).toContain('gitnexus: disabled');
    expect(formatResolvedToolContract(contract)).toContain('downgrade reasons: restored native fallback for grep,find,ls due to disabled');
  });

  it('materializes discovered names into the effective contract without touching natives', () => {
    // unitAI-1pqtl.2: pure helper for runtime-discovered names. No source here names the
    // extension's tools — the names arrive as runtime input, the way discovery supplies them.
    const base = buildResolvedToolContract({
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
        gitnexus: { health: 'loaded_healthy', catalogCompatible: true },
      },
    });
    const effective = withDiscoveredExtensionTools(base, {
      pinned: ['ext_tool_a'],
      refusedCollisions: [],
      refusedProvenance: [],
    });
    expect(effective).not.toBe(base);
    expect(effective.toolsList).toContain('ext_tool_a');
    expect(effective.extensionTools).toContain('ext_tool_a');
    expect(effective.toolsFlag).toContain('ext_tool_a');
    expect(effective.nativeTools).toEqual(base.nativeTools);
    expect(effective.deniedNativeTools).toEqual(base.deniedNativeTools);
    expect(formatResolvedToolContract(effective)).toContain('ext_tool_a');
  });

  it('returns the base contract unchanged when nothing was discovered or refused', () => {
    const base = buildResolvedToolContract({ tier: 'READ_ONLY', catalogs });
    expect(withDiscoveredExtensionTools(base, { pinned: [] })).toBe(base);
    expect(withDiscoveredExtensionTools(base, [])).toBe(base);
  });

  it('never pins a denied native, even if the caller missed it, and records refusals', () => {
    const base = buildResolvedToolContract({
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
        gitnexus: { health: 'loaded_healthy', catalogCompatible: true },
      },
    });
    expect(base.deniedNativeTools).toContain('grep');
    const effective = withDiscoveredExtensionTools(base, {
      pinned: ['grep', 'ext_tool_b'],
      refusedCollisions: ['write'],
      refusedProvenance: ['sneaky'],
    });
    // Defense in depth: the denied native is dropped even though it was passed as pinned.
    expect(effective.toolsList).not.toContain('grep');
    expect(effective.toolsList).toContain('ext_tool_b');
    expect(effective.warnings.join('\n')).toContain("refused extension tool 'write'");
    expect(effective.warnings.join('\n')).toContain("refused extension tool 'sneaky'");
    expect(formatResolvedToolContract(effective)).toContain('ext_tool_b');
  });

  it('never lets the host ask/escalate names enter the effective contract (F2)', () => {
    const base = buildResolvedToolContract({ tier: 'READ_ONLY', catalogs });
    const effective = withDiscoveredExtensionTools(base, {
      pinned: ['ask_coordinator', 'escalate_to_coordinator', 'ext_tool_a'],
    });
    expect(effective.toolsList).not.toContain('ask_coordinator');
    expect(effective.toolsList).not.toContain('escalate_to_coordinator');
    expect(effective.toolsList).toContain('ext_tool_a');
  });

  it('keeps soft-deny tools visible and reports preference signal', () => {
    const contract = buildResolvedToolContract({
      tier: 'LOW',
      catalogs,
      manifestPolicy: {
        permissions: {
          LOW: {
            denied_natives_when_extension: ['grep', 'find', 'ls'],
            denied_natives_mode: 'soft',
          },
        },
      },
      extensionState: {
        gitnexus: { health: 'loaded_healthy', catalogCompatible: true },
      },
      extensionPackages: {
        gitnexus: { packageName: 'pi-gitnexus' },
      },
    });

    expect(contract.toolsFlag).toBe('read,grep,find,ls,bash,gitnexus_query,gitnexus_context');
    expect(contract.nativeTools).toEqual(['read', 'grep', 'find', 'ls', 'bash']);
    expect(contract.deniedNativeTools).toEqual([]);
    expect(contract.preferenceSignals).toEqual(['soft deny prefers extension tools for: grep,find,ls']);
    expect(formatResolvedToolContract(contract)).toContain('preference signals: soft deny prefers extension tools for: grep,find,ls');
  });

  // SPECIALISTS-88: the rendered contract must name the mechanism of the path that PRINTS it.
  // The native activation runtime does not load the tool-policy gate at all (native-host.ts
  // states that outright, and probe variants C/D measured it: injecting the gate, and ordering
  // it first, both left the tool list clipped). Naming the gate on that path sends an operator
  // who is chasing a missing tool to a mechanism and an env channel that are not there.
  it('names the native admission mechanism on the native path, never the legacy gate (SPECIALISTS-88)', () => {
    const contract = buildResolvedToolContract({
      tier: 'READ_ONLY',
      catalogs,
      extensionSources: ['npm:pi-ast-grep'],
    });
    expect(contract.exposedExtensionSources).toEqual(['npm:pi-ast-grep']);

    const native = formatResolvedToolContract(contract, 'discover-then-pin');
    expect(native).toContain('discover-then-pin');
    expect(native).toContain('npm:pi-ast-grep');
    // The mutation guard, and the reason it is written as a negative: reverting this wording to
    // the gate claim must FAIL here. A test that only pins the new string would keep passing if
    // the line regressed to the misattribution this issue exists to remove.
    expect(native).not.toContain('tool-policy gate');
    // Likewise the over-promise that made the pre-fix line a lie: the line must not claim every
    // registered tool is available. What was actually admitted is on the 'active extension tools'
    // line, which is rendered from the finalised contract.
    expect(native).not.toContain('all registered tools available');
  });

  it('keeps the gate wording for callers that still load the gate (SPECIALISTS-88)', () => {
    const contract = buildResolvedToolContract({
      tier: 'READ_ONLY',
      catalogs,
      extensionSources: ['npm:pi-ast-grep'],
    });
    // Default is the legacy mechanism on purpose: runner.ts, script-runner.ts and
    // resolution-diagnostics.ts render through the gate and must keep saying so.
    const legacy = formatResolvedToolContract(contract);
    expect(legacy).toContain('tool-policy gate');
    expect(legacy).not.toContain('discover-then-pin');
  });

  it('renders no exposed-sources line when no source is enabled, on either mechanism (SPECIALISTS-88)', () => {
    const contract = buildResolvedToolContract({ tier: 'READ_ONLY', catalogs });
    expect(contract.exposedExtensionSources).toEqual([]);
    for (const admission of ['tool-policy-gate', 'discover-then-pin'] as const) {
      const rendered = formatResolvedToolContract(contract, admission);
      expect(rendered).not.toContain('exposed extension sources');
      expect(rendered).not.toContain('tool-policy gate');
      expect(rendered).not.toContain('discover-then-pin');
    }
  });
});
