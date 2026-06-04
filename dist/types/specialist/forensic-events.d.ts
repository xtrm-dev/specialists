export declare const FORENSIC_SCHEMA_VERSION: "xtrm.forensic.v1";
export type ForensicSeverity = 'debug' | 'info' | 'warn' | 'error' | 'critical';
export type RedactionStatus = 'clean' | 'redacted' | 'unknown';
export interface ForensicResource {
    service_namespace: string;
    service_name: string;
    service_component: string;
    deployment_environment: string;
    repo: string;
    service_version?: string;
    runtime?: string;
    participant_kind?: string;
    participant_role?: string;
    model_provider?: string;
    model?: string;
    worktree_mode?: string;
    chain_kind?: string;
    [key: string]: unknown;
}
export interface ForensicCorrelation {
    participant_id?: string;
    job_id?: string;
    bead_id?: string;
    issue_id?: string;
    container_id?: string;
    chain_id?: string;
    chain_root_job_id?: string;
    chain_root_bead_id?: string;
    epic_id?: string;
    node_id?: string;
    pulse_id?: string;
    turn_id?: string;
    tool_call_id?: string;
    trace_id?: string;
    span_id?: string;
    parent_span_id?: string;
    session_id?: string;
    conversation_id?: string;
    mcp_session_id?: string;
    jsonrpc_request_id?: string;
    eval_id?: string;
    policy_decision_id?: string;
    identity_request_id?: string;
    commit_sha?: string;
    [key: string]: unknown;
}
export interface ForensicRedaction {
    status: RedactionStatus;
    fields?: string[];
    rules?: string[];
}
export interface ForensicEvent<TBody extends Record<string, unknown> = Record<string, unknown>> {
    schema_version: typeof FORENSIC_SCHEMA_VERSION;
    timestamp: string;
    t_unix_ms: number;
    seq?: number;
    severity: ForensicSeverity;
    event_family: string;
    event_name: string;
    event_version: number;
    resource: ForensicResource;
    correlation: ForensicCorrelation;
    body: TBody;
    redaction: ForensicRedaction;
    trace?: Record<string, unknown>;
    otel?: Record<string, unknown>;
    links?: Record<string, unknown>;
    diagnostics?: Record<string, unknown>;
}
export interface CreateForensicEventOptions<TBody extends Record<string, unknown> = Record<string, unknown>> {
    event_family: string;
    event_name: string;
    resource: ForensicResource;
    correlation?: ForensicCorrelation;
    body?: TBody;
    severity?: ForensicSeverity;
    event_version?: number;
    redaction?: ForensicRedaction;
    t_unix_ms?: number;
    timestamp?: string;
    seq?: number;
    trace?: Record<string, unknown>;
    otel?: Record<string, unknown>;
    links?: Record<string, unknown>;
    diagnostics?: Record<string, unknown>;
}
export declare const FORBIDDEN_PROMETHEUS_LABELS: Set<string>;
export declare const DEFAULT_LABEL_ALLOWLIST: Set<string>;
interface RedactionResult<T = unknown> {
    value: T;
    fields: string[];
    rules: string[];
}
export declare function redactForensicValue<T>(value: T, path?: string): RedactionResult<T>;
export declare function createForensicEvent<TBody extends Record<string, unknown> = Record<string, unknown>>(options: CreateForensicEventOptions<TBody>): ForensicEvent<TBody>;
export declare function normalizeResource(resource: ForensicResource): ForensicResource;
export interface ParticipantIdentityInput {
    participant_kind?: string;
    participant_role: string;
    chain_id?: string;
    container_id?: string;
    session_uuid?: string;
    node_id?: string;
    member_index?: number;
    adapter_id?: string;
}
export declare function deriveParticipantId(input: ParticipantIdentityInput): string | undefined;
export declare function assertKnownTopLevelFields(event: Record<string, unknown>): void;
export declare function assertNoForbiddenLabels(labels: Record<string, unknown>): void;
export declare function pickAllowedLabels(source: Record<string, unknown>, allowlist?: Set<string>): Record<string, string>;
export interface TimelineForensicContext {
    jobId: string;
    specialist: string;
    beadId?: string;
    nodeId?: string;
    repo?: string;
    serviceComponent?: string;
    model?: string;
    backend?: string;
    chainKind?: string;
    chainId?: string;
    chainRootJobId?: string;
    chainRootBeadId?: string;
    epicId?: string;
    sessionId?: string;
    conversationId?: string;
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
}
export declare function forensicEventFromTimelineEvent(event: {
    t: number;
    seq?: number;
    type: string;
    [key: string]: unknown;
}, context: TimelineForensicContext): ForensicEvent;
export {};
//# sourceMappingURL=forensic-events.d.ts.map