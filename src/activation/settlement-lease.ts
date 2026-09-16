// src/activation/settlement-lease.ts
//
// Cross-process exclusion for settlement publication (SPECIALISTS-66).
//
// This module adds NO locking primitive. `workspace-lease.ts` already owns one with the
// three properties this needs — atomic `linkSync`/EEXIST publish so a loser never observes
// a half-written holder, `/proc` field-22 startTicks liveness instead of a self-reported
// status, and `uncertain` rather than a blind free on a holder whose liveness is unknown.
// Everything here is composition over that module's exported functions.
//
// ## Why publication needs exclusion at all
//
// SPECIALISTS-54 made republish exactly-once by RECONCILIATION: read the producer, and only
// a proven absence licenses a write. That is correct and it is not sufficient, because two
// sequences defeat a read (SPECIALISTS-66):
//
//   D1  `republishOncePerProcess` guards with a per-INSTANCE boolean while the settlement
//       store is a file store keyed by cwd. Two host processes in one cwd both drain the
//       same backlog, both read absent, and both allocate and append.
//   D2  `publishSettlement` stores the record before it allocates, and `publicationStateOf`
//       reads an absent `publication` field as `pending`. So the record sits in another
//       process's backlog for the whole publication window.
//
// No read fixes D2: "did this already land?" is TOCTOU while another process is mid-write.
// The reconciliation read is only authoritative when no live writer can be racing it, which
// is exactly what an exclusion establishes. Reads therefore move INSIDE the exclusion.
//
// ## Two deliberate departures from the workspace-lease defaults
//
// 1. **A synthetic workspace key, per (activation, attempt).** `workspaceKey` hashes
//    `realpath(worktreePath)` and nothing else, so keying by the real worktree would couple
//    settlement publication to unrelated workspace mutability: a READ-ONLY activation takes
//    no workspace lease but DOES publish a settlement, and it would then block behind any
//    unrelated write activation in that worktree. `realpathSync` fails on the synthetic path
//    and the literal is hashed, which is the documented fallback.
//
// 2. **A holder identity unique per acquisition, not the activation id.** `acquire` treats a
//    held lease whose `activationId` matches as a RESUME and rewrites it — correct for a
//    workspace (a retry is a new attempt under one activation), and fatal here, because the
//    two racers in D1/D2 are publishing the SAME (activation, attempt) and would both be
//    admitted by that branch. The activation is the DOMAIN, carried in the key; the HOLDER is
//    one publication attempt in one process.
//
// ## Residual: a host without `/proc`
//
// `procLeaseProbe().canVerify()` is false there, so every HELD lease reads `uncertain` with
// reason `liveness_unverifiable` rather than `holder_process_gone`. The reclaim below refuses
// that reason by design, so on such a host a holder that crashed mid-publication wedges that
// settlement permanently: it stays `pending` and no pass can take it. Conservative and
// consistent with the workspace lease, and a real hole in "republish recovers the crashed
// holder" — stated here rather than left implicit. The exclusion is also per-MACHINE, because
// the settlement store it protects is per-cwd; two hosts on different machines sharing one
// Substrate store are not serialised by it.
//
// Records land in the same `.specialists/leases` directory as workspace leases — one
// discoverable place, as that module intends — and their `worktreePath` field is the
// self-describing `settlement:<activation>:<attempt>` literal, so a reader can always tell
// the two kinds apart.

import { unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DispatchRejectedError, type WorkspaceIdentity } from './types.js';
import { acquire, inspect, leasePath, procLeaseProbe, release, type LeaseProcessProbe } from './workspace-lease.js';

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
export function exclusionWorkspace(subject: SettlementExclusionSubject): WorkspaceIdentity {
  return {
    repositoryRoot: subject.repositoryRoot,
    ...(subject.gitCommonDir ? { gitCommonDir: subject.gitCommonDir } : {}),
    worktreePath: `settlement:${subject.activationId}:${subject.attemptId}`,
  };
}

/**
 * Outcome of running a section under the exclusion. Never throws on contention.
 *
 * `contended` distinguishes "another holder has this settlement" from "the exclusion could not
 * be taken at all" — an unwritable lease directory, a permission error. Both defer, so the
 * caller behaves identically, but reporting a permission failure as contention would send a
 * reader hunting for a second publisher that never existed.
 */
export type ExclusionOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; contended: boolean; reason: string };

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
export function withSettlementExclusion<T>(
  subject: SettlementExclusionSubject,
  fn: () => T,
  opts: { reclaimStale?: boolean; probe?: LeaseProcessProbe } = {},
): ExclusionOutcome<T> {
  const workspace = exclusionWorkspace(subject);
  // One publication attempt in one process. Unique per acquisition so `acquire`'s
  // same-activation resume branch can never admit a second racer for this settlement.
  const holderId = `settlement-publication:${process.pid}:${randomUUID()}`;
  const probe = opts.probe ?? procLeaseProbe();

  const take = (): { contended: boolean; reason: string } | undefined => {
    try {
      acquire({ workspace, activationId: holderId, attemptId: subject.attemptId }, probe);
      return undefined;
    } catch (error) {
      // Only the lease module's own refusals are contention. Anything else — an unwritable
      // directory, a permission error — is an infrastructure failure wearing the same shape.
      const contended = error instanceof DispatchRejectedError;
      const reason = error instanceof Error ? error.message : String(error);
      return {
        contended,
        reason: contended
          ? `settlement publication is held elsewhere: ${reason}`
          : `settlement exclusion could not be taken: ${reason}`,
      };
    }
  };

  let failure = take();
  if (failure !== undefined && opts.reclaimStale === true && reclaimIfHolderGone(subject, workspace, probe)) {
    failure = take();
  }
  if (failure !== undefined) {
    return { ok: false, contended: failure.contended, reason: failure.reason };
  }

  try {
    return { ok: true, value: fn() };
  } finally {
    try {
      release(workspace, holderId, probe);
    } catch {
      // A release that refuses leaves the record for the next pass to reclaim. Publication
      // has already happened at this point; turning its teardown into a failure would report
      // a settled activation as unsettled.
    }
  }
}

/**
 * Remove a settlement exclusion record whose holder process is PROVABLY gone.
 *
 * Deliberately not `release`, which refuses an `uncertain` lease by design. That refusal is
 * right for a workspace, where a dead holder may have left a half-written tree and only Phase 9
 * may decide. It is wrong for a settlement exclusion, where the state a dead holder may have
 * left is exactly what the reconciliation reads answer: the producer's receipt and Journal
 * result ARE the durable authority, so reclaiming on a proven-gone holder is a comparison, not
 * a guess. Narrow by construction: only `holder_process_gone`, never a start-ticks mismatch,
 * an unreadable record, or a host that cannot verify liveness at all.
 *
 * ## Why the reclaim itself needs exclusion (SPECIALISTS-66 review)
 *
 * `inspect` then `unlink` is not atomic, and an unconditional delete does not check that the
 * record is still the one inspected. Two reclaimers is the PRIMARY case here, because both
 * processes first-dispatch and both run the pass:
 *
 *   A inspect -> gone   B inspect -> gone
 *   A unlink, A acquire -> SUCCESS, A is publishing
 *   B unlink  -> deletes A's LIVE lease
 *   B acquire -> SUCCESS. Two publishers for one (activation, attempt).
 *
 * Replacing the unlink with an atomic rename does NOT fix this. It closes the free window, but
 * the destructive step stays unconditional: B renames over A's live record and then verifies
 * its OWN id, which is the success condition, so both proceed. The free window was never the
 * mechanism — the unguarded read-then-destroy was.
 *
 * So the reclaim runs under its own exclusion, on a second synthetic key, taken with the same
 * primitive. Then exactly one reclaimer can hold the read-then-destroy section, and whichever
 * interleaving follows resolves correctly: a reclaimer entering after the delete sees `free`
 * and destroys nothing, one entering after the winner acquired sees a LIVE holder and destroys
 * nothing, and `acquire`'s own EEXIST decides the single winner either way.
 *
 * ponytail: a reclaim-mutex holder that dies inside the section wedges reclaim for that one
 * settlement, because nothing reclaims the reclaim mutex. Bounded deliberately — that section
 * is an inspect and an unlink, microseconds, against a publication window that spans producer
 * writes. Upgrade path if it ever shows up: a liveness-checked takeover of the mutex, or a TTL
 * on it.
 *
 * That ceiling is acceptable for two reasons, and the second is the load-bearing one. It fails
 * CLOSED — a wedge publishes nothing, where the bug it replaces published twice, and for an
 * exactly-once guarantee erring toward not publishing is the correct direction. And it stays
 * DETECTABLE: the record remains `pending`, so `listPendingPublication` keeps returning it and
 * every deferral emits its reason. A wedge that no query could surface would not be acceptable
 * on the fail-closed argument alone.
 */
function reclaimIfHolderGone(
  subject: SettlementExclusionSubject,
  workspace: WorkspaceIdentity,
  probe: LeaseProcessProbe,
): boolean {
  const mutex: WorkspaceIdentity = {
    ...workspace,
    worktreePath: `settlement-reclaim:${subject.activationId}:${subject.attemptId}`,
  };
  const mutexHolder = `settlement-reclaim:${process.pid}:${randomUUID()}`;
  try {
    acquire({ workspace: mutex, activationId: mutexHolder, attemptId: subject.attemptId }, probe);
  } catch {
    // Another reclaimer holds the section. Not ours to run: it either completes the reclaim or
    // does not, and either way this pass defers rather than racing it.
    return false;
  }
  try {
    const status = inspect(workspace, probe);
    if (status.state !== 'uncertain' || status.uncertainReason !== 'holder_process_gone') return false;
    unlinkSync(leasePath(workspace));
    return true;
  } catch {
    return false;
  } finally {
    try {
      release(mutex, mutexHolder, probe);
    } catch {
      // Left for the ceiling documented above.
    }
  }
}
