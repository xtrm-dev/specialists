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
/**
 * Declared in the server's capabilities. Presence of this key is what registers
 * the channel listener on Claude's side; the value is intentionally empty.
 */
export declare const CHANNEL_CAPABILITY: {
    readonly 'claude/channel': {};
};
/** The notification method Claude Code listens for. */
export declare const CHANNEL_METHOD = "notifications/claude/channel";
export interface ChannelFrame {
    method: typeof CHANNEL_METHOD;
    params: {
        content: string;
        meta: Record<string, string>;
    };
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
export declare const BRIEF_LIMITS: {
    readonly purpose: 120;
    readonly body: 2000;
    readonly error: 600;
    readonly resultLines: 3;
    readonly resultLine: 240;
};
/** Elapsed as a short clock: 42s, 3m05s, 1h02m. */
export declare function formatElapsed(elapsedS: number): string;
/**
 * Spend as a token count. `total_tokens` is a rollup, never a summand — adding it would
 * double-count (unitAI-d99hb). Returns '' when nothing was reported, never a fabricated 0.
 */
export declare function formatTokens(usage: ActivationTokenUsage | undefined): string;
/** The snapshot facts a brief reads — the same ones `specialist_status` projects. */
export declare function snapshotDetail(snapshot: ActivationSnapshot | undefined, nowMs?: number): ChannelDetail;
/**
 * Build the frame for one transition.
 *
 * Exported so a test can assert the bounds directly. The first line is a fixed shape that
 * specialists-ui parses — `Specialist <name>[ on <issue>]: <event> (<activation_id>). <action>`
 * — and must not change; the brief goes on the lines under it.
 */
export declare function buildChannelFrame(input: {
    activationId: string;
    specialist: string;
    beadId?: string;
    eventClass: string;
    detail?: ChannelDetail;
}): ChannelFrame;
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
export declare function withChannelPush(base: ActivationForensicSink, send: ChannelSend, describe?: (activationId: string) => ChannelDetail): ActivationForensicSink;
//# sourceMappingURL=channel.d.ts.map