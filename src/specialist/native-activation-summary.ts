// unitAI-rrdnt.47: last-known summaries of native activations for the CLI.
// XTRM-93 N2B: native activations are re-projected onto the SHARED timeline
// vocabulary (families job/control/turn/model/tool/retry, e.g. job.started,
// turn.summarized, tool.call.completed) and distinguished ONLY by job_id
// identity (the act: id space). There is no native-specific event family;
// the retired activation.* parallel vocabulary (event_family='activation',
// written until 2026-09-08) survives only as historical rows. Everything
// here is therefore LAST-KNOWN state: a crashed host stops writing without
// a terminal event, so absence of a terminal event must never be rendered as
// "running". Callers must label the output accordingly.
import type { ForensicEventRecord } from './observability-sqlite.js';

export interface NativeActivationSummary {
  activation_id: string;
  specialist: string;
  bead_id?: string;
  /** Last-known lifecycle state derived from the latest forensic event. */
  state: string;
  last_event: string;
  last_event_at_ms: number;
  first_event_at_ms: number;
  /** Window-scoped row count: rows for this activation within the selection
   * window, NOT a lifetime total across unselected history. XTRM-93 N3
   * (unitAI-kmbb9): the ps selection is activation-bounded (latest 20
   * activations, all of each one's events), so the window spans each selected
   * activation's full history within --since. Named window_* so consumers
   * cannot mistake it for a table total. */
  window_event_count: number;
  /** Window-scoped turn count (turn.summarized in window), NOT a lifetime total. See below. */
  window_turns: number;
  pi_session_id?: string;
  /** Error / stop reason for failed or disposed activations. */
  detail?: string;
}

/** Derive waiting/running from a job.status_changed payload. The writer emits
 * status_change with body.legacy_timeline_event.status (vocabulary-unconstrained;
 * all 182 native rows to date carry status:"waiting", previous_status:"running").
 * waiting -> "waiting" (parked, resumable; NOT settled, NOT running).
 * running -> "active" (crashed-host contract: absence of a terminal event must
 * never render as live "running", even when the last transition says running).
 * Unrecognised/missing status -> "unknown" (honest; never running/settled). */
function statusFromStatusChangePayload(eventJson: string | undefined): string {
  try {
    const parsed = JSON.parse(eventJson ?? '') as {
      body?: { legacy_timeline_event?: { status?: unknown } };
    };
    const status = parsed.body?.legacy_timeline_event?.status;
    if (status === 'waiting') return 'waiting';
    if (status === 'running') return 'active';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Latest-event wins. Producer name set derived from
 * forensic-events.ts eventNameForTimelineEvent (:832) + familyForTimelineType (:813).
 * Historical activation.* fallback preserved (retired vocab, do not change).
 * Shared mid-flight signals map to last-known 'active', never 'running'.
 * Shared failure/error names map to 'failed', never 'active'.
 * Anything else shared/ancillary (review/chain/worktree/process_health,
 * unexpected mcp.* passthrough, future names) maps to 'unknown', never 'active'. */
function stateForEventName(eventName: string, eventJson?: string): string {
  const short = eventName.startsWith('activation.') ? eventName.slice('activation.'.length) : eventName;
  switch (short) {
    case 'activation_requested': return 'requested';
    case 'activation_admitted': return 'admitted';
    case 'activation_starting':
    case 'step_contract_compiled': return 'starting';
    case 'activation_started':
    case 'turn_started':
    case 'turn_completed':
    case 'output_validation_started':
    case 'output_validation_passed': return 'active';
    case 'activation_settled': return 'settled';
    case 'activation_completed': return 'completed';
    case 'activation_failed': return 'failed';
    case 'activation_disposed': return 'disposed';
    case 'activation_rejected': return 'rejected';
    case 'job.completed': return 'completed';
    case 'job.failed': return 'failed';
    case 'job.cancelled': return 'cancelled';
    case 'job.started': return 'active';
    case 'job.status_changed': return statusFromStatusChangePayload(eventJson);
    case 'control.lease_acquired.recorded': return 'admitted';
    case 'control.lease_denied.recorded': return 'rejected';
    case 'control.lease_uncertain.recorded': return 'starting';
    // Explicit failures (producer eventNameForTimelineEvent): never 'active'.
    case 'tool.call.failed':
    case 'error.rpc':
    case 'error.extension':
    case 'command.failed':
    case 'mcp.call.failed':
    case 'mcp.auth.failed':
    case 'git.auto_commit.failed':
    case 'review.verdict.fail':
      return 'failed';
    // Explicit mid-flight (producer families): last-known 'active'.
    case 'tool.call.started':
    case 'tool.call.completed':
    case 'turn.turn':
    case 'turn.message':
    case 'turn.text':
    case 'turn.thinking':
    case 'turn.summarized':
    case 'model.meta':
    case 'model.token_usage.recorded':
    case 'model.finish_reason.recorded':
    case 'model.changed':
    case 'retry.start':
    case 'retry.end':
    case 'compaction.start':
    case 'compaction.end':
    case 'mcp.connected':
    case 'mcp.disconnected':
    case 'mcp.rate_limited':
    case 'mcp.latency.observed':
    case 'mcp.call.started':
    case 'mcp.call.completed':
    case 'git.auto_commit.succeeded':
    case 'git.auto_commit.skipped':
    case 'command.completed':
      return 'active';
    default: break;
  }
  if (eventName.startsWith('activation.')) return short;
  // Non-terminal job/control signals outside the explicit lists
  // (e.g. job.payload_breakdown, control.tool_blocked.recorded): active, never running.
  if (eventName.startsWith('job.') || eventName.startsWith('control.')) return 'active';
  return 'unknown';
}

interface ParsedBody {
  bead_id?: string;
  pi_session_id?: string;
  error?: string;
  stop_reason?: string;
  reason?: string;
}

function parseBody(eventJson: string): ParsedBody {
  try {
    const parsed = JSON.parse(eventJson) as {
      correlation?: { bead_id?: unknown; pi_session_id?: unknown };
      body?: { pi_session_id?: unknown; error?: unknown; stop_reason?: unknown; reason?: unknown };
    };
    const out: ParsedBody = {};
    if (typeof parsed.correlation?.bead_id === 'string') out.bead_id = parsed.correlation.bead_id;
    if (typeof parsed.correlation?.pi_session_id === 'string') out.pi_session_id = parsed.correlation.pi_session_id;
    else if (typeof parsed.body?.pi_session_id === 'string') out.pi_session_id = parsed.body.pi_session_id;
    if (typeof parsed.body?.error === 'string') out.error = parsed.body.error;
    if (typeof parsed.body?.stop_reason === 'string') out.stop_reason = parsed.body.stop_reason;
    if (typeof parsed.body?.reason === 'string') out.reason = parsed.body.reason;
    return out;
  } catch {
    return {};
  }
}

/**
 * Group forensic activation rows by job (activation) id and derive one
 * last-known summary per activation, newest first. Pure: takes rows, returns
 * summaries. Rows are expected from the activation-first selection in
 * src/cli/ps.ts (listNativeActivationIds to pick the latest-N act: ids from
 * specialist_jobs, then readForensicEventsForActivations for their events),
 * but any order is tolerated —
 * latest is picked by (t, seq).
 */
export function summarizeNativeActivations(rows: readonly ForensicEventRecord[]): NativeActivationSummary[] {
  const byId = new Map<string, ForensicEventRecord[]>();
  for (const row of rows) {
    if (!row.job_id) continue;
    const group = byId.get(row.job_id) ?? [];
    group.push(row);
    byId.set(row.job_id, group);
  }

  const summaries: NativeActivationSummary[] = [];
  for (const [activationId, events] of byId.entries()) {
    const ordered = [...events].sort((a, b) => a.t - b.t || a.seq - b.seq);
    const first = ordered[0]!;
    const last = ordered[ordered.length - 1]!;
    const bodies = ordered.map((event) => parseBody(event.event_json));
    const beadId = [...bodies.map((b) => b.bead_id)].find((v): v is string => typeof v === 'string');
    const piSessionId = [...bodies.map((b) => b.pi_session_id)].find((v): v is string => typeof v === 'string');
    const lastBody = bodies[bodies.length - 1]!;
    const detail = lastBody.error
      ?? (lastBody.stop_reason ? `stop_reason=${lastBody.stop_reason}` : undefined)
      ?? lastBody.reason;
    const role = last.participant_role?.trim();
    summaries.push({
      activation_id: activationId,
      specialist: role && role.length > 0 ? role : 'unknown',
      ...(beadId ? { bead_id: beadId } : {}),
      state: stateForEventName(last.event_name, last.event_json),
      last_event: last.event_name,
      last_event_at_ms: last.t,
      first_event_at_ms: first.t,
      window_event_count: ordered.length,
      // LOW: turn.turn is start+end (2 rows per turn via the producer fallback
      // forensic-events.ts:832/:813; measured act:51b 207 turn.turn vs 104
      // turn.summarized). turn.summarized is 1 per completed turn and is the
      // correct turn signal; turn.turn is excluded deliberately to avoid
      // double-counting. Historical activation.turn_started kept for retired rows.
      window_turns: ordered.filter((event) => event.event_name === 'activation.turn_started' || event.event_name === 'turn.summarized').length,
      ...(piSessionId ? { pi_session_id: piSessionId } : {}),
      ...(detail ? { detail } : {}),
    });
  }

  summaries.sort((a, b) => b.last_event_at_ms - a.last_event_at_ms);
  return summaries;
}

export function formatActivationAge(nowMs: number, atMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - atMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
