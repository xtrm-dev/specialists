// src/activation/settlement-store.ts
//
// Runtime result storage for Specialist settlement (S1, XTRM-252.8 / ADR §38).
//
// The full settlement — including the raw model output — lives HERE, never in
// the Journal. The Journal carries a bounded reference (ADR §39); this store
// is what that reference resolves to. One record per (activation, attempt), so
// retry/resume legs stay distinguishable and queryable (ADR §97).
//
// The host owns this store the way it owns the workspace lease: it is runtime
// state, not durable work authority. Journal/WorkReceipt publication goes
// through the Substrate boundary; this file never imports producer code.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Publication state of one settlement (SPECIALISTS-54).
 *
 * `published` is the only state that means the Journal result and the WorkReceipt both exist.
 * `pending` is a TRANSIENT failure: the settlement is durable, its publication is not, and a
 * later republish may still complete it. `refused` is a PERMANENT one: either the work boundary
 * carries no settlement surface at all (a pre-cutover runtime), or reconciliation found a
 * partially-completed publication that cannot be resumed without minting a second receipt.
 *
 * Before this field existed, a degraded publication was recorded only as an ABSENT
 * `journalEntryId`, so "never published" and "published but the link was lost" were the same
 * shape and nothing could enumerate the backlog.
 */
export type SettlementPublicationState = 'published' | 'pending' | 'refused';

/**
 * WHY a record is `refused`, because the two reasons have OPPOSITE lifetimes (SPECIALISTS-66).
 *
 * `runtime_lacks_settlement_surface` is a property of the RUNTIME, not of the record: the
 * boundary this host loaded carried no settlement surface. Runtimes get upgraded, and after an
 * upgrade the record is publishable again — so it is terminal only for as long as the condition
 * that produced it holds, and the republish pass re-tests that condition against the CURRENT
 * boundary rather than trusting the stored state.
 *
 * `receipt_unreconstructable` is a property of the RECORD: a Journal result exists whose refs
 * name a receipt that cannot be resolved or rebuilt. No runtime upgrade changes that, so it is
 * genuinely terminal.
 *
 * Absent on records written before this field existed; those read as terminal, which is the
 * conservative direction — a republish that never runs cannot mint a duplicate.
 */
export type SettlementRefusalReason = 'runtime_lacks_settlement_surface' | 'receipt_unreconstructable';

/** One terminal settlement of one attempt. Raw output included by design. */
export interface SettlementRecord {
  activationId: string;
  attemptId: string;
  specialist: string;
  issueRef: string;
  issueRevision: number;
  contractHash: string;
  executionBindingId: string;
  /** Terminal status of the attempt. Failed attempts are stored (queryable) but never published. */
  status: 'completed' | 'failed';
  /** Full raw output. Bounded publication keeps this OUT of the Journal body. */
  output: unknown;
  validation: { valid: boolean; errors?: string[] };
  /** Links filled in after publication; absent when unpublished or degraded. */
  receiptId?: string;
  journalEntryId?: string;
  artifactRef?: string;
  completedAt: number;
  /**
   * Publication state. Absent on records written before this field existed (SPECIALISTS-54) and
   * on FAILED settlements, which publish nothing by design — both read as "nothing to publish",
   * never as "published".
   */
  publication?: {
    state: SettlementPublicationState;
    /** Why the state is not `published`. Always set for `pending` and `refused`. */
    note?: string;
    /** For `refused` only: which of the two refusal lifetimes this is (SPECIALISTS-66). */
    refusal?: SettlementRefusalReason;
    /** How many publication attempts have run, so a stuck record is visible as a count. */
    attempts: number;
    updatedAt: number;
  };
}

/**
 * Runtime result storage port. `save` is an upsert on (activationId, attemptId):
 * the host stores the raw settlement first, then saves again with the
 * publication links once Journal/WorkReceipt publication resolves.
 */
export interface SettlementStore {
  save(record: SettlementRecord): string;
  get(activationId: string, attemptId: string): SettlementRecord | undefined;
  listAttempts(activationId: string): SettlementRecord[];
  /**
   * Every `completed` settlement whose publication is not in the `published` state — the
   * republish backlog (SPECIALISTS-54). Ordered by completion time so the oldest degrades
   * first, and includes records written before `publication` existed (state read as pending).
   *
   * Optional so an existing in-memory double keeps compiling; a store without it reports an
   * EMPTY backlog rather than a wrong one, and the host treats absence as "not enumerable".
   */
  listPendingPublication?(): SettlementRecord[];
  /**
   * Every record refused because the RUNTIME carried no settlement surface (SPECIALISTS-66).
   *
   * Separate from the pending backlog because these are republishable only against a boundary
   * that now HAS that surface. The caller re-tests the runtime condition; the store only
   * reports which records are waiting on it.
   */
  listRuntimeRefused?(): SettlementRecord[];
}

/** Filename-safe projection of an id. Colon-separated ids (`act:…`) stay readable. */
function safeSegment(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9.:_-]/g, '_');
  if (!safe || safe === '.' || safe === '..') throw new Error(`unusable settlement id: ${id}`);
  return safe;
}

/**
 * True when a record has a publication that is still owed (SPECIALISTS-54).
 *
 * A FAILED settlement is never owed one: it stays runtime-queryable by design and produces no
 * Journal result and no receipt. A record with no `publication` field predates the field, so
 * it is treated as owed — that is what makes the pre-cutover backlog visible instead of
 * silently exempt.
 */
export function isRuntimeRefused(record: SettlementRecord): boolean {
  return (
    publicationStateOf(record) === 'refused'
    && record.publication?.refusal === 'runtime_lacks_settlement_surface'
  );
}

export function isPendingPublication(record: SettlementRecord): boolean {
  // One source of truth. `republishPendingSettlements` asks this, and anything reporting the
  // outcome to an operator asks `publicationStateOf`; if the two were computed separately they
  // would eventually disagree about a record, and the backlog would say published while the report
  // said pending.
  return publicationStateOf(record) === 'pending';
}

/**
 * The publication state of a record — the query surface for "is this settlement's Journal result
 * and WorkReceipt published, still owed, or never going to be?".
 *
 * `not-applicable` is a FAILED settlement: it settles nothing to publish and stays queryable as
 * runtime evidence (ADR §38). An absent `publication` field reads as `pending`, which is what makes
 * the pre-cutover backlog visible instead of silently exempt.
 *
 * `refused` is PERMANENT by definition — no amount of retrying publishes a boundary that carries no
 * settlement surface, or completes a result whose receipt cannot be reconstructed. It stays
 * queryable here and is deliberately NOT part of the republish backlog, so a pass cannot become an
 * infinite retry against a runtime that cannot succeed. Re-attempting one after a runtime UPGRADE
 * needs an explicit decision, not a silent retry.
 */
export function publicationStateOf(record: SettlementRecord): SettlementPublicationState | 'not-applicable' {
  if (record.status !== 'completed') return 'not-applicable';
  // A record carrying BOTH links is published whatever the field says: the field can be lost by a
  // torn post-publication save, and the durable links are the stronger evidence.
  if (record.journalEntryId && record.receiptId) return 'published';
  return record.publication?.state === 'refused' ? 'refused' : 'pending';
}

/** File-backed runtime store. Directories are created lazily on first save. */
export function createFileSettlementStore(root: string): SettlementStore {
  const pathFor = (activationId: string, attemptId: string): string =>
    join(root, safeSegment(activationId), `${safeSegment(attemptId)}.json`);

  return {
    save(record: SettlementRecord): string {
      const path = pathFor(record.activationId, record.attemptId);
      mkdirSync(join(root, safeSegment(record.activationId)), { recursive: true });
      writeFileSync(path, JSON.stringify(record), 'utf8');
      return `${safeSegment(record.activationId)}/${safeSegment(record.attemptId)}.json`;
    },
    get(activationId: string, attemptId: string): SettlementRecord | undefined {
      try {
        return JSON.parse(readFileSync(pathFor(activationId, attemptId), 'utf8')) as SettlementRecord;
      } catch {
        return undefined;
      }
    },
    listAttempts(activationId: string): SettlementRecord[] {
      let files: string[];
      try {
        files = readdirSync(join(root, safeSegment(activationId)));
      } catch {
        return [];
      }
      const out: SettlementRecord[] = [];
      for (const file of files.filter((f) => f.endsWith('.json')).sort()) {
        try {
          out.push(JSON.parse(readFileSync(join(root, safeSegment(activationId), file), 'utf8')) as SettlementRecord);
        } catch {
          // A torn write is runtime evidence loss, not a query failure.
        }
      }
      return out;
    },
    listPendingPublication(): SettlementRecord[] {
      return readAll().filter(isPendingPublication).sort((a, b) => a.completedAt - b.completedAt);
    },
    listRuntimeRefused(): SettlementRecord[] {
      return readAll().filter(isRuntimeRefused).sort((a, b) => a.completedAt - b.completedAt);
    },
  };

  /**
   * Every record in the store, oldest first. A torn or unreadable record is skipped: runtime
   * evidence loss must not turn a backlog query into a failure.
   */
  function readAll(): SettlementRecord[] {
    let activations: string[];
    try {
      activations = readdirSync(root);
    } catch {
      return [];
    }
    const out: SettlementRecord[] = [];
    for (const activation of activations) {
      for (const record of readActivationDir(activation)) out.push(record);
    }
    return out;
  }

  function readActivationDir(activation: string): SettlementRecord[] {
    let files: string[];
    try {
      files = readdirSync(join(root, activation));
    } catch {
      return [];
    }
    const out: SettlementRecord[] = [];
    for (const file of files.filter((f) => f.endsWith('.json')).sort()) {
      try {
        out.push(JSON.parse(readFileSync(join(root, activation, file), 'utf8')) as SettlementRecord);
      } catch {
        // Skipped, as above.
      }
    }
    return out;
  }
}

/**
 * The in-memory store: the port with the backlog read REQUIRED, unlike the optional interface
 * member. A double that has it should not have to assert its own existence at every call.
 */
export interface InMemorySettlementStore extends SettlementStore {
  records: SettlementRecord[];
  listPendingPublication(): SettlementRecord[];
  listRuntimeRefused(): SettlementRecord[];
}

/** In-memory store. Test double — production wires the file store. */
export function createMemorySettlementStore(): InMemorySettlementStore {
  const records: SettlementRecord[] = [];
  return {
    records,
    save(record: SettlementRecord): string {
      const index = records.findIndex(
        (r) => r.activationId === record.activationId && r.attemptId === record.attemptId,
      );
      if (index >= 0) records[index] = record;
      else records.push(record);
      return `memory:${record.activationId}/${record.attemptId}`;
    },
    get(activationId: string, attemptId: string): SettlementRecord | undefined {
      return records.find((r) => r.activationId === activationId && r.attemptId === attemptId);
    },
    listAttempts(activationId: string): SettlementRecord[] {
      return records.filter((r) => r.activationId === activationId);
    },
    listPendingPublication(): SettlementRecord[] {
      return records.filter(isPendingPublication).sort((a, b) => a.completedAt - b.completedAt);
    },
    listRuntimeRefused(): SettlementRecord[] {
      return records.filter(isRuntimeRefused).sort((a, b) => a.completedAt - b.completedAt);
    },
  };
}
