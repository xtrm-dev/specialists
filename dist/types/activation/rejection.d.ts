import type { DispatchRejectedError } from './types.js';
/**
 * Shared refusal renderer (unitAI-t2kol.4).
 *
 * Three renderers described one gate: the Pi issue-path `{status,reason,detail}`
 * plus build, the Pi inline-path `{status,reason,missing}` plus build, and the
 * MCP local `{status,reason,detail}` with no build and `missing` buried in
 * detail. An MCP operator could not see top-level `missing` and could not tell
 * a stale-build refusal from a broken-contract refusal. This is the single
 * renderer both frontends use; the Pi extension adopts it (SPECIALISTS-4341).
 *
 * Pure given explicit inputs: the caller renders the build string with
 * `describeBuildIdentity(loadedId, readBuildId(path))` and passes it in, so
 * tests never touch the filesystem. `missing` is promoted to the top level by
 * the caller and is never stripped from `detail` where the host put it — the
 * envelope stays byte-identical to what the host threw, with `fix` added.
 */
export interface RejectionInput {
    reason: string;
    detail?: DispatchRejectedError['detail'];
    missing?: string[];
    /** Explicit fix override for adapter-side gates; otherwise derived from the reason. */
    fix?: string;
}
/**
 * Every wire refusal reason present on master 2a450f5b8, by reason name.
 *
 * 30 from `reject()` in `src/activation/native-host.ts`, plus
 * `workspace_isolation_unavailable`, `workspace_held_by_another_writer`,
 * `workspace_lease_uncertain`, `workspace_lease_not_held_by_caller` from
 * `src/activation/workspace-lease.ts`, plus `unknown_activation`,
 * `not_resumable`, `not_steerable` thrown directly as `DispatchRejectedError`
 * in `native-host.ts`. `workspace_lease_unavailable` is an event-only
 * telemetry name, not a wire reason, and is excluded.
 */
export declare const DISPATCH_REFUSAL_REASONS: readonly ["unknown_specialist", "work_item_store_unavailable", "parent_ref_and_ref", "kind_and_ref", "parent_ref_without_contract", "kind_without_contract", "contract_and_ref", "unknown_kind", "parent_unresolvable", "parent_terminal", "issue_not_dispatchable", "no_work_ref", "issue_unresolvable", "issue_revision_diverged", "empty_tool_contract", "required_pre_script_failed", "pi_sdk_resource_loader_unavailable", "invalid_thinking_override", "no_model_configured", "model_unavailable", "extension_tool_shadowed", "extension_discovery_failed", "context_unresolvable", "mandatory_rules_unavailable", "preflight_failed", "unguardable_mutating_tools", "permission_guard_unavailable", "tool_contract_unsatisfied", "issue_binding_failed", "context_changed", "workspace_isolation_unavailable", "workspace_held_by_another_writer", "workspace_lease_uncertain", "workspace_lease_not_held_by_caller", "unknown_activation", "not_resumable", "not_steerable"];
export type DispatchRefusalReason = (typeof DISPATCH_REFUSAL_REASONS)[number];
/**
 * Corrective fix for every wire refusal, in Substrate vocabulary.
 *
 * The compiler forces a fix for every reason (`Record<..., string>`). The four
 * lease reasons are shared with `specialist_lease_reconcile`.
 */
export declare const FIX_BY_REASON: Record<DispatchRefusalReason, string>;
/**
 * Fix for a refusal reason string.
 *
 * Matches an exact wire reason, or a `DispatchRejectedError.message` block that
 * wraps the bare reason (`reason:\n  <reason>`), which is what both frontends
 * store in the `reason` field. Returns undefined when no wire reason matches.
 */
export declare function fixForRefusalReason(reason: string): string | undefined;
/**
 * Reason text substituted when a stale runtime produced a downstream refusal.
 * Names the cause, names the remedy, and tells the reader not to act on the
 * superseded text underneath it. The ids ride the `build` field.
 */
export declare const STALE_RUNTIME_REASON: string;
/** An outcome payload carrying a machine reason and an optional detail envelope. */
export interface RefusalPayload {
    reason?: unknown;
    detail?: unknown;
    [key: string]: unknown;
}
/**
 * Supersede a downstream refusal reason with the staleness that explains it.
 *
 * Returns the payload UNCHANGED — same object shape, same field order — unless
 * `stale` is true AND the reason is one of the environment-symptom reasons. So a
 * matching build renders exactly as it did before this branch existed.
 *
 * The superseded reason is never suppressed: it moves to
 * `detail.refused_by_stale_runtime` so a reader has both the cause and the
 * symptom. `build` is attached by the caller, not here.
 */
export declare function supersedeStaleRefusal<T extends RefusalPayload>(payload: T, stale: boolean, build?: string): T;
export declare function renderRejection(input: RejectionInput, build?: string, stale?: boolean): {
    build?: string | undefined;
    missing?: string[] | undefined;
    detail?: {
        specialist?: string;
        issueRef?: string;
        missing?: string[];
        workspace?: string;
        holder?: string;
        requestedModel?: string;
        activationId?: string;
        created_ref?: string;
        note?: string;
    } | undefined;
    fix?: string | undefined;
    status: "rejected";
    reason: string;
};
//# sourceMappingURL=rejection.d.ts.map