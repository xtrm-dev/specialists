// src/activation/settlement-publication.ts
//
// Automatic, bounded settlement publication (S1, XTRM-252.8 / ADR §§37–40,
// implements §94).
//
// When a Specialist settles meaningfully the HOST publishes — the Specialist
// is never asked to remember anything (ADR §38):
//   settlement → runtime result storage + WorkReceipt/provenance + Journal result
//
// Bounds (ADR §39): the Journal body carries the closed result field set
// (summary, outcome, completed, validation, findings, artifact refs,
// provenance refs) with the same per-field limits Substrate enforces
// (4000/100/1000). Arbitrary raw model output stays in runtime storage and is
// referenced, never dumped.
//
// Identity (ADR §37, X1): publication consumes the shared versioned
// ExecutionContext envelope shape — actor, participant, host, coordinator,
// specialist, workspace — mirrored structurally here and validated
// authoritatively by Substrate on write. Nothing here invents a parallel
// identity model: unknown stays absent (§98), and Project naming is never
// derived on this side of the boundary (ADR §20).
//
// This module has NO static dependency on @jaggerxtrm/substrate (same
// structural-decoupling discipline as workitem-store.ts): it programs against
// the injected boundary's optional settlement methods, and the real Substrate
// services validate every field fail-closed on write.

import type { SpecialistWorkItemBoundary } from './workitem-store.js';
import type { SettlementRecord, SettlementRefusalReason, SettlementStore } from './settlement-store.js';
import { withSettlementExclusion } from './settlement-lease.js';
/** Envelope version consumed. Mirrors EXECUTION_CONTEXT_VERSION (substrate@a77d094). */
export const SETTLEMENT_CONTEXT_VERSION = 1;

/** Journal result version stamped. Mirrors RESULT_VERSION (substrate@a77d094). */
export const SETTLEMENT_RESULT_VERSION = 1;

/** Bounded-publication limits. Mirror the Substrate ResultPayload bounds. */
export const SUMMARY_MAX = 4000;
export const RESULT_ARRAY_MAX = 100;
export const RESULT_ITEM_MAX = 1000;

/** Closed Journal result field set. Mirrors RESULT_FIELDS (substrate@a77d094). */
export interface BoundedResult {
  summary: string;
  resultVersion?: number;
  attempted?: string;
  outcome?: string;
  completed?: string[];
  validation?: string[];
  findings?: string[];
  artifactRefs?: string[];
  receiptRefs?: string[];
  provenanceRefs?: string[];
}

/** Structural mirror of the shared ExecutionContext envelope (X1, v1). */
export interface SettlementExecutionContext {
  version?: number;
  actor?: { type: string; id?: string; name?: string };
  participantId?: string;
  xtrmSessionId?: string;
  xtrmSessionName?: string;
  host?: { type: string; sessionId?: string };
  runId?: string;
  chainRunId?: string;
  coordinator?: { participantId?: string; sessionId?: string };
  specialist?: { name?: string; activationId?: string; attemptId?: string; agentSessionId?: string };
  workspace?: {
    repositoryKey?: string;
    repoPath?: string;
    worktree?: string;
    branch?: string;
    baseCommit?: string;
    headCommit?: string;
  };
  timestamp?: number;
}

function cleanStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function trunc(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Raw settlement output as text. Never throws; never truncated here. */
export function outputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === undefined || output === null) return '';
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

/**
 * Build the bounded Journal result payload (§39). The summary is a bounded
 * excerpt of the raw output — the full text stays in runtime storage and only
 * its artifact ref lands here, so oversized output can never reach the
 * Journal body.
 */
export function buildBoundedResult(opts: {
  output: unknown;
  valid: boolean;
  errors?: string[];
  artifactRefs: string[];
  receiptRefs: string[];
  provenanceRefs: string[];
}): BoundedResult {
  const raw = outputText(opts.output);
  const summary = raw.trim() !== ''
    ? trunc(raw, SUMMARY_MAX)
    : '(specialist settled without output; see validation)';
  const out: BoundedResult = {
    summary,
    resultVersion: SETTLEMENT_RESULT_VERSION,
  };
  if (opts.valid) {
    out.outcome = 'completed';
  } else {
    const errors = (opts.errors ?? ['validation failed']).filter((e) => e.trim() !== '');
    out.outcome = trunc(`completed_with_validation_errors: ${errors.join('; ')}`, SUMMARY_MAX);
    out.validation = errors.slice(0, RESULT_ARRAY_MAX).map((e) => trunc(e, RESULT_ITEM_MAX));
  }
  const bounded = (refs: string[]): string[] | undefined =>
    refs.length > 0 ? refs.slice(0, RESULT_ARRAY_MAX).map((r) => trunc(r, RESULT_ITEM_MAX)) : undefined;
  const artifactRefs = bounded(opts.artifactRefs);
  const receiptRefs = bounded(opts.receiptRefs);
  const provenanceRefs = bounded(opts.provenanceRefs);
  if (artifactRefs) out.artifactRefs = artifactRefs;
  if (receiptRefs) out.receiptRefs = receiptRefs;
  if (provenanceRefs) out.provenanceRefs = provenanceRefs;
  return out;
}

/**
 * Build the X1 settlement envelope (§37). Every leg is host-observed: the
 * participant/activation/attempt/session from the live snapshot and binding,
 * the coordinator pair from the dispatch request, the workspace from the
 * resolved workspace identity plus the binding's base commit, the XTRM
 * session from the exact R4 env contract only. Unknown stays absent.
 */
export function buildSettlementExecutionContext(opts: {
  participantId: string;
  specialistName: string;
  activationId: string;
  attemptId: string;
  agentSessionId?: string;
  coordinatorParticipantId?: string;
  coordinatorSessionId?: string;
  repoPath?: string;
  worktree?: string;
  branch?: string;
  baseCommit?: string;
  env?: Record<string, string | undefined>;
  now?: number;
}): SettlementExecutionContext {
  const coordinatorParticipantId = cleanStr(opts.coordinatorParticipantId);
  const participantId = cleanStr(opts.participantId);
  // The coordinator leg names the PARENT dispatcher: when the dispatcher IS
  // this specialist participant there is no parent leg to preserve (same rule
  // the dispatch gate applies when it builds the child envelope).
  const coordinatorLeg =
    coordinatorParticipantId !== undefined && coordinatorParticipantId !== participantId
      ? {
          participantId: coordinatorParticipantId,
          ...(cleanStr(opts.coordinatorSessionId) !== undefined
            ? { sessionId: cleanStr(opts.coordinatorSessionId) as string }
            : {}),
        }
      : cleanStr(opts.coordinatorSessionId) !== undefined
        ? { sessionId: cleanStr(opts.coordinatorSessionId) as string }
        : undefined;
  const env = opts.env ?? {};
  const ctx: SettlementExecutionContext = { version: SETTLEMENT_CONTEXT_VERSION };
  ctx.actor = { type: 'specialist' };
  if (participantId !== undefined) ctx.participantId = participantId;
  const agentSessionId = cleanStr(opts.agentSessionId);
  // Host leg is host-known: the child runs on a Pi AgentSession, the same
  // trusted `pi` label the Substrate Pi adapter stamps. Never a display label.
  if (agentSessionId !== undefined) ctx.host = { type: 'pi', sessionId: agentSessionId };
  const xtrmSessionId = cleanStr(env['XTRM_SESSION_ID']);
  const xtrmSessionName = cleanStr(env['XTRM_SESSION_NAME']);
  if (xtrmSessionId !== undefined) ctx.xtrmSessionId = xtrmSessionId;
  if (xtrmSessionName !== undefined) ctx.xtrmSessionName = xtrmSessionName;
  if (coordinatorLeg !== undefined) ctx.coordinator = coordinatorLeg;
  const specialist: NonNullable<SettlementExecutionContext['specialist']> = {};
  const name = cleanStr(opts.specialistName);
  const activationId = cleanStr(opts.activationId);
  const attemptId = cleanStr(opts.attemptId);
  if (name !== undefined) specialist.name = name;
  if (activationId !== undefined) specialist.activationId = activationId;
  if (attemptId !== undefined) specialist.attemptId = attemptId;
  if (agentSessionId !== undefined) specialist.agentSessionId = agentSessionId;
  if (Object.keys(specialist).length > 0) ctx.specialist = specialist;
  const workspace: NonNullable<SettlementExecutionContext['workspace']> = {};
  const repoPath = cleanStr(opts.repoPath);
  const worktree = cleanStr(opts.worktree);
  const branch = cleanStr(opts.branch);
  const baseCommit = cleanStr(opts.baseCommit);
  if (repoPath !== undefined) workspace.repoPath = repoPath;
  if (worktree !== undefined) workspace.worktree = worktree;
  if (branch !== undefined) workspace.branch = branch;
  if (baseCommit !== undefined) workspace.baseCommit = baseCommit;
  if (Object.keys(workspace).length > 0) ctx.workspace = workspace;
  ctx.timestamp = opts.now ?? Date.now();
  return ctx;
}

export interface SettlementSubject {
  activationId: string;
  participantId: string;
  attemptId: string;
  specialist: string;
  issueRef: string;
  issueRevision: number;
  contractHash: string;
  executionBindingId: string;
  piSessionId?: string;
  repositoryRoot: string;
  worktreePath: string;
  branch?: string;
  /** Base commit pinned on the ExecutionBinding row, when the producer exposes it. */
  bindingBaseCommit?: string;
}

/**
 * Republish ONE stored settlement whose publication degraded (SPECIALISTS-54).
 *
 * Exactly-once, and the reason it can be exactly-once is RECONCILIATION: the receipt already
 * allocated over the binding is REUSED, never re-minted. Substrate's `allocateReceipt` mints a
 * fresh id per call and `issue_journal` has no dedupe key, so a blind re-run of the whole
 * publication would mint a second receipt — the constraint the issue forbids.
 *
 * Resolution order, per leg:
 *   receipt  — the recorded one, else the producer's (one receipt per binding), else allocate ONE.
 *   result   — the recorded one, else the producer's for (activation, attempt), else append ONE.
 *
 * The only case that defers rather than publishes is a receipt this host cannot determine at all:
 * no recorded link AND no reconciliation read. Guessing there would risk the duplicate, so the
 * record stays `pending` with that exact reason — which is the honest outcome for a producer that
 * cannot answer "did this already land?".
 */
export function republishSettlement(opts: {
  boundary: SpecialistWorkItemBoundary;
  store: SettlementStore;
  record: SettlementRecord;
  participantId: string;
  repositoryRoot: string;
  worktreePath?: string;
  coordinator?: { participantId?: string; sessionId?: string };
  env?: Record<string, string | undefined>;
  now?: number;
  emit?: (name: string, payload?: Record<string, unknown>) => void;
}): { outcome: 'published' | 'pending' | 'refused'; journalEntryId?: string; receiptId?: string; note?: string } {
  const { boundary, store, record } = opts;
  const now = opts.now ?? Date.now();
  const emit = opts.emit ?? ((): void => {});

  if (record.status !== 'completed') {
    return { outcome: 'refused', note: 'a failed settlement publishes nothing' };
  }
  if (record.receiptId && record.journalEntryId) {
    return { outcome: 'published', journalEntryId: record.journalEntryId, receiptId: record.receiptId };
  }
  if (!boundary.appendResult || !boundary.allocateReceipt) {
    const note = 'work boundary carries no settlement surface; not republishable by THIS runtime';
    saveState(store, record, 'refused', note, {}, 'runtime_lacks_settlement_surface');
    emit('settlement_republish_refused', { activationId: record.activationId, attemptId: record.attemptId, note });
    return { outcome: 'refused', note };
  }

  // Captured after the guard above: the narrowing does not survive into the closure below,
  // and re-testing inside it would be a second, weaker check of something already proven.
  const allocateReceipt = boundary.allocateReceipt;
  const appendResult = boundary.appendResult;

  // --- reconciliation: "did this already land?" ------------------------------------------
  // Both legs are read BEFORE anything is written, and an unanswerable read defers the whole
  // republish. A `undefined`/falsy answer here would be indistinguishable from "absent", and
  // "absent" licenses allocating a receipt — which is the second receipt the issue forbids.
  const defer = (reason: string): { outcome: 'pending'; note: string } => {
    saveState(store, record, 'pending', reason);
    emit('settlement_republish_deferred', {
      activationId: record.activationId, attemptId: record.attemptId, note: reason,
    });
    return { outcome: 'pending', note: reason };
  };

  // Reconciliation and the write it licenses run TOGETHER under the settlement exclusion
  // (SPECIALISTS-66). Reading first and writing after is only exactly-once when no other
  // process can be mid-publication between the two: 'did this already land?' is TOCTOU
  // against a live writer, so the reads belong INSIDE the exclusion, not before it.
  const reconcileAndPublish = (): { outcome: 'published' | 'pending' | 'refused'; journalEntryId?: string; receiptId?: string; note?: string } => {
    let journalEntryId = record.journalEntryId;
    if (!journalEntryId) {
      if (!boundary.findResultEntry) {
        return defer('work boundary exposes no Journal reconciliation, so a republish cannot prove it is the first');
      }
      const lookup = boundary.findResultEntry(record.issueRef, {
        activationId: record.activationId,
        attemptId: record.attemptId,
      });
      if (lookup.status === 'unavailable') {
        return defer(`Journal reconciliation unavailable: ${lookup.reason}`);
      }
      if (lookup.status === 'found') journalEntryId = lookup.value.entryId;
    }

    let receiptId = record.receiptId;
    if (!receiptId) {
      if (!boundary.findReceiptForBinding) {
        return defer('work boundary exposes no receipt reconciliation, so a republish cannot prove it is the first');
      }
      const lookup = boundary.findReceiptForBinding(record.issueRef, record.executionBindingId);
      if (lookup.status === 'unavailable') {
        return defer(`receipt reconciliation unavailable: ${lookup.reason}`);
      }
      if (lookup.status === 'found') receiptId = lookup.value.receiptId;
    }

    if (journalEntryId) {
      // The append landed. Adopt it — but `published` means the Journal result AND the receipt
      // exist, so a missing receipt is NOT publishable here: the entry's own refs name a receipt
      // that cannot be reconstructed, and inventing one would break the provenance chain rather
      // than complete it. Refused, loudly, with the reason.
      if (!receiptId) {
        const note =
          `Journal result ${journalEntryId} exists but no WorkReceipt is recorded for binding `
          + `${record.executionBindingId} and none is resolvable; the provenance chain cannot be completed`;
        saveState(store, record, 'refused', note, { journalEntryId }, 'receipt_unreconstructable');
        emit('settlement_republish_refused', { activationId: record.activationId, attemptId: record.attemptId, note });
        return { outcome: 'refused', note, journalEntryId };
      }
      saveState(store, record, 'published', 'reconciled with the existing Journal result', {
        journalEntryId,
        receiptId,
      });
      emit('settlement_republish_reconciled', {
        activationId: record.activationId, attemptId: record.attemptId, entry: journalEntryId,
      });
      return { outcome: 'published', journalEntryId, receiptId };
    }

    try {
      const storedRef = store.save(record);
      if (!receiptId) {
        const receipt = allocateReceipt(record.executionBindingId);
        receiptId = receipt.id;
        emit('settlement_receipt_allocated', { receipt: receipt.id, republish: true });
      }
      let artifactValue = record.artifactRef ?? storedRef;
      if (boundary.attachArtifact && !record.artifactRef) {
        try {
          artifactValue = boundary.attachArtifact(receiptId, 'artifact', storedRef).value;
          emit('settlement_artifact_attached', { receipt: receiptId, kind: 'artifact', republish: true });
        } catch (error) {
          emit('settlement_degraded', {
            note: `artifact attach failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
      const entry = appendResult(record.issueRef, {
        result: buildBoundedResult({
          output: record.output,
          valid: record.validation.valid,
          errors: record.validation.errors,
          artifactRefs: [artifactValue],
          receiptRefs: [receiptId],
          provenanceRefs: [record.executionBindingId, receiptId],
        }),
        executionContext: buildSettlementExecutionContext({
          participantId: opts.participantId,
          specialistName: record.specialist,
          activationId: record.activationId,
          attemptId: record.attemptId,
          coordinatorParticipantId: opts.coordinator?.participantId,
          coordinatorSessionId: opts.coordinator?.sessionId,
          repoPath: opts.repositoryRoot,
          worktree: opts.worktreePath ?? opts.repositoryRoot,
          env: opts.env,
          now,
        }),
        refs: [
          { kind: 'artifact', key: artifactValue },
          { kind: 'receipt', key: receiptId },
        ],
        participantId: opts.participantId,
        activationId: record.activationId,
      });
      store.save({
        ...record,
        receiptId,
        journalEntryId: entry.entryId,
        artifactRef: artifactValue,
        publication: { state: 'published', attempts: (record.publication?.attempts ?? 0) + 1, updatedAt: now },
      });
      emit('settlement_result_published', { entry: entry.entryId, receipt: receiptId, republish: true });
      return { outcome: 'published', journalEntryId: entry.entryId, receiptId };
    } catch (error) {
      const note = error instanceof Error ? error.message : String(error);
      // Still transient: the receipt is now recorded, so the next pass resumes without re-minting.
      saveState(store, record, 'pending', note, { ...(receiptId ? { receiptId } : {}) });
      emit('settlement_degraded', { note, republish: true });
      return { outcome: 'pending', note, ...(receiptId ? { receiptId } : {}) };
    }
  };

  // `reclaimStale` here and nowhere else: the republish pass is the one caller that must be
  // able to make progress after a holder died mid-publication, and a holder the probe reports
  // as GONE is a proven absence — with no live writer the reconciliation reads are
  // authoritative again. Every other uncertain reason is left for recovery to decide.
  const guarded = withSettlementExclusion(
    { repositoryRoot: opts.repositoryRoot, activationId: record.activationId, attemptId: record.attemptId },
    reconcileAndPublish,
    { reclaimStale: true },
  );
  return guarded.ok ? guarded.value : defer(guarded.reason);
}

/**
 * Republish the whole pending settlement backlog, oldest first.
 *
 * One record's failure never stops the pass: a permanently-unpublishable record must not keep
 * every later one stuck behind it. Returns the per-record outcomes so the caller can log them.
 */
/** Records one pass will attempt. Bounds the work the FIRST DISPATCH of a process pays. */
export const REPUBLISH_PASS_LIMIT = 50;

export function republishPendingSettlements(opts: {
  boundary: SpecialistWorkItemBoundary;
  store: SettlementStore;
  participantId: string;
  repositoryRoot: string;
  worktreePath?: string;
  env?: Record<string, string | undefined>;
  now?: () => number;
  emit?: (name: string, payload?: Record<string, unknown>) => void;
  /** Records this pass may attempt. Defaults to REPUBLISH_PASS_LIMIT. */
  limit?: number;
}): Array<{ activationId: string; attemptId: string; outcome: 'published' | 'pending' | 'refused' | 'error' }> {
  const emit = opts.emit ?? ((): void => {});
  // The backlog is unbounded by construction (a record can stay pending forever), and this pass
  // runs before the first dispatch of every process. Capped so a large or wedged backlog costs a
  // bounded amount per process and the activation is not held behind it. Oldest first, so a cap
  // still drains in completion order.
  const limit = Math.max(1, opts.limit ?? REPUBLISH_PASS_LIMIT);
  // Records refused because the RUNTIME carried no settlement surface rejoin the backlog once a
  // runtime that HAS one runs the pass (SPECIALISTS-66 R5). That condition is a property of the
  // boundary in front of us, so it is re-tested here rather than read off the stored state — the
  // upgrade that fixes it happens between processes, where no stored verdict could have seen it.
  // `receipt_unreconstructable` is never revisited: no upgrade reconstructs a lost receipt.
  const revivable = (opts.boundary.appendResult && opts.boundary.allocateReceipt)
    ? (opts.store.listRuntimeRefused?.() ?? [])
    : [];
  const pending = [...(opts.store.listPendingPublication?.() ?? []), ...revivable]
    .sort((a, b) => a.completedAt - b.completedAt)
    .slice(0, limit);
  const outcomes: Array<{ activationId: string; attemptId: string; outcome: 'published' | 'pending' | 'refused' | 'error' }> = [];
  for (const record of pending) {
    try {
      const result = republishSettlement({
        boundary: opts.boundary,
        store: opts.store,
        record,
        participantId: opts.participantId,
        repositoryRoot: opts.repositoryRoot,
        ...(opts.worktreePath ? { worktreePath: opts.worktreePath } : {}),
        ...(opts.env ? { env: opts.env } : {}),
        ...(opts.now ? { now: opts.now() } : {}),
        emit,
      });
      outcomes.push({ activationId: record.activationId, attemptId: record.attemptId, outcome: result.outcome });
    } catch (error) {
      outcomes.push({ activationId: record.activationId, attemptId: record.attemptId, outcome: 'error' });
      emit('settlement_republish_error', {
        activationId: record.activationId,
        attemptId: record.attemptId,
        note: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcomes;
}

export interface PublishSettlementResult {
  /** Runtime storage ref. Always present: even a degraded publication stores. */
  storedRef: string;
  receiptId?: string;
  artifactValue?: string;
  journalEntryId?: string;
  degraded?: string;
  /**
   * Durable publication state written with the record (SPECIALISTS-54). `pending` means the
   * settlement is republishable; `refused` means it never will be, and why.
   */
  publicationState?: 'published' | 'pending' | 'refused' | 'not-applicable';
}

/**
 * Publish one terminal settlement. Automatic and host-driven: the Specialist
 * is involved in no step.
 *
 * Always stores the full settlement (including failures, so every attempt is
 * queryable). Journal `result` + WorkReceipt publication runs only for
 * `completed` settlements — a provider failure is runtime evidence, not a
 * work result — and requires no Git commit (ADR §40): the zero-commit path
 * publishes exactly like the code path, with no commit artifact attached.
 *
 * Never throws: every step degrades to a forensic-grade `degraded` reason and
 * the activation result is returned unchanged.
 */
export function publishSettlement(opts: {
  boundary: SpecialistWorkItemBoundary;
  store: SettlementStore;
  subject: SettlementSubject;
  status: 'completed' | 'failed';
  output: unknown;
  validation: { valid: boolean; errors?: string[] };
  coordinator?: { participantId?: string; sessionId?: string };
  env?: Record<string, string | undefined>;
  now?: number;
  emit?: (name: string, payload?: Record<string, unknown>) => void;
}): PublishSettlementResult {
  const { boundary, store, subject } = opts;
  const now = opts.now ?? Date.now();
  const emit = opts.emit ?? ((): void => {});

  const executionContext = buildSettlementExecutionContext({
    participantId: subject.participantId,
    specialistName: subject.specialist,
    activationId: subject.activationId,
    attemptId: subject.attemptId,
    agentSessionId: subject.piSessionId,
    coordinatorParticipantId: opts.coordinator?.participantId,
    coordinatorSessionId: opts.coordinator?.sessionId,
    repoPath: subject.repositoryRoot,
    worktree: subject.worktreePath,
    branch: subject.branch,
    baseCommit: subject.bindingBaseCommit,
    env: opts.env,
    now,
  });

  const record: SettlementRecord = {
    activationId: subject.activationId,
    attemptId: subject.attemptId,
    specialist: subject.specialist,
    issueRef: subject.issueRef,
    issueRevision: subject.issueRevision,
    contractHash: subject.contractHash,
    executionBindingId: subject.executionBindingId,
    status: opts.status,
    output: opts.output,
    validation: opts.validation,
    completedAt: now,
  };
  let storedRef: string;
  try {
    storedRef = store.save(record);
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    emit('settlement_store_failed', { note });
    return { storedRef: '', degraded: `result storage unavailable: ${note}` };
  }
  emit('settlement_stored', { ref: storedRef, status: opts.status });

  // A failed turn settled nothing to publish: it stays runtime-queryable (store + forensics)
  // but produces no Journal result and no receipt.
  if (opts.status !== 'completed') return { storedRef, publicationState: 'not-applicable' };

  if (!boundary.allocateReceipt || !boundary.appendResult) {
    // PERMANENT, not transient: this runtime carries no settlement surface at all, so no amount
    // of retrying will publish it. Recorded as `refused` with the reason so the backlog is
    // honest about what it is (SPECIALISTS-54).
    const note = 'work boundary carries no settlement surface; result stored only';
    // Scoped to the RUNTIME, not the record: an upgraded boundary republishes this
    // (SPECIALISTS-66 R5). The republish pass re-tests the condition rather than trusting it.
    saveState(store, record, 'refused', note, {}, 'runtime_lacks_settlement_surface');
    emit('settlement_degraded', { note });
    return { storedRef, degraded: 'boundary without settlement surface', publicationState: 'refused' };
  }

  // Captured after the guard above: the narrowing does not survive into the closure below,
  // and re-testing inside it would be a second, weaker check of something already proven.
  const allocateReceipt = boundary.allocateReceipt;
  const appendResult = boundary.appendResult;

  // Progress is tracked step by step so a failure can record HOW FAR publication got. Without
  // this a crashed publication was indistinguishable from one that never started, and the only
  // way to tell them apart was a producer read that may not be available (SPECIALISTS-54).
  // The publication sequence runs under the settlement exclusion (SPECIALISTS-66). The
  // reconciliation reads SPECIALISTS-54 added cannot make this exactly-once on their own:
  // the record is already in another process's backlog from the `store.save` above until the
  // append returns, so a concurrent republish pass reads absent and duplicates. Contention
  // degrades to `pending` and never blocks — publication must not alter the activation result.
  const publishNow = (): PublishSettlementResult => {
    let allocatedReceiptId: string | undefined;
    let allocatedArtifactRef: string | undefined;
    try {
      const receipt = allocateReceipt(subject.executionBindingId);
      allocatedReceiptId = receipt.id;
      emit('settlement_receipt_allocated', { receipt: receipt.id });
      let artifactValue = storedRef;
      try {
        if (boundary.attachArtifact) {
          const attached = boundary.attachArtifact(receipt.id, 'artifact', storedRef);
          artifactValue = attached.value;
          allocatedArtifactRef = artifactValue;
          emit('settlement_artifact_attached', { receipt: receipt.id, kind: 'artifact' });
        }
      } catch (error) {
        // The receipt is allocated; a missing artifact link degrades the refs,
        // never the publication.
        emit('settlement_degraded', {
          note: `artifact attach failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      const result = buildBoundedResult({
        output: opts.output,
        valid: opts.validation.valid,
        errors: opts.validation.errors,
        artifactRefs: [artifactValue],
        receiptRefs: [receipt.id],
        provenanceRefs: [subject.executionBindingId, receipt.id],
      });
      const entry = appendResult(subject.issueRef, {
        result,
        executionContext,
        refs: [
          { kind: 'artifact', key: artifactValue },
          { kind: 'receipt', key: receipt.id },
        ],
        participantId: subject.participantId,
        activationId: subject.activationId,
        sessionId: subject.piSessionId,
      });
      emit('settlement_result_published', { entry: entry.entryId, receipt: receipt.id });
      const published: SettlementRecord = {
        ...record,
        receiptId: receipt.id,
        journalEntryId: entry.entryId,
        artifactRef: artifactValue,
        publication: { state: 'published', attempts: (record.publication?.attempts ?? 0) + 1, updatedAt: now },
      };
      try {
        store.save(published);
      } catch {
        // Links are already durable in Journal + receipt; the store update is convenience.
      }
      return {
        storedRef, receiptId: receipt.id, artifactValue, journalEntryId: entry.entryId, publicationState: 'published',
      };
    } catch (error) {
      const note = error instanceof Error ? error.message : String(error);
      // TRANSIENT by default: a locked store, a refused write or a producer-side error is what a
      // later republish exists to retry. `refused` is reserved for the cases above that cannot be
      // retried, so the backlog is not permanently poisoned by a one-off.
      //
      // Whatever DID land is recorded with the state, so the record itself carries the partial
      // progress instead of the next reader having to re-derive it from the producer.
      saveState(store, record, 'pending', note, {
        ...(allocatedReceiptId ? { receiptId: allocatedReceiptId } : {}),
        ...(allocatedArtifactRef ? { artifactRef: allocatedArtifactRef } : {}),
      });
      emit('settlement_degraded', { note, ...(allocatedReceiptId ? { partial_receipt: allocatedReceiptId } : {}) });
      return { storedRef, degraded: note, publicationState: 'pending' };
    }
  };

  const guarded = withSettlementExclusion(
    { repositoryRoot: subject.repositoryRoot, activationId: subject.activationId, attemptId: subject.attemptId },
    publishNow,
  );
  if (!guarded.ok) {
    saveState(store, record, 'pending', guarded.reason);
    emit('settlement_degraded', { note: guarded.reason, contended: true });
    return { storedRef, degraded: guarded.reason, publicationState: 'pending' };
  }
  return guarded.value;
}

/**
 * Persist the publication state onto the ALREADY-STORED record, preserving its links.
 *
 * Never throws: a store that cannot record its own publication state must not turn a settled
 * activation into a failure, and the forensics event that accompanies every call is the
 * fallback record.
 */
function saveState(
  store: SettlementStore,
  record: SettlementRecord,
  state: 'pending' | 'refused' | 'published',
  note: string,
  /** Links discovered by reconciliation, which must not be dropped by a state write. */
  links: { receiptId?: string; journalEntryId?: string; artifactRef?: string } = {},
  /** Required for `refused`: which refusal lifetime this is (SPECIALISTS-66). */
  refusal?: SettlementRefusalReason,
): void {
  try {
    const existing = store.get(record.activationId, record.attemptId) ?? record;
    store.save({
      ...existing,
      ...links,
      publication: {
        state,
        note,
        ...(refusal ? { refusal } : {}),
        attempts: (existing.publication?.attempts ?? 0) + 1,
        updatedAt: Date.now(),
      },
    });
  } catch {
    // Best effort by contract.
  }
}
