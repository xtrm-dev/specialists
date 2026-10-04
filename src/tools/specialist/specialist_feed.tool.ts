// src/tools/specialist/specialist_feed.tool.ts
import * as z from 'zod';
import type { NativeActivationHost } from '../../activation/native-host.js';
import { createObservabilitySqliteClient, type ObservabilitySqliteClient } from '../../specialist/observability-sqlite.js';
import type { TimelineEvent } from '../../specialist/timeline-events.js';

export const FEED_DEFAULT_LIMIT = 40;
export const FEED_MAX_LIMIT = 200;
/** One feed line never exceeds this, whatever a tool argument or text block held. */
export const FEED_LINE_MAX = 200;

export const specialistFeedSchema = z.object({
  activation_id: z.string().min(1).describe(
    "Activation id: the full id or a unique short prefix, e.g. 'act:a2924153' or 'a2924153'.",
  ),
  view: z.enum(['terminal', 'forensic']).optional().describe(
    "'terminal' (default): what the specialist did — tool calls, text, turns, status, completion — " +
    "one line each, like `sp feed`. 'forensic': every recorded lifecycle event name.",
  ),
  since_seq: z.number().int().min(0).optional().describe(
    'Only events with a sequence number above this. Pass the previous call\'s last_seq to follow a running activation.',
  ),
  limit: z.number().int().min(1).max(FEED_MAX_LIMIT).optional().describe(
    `Newest events to return (default ${FEED_DEFAULT_LIMIT}, max ${FEED_MAX_LIMIT}).`,
  ),
});

type FeedInput = z.infer<typeof specialistFeedSchema>;

const flat = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim();
const clip = (text: string, max = FEED_LINE_MAX) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

function clock(t: number): string {
  const d = new Date(t);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

/** The argument a reader recognises a tool call by: a path, a command, a query. */
function argSummary(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  for (const key of ['path', 'file_path', 'command', 'query', 'pattern', 'target', 'name', 'url']) {
    if (typeof args[key] === 'string' && args[key]) return flat(args[key]);
  }
  const first = Object.values(args).find(v => typeof v === 'string' && v);
  return first ? flat(first) : '';
}

function tokens(usage: { input_tokens?: number; output_tokens?: number; cache_read_tokens?: number; cache_creation_tokens?: number } | undefined): string {
  if (!usage) return '';
  const total = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_read_tokens ?? 0) + (usage.cache_creation_tokens ?? 0);
  if (total <= 0) return '';
  return total < 1000 ? `${total} tok` : `${(total / 1000).toFixed(total < 10000 ? 1 : 0)}k tok`;
}

/**
 * One terminal-view line for an event, or null for an event the terminal view hides.
 *
 * Hidden on purpose, as `sp feed` hides them: message/turn boundaries, per-message token
 * and finish-reason records, tool `update` phases and settlement bookkeeping. They are
 * all present in the forensic view.
 */
export function feedLine(event: TimelineEvent): string | null {
  const head = `${clock(event.t)} #${event.seq ?? '?'}`;
  switch (event.type) {
    case 'run_start':
      return `${head} start   ${event.specialist}${event.bead_id ? ` on ${event.bead_id}` : ''}`;
    case 'meta':
      return `${head} model   ${event.model}`;
    case 'tool': {
      if (event.phase === 'update') return null;
      const arg = argSummary(event.args);
      if (event.phase === 'start') return clip(`${head} tool    ${event.tool}${arg ? ` ${arg}` : ''}`);
      const mark = event.is_error ? '✕' : '✓';
      const summary = flat(event.result_summary);
      return clip(`${head} tool ${mark}  ${event.tool}${summary ? ` · ${summary}` : ''}`);
    }
    case 'text': {
      const body = flat(event.content);
      return body ? clip(`${head} text    ${body}`) : null;
    }
    case 'turn_summary': {
      const parts = [`turn ${event.turn_index}`, tokens(event.token_usage), event.finish_reason, event.context_pct !== undefined ? `ctx ${Math.round(event.context_pct)}%` : '']
        .filter(Boolean);
      return `${head} turn    ${parts.join(' · ')}`;
    }
    case 'status_change':
      return `${head} status  ${event.previous_status ? `${event.previous_status} → ` : ''}${event.status}`;
    case 'control_signal': {
      const why = flat(event.reason ?? event.error_message ?? event.message_preview ?? '');
      return clip(`${head} control ${event.action}${why ? ` · ${why}` : ''}`);
    }
    case 'run_complete': {
      const elapsed = event.elapsed_s < 10 ? event.elapsed_s.toFixed(1) : String(Math.round(event.elapsed_s));
      const parts = [event.status, `${elapsed}s`, tokens(event.token_usage), event.tool_calls ? `${event.tool_calls.length} tool calls` : '', event.error ? flat(event.error) : '']
        .filter(Boolean);
      return clip(`${head} done    ${parts.join(' · ')}`);
    }
    default:
      return null;
  }
}

function normalize(raw: string): string {
  const id = raw.trim();
  return id.startsWith('act:') ? id : `act:${id}`;
}

/**
 * An activation's event feed — the `sp feed` view for a coordinator.
 *
 * Reads the durable observability.db timeline the forensic sink writes for every native
 * activation, so it answers for a running activation, a settled one and one from an earlier
 * session alike. Bounded: the newest `limit` events, each line capped at FEED_LINE_MAX.
 * `last_seq` is the cursor for the next call.
 */
export function createSpecialistFeedTool(
  getHost?: () => NativeActivationHost | undefined,
  openObservability: () => ObservabilitySqliteClient | null = () => createObservabilitySqliteClient(),
) {
  return {
    name: 'specialist_feed' as const,
    description:
      "Read one activation's event feed, like `sp feed`: tool calls, text, turns, status changes and completion " +
      "(view 'terminal', default), or every lifecycle event (view 'forensic'). Works on running, settled and " +
      'earlier-session activations. Pass since_seq (the last call\'s last_seq) to follow a running one.',
    inputSchema: specialistFeedSchema,
    async execute(input: FeedInput) {
      const wanted = normalize(input.activation_id);
      const view = input.view ?? 'terminal';
      // Clamped here, not only by the zod schema: the Pi extension calls execute() directly,
      // and a limit of 0 would make slice(-0) return every line, unbounded.
      const wantedLimit = Number.isFinite(input.limit) ? Math.floor(input.limit as number) : FEED_DEFAULT_LIMIT;
      const limit = Math.min(Math.max(wantedLimit, 1), FEED_MAX_LIMIT);

      let client: ObservabilitySqliteClient | null = null;
      try {
        client = openObservability();
        if (!client) return { status: 'error' as const, error: 'observability.db is unavailable; specialist_status still answers for live activations' };

        const live = (getHost?.()?.list() ?? []).map(s => s.activationId);
        const known = new Set<string>([...live, ...client.listNativeActivationIds({ limit: 500 })]);
        const matches = known.has(wanted) ? [wanted] : [...known].filter(id => id.startsWith(wanted)).sort();
        if (matches.length > 1) {
          return { status: 'error' as const, error: `Ambiguous activation prefix: ${input.activation_id}`, candidates: matches.slice(0, 10) };
        }
        const id = matches[0] ?? wanted;
        const since = input.since_seq ?? -1;

        if (view === 'forensic') {
          const rows = client.readForensicEvents({ jobId: id, limit: 5000 }).filter(r => r.seq > since);
          if (rows.length === 0 && since < 0) return { status: 'error' as const, error: `No events for activation: ${input.activation_id}` };
          const shown = rows.slice(-limit);
          return {
            activation_id: id,
            view,
            events: shown.map(r => `${clock(r.t)} #${r.seq} ${r.event_name}`),
            last_seq: shown.at(-1)?.seq ?? since,
            total: rows.length,
            truncated: rows.length > shown.length,
          };
        }

        const all = client.readEvents(id);
        if (all.length === 0 && since < 0) return { status: 'error' as const, error: `No events for activation: ${input.activation_id}` };
        const lines: Array<{ seq: number; line: string }> = [];
        for (const event of all) {
          if ((event.seq ?? 0) <= since) continue;
          const line = feedLine(event);
          if (line) lines.push({ seq: event.seq ?? 0, line });
        }
        const shown = lines.slice(-limit);
        const lastSeq = all.reduce((n, e) => Math.max(n, e.seq ?? 0), since);
        return {
          activation_id: id,
          view,
          events: shown.map(l => l.line),
          last_seq: lastSeq,
          total: lines.length,
          truncated: lines.length > shown.length,
        };
      } catch (error) {
        return { status: 'error' as const, error: `feed unreadable: ${error instanceof Error ? error.message : String(error)}` };
      } finally {
        try { client?.close(); } catch { /* ignore */ }
      }
    },
  };
}
