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
export declare function formatResolvedToolContract(contract: ResolvedToolContract, admission?: ExtensionAdmissionMechanism): string;
export {};
//# sourceMappingURL=resolved-tool-contract.d.ts.map