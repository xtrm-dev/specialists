// XTRM-96: UI-neutral observability projections over the canonical persisted store.
//
// This module owns no runtime truth. observability.db remains authoritative for
// persisted state; live NativeActivationHost snapshots may annotate the resulting
// presentation in the Pi extension but never replace these projections.
//
// Redaction invariant: normal chronology rows are rendered exclusively through
// forensicEventToRow(). DETAIL only reads an explicit allowlist of fields from
// already-redacted persisted events.

import type { ForensicEvent, ForensicSpawnedByLink, ForensicRootRuntimeOrigin } from './forensic-events.js';
import { forensicEventToRow, type RenderedRow } from './forensic-renderer.js';
import { isForensicAgentInternal } from './forensic-presentation.js';
import {
  reconstructLineage,
  type ReconstructedJobNode,
  type ReconstructedLineage,
} from './runtime-origin-reconstruct.js';
import type {
  ForensicEventRecord,
  ListForensicEventsFilters,
  ListStatusesWindowFilters,
  ObservabilitySqliteClient,
} from './observability-sqlite.js';
import type { SessionRunMetrics } from './session-metrics-contract.js';
import type { SupervisorStatus } from './status-contract.js';

const DEFAULT_CHRONOLOGY_LIMIT = 200;
const MAX_CHRONOLOGY_LIMIT = 2_000;
const MAX_READ_AHEAD_FACTOR = 4;
const MAX_FLEET_JOBS = 500;
const DEFAULT_FLEET_JOBS = 100;
const INSPECT_EVENT_LIMIT = 1_000;

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

export function parseForensicRecord(record: ForensicEventRecord): ParsedForensicRecord | null {
  try {
    const event = JSON.parse(record.event_json) as ForensicEvent;
    if (!event || typeof event !== 'object') return null;
    if (typeof event.t_unix_ms !== 'number') return null;
    if (typeof event.event_family !== 'string' || typeof event.event_name !== 'string') return null;
    if (!event.correlation || typeof event.correlation !== 'object') return null;
    if (!event.resource || typeof event.resource !== 'object') return null;
    if (!event.body || typeof event.body !== 'object') return null;
    if (!event.redaction || typeof event.redaction !== 'object') return null;
    return { record, event };
  } catch {
    return null;
  }
}

export function parseForensicRecords(records: readonly ForensicEventRecord[]): {
  parsed: ParsedForensicRecord[];
  invalidRecords: number;
} {
  const parsed: ParsedForensicRecord[] = [];
  let invalidRecords = 0;
  for (const record of records) {
    const value = parseForensicRecord(record);
    if (value) parsed.push(value);
    else invalidRecords += 1;
  }
  parsed.sort((a, b) => a.record.seq - b.record.seq || a.record.id - b.record.id);
  return { parsed, invalidRecords };
}

/**
 * Read one bounded forensic LOG page. Follow mode is seq-based at the SQLite
 * boundary; timestamps are display/filter metadata only.
 */
export function readForensicWindow(
  source: ObservabilityReadSource,
  options: ReadForensicWindowOptions,
): ForensicWindow {
  const limit = clamp(options.limit ?? DEFAULT_CHRONOLOGY_LIMIT, 1, MAX_CHRONOLOGY_LIMIT);
  let readAhead = options.allEvents
    ? Math.min(MAX_CHRONOLOGY_LIMIT, limit + 1)
    : Math.min(MAX_CHRONOLOGY_LIMIT, Math.max(limit + 1, limit * MAX_READ_AHEAD_FACTOR));
  let raw: ForensicEventRecord[] = [];
  let visible: ParsedForensicRecord[] = [];
  let invalidRecords = 0;

  while (true) {
    raw = source.readForensicEvents({
      jobId: options.jobId,
      ...(options.after ? { afterSeq: options.after.seq } : {}),
      ...(options.attemptId ? { attemptId: options.attemptId } : {}),
      limit: readAhead,
      order: options.after ? 'asc' : 'desc',
    });
    const parsedResult = parseForensicRecords(raw);
    invalidRecords = parsedResult.invalidRecords;
    visible = options.allEvents
      ? parsedResult.parsed
      : parsedResult.parsed.filter(({ event }) => !isForensicAgentInternal(event));

    const storageExhausted = raw.length < readAhead;
    if (visible.length >= limit || storageExhausted || readAhead >= MAX_CHRONOLOGY_LIMIT) break;
    readAhead = Math.min(MAX_CHRONOLOGY_LIMIT, readAhead * 2);
  }

  const page = options.after ? visible.slice(0, limit) : visible.slice(-limit);
  const last = page[page.length - 1];
  return {
    events: page.map(({ event }) => event),
    rows: page.map(({ event }) => forensicEventToRow(event)),
    ...(last ? { cursor: { seq: last.record.seq } } : {}),
    invalidRecords,
    hasMore: visible.length > page.length || raw.length >= readAhead,
  };
}

export function readFleetSnapshot(
  source: ObservabilityReadSource,
  options: ReadFleetOptions = {},
): FleetSnapshot {
  const limit = clamp(options.limit ?? DEFAULT_FLEET_JOBS, 1, MAX_FLEET_JOBS);
  const statuses = source.listStatusesWindow({
    limit,
    ...(options.sinceMs !== undefined ? { sinceMs: options.sinceMs } : {}),
    ...(options.statuses ? { statuses: options.statuses } : {}),
  });

  const lineageRecords = source.readForensicEvents({
    eventName: 'job.started',
    ...(options.sinceMs !== undefined ? { sinceMs: options.sinceMs } : {}),
    limit: Math.min(2_000, Math.max(limit * 4, limit + 1)),
    order: 'desc',
  });
  const parsedLineage = parseForensicRecords(lineageRecords);
  const lineage = reconstructLineage(parsedLineage.parsed.map(({ event }) => event));

  const byId = new Map<string, FleetNode>();
  for (const status of statuses) {
    if (!status?.id || !status.specialist) continue;
    const lineageNode = lineage.get(status.id);
    const native = status.id.startsWith('act:');
    const state = native && (status.status === 'running' || status.status === 'starting')
      ? 'active'
      : status.status;
    const warning = status.current_event === 'stale_warning';
    const node: FleetNode = {
      jobId: status.id,
      specialist: status.specialist,
      ...(status.bead_id ? { beadId: status.bead_id } : {}),
      state,
      attention: warning ? 'warning' : attentionFor(state),
      native,
      ...(status.current_event ? { currentEvent: status.current_event } : {}),
      ...(status.current_tool ? { currentTool: status.current_tool } : {}),
      startedAtMs: status.started_at_ms,
      lastEventAtMs: status.last_event_at_ms ?? status.started_at_ms,
      ...(lineageNode?.parent_job_id ? { parentJobId: lineageNode.parent_job_id } : {}),
      children: [],
      ...(lineageNode ? { lineage: lineageNode } : {}),
      ...attachmentProjection(lineageNode),
    };
    byId.set(node.jobId, node);
  }

  for (const node of byId.values()) {
    if (!node.parentJobId) continue;
    const parent = byId.get(node.parentJobId);
    if (parent) parent.children.push(node.jobId);
  }
  for (const node of byId.values()) {
    node.children.sort((a, b) => nodeSort(byId.get(a), byId.get(b)));
  }

  const nodes = [...byId.values()].sort(nodeSort);
  const roots = nodes
    .filter((node) => !node.parentJobId || !byId.has(node.parentJobId))
    .map((node) => node.jobId);
  return {
    generatedAtMs: Date.now(),
    nodes,
    byId,
    roots,
    lineage,
    invalidRecords: parsedLineage.invalidRecords,
    counts: {
      total: nodes.length,
      active: nodes.filter((node) => node.attention === 'active').length,
      waiting: nodes.filter((node) => node.attention === 'blocked').length,
      warning: nodes.filter((node) => node.attention === 'warning').length,
      failed: nodes.filter((node) => node.attention === 'failed').length,
      settled: nodes.filter((node) => node.attention === 'settled').length,
    },
  };
}

/**
 * Result storage remains activation-level. If an exact attempt is requested we
 * first prove that attempt exists in durable forensic history, matching current
 * sp result fail-closed semantics, then return the activation's persisted result.
 */
export function readResultProjection(
  source: ObservabilityReadSource,
  ref: { jobId: string; attemptId?: string },
): ResultProjection {
  if (ref.attemptId) {
    const proof = source.readForensicEvents({
      jobId: ref.jobId,
      attemptId: ref.attemptId,
      limit: 1,
      order: 'asc',
    });
    if (proof.length === 0) {
      return {
        jobId: ref.jobId,
        attemptId: ref.attemptId,
        attemptVerified: false,
        output: null,
        available: false,
        error: `Cannot verify attempt '${ref.attemptId}' for activation '${ref.jobId}' from forensic history`,
      };
    }
  }
  const output = source.readResult(ref.jobId);
  return {
    jobId: ref.jobId,
    ...(ref.attemptId ? { attemptId: ref.attemptId } : {}),
    attemptVerified: true,
    output,
    available: output !== null,
  };
}

export function readActivationInspect(source: ObservabilityReadSource, jobId: string): ActivationInspect | null {
  const status = source.readStatus(jobId);
  if (!status) return null;

  const records = source.readForensicEvents({ jobId, limit: INSPECT_EVENT_LIMIT, order: 'desc' });
  const { parsed } = parseForensicRecords(records);
  const attempts = source.listForensicAttemptIds(jobId);

  const latest = parsed[parsed.length - 1]?.event;
  const admitted = [...parsed]
    .reverse()
    .find(({ event }) => event.event_name === 'control.activation_admitted.recorded')?.event;
  const admittedEnvelope = admitted?.body ?? {};
  const admittedBody = recordBodyField(admittedEnvelope, 'legacy_timeline_event') ?? admittedEnvelope;
  const startRows = source.readForensicEvents({ jobId, eventName: 'job.started', limit: 1, order: 'asc' });
  const startEvents = parseForensicRecords(startRows).parsed.map(({ event }) => event);
  const lineage = reconstructLineage(startEvents);
  const lineageNode = lineage.get(jobId);

  return {
    jobId,
    specialist: status.specialist,
    ...(status.bead_id ? { beadId: status.bead_id } : {}),
    state: status.status,
    ...(status.current_event ? { currentEvent: status.current_event } : {}),
    ...(status.current_tool ? { currentTool: status.current_tool } : {}),
    ...(status.model ? { model: status.model } : {}),
    ...(status.backend ? { backend: status.backend } : {}),
    attempts,
    ...(attempts.length > 0 ? { latestAttemptId: attempts[attempts.length - 1] } : {}),
    ...stringBodyField(admittedBody, 'configured_model', 'configuredModel'),
    ...stringBodyField(admittedBody, 'requested_model', 'requestedModel'),
    ...stringBodyField(admittedBody, 'resolved_model', 'resolvedModel'),
    ...(typeof admittedBody.model_override === 'boolean' ? { modelOverride: admittedBody.model_override } : {}),
    ...stringBodyField(admittedBody, 'thinking_level', 'thinkingLevel'),
    ...(typeof latest?.correlation.pi_session_id === 'string' ? { piSessionId: latest.correlation.pi_session_id } : {}),
    ...(typeof latest?.correlation.workspace_id === 'string' ? { workspaceId: latest.correlation.workspace_id } : {}),
    ...(typeof latest?.correlation.trace_id === 'string' ? { traceId: latest.correlation.trace_id } : {}),
    ...(typeof latest?.correlation.span_id === 'string' ? { spanId: latest.correlation.span_id } : {}),
    ...(typeof latest?.correlation.parent_span_id === 'string' ? { parentSpanId: latest.correlation.parent_span_id } : {}),
    ...(status.metrics ? { metrics: status.metrics } : {}),
    ...(typeof status.context_pct === 'number' ? { contextPct: status.context_pct } : {}),
    ...(status.context_pct_source ? { contextPctSource: status.context_pct_source } : {}),
    ...(status.worktree_path ? { worktreePath: status.worktree_path } : {}),
    ...(status.branch ? { branch: status.branch } : {}),
    ...(lineageNode?.parent_job_id ? { parentJobId: lineageNode.parent_job_id } : {}),
    ...attachmentProjection(lineageNode),
  };
}

export function asObservabilityReadSource(client: ObservabilitySqliteClient): ObservabilityReadSource {
  return client;
}

function recordBodyField(body: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = body[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringBodyField<K extends string>(
  body: Record<string, unknown>,
  sourceKey: string,
  targetKey: K,
): Partial<Record<K, string>> {
  const value = body[sourceKey];
  return typeof value === 'string' && value.length > 0 ? { [targetKey]: value } as Partial<Record<K, string>> : {};
}

function attentionFor(state: string): FleetAttention {
  const normalized = state.toLowerCase();
  if (normalized === 'waiting' || normalized === 'blocked' || normalized === 'needs_reply' || normalized === 'escalated') return 'blocked';
  if (['error', 'failed', 'rejected', 'cancelled', 'canceled', 'stopped'].includes(normalized)) return 'failed';
  if (['done', 'completed', 'settled', 'disposed'].includes(normalized)) return 'settled';
  if (['starting', 'running', 'active', 'admitted', 'requested', 'stopping', 'uncertain'].includes(normalized)) return 'active';
  return 'idle';
}

function attachmentProjection(node: ReconstructedJobNode | undefined): { attachment?: RuntimeAttachment } {
  if (!node) return {};
  const direct = attachmentFromSpawnedBy(node.spawned_by);
  if (direct) return { attachment: direct };
  const root = attachmentFromRoot(node.root_runtime_origin);
  return root ? { attachment: root } : {};
}

function attachmentFromSpawnedBy(link: ForensicSpawnedByLink | undefined): RuntimeAttachment | undefined {
  if (!link || link.kind !== 'xtmux.agent_instance') return undefined;
  return {
    kind: 'xtmux.agent_instance',
    hostId: link.host_id,
    paneId: link.tmux_pane_id,
    sessionId: link.tmux_session_id,
    windowId: link.tmux_window_id,
    ...(link.agent_instance_id ? { agentInstanceId: link.agent_instance_id } : {}),
    direct: true,
  };
}

function attachmentFromRoot(origin: ForensicRootRuntimeOrigin | undefined): RuntimeAttachment | undefined {
  if (!origin) return undefined;
  return {
    kind: 'xtmux.agent_instance',
    hostId: origin.host_id,
    paneId: origin.tmux_pane_id,
    ...(origin.agent_instance_id ? { agentInstanceId: origin.agent_instance_id } : {}),
    direct: false,
  };
}

function nodeSort(a: FleetNode | undefined, b: FleetNode | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const priority = (node: FleetNode): number => {
    if (node.attention === 'blocked') return 6;
    if (node.attention === 'failed') return 5;
    if (node.attention === 'warning') return 4;
    if (node.attention === 'active') return 3;
    if (node.attention === 'settled') return 2;
    return 1;
  };
  return priority(b) - priority(a)
    || (b.lastEventAtMs ?? 0) - (a.lastEventAtMs ?? 0)
    || a.jobId.localeCompare(b.jobId);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}
