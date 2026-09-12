import type { DispatchRejectedError } from './types.js';
/**
 * Shared refusal renderer (unitAI-t2kol.4).
 *
 * Three renderers described one gate: the Pi bead-path `{status,reason,detail}`
 * plus build, the Pi inline-path `{status,reason,missing}` plus build, and the
 * MCP local `{status,reason,detail}` with no build and `missing` buried in
 * detail. An MCP operator could not see top-level `missing` and could not tell
 * a stale-build refusal from a broken-contract refusal. This is the single
 * renderer both frontends use; the Pi extension adopts it as a follow-up.
 *
 * Pure given explicit inputs: the caller renders the build string with
 * `describeBuildIdentity(loadedId, readBuildId(path))` and passes it in, so
 * tests never touch the filesystem. `missing` is promoted to the top level by
 * the caller and is never stripped from `detail` where the host put it — the
 * envelope stays byte-identical to what the host threw.
 */
export interface RejectionInput {
    reason: string;
    detail?: DispatchRejectedError['detail'];
    missing?: string[];
}
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
        note?: string;
    } | undefined;
    status: "rejected";
    reason: string;
};
//# sourceMappingURL=rejection.d.ts.map