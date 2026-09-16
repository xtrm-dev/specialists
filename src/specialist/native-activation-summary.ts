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
  event_count: number;
  turns: number;
  pi_session_id?: string;
  /** Error / stop reason for failed or disposed activations. */
  detail?: string;
}

/** Latest-event wins; unknown historical names fall back to the raw suffix.
 * Shared-timeline mid-flight signals (turn/tool/model/retry/...) map to
 * last-known 'active', never 'running' (crashed-host contract). */
function stateForEventName(eventName: string): string {
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
    case 'job.status_changed': return 'settled';
    case 'control.lease_acquired.recorded': return 'admitted';
    case 'control.lease_denied.recorded': return 'rejected';
    case 'control.lease_uncertain.recorded': return 'starting';
    default: break;
  }
  if (eventName.startsWith('activation.')) return short;
  if (eventName.includes('.')) return 'active';
  return short;
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
 * summaries. Rows are expected from readForensicEvents({jobIdPrefix: 'act:',
 * order: 'desc'}) over the shared families, but any order is tolerated —
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
      state: stateForEventName(last.event_name),
      last_event: last.event_name,
      last_event_at_ms: last.t,
      first_event_at_ms: first.t,
      event_count: ordered.length,
      turns: ordered.filter((event) => event.event_name === 'activation.turn_started' || event.event_name === 'turn.summarized').length,
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
