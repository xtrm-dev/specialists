import { describe, it, expect } from 'vitest';
import { NativeActivationHost } from '../../../src/activation/native-host.js';
import { createSpecialistDispatchTool, createSpecialistStopActivationTool } from '../../../src/tools/specialist/activation.tool.js';
import { REQUIRED_SECTIONS } from '../../../src/activation/contract-sections.js';
import { workspaceIdentityFor, inspect as inspectLease } from '../../../src/activation/workspace-lease.js';
import type { PiSdk, PiAgentSessionLike, PiAgentSessionEvent } from '../../../src/activation/pi-sdk.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';
import { testWorkItems } from '../../utils/test-work-items.js';
import { tempDir } from '../../utils/temp-dir.js';

/**
 * SPECIALISTS-4505 — a stop must not wait for an answer nobody is going to give.
 *
 * Observed live: a reviewer posted its formal review, escalated, and `specialist_stop_activation`
 * on it ran past 120s, was moved to the background, and sat in `stopping` for ~3h until the
 * coordinator happened to answer the ask. The inference was that the stop was waiting on the
 * ask; this file pins the cause and the fix.
 *
 * The cause is structural, not incidental: the ask tool BLOCKS inside a tool call
 * (`ask-tool.ts`), and pi's `AgentSession.abort()` resolves only once the session is idle —
 * which it cannot be while a tool call is outstanding. So the session double below models
 * exactly that pair: `prompt()` awaits the real ask tool's execute, and `abort()` awaits the
 * same turn (pi's `waitForIdle()`). A double whose `abort()` resolved unconditionally would
 * make the pending ask irrelevant and prove nothing.
 */

interface Tool {
  name: string;
  execute: (toolCallId: string, args: never) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}

type Emitted = { name: string; payload?: Record<string, unknown>; activationId: string; attemptId: string };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wait for a condition without depending on real timers beyond the poll interval. */
async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached before the deadline');
    await sleep(5);
  }
}

function contractDescription(): string {
  const bodies: Record<string, string> = {
    PROBLEM: 'The thing is unclear.',
    SUCCESS: 'The thing is clear.',
    SCOPE: 'Investigate the thing.',
    NON_GOALS: 'Does not fix the thing.',
    CONSTRAINTS: 'Read-only.',
    VALIDATION: 'A written finding.',
    OUTPUT: 'A finding.',
  };
  const lines: string[] = [];
  for (const section of REQUIRED_SECTIONS) lines.push(section, bodies[section] ?? '', '');
  lines.push('SCRUTINY', 'LOW — routine.');
  return lines.join('\n');
}

interface SessionOptions {
  /** `abort()` never resolves, whatever the turn is doing — an abort that just will not return. */
  abortHangsForever?: boolean;
  /** The turn never ends, even once its ask is cancelled — a tool that ignores the abort signal. */
  turnStaysInFlight?: boolean;
}

function askBlockedSession(blocker: string, options: SessionOptions = {}) {
  const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
  let escalate: Tool | undefined;
  /** The child's turn: pending for as long as its ask is unanswered. */
  let turn: Promise<{ content: Array<{ type: 'text'; text: string }> }> | undefined;
  /** What the CHILD saw as its tool result — the text pi would feed back to the model. */
  let askResult: string | undefined;

  const session = {
    sessionId: 'pi-sess-stop-ask',
    messages: [] as unknown[],
    isIdle: true,
    disposed: false,
    activeTools: ['read', 'grep'] as string[],
    async prompt() {
      // pi's prompt() does asynchronous preflight (auth, model, resources) before any turn
      // event fires, so the turn is deferred by a tick here too — the host registers the
      // activation in between, exactly as it does live.
      await sleep(0);
      listeners.forEach((l) => l({ type: 'agent_start' }));
      session.isIdle = false;
      turn = escalate!
        .execute('call_escalate', { blocker } as never)
        .then((result) => {
          askResult = result.content.map((part) => part.text).join('');
          return result;
        });
      await turn;
      if (options.turnStaysInFlight) await new Promise<never>(() => {});
      // The turn ends here rather than emitting settle events: what this test needs is the
      // session to be non-idle while the ask is outstanding, nothing more.
      session.isIdle = true;
    },
    async abort() {
      if (options.abortHangsForever) return new Promise<never>(() => {});
      // pi's AgentSession.abort(): request the abort, then wait for idle. An outstanding
      // tool call keeps the session non-idle, so this awaits the turn itself.
      if (turn) await turn;
    },
    async steer() {},
    async followUp() {},
    dispose() { session.disposed = true; },
    subscribe(l: (e: PiAgentSessionEvent) => void) {
      listeners.push(l);
      return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
    },
    getActiveToolNames: () => session.activeTools,
    setActiveToolsByName(names: string[]) { session.activeTools = names; },
    async waitForIdle() {},
  };

  return {
    session: session as unknown as PiAgentSessionLike,
    /** pi hands the custom tools in `customTools`; the child's ask goes through the real one. */
    capture(created: Record<string, unknown>) {
      // Model pi's HARD FILTER: the session exposes exactly the tools it was named, so the
      // post-load contract verification sees the same surface the real SDK would show.
      if (Array.isArray(created.tools)) session.activeTools = created.tools as string[];
      escalate = (created.customTools as Tool[]).find((tool) => tool.name === 'escalate_to_coordinator');
    },
    askResult: () => askResult,
    disposed: () => session.disposed,
  };
}

function hostWith(blocker: string, options: SessionOptions & { stopAbortTimeoutMs?: number; writer?: boolean } = {}) {
  const workspace = tempDir('stop-pending-ask-ws-');
  const askSession = askBlockedSession(blocker, options);
  const emitted: Emitted[] = [];
  const sdk = {
    createAgentSession: async (created?: Record<string, unknown>) => {
      askSession.capture(created ?? {});
      return { session: askSession.session };
    },
    DefaultResourceLoader: FakeResourceLoader,
    getAgentDir: () => FAKE_AGENT_DIR,
    ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
    resolveModelScopeWithDiagnostics: () => ({
      scopedModels: [{ model: { id: 'test-model', provider: 'testprov' } }],
      diagnostics: [],
    }),
    defineTool: (definition: unknown) => definition,
    createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
    createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
    createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
    createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
  } as unknown as PiSdk;

  const host = new NativeActivationHost({
    provisionWriterWorkspace: workspaceIdentityFor,
    loader: {
      get: async () => ({
        specialist: {
          metadata: { name: 'researcher', version: '1.0.0', description: 'd', category: 'c' },
          execution: {
            model: 'testprov/test-model',
            permission_required: options.writer ? 'MEDIUM' : 'READ_ONLY',
            response_format: 'text',
            output_type: 'research',
            bare: false,
          },
          prompt: { system: 'You are the researcher.', task_template: 'Do: $bead_id' },
        },
      }),
    } as never,
    workItems: testWorkItems({ description: contractDescription() }),
    loadSdk: async () => sdk,
    forensics: {
      emit: (event) => {
        emitted.push({
          name: event.name,
          payload: event.payload,
          activationId: event.activationId,
          attemptId: event.attemptId,
        });
      },
    },
    cwd: workspace,
    ...(options.stopAbortTimeoutMs !== undefined ? { stopAbortTimeoutMs: options.stopAbortTimeoutMs } : {}),
  });

  return { host, emitted, askSession };
}

/** Dispatch a read-only activation whose single turn escalates and then blocks. */
async function dispatchEscalated(host: NativeActivationHost): Promise<string> {
  const dispatch = createSpecialistDispatchTool(() => host);
  const dispatched = await dispatch.execute({ specialist: 'researcher', bead_id: 'ISSUE-1' });
  const activationId = String((dispatched as { activation_id: string }).activation_id);
  await until(() => host.pendingAsks().length === 1);
  return activationId;
}

describe('specialist_stop_activation with a pending ask (SPECIALISTS-4505)', () => {
  it('stops within a bounded time and records the ask as unanswered instead of waiting for a reply', async () => {
    const { host, emitted, askSession } = hostWith('I lack permission to edit config');
    const activationId = await dispatchEscalated(host);

    const pendingAsk = host.pendingAsks()[0].message.messageId;
    expect(host.inspect(activationId)?.state).toBe('escalated');

    const stop = createSpecialistStopActivationTool(() => host);
    // 1s is orders of magnitude above the fix's path (it never waits) and far below the
    // 120s the live stop was observed to exceed.
    const outcome = await Promise.race([
      stop.execute({ activation_id: activationId, reason: 'test stop' }).then((r) => ({ kind: 'returned' as const, r })),
      sleep(1_000).then(() => ({ kind: 'hung' as const, r: undefined })),
    ]);

    expect(outcome.kind).toBe('returned');
    if (outcome.kind !== 'returned') return;

    // The stop COMPLETED: nothing left in the fleet, nothing left pending, no `stopping` residue.
    expect(host.inspect(activationId)).toBeUndefined();
    expect(host.pendingAsks()).toEqual([]);
    expect(askSession.disposed()).toBe(true);

    // The ask was resolved as UNANSWERED and named back to the caller, so it cannot be
    // mistaken for a question still worth answering with specialist_reply.
    expect(outcome.r).toMatchObject({ status: 'stopped', cancelled_asks: [pendingAsk] });
    expect(String((outcome.r as { cancelled_asks_note?: string }).cancelled_asks_note)).toContain('no longer be answered');

    // The cancellation is emitted for live forensic listeners (the status sink does not persist it).
    const cancelled = emitted.filter((e) => e.name === 'activation_ask_cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({
      activationId,
      payload: { message_id: pendingAsk, reason: 'test stop' },
    });
    expect(emitted.some((e) => e.name === 'activation_disposed')).toBe(true);
    // A cancellation is not an answer: no clarification_resolved claim was made for it.
    expect(emitted.map((e) => e.name)).not.toContain('escalation_resolved');

    // The child's blocked tool call returned, which is WHAT releases the abort.
    expect(askSession.askResult()).toContain('Cancelled');
    // And the ask can no longer be answered.
    expect(await host.answer(pendingAsk, 'too late')).toBeUndefined();
  });

  it('disposes even when abort() never returns, reporting that the stop bound was hit', async () => {
    const { host, emitted } = hostWith('unused', { abortHangsForever: true, stopAbortTimeoutMs: 20 });
    const activationId = await dispatchEscalated(host);

    const outcome = await Promise.race([
      host.stop(activationId, 'abort hangs').then((r) => ({ kind: 'returned' as const, r })),
      sleep(1_000).then(() => ({ kind: 'hung' as const, r: undefined })),
    ]);

    expect(outcome.kind).toBe('returned');
    if (outcome.kind !== 'returned') return;
    expect(outcome.r.abortTimedOut).toBe(true);
    expect(outcome.r.cancelledAskIds).toHaveLength(1);
    expect(host.inspect(activationId)).toBeUndefined();
    expect(host.pendingAsks()).toEqual([]);

    // A stop that could not abort is still a stop — and it says so, with the bound it used.
    expect(emitted.find((e) => e.name === 'activation_abort_timeout')?.payload).toMatchObject({ timeout_ms: 20 });
    expect(emitted.some((e) => e.name === 'activation_disposed')).toBe(true);
  });

  it('reports abort_timed_out through the stop tool when the bound is hit', async () => {
    const { host } = hostWith('unused', { abortHangsForever: true, stopAbortTimeoutMs: 20 });
    const activationId = await dispatchEscalated(host);
    const stop = createSpecialistStopActivationTool(() => host);
    const result = await stop.execute({ activation_id: activationId, reason: 'abort hangs' });
    expect(result).toMatchObject({ status: 'stopped', abort_timed_out: true });
  });

  it('stops a second activation without touching the first one\'s pending ask', async () => {
    const { host } = hostWith('first');
    const first = await dispatchEscalated(host);
    const dispatch = createSpecialistDispatchTool(() => host);
    const second = String(((await dispatch.execute({ specialist: 'researcher', bead_id: 'ISSUE-2' })) as { activation_id: string }).activation_id);
    await until(() => host.pendingAsks().length === 2);
    const firstAsk = host.pendingAsks().find((a) => a.message.activationId === first)!.message.messageId;

    const outcome = await host.stop(second, 'stop only the second');

    expect(outcome.cancelledAskIds).toHaveLength(1);
    expect(outcome.cancelledAskIds).not.toContain(firstAsk);
    expect(host.pendingAsks().map((a) => a.message.messageId)).toEqual([firstAsk]);
    expect(host.inspect(first)).toBeDefined();
  });

  it('keeps a writer\'s lease held and reports it uncertain when the abort hit the bound', async () => {
    const { host, emitted } = hostWith('unused', { abortHangsForever: true, turnStaysInFlight: true, stopAbortTimeoutMs: 20, writer: true });
    const activationId = await dispatchEscalated(host);
    const workspace = host.inspect(activationId)!.workspace;
    expect(inspectLease(workspace).state).toBe('held');

    const outcome = await host.stop(activationId, 'abort hangs');

    expect(outcome.abortTimedOut).toBe(true);
    // The turn is still in flight, so nothing released the lease before the stop decided.
    const names = emitted.map((e) => e.name);
    expect(names).toContain('lease_uncertain');
    expect(names).not.toContain('lease_released');
    // The holder is this live host process: the lease is held, and reconcile cannot take it.
    expect(inspectLease(workspace).state).toBe('held');
  });

  it('releases a writer\'s lease when the abort finished within the bound', async () => {
    const { host, emitted } = hostWith('unused', { writer: true });
    const activationId = await dispatchEscalated(host);

    await host.stop(activationId, 'ordinary stop');

    const names = emitted.map((e) => e.name);
    expect(names.slice(names.indexOf('activation_ask_cancelled'))).toContain('lease_released');
    expect(names).not.toContain('lease_uncertain');
  });

  it('leaves an activation with no pending ask exactly as before — no cancellation, no timeout', async () => {
    const { host, emitted } = hostWith('unused');
    const activationId = await dispatchEscalated(host);
    // Answer the ask first: the ordinary path must be untouched by the cancellation logic.
    const pendingAsk = host.pendingAsks()[0].message.messageId;
    await host.answer(pendingAsk, 'proceed, permission granted');
    await until(() => host.pendingAsks().length === 0);

    const outcome = await host.stop(activationId, 'ordinary stop');

    expect(outcome).toEqual({ cancelledAskIds: [], abortTimedOut: false });
    expect(emitted.map((e) => e.name)).not.toContain('activation_ask_cancelled');
    expect(emitted.map((e) => e.name)).not.toContain('activation_abort_timeout');
    expect(host.inspect(activationId)).toBeUndefined();
  });
});
