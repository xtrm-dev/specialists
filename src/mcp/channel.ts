/**
 * Claude Code Channel push — the deterministic replacement for the `.21` poller
 * (unitAI-aiwva.21).
 *
 * Claude Code registers an inbound listener for `notifications/claude/channel`
 * when a connected MCP server declares `experimental: { 'claude/channel': {} }`.
 * The notification is unsolicited: it reaches a session that is idle, which no
 * tool result can do and which is the entire reason this module exists. The
 * host already emits every transition in-process, so nothing here polls, and
 * nothing here wakes the model except on a real event.
 *
 * Three properties decide the shape, and each is enforced rather than assumed:
 *
 *   - **The push is a bounded BRIEF, never the payload.** The first line names
 *     the activation and the tool to read it with; the lines under it carry
 *     the same context a Pi wake card carries — purpose, run cost, failing
 *     model, the ask body, the error and a few result lines — each capped. The
 *     full result, contract and transcript stay in the authority store. A
 *     channel frame is rendered straight into the session's context, so an
 *     uncapped body would be an unbounded cost paid on every event (spec
 *     AD/AA); a capped brief saves the round trip the coordinator would
 *     otherwise spend just to decide whether the event matters.
 *   - **Delivery is unacknowledged and gated eight ways.** Capability, protocol
 *     era, provider, feature flag, org policy, `--channels` membership,
 *     marketplace match and plugin allowlist — each failing gate is a SILENT
 *     no-op on the client. So this is delivery, never authority: the hook and
 *     `specialist_status` recovery paths stay exactly as they are.
 *   - **Only a legacy-era connection can carry it.** Claude Code refuses to
 *     register the listener when the connection negotiated 2026-07-28,
 *     reporting "connection negotiated a modern protocol revision with no
 *     unsolicited notification path". Stateless means no server-initiated
 *     frame. `serveStdio({ legacy: 'serve' })` is therefore a PRECONDITION for
 *     push, not a compatibility concession — see the era note in
 *     `docs/claude-native-integration-spec-2026-09-09.md`.
 *
 * Verified against the Claude Code 2.1.268 binary, not documentation: the gate
 * chain, the frame shape and the meta-key filter below are what that build
 * actually enforces.
 */
import type { ActivationForensicSink } from '../activation/native-host.js';
import type { ActivationSnapshot, ActivationTokenUsage } from '../activation/types.js';
import { logger } from '../utils/logger.js';

/**
 * Declared in the server's capabilities. Presence of this key is what registers
 * the channel listener on Claude's side; the value is intentionally empty.
 */
export const CHANNEL_CAPABILITY = { 'claude/channel': {} } as const;

/** The notification method Claude Code listens for. */
export const CHANNEL_METHOD = 'notifications/claude/channel';

/**
 * Claude Code drops meta keys that fail this pattern, with a warning on its
 * side that a server author never sees. Keys are validated here so a malformed
 * one is a visible local failure instead of a silent remote omission.
 */
const META_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Host forensic events that mean a coordinator has something to act on, mapped
 * to the event class carried in the push.
 *
 * Deliberately narrow. Every other forensic name — turn boundaries, retries,
 * compaction, lease acquisition — is progress, not an actionable transition,
 * and pushing progress into an idle session is the token cost this module was
 * built to remove.
 */
const PUSHED_EVENTS: Readonly<Record<string, string>> = {
  // `activation_completed`, not `activation_settled`: the host emits both, in that order and
  // synchronously, on the same success path, but only the second carries the output the
  // brief excerpts.
  activation_completed: 'completed',
  activation_failed: 'failed',
  escalation_raised: 'escalation',
  clarification_requested: 'needs_reply',
};

/** What a coordinator is told to do about each class. One line, no result body. */
const ACTION: Readonly<Record<string, string>> = {
  completed: 'Call specialist_result for the full result.',
  failed: 'Call specialist_result for the failure detail. Use specialist_retry if the cause is transient.',
  escalation: 'Call specialist_status to read the escalation, then specialist_reply.',
  needs_reply: 'Call specialist_status to read the pending ask and message_id, then specialist_reply.',
};

export interface ChannelFrame {
  method: typeof CHANNEL_METHOD;
  params: { content: string; meta: Record<string, string> };
}

/** Sends one frame. Returns/throws are the caller's problem, never the host's. */
export type ChannelSend = (frame: ChannelFrame) => void | Promise<unknown>;

/**
 * Context a brief carries under the identity line. Every field is optional: a wake is
 * worth delivering even when the snapshot is already gone.
 */
export interface ChannelDetail {
  purpose?: string;
  elapsedS?: number;
  turnCount?: number;
  tokenUsage?: ActivationTokenUsage;
  model?: string;
  thinkingLevel?: string;
  /** The ask/escalation body, verbatim (capped). */
  body?: string;
  /** The completed activation's output; only its first lines are shown. */
  output?: string;
  /** The failure detail (capped). */
  error?: string;
}

/** Caps that keep a brief bounded whatever the Specialist wrote. */
export const BRIEF_LIMITS = {
  purpose: 120,
  body: 2000,
  error: 600,
  resultLines: 3,
  resultLine: 240,
} as const;

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** Elapsed as a short clock: 42s, 3m05s, 1h02m. */
export function formatElapsed(elapsedS: number): string {
  const total = Math.max(0, Math.floor(elapsedS));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(total / 3600)}h${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}m`;
}

/**
 * Spend as a token count. `total_tokens` is a rollup, never a summand — adding it would
 * double-count (unitAI-d99hb). Returns '' when nothing was reported, never a fabricated 0.
 */
export function formatTokens(usage: ActivationTokenUsage | undefined): string {
  if (!usage) return '';
  const total = (['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens', 'reasoning_tokens', 'tool_tokens'] as const)
    .reduce((n, k) => n + (usage[k] ?? 0), 0);
  if (total <= 0) return '';
  if (total < 1000) return `${total} tokens`;
  if (total < 10000) return `${(total / 1000).toFixed(1)}k tokens`;
  return `${Math.round(total / 1000)}k tokens`;
}

/** The snapshot facts a brief reads — the same ones `specialist_status` projects. */
export function snapshotDetail(snapshot: ActivationSnapshot | undefined, nowMs: number = Date.now()): ChannelDetail {
  if (!snapshot) return {};
  return {
    ...(snapshot.purpose ? { purpose: snapshot.purpose } : {}),
    elapsedS: Math.max(0, Math.floor((nowMs - snapshot.startedAt) / 1000)),
    ...(snapshot.turnCount !== undefined ? { turnCount: snapshot.turnCount } : {}),
    ...(snapshot.tokenUsage ? { tokenUsage: snapshot.tokenUsage } : {}),
    ...(snapshot.resolvedModel ? { model: snapshot.resolvedModel } : {}),
    ...(snapshot.thinkingLevel ? { thinkingLevel: snapshot.thinkingLevel } : {}),
  };
}

/** Specialist-authored text, quoted so it reads as the child's words, not an instruction. */
const quoted = (text: string) => text.split('\n').filter((line) => line.trim() !== '').map((line) => `> ${line}`);

/**
 * The lines under the identity line, in the order the Pi wake card uses: context (run cost
 * for a completion, the failing model for a failure, plus the purpose), then whatever the
 * Specialist wrote.
 */
function briefLines(eventClass: string, detail: ChannelDetail): string[] {
  const failed = eventClass === 'failed';
  const facts = failed
    ? [detail.model, detail.thinkingLevel].filter(Boolean).join(' · ')
    : eventClass === 'completed'
      ? [
          detail.elapsedS !== undefined ? formatElapsed(detail.elapsedS) : '',
          detail.turnCount !== undefined ? `${detail.turnCount} turn${detail.turnCount === 1 ? '' : 's'}` : '',
          formatTokens(detail.tokenUsage),
        ].filter(Boolean).join(' • ')
      : '';
  const purpose = detail.purpose ? clip(detail.purpose.replace(/\s+/g, ' ').trim(), BRIEF_LIMITS.purpose) : '';
  const lines: string[] = [];
  const context = [facts, purpose ? `purpose: ${purpose}` : ''].filter(Boolean).join(' · ');
  if (context) lines.push(context);

  if (eventClass === 'needs_reply' || eventClass === 'escalation') {
    if (detail.body?.trim()) lines.push(...quoted(clip(detail.body.trim(), BRIEF_LIMITS.body)));
  } else if (failed) {
    if (detail.error?.trim()) lines.push(...quoted(clip(detail.error.trim(), BRIEF_LIMITS.error)));
  } else if (eventClass === 'completed' && detail.output?.trim()) {
    const all = detail.output.split('\n').filter((line) => line.trim() !== '');
    lines.push(...all.slice(0, BRIEF_LIMITS.resultLines).map((line) => `> ${clip(line, BRIEF_LIMITS.resultLine)}`));
    if (all.length > BRIEF_LIMITS.resultLines) {
      lines.push(`… +${all.length - BRIEF_LIMITS.resultLines} more lines in specialist_result`);
    }
  }
  return lines;
}

/**
 * Build the frame for one transition.
 *
 * Exported so a test can assert the bounds directly. The first line is a fixed shape that
 * specialists-ui parses — `Specialist <name>[ on <issue>]: <event> (<activation_id>). <action>`
 * — and must not change; the brief goes on the lines under it.
 */
export function buildChannelFrame(input: {
  activationId: string;
  specialist: string;
  beadId?: string;
  eventClass: string;
  detail?: ChannelDetail;
}): ChannelFrame {
  // A result is readable only once an activation finished; a waiting ask must still be
  // read through specialist_status. Mirrors wake-watch's read_with for the same classes.
  const settled = input.eventClass === 'completed' || input.eventClass === 'failed';
  const meta: Record<string, string> = {
    activation_id: input.activationId,
    specialist: input.specialist,
    event: input.eventClass,
    read_with: settled ? 'specialist_result' : 'specialist_status',
  };
  if (input.beadId) meta.bead_id = input.beadId;

  for (const key of Object.keys(meta)) {
    // Unreachable with the literals above; it guards the next key someone adds.
    if (!META_KEY.test(key)) throw new Error(`channel meta key "${key}" fails ${META_KEY.source}`);
  }

  const work = input.beadId ? ` on ${input.beadId}` : '';
  const action = ACTION[input.eventClass] ?? 'Call specialist_status for authoritative state.';
  const head = `Specialist ${input.specialist}${work}: ${input.eventClass} (${input.activationId}). ${action}`;
  return {
    method: CHANNEL_METHOD,
    params: {
      content: [head, ...briefLines(input.eventClass, input.detail ?? {})].join('\n'),
      meta,
    },
  };
}

/**
 * Wrap a forensic sink so actionable transitions also push a channel frame.
 *
 * Composition rather than a second sink parameter on the host: the host already
 * emits exactly these events to exactly one sink, so the push rides the stream
 * that exists instead of introducing an event bus for a producer and consumer
 * that share a process.
 *
 * Failure-isolated in both directions. A send that throws or rejects is logged
 * and dropped — an undeliverable push loses nothing, because the authority
 * store was written before the event was emitted and `specialist_status` still
 * answers. Letting a transport error escape would make a cosmetic notification
 * able to fail an activation.
 */
export function withChannelPush(
  base: ActivationForensicSink,
  send: ChannelSend,
  describe: (activationId: string) => ChannelDetail = () => ({}),
): ActivationForensicSink {
  return {
    ...base,
    emit(event) {
      base.emit(event);

      const eventClass = PUSHED_EVENTS[event.name];
      if (!eventClass) return;
      // A failed model leg that a fallback leg follows is progress, not an outcome
      // (SPECIALISTS-4253): the walk's final result is pushed instead.
      if (event.payload?.intermediate === true) return;

      try {
        const payload = event.payload ?? {};
        const text = (key: string) => (typeof payload[key] === 'string' ? { [key]: payload[key] as string } : {});
        const frame = buildChannelFrame({
          activationId: event.activationId,
          specialist: event.specialist,
          ...(event.beadId ? { beadId: event.beadId } : {}),
          eventClass,
          detail: { ...describe(event.activationId), ...text('body'), ...text('output'), ...text('error') },
        });
        void Promise.resolve(send(frame)).catch((error: unknown) => {
          logger.debug(`channel push dropped (${eventClass}): ${String(error)}`);
        });
      } catch (error) {
        logger.debug(`channel push not built (${eventClass}): ${String(error)}`);
      }
    },
  };
}
