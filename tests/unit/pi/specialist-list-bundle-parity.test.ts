// tests/unit/pi/specialist-list-bundle-parity.test.ts
//
// SPECIALISTS-4349. SPECIALISTS-57 fixed the definition-scoped extension selection at every
// call site that resolved a tool contract — and missed one: the Pi extension bundle
// (config/pi-extensions/native-specialists/index.mjs), whose `dispatchability()` is the
// verdict `specialist_list` publishes to a Pi coordinator. The MCP mirror
// (src/tools/specialist/specialist_list.tool.ts) got the fix; the Pi surface kept resolving a
// contract with `execution.extensions` dropped, so `quant-methodologist` and `quant-researcher`
// — both LOW tier with `extensions: { gitnexus: false }` and `required_tools`
// `[read, grep, find, ls, bash]` — reported `dispatchable: false` on every host where the
// catalog's hard deny is active. The runtime would have admitted them.
//
// This file asserts PARITY on the extension-selection path: the bundle's `dispatchability()`
// and the MCP mirror's projection must reach the SAME verdict for the same definition, because
// both are supposed to run "the SAME admission checks the host runs".
//
// What is pinned here, and why each assertion is not redundant:
//
//   1. The quant pair is ADMITTED by both surfaces. This is the reported defect. It is
//      deterministic: once the definition's exclusion reaches the contract the catalog deny is
//      switched off, so the verdict does not depend on whether gitnexus is installed.
//   2. The contract built from the definition's OWN selection grants every declared
//      `required_tool` and carries no gitnexus tool. This pins the MECHANISM rather than the
//      boolean — a surface could pass by degrading both sides identically.
//   3. Every shipped definition reaches the same verdict on both surfaces. SPECIALISTS-57's
//      root cause was a missing ARGUMENT, so parity is compared across the whole registry, not
//      just the two definitions that happened to break.
//
// The bundle imports the BUILT artifact (`dist/lib.js`), exactly as the extension does at
// runtime, so this test also fails if `dist/` is stale with respect to `src/lib.ts` — the
// export of `resolveExecutionExtensionSelection` is what lets the bundle pass the argument at
// all. Rebuild with `bun run build` after touching the library entry point.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The extension imports Type from 'typebox' for its parameter and output schemas. They are
// captured here, never validated, so the stub the other bundle suites use is sufficient.
vi.mock('typebox', () => ({
  Type: {
    Object: (props: unknown) => ({ type: 'object', properties: props }),
    String: (opts = {}) => ({ type: 'string', ...opts }),
    Integer: (opts = {}) => ({ type: 'integer', ...opts }),
    Number: (opts = {}) => ({ type: 'number', ...opts }),
    Boolean: (opts = {}) => ({ type: 'boolean', ...opts }),
    Array: (items: unknown) => ({ type: 'array', items }),
    Union: (variants: unknown, opts = {}) => ({ anyOf: variants, ...opts }),
    Literal: (value: unknown) => ({ const: value }),
    Enum: (values: object, opts = {}) => ({ enum: Object.values(values), ...opts }),
    Unknown: () => ({ type: 'unknown' }),
    Null: () => ({ type: 'null' }),
    Optional: (schema: unknown) => schema,
  },
}));

import { createSpecialistListTool } from '../../../src/tools/specialist/specialist_list.tool.js';
import { resolveExecutionExtensionSelection, resolveRuntimeToolContract } from '../../../src/lib.js';
import type { SpecialistLoader, SpecialistSummary } from '../../../src/specialist/loader.js';
import type { Specialist } from '../../../src/specialist/schema.js';

const REPO_ROOT = process.cwd();
const SHIPPED_DIR = join(REPO_ROOT, 'config', 'specialists');
const EXTENSION_PATH = resolve('config/pi-extensions/native-specialists/index.mjs');
/** Injected so a definition with no configured model still reaches contract resolution. */
const PARITY_MODEL = 'parity-model';

type Verdict = { dispatchable: boolean; reason?: string };

interface ShippedSpec {
  name: string;
  file: string;
  spec: Specialist;
}

/**
 * The shipped definition, with the two admission dimensions that depend on the MACHINE removed.
 *
 * `skills.paths` and `capabilities.external_commands` are resolved against this checkout and
 * `PATH`, so a runner without `~/.xtrm/skills/default/codemode` or without `pytest` refuses the
 * dispatch for reasons that have nothing to do with the extension selection this file is about —
 * and the abort would land in a suite that must be green on every host. `required_tools` stays
 * UNTOUCHED: that is the dimension the catalog deny removes tools from, and therefore the one
 * the defect moved. The bundle's own live admission on a real runner is evidence collected
 * outside this suite, not something a unit test can own.
 */
function shippedSpecs(): ShippedSpec[] {
  return readdirSync(SHIPPED_DIR)
    .filter((file) => file.endsWith('.specialist.json'))
    .sort()
    .map((file) => {
      const parsed = JSON.parse(readFileSync(join(SHIPPED_DIR, file), 'utf8')) as {
        specialist: {
          metadata: { name: string };
          execution: { model: string | null };
          skills?: { paths?: string[] };
          capabilities?: { external_commands?: string[] };
        };
      };
      parsed.specialist.execution.model = PARITY_MODEL;
      if (parsed.specialist.skills) delete parsed.specialist.skills.paths;
      if (parsed.specialist.capabilities) delete parsed.specialist.capabilities.external_commands;
      return { name: parsed.specialist.metadata.name, file, spec: parsed as unknown as Specialist };
    });
}

function executionOf(spec: Specialist) {
  return spec.specialist.execution as {
    model: string | null;
    permission_required?: string;
    extensions?: Record<string, boolean | null | undefined>;
  };
}

function requiredTools(spec: Specialist): string[] {
  const capabilities = spec.specialist.capabilities as { required_tools?: string[] } | undefined;
  return capabilities?.required_tools ?? [];
}

/** A loader that serves exactly these definitions — the same shape `specialist_list` consumes. */
function stubLoader(specs: ShippedSpec[]): SpecialistLoader {
  const summaries = specs.map(({ name, spec }): SpecialistSummary => {
    const metadata = spec.specialist.metadata as unknown as Record<string, string>;
    return {
      name,
      description: metadata.description ?? name,
      category: metadata.category ?? 'unclassified',
      version: metadata.version ?? '0.0.0',
      model: PARITY_MODEL,
      permission_required: (executionOf(spec).permission_required ?? 'READ_ONLY') as SpecialistSummary['permission_required'],
      interactive: false,
      skills: [],
      scripts: [],
      mandatoryRuleTemplateSets: [],
      scope: 'package',
      source: 'package-fallback',
      filePath: join(SHIPPED_DIR, `${name}.specialist.json`),
    };
  });
  return {
    list: async () => summaries,
    get: async (name: string) => {
      const found = specs.find((candidate) => candidate.name === name);
      if (!found) throw new Error(`unknown specialist '${name}'`);
      return found.spec;
    },
  } as unknown as SpecialistLoader;
}

/** The MCP mirror's verdict for one definition, read through its own public tool surface. */
async function srcVerdict(spec: Specialist, name: string): Promise<Verdict> {
  const tool = createSpecialistListTool(stubLoader([{ name, file: `${name}.specialist.json`, spec }]));
  const out = (await tool.execute({ name })) as {
    specialist?: { dispatchable?: boolean; reason?: string };
  };
  expect(out.specialist, `${name} must be listed`).toBeDefined();
  const row = out.specialist!;
  return { dispatchable: row.dispatchable === true, ...(row.reason ? { reason: row.reason } : {}) };
}

/** The Pi bundle's verdict, imported from the SHIPPED artifact. */
async function bundleVerdict(spec: Specialist): Promise<Verdict> {
  const mod = await import(EXTENSION_PATH);
  expect(typeof mod.dispatchability, 'the bundle must export dispatchability').toBe('function');
  return mod.dispatchability(spec);
}

describe('specialist_list bundle/src parity on the extension-selection path (SPECIALISTS-4349)', () => {
  const specs = shippedSpecs();

  it('has shipped definitions to compare', () => {
    expect(specs.length).toBeGreaterThan(15);
  });

  for (const name of ['quant-methodologist', 'quant-researcher']) {
    it(`${name} is dispatched from both surfaces with its declared required_tools`, async () => {
      const shipped = specs.find((candidate) => candidate.name === name);
      expect(shipped, `${name} must ship`).toBeDefined();
      const { spec } = shipped!;
      const execution = executionOf(spec);
      expect(execution.extensions?.gitnexus, `${name} must keep extensions.gitnexus = false`).toBe(false);

      const fromBundle = await bundleVerdict(spec);
      const fromSrc = await srcVerdict(spec, name);
      expect(fromBundle, `${name} via the Pi bundle`).toEqual({ dispatchable: true });
      expect(fromSrc, `${name} via the MCP mirror`).toEqual({ dispatchable: true });

      // The mechanism: the definition's OWN selection is what keeps grep/find/ls granted.
      const selection = resolveExecutionExtensionSelection(execution.extensions);
      expect(selection.excludeExtensions).toEqual(['pi-gitnexus']);
      const contract = resolveRuntimeToolContract({
        level: execution.permission_required ?? 'READ_ONLY',
        specialistName: name,
        specialistPermissions: spec.specialist.permissions,
        excludeExtensions: selection.excludeExtensions,
        extensionSources: selection.extensionSources,
        cwd: REPO_ROOT,
      });
      expect(contract, `${name} contract`).toBeDefined();
      const granted = new Set(contract!.toolsList.map((tool) => tool.toLowerCase()));
      for (const tool of requiredTools(spec)) {
        expect(granted, `${name} must grant required_tool "${tool}"`).toContain(tool.toLowerCase());
      }
      expect(contract!.deniedNativeTools, `${name} must not have grep/find/ls denied`).toEqual([]);
      expect(contract!.toolsList.filter((tool) => tool.startsWith('gitnexus_')), `${name} must exclude gitnexus`).toEqual([]);
    });
  }

  it('every shipped definition reaches the same verdict on both surfaces', async () => {
    // Parity across the registry, not just the two definitions that broke: the defect class is
    // a dropped ARGUMENT, which a new or edited definition can hit without touching the bundle.
    const divergences: string[] = [];
    for (const { name, spec } of specs) {
      const [fromBundle, fromSrc] = await Promise.all([bundleVerdict(spec), srcVerdict(spec, name)]);
      if (JSON.stringify(fromBundle) !== JSON.stringify(fromSrc)) {
        divergences.push(`${name}: bundle=${JSON.stringify(fromBundle)} src=${JSON.stringify(fromSrc)}`);
      }
    }
    expect(divergences, `bundle/src verdict divergences:\n${divergences.join('\n')}`).toEqual([]);
  });

  it('the bundle derives the selection from the definition, not from a fixed exclusion', async () => {
    // A bundle that hard-coded `excludeExtensions: ['pi-gitnexus']` would pass the two cases
    // above. Re-enable the extension on the same definition: the surfaces must still agree, and
    // the selection they agree from must now be empty.
    const shipped = specs.find((candidate) => candidate.name === 'quant-methodologist')!;
    const withExtension = JSON.parse(JSON.stringify(shipped.spec)) as Specialist;
    executionOf(withExtension).extensions = { gitnexus: true };

    expect(resolveExecutionExtensionSelection(executionOf(withExtension).extensions).excludeExtensions).toEqual([]);
    expect(await bundleVerdict(withExtension)).toEqual(await srcVerdict(withExtension, shipped.name));
  });
});
