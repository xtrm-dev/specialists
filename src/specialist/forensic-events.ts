export const FORENSIC_SCHEMA_VERSION = 'xtrm.forensic.v1' as const;

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

export const FORBIDDEN_PROMETHEUS_LABELS = new Set([
  'participant_id',
  'job_id',
  'bead_id',
  'issue_id',
  'container_id',
  'chain_id',
  'chain_root_job_id',
  'chain_root_bead_id',
  'epic_id',
  'node_id',
  'pulse_id',
  'turn_id',
  'tool_call_id',
  'trace_id',
  'span_id',
  'parent_span_id',
  'commit_sha',
  'jsonrpc_request_id',
  'mcp_session_id',
  'raw_path',
  'raw_command',
  'raw_error',
  'raw_url',
  'prompt',
  'model_output',
  'user_id',
  'email',
  'token',
  'credential',
]);

export const DEFAULT_LABEL_ALLOWLIST = new Set([
  'service_namespace',
  'service_name',
  'service_component',
  'deployment_environment',
  'repo',
  'participant_kind',
  'participant_role',
  'event_family',
  'severity',
  'state',
  'status',
  'result',
  'model_provider',
  'model',
  'tool_name',
  'mcp_server',
  'mcp_method',
  'error_type',
  'drift_tier',
  'pulse_kind',
]);

const ALLOWED_TOP_LEVEL_FIELDS = new Set([
  'schema_version',
  'timestamp',
  't_unix_ms',
  'seq',
  'severity',
  'event_family',
  'event_name',
  'event_version',
  'resource',
  'correlation',
  'body',
  'redaction',
  'trace',
  'otel',
  'links',
  'diagnostics',
]);

export function createForensicEvent<TBody extends Record<string, unknown> = Record<string, unknown>>(
  options: CreateForensicEventOptions<TBody>,
): ForensicEvent<TBody> {
  const tUnixMs = options.t_unix_ms ?? Date.now();
  const event: ForensicEvent<TBody> = {
    schema_version: FORENSIC_SCHEMA_VERSION,
    timestamp: options.timestamp ?? new Date(tUnixMs).toISOString(),
    t_unix_ms: tUnixMs,
    severity: options.severity ?? 'info',
    event_family: options.event_family,
    event_name: options.event_name,
    event_version: options.event_version ?? 1,
    resource: normalizeResource(options.resource),
    correlation: options.correlation ?? {},
    body: options.body ?? ({} as TBody),
    redaction: options.redaction ?? { status: 'clean' },
  };

  if (options.seq !== undefined) event.seq = options.seq;
  if (options.trace) event.trace = options.trace;
  if (options.otel) event.otel = options.otel;
  if (options.links) event.links = options.links;
  if (options.diagnostics) event.diagnostics = options.diagnostics;

  assertKnownTopLevelFields(event as unknown as Record<string, unknown>);
  return event;
}

export function normalizeResource(resource: ForensicResource): ForensicResource {
  const normalized = { ...resource };
  const legacySpecialist = normalized.specialist;
  if (!normalized.participant_kind && typeof legacySpecialist === 'string') {
    normalized.participant_kind = 'specialist';
  }
  if (!normalized.participant_role && typeof legacySpecialist === 'string') {
    normalized.participant_role = legacySpecialist;
  }
  delete normalized.specialist;
  return normalized;
}

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

export function deriveParticipantId(input: ParticipantIdentityInput): string | undefined {
  const kind = input.participant_kind ?? 'specialist';
  if (kind === 'specialist' && input.chain_id) return `${input.chain_id}::${input.participant_role}`;
  if (kind === 'orchestrator' && input.session_uuid) return `orch::${input.session_uuid}`;
  if (kind === 'pulse_emitter' && input.container_id) return `${input.container_id}::emitter::${input.participant_role}`;
  if (kind === 'node_member' && input.node_id) return `node::${input.node_id}::${input.participant_role}::${input.member_index ?? 0}`;
  if (kind === 'adapter' && input.adapter_id) return input.adapter_id;
  return undefined;
}

export function assertKnownTopLevelFields(event: Record<string, unknown>): void {
  for (const key of Object.keys(event)) {
    if (!ALLOWED_TOP_LEVEL_FIELDS.has(key)) {
      throw new Error(`Unknown forensic event top-level field: ${key}`);
    }
  }
}

export function assertNoForbiddenLabels(labels: Record<string, unknown>): void {
  const forbidden = Object.keys(labels).filter((key) => FORBIDDEN_PROMETHEUS_LABELS.has(key));
  if (forbidden.length > 0) {
    throw new Error(`Forbidden telemetry label(s): ${forbidden.join(', ')}`);
  }
}

export function pickAllowedLabels(source: Record<string, unknown>, allowlist = DEFAULT_LABEL_ALLOWLIST): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!allowlist.has(key) || value === undefined || value === null) continue;
    labels[key] = String(value);
  }
  assertNoForbiddenLabels(labels);
  return labels;
}

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
}

export function forensicEventFromTimelineEvent(
  event: { t: number; seq?: number; type: string; [key: string]: unknown },
  context: TimelineForensicContext,
): ForensicEvent {
  const participantRole = context.specialist;
  const participantKind = context.nodeId ? 'node_member' : 'specialist';
  const participantId = deriveParticipantId({
    participant_kind: participantKind,
    participant_role: participantRole,
    chain_id: context.chainId,
    node_id: context.nodeId,
  });

  return createForensicEvent({
    event_family: familyForTimelineType(event.type),
    event_name: eventNameForTimelineEvent(event),
    severity: severityForTimelineEvent(event),
    resource: {
      service_namespace: 'xtrm',
      service_name: 'specialists',
      service_component: context.serviceComponent ?? 'runtime',
      deployment_environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
      repo: context.repo ?? 'unknown',
      participant_kind: participantKind,
      participant_role: participantRole,
      model_provider: context.backend,
      model: context.model,
      chain_kind: context.chainKind,
    },
    correlation: {
      participant_id: participantId,
      job_id: context.jobId,
      bead_id: context.beadId,
      node_id: context.nodeId,
      chain_id: context.chainId,
      chain_root_job_id: context.chainRootJobId,
      chain_root_bead_id: context.chainRootBeadId,
      epic_id: context.epicId,
      tool_call_id: typeof event.tool_call_id === 'string' ? event.tool_call_id : undefined,
    },
    body: { legacy_timeline_event: event },
    redaction: { status: redactionStatusForTimelineEvent(event) },
    t_unix_ms: event.t,
    seq: event.seq,
  });
}

function familyForTimelineType(type: string): string {
  if (type === 'run_start' || type === 'run_complete' || type === 'status_change' || type === 'payload_breakdown') return 'job';
  if (type === 'tool') return 'tool';
  if (type === 'turn' || type === 'turn_summary' || type === 'message' || type === 'text' || type === 'thinking') return 'turn';
  if (type === 'token_usage' || type === 'finish_reason' || type === 'model_change' || type === 'meta') return 'model';
  if (type === 'control_signal') return 'control';
  if (type === 'retry') return 'retry';
  if (type === 'compaction') return 'compaction';
  if (type === 'error' || type === 'extension_error') return 'error';
  if (type === 'auto_commit_success' || type === 'auto_commit_skipped' || type === 'auto_commit_failed') return 'git';
  if (type === 'stale_warning') return 'process_health';
  return 'job';
}

function eventNameForTimelineEvent(event: { type: string; [key: string]: unknown }): string {
  if (event.type === 'run_start') return 'job.started';
  if (event.type === 'run_complete') {
    if (event.status === 'ERROR') return 'job.failed';
    if (event.status === 'CANCELLED') return 'job.cancelled';
    return 'job.completed';
  }
  if (event.type === 'status_change') return 'job.status_changed';
  if (event.type === 'tool') {
    if (event.phase === 'start') return 'tool.call.started';
    if (event.is_error) return 'tool.call.failed';
    return 'tool.call.completed';
  }
  if (event.type === 'turn_summary') return 'turn.summarized';
  if (event.type === 'token_usage') return 'model.token_usage.recorded';
  if (event.type === 'finish_reason') return 'model.finish_reason.recorded';
  if (event.type === 'model_change') return 'model.changed';
  if (event.type === 'control_signal') return `control.${String(event.action ?? 'signal')}.recorded`;
  if (event.type === 'retry') return `retry.${String(event.phase ?? 'recorded')}`;
  if (event.type === 'compaction') return `compaction.${String(event.phase ?? 'recorded')}`;
  if (event.type === 'extension_error') return 'error.extension';
  if (event.type === 'error') return 'error.rpc';
  if (event.type === 'auto_commit_success') return 'git.auto_commit.succeeded';
  if (event.type === 'auto_commit_skipped') return 'git.auto_commit.skipped';
  if (event.type === 'auto_commit_failed') return 'git.auto_commit.failed';
  if (event.type === 'stale_warning') return 'process_health.stale_detected';
  return `${familyForTimelineType(event.type)}.${event.type}`;
}

function severityForTimelineEvent(event: { type: string; [key: string]: unknown }): ForensicSeverity {
  if (event.type === 'error' || event.type === 'extension_error' || event.type === 'auto_commit_failed') return 'error';
  if (event.type === 'stale_warning' || event.type === 'control_signal') return 'warn';
  if (event.type === 'run_complete' && event.status === 'ERROR') return 'error';
  if (event.type === 'tool' && event.is_error) return 'error';
  return 'info';
}

function redactionStatusForTimelineEvent(event: { type: string; [key: string]: unknown }): RedactionStatus {
  if (event.type === 'tool' || event.type === 'turn_summary' || event.type === 'run_complete') return 'redacted';
  return 'clean';
}
