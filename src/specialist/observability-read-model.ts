// XTRM-96: UI-neutral observability projections over the canonical persisted store.
//
// This module deliberately owns no runtime state. `observability.db` remains the
// source of truth; callers (sp console, the native Pi overlay, future TUI surfaces)
// receive bounded projections that can be reconstructed after process restart.
//
// Redaction invariant: normal chronology rows are rendered exclusively through
// `forensicEventToRow`. Callers must not decorate them with arbitrary event.body
// fields or they would bypass the xtrm.forensic.v1 redaction contract.

import type { ForensicEvent, ForensicSpawnedByLink, ForensicRootRuntimeOrigin } from './forensic-events.js';
import { forensicEventToRow, type RenderedRow } from './forensic-renderer.js';
import {
  reconstructLineage,
  type ReconstructedJobNode,
  type ReconstructedLineage,
} from './runtime-origin-reconstruct.js';
import {
  summarizeNativeActivations,
  type NativeActivationSummary,
} from './native-activation-summary.js';
import type {
  ForensicEventRecord,
  ListForensicEventsFilters,
  ListNativeActivationIdsFilters,
  ObservabilitySqliteClient,
} from './observability-sqlite.js';
import type { SupervisorStatus } from './status-contract.js';

const DEFAULT_CHRONOLOGY_LIMIT = 200;
const MAX_CHRONOLOGY_LIMIT = 2_000;
const MAX_READ_AHEAD_FACTOR = 4;
const MAX_FLEET_JOBS = 500;
const DEFAULT_FLEET_JOBS = 100;

/** Narrow dependency used by the read model and by unit tests. */
export interface ObservabilityReadSource {
  readForensicEvents(filters?: ListForensicEventsFilters): ForensicEventRecord[];
  listStatuses(): SupervisorStatus[];
  listNativeActivationIds(filters?: ListNativeActivationIdsFilters): string[];
  readForensicEventsForActivations(
    jobIds: readonly string[],
    filters?: { sinceMs?: number },
  ): ForensicEventRecord[];
  readResult(jobId: string): string | null;
}

/** A stable cursor is tuple-ordered; timestamps alone are not unique. */
export interface ForensicCursor {
  t: number;
  seq: number;
  id: number;
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
  /**
   * True when the bounded query may have more rows after the returned page.
   * Consumers should request another page before claiming they are caught up.
   */
  hasMore: boolean;
}

export interface ReadForensicWindowOptions {
  jobId: string;
  after?: ForensicCursor;
  limit?: number;
  /** Keep turn/tool/model-call noise. Default false matches `sp log`. */
  allEvents?: boolean;
}

export type FleetAttention = 'blocked' | 'failed' | 'active' | 'settled' | 'idle';

export interface RuntimeAttachment {
  kind: 'xtmux.agent_instance';
  hostId: string;
  paneId: string;
  sessionId?: string;
  windowId?: string;
  agentInstanceId?: string;
  /** true for the direct spawning pane; false for a root-only origin. */
  direct: boolean;
}

export interface FleetNode {
  jobId: string;
  specialist: string;
  beadId?: string;
  /** Persisted/last-known state. This is not a claim that a host is currently live. */
  state: string;
  attention: FleetAttention;
  startedAtMs?: number;
  lastEventAtMs?: number;
  parentJobId?: string;
  children: string[];
  attachment?: RuntimeAttachment;
  lineage?: ReconstructedJobNode;
  native?: NativeActivationSummary;
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
    failed: number;
    settled: number;
  };
}

export interface ReadFleetOptions {
  limit?: number;
  sinceMs?: number;
}

export interface ResultProjection {
  jobId: string;
  output: string | null;
  available: boolean;
}

/**
 * `sp log`'s default forensic surface intentionally hides agent-internal noise.
 * Keep the predicate UI-neutral so every operator surface can share the same
 * default LOG semantics. `allEvents` is the explicit firehose escape hatch.
 */
export function isDefaultForensicNoise(event: ForensicEvent): boolean {
  if (event.event_family === 'turn' || event.event_family === 'tool') return true;
  const name = event.event_name;
  return name === 'model.token_usage.recorded'
    || name === 'model.finish_reason.recorded'
    || name.startsWith('model.meta')
    || name === 'mcp.call.started'
    || name === 'mcp.call.completed'
    || name === 'mcp.call.failed'
    || name === 'mcp.latency.observed';
}

export function parseForensicRecord(record: ForensicEventRecord): ParsedForensicRecord | null {
  try {
    const event = JSON.parse(record.event_json) as ForensicEvent;
    if (!event || typeof event !== 'object') return null;
    if (typeof event.t_unix_ms !== 'number') return null;
    if (typeof event.event_family !== 'string' || typeof event.event_name !== 'string') return null;
    if (!event.correlation || typeof event.correlation !== 'object') return null;
    if (!event.resource || typeof event.resource !== 'object') return null;
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
  parsed.sort(compareParsedForensic);
  return { parsed, invalidRecords };
}

/**
 * Read one bounded LOG page from persisted forensic rows.
 *
 * The storage API currently exposes time filtering rather than a `(seq,id)` SQL
 * cursor. We therefore resume at `after.t`, then tuple-filter in memory. This is
 * gap-free for normal monotonic event timestamps and gives every consumer one
 * cursor contract. A future storage-level cursor can replace the query without
 * changing callers.
 */
export function readForensicWindow(
  source: ObservabilityReadSource,
  options: ReadForensicWindowOptions,
): ForensicWindow {
  const limit = clamp(options.limit ?? DEFAULT_CHRONOLOGY_LIMIT, 1, MAX_CHRONOLOGY_LIMIT);
  const readAhead = Math.min(MAX_CHRONOLOGY_LIMIT, Math.max(limit + 1, limit * MAX_READ_AHEAD_FACTOR));
  const filters: ListForensicEventsFilters = {
    jobId: options.jobId,
    limit: readAhead,
    order: options.after ? 'asc' : 'desc',
    ...(options.after ? { sinceMs: options.after.t } : {}),
  };
  const raw = source.readForensicEvents(filters);
  const { parsed, invalidRecords } = parseForensicRecords(raw);
  const fresh = options.after
    ? parsed.filter((entry) => compareCursor(cursorOf(entry), options.after!) > 0)
    : parsed;
  const visible = options.allEvents ? fresh : fresh.filter(({ event }) => !isDefaultForensicNoise(event));
  const page = options.after ? visible.slice(0, limit) : visible.slice(-limit);
  const last = page[page.length - 1];

  return {
    events: page.map(({ event }) => event),
    rows: page.map(({ event }) => forensicEventToRow(event)),
    ...(last ? { cursor: cursorOf(last) } : {}),
    invalidRecords,
    hasMore: visible.length > page.length || raw.length >= readAhead,
  };
}

/**
 * Build the persisted mixed fleet. Legacy/tmux and native/Pi activations both
 * live in specialist_jobs, while native forensic summaries refine `act:` state.
 * Lineage is reconstructed only from persisted `job.started` events.
 */
export function readFleetSnapshot(
  source: ObservabilityReadSource,
  options: ReadFleetOptions = {},
): FleetSnapshot {
  const limit = clamp(options.limit ?? DEFAULT_FLEET_JOBS, 1, MAX_FLEET_JOBS);
  const statuses = source.listStatuses()
    .filter((status) => options.sinceMs === undefined || statusTimestamp(status) >= options.sinceMs)
    .sort((a, b) => statusTimestamp(b) - statusTimestamp(a))
    .slice(0, limit);

  const lineageRecords = source.readForensicEvents({
    eventName: 'job.started',
    ...(options.sinceMs !== undefined ? { sinceMs: options.sinceMs } : {}),
    // One job.started per attempt/job in current producers; keep headroom for
    // retries/historical duplicates without turning this into an unbounded scan.
    limit: Math.min(MAX_FLEET_JOBS * 4, Math.max(limit * 4, limit + 1)),
    order: 'desc',
  });
  const parsedLineage = parseForensicRecords(lineageRecords);
  const lineageEvents = parsedLineage.parsed.map(({ event }) => event);
  const lineage = reconstructLineage(lineageEvents);

  const nativeIds = source.listNativeActivationIds({
    limit: Math.min(100, limit),
    ...(options.sinceMs !== undefined ? { sinceMs: options.sinceMs } : {}),
  });
  const nativeRows = source.readForensicEventsForActivations(
    nativeIds,
    options.sinceMs !== undefined ? { sinceMs: options.sinceMs } : {},
  );
  const nativeById = new Map(
    summarizeNativeActivations(nativeRows).map((summary) => [summary.activation_id, summary] as const),
  );

  const byId = new Map<string, FleetNode>();
  for (const status of statuses) {
    const lineageNode = lineage.get(status.id);
    const native = nativeById.get(status.id);
    const state = native?.state ?? status.status;
    const node: FleetNode = {
      jobId: status.id,
      specialist: status.specialist,
      ...(status.bead_id ? { beadId: status.bead_id } : {}),
      state,
      attention: attentionFor(state),
      startedAtMs: status.started_at_ms,
      lastEventAtMs: native?.last_event_at_ms ?? status.last_event_at_ms ?? status.started_at_ms,
      ...(lineageNode?.parent_job_id ? { parentJobId: lineageNode.parent_job_id } : {}),
      children: [],
      ...(lineageNode ? { lineage: lineageNode } : {}),
      ...(native ? { native } : {}),
      ...attachmentProjection(lineageNode),
    };
    byId.set(node.jobId, node);
  }

  // A native activation may have forensic evidence but no readable status row
  // (for example historical migration data). Keep it inspectable, but label the
  // state as last-known and never manufacture liveness.
  for (const native of nativeById.values()) {
    if (byId.has(native.activation_id)) continue;
    const lineageNode = lineage.get(native.activation_id);
    const node: FleetNode = {
      jobId: native.activation_id,
      specialist: native.specialist,
      ...(native.bead_id ? { beadId: native.bead_id } : {}),
      state: native.state,
      attention: attentionFor(native.state),
      startedAtMs: native.first_event_at_ms,
      lastEventAtMs: native.last_event_at_ms,
      ...(lineageNode?.parent_job_id ? { parentJobId: lineageNode.parent_job_id } : {}),
      children: [],
      ...(lineageNode ? { lineage: lineageNode } : {}),
      native,
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
  const roots = nodes.filter((node) => !node.parentJobId || !byId.has(node.parentJobId)).map((node) => node.jobId);
  const counts = {
    total: nodes.length,
    active: nodes.filter((node) => node.attention === 'active').length,
    waiting: nodes.filter((node) => node.attention === 'blocked').length,
    failed: nodes.filter((node) => node.attention === 'failed').length,
    settled: nodes.filter((node) => node.attention === 'settled').length,
  };

  return {
    generatedAtMs: Date.now(),
    nodes,
    byId,
    roots,
    lineage,
    invalidRecords: parsedLineage.invalidRecords,
    counts,
  };
}

export function readResultProjection(source: ObservabilityReadSource, jobId: string): ResultProjection {
  const output = source.readResult(jobId);
  return { jobId, output, available: output !== null };
}

/** Convenience adapter for production callers that already hold the full client. */
export function asObservabilityReadSource(client: ObservabilitySqliteClient): ObservabilityReadSource {
  return client;
}

function compareParsedForensic(a: ParsedForensicRecord, b: ParsedForensicRecord): number {
  return a.record.t - b.record.t || a.record.seq - b.record.seq || a.record.id - b.record.id;
}

function cursorOf(entry: ParsedForensicRecord): ForensicCursor {
  return { t: entry.record.t, seq: entry.record.seq, id: entry.record.id };
}

function compareCursor(a: ForensicCursor, b: ForensicCursor): number {
  return a.t - b.t || a.seq - b.seq || a.id - b.id;
}

function statusTimestamp(status: SupervisorStatus): number {
  return status.last_event_at_ms ?? status.started_at_ms ?? 0;
}

function attentionFor(state: string): FleetAttention {
  const normalized = state.toLowerCase();
  if (normalized === 'waiting' || normalized === 'blocked') return 'blocked';
  if (['error', 'failed', 'rejected', 'cancelled', 'canceled'].includes(normalized)) return 'failed';
  if (['done', 'completed', 'settled', 'disposed'].includes(normalized)) return 'settled';
  if (['starting', 'running', 'active', 'admitted', 'requested'].includes(normalized)) return 'active';
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
    if (node.attention === 'blocked') return 5;
    if (node.attention === 'failed') return 4;
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
