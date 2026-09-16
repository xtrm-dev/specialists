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
   *  When non-empty the spawn loads the Specialists tool-policy extension
   *  LAST and gates the session on `--no-builtin-tools`: the policy extension
   *  re-activates the tier's native tools (bounded env channel) plus every
   *  tool registered by these sources. Native restrictions stay fail-closed. */
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
  /** Enabled extension sources (execution.extensions[source] === true) that
   *  switch the session to the tool-policy gate: --no-builtin-tools plus the
   *  Specialists-owned policy extension selecting the granted natives and
   *  all extension-registered tools at session start. */
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
  // Defense in depth: even if the host's builtin-collision filter missed, a denied native
  // name must never be pinned — it would defeat the tier's denial by shadowing.
  const safePinned = uniqueOrdered(pinned).filter((name) => !denied.has(name) && !already.has(name));
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

export function formatResolvedToolContract(contract: ResolvedToolContract): string {
  const lines = [
    '## Resolved Tool Contract',
    `- effective tier: ${contract.effectiveTier}`,
    `- --tools: ${contract.toolsFlag || '(none)'}`,
    ...(contract.exposedExtensionSources.length > 0
      ? [`- exposed extension sources (all registered tools available via tool-policy gate): ${formatList(contract.exposedExtensionSources)}`]
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
