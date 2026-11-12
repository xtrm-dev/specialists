import { type ScriptEntry, type Specialist, type BlockedFieldWarning } from './schema.js';
import { type ClaudeBridgeBlockRead, type GlobalUserConfigPath } from './global-config.js';
export interface StallDetectionConfig {
    running_silence_warn_ms?: number;
    running_silence_error_ms?: number;
    waiting_stale_ms?: number;
    waiting_auto_close_ms?: number | null;
    tool_duration_warn_ms?: number;
}
/**
 * Shared stall-detection defaults (moved verbatim from supervisor.ts, SPECIALISTS-102).
 *
 * The type and the defaults live together so lightweight consumers (e.g. the native
 * activation host) can share the threshold WITHOUT importing the legacy supervisor
 * module — which would drag spawn/readline/sqlite into bundles that never had them.
 * supervisor.ts imports this; it does not re-declare it.
 */
export declare const STALL_DETECTION_DEFAULTS: Required<StallDetectionConfig>;
export interface SpecialistSummary {
    name: string;
    description: string;
    category: string;
    version: string;
    /** Merged model after layer overrides. Empty string when no layer supplies a model. */
    model: string;
    permission_required: 'READ_ONLY' | 'LOW' | 'MEDIUM' | 'HIGH';
    /** Present only when the spec sets `execution.lease_waiver: true`: this read-tier
     *  specialist is provisioned an isolated per-Issue worktree and holds its lease. */
    lease_waiver?: boolean;
    interactive: boolean;
    thinking_level?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    skills: string[];
    scripts: ScriptEntry[];
    mandatoryRuleTemplateSets: string[];
    scope: 'user' | 'home' | 'default' | 'package';
    /**
     * Scope says where override came from.
     * user = repo authoring layer, home = ~/.specialists/user/ layer,
     * default = repo-managed mirror, package = upstream fallback.
     */
    source: 'user' | 'home' | 'default-mirror' | 'package-fallback' | 'package-live' | 'legacy';
    filePath: string;
    updated?: string;
    filestoWatch?: string[];
    staleThresholdDays?: number;
    stallDetection?: StallDetectionConfig;
}
/** Thrown by SpecialistLoader.get when execution.model is null/empty after all overrides merge. */
export declare class SpecialistMissingModelError extends Error {
    readonly specialistName: string;
    constructor(specialistName: string);
}
/**
 * Thrown by SpecialistLoader.get when the operator's Claude Code allow list names a Specialist
 * whose resolved model is not `claude-bridge/...` (SPECIALISTS-4442).
 *
 * The run is REFUSED, never run inert: loading the bridge and then billing another provider is the
 * silent billing-surface swap the route exists to prevent. The message names the Specialist, the
 * model and the block so an operator can fix the one entry instead of guessing.
 */
export declare class ClaudeBridgeRouteModelMismatchError extends Error {
    readonly specialistName: string;
    readonly model: string | null;
    readonly blockPath: string;
    readonly blockError: string | null;
    readonly code = "claude_bridge_route_model_mismatch";
    constructor(specialistName: string, model: string | null, blockPath: string, blockError: string | null);
}
/**
 * The route decision for one Specialist, after every layer merged (SPECIALISTS-4442).
 *
 * One resolver, one answer: the native host (dispatch and retry), `sp run`, `sp script`, session
 * start, `sp list` and `sp view` all read the merged spec it produced, so no runtime can disagree
 * with another or silently change the model on a retry.
 */
export interface ClaudeBridgeRouteDecision {
    /** `block` = the operator allow list decided; `legacy` = the merged definition flag decides. */
    source: 'block' | 'legacy';
    reason: 'block_absent' | 'block_invalid' | 'block_disabled' | 'legacy_no_list' | 'listed' | 'unlisted' | 'listed_model_mismatch';
    /** The block's allow list names this Specialist. */
    listed: boolean;
    /** Effective route permission for this Specialist. */
    enabled: boolean;
    /** Effective bridge model the block supplies (listed only). */
    model: string | null;
    blockError: string | null;
    blockPath: string;
    /** Lower-layer values the block shadowed, for the provenance warning (and `sp doctor`). */
    shadowed: Array<{
        field: 'execution.claude_bridge' | 'execution.model';
        layerValue: unknown;
        blockValue: unknown;
    }>;
}
/**
 * Apply the operator block to a merged execution record. Pure: the loader is the only caller, and
 * the caller writes the result back (see `buildMergedSpec`), so this can be unit-tested without a
 * filesystem.
 *
 * Precedence, in order:
 *   1. no block, or `enabled !== true`      -> no injection; the legacy rule stands (route off);
 *   2. `specialists` absent                -> legacy rule, definition flag decides;
 *   3. `specialists` present, name listed   -> flag true, model = models[name] ?? default_model;
 *   4. `specialists` present, name unlisted -> flag FALSE even if a repo/home layer set it;
 *   5. listed but no bridged model          -> `listed_model_mismatch` (dispatch refuses).
 */
export declare function resolveClaudeBridgeRoute(name: string, execution: {
    claude_bridge?: unknown;
    model?: unknown;
} | undefined, read: ClaudeBridgeBlockRead): ClaudeBridgeRouteDecision;
/** Thrown when config layers resolve two distinct enabled `npm:` specs for the same package. */
export declare class SpecialistExtensionSourceCollisionError extends Error {
    constructor(specialistName: string, packageName: string);
}
/** Returns STALE, AGED, or OK based on file mtimes vs metadata.updated */
export declare function checkStaleness(summary: SpecialistSummary): Promise<'OK' | 'STALE' | 'AGED'>;
interface LoaderOptions {
    projectDir?: string;
    /** Override for ~/.specialists/user/ resolution (tests only; defaults to HOME/homedir). */
    homeDir?: string;
}
export declare class SpecialistLoader {
    private cache;
    private blockedFieldWarnings;
    private claudeBridgeDecisions;
    private projectDir;
    private homeDir;
    constructor(options?: LoaderOptions);
    /** Home-level authoring layer: ~/.specialists/user/. Null when HOME is unavailable. */
    private getHomeUserDir;
    /**
     * Scan dirs in priority order: highest-priority layer FIRST (repo user → home → package).
     *
     * Layered contract (lowest → highest):
     *   package canonical → ~/.config/specialists/user.json → ~/.specialists/user/<name>
     *     → repo .specialists/user/<name>
     *
     * Like pi skill discovery (user + project locations scanned together), a
     * home-level definition is discovered in every repository. A same-named repo
     * definition wins; the collision warns instead of silently shadowing.
     *
     * The repo `.specialists/default/` mirror was retired by commit 31a6421c
     * ("reconcile: empty .specialists/default/ — live-from-package canonical resolves all")
     * and is no longer walked by the loader. Stale `.specialists/default/` files left
     * behind on disk are detected by `drift-detector` and removed by `sp prune-stale-defaults`,
     * but they no longer feed into the merge. The legacy paths `./specialists`,
     * `.claude/specialists`, and `.agent-forge/specialists` are likewise no longer
     * authoritative — they belonged to the same `scope: 'default'` tier.
     */
    private getScanDirs;
    private toJson;
    private resolveSpecialistPath;
    /** Find every layer that has a file for `name`, ordered base-first (package → home → repo user). */
    private findLayerHits;
    /**
     * Apply override-allowed fields from `override` onto `base`, in place.
     * `source` controls blocked-field severity ('strip' for global, 'warn' for repo layers).
     * Returns warnings (does NOT mutate the warnings store).
     */
    private applyOverrideFields;
    private resolveOverrideValue;
    /**
     * Build the merged spec for `name`. Single linear pass over the layers
     * (lowest → highest):
     *
     *   package canonical → ~/.config/specialists/user.json → ~/.specialists/user/<name>
     *     → repo .specialists/user/<name>
     *
     * findLayerHits returns hits ordered base-first. The home and repo layers are
     * full-spec files; only override-allowed fields propagate onto the base.
     * Does NOT throw on null model; caller (get) enforces the missing-model error.
     */
    private buildMergedSpec;
    private resolveCanonicalPresetReferences;
    list(category?: string): Promise<SpecialistSummary[]>;
    get(name: string): Promise<Specialist>;
    /**
     * Return the merged (effective) spec for `name`: package canonical + global
     * user.json + home ~/.specialists/user/ + repo overrides, in the same precedence as get().
     *
     * Unlike get(), does NOT enforce the "model must be set" gate — this method
     * exists precisely so tooling (sp view --raw, launchers, doctors) can inspect
     * the effective config even when it isn't yet runnable. Callers that need
     * runtime enforcement should still use get().
     *
     * Returns null if no layer holds a file for `name` (unknown name).
     */
    getEffective(name: string): Promise<Specialist | null>;
    /**
     * Blocked-field warnings collected during the most recent list() or get() calls.
     * Returns all warnings when called without a name; filters to one specialist otherwise.
     */
    /**
     * `execution.extensions` of the package canonical layer only, before user.json and repo
     * overrides. Lets doctor tell a global `false` that disables a canonically enabled source
     * from one that toggles nothing (SPECIALISTS-52).
     */
    getCanonicalExtensions(name: string): Promise<Record<string, boolean>>;
    getBlockedFieldWarnings(name?: string): BlockedFieldWarning[];
    /**
     * The Claude Code route decision recorded for `name` by the most recent merge
     * (SPECIALISTS-4442). Undefined until `list()`, `get()` or `getEffective()` merged it. Doctor
     * reads it instead of re-deriving the precedence from the block.
     */
    getClaudeBridgeDecision(name: string): ClaudeBridgeRouteDecision | undefined;
    /** Resolution of the global user-config path. Returns null only if HOME is unset and XDG_CONFIG_HOME is empty. */
    getGlobalLayerPath(): GlobalUserConfigPath | null;
    invalidateCache(name?: string): void;
}
/** Extract the npm package identity from an enabled `npm:<name>[@<spec>]` source key, or null. */
export declare function parseNpmSourceName(key: string): string | null;
export {};
//# sourceMappingURL=loader.d.ts.map