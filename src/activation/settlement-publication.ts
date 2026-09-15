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
import type { SettlementRecord, SettlementStore } from './settlement-store.js';

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

export interface PublishSettlementResult {
  /** Runtime storage ref. Always present: even a degraded publication stores. */
  storedRef: string;
  receiptId?: string;
  artifactValue?: string;
  journalEntryId?: string;
  degraded?: string;
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

  // A failed turn settled nothing to publish: it stays runtime-queryable
  // (store + forensics) but produces no Journal result and no receipt.
  if (opts.status !== 'completed') return { storedRef };

  if (!boundary.allocateReceipt || !boundary.appendResult) {
    emit('settlement_degraded', { note: 'work boundary carries no settlement surface; result stored only' });
    return { storedRef, degraded: 'boundary without settlement surface' };
  }

  try {
    const receipt = boundary.allocateReceipt(subject.executionBindingId);
    emit('settlement_receipt_allocated', { receipt: receipt.id });
    let artifactValue = storedRef;
    try {
      if (boundary.attachArtifact) {
        const attached = boundary.attachArtifact(receipt.id, 'artifact', storedRef);
        artifactValue = attached.value;
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
    const entry = boundary.appendResult(subject.issueRef, {
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
    try {
      store.save({ ...record, receiptId: receipt.id, journalEntryId: entry.entryId, artifactRef: artifactValue });
    } catch {
      // Links are already durable in Journal + receipt; the store update is convenience.
    }
    return { storedRef, receiptId: receipt.id, artifactValue, journalEntryId: entry.entryId };
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    emit('settlement_degraded', { note });
    return { storedRef, degraded: note };
  }
}
