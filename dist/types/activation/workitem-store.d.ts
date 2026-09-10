import type { DatabaseSync } from 'node:sqlite';
import { IssueService } from '@xtrm/substrate/src/service/issue-service.ts';
import { JournalService } from '@xtrm/substrate/src/service/journal-service.ts';
import { ProvenanceService } from '@xtrm/substrate/src/service/provenance-service.ts';
import { SubstrateIssueStore } from '@xtrm/substrate/src/workitems/substrate-store.ts';
import { type SpecialistDispatchRequest } from '@xtrm/substrate/src/workitems/dispatch-gate.ts';
import type { ExecutionBinding } from '@xtrm/substrate/src/domain/execution-binding.ts';
import type { ReadinessReport } from '@xtrm/substrate/src/domain/readiness.ts';
/** Canonical authority path: explicit XTRM_STATE_DB wins, else ~/.xtrm/state.db. */
export declare function resolveWorkItemDbPath(env?: NodeJS.ProcessEnv): string;
/**
 * Open the substrate DB behind the DatabaseSync surface the services use.
 *
 * bun:sqlite first (bun 1.3.14 has no node:sqlite), node:sqlite fallback for
 * non-bun runtimes — the same dual-driver discipline authority-store.ts applies
 * to the same file, restated for the substrate seam. bun binds undefined as
 * NULL where node:sqlite refuses it, so params are normalized where the two
 * disagree; nothing else differs on the prepare/exec/close surface.
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
/** Readiness + binding outcome for the admission path. */
export interface BindResult {
    check: {
        issueId: string;
        revision: number;
        contractHash: string;
        report: ReadinessReport;
    };
    binding: ExecutionBinding;
}
/** Read-only dispatch gate outcome (§49 ordering: check before any mutation). */
export interface CheckResult {
    issueId: string;
    revision: number;
    contractHash: string;
    report: ReadinessReport;
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
    check(req: SpecialistDispatchRequest): CheckResult;
    bind(req: SpecialistDispatchRequest): ExecutionBinding;
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
/** The substrate-backed boundary. */
export declare class SubstrateWorkItemsBoundary implements SpecialistWorkItemBoundary {
    private readonly issues;
    private readonly journalSvc;
    private readonly provenance;
    private readonly store;
    constructor(issues: IssueService, journalSvc: JournalService, provenance: ProvenanceService, store: SubstrateIssueStore);
    private viewOf;
    view(ref: string): WorkItemView;
    epicAncestors(ref: string, depth: number): EpicAncestor[];
    check(req: SpecialistDispatchRequest): CheckResult;
    bind(req: SpecialistDispatchRequest): ExecutionBinding;
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
/** Open the canonical substrate store and build the boundary. */
export declare function openWorkItems(dbPath?: string): SubstrateWorkItemsBoundary;
/** Used where work is genuinely not available (unit tests); every call refuses. */
export declare const NULL_WORK_ITEMS: SpecialistWorkItemBoundary;
//# sourceMappingURL=workitem-store.d.ts.map