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
  'session_id',
  'conversation_id',
  'mcp_session_id',
  'jsonrpc_request_id',
  'eval_id',
  'policy_decision_id',
  'identity_request_id',
  'commit_sha',
  'raw_path',
  'raw_command',
  'raw_error',
  'raw_diff',
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
  'policy_kind',
  'action_kind',
  'resource_kind',
  'credential_kind',
  'eval_kind',
  'chain_template',
  'gate_kind',
  'verdict',
  'severity_level',
  'direction',
  'reason',
  'process_kind',
  'evidence_kind',
  'target',
  'highest_risk',
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

const REDACTED = '[REDACTED]';
const REDACTION_RULES = {
  sensitiveField: 'sensitive-field-name',
  secretPattern: 'secret-pattern',
} as const;

const SENSITIVE_FIELD_RE = /(^|_)(password|secret|credential|api_?key|access_?token|refresh_?token|auth_?token|bearer|email|prompt|model_?output|raw_?command|raw_?url|raw_?error|stderr|stdout|args|arguments|input|output|content)$/i;
const SECRET_VALUE_RE = /(sk-[a-z0-9_-]{12,}|ghp_[a-z0-9_]{12,}|xox[baprs]-[a-z0-9-]{12,}|bearer\s+[a-z0-9._-]{12,})/i;

interface RedactionResult<T = unknown> {
  value: T;
  fields: string[];
  rules: string[];
}

export function redactForensicValue<T>(value: T, path = 'body'): RedactionResult<T> {
  const fields = new Set<string>();
  const rules = new Set<string>();

  function visit(input: unknown, currentPath: string): unknown {
    if (Array.isArray(input)) return input.map((item, index) => visit(item, `${currentPath}[${index}]`));
    if (input && typeof input === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(input)) {
        const nextPath = `${currentPath}.${key}`;
        if (isSensitiveField(key)) {
          output[key] = REDACTED;
          fields.add(nextPath);
          rules.add(REDACTION_RULES.sensitiveField);
          continue;
        }
        output[key] = visit(nested, nextPath);
      }
      return output;
    }
    if (typeof input === 'string' && SECRET_VALUE_RE.test(input)) {
      fields.add(currentPath);
      rules.add(REDACTION_RULES.secretPattern);
      return input.replace(SECRET_VALUE_RE, REDACTED);
    }
    return input;
  }

  return {
    value: visit(value, path) as T,
    fields: Array.from(fields).sort(),
    rules: Array.from(rules).sort(),
  };
}

const NON_SENSITIVE_TELEMETRY_BODY_FIELDS = new Set([
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_creation_tokens',
  'reasoning_tokens',
  'tool_tokens',
  'total_tokens',
  'usage_source',
  'credential_kind',
  'policy_kind',
  'action_kind',
  'resource_kind',
  'eval_kind',
  'target_kind',
  'scope_kind',
  'provider',
  'ttl_seconds',
  'retryable',
  'result',
  'score',
  'threshold',
  'scale',
  'severity',
  'reason_code',
  'mismatch_kind',
]);

function isSensitiveField(key: string): boolean {
  if (NON_SENSITIVE_TELEMETRY_BODY_FIELDS.has(key)) return false;
  return SENSITIVE_FIELD_RE.test(key);
}

function mergeRedaction(explicit: ForensicRedaction | undefined, result: RedactionResult): ForensicRedaction {
  const fields = [...new Set([...(explicit?.fields ?? []), ...result.fields])].sort();
  const rules = [...new Set([...(explicit?.rules ?? []), ...result.rules])].sort();
  const status: RedactionStatus = explicit?.status === 'unknown'
    ? 'unknown'
    : explicit?.status === 'redacted' || fields.length > 0
      ? 'redacted'
      : 'clean';
  return {
    status,
    ...(fields.length > 0 ? { fields } : {}),
    ...(rules.length > 0 ? { rules } : {}),
  };
}

export function createForensicEvent<TBody extends Record<string, unknown> = Record<string, unknown>>(
  options: CreateForensicEventOptions<TBody>,
): ForensicEvent<TBody> {
  const tUnixMs = options.t_unix_ms ?? Date.now();
  const redactionResult = redactForensicValue(options.body ?? {}, 'body');
  const explicitRedaction = options.redaction;
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
    body: redactionResult.value as TBody,
    redaction: mergeRedaction(explicitRedaction, redactionResult),
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
  sessionId?: string;
  conversationId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
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
      session_id: context.sessionId ?? stringField(event, 'session_id'),
      conversation_id: context.conversationId ?? stringField(event, 'conversation_id'),
      trace_id: context.traceId ?? stringField(event, 'trace_id') ?? metaStringField(event, 'trace_id'),
      span_id: context.spanId ?? stringField(event, 'span_id') ?? metaStringField(event, 'span_id'),
      parent_span_id: context.parentSpanId ?? stringField(event, 'parent_span_id') ?? metaStringField(event, 'parent_span_id'),
      mcp_session_id: stringField(event, 'mcp_session_id') ?? metaStringField(event, 'mcp_session_id') ?? metaStringField(event, 'mcp.session.id'),
      jsonrpc_request_id: stringField(event, 'jsonrpc_request_id') ?? metaStringField(event, 'jsonrpc_request_id') ?? metaStringField(event, 'jsonrpc.request.id'),
      tool_call_id: typeof event.tool_call_id === 'string' ? event.tool_call_id : undefined,
      commit_sha: typeof event.commit_sha === 'string' ? event.commit_sha : undefined,
    },
    body: bodyForTimelineEvent(event),
    otel: otelForTimelineEvent(event),
    redaction: { status: redactionStatusForTimelineEvent(event) },
    t_unix_ms: event.t,
    seq: event.seq,
  });
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function metaStringField(source: Record<string, unknown>, key: string): string | undefined {
  const meta = source._meta;
  if (!meta || typeof meta !== 'object') return undefined;
  return stringField(meta as Record<string, unknown>, key);
}

function numberField(source: Record<string, unknown>, key: string): number | undefined {
  const value = Number(source[key]);
  return Number.isFinite(value) ? value : undefined;
}

function booleanField(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key];
  return typeof value === 'boolean' ? value : undefined;
}

function bodyForTimelineEvent(event: { type: string; [key: string]: unknown }): Record<string, unknown> {
  if (event.type === 'mcp') {
    return {
      legacy_timeline_event: event,
      mcp_server: stringField(event, 'mcp_server') ?? stringField(event, 'server') ?? 'unknown',
      mcp_method: stringField(event, 'mcp_method') ?? stringField(event, 'method') ?? 'tools/call',
      tool_name: stringField(event, 'tool_name') ?? stringField(event, 'tool'),
      network_transport: stringField(event, 'network_transport') ?? stringField(event, 'transport'),
      duration_ms: numberField(event, 'duration_ms'),
      error_type: stringField(event, 'error_type'),
      status_code: stringField(event, 'status_code'),
      duplicate_span_suppressed: booleanField(event, 'duplicate_span_suppressed'),
      trace_carrier: metaStringField(event, 'trace_carrier') ?? (event._meta && typeof event._meta === 'object' ? '_meta' : undefined),
    };
  }

  if (event.type === 'token_usage') {
    return {
      legacy_timeline_event: event,
      input_tokens: numberField(event, 'input_tokens') ?? numberField(event, 'input'),
      output_tokens: numberField(event, 'output_tokens') ?? numberField(event, 'output'),
      cache_read_tokens: numberField(event, 'cache_read_tokens') ?? numberField(event, 'cache_read'),
      cache_creation_tokens: numberField(event, 'cache_creation_tokens') ?? numberField(event, 'cache_creation'),
      reasoning_tokens: numberField(event, 'reasoning_tokens') ?? numberField(event, 'reasoning') ?? numberField(event, 'thinking_tokens'),
      tool_tokens: numberField(event, 'tool_tokens') ?? numberField(event, 'tool') ?? numberField(event, 'tool_use_tokens'),
      total_tokens: numberField(event, 'total_tokens') ?? numberField(event, 'total'),
      usage_source: stringField(event, 'usage_source') ?? stringField(event, 'source') ?? 'runtime_event',
    };
  }

  if (event.type === 'auto_commit_success' || event.type === 'auto_commit_skipped' || event.type === 'auto_commit_failed') {
    const committedFiles = Array.isArray(event.committed_files)
      ? event.committed_files.filter((file): file is string => typeof file === 'string')
      : [];
    return {
      legacy_timeline_event: event,
      evidence_kind: event.type === 'auto_commit_success' ? 'commit' : 'report',
      result: event.type === 'auto_commit_success' ? 'success' : event.type === 'auto_commit_failed' ? 'error' : 'skipped',
      commit_sha: stringField(event, 'commit_sha'),
      changed_paths_count: committedFiles.length,
      changed_paths: committedFiles,
      reason: stringField(event, 'reason'),
    };
  }

  if (event.type === 'command_completed' || event.type === 'command_failed') {
    return {
      legacy_timeline_event: event,
      command_kind: stringField(event, 'command_kind') ?? 'unknown',
      duration_ms: numberField(event, 'duration_ms'),
      status: event.type === 'command_completed' ? 'success' : 'error',
      command: stringField(event, 'command'),
      args: Array.isArray(event.args) ? event.args.filter((arg): arg is string => typeof arg === 'string') : undefined,
      exit_code: numberField(event, 'exit_code'),
      stderr: stringField(event, 'stderr'),
      redacted: booleanField(event, 'redacted'),
    };
  }

  if (event.type === 'review_verdict_pass' || event.type === 'review_verdict_partial' || event.type === 'review_verdict_fail' || event.type === 'review_verdict_waived') {
    return {
      legacy_timeline_event: event,
      verdict: event.type.replace('review_verdict_', ''),
      chain_template: stringField(event, 'chain_template'),
      changed_paths_count: numberField(event, 'changed_paths_count'),
      terminal_state: stringField(event, 'terminal_state'),
      result: stringField(event, 'result'),
    };
  }

  if (event.type === 'chain_ready_for_review' || event.type === 'chain_finalized') {
    return {
      legacy_timeline_event: event,
      chain_template: stringField(event, 'chain_template'),
      changed_paths_count: numberField(event, 'changed_paths_count'),
      terminal_state: stringField(event, 'terminal_state'),
      result: stringField(event, 'result'),
    };
  }

  if (event.type === 'worktree_merged') {
    return {
      legacy_timeline_event: event,
      changed_paths_count: numberField(event, 'changed_paths_count'),
      merge_ref: stringField(event, 'merge_ref'),
      source_ref: stringField(event, 'source_ref'),
      target_ref: stringField(event, 'target_ref'),
      result: stringField(event, 'result'),
    };
  }

  return { legacy_timeline_event: event };
}

function otelForTimelineEvent(event: { type: string; [key: string]: unknown }): Record<string, unknown> | undefined {
  if (event.type !== 'mcp') return undefined;
  const method = stringField(event, 'mcp_method') ?? stringField(event, 'method') ?? 'tools/call';
  return {
    'mcp.method.name': method,
    'mcp.session.id': stringField(event, 'mcp_session_id') ?? metaStringField(event, 'mcp_session_id') ?? metaStringField(event, 'mcp.session.id'),
    'jsonrpc.request.id': stringField(event, 'jsonrpc_request_id') ?? metaStringField(event, 'jsonrpc_request_id') ?? metaStringField(event, 'jsonrpc.request.id'),
    'network.transport': stringField(event, 'network_transport') ?? stringField(event, 'transport'),
    'gen_ai.operation.name': 'execute_tool',
    'gen_ai.tool.name': stringField(event, 'tool_name') ?? stringField(event, 'tool'),
  };
}

function familyForTimelineType(type: string): string {
  if (type === 'run_start' || type === 'run_complete' || type === 'status_change' || type === 'payload_breakdown') return 'job';
  if (type === 'mcp') return 'mcp';
  if (type === 'tool') return 'tool';
  if (type === 'turn' || type === 'turn_summary' || type === 'message' || type === 'text' || type === 'thinking') return 'turn';
  if (type === 'token_usage' || type === 'finish_reason' || type === 'model_change' || type === 'meta') return 'model';
  if (type === 'control_signal') return 'control';
  if (type === 'retry') return 'retry';
  if (type === 'compaction') return 'compaction';
  if (type === 'error' || type === 'extension_error') return 'error';
  if (type === 'auto_commit_success' || type === 'auto_commit_skipped' || type === 'auto_commit_failed') return 'git';
  if (type === 'command_completed' || type === 'command_failed') return 'command';
  if (type === 'review_verdict_pass' || type === 'review_verdict_partial' || type === 'review_verdict_fail' || type === 'review_verdict_waived') return 'review';
  if (type === 'chain_ready_for_review' || type === 'chain_finalized') return 'chain';
  if (type === 'worktree_merged') return 'worktree';
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
  if (event.type === 'mcp') return mcpEventNameForTimelineEvent(event);
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
  if (event.type === 'command_completed') return 'command.completed';
  if (event.type === 'command_failed') return 'command.failed';
  if (event.type === 'review_verdict_pass') return 'review.verdict.pass';
  if (event.type === 'review_verdict_partial') return 'review.verdict.partial';
  if (event.type === 'review_verdict_fail') return 'review.verdict.fail';
  if (event.type === 'review_verdict_waived') return 'review.verdict.waived';
  if (event.type === 'chain_ready_for_review') return 'chain.ready_for_review';
  if (event.type === 'chain_finalized') return 'chain.finalized';
  if (event.type === 'worktree_merged') return 'worktree.merged';
  if (event.type === 'stale_warning') return 'process_health.stale_detected';
  return `${familyForTimelineType(event.type)}.${event.type}`;
}

function mcpEventNameForTimelineEvent(event: { [key: string]: unknown }): string {
  const explicit = stringField(event, 'event_name');
  if (explicit?.startsWith('mcp.')) return explicit;

  const action = stringField(event, 'action') ?? stringField(event, 'phase') ?? stringField(event, 'status');
  if (action === 'connected') return 'mcp.connected';
  if (action === 'disconnected') return 'mcp.disconnected';
  if (action === 'auth_failed') return 'mcp.auth.failed';
  if (action === 'rate_limited') return 'mcp.rate_limited';
  if (action === 'latency_observed') return 'mcp.latency.observed';
  if (action === 'start' || action === 'started') return 'mcp.call.started';
  if (event.is_error || action === 'failed' || action === 'error') return 'mcp.call.failed';
  return 'mcp.call.completed';
}

function severityForTimelineEvent(event: { type: string; [key: string]: unknown }): ForensicSeverity {
  if (event.type === 'error' || event.type === 'extension_error' || event.type === 'auto_commit_failed' || event.type === 'command_failed') return 'error';
  if (event.type === 'mcp' && (event.is_error || mcpEventNameForTimelineEvent(event).endsWith('.failed') || mcpEventNameForTimelineEvent(event) === 'mcp.auth.failed')) return 'error';
  if (event.type === 'mcp' && mcpEventNameForTimelineEvent(event) === 'mcp.rate_limited') return 'warn';
  if (event.type === 'stale_warning' || event.type === 'control_signal') return 'warn';
  if (event.type === 'run_complete' && event.status === 'ERROR') return 'error';
  if (event.type === 'tool' && event.is_error) return 'error';
  return 'info';
}

function redactionStatusForTimelineEvent(event: { type: string; [key: string]: unknown }): RedactionStatus {
  if (event.type === 'tool' || event.type === 'turn_summary' || event.type === 'run_complete' || event.type === 'command_completed' || event.type === 'command_failed' || event.type === 'review_verdict_pass' || event.type === 'review_verdict_partial' || event.type === 'review_verdict_fail' || event.type === 'review_verdict_waived' || event.type === 'chain_ready_for_review' || event.type === 'chain_finalized' || event.type === 'worktree_merged') return 'redacted';
  return 'clean';
}
