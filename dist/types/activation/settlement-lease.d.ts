import { type WorkspaceIdentity } from './types.js';
import { type LeaseProcessProbe } from './workspace-lease.js';
/** The publication this exclusion protects. The (activation, attempt) pair IS the domain. */
export interface SettlementExclusionSubject {
    repositoryRoot: string;
    gitCommonDir?: string;
    activationId: string;
    attemptId: string;
}
/**
 * The synthetic mutation domain for one settlement publication.
 *
 * `worktreePath` is a literal, not a path: it never resolves, and `workspaceKey` hashes the
 * literal when `realpathSync` fails. That is what makes the key per (activation, attempt)
 * instead of per worktree.
 */
export declare function exclusionWorkspace(subject: SettlementExclusionSubject): WorkspaceIdentity;
/**
 * Outcome of running a section under the exclusion. Never throws on contention.
 *
 * `contended` distinguishes "another holder has this settlement" from "the exclusion could not
 * be taken at all" — an unwritable lease directory, a permission error. Both defer, so the
 * caller behaves identically, but reporting a permission failure as contention would send a
 * reader hunting for a second publisher that never existed.
 */
export type ExclusionOutcome<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    contended: boolean;
    reason: string;
};
/**
 * Run `fn` holding the settlement exclusion for this (activation, attempt).
 *
 * Contention is a RESULT, never an exception: `publishSettlement` is best-effort by contract
 * (ADR §38) and must never alter the validated activation result, so a contended publication
 * degrades to `pending` with the reason and the backlog retries it later.
 *
 * `fn`'s own throw propagates — a producer-side failure is the caller's existing degraded
 * path and must not be reported as contention.
 *
 * `reclaimStale` is for the republish pass only. A lease whose holder the probe reports as
 * GONE is a proven absence, not an unknown, and it is the one case where reclaiming is
 * sound: with no live writer the reconciliation read is authoritative again, which is the
 * same "only a proven absence licenses a write" rule the publication path already follows.
 * Every other `uncertain` reason — an unverifiable host, a start-ticks mismatch, an
 * unreadable record — is left alone, exactly as the workspace lease requires.
 */
export declare function withSettlementExclusion<T>(subject: SettlementExclusionSubject, fn: () => T, opts?: {
    reclaimStale?: boolean;
    probe?: LeaseProcessProbe;
}): ExclusionOutcome<T>;
//# sourceMappingURL=settlement-lease.d.ts.map