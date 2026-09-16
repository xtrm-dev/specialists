import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Exactly-once settlement publication ACROSS PROCESSES (SPECIALISTS-66).
 *
 * SPECIALISTS-54 made republish exactly-once by reconciliation — read the producer, and only a
 * proven absence licenses a write. Two sequences defeat that read, and neither is reachable from
 * a single-threaded double that never interleaves:
 *
 *   D1  two host processes in one cwd both drain the same file-backed backlog, both read absent,
 *       and both allocate and append.
 *   D2  `publishSettlement` stores the record before it allocates, and an absent `publication`
 *       field reads as `pending`, so the record sits in another process's backlog for the whole
 *       publication window.
 *
 * ## How a second process is simulated
 *
 * Not by forking. The exclusion is a file record with a liveness probe, and `acquire` admits a
 * second holder only by identity — so a RE-ENTRANT call from inside the publication window is
 * refused by exactly the same code path, for exactly the same reason, as a call from another
 * pid. The boundary doubles below re-enter at the precise instant the real race would land:
 * inside `allocateReceipt` (before the append) and inside `appendResult` (after it). That is the
 * interleaving, made deterministic, and it is what the fake-port tests could not reach.
 *
 * Every test asserts the two forbidden outcomes directly: more than one receipt for one
 * ExecutionBinding, or more than one Journal result for one (activation, attempt).
 *
 * ## THIS FILE ALONE PASSING IS NOT EVIDENCE — read it with activation-settlement-publication.ts
 *
 * Exactly-once coverage is SPLIT. This file pins the EXCLUSION: that a second publisher of one
 * (activation, attempt) is refused rather than admitted. The reconciliation invariants from
 * SPECIALISTS-54 stay in `activation-settlement-publication.test.ts`, and the sharpest of them
 * is that an UNANSWERABLE producer read defers instead of reading as "absent" — the tri-state
 * whose collapse licenses a duplicate write. Collapsing `unavailable` to `absent` leaves THIS
 * file green at 9/9 and fails there, which a reviewer auditing only this file will mistake for
 * an untested branch. Run both files before concluding anything about exactly-once.
 */

import {
  publishSettlement,
  republishSettlement,
  republishPendingSettlements,
  type SettlementSubject,
} from '../../../src/activation/settlement-publication.js';
import {
  createMemorySettlementStore,
  publicationStateOf,
  type InMemorySettlementStore,
  type SettlementRecord,
} from '../../../src/activation/settlement-store.js';
import {
  exclusionWorkspace,
  withSettlementExclusion,
} from '../../../src/activation/settlement-lease.js';
import { acquire, leasePath, type LeaseProcessProbe } from '../../../src/activation/workspace-lease.js';
import type {
  SettlementResultInput,
  SpecialistWorkItemBoundary,
  WorkReceiptView,
} from '../../../src/activation/workitem-store.js';

const ACTIVATION = 'act:exactly-once';
const ATTEMPT = 'att:exactly-once:1';
const BINDING = 'bind:exactly-once';
const ISSUE = 'SPECIALISTS-66';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'settlement-exclusion-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function subject(repositoryRoot: string): SettlementSubject {
  return {
    activationId: ACTIVATION,
    participantId: 'specialist::exactly-once',
    attemptId: ATTEMPT,
    specialist: 'executor',
    issueRef: ISSUE,
    issueRevision: 1,
    contractHash: 'hash',
    executionBindingId: BINDING,
    repositoryRoot,
    worktreePath: repositoryRoot,
  };
}

/**
 * A producer double that COUNTS rather than dedupes.
 *
 * Deliberately has no uniqueness constraint of its own: `allocateReceipt` mints a fresh id per
 * call and the journal has no dedupe key, which is exactly the real Substrate behaviour the
 * exclusion has to compensate for. A double that quietly deduped would pass these tests against
 * the broken code.
 */
function countingBoundary(): {
  boundary: SpecialistWorkItemBoundary;
  receipts: string[];
  entries: Array<{ activationId?: string; attemptId?: string }>;
  hooks: { onAllocate?: () => void; onAppend?: () => void };
} {
  const receipts: string[] = [];
  const entries: Array<{ activationId?: string; attemptId?: string }> = [];
  const hooks: { onAllocate?: () => void; onAppend?: () => void } = {};

  const boundary = {
    allocateReceipt(bindingId: string): WorkReceiptView {
      const id = `receipt:${receipts.length + 1}`;
      receipts.push(id);
      hooks.onAllocate?.();
      return { id, executionBindingId: bindingId, issueId: ISSUE, issueRevision: 1, contractHash: 'hash' };
    },
    appendResult(_ref: string, input: SettlementResultInput): { entryId: string; sequence: number } {
      entries.push({
        activationId: input.activationId,
        attemptId: input.executionContext?.specialist?.attemptId ?? undefined,
      });
      hooks.onAppend?.();
      return { entryId: `entry:${entries.length}`, sequence: entries.length };
    },
    findResultEntry(_ref: string, key: { activationId: string; attemptId: string }) {
      const index = entries.findIndex(
        (e) => e.activationId === key.activationId && e.attemptId === key.attemptId,
      );
      return index >= 0
        ? ({ status: 'found', value: { entryId: `entry:${index + 1}` } } as const)
        : ({ status: 'absent' } as const);
    },
    findReceiptForBinding(_ref: string, bindingId: string) {
      return bindingId === BINDING && receipts.length > 0
        ? ({ status: 'found', value: { receiptId: receipts[0] as string } } as const)
        : ({ status: 'absent' } as const);
    },
  } as unknown as SpecialistWorkItemBoundary;

  return { boundary, receipts, entries, hooks };
}

function pendingRecord(): SettlementRecord {
  return {
    activationId: ACTIVATION,
    attemptId: ATTEMPT,
    specialist: 'executor',
    issueRef: ISSUE,
    issueRevision: 1,
    contractHash: 'hash',
    executionBindingId: BINDING,
    status: 'completed',
    output: 'done',
    validation: { valid: true },
    completedAt: 1,
  };
}

describe('settlement publication is exactly-once across processes (SPECIALISTS-66)', () => {
  it('D2: a republish pass landing inside the publication window publishes nothing twice', () => {
    const root = tempRoot();
    const store = createMemorySettlementStore();
    const { boundary, receipts, entries, hooks } = countingBoundary();
    let reentrant: { outcome: string } | undefined;

    // The D2 window precisely: the record is already stored (so it is in the backlog) and the
    // append has NOT happened yet, so reconciliation would read absent and license a write.
    hooks.onAllocate = () => {
      reentrant = republishSettlement({
        boundary,
        store,
        record: store.get(ACTIVATION, ATTEMPT) ?? pendingRecord(),
        participantId: 'specialist::republisher',
        repositoryRoot: root,
      });
    };

    const result = publishSettlement({
      boundary,
      store,
      subject: subject(root),
      status: 'completed',
      output: 'done',
      validation: { valid: true },
    });

    expect(receipts).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(result.publicationState).toBe('published');
    // The re-entrant pass must have been refused by the exclusion, not admitted and deduped.
    expect(reentrant?.outcome).toBe('pending');
  });

  it('D1: two republish passes over one record yield one receipt and one Journal result', () => {
    const root = tempRoot();
    const store = createMemorySettlementStore();
    const { boundary, receipts, entries, hooks } = countingBoundary();
    store.save(pendingRecord());
    let second: { outcome: string } | undefined;

    // A second process drains the same backlog while the first is mid-publication.
    hooks.onAllocate = () => {
      second = republishSettlement({
        boundary,
        store,
        record: pendingRecord(),
        participantId: 'specialist::republisher-b',
        repositoryRoot: root,
      });
    };

    const first = republishSettlement({
      boundary,
      store,
      record: pendingRecord(),
      participantId: 'specialist::republisher-a',
      repositoryRoot: root,
    });

    expect(first.outcome).toBe('published');
    expect(second?.outcome).toBe('pending');
    expect(receipts).toHaveLength(1);
    expect(entries).toHaveLength(1);
  });

  it('contention never alters the activation result: the settlement is still stored', () => {
    const root = tempRoot();
    const store = createMemorySettlementStore();
    const { boundary, hooks } = countingBoundary();
    // Hold the exclusion for the whole publication by re-entering and never releasing is not
    // possible; instead contend at the only place that matters — a concurrent publish of the
    // same (activation, attempt) while the first holds it.
    let contended: ReturnType<typeof publishSettlement> | undefined;
    hooks.onAllocate = () => {
      contended = publishSettlement({
        boundary,
        store,
        subject: subject(root),
        status: 'completed',
        output: 'done',
        validation: { valid: true },
      });
    };

    const winner = publishSettlement({
      boundary,
      store,
      subject: subject(root),
      status: 'completed',
      output: 'done',
      validation: { valid: true },
    });

    expect(winner.publicationState).toBe('published');
    expect(contended?.publicationState).toBe('pending');
    // Best-effort by contract (ADR §38): the loser degraded, it did not fail or throw, and the
    // raw settlement is durable either way.
    expect(contended?.storedRef).toBeTruthy();
    expect(contended?.degraded).toContain('held elsewhere');
  });

  it('the exclusion is per (activation, attempt), not per worktree', () => {
    const root = tempRoot();
    const store = createMemorySettlementStore();
    const { boundary, receipts, hooks } = countingBoundary();
    let other: ReturnType<typeof publishSettlement> | undefined;

    // A DIFFERENT activation in the same repository root must not be blocked by this one. A
    // workspace-keyed exclusion would refuse it — that is the coupling the synthetic key avoids,
    // and a read-only activation takes no workspace lease yet still publishes.
    hooks.onAllocate = () => {
      if (other) return;
      other = publishSettlement({
        boundary,
        store,
        subject: { ...subject(root), activationId: 'act:unrelated', attemptId: 'att:unrelated:1' },
        status: 'completed',
        output: 'other',
        validation: { valid: true },
      });
    };

    publishSettlement({
      boundary,
      store,
      subject: subject(root),
      status: 'completed',
      output: 'done',
      validation: { valid: true },
    });

    expect(other?.publicationState).toBe('published');
    expect(receipts).toHaveLength(2);
  });
});

describe('the two refusal lifetimes are distinct (SPECIALISTS-66 R5)', () => {
  const surfaceless = {} as unknown as SpecialistWorkItemBoundary;

  function refusedByRuntime(root: string): InMemorySettlementStore {
    const store = createMemorySettlementStore();
    publishSettlement({
      boundary: surfaceless,
      store,
      subject: subject(root),
      status: 'completed',
      output: 'done',
      validation: { valid: true },
    });
    return store;
  }

  it('a runtime-scoped refusal is republished once a capable runtime runs the pass', () => {
    const root = tempRoot();
    const store = refusedByRuntime(root);
    const stored = store.get(ACTIVATION, ATTEMPT);
    expect(publicationStateOf(stored as SettlementRecord)).toBe('refused');
    expect(stored?.publication?.refusal).toBe('runtime_lacks_settlement_surface');
    // The record is NOT in the pending backlog; it is waiting on the runtime condition.
    expect(store.listPendingPublication()).toHaveLength(0);
    expect(store.listRuntimeRefused()).toHaveLength(1);

    const { boundary, receipts, entries } = countingBoundary();
    const outcomes = republishPendingSettlements({
      boundary,
      store,
      participantId: 'specialist::republisher',
      repositoryRoot: root,
    });

    expect(outcomes.map((o) => o.outcome)).toEqual(['published']);
    expect(receipts).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(publicationStateOf(store.get(ACTIVATION, ATTEMPT) as SettlementRecord)).toBe('published');
  });

  it('a runtime-scoped refusal stays refused while the runtime is still incapable', () => {
    const root = tempRoot();
    const store = refusedByRuntime(root);
    const outcomes = republishPendingSettlements({
      boundary: surfaceless,
      store,
      participantId: 'specialist::republisher',
      repositoryRoot: root,
    });
    expect(outcomes).toHaveLength(0);
    expect(store.listRuntimeRefused()).toHaveLength(1);
  });

  it('an unreconstructable receipt is terminal and no upgrade revives it', () => {
    const root = tempRoot();
    const store = createMemorySettlementStore();
    store.save(pendingRecord());
    // A Journal result exists whose receipt cannot be resolved: the provenance chain cannot be
    // completed, and that is a property of the RECORD, not of the runtime.
    const boundary = {
      allocateReceipt: () => ({
        id: 'unused', executionBindingId: BINDING, issueId: ISSUE, issueRevision: 1, contractHash: 'hash',
      }),
      appendResult: () => ({ entryId: 'unused', sequence: 1 }),
      findResultEntry: () => ({ status: 'found', value: { entryId: 'entry:orphan' } }) as const,
      findReceiptForBinding: () => ({ status: 'absent' }) as const,
    } as unknown as SpecialistWorkItemBoundary;

    const outcome = republishSettlement({
      boundary,
      store,
      record: pendingRecord(),
      participantId: 'specialist::republisher',
      repositoryRoot: root,
    });

    expect(outcome.outcome).toBe('refused');
    expect(store.get(ACTIVATION, ATTEMPT)?.publication?.refusal).toBe('receipt_unreconstructable');
    // Never revived: it is absent from BOTH backlogs, so no later pass can retry it.
    expect(store.listRuntimeRefused()).toHaveLength(0);
    expect(store.listPendingPublication()).toHaveLength(0);
  });
});

describe('reclaiming a dead holder is itself exclusive (SPECIALISTS-66 review)', () => {
  const DEAD_PID = 999_001;

  /** Reports one pid as gone and every other as live, so `uncertain` is reachable without killing anything. */
  const probe: LeaseProcessProbe = {
    startTicks: (pid: number) => (pid === DEAD_PID ? undefined : 4242),
    canVerify: () => true,
  };

  function writeStaleLease(root: string): string {
    const workspace = exclusionWorkspace({
      repositoryRoot: root, activationId: ACTIVATION, attemptId: ATTEMPT,
    });
    const path = leasePath(workspace);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({
      workspaceKey: 'stale',
      worktreePath: workspace.worktreePath,
      activationId: 'settlement-publication:dead',
      attemptId: ATTEMPT,
      holder: { pid: DEAD_PID, startTicks: 1 },
      acquiredAtMs: 1,
    }), 'utf8');
    return path;
  }

  it('a holder whose process is provably gone is reclaimed and publication proceeds', () => {
    const root = tempRoot();
    writeStaleLease(root);
    let ran = false;
    const outcome = withSettlementExclusion(
      { repositoryRoot: root, activationId: ACTIVATION, attemptId: ATTEMPT },
      () => { ran = true; return 'published'; },
      { reclaimStale: true, probe },
    );
    expect(outcome.ok).toBe(true);
    expect(ran).toBe(true);
  });

  it('a second reclaimer cannot enter the read-then-destroy section, so it destroys nothing', () => {
    const root = tempRoot();
    const stalePath = writeStaleLease(root);
    const workspace = exclusionWorkspace({
      repositoryRoot: root, activationId: ACTIVATION, attemptId: ATTEMPT,
    });

    // Another reclaimer is inside the section. Under an UNGUARDED reclaim this caller would
    // inspect the same stale record, unlink it, and acquire — which is how two reclaimers end
    // up publishing the same settlement.
    acquire(
      {
        workspace: { ...workspace, worktreePath: `settlement-reclaim:${ACTIVATION}:${ATTEMPT}` },
        activationId: 'settlement-reclaim:other',
        attemptId: ATTEMPT,
      },
      probe,
    );

    let ran = false;
    const outcome = withSettlementExclusion(
      { repositoryRoot: root, activationId: ACTIVATION, attemptId: ATTEMPT },
      () => { ran = true; return 'published'; },
      { reclaimStale: true, probe },
    );

    expect(outcome.ok).toBe(false);
    expect(ran).toBe(false);
    // The record it would have deleted is untouched: the other reclaimer still owns the decision.
    expect(existsSync(stalePath)).toBe(true);
  });
});
