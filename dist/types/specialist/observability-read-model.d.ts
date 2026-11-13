import type { ForensicEvent } from './forensic-events.js';
import { type RenderedRow } from './forensic-renderer.js';
import { type ReconstructedJobNode, type ReconstructedLineage } from './runtime-origin-reconstruct.js';
import type { ForensicEventRecord, ListForensicEventsFilters, ListStatusesWindowFilters, ObservabilitySqliteClient } from './observability-sqlite.js';
import type { SessionRunMetrics } from './session-metrics-contract.js';
import type { SupervisorStatus } from './status-contract.js';
export interface ObservabilityReadSource {
    readForensicEvents(filters?: ListForensicEventsFilters): ForensicEventRecord[];
    listForensicAttemptIds(jobId: string): string[];
    listStatusesWindow(filters?: ListStatusesWindowFilters): SupervisorStatus[];
    readStatus(jobId: string): SupervisorStatus | null;
    readResult(jobId: string): string | null;
}
/** Forensic seq is unique inside a job and is the canonical follow cursor. */
export interface ForensicCursor {
    seq: number;
}
export interface ParsedForensicRecord {
    record: ForensicEventRecord;
    event: ForensicEvent;
}
export interface ForensicWindow {
    events: ForensicEvent[];
    rows: RenderedRow[];
    cursor?: ForensicCursor;
    invalidRecords: number;
    hasMore: boolean;
}
export interface ReadForensicWindowOptions {
    jobId: string;
    after?: ForensicCursor;
    limit?: number;
    allEvents?: boolean;
    attemptId?: string;
}
export type FleetAttention = 'blocked' | 'failed' | 'warning' | 'active' | 'settled' | 'idle';
export interface RuntimeAttachment {
    kind: 'xtmux.agent_instance';
    hostId: string;
    paneId: string;
    sessionId?: string;
    windowId?: string;
    agentInstanceId?: string;
    direct: boolean;
}
export interface FleetNode {
    jobId: string;
    specialist: string;
    beadId?: string;
    state: string;
    attention: FleetAttention;
    native: boolean;
    currentEvent?: string;
    currentTool?: string;
    startedAtMs?: number;
    lastEventAtMs?: number;
    parentJobId?: string;
    children: string[];
    attachment?: RuntimeAttachment;
    lineage?: ReconstructedJobNode;
}
export interface FleetSnapshot {
    generatedAtMs: number;
    nodes: FleetNode[];
    byId: Map<string, FleetNode>;
    roots: string[];
    lineage: ReconstructedLineage;
    invalidRecords: number;
    counts: {
        total: number;
        active: number;
        waiting: number;
        warning: number;
        failed: number;
        settled: number;
    };
}
export interface ReadFleetOptions {
    limit?: number;
    sinceMs?: number;
    statuses?: readonly SupervisorStatus['status'][];
}
export interface ResultProjection {
    jobId: string;
    attemptId?: string;
    attemptVerified: boolean;
    output: string | null;
    available: boolean;
    error?: string;
}
/** Safe selected-activation DETAIL projection. */
export interface ActivationInspect {
    jobId: string;
    specialist?: string;
    beadId?: string;
    state?: string;
    currentEvent?: string;
    currentTool?: string;
    model?: string;
    backend?: string;
    attempts: string[];
    latestAttemptId?: string;
    configuredModel?: string;
    requestedModel?: string;
    resolvedModel?: string;
    modelOverride?: boolean;
    thinkingLevel?: string;
    piSessionId?: string;
    workspaceId?: string;
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
    metrics?: SessionRunMetrics;
    contextPct?: number;
    contextPctSource?: SupervisorStatus['context_pct_source'];
    worktreePath?: string;
    branch?: string;
    parentJobId?: string;
    attachment?: RuntimeAttachment;
}
export declare function parseForensicRecord(record: ForensicEventRecord): ParsedForensicRecord | null;
export declare function parseForensicRecords(records: readonly ForensicEventRecord[]): {
    parsed: ParsedForensicRecord[];
    invalidRecords: number;
};
/**
 * Read one bounded forensic LOG page. Follow mode is seq-based at the SQLite
 * boundary; timestamps are display/filter metadata only.
 */
export declare function readForensicWindow(source: ObservabilityReadSource, options: ReadForensicWindowOptions): ForensicWindow;
export declare function readFleetSnapshot(source: ObservabilityReadSource, options?: ReadFleetOptions): FleetSnapshot;
/**
 * Result storage remains activation-level. If an exact attempt is requested we
 * first prove that attempt exists in durable forensic history, matching current
 * sp result fail-closed semantics, then return the activation's persisted result.
 */
export declare function readResultProjection(source: ObservabilityReadSource, ref: {
    jobId: string;
    attemptId?: string;
}): ResultProjection;
export declare function readActivationInspect(source: ObservabilityReadSource, jobId: string): ActivationInspect | null;
export declare function asObservabilityReadSource(client: ObservabilitySqliteClient): ObservabilityReadSource;
//# sourceMappingURL=observability-read-model.d.ts.map