import { describe, it, expect } from 'vitest';
import {
  BRIEF_LIMITS,
  CHANNEL_CAPABILITY,
  CHANNEL_METHOD,
  buildChannelFrame,
  formatTokens,
  wakeNotice,
  wakeSuppressed,
  withChannelPush,
  type ChannelDetail,
  type ChannelFrame,
} from '../../../src/mcp/channel.js';
import type { ActivationForensicSink } from '../../../src/activation/native-host.js';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { buildV2Server } from '../../../src/mcp/v2-server.js';

/**
 * Channel push (unitAI-aiwva.21). Claude Code's gate chain is silent on every
 * failure, so nothing downstream reports a malformed frame — these assertions
 * are the only place a meta-key or payload regression surfaces.
 */
const EVENT = {
  activationId: 'act:1',
  attemptId: 'att:1',
  participantId: 'p:1',
  specialist: 'executor',
  beadId: 'unitAI-aiwva.21',
};

function recorder() {
  const sent: ChannelFrame[] = [];
  const seen: string[] = [];
  const base: ActivationForensicSink = { emit: (e) => { seen.push(e.name); } };
  return { sent, seen, sink: withChannelPush(base, (f) => { sent.push(f); }) };
}

describe('channel capability', () => {
  it('declares the exact key Claude Code registers its listener on', () => {
    // The client matches this literal; a rename silently disables push.
    expect(CHANNEL_CAPABILITY).toEqual({ 'claude/channel': {} });
    expect(CHANNEL_METHOD).toBe('notifications/claude/channel');
  });
});

describe('buildChannelFrame', () => {
  it('carries only identity in meta, with client-legal keys', () => {
    const { params } = buildChannelFrame({ ...EVENT, eventClass: 'completed' });
    expect(params.meta).toEqual({
      activation_id: 'act:1',
      specialist: 'executor',
      event: 'completed',
      read_with: 'specialist_result',
      bead_id: 'unitAI-aiwva.21',
    });
    for (const key of Object.keys(params.meta)) {
      expect(key).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
    }
    for (const value of Object.values(params.meta)) {
      expect(typeof value).toBe('string');
    }
  });

  it('points at specialist_result instead of carrying a result', () => {
    const { params } = buildChannelFrame({ ...EVENT, eventClass: 'completed' });
    expect(params.content).toContain('specialist_result');
    expect(params.content).toContain('act:1');
    // Reference-only discipline: a frame is rendered straight into session
    // context, so its size must follow identity length, never result length.
    expect(params.content.length).toBeLessThan(320);
  });

  it('omits bead_id rather than emitting an empty one', () => {
    const { params } = buildChannelFrame({
      activationId: 'act:2', specialist: 'researcher', eventClass: 'needs_reply',
    });
    expect(params.meta.bead_id).toBeUndefined();
    expect(params.meta.activation_id).toBe('act:2');
  });

  it('points read_with at a result only when the activation settled', () => {
    const classes = ['completed', 'failed', 'escalation'] as const;
    const readWith: Record<string, string> = {};
    for (const eventClass of classes) {
      readWith[eventClass] = buildChannelFrame({ activationId: 'act:3', specialist: 'executor', eventClass }).params.meta.read_with;
    }
    readWith.needs_reply = buildChannelFrame({
      activationId: 'act:3', specialist: 'executor', eventClass: 'needs_reply',
    }).params.meta.read_with;
    expect(readWith).toEqual({
      completed: 'specialist_result',
      failed: 'specialist_result',
      escalation: 'specialist_status',
      needs_reply: 'specialist_status',
    });
  });
});

describe('channel brief', () => {
  const content = (eventClass: string, detail: ChannelDetail) =>
    buildChannelFrame({ ...EVENT, eventClass, detail }).params.content.split('\n');

  it('keeps the identity line first and unchanged, so specialists-ui still parses it', () => {
    const [head] = content('completed', { output: 'done', elapsedS: 42 });
    expect(head).toBe('Specialist executor on unitAI-aiwva.21: completed (act:1). Call specialist_result for the full result.');
  });

  it('carries run cost, purpose and the first result lines for a completion', () => {
    const lines = content('completed', {
      elapsedS: 185, turnCount: 3,
      tokenUsage: { input_tokens: 40_000, output_tokens: 2_500, total_tokens: 42_500 },
      purpose: 'inspect   native wake\ntransport',
      output: 'line one\n\nline two\nline three\nline four\nline five',
    });
    expect(lines.slice(1)).toEqual([
      '3m05s • 3 turns • 43k tokens · purpose: inspect native wake transport',
      '> line one',
      '> line two',
      '> line three',
      '… +2 more lines in specialist_result',
    ]);
  });

  it('carries the failing model and the error for a failure', () => {
    const lines = content('failed', { model: 'commandcode/z-ai/glm-5.3-flash', thinkingLevel: 'high', error: '429 rate limited' });
    expect(lines.slice(1)).toEqual(['commandcode/z-ai/glm-5.3-flash · high', '> 429 rate limited']);
    expect(lines[0]).toContain('specialist_retry');
  });

  it('carries the ask body verbatim for asks and escalations', () => {
    for (const eventClass of ['needs_reply', 'escalation']) {
      const lines = content(eventClass, { purpose: 'p', body: 'Does the bracket look right?\nOption A or B?' });
      expect(lines.slice(1)).toEqual(['purpose: p', '> Does the bracket look right?', '> Option A or B?']);
    }
  });

  it('stays bounded whatever the Specialist wrote', () => {
    const huge = 'x'.repeat(50_000);
    const lines = (eventClass: string, detail: ChannelDetail) => buildChannelFrame({ ...EVENT, eventClass, detail }).params.content;
    expect(lines('completed', { output: `${huge}\n${huge}\n${huge}\n${huge}`, purpose: huge }).length).toBeLessThan(1200);
    expect(lines('needs_reply', { body: huge }).length).toBeLessThan(BRIEF_LIMITS.body + 400);
    expect(lines('failed', { error: huge }).length).toBeLessThan(BRIEF_LIMITS.error + 400);
  });

  it('never fabricates a zero spend', () => {
    expect(formatTokens(undefined)).toBe('');
    expect(formatTokens({ total_tokens: 900 })).toBe('');
    expect(formatTokens({ input_tokens: 900 })).toBe('900 tokens');
  });
});

describe('withChannelPush', () => {
  it('builds the brief from the event payload plus the snapshot', () => {
    const sent: ChannelFrame[] = [];
    const sink = withChannelPush({ emit: () => {} }, (f) => { sent.push(f); }, () => ({ turnCount: 2, purpose: 'p' }));
    sink.emit({ ...EVENT, name: 'activation_completed', payload: { output: 'answer' } });
    sink.emit({ ...EVENT, name: 'clarification_requested', payload: { body: 'which file?' } });
    sink.emit({ ...EVENT, name: 'activation_failed', payload: { error: 'boom' } });
    expect(sent.map((f) => f.params.content.split('\n').slice(1))).toEqual([
      ['2 turns · purpose: p', '> answer'],
      ['purpose: p', '> which file?'],
      ['purpose: p', '> boom'],
    ]);
  });

  it('pushes only actionable transitions', () => {
    const { sent, sink } = recorder();
    for (const name of [
      'activation_completed', 'activation_failed',
      'escalation_raised', 'clarification_requested',
    ]) sink.emit({ ...EVENT, name });

    expect(sent.map((f) => f.params.meta.event)).toEqual([
      'completed', 'failed', 'escalation', 'needs_reply',
    ]);
  });

  it('stays silent on progress events', () => {
    const { sent, seen, sink } = recorder();
    for (const name of [
      'turn_started', 'turn_completed', 'retry_started',
      'compaction_started', 'lease_acquired', 'activation_admitted',
      // Emitted just before activation_completed on the same path; pushing both would wake twice.
      'activation_settled',
    ]) sink.emit({ ...EVENT, name });

    // Progress is why the poller was expensive; pushing it would rebuild that cost.
    expect(sent).toHaveLength(0);
    expect(seen).toHaveLength(7);
  });

  it('does not push an intermediate failed fallback leg, but still forwards it (SPECIALISTS-4253)', () => {
    const { sent, seen, sink } = recorder();
    sink.emit({ ...EVENT, name: 'activation_failed', payload: { error: '429', intermediate: true } });
    sink.emit({ ...EVENT, name: 'activation_failed', payload: { error: '429' } });

    expect(seen).toEqual(['activation_failed', 'activation_failed']);
    expect(sent.map((f) => f.params.meta.event)).toEqual(['failed']);
  });

  it('forwards every event to the wrapped sink', () => {
    const { seen, sink } = recorder();
    sink.emit({ ...EVENT, name: 'turn_started' });
    sink.emit({ ...EVENT, name: 'activation_settled' });
    expect(seen).toEqual(['turn_started', 'activation_settled']);
  });

  it('isolates a throwing sender from the activation', () => {
    const seen: string[] = [];
    const base: ActivationForensicSink = { emit: (e) => { seen.push(e.name); } };
    const sink = withChannelPush(base, () => { throw new Error('transport gone'); });

    expect(() => sink.emit({ ...EVENT, name: 'activation_settled' })).not.toThrow();
    expect(seen).toEqual(['activation_settled']);
  });

  it('isolates a rejecting sender', async () => {
    const base: ActivationForensicSink = { emit: () => {} };
    const sink = withChannelPush(base, () => Promise.reject(new Error('closed')));

    expect(() => sink.emit({ ...EVENT, name: 'activation_failed' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('preserves optional sink members', () => {
    let raw = 0;
    const base = {
      emit: () => {},
      sessionEvent: () => { raw += 1; },
    } as unknown as ActivationForensicSink;
    const sink = withChannelPush(base, () => {});
    sink.sessionEvent?.({} as never);
    expect(raw).toBe(1);
  });
});

describe('wire', () => {
  it('writes the frame on a legacy connection, despite the method being outside the SDK union', async () => {
    // The one thing unit-testing the sink cannot answer: whether the SDK's
    // Protocol.notification() refuses a method it has no schema for. It does
    // not — but that is an observed behaviour of this SDK version, so it is
    // pinned here rather than assumed.
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const received: Array<{ method?: string }> = [];
    clientT.onmessage = (m: unknown) => { received.push(m as { method?: string }); };
    await clientT.start();

    const server = buildV2Server({ era: 'legacy' });
    await server.connect(serverT);
    await server.server.notification(
      buildChannelFrame({ activationId: 'act:w1', specialist: 'executor', eventClass: 'completed' }) as never,
    );
    await new Promise((r) => setTimeout(r, 50));

    const hit = received.find((m) => m.method === CHANNEL_METHOD);
    expect(hit).toBeDefined();
    await server.close();
  });
});

describe('wake switch', () => {
  it('SPECIALISTS_WAKE=off suppresses wakes and the notice says so', () => {
    expect(wakeSuppressed({})).toBe(false);
    expect(wakeSuppressed({ SPECIALISTS_WAKE: 'OFF' })).toBe(true);
    expect(wakeNotice({ SPECIALISTS_WAKE: 'off' })).toContain('Wakes are off');
    expect(wakeNotice({})).toContain('You will be woken');
  });
});
