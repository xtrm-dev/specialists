import * as z from 'zod';
declare const CONFIG_FILENAME = "user.json";
declare const SPECIALISTS_SUBDIR = "specialists";
export declare const GLOBAL_USER_CONFIG_DOC = "./overrides-guide.md";
export type GlobalConfigSource = 'xdg' | 'config-home' | 'legacy';
export interface GlobalUserConfigPath {
    /** Absolute path to user.json (may not exist yet). */
    path: string;
    /** Whether the resolved path currently exists on disk. */
    exists: boolean;
    /** Which resolution rule produced this path. */
    source: GlobalConfigSource;
}
/**
 * Resolve the global user-config path. Resolution order:
 *   1. $XDG_CONFIG_HOME/specialists/user.json      -> source: 'xdg'
 *   2. $HOME/.config/specialists/user.json         -> source: 'config-home'
 *   3. $HOME/.specialists/user.json (read-only)    -> source: 'legacy'
 *
 * When $XDG_CONFIG_HOME is set it always wins (write target).
 * When unset, config-home is the write target; legacy is a read-only
 * fallback surfaced only when config-home is absent but legacy exists.
 */
/**
 * The Specialist names an operator layer actually holds. The reserved switch key is not a
 * Specialist, so it must never be offered as one: `sp edit --global nope.execution.model` used to
 * list `claude_bridge` under "Available", which reads as an editable definition named that.
 */
export declare function listGlobalSpecialistNames(config: Record<string, unknown>): string[];
export declare function getGlobalUserConfigPath(): GlobalUserConfigPath;
export declare const OverrideExecutionSchema: z.ZodObject<{
    model: z.ZodNullable<z.ZodString>;
    fallback_model: z.ZodNullable<z.ZodString>;
    fallback_models: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    timeout_ms: z.ZodNullable<z.ZodNumber>;
    stall_timeout_ms: z.ZodNullable<z.ZodNumber>;
    interactive: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    thinking_level: z.ZodNullable<z.ZodEnum<["off", "minimal", "low", "medium", "high", "xhigh"]>>;
    max_retries: z.ZodNullable<z.ZodNumber>;
    /** Workspace-lease waiver for read-tier observers (mirrors specialist `execution.lease_waiver`). */
    lease_waiver: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    /**
     * Opt-in Claude Code route (SPECIALISTS-4405). Listed in
     * `OVERRIDE_ALLOWED_EXECUTION_FIELDS`, so it belongs here too: a field the allowlist advertises
     * must be settable, or the CLI rejects a route the docs say is configurable.
     */
    claude_bridge: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    prompt_limit_bytes: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    stdout_limit_bytes: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    extensions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodBoolean>>>;
}, "strict", z.ZodTypeAny, {
    model: string | null;
    fallback_model: string | null;
    timeout_ms: number | null;
    stall_timeout_ms: number | null;
    max_retries: number | null;
    thinking_level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
    fallback_models?: string[] | null | undefined;
    interactive?: boolean | null | undefined;
    stdout_limit_bytes?: number | null | undefined;
    prompt_limit_bytes?: number | null | undefined;
    lease_waiver?: boolean | null | undefined;
    claude_bridge?: boolean | null | undefined;
    extensions?: Record<string, boolean | null> | undefined;
}, {
    model: string | null;
    fallback_model: string | null;
    timeout_ms: number | null;
    stall_timeout_ms: number | null;
    max_retries: number | null;
    thinking_level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
    fallback_models?: string[] | null | undefined;
    interactive?: boolean | null | undefined;
    stdout_limit_bytes?: number | null | undefined;
    prompt_limit_bytes?: number | null | undefined;
    lease_waiver?: boolean | null | undefined;
    claude_bridge?: boolean | null | undefined;
    extensions?: Record<string, boolean | null> | undefined;
}>;
/**
 * Reserved top-level key in `~/.config/specialists/user.json` for switches that apply to the
 * operator's machine rather than to one Specialist (SPECIALISTS-4405).
 *
 * It is NOT a specialist name: the record schema below filters it out before validation, exactly
 * like the `_` metadata keys, or a single switch would invalidate every override in the file.
 */
export declare const CLAUDE_BRIDGE_SWITCH_KEY = "claude_bridge";
/** The operator half of the Claude Code route switch. Both this and the definition flag must be on. */
export declare const ClaudeBridgeSwitchSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    enabled: boolean;
}, {
    enabled?: boolean | undefined;
}>;
export declare const GlobalSpecialistOverrideSchema: z.ZodObject<{
    execution: z.ZodObject<{
        model: z.ZodNullable<z.ZodString>;
        fallback_model: z.ZodNullable<z.ZodString>;
        fallback_models: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        timeout_ms: z.ZodNullable<z.ZodNumber>;
        stall_timeout_ms: z.ZodNullable<z.ZodNumber>;
        interactive: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        thinking_level: z.ZodNullable<z.ZodEnum<["off", "minimal", "low", "medium", "high", "xhigh"]>>;
        max_retries: z.ZodNullable<z.ZodNumber>;
        /** Workspace-lease waiver for read-tier observers (mirrors specialist `execution.lease_waiver`). */
        lease_waiver: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        /**
         * Opt-in Claude Code route (SPECIALISTS-4405). Listed in
         * `OVERRIDE_ALLOWED_EXECUTION_FIELDS`, so it belongs here too: a field the allowlist advertises
         * must be settable, or the CLI rejects a route the docs say is configurable.
         */
        claude_bridge: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        prompt_limit_bytes: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        stdout_limit_bytes: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        extensions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodBoolean>>>;
    }, "strict", z.ZodTypeAny, {
        model: string | null;
        fallback_model: string | null;
        timeout_ms: number | null;
        stall_timeout_ms: number | null;
        max_retries: number | null;
        thinking_level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
        fallback_models?: string[] | null | undefined;
        interactive?: boolean | null | undefined;
        stdout_limit_bytes?: number | null | undefined;
        prompt_limit_bytes?: number | null | undefined;
        lease_waiver?: boolean | null | undefined;
        claude_bridge?: boolean | null | undefined;
        extensions?: Record<string, boolean | null> | undefined;
    }, {
        model: string | null;
        fallback_model: string | null;
        timeout_ms: number | null;
        stall_timeout_ms: number | null;
        max_retries: number | null;
        thinking_level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
        fallback_models?: string[] | null | undefined;
        interactive?: boolean | null | undefined;
        stdout_limit_bytes?: number | null | undefined;
        prompt_limit_bytes?: number | null | undefined;
        lease_waiver?: boolean | null | undefined;
        claude_bridge?: boolean | null | undefined;
        extensions?: Record<string, boolean | null> | undefined;
    }>;
    prompt: z.ZodOptional<z.ZodObject<{
        system_prompt_mode: z.ZodNullable<z.ZodEnum<["append", "replace"]>>;
    }, "strict", z.ZodTypeAny, {
        system_prompt_mode: "replace" | "append" | null;
    }, {
        system_prompt_mode: "replace" | "append" | null;
    }>>;
    stall_detection: z.ZodOptional<z.ZodObject<{
        waiting_auto_close_ms: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "strict", z.ZodTypeAny, {
        waiting_auto_close_ms?: number | null | undefined;
    }, {
        waiting_auto_close_ms?: number | null | undefined;
    }>>;
    /** Legacy sp CLI only: native activations ignore it (SPECIALISTS-52). */
    beads_write_notes: z.ZodNullable<z.ZodBoolean>;
    notes_mode: z.ZodOptional<z.ZodNullable<z.ZodEnum<["full-trail", "final-only"]>>>;
    output_file: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    skills: z.ZodObject<{
        paths: z.ZodArray<z.ZodString, "many">;
    }, "strict", z.ZodTypeAny, {
        paths: string[];
    }, {
        paths: string[];
    }>;
    mandatory_rules: z.ZodOptional<z.ZodObject<{
        template_sets: z.ZodNullable<z.ZodArray<z.ZodString, "many">>;
    }, "strict", z.ZodTypeAny, {
        template_sets: string[] | null;
    }, {
        template_sets: string[] | null;
    }>>;
}, "strict", z.ZodTypeAny, {
    execution: {
        model: string | null;
        fallback_model: string | null;
        timeout_ms: number | null;
        stall_timeout_ms: number | null;
        max_retries: number | null;
        thinking_level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
        fallback_models?: string[] | null | undefined;
        interactive?: boolean | null | undefined;
        stdout_limit_bytes?: number | null | undefined;
        prompt_limit_bytes?: number | null | undefined;
        lease_waiver?: boolean | null | undefined;
        claude_bridge?: boolean | null | undefined;
        extensions?: Record<string, boolean | null> | undefined;
    };
    skills: {
        paths: string[];
    };
    beads_write_notes: boolean | null;
    prompt?: {
        system_prompt_mode: "replace" | "append" | null;
    } | undefined;
    stall_detection?: {
        waiting_auto_close_ms?: number | null | undefined;
    } | undefined;
    mandatory_rules?: {
        template_sets: string[] | null;
    } | undefined;
    output_file?: string | null | undefined;
    notes_mode?: "full-trail" | "final-only" | null | undefined;
}, {
    execution: {
        model: string | null;
        fallback_model: string | null;
        timeout_ms: number | null;
        stall_timeout_ms: number | null;
        max_retries: number | null;
        thinking_level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
        fallback_models?: string[] | null | undefined;
        interactive?: boolean | null | undefined;
        stdout_limit_bytes?: number | null | undefined;
        prompt_limit_bytes?: number | null | undefined;
        lease_waiver?: boolean | null | undefined;
        claude_bridge?: boolean | null | undefined;
        extensions?: Record<string, boolean | null> | undefined;
    };
    skills: {
        paths: string[];
    };
    beads_write_notes: boolean | null;
    prompt?: {
        system_prompt_mode: "replace" | "append" | null;
    } | undefined;
    stall_detection?: {
        waiting_auto_close_ms?: number | null | undefined;
    } | undefined;
    mandatory_rules?: {
        template_sets: string[] | null;
    } | undefined;
    output_file?: string | null | undefined;
    notes_mode?: "full-trail" | "final-only" | null | undefined;
}>;
export type GlobalSpecialistOverride = z.infer<typeof GlobalSpecialistOverrideSchema>;
export declare function getGlobalSpecialistOverrideLeafPaths(): readonly string[];
/** Top-level shape: { "<specialist-name>": GlobalSpecialistOverride }. Underscore keys are metadata sentinels. */
export declare const GlobalUserConfigSchema: z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodObject<{
    execution: z.ZodObject<{
        model: z.ZodNullable<z.ZodString>;
        fallback_model: z.ZodNullable<z.ZodString>;
        fallback_models: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        timeout_ms: z.ZodNullable<z.ZodNumber>;
        stall_timeout_ms: z.ZodNullable<z.ZodNumber>;
        interactive: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        thinking_level: z.ZodNullable<z.ZodEnum<["off", "minimal", "low", "medium", "high", "xhigh"]>>;
        max_retries: z.ZodNullable<z.ZodNumber>;
        /** Workspace-lease waiver for read-tier observers (mirrors specialist `execution.lease_waiver`). */
        lease_waiver: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        /**
         * Opt-in Claude Code route (SPECIALISTS-4405). Listed in
         * `OVERRIDE_ALLOWED_EXECUTION_FIELDS`, so it belongs here too: a field the allowlist advertises
         * must be settable, or the CLI rejects a route the docs say is configurable.
         */
        claude_bridge: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        prompt_limit_bytes: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        stdout_limit_bytes: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        extensions: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNullable<z.ZodBoolean>>>;
    }, "strict", z.ZodTypeAny, {
        model: string | null;
        fallback_model: string | null;
        timeout_ms: number | null;
        stall_timeout_ms: number | null;
        max_retries: number | null;
        thinking_level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
        fallback_models?: string[] | null | undefined;
        interactive?: boolean | null | undefined;
        stdout_limit_bytes?: number | null | undefined;
        prompt_limit_bytes?: number | null | undefined;
        lease_waiver?: boolean | null | undefined;
        claude_bridge?: boolean | null | undefined;
        extensions?: Record<string, boolean | null> | undefined;
    }, {
        model: string | null;
        fallback_model: string | null;
        timeout_ms: number | null;
        stall_timeout_ms: number | null;
        max_retries: number | null;
        thinking_level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
        fallback_models?: string[] | null | undefined;
        interactive?: boolean | null | undefined;
        stdout_limit_bytes?: number | null | undefined;
        prompt_limit_bytes?: number | null | undefined;
        lease_waiver?: boolean | null | undefined;
        claude_bridge?: boolean | null | undefined;
        extensions?: Record<string, boolean | null> | undefined;
    }>;
    prompt: z.ZodOptional<z.ZodObject<{
        system_prompt_mode: z.ZodNullable<z.ZodEnum<["append", "replace"]>>;
    }, "strict", z.ZodTypeAny, {
        system_prompt_mode: "replace" | "append" | null;
    }, {
        system_prompt_mode: "replace" | "append" | null;
    }>>;
    stall_detection: z.ZodOptional<z.ZodObject<{
        waiting_auto_close_ms: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, "strict", z.ZodTypeAny, {
        waiting_auto_close_ms?: number | null | undefined;
    }, {
        waiting_auto_close_ms?: number | null | undefined;
    }>>;
    /** Legacy sp CLI only: native activations ignore it (SPECIALISTS-52). */
    beads_write_notes: z.ZodNullable<z.ZodBoolean>;
    notes_mode: z.ZodOptional<z.ZodNullable<z.ZodEnum<["full-trail", "final-only"]>>>;
    output_file: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    skills: z.ZodObject<{
        paths: z.ZodArray<z.ZodString, "many">;
    }, "strict", z.ZodTypeAny, {
        paths: string[];
    }, {
        paths: string[];
    }>;
    mandatory_rules: z.ZodOptional<z.ZodObject<{
        template_sets: z.ZodNullable<z.ZodArray<z.ZodString, "many">>;
    }, "strict", z.ZodTypeAny, {
        template_sets: string[] | null;
    }, {
        template_sets: string[] | null;
    }>>;
}, "strict", z.ZodTypeAny, {
    execution: {
        model: string | null;
        fallback_model: string | null;
        timeout_ms: number | null;
        stall_timeout_ms: number | null;
        max_retries: number | null;
        thinking_level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
        fallback_models?: string[] | null | undefined;
        interactive?: boolean | null | undefined;
        stdout_limit_bytes?: number | null | undefined;
        prompt_limit_bytes?: number | null | undefined;
        lease_waiver?: boolean | null | undefined;
        claude_bridge?: boolean | null | undefined;
        extensions?: Record<string, boolean | null> | undefined;
    };
    skills: {
        paths: string[];
    };
    beads_write_notes: boolean | null;
    prompt?: {
        system_prompt_mode: "replace" | "append" | null;
    } | undefined;
    stall_detection?: {
        waiting_auto_close_ms?: number | null | undefined;
    } | undefined;
    mandatory_rules?: {
        template_sets: string[] | null;
    } | undefined;
    output_file?: string | null | undefined;
    notes_mode?: "full-trail" | "final-only" | null | undefined;
}, {
    execution: {
        model: string | null;
        fallback_model: string | null;
        timeout_ms: number | null;
        stall_timeout_ms: number | null;
        max_retries: number | null;
        thinking_level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
        fallback_models?: string[] | null | undefined;
        interactive?: boolean | null | undefined;
        stdout_limit_bytes?: number | null | undefined;
        prompt_limit_bytes?: number | null | undefined;
        lease_waiver?: boolean | null | undefined;
        claude_bridge?: boolean | null | undefined;
        extensions?: Record<string, boolean | null> | undefined;
    };
    skills: {
        paths: string[];
    };
    beads_write_notes: boolean | null;
    prompt?: {
        system_prompt_mode: "replace" | "append" | null;
    } | undefined;
    stall_detection?: {
        waiting_auto_close_ms?: number | null | undefined;
    } | undefined;
    mandatory_rules?: {
        template_sets: string[] | null;
    } | undefined;
    output_file?: string | null | undefined;
    notes_mode?: "full-trail" | "final-only" | null | undefined;
}>>, Record<string, {
    execution: {
        model: string | null;
        fallback_model: string | null;
        timeout_ms: number | null;
        stall_timeout_ms: number | null;
        max_retries: number | null;
        thinking_level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
        fallback_models?: string[] | null | undefined;
        interactive?: boolean | null | undefined;
        stdout_limit_bytes?: number | null | undefined;
        prompt_limit_bytes?: number | null | undefined;
        lease_waiver?: boolean | null | undefined;
        claude_bridge?: boolean | null | undefined;
        extensions?: Record<string, boolean | null> | undefined;
    };
    skills: {
        paths: string[];
    };
    beads_write_notes: boolean | null;
    prompt?: {
        system_prompt_mode: "replace" | "append" | null;
    } | undefined;
    stall_detection?: {
        waiting_auto_close_ms?: number | null | undefined;
    } | undefined;
    mandatory_rules?: {
        template_sets: string[] | null;
    } | undefined;
    output_file?: string | null | undefined;
    notes_mode?: "full-trail" | "final-only" | null | undefined;
}>, unknown>;
export type GlobalUserConfig = Record<string, GlobalSpecialistOverride | string> & {
    _doc?: string;
};
export interface GlobalConfigValidationResult {
    valid: boolean;
    errors: Array<{
        path: string;
        message: string;
    }>;
}
/**
 * Build the override template for a single specialist (all fields defaulted to
 * null / [] = inherit). Used by sp init --global to seed each specialist entry.
 */
export declare function buildSpecialistOverrideTemplate(): GlobalSpecialistOverride;
/**
 * Build the full global config template keyed by specialist name.
 * @param specialistNames - every specialist currently visible to SpecialistLoader.list()
 */
export declare function buildGlobalUserConfigTemplate(specialistNames: ReadonlyArray<string>): GlobalUserConfig;
export interface GlobalConfigMergeResult {
    config: GlobalUserConfig;
    added: string[];
    extended: string[];
    removed: string[];
}
/**
 * Idempotent merge: extend an existing global config with newly-shipped
 * specialists and fill any missing override fields with defaults.
 * NEVER clobbers a user-filled value. Removed specialists STAY in the file.
 *
 * @param existing - parsed existing config (may be empty)
 * @param template - fresh template built from SpecialistLoader.list()
 */
export declare function mergeGlobalUserConfig(existing: Readonly<Record<string, unknown>>, template: GlobalUserConfig): GlobalConfigMergeResult;
export interface GlobalConfigDriftReport {
    /** Per specialist: dotted template paths absent from the user's entry. */
    missingFields: Record<string, string[]>;
    /** `execution.extensions` keys the runtime ignores by name (retired extensions). */
    retiredExtensions: Array<{
        specialist: string;
        source: string;
    }>;
    /**
     * Extension sources set to anything but `true` that no lower layer enables. Only `true`
     * loads a source and only `gitnexus` honours `false` (resolveExecutionExtensionSelection);
     * a `false` still matters when it turns off a source the canonical spec enables, so that
     * case is not reported.
     */
    inertExtensions: Array<{
        specialist: string;
        source: string;
        value: unknown;
    }>;
    /** Local-path extension sources enabled with `true` whose path does not exist. */
    missingPathExtensions: Array<{
        specialist: string;
        source: string;
    }>;
}
/**
 * Read-only drift report for an existing global user config (SPECIALISTS-52): the
 * template fields `sp init --global` would add, and extension keys that look like
 * configuration but are ignored or broken. Never mutates `existing`; user-added
 * sources that are enabled and resolvable are not reported.
 */
export declare function analyzeGlobalUserConfigDrift(existing: Readonly<Record<string, unknown>>, template: GlobalUserConfig, options?: {
    pathExists?: (path: string) => boolean;
    /** True when a layer below user.json enables `source` for `specialist`. */
    enabledBelow?: (specialist: string, source: string) => boolean;
}): GlobalConfigDriftReport;
/**
 * Validate a raw JSON string against the global user-config schema.
 * Returns structured errors; never throws on invalid input.
 */
export declare function validateGlobalUserConfig(jsonContent: string): GlobalConfigValidationResult;
/**
 * Read and parse the global user config. Returns null if the file does not
 * exist. Throws on invalid JSON. Callers validating before use should prefer
 * {@link validateGlobalUserConfig}.
 */
export declare function readGlobalUserConfig(location: GlobalUserConfigPath): GlobalUserConfig | null;
export interface ValidatedGlobalUserConfigResult {
    /** Parsed config when the file exists AND passes GlobalUserConfigSchema; null otherwise. */
    config: GlobalUserConfig | null;
    /** Human-readable reason when the file exists but is invalid; null when absent or valid. */
    invalidReason: string | null;
}
/**
 * Read + schema-validate the global user config WITHOUT throwing on malformed
 * content (unitAI-klo6k). Shared fail-safe for introspection CLIs (doctor,
 * list-rules): invalid JSON or schema violations yield
 * `{ config: null, invalidReason }` so the caller can warn and degrade, while
 * valid files yield the parsed config. Keeps the raw parse
 * ({@link readGlobalUserConfig}) untouched for runtime callers that already
 * handle parse failures themselves.
 */
export declare function readValidatedGlobalUserConfig(location: GlobalUserConfigPath): ValidatedGlobalUserConfigResult;
/**
 * Write the global user config, creating parent directories as needed.
 *
 * Atomic-write semantics: serialize JSON, write to a sibling temp file in
 * the same directory, then renameSync over the destination. POSIX rename
 * is atomic within the same filesystem, so a crash between truncate +
 * write can no longer leave user.json empty or half-written.
 *
 * If the rename fails (e.g. cross-filesystem mount, no permission), fall
 * back to a direct writeFileSync so we still update the file rather than
 * leaving the user without a way to persist their override.
 */
export declare function writeGlobalUserConfig(location: GlobalUserConfigPath, config: GlobalUserConfig): void;
export { SPECIALISTS_SUBDIR, CONFIG_FILENAME };
//# sourceMappingURL=global-config.d.ts.map