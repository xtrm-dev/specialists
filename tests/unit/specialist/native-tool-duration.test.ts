import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pythonKernelPath = vi.hoisted(() => ({ value: '/fake/pi-extensions/python-kernel' }));
vi.mock('../../../src/pi/python-kernel-extension.js', () => ({
  resolvePiExtensionsPythonKernelPath: () => pythonKernelPath.value,
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => {
      throw new Error(`native activation must not spawn a subprocess; got spawn(${String(args[0])})`);
    },
  };
});

import { createActivationForensicSink } from '../../../src/activation/forensic-sink.js';
import { NativeActivationHost } from '../../../src/activation/native-host.js';
import { createMemorySettlementStore } from '../../../src/activation/settlement-store.js';
import type { PiAgentSessionEvent, PiAgentSessionLike, PiSdk } from '../../../src/activation/pi-sdk.js';
import { mapNativeLifecycleEvent } from '../../../src/specialist/native-activation-observability.js';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';
import { createStaleWarningEvent } from '../../../src/specialist/timeline-events.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';
import type { SpecialistWorkItemBoundary, WorkItemView } from '../../../src/activation/workitem-store.js';

/**
 * SPECIALISTS-102 producer-level proof.
 *
 * The canonical oracle entry `native-stale-warning` drives ONLY the mapper + writer
 * (mapNativeLifecycleEvent + sink into an isolated store): no NativeActivationHost is
 * constructed, so the mapper arm alone turns it green with zero producer. THESE tests
 * drive the REAL host with an injected fake session and an injected clock, feed real
 * `tool_execution_start/end` session events, advance the clock past the threshold, and
 * assert on DURABLE `process_health.stale_detected` rows read back from an isolated
 * store. Removing the producer (the onSessionEvent tool arms + checker) turns them red
 * while the oracle stays green — that difference is the point.
 */

type FakeSession = PiAgentSessionLike & {
  emit: (event: PiAgentSessionEvent) => void;
  disposed: boolean;
};

function fakeSession(opts: {
  holdOpen?: boolean;
  toolStart?: { toolName: string; toolCallId: string };
  toolEnd?: { toolName: string; toolCallId: string };
} = {}): FakeSession {
  const listeners: Array<(event: PiAgentSessionEvent) => void> = [];
  const messages: unknown[] = [];
  const session = {
    sessionId: 'pi-sess-123',
    messages,
    isIdle: true,
    disposed: false,
    activeTools: ['read', 'bash'],
    holdOpen: opts.holdOpen ?? false,
    async prompt() {
      listeners.forEach((l) => l({ type: 'agent_start' }));
      if (session.holdOpen) return new Promise<never>(() => {});
      if (opts.toolStart) {
        listeners.forEach((l) => l({
          type: 'tool_execution_start',
          toolName: opts.toolStart!.toolName,
          toolCallId: opts.toolStart!.toolCallId,
        }));
      }
      messages.push({ role: 'assistant', content: 'done' });
      if (opts.toolEnd) {
        listeners.forEach((l) => l({
          type: 'tool_execution_end',
          toolName: opts.toolEnd!.toolName,
          toolCallId: opts.toolEnd!.toolCallId,
        }));
      }
      listeners.forEach((l) => l({ type: 'agent_end', willRetry: false }));
      listeners.forEach((l) => l({ type: 'agent_settled' }));
    },
    async steer() {},
    async followUp() {},
    async abort() {},
    dispose() {
      session.disposed = true;
    },
    subscribe(l: (event: PiAgentSessionEvent) => void) {
      listeners.push(l);
      return () => {
        const i = listeners.indexOf(l);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    getActiveToolNames: () => session.activeTools,
    setActiveToolsByName(names: string[]) {
      session.activeTools = names;
    },
    async waitForIdle() {},
    emit: (event: PiAgentSessionEvent) => listeners.forEach((l) => l(event)),
  };
  return session as unknown as FakeSession;
}

function makeSdk(session: PiAgentSessionLike): PiSdk {
  return {
    createAgentSession: async (options?: Record<string, unknown>) => {
      // Model pi's HARD FILTER faithfully: the session exposes exactly the tools it
      // was named, no more — otherwise post-load verification refuses the dispatch
      // (tool_contract_unsatisfied) for the wrong reason.
      if (Array.isArray(options?.tools)) session.setActiveToolsByName(options.tools as string[]);
      return { session };
    },
    DefaultResourceLoader: FakeResourceLoader,
    getAgentDir: () => FAKE_AGENT_DIR,
    ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
    resolveModelScopeWithDiagnostics: () => ({
      scopedModels: [{ model: { id: 'test-model', provider: 'testprov' } }],
      diagnostics: [],
    }),
    defineTool: (d: unknown) => d,
    createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
    createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
    createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
    createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
  } as unknown as PiSdk;
}

function fakeWorkItems(): SpecialistWorkItemBoundary {
  const contract = {
    problem: 'The thing is unclear.',
    success: 'The thing is clear.',
    scope: ['Investigate the thing.'],
    nonGoals: ['Does not fix the thing.'],
    constraints: ['Read-only.'],
    validation: [{ check: 'A written finding.' }],
    output: [{ artifact: 'A finding.' }],
  };
  return {
    view(ref: string): WorkItemView {
      return {
        ref,
        issueId: `iss_${ref}`,
        revision: 1,
        contractHash: 'hash-test',
        title: 'Investigate the thing',
        contract,
        readinessState: 'claimed',
        dispatchable: true,
        reasons: [],
      };
    },
    readContractState: () => undefined,
    epicAncestors: () => [],
    completedBlockers: () => [],
    check: () => ({ issueId: 'iss_test', revision: 1, contractHash: 'hash-test', report: {} }) as never,
    bind: () => ({}) as never,
    inlineCreate: () => ({ ref: 'ISSUE-INLINE', issueId: 'iss_inline', claimId: 1 }),
    releaseInlineClaim: () => true,
    journal: () => {},
  } as unknown as SpecialistWorkItemBoundary;
}

function loaderFor(spec: Record<string, unknown>) {
  return { get: async () => spec } as never;
}

function readOnlySpec() {
  return {
    specialist: {
      metadata: { name: 'researcher', version: '1.0.0', description: 'd', category: 'c' },
      execution: {
        model: 'testprov/test-model',
        permission_required: 'READ_ONLY',
        response_format: 'text',
        output_type: 'research',
        bare: false,
      },
      prompt: { system: 'You are the researcher.', task_template: 'Do: {{bead_id}}' },
    },
  };
}

const scratchDirs: string[] = [];
afterEach(() => {
  while (scratchDirs.length > 0) rmSync(scratchDirs.pop() as string, { recursive: true, force: true });
  // Timer spies below install on globalThis: never leak one into the next test.
  vi.restoreAllMocks();
});

function isolatedStore() {
  const root = mkdtempSync(join(tmpdir(), 'tool-duration-'));
  scratchDirs.push(root);
  const dbPath = join(root, 'observability.db');
  const client = createObservabilitySqliteClientAtPath(dbPath);
  if (!client) throw new Error('isolated store unavailable');
  return { dbPath, client, sink: createActivationForensicSink(client) };
}

function hostWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'tool-duration-ws-'));
  scratchDirs.push(root);
  return root;
}

interface StaleRow {
  event_name: string;
  attempt_id: string | null;
  event_json: string;
}

function readRows(dbPath: string, jobId: string): StaleRow[] {
  const raw = new Database(dbPath);
  try {
    return raw.query(
      'SELECT event_name, attempt_id, event_json FROM specialist_forensic_events WHERE job_id = ? ORDER BY seq',
    ).all(jobId) as StaleRow[];
  } finally {
    raw.close();
  }
}

function readStatus(dbPath: string, jobId: string): { status: string; body: Record<string, unknown> } {
  const raw = new Database(dbPath);
  try {
    const row = raw.query(
      'SELECT status, status_json FROM specialist_jobs WHERE job_id = ?',
    ).get(jobId) as { status: string; status_json: string };
    return { status: row.status, body: JSON.parse(row.status_json) as Record<string, unknown> };
  } finally {
    raw.close();
  }
}

function staleRows(dbPath: string, jobId: string): Array<StaleRow & { body: Record<string, unknown> }> {
  return readRows(dbPath, jobId)
    .filter((row) => row.event_name === 'process_health.stale_detected')
    .map((row) => ({ ...row, body: (JSON.parse(row.event_json) as { body: Record<string, unknown> }).body }));
}

/** One checker tick per call — the test-visible form of "several ticks". */
function tick(host: NativeActivationHost, activationId: string, n = 1): void {
  const check = (host as unknown as { checkToolDuration: (id: string) => void }).checkToolDuration.bind(host);
  for (let i = 0; i < n; i += 1) check(activationId);
}

function watchSize(host: NativeActivationHost): number {
  return (host as unknown as { toolDurationWatch: Map<string, unknown> }).toolDurationWatch.size;
}

type IntervalHandle = { hasRef(): boolean };

/** The live poll-timer handle for an armed watch (Target 4: real timer liveness). */
function watchTimer(host: NativeActivationHost, activationId: string): IntervalHandle {
  const watch = (host as unknown as { toolDurationWatch: Map<string, { timer: IntervalHandle }> }).toolDurationWatch.get(activationId);
  if (!watch) throw new Error(`no armed watch for ${activationId}`);
  return watch.timer;
}

/** Our own arming calls: the poll cadence is unique to this checker in these tests. */
function armedHandles(setSpy: ReturnType<typeof vi.spyOn>): unknown[] {
  return setSpy.mock.calls
    .map((call, i) => (call[1] === 10_000 ? setSpy.mock.results[i]?.value : undefined))
    .filter((value) => value !== undefined);
}

describe('native tool_duration producer (SPECIALISTS-102)', () => {
  it('warns exactly once with a durable row when a tool call exceeds the threshold', async () => {
    let nowMs = 1_000_000;
    const { dbPath, client, sink } = isolatedStore();
    const session = fakeSession({ holdOpen: true });
    // Target 4: the teardown below must be real timer disposal, not Map bookkeeping.
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(session),
      cwd: hostWorkspace(),
      now: () => nowMs,
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });

    session.emit({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'call-1' });
    nowMs += 130_000;
    tick(host, handle.activationId, 3);

    // Target 4: the armed timer is a detached (unref'd) real interval …
    const timer = watchTimer(host, handle.activationId);
    expect(timer.hasRef()).toBe(false);

    // The blocking-defect guard (review of PR #387): a warning on a HEALTHY running
    // activation must not masquerade as failure. The status row keeps status
    // 'running' with NO error, even though the emit payload carries a `reason`.
    const midRun = readStatus(dbPath, handle.activationId);
    expect(midRun.status).toBe('running');
    expect(midRun.body.current_event).toBe('stale_warning');
    expect(midRun.body.error ?? null).toBeNull();

    expect(watchSize(host)).toBe(1);
    await host.stop(handle.activationId);
    expect(watchSize(host)).toBe(0);
    // … and disposal clears THAT interval handle (deleting clearInterval alone fails this).
    expect(clearSpy).toHaveBeenCalledWith(timer);
    client.close();

    const rows = staleRows(dbPath, handle.activationId);
    expect(rows).toHaveLength(1);
    const body = rows[0]!.body.legacy_timeline_event as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'stale_warning',
      reason: 'tool_duration',
      silence_ms: 130_000,
      threshold_ms: 120_000,
      tool: 'bash',
    });
    expect(rows[0]!.attempt_id).toBe(handle.attemptId);
  });

  it('negative control: tool calls finishing inside the threshold warn nothing', async () => {
    let nowMs = 2_000_000;
    const { dbPath, client, sink } = isolatedStore();
    const session = fakeSession({ holdOpen: true });
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(session),
      cwd: hostWorkspace(),
      now: () => nowMs,
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });

    session.emit({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'call-1' });
    nowMs += 5_000;
    tick(host, handle.activationId);
    session.emit({ type: 'tool_execution_end', toolName: 'bash', toolCallId: 'call-1' });
    // Long after the call ended, still nothing: the watch died with the call.
    nowMs += 200_000;
    tick(host, handle.activationId, 2);

    await host.stop(handle.activationId);
    client.close();

    expect(staleRows(dbPath, handle.activationId)).toHaveLength(0);
  });

  it('the threshold is honoured, not hardcoded: 5s warns at 1s but not at 120s', async () => {
    const low = isolatedStore();
    const high = isolatedStore();
    let nowLow = 3_000_000;
    let nowHigh = 3_000_000;
    const sessionLow = fakeSession({ holdOpen: true });
    const sessionHigh = fakeSession({ holdOpen: true });
    const hostLow = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: low.sink,
      loadSdk: async () => makeSdk(sessionLow),
      cwd: hostWorkspace(),
      now: () => nowLow,
      stallDetection: { tool_duration_warn_ms: 1_000 },
    });
    const hostHigh = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: high.sink,
      loadSdk: async () => makeSdk(sessionHigh),
      cwd: hostWorkspace(),
      now: () => nowHigh,
    });

    const handleLow = await hostLow.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });
    const handleHigh = await hostHigh.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });

    sessionLow.emit({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'call-1' });
    sessionHigh.emit({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'call-1' });
    // 5_000ms sits between the two thresholds (1_000 and 120_000).
    nowLow += 5_000;
    nowHigh += 5_000;
    tick(hostLow, handleLow.activationId);
    tick(hostHigh, handleHigh.activationId);

    await hostLow.stop(handleLow.activationId);
    await hostHigh.stop(handleHigh.activationId);
    low.client.close();
    high.client.close();

    const lowRows = staleRows(low.dbPath, handleLow.activationId);
    expect(lowRows).toHaveLength(1);
    expect((lowRows[0]!.body.legacy_timeline_event as Record<string, unknown>).threshold_ms).toBe(1_000);
    expect(staleRows(high.dbPath, handleHigh.activationId)).toHaveLength(0);
  });

  it('a session replacement does not double-warn: one long call warns at most once', async () => {
    let nowMs = 4_000_000;
    const { dbPath, client, sink } = isolatedStore();
    const session = fakeSession({ holdOpen: true });
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(session),
      cwd: hostWorkspace(),
      now: () => nowMs,
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });

    session.emit({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'call-1' });
    nowMs += 130_000;
    tick(host, handle.activationId);
    expect(staleRows(dbPath, handle.activationId)).toHaveLength(1);

    // The exact three-line pattern every replacement site performs (fallback walk,
    // retry(), resume()): swap the session, resubscribe, touch nothing else. The
    // checker map is keyed to the activation, so it is neither rebuilt nor reset.
    const internals = host as unknown as {
      registry: {
        get: (id: string) => {
          snapshot: { activationId: string };
          session: PiAgentSessionLike;
          unsubscribe: () => void;
        };
      };
      onSessionEvent: (snapshot: unknown, event: PiAgentSessionEvent, emit: () => void) => void;
    };
    const record = internals.registry.get(handle.activationId);
    const session2 = fakeSession({ holdOpen: true });
    record.unsubscribe();
    record.session = session2;
    record.unsubscribe = session2.subscribe((event) =>
      internals.onSessionEvent(record.snapshot, event, () => {}),
    );

    nowMs += 130_000;
    tick(host, handle.activationId, 3);
    await host.stop(handle.activationId);
    client.close();

    expect(staleRows(dbPath, handle.activationId)).toHaveLength(1);
  });

  it('terminal settle stops the watch even when the tool never ended', async () => {
    let nowMs = 5_000_000;
    const { dbPath, client, sink } = isolatedStore();
    // The tool starts mid-turn and never ends (aborted tool): only the settle path
    // can clear the watch, via publishTerminalSettlement.
    const session = fakeSession({ toolStart: { toolName: 'bash', toolCallId: 'call-1' } });
    // Target 4: capture the arming call so the teardown assertion names OUR handle.
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(session),
      cwd: hostWorkspace(),
      now: () => nowMs,
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });
    const result = await handle.result;
    expect(result.status).toBe('completed');

    // Long after settle, a tick must not warn a dead activation — and the timer is gone.
    nowMs += 1_000_000;
    tick(host, handle.activationId);
    expect(watchSize(host)).toBe(0);
    // The settle path cleared the exact interval the arming created.
    const armed = armedHandles(setSpy);
    expect(armed).toHaveLength(1);
    expect(clearSpy).toHaveBeenCalledWith(armed[0]);
    client.close();

    expect(staleRows(dbPath, handle.activationId)).toHaveLength(0);
  });

  it('re-arming on a new call clears the previous timer (no orphaned interval)', async () => {
    let nowMs = 9_000_000;
    const { dbPath, client, sink } = isolatedStore();
    const session = fakeSession({ holdOpen: true });
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(session),
      cwd: hostWorkspace(),
      now: () => nowMs,
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });

    // First call arms; a second, different call replaces it (the first never ended).
    session.emit({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'call-1' });
    nowMs += 1_000;
    session.emit({ type: 'tool_execution_start', toolName: 'grep', toolCallId: 'call-2' });
    const armed = armedHandles(setSpy);
    expect(armed).toHaveLength(2);
    // The superseded interval was cleared — deleting that clearInterval fails this.
    expect(clearSpy).toHaveBeenCalledWith(armed[0]);
    expect(watchTimer(host, handle.activationId).hasRef()).toBe(false);

    // Only the second call is measured: 130s past ITS start warns once, for grep.
    nowMs += 130_000;
    tick(host, handle.activationId, 2);
    await host.stop(handle.activationId);
    expect(clearSpy).toHaveBeenCalledWith(armed[1]);
    client.close();

    const rows = staleRows(dbPath, handle.activationId);
    expect(rows).toHaveLength(1);
    const body = rows[0]!.body.legacy_timeline_event as Record<string, unknown>;
    expect(body).toMatchObject({ tool: 'grep', silence_ms: 130_000 });
  });

  it('the mapper arm defaults a missing reason to tool_duration (oracle payload shape)', () => {
    const mapped = mapNativeLifecycleEvent(
      {
        activationId: 'act:oracle-shape',
        specialist: 'researcher',
        beadId: 'bd-oracle',
        name: 'stale_warning',
        payload: { silence_ms: 1000, threshold_ms: 500 },
      },
      { startedAtMs: Date.now() },
      1000,
    );
    expect(mapped).not.toBeNull();
    expect(mapped).toMatchObject({ type: 'stale_warning', reason: 'tool_duration' });
  });

  it('projection consumption: a persisted tool_duration row fills stall_gaps_json', async () => {
    const { dbPath, client } = isolatedStore();
    const jobId = 'job:projection-probe';
    client.upsertStatus({
      id: jobId,
      specialist: 'researcher',
      status: 'running',
      bead_id: 'bd-probe',
      started_at_ms: Date.now(),
    } as never);
    client.appendEvent(
      jobId,
      'researcher',
      'bd-probe',
      createStaleWarningEvent('tool_duration', {
        silence_ms: 130_000,
        threshold_ms: 120_000,
        tool: 'bash',
      }) as never,
    );
    const metrics = client.aggregateJobMetrics(jobId);
    client.close();

    expect(metrics).not.toBeNull();
    const gaps = JSON.parse((metrics as unknown as { stall_gaps_json: string }).stall_gaps_json) as Array<
      Record<string, unknown>
    >;
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ tool: 'bash', silence_ms: 130_000, threshold_ms: 120_000 });
    expect(typeof gaps[0]!.t).toBe('number');
    void dbPath;
  });
});

describe('status.error projection (forensic-sink root-cause fix, PR #387 review)', () => {
  /**
   * The sink used to project EVERY payload `reason` onto status.error, so a warning
   * on a healthy activation wrote error:"tool_duration" onto a running row — which
   * status.ts prints in red on ANY status and result.ts consumes as failure text.
   * Legacy never does this (appendTimelineEvent never calls setStatus). The rule now:
   * `reason` counts as error text ONLY when the event moves the activation to error
   * status. These tests drive the REAL sink into an isolated store and read back the
   * status row (status_json) plus the forensic rows, proving the event was NOT
   * dropped — the error is absent while the evidence persists.
   */
  function startedSink(tag: string) {
    const { dbPath, client, sink } = isolatedStore();
    const activationId = `act:sink-${tag}`;
    const base = {
      activationId,
      attemptId: `att:sink-${tag}:1`,
      participantId: 'specialist::researcher',
      specialist: 'researcher',
      beadId: 'bd-sink',
    };
    sink.emit({ ...base, name: 'activation_started', payload: { pi_session_id: 'pi-1' } });
    return { dbPath, client, sink, base, activationId };
  }

  it('stale_warning leaves a running activation error-free (was error:"tool_duration")', () => {
    const { dbPath, client, sink, base, activationId } = startedSink('warn');
    sink.emit({
      ...base,
      name: 'stale_warning',
      payload: { reason: 'tool_duration', silence_ms: 130_000, threshold_ms: 120_000, tool: 'bash' },
    });
    client.close();

    const status = readStatus(dbPath, activationId);
    expect(status.status).toBe('running');
    expect(status.body.current_event).toBe('stale_warning');
    expect(status.body.error ?? null).toBeNull();
    // The warning itself still persists — absence of error is not absence of evidence.
    expect(staleRows(dbPath, activationId)).toHaveLength(1);
  });

  it('compaction_started leaves a running activation error-free (pre-existing conflation, fixed too)', () => {
    const { dbPath, client, sink, base, activationId } = startedSink('compact');
    sink.emit({ ...base, name: 'compaction_started', payload: { reason: 'context pressure' } });
    client.close();

    const status = readStatus(dbPath, activationId);
    expect(status.status).toBe('running');
    expect(status.body.error ?? null).toBeNull();
  });

  it('control: activation_failed STILL sets error (real errors are not suppressed)', () => {
    const { dbPath, client, sink, base, activationId } = startedSink('failed');
    sink.emit({ ...base, name: 'activation_failed', payload: { error: 'boom', stop_reason: 'error' } });
    client.close();

    const status = readStatus(dbPath, activationId);
    expect(status.status).toBe('error');
    expect(status.body.error).toBe('boom');
  });

  it('control: activation_rejected STILL sets error from reason (rejection reason IS the error)', () => {
    const { dbPath, client, sink, base, activationId } = startedSink('rejected');
    sink.emit({ ...base, name: 'activation_rejected', payload: { reason: 'nope', note: 'x' } });
    client.close();

    const status = readStatus(dbPath, activationId);
    expect(status.status).toBe('error');
    expect(status.body.error).toBe('nope');
  });
});

describe('spec-configured threshold parity (PR #387 review)', () => {
  function specWithThreshold(ms: number) {
    return {
      specialist: {
        metadata: { name: 'researcher', version: '1.0.0', description: 'd', category: 'c' },
        execution: {
          model: 'testprov/test-model',
          permission_required: 'READ_ONLY',
          response_format: 'text',
          output_type: 'research',
          bare: false,
        },
        prompt: { system: 'You are the researcher.', task_template: 'Do: {{bead_id}}' },
        // Same source legacy `sp run` reads (launch.ts:96 passes spec stall_detection
        // to the Supervisor): a configured threshold must reach native identically.
        stall_detection: { tool_duration_warn_ms: ms },
      },
    };
  }

  it('a spec-configured tool_duration_warn_ms is honoured with no host dep', async () => {
    let nowMs = 6_000_000;
    const { dbPath, client, sink } = isolatedStore();
    const session = fakeSession({ holdOpen: true });
    const host = new NativeActivationHost({
      loader: loaderFor(specWithThreshold(2_000)),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(session),
      cwd: hostWorkspace(),
      now: () => nowMs,
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });

    session.emit({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'call-1' });
    // 5_000ms exceeds the configured 2_000 but not the 120_000 default.
    nowMs += 5_000;
    tick(host, handle.activationId);
    await host.stop(handle.activationId);
    client.close();

    const rows = staleRows(dbPath, handle.activationId);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.body.legacy_timeline_event as Record<string, unknown>).threshold_ms).toBe(2_000);
  });

  it('a zero spec threshold passes through like legacy (warns once elapsed > 0)', async () => {
    let nowMs = 6_500_000;
    const { dbPath, client, sink } = isolatedStore();
    const session = fakeSession({ holdOpen: true });
    const host = new NativeActivationHost({
      loader: loaderFor(specWithThreshold(0)),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(session),
      cwd: hostWorkspace(),
      now: () => nowMs,
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });

    session.emit({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'call-1' });
    tick(host, handle.activationId);
    expect(staleRows(dbPath, handle.activationId)).toHaveLength(0);
    nowMs += 1;
    tick(host, handle.activationId, 2);
    await host.stop(handle.activationId);
    client.close();

    const rows = staleRows(dbPath, handle.activationId);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.body.legacy_timeline_event as Record<string, unknown>).threshold_ms).toBe(0);
  });

  it('an explicit host dep wins over the spec (operator/test override)', async () => {
    let nowMs = 7_000_000;
    const { dbPath, client, sink } = isolatedStore();
    const session = fakeSession({ holdOpen: true });
    const host = new NativeActivationHost({
      loader: loaderFor(specWithThreshold(500_000)),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(session),
      cwd: hostWorkspace(),
      now: () => nowMs,
      stallDetection: { tool_duration_warn_ms: 1_000 },
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });

    session.emit({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'call-1' });
    nowMs += 5_000;
    tick(host, handle.activationId);
    await host.stop(handle.activationId);
    client.close();

    const rows = staleRows(dbPath, handle.activationId);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.body.legacy_timeline_event as Record<string, unknown>).threshold_ms).toBe(1_000);
  });

  it('a resumed activation keeps its spec threshold under the new attempt', async () => {
    let nowMs = 8_000_000;
    const { dbPath, client, sink } = isolatedStore();
    const session = fakeSession();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithThreshold(2_000)),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(session),
      cwd: hostWorkspace(),
      now: () => nowMs,
    });

    // Leg 1 settles with no tool activity: no watch, no rows.
    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });
    expect((await handle.result).status).toBe('completed');
    expect(staleRows(dbPath, handle.activationId)).toHaveLength(0);

    // Leg 2 drives the REAL resume() site: the session is re-subscribed under a new
    // attempt id while the activation id (and its resolved threshold) survives.
    (session as unknown as { holdOpen: boolean }).holdOpen = true;
    const resumed = await host.resume(handle.activationId, 'follow-up findings');
    expect(resumed.attemptId).not.toBe(handle.attemptId);
    session.emit({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'call-2' });
    nowMs += 5_000;
    tick(host, handle.activationId, 3);
    await host.stop(handle.activationId);
    client.close();

    // Exactly one warning, attributed to the resumed leg (SPECIALISTS-113).
    const rows = staleRows(dbPath, handle.activationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempt_id).toBe(resumed.attemptId);
    expect(readRows(dbPath, handle.activationId)[0]!.attempt_id).toBe(handle.attemptId);
    expect((rows[0]!.body.legacy_timeline_event as Record<string, unknown>).threshold_ms).toBe(2_000);
    expect((rows[0]!.body.legacy_timeline_event as Record<string, unknown>).tool).toBe('bash');
  });
});

describe('native attempt attribution (SPECIALISTS-113)', () => {
  it.each(['retry', 'resume', 'resume after two Pi auto-retries'] as const)(
    '%s persists the host attempt on both timeline and forensic rows', async (entry) => {
      const { dbPath, client, sink } = isolatedStore();
      const session = fakeSession();
      const prompt = session.prompt.bind(session);
      const settlements = createMemorySettlementStore();
      let first = true;
      session.prompt = async (...args) => {
        if (first) {
          first = false;
          if (entry === 'retry') throw new Error('first leg failed');
          if (entry === 'resume after two Pi auto-retries') {
            for (const attempt of [1, 2]) {
              session.emit({ type: 'auto_retry_start', attempt, maxAttempts: 3, delayMs: 1 });
              session.emit({ type: 'auto_retry_end', attempt, success: true });
            }
          }
        }
        session.emit({ type: 'turn_start' });
        await prompt(...args);
      };
      const host = new NativeActivationHost({
        loader: loaderFor(readOnlySpec()), workItems: fakeWorkItems(), forensics: sink,
        loadSdk: async () => makeSdk(session), cwd: hostWorkspace(), settlements,
      });
      const raw = new Database(dbPath);
      const timeline = () => raw.query(
        'SELECT seq, type, attempt_id FROM specialist_events WHERE job_id = ? ORDER BY seq',
      ).all(handle.activationId) as Array<{ seq: number; type: string; attempt_id: string }>;
      const handle = await host.start({
        specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
      });
      try {
        expect((await handle.result).status).toBe(entry === 'retry' ? 'failed' : 'completed');
        const before = timeline();
        expect(before.length).toBeGreaterThan(0);
        const advanced = entry === 'retry'
          ? await host.retry(handle.activationId)
          : await host.resume(handle.activationId, 'second leg');
        const result = await advanced.result;
        expect(result.status).toBe('completed');
        expect(advanced.attemptId).toBe(handle.attemptId.replace(/:1$/, ':2'));
        const after = timeline().filter(row => row.seq > before.at(-1)!.seq);
        // Raw store evidence is opt-in, so ordinary suite output stays quiet.
        if (process.env.SPECIALISTS_ATTEMPT_EVIDENCE) {
          process.stdout.write(`${JSON.stringify({ entry, hostAttempt: advanced.attemptId, before, after })}\n`);
        }
        expect(after.length).toBeGreaterThan(0);
        expect(new Set(after.map(row => row.attempt_id))).toEqual(new Set([advanced.attemptId]));
        expect(timeline().slice(0, before.length)).toEqual(before);
        expect(new Set(before.map(row => row.attempt_id))).toEqual(new Set([handle.attemptId]));
        expect(after.some(row => row.type === 'turn')).toBe(true);
        expect(after.some(row => row.type === 'run_complete')).toBe(true);
        if (entry !== 'retry') expect(after.some(row => row.type === 'status_change')).toBe(true);
        const forensic = raw.query(
          'SELECT seq, attempt_id FROM specialist_forensic_events WHERE job_id = ? ORDER BY seq',
        ).all(handle.activationId);
        expect(forensic).toEqual(timeline().map(({ seq, attempt_id }) => ({ seq, attempt_id })));
        expect(raw.query(
          'SELECT attempt_no, attempt_id FROM specialist_jobs WHERE job_id = ?',
        ).get(handle.activationId)).toEqual({ attempt_no: 2, attempt_id: advanced.attemptId });
        expect(settlements.listAttempts(handle.activationId).map(row => row.attemptId).sort())
          .toEqual([handle.attemptId, advanced.attemptId].sort());
        expect(settlements.get(handle.activationId, advanced.attemptId)?.attemptId).toBe(result.attemptId);
        expect(readStatus(dbPath, handle.activationId).body.metrics).toMatchObject({
          auto_retries: entry === 'resume after two Pi auto-retries' ? 2 : 0,
        });
      } finally {
        await host.stop(handle.activationId);
        raw.close();
        client.close();
      }
    },
  );
});
