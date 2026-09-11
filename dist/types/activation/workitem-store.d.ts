import type { DatabaseSync } from 'node:sqlite';
/** Canonical authority path: explicit XTRM_STATE_DB wins, else ~/.xtrm/state.db. */
export declare function resolveWorkItemDbPath(env?: NodeJS.ProcessEnv): string;
/**
 * Open a SQLite database behind the DatabaseSync surface the work services use.
 *
 * bun:sqlite first (bun 1.3.14 has no node:sqlite), node:sqlite fallback for
 * non-bun runtimes — the same dual-driver discipline authority-store.ts applies
 * to the same file. bun binds undefined as NULL where node:sqlite refuses it,
 * so params are normalized where the two disagree; nothing else differs on the
 * prepare/exec/close surface. Opening a database is generic sqlite work and
 * carries no Substrate code.
 */
export declare function openSubstrateDb(dbPath: string): DatabaseSync;
/** One resolved issue revision, flattened for the admission and render surface. */
export interface WorkItemView {
    ref: string;
    issueId: string;
    revision: number;
    contractHash: string;
    title: string;
    contract: unknown;
    readinessState: string;
    dispatchable: boolean;
    reasons: string[];
}
/** Epic lineage hop: whatever the prompt renderer needs from an ancestor issue. */
export interface EpicAncestor {
    ref: string;
    title: string;
    description?: string;
}
/** Result of an inline-contract dispatch (§10): the created issue's identity. */
export interface InlineIssueResult {
    ref: string;
    issueId: string;
    claimId: number | null;
}
/**
 * Dispatch request carried across the seam. Extra producer-specific fields may
 * ride along; the consumer only reads ref/holder/claim/activation identity.
 */
export interface DispatchRequest {
    ref: string;
    holder: string;
    specialist?: string;
    claimId?: number | null;
    activationId?: string | null;
    attemptId?: string | null;
    sessionId?: string | null;
    workspace?: unknown;
    baseCommit?: string | null;
    [key: string]: unknown;
}
/** Structural projection of the producer's ExecutionBinding — the fields the host pins. */
export interface ExecutionBindingView {
    id: string;
    issueId: string;
    issueRevision: number;
    contractHash: string;
    claimId: number | null;
    [key: string]: unknown;
}
/** Readiness + binding outcome for the admission path. */
export interface BindResult {
    check: {
        issueId: string;
        revision: number;
        contractHash: string;
        report: unknown;
    };
    binding: ExecutionBindingView;
}
/** Read-only dispatch gate outcome (§49 ordering: check before any mutation). */
export interface CheckResult {
    issueId: string;
    revision: number;
    contractHash: string;
    report: unknown;
}
/**
 * The consumer-side work boundary (ADR §8-§12).
 *
 * `check` is the fail-closed read-only gate (draft/unready/blocked/terminal/
 * scope-expansion refuse before anything is created); `bind` performs the
 * mutation at activation start, pinning the immutable ExecutionBinding over
 * issue/revision/hash/claim/participant/activation/attempt/session/workspace
 * (§9). `inlineCreate` implements §10 — an inline contract becomes a real
 * Substrate Issue through structural validation, creation, attestation and
 * claim; there is no bd subprocess and no hidden temporary work item on any
 * path in this module.
 */
export interface SpecialistWorkItemBoundary {
    view(ref: string): WorkItemView;
    epicAncestors(ref: string, depth: number): EpicAncestor[];
    check(req: DispatchRequest): CheckResult;
    bind(req: DispatchRequest): ExecutionBindingView;
    inlineCreate(contract: string, opts?: {
        title?: string;
        holder?: string;
        activationId?: string;
    }): InlineIssueResult;
    journal(ref: string, kind: string, opts?: {
        participantId?: string;
        activationId?: string;
    }): void;
}
/** Structural view of the producer's active claim — the only claim fields the seam reads. */
export interface ActiveClaimView {
    id: number;
    holder: string;
    activationId: string | null;
}
/** Structural port over the producer's issue service. Implemented by fakes in public tests. */
export interface IssueServicePort {
    resolveRef(ref: string): {
        id: string;
        humanRef: string;
    };
    getActiveClaim(issueId: string): ActiveClaimView | null;
    getParent(childId: string): {
        id: string;
        humanRef: string;
        title: string;
        currentRevision: number;
    } | null;
    getRevision(issueId: string, revision: number): {
        contract: unknown;
    };
    resolveProject(opts: {
        gitRoot: string;
    }): {
        projectId: string;
    };
    createIssue(input: {
        projectId: string;
        title: string;
        kind: string;
        contract: unknown;
        scrutiny: string;
        authoredBy: string;
    }): {
        id: string;
    };
    claimReady(issueId: string, holder: string, attestation: {
        outcome: string;
        policy: string;
        attestedBy: string;
    }, opts?: {
        activationId?: string;
    }): {
        claim: {
            id: number;
        };
    };
}
/** Structural port over the producer's issue store (read + journal). */
export interface IssueStorePort {
    get(ref: string): {
        issue: {
            humanRef: string;
            id: string;
            currentRevision: number;
            currentContractHash: string;
            title: string;
        };
        contract: unknown;
        readinessState: string;
        dispatchable: boolean;
        reasons: string[];
    };
    addJournal(ref: string, kind: string, opts?: {
        participantId?: string;
        activationId?: string;
    }): void;
}
/** Structural port over the producer's dispatch gate (check + bind mutation). */
export interface DispatchGatePort {
    check(issues: unknown, req: DispatchRequest): {
        issueId: string;
        revision: number;
        contractHash: string;
        report: unknown;
    };
    dispatch(issues: unknown, provenance: unknown, req: DispatchRequest): {
        binding: ExecutionBindingView;
    };
}
/** The injected ports `createWorkItemBoundary` programs against. */
export interface WorkItemPorts {
    issues: IssueServicePort;
    provenance: unknown;
    store: IssueStorePort;
    gate: DispatchGatePort;
}
/**
 * Build the consumer boundary over injected producer ports.
 *
 * Public unit tests inject fakes; the private integration job injects the real
 * Substrate services; `openWorkItemBoundary` injects them via runtime dynamic
 * import. No path here statically imports producer code.
 */
export declare function createWorkItemBoundary(ports: WorkItemPorts): SpecialistWorkItemBoundary;
/** Options for the runtime opener. */
export interface OpenWorkItemsOptions {
    dbPath?: string;
    /** Absolute path to a built @xtrm/substrate checkout. No default: public builds never assume one. */
    substrateDir?: string;
    env?: NodeJS.ProcessEnv;
}
/**
 * Open the canonical work store and build the boundary over the REAL producer
 * services, dynamic-imported at runtime from an explicit checkout.
 *
 * `substrateDir` (or `XTRM_SUBSTRATE_DIR`) must point at a @xtrm/substrate
 * package directory exposing `src/store/migrations/runner.ts`,
 * `src/service/issue-service.ts`, `src/service/journal-service.ts`,
 * `src/service/provenance-service.ts`, `src/workitems/substrate-store.ts` and
 * `src/workitems/dispatch-gate.ts` with the `migrate`, `IssueService`,
 * `JournalService`, `ProvenanceService`, `SubstrateIssueStore`,
 * `checkDispatch` and `dispatchToSpecialist` members. Anything else — absent
 * directory, failed import, unopenable store — fails closed with
 * `work_item_store_unavailable`; there is no fallback work authority.
 */
export declare function openWorkItemBoundary(opts?: OpenWorkItemsOptions): Promise<SpecialistWorkItemBoundary>;
/** Used where work is genuinely not available (unit tests); every call refuses. */
export declare const NULL_WORK_ITEMS: SpecialistWorkItemBoundary;
//# sourceMappingURL=workitem-store.d.ts.map