// tests/unit/specialist/specialist-capability-policy.test.ts
//
// SPECIALISTS-57. `quant-methodologist` and `quant-researcher` declared
// `capabilities.required_tools: [read, grep, find, ls, bash]` while the catalog's tier policy
// hard-denies exactly `grep`, `find` and `ls` whenever a healthy gitnexus is installed. On a
// developer machine the resolved contract therefore lacked the declared tools and
// `validateBeforeRun` refused the dispatch; on CI no extension is installed, the deny is
// inactive, and both specialists dispatched fine. The defect was visible only on the machines
// that had the extension — the worst possible direction.
//
// Root cause was NOT the declarations. Both definitions declare
// `execution.extensions: { gitnexus: false }`, which turns the denying extension off, and the
// legacy runner honours that by passing the exclusion into the tool-contract resolution
// (runner.ts:1076-1084). The native host did not, so it resolved a contract with gitnexus ON
// for a definition that had asked for it OFF. The invariant below is what makes that class of
// defect impossible to reach a shipped definition again.
//
// This test deliberately DOES NOT depend on whether gitnexus is installed: it forces both a
// healthy and an absent gitnexus, so the same assertions hold on CI and on a developer
// machine. That is the environment-independence the issue asks for.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadToolCatalogIndex } from '../../../src/specialist/tool-catalog.js';
import { buildResolvedToolContract } from '../../../src/specialist/resolved-tool-contract.js';
// `manifest-resolver` declares its own structural ToolCatalog, which is what the resolver
// actually accepts; the zod-inferred one from tool-catalog.ts is a different type.
import type { ExtensionHealth, ToolCatalog } from '../../../src/specialist/manifest-resolver.js';
import { resolveExecutionExtensionSelection } from '../../../src/pi/session.js';

const REPO_ROOT = process.cwd();
const SHIPPED_DIR = join(REPO_ROOT, 'config', 'specialists');
const CATALOG_PATH = join(REPO_ROOT, 'config', 'catalog', 'index.json');

function catalogIndex() {
  return loadToolCatalogIndex(readFileSync(CATALOG_PATH, 'utf8'));
}

/**
 * The catalogs as the RUNTIME loads them: parsed through the same schema, unmodified. The previous
 * version rebuilt the objects by hand, which produced a shape the resolver's `ToolCatalog` type
 * rejects (`source_tiers` becomes an index-record) — a type error that only `typecheck:tests` sees.
 */
function runtimeCatalogs(): ToolCatalog[] {
  return catalogIndex().catalogs.map((catalog) => ({
    catalog: catalog.catalog,
    precedence: catalog.precedence,
    source_tiers: {
      READ_ONLY: catalog.source_tiers.READ_ONLY ?? [],
      LOW: catalog.source_tiers.LOW ?? [],
      MEDIUM: catalog.source_tiers.MEDIUM ?? [],
      HIGH: catalog.source_tiers.HIGH ?? [],
    },
  }));
}

interface ShippedSpec {
  file: string;
  name: string;
  tier: string;
  specialist: Record<string, unknown>;
}

function shippedSpecs(): ShippedSpec[] {
  return readdirSync(SHIPPED_DIR)
    .filter((file) => file.endsWith('.specialist.json'))
    .sort()
    .map((file) => {
      const parsed = JSON.parse(readFileSync(join(SHIPPED_DIR, file), 'utf8')) as {
        specialist: Record<string, unknown>;
      };
      const metadata = parsed.specialist.metadata as { name: string };
      const execution = parsed.specialist.execution as { permission_required?: string };
      return {
        file,
        name: metadata.name,
        tier: execution.permission_required ?? 'READ_ONLY',
        specialist: parsed.specialist,
      };
    });
}

/**
 * Resolve the contract for one shipped definition EXACTLY as the runtime resolves it: the
 * definition's own extension selection is carried in, and the gitnexus extension health is
 * forced rather than observed, so the verdict does not depend on this machine.
 */
function resolveShippedContract(spec: ShippedSpec, gitnexusHealth: 'available' | 'not_installed') {
  const index = catalogIndex();
  const extensionSelection = resolveExecutionExtensionSelection(
    (spec.specialist.execution as { extensions?: Record<string, boolean | null | undefined> }).extensions,
  );
  return buildResolvedToolContract({
    tier: spec.tier as 'READ_ONLY' | 'LOW' | 'MEDIUM' | 'HIGH',
    catalogs: runtimeCatalogs(),
    catalogDefaultOverrides: index.default_overrides,
    manifestPolicy: spec.specialist.permissions
      ? { permissions: spec.specialist.permissions as never }
      : undefined,
    specialistOverride: spec.specialist.permissions
      ? (spec.specialist.permissions as Record<string, never>)[spec.tier]
      : undefined,
    specialistExclusions: extensionSelection.excludeExtensions.includes('pi-gitnexus')
      ? { disabledExtensions: ['gitnexus'] }
      : undefined,
    extensionSources: extensionSelection.extensionSources,
    extensionState: {
      gitnexus: { health: gitnexusHealth as ExtensionHealth },
      'python-kernel': { health: 'not_installed' },
    },
  });
}

function declaredRequiredTools(spec: ShippedSpec): string[] {
  const capabilities = spec.specialist.capabilities as { required_tools?: string[] } | undefined;
  return capabilities?.required_tools ?? [];
}

describe('shipped specialist capability policy (SPECIALISTS-57)', () => {
  const specs = shippedSpecs();

  it('has shipped definitions to check', () => {
    expect(specs.length).toBeGreaterThan(15);
  });

  for (const gitnexusHealth of ['available', 'not_installed'] as const) {
    it(`every declared required_tool is granted with gitnexus ${gitnexusHealth}`, () => {
      // The invariant the defect broke: a shipped definition must never declare a tool that its
      // OWN resolved contract denies. Checked in both extension-health directions, so a
      // declaration that only works when the extension is absent fails here instead of on a
      // developer machine.
      const failures: string[] = [];
      for (const spec of specs) {
        const contract = resolveShippedContract(spec, gitnexusHealth);
        const granted = new Set(contract.toolsList.map((tool) => tool.toLowerCase()));
        for (const tool of declaredRequiredTools(spec)) {
          if (!granted.has(tool.toLowerCase())) {
            failures.push(
              `${spec.name}: declares required_tool "${tool}" which its own contract denies `
              + `(granted: ${contract.toolsList.join(',') || '(none)'}; denied: ${contract.deniedNativeTools.join(',') || '(none)'})`,
            );
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it('keeps the exclusion that makes the quant definitions work, on both extension-health paths', () => {
    // Pinned explicitly rather than left implicit in the invariant above: these two definitions
    // are the reason the invariant exists, and their fix is the exclusion, not a relaxed policy.
    for (const name of ['quant-methodologist', 'quant-researcher']) {
      const spec = specs.find((candidate) => candidate.name === name);
      expect(spec, `${name} must ship`).toBeDefined();
      const healthy = resolveShippedContract(spec!, 'available');
      const absent = resolveShippedContract(spec!, 'not_installed');
      expect(healthy.deniedNativeTools, `${name} must not have grep/find/ls hard-denied`).toEqual([]);
      for (const tool of ['find', 'grep', 'ls']) {
        expect(healthy.toolsList, `${name} with gitnexus present`).toContain(tool);
        expect(absent.toolsList, `${name} with gitnexus absent`).toContain(tool);
      }
      // The exclusion is what keeps the deny off; without it the same definition loses the tools.
      expect(
        (spec!.specialist.execution as { extensions?: Record<string, boolean> }).extensions?.gitnexus,
        `${name} must keep execution.extensions.gitnexus = false`,
      ).toBe(false);
    }
  });

  it('denies those natives for a definition that does NOT exclude the extension', () => {
    // The counter-case, so the test cannot pass by the deny simply never firing: strip the
    // exclusion and the same tier/policy must hard-deny the same three natives.
    const spec = specs.find((candidate) => candidate.name === 'quant-methodologist')!;
    const withoutExclusion: ShippedSpec = {
      ...spec,
      specialist: {
        ...spec.specialist,
        execution: { ...(spec.specialist.execution as Record<string, unknown>) },
      },
    };
    delete (withoutExclusion.specialist.execution as { extensions?: unknown }).extensions;
    const contract = resolveShippedContract(withoutExclusion, 'available');
    expect(contract.deniedNativesMode).toBe('hard');
    expect([...contract.deniedNativeTools].sort()).toEqual(['find', 'grep', 'ls']);
  });
});

// SPECIALISTS-57's real root cause was a MISSING ARGUMENT at one of five call sites, and no type
// can express "you must pass the definition's extension selection". The first fix was caller-local
// and left `specialist_list` — the read surface that promises "the SAME admission checks the host
// runs" — still resolving a contract with the exclusions dropped, so it published
// `dispatchable: false` for Specialists the runtime would admit. This is a source-level lint for
// that invariant: blunt, but it is the only check that survives a new call site.
describe('tool-contract call sites carry the definition extension selection', () => {
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) sourceFiles(path, out);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(path);
    }
    return out;
  }

  it('every resolveRuntimeToolContract call passes excludeExtensions', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(REPO_ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      const needle = 'resolveRuntimeToolContract({';
      for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
        // Balance braces from the opening `{` so the whole argument object is inspected.
        const open = text.indexOf('{', at);
        let depth = 0;
        let end = open;
        for (let i = open; i < text.length; i += 1) {
          if (text[i] === '{') depth += 1;
          else if (text[i] === '}') {
            depth -= 1;
            if (depth === 0) { end = i; break; }
          }
        }
        const call = text.slice(open, end + 1);
        if (!call.includes('excludeExtensions')) {
          offenders.push(`${file.slice(REPO_ROOT.length + 1)}: ${call.split('\n').slice(0, 4).join(' ')}`);
        }
      }
    }
    expect(offenders, `call sites dropping the definition extension selection:\n${offenders.join('\n')}`).toEqual([]);
  });
});
