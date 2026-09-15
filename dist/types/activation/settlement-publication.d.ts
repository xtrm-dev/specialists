import type { SpecialistWorkItemBoundary } from './workitem-store.js';
import type { SettlementRecord, SettlementStore } from './settlement-store.js';
/** Envelope version consumed. Mirrors EXECUTION_CONTEXT_VERSION (substrate@a77d094). */
export declare const SETTLEMENT_CONTEXT_VERSION = 1;
/** Journal result version stamped. Mirrors RESULT_VERSION (substrate@a77d094). */
export declare const SETTLEMENT_RESULT_VERSION = 1;
/** Bounded-publication limits. Mirror the Substrate ResultPayload bounds. */
export declare const SUMMARY_MAX = 4000;
export declare const RESULT_ARRAY_MAX = 100;
export declare const RESULT_ITEM_MAX = 1000;
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
    actor?: {
        type: string;
        id?: string;
        name?: string;
    };
    participantId?: string;
    xtrmSessionId?: string;
    xtrmSessionName?: string;
    host?: {
        type: string;
        sessionId?: string;
    };
    runId?: string;
    chainRunId?: string;
    coordinator?: {
        participantId?: string;
        sessionId?: string;
    };
    specialist?: {
        name?: string;
        activationId?: string;
        attemptId?: string;
        agentSessionId?: string;
    };
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
/** Raw settlement output as text. Never throws; never truncated here. */
export declare function outputText(output: unknown): string;
/**
 * Build the bounded Journal result payload (§39). The summary is a bounded
 * excerpt of the raw output — the full text stays in runtime storage and only
 * its artifact ref lands here, so oversized output can never reach the
 * Journal body.
 */
export declare function buildBoundedResult(opts: {
    output: unknown;
    valid: boolean;
    errors?: string[];
    artifactRefs: string[];
    receiptRefs: string[];
    provenanceRefs: string[];
}): BoundedResult;
/**
 * Build the X1 settlement envelope (§37). Every leg is host-observed: the
 * participant/activation/attempt/session from the live snapshot and binding,
 * the coordinator pair from the dispatch request, the workspace from the
 * resolved workspace identity plus the binding's base commit, the XTRM
 * session from the exact R4 env contract only. Unknown stays absent.
 */
export declare function buildSettlementExecutionContext(opts: {
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
}): SettlementExecutionContext;
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
export declare function republishSettlement(opts: {
    boundary: SpecialistWorkItemBoundary;
    store: SettlementStore;
    record: SettlementRecord;
    participantId: string;
    repositoryRoot: string;
    worktreePath?: string;
    coordinator?: {
        participantId?: string;
        sessionId?: string;
    };
    env?: Record<string, string | undefined>;
    now?: number;
    emit?: (name: string, payload?: Record<string, unknown>) => void;
}): {
    outcome: 'published' | 'pending' | 'refused';
    journalEntryId?: string;
    receiptId?: string;
    note?: string;
};
/**
 * Republish the whole pending settlement backlog, oldest first.
 *
 * One record's failure never stops the pass: a permanently-unpublishable record must not keep
 * every later one stuck behind it. Returns the per-record outcomes so the caller can log them.
 */
/** Records one pass will attempt. Bounds the work the FIRST DISPATCH of a process pays. */
export declare const REPUBLISH_PASS_LIMIT = 50;
export declare function republishPendingSettlements(opts: {
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
}): Array<{
    activationId: string;
    attemptId: string;
    outcome: 'published' | 'pending' | 'refused' | 'error';
}>;
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
export declare function publishSettlement(opts: {
    boundary: SpecialistWorkItemBoundary;
    store: SettlementStore;
    subject: SettlementSubject;
    status: 'completed' | 'failed';
    output: unknown;
    validation: {
        valid: boolean;
        errors?: string[];
    };
    coordinator?: {
        participantId?: string;
        sessionId?: string;
    };
    env?: Record<string, string | undefined>;
    now?: number;
    emit?: (name: string, payload?: Record<string, unknown>) => void;
}): PublishSettlementResult;
//# sourceMappingURL=settlement-publication.d.ts.map