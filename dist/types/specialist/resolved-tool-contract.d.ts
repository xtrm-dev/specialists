import { type EffectiveExtensionStatus, type ResolverInput, type ToolCatalogName, type ToolTier } from './manifest-resolver.js';
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
export declare function buildResolvedToolContract(input: BuildResolvedToolContractInput): ResolvedToolContract;
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
export declare function withDiscoveredExtensionTools(base: ResolvedToolContract, discovered: DiscoveredExtensionMaterialization | readonly string[]): ResolvedToolContract;
export declare function formatResolvedToolContract(contract: ResolvedToolContract): string;
export {};
//# sourceMappingURL=resolved-tool-contract.d.ts.map