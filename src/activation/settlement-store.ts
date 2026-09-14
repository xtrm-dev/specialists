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
}

/** Filename-safe projection of an id. Colon-separated ids (`act:…`) stay readable. */
function safeSegment(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9.:_-]/g, '_');
  if (!safe || safe === '.' || safe === '..') throw new Error(`unusable settlement id: ${id}`);
  return safe;
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
  };
}

/** In-memory store. Test double — production wires the file store. */
export function createMemorySettlementStore(): SettlementStore & { records: SettlementRecord[] } {
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
  };
}
