import type { SpecialistWorkItemBoundary } from './workitem-store.js';
import type { SettlementStore } from './settlement-store.js';
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