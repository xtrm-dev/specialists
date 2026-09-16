import {
  resolveEffectiveExtensionState,
  resolveManifestTools,
  type EffectiveExtensionStatus,
  type ResolverInput,
  type ToolCatalog,
  type ToolCatalogName,
  type ToolTier,
} from './manifest-resolver.js';

export interface ExtensionPackageRuntime {
  packageName?: string;
  packagePath?: string;
}

export interface ResolvedExtensionContract {
  status: EffectiveExtensionStatus;
  packageName?: string;
  packagePath?: string;
  activeTools: readonly string[];
}

export interface ResolvedToolContract {
  effectiveTier: ToolTier;
  toolsFlag: string;
  /** Extension sources enabled via `execution.extensions[source] === true`.
   *  HOW these sources' tools reach the session is runtime-specific and is NOT one
   *  mechanism (SPECIALISTS-88): the legacy spawn path loads the Specialists
   *  tool-policy extension LAST and gates on `--no-builtin-tools`, while the native
   *  activation runtime does not load that gate at all and instead pins discovered
   *  names into pi's hard `tools` allowlist. See `ExtensionAdmissionMechanism`;
   *  renderers must name the mechanism of the path that prints them. Either way the
   *  tier's native restrictions stay fail-closed. */
  exposedExtensionSources: readonly string[];
  toolsList: readonly string[];
  nativeTools: readonly string[];
  extensionTools: readonly string[];
  deniedNativeTools: readonly string[];
  deniedNativesMode: ResolverInput['specialistOverride'] extends infer _ ? 'soft' | 'hard' : never;
  preferenceSignals: readonly string[];
  downgradeReasons: readonly string[];
  warnings: readonly string[];
  extensions: Partial<Record<Exclude<ToolCatalogName, 'native'>, ResolvedExtensionContract>>;
}

interface BuildResolvedToolContractInput extends ResolverInput {
  extensionPackages?: Partial<Record<ToolCatalogName, ExtensionPackageRuntime>>;
  /** Enabled extension sources (execution.extensions[source] === true). On the legacy
   *  spawn path these switch the session to the tool-policy gate:
   *  --no-builtin-tools plus the Specialists-owned policy extension selecting the
   *  granted natives and all extension-registered tools at session start. On the
   *  native activation path the gate is not loaded; these sources are resolved and
   *  discovered, and their names are pinned into the `tools` allowlist instead. */
  extensionSources?: readonly string[];
}

function uniqueOrdered(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}

function getCatalog(catalogs: readonly ToolCatalog[], name: ToolCatalogName): ToolCatalog | undefined {
  return catalogs.find((catalog) => catalog.catalog === name);
}

function getRequestedExtensionTools(catalogs: readonly ToolCatalog[], name: Exclude<ToolCatalogName, 'native'>, tier: ToolTier): readonly string[] {
  const catalog = getCatalog(catalogs, name);
  if (!catalog) return [];
  return uniqueOrdered([
    ...(catalog.source_tiers.READ_ONLY ?? []),
    ...(catalog.source_tiers[tier] ?? []),
  ]);
}

function getEffectiveExtensionStatus(input: ResolverInput, name: Exclude<ToolCatalogName, 'native'>): EffectiveExtensionStatus {
  const state = input.specialistExclusions?.disabledExtensions?.includes(name)
    ? { ...input.extensionState?.[name], enabled: false, health: 'disabled' as const }
    : input.extensionState?.[name];
  return resolveEffectiveExtensionState(state).status;
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : '(none)';
}

export function buildResolvedToolContract(input: BuildResolvedToolContractInput): ResolvedToolContract {
  const resolver = resolveManifestTools(input);
  const nativeCatalog = getCatalog(input.catalogs, 'native');
  const tierNativeTools = new Set(nativeCatalog?.source_tiers[input.tier] ?? []);
  const nativeTools = resolver.toolsList.filter((tool) => tierNativeTools.has(tool));
  const extensionTools = resolver.toolsList.filter((tool) => !tierNativeTools.has(tool));
  const exposedExtensionSources = uniqueOrdered(input.extensionSources ?? []);
  const extensions = Object.fromEntries(
    input.catalogs
      .filter((catalog): catalog is ToolCatalog & { catalog: Exclude<ToolCatalogName, 'native'> } => catalog.catalog !== 'native')
      .map((catalog) => {
        const activeTools = resolver.toolsList.filter((tool) => getRequestedExtensionTools(input.catalogs, catalog.catalog, input.tier).includes(tool));
        return [
          catalog.catalog,
          {
            status: getEffectiveExtensionStatus(input, catalog.catalog),
            packageName: input.extensionPackages?.[catalog.catalog]?.packageName,
            packagePath: input.extensionPackages?.[catalog.catalog]?.packagePath,
            activeTools,
          } satisfies ResolvedExtensionContract,
        ];
      }),
  ) as ResolvedToolContract['extensions'];

  return {
    effectiveTier: input.tier,
    toolsFlag: resolver.tools,
    exposedExtensionSources,
    toolsList: resolver.toolsList,
    nativeTools,
    extensionTools,
    deniedNativeTools: resolver.deniedNatives,
    deniedNativesMode: resolver.deniedNativesMode,
    preferenceSignals: resolver.preferenceSignals,
    downgradeReasons: resolver.downgradeReasons,
    warnings: resolver.warnings,
    extensions,
  };
}

/**
 * Runtime-discovered extension tools, already filtered by the host's discover-then-pin
 * gate (unitAI-1pqtl.2).
 *
 * `pinned` are the names the discovery session proved are extension-class AND non-colliding;
 * the refused lists are recorded as contract warnings so the rendered prompt names what was
 * withheld and why. This helper is pure: it never touches pi, the filesystem, or a session.
 * A denied native can never enter through here — any pinned name the base contract denies
 * is dropped even if the caller missed it, so tier denial survives a shadowing extension.
 */
export interface DiscoveredExtensionMaterialization {
  pinned?: readonly string[];
  refusedCollisions?: readonly string[];
  refusedProvenance?: readonly string[];
}

/**
 * Materialize runtime-discovered names into an EFFECTIVE contract.
 *
 * Returns the base contract UNCHANGED (same reference) when there is nothing to pin and
 * nothing refused, so a specialist with no enabled dynamic sources sees byte-identical
 * options and contract. Otherwise returns a new contract with the pinned names appended to
 * `toolsList`/`extensionTools`/`toolsFlag`; `nativeTools`, `deniedNativeTools` and the
 * per-catalog `extensions` map are untouched because pinned names are never natives and
 * never belong to a hand-maintained catalog (ToolCatalogName is a closed union).
 */
export function withDiscoveredExtensionTools(
  base: ResolvedToolContract,
  discovered: DiscoveredExtensionMaterialization | readonly string[],
): ResolvedToolContract {
  const isList = Array.isArray(discovered);
  const pinned = isList ? (discovered as readonly string[]) : ((discovered as DiscoveredExtensionMaterialization).pinned ?? []);
  const refusedCollisions = isList ? [] : ((discovered as DiscoveredExtensionMaterialization).refusedCollisions ?? []);
  const refusedProvenance = isList ? [] : ((discovered as DiscoveredExtensionMaterialization).refusedProvenance ?? []);
  if (pinned.length === 0 && refusedCollisions.length === 0 && refusedProvenance.length === 0) {
    return base;
  }
  const denied = new Set(base.deniedNativeTools);
  const already = new Set(base.toolsList);
  // Defense in depth (F2): the host's own ask/escalate names must never enter the effective
  // contract — an extension registering them collides with the host's customTools. Kept as
  // literals with the owner file named so a rename is found: see src/activation/ask-tool.ts
  // ASK_TOOL / ESCALATE_TOOL. Even if the host's filter missed, a denied native name must
  // never be pinned either — it would defeat the tier's denial by shadowing.
  const HOST_TOOLS = new Set(['ask_coordinator', 'escalate_to_coordinator']);
  const safePinned = uniqueOrdered(pinned).filter(
    (name) => !denied.has(name) && !already.has(name) && !HOST_TOOLS.has(name),
  );
  const toolsList = uniqueOrdered([...base.toolsList, ...safePinned]);
  const extensionTools = uniqueOrdered([...base.extensionTools, ...safePinned]);
  const warnings = [
    ...base.warnings,
    ...uniqueOrdered(refusedCollisions).map(
      (name) => `refused extension tool '${name}': collides with a builtin tool name`,
    ),
    ...uniqueOrdered(refusedProvenance).map(
      (name) => `refused extension tool '${name}': non-extension provenance`,
    ),
  ];
  return {
    ...base,
    toolsFlag: toolsList.join(','),
    toolsList,
    extensionTools,
    warnings,
  };
}

/**
 * Which mechanism admits an enabled source's tools to the session the rendered contract
 * describes. The two runtimes do NOT share one, and naming the wrong one is a defect rather
 * than a cosmetic slip: an operator debugging a missing tool follows the mechanism back to
 * its env channel and its load order, so a prompt that names the tool-policy gate on the
 * native path sends them to a gate that is not loaded there (SPECIALISTS-88).
 *
 *  - `tool-policy-gate`  — the legacy spawn path: the Specialists tool-policy extension is
 *    loaded LAST and the session is gated on `--no-builtin-tools` (unitAI-34pyf).
 *  - `discover-then-pin` — the native activation runtime: the gate is NOT loaded; enabled
 *    extension tools are discovered in a fenced session and pinned into pi's hard `tools`
 *    allowlist before the prompt is rendered (unitAI-1pqtl.2).
 *
 * The default is the legacy mechanism so every existing caller renders exactly what it
 * rendered before; a caller that runs the native runtime must pass its own mechanism.
 */
export type ExtensionAdmissionMechanism = 'tool-policy-gate' | 'discover-then-pin';

function describeAdmission(admission: ExtensionAdmissionMechanism): string {
  return admission === 'discover-then-pin'
    ? `registered tools admitted by discover-then-pin into this session's tool allowlist`
    : 'registered tools admitted by the tool-policy gate';
}

export function formatResolvedToolContract(
  contract: ResolvedToolContract,
  admission: ExtensionAdmissionMechanism = 'tool-policy-gate',
): string {
  const lines = [
    '## Resolved Tool Contract',
    `- effective tier: ${contract.effectiveTier}`,
    `- --tools: ${contract.toolsFlag || '(none)'}`,
    ...(contract.exposedExtensionSources.length > 0
      ? [`- exposed extension sources (${describeAdmission(admission)}): ${formatList(contract.exposedExtensionSources)}`]
      : []),
    `- actual native tools: ${formatList(contract.nativeTools)}`,
    `- active extension tools: ${formatList(contract.extensionTools)}`,
    `- denied native tools: ${formatList(contract.deniedNativeTools)}`,
    `- deny mode: ${contract.deniedNativesMode}`,
    '- extension state:',
  ];

  const extensionEntries = Object.entries(contract.extensions);
  if (extensionEntries.length === 0) {
    lines.push('  - (none)');
  } else {
    for (const [name, extension] of extensionEntries) {
      lines.push(`  - ${name}: ${extension.status}; active tools: ${formatList(extension.activeTools)}`);
    }
  }

  lines.push(`- preference signals: ${formatList(contract.preferenceSignals)}`);
  lines.push(`- downgrade reasons: ${formatList(contract.downgradeReasons)}`);
  lines.push(`- warnings: ${formatList(contract.warnings)}`);

  return lines.join('\n');
}
