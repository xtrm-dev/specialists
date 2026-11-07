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
/**
 * The same contract for a body that awaits (SPECIALISTS-4398).
 *
 * The port became asynchronous so the host can publish against a remote store, and awaiting
 * inside the exclusion is only safe if two properties hold. Both are checked, not assumed:
 *
 * - **In-process serialisation still holds.** The old form could not interleave two calls in
 *   one process because `fn` never yielded; an awaiting body can. The lease covers this
 *   because `acquire` takes a holder id unique per acquisition (`randomUUID`), so a second
 *   concurrent call for the same (activation, attempt) is a DIFFERENT holder and is refused as
 *   contended while the first is live. The holder pid is this process and its `/proc` start
 *   ticks still match, so the lease reads HELD, not uncertain — refused, not reclaimed. A test
 *   runs two concurrent calls and asserts one publication.
 * - **No TTL to outlive.** The workspace lease is liveness-based (`/proc` start ticks), not
 *   expiry-based: there is no deadline in the record that a body crossing ssh could exceed. A
 *   holder that dies mid-body is the reclaimable case the republish pass already handles.
 *
 * The failure path is unchanged and deliberate: the body's throw propagates after `release()`
 * in the `finally`, the settlement record stays `pending`, and `republishPendingSettlements`
 * retries it — reconciling by reading first, never by re-sending a mutation that may have
 * been applied. That is why a `timeout` or `connection_lost` inside the body is safe here even
 * though a mutation over the wire is never retried automatically.
 */
export declare function withSettlementExclusionAsync<T>(subject: SettlementExclusionSubject, fn: () => Promise<T>, opts?: {
    reclaimStale?: boolean;
    probe?: LeaseProcessProbe;
}): Promise<ExclusionOutcome<T>>;
//# sourceMappingURL=settlement-lease.d.ts.map