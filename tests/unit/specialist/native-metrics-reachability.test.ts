import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import type { PiAgentSessionEvent, PiAgentSessionLike, PiSdk } from '../../../src/activation/pi-sdk.js';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';
import { renderPrometheusProjection, validatePrometheusProjectionText } from '../../../src/specialist/prometheus-projection.js';
import type { SupervisorStatus } from '../../../src/specialist/supervisor.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';
import type { SpecialistWorkItemBoundary, WorkItemView } from '../../../src/activation/workitem-store.js';

/**
 * SPECIALISTS-107: a native activation that reaches a terminal state must produce
 * exactly one `specialist_job_metrics` row — same table, same columns, same
 * `ON CONFLICT(job_id) DO UPDATE` writer as legacy — so aggregate-metrics readers
 * (Prometheus, `sp db stats`) see the native backend.
 *
 * Fail-first shape: every row assertion below returned ZERO rows before the
 * forensic-sink terminal hook; the "zero rows" control is pinned by running this
 * file against the pre-change tree (git stash) and observing the empty reads.
 */

type FakeSession = PiAgentSessionLike & {
  emit: (event: PiAgentSessionEvent) => void;
  disposed: boolean;
};

function fakeSession(opts: { holdOpen?: boolean } = {}): FakeSession {
  const listeners: Array<(event: PiAgentSessionEvent) => void> = [];
  const messages: unknown[] = [];
  const session = {
    sessionId: 'pi-sess-metrics',
    messages,
    isIdle: true,
    disposed: false,
    activeTools: ['read', 'bash'],
    holdOpen: opts.holdOpen ?? false,
    async prompt() {
      listeners.forEach((l) => l({ type: 'agent_start' }));
      if (session.holdOpen) return new Promise<never>(() => {});
      messages.push({ role: 'assistant', content: 'done' });
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
  vi.restoreAllMocks();
});

function isolatedStore() {
  const root = mkdtempSync(join(tmpdir(), 'native-metrics-'));
  scratchDirs.push(root);
  const dbPath = join(root, 'observability.db');
  const client = createObservabilitySqliteClientAtPath(dbPath);
  if (!client) throw new Error('isolated store unavailable');
  return { dbPath, client, sink: createActivationForensicSink(client) };
}

function hostWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'native-metrics-ws-'));
  scratchDirs.push(root);
  return root;
}

interface MetricsRow {
  job_id: string;
  specialist: string;
  status: string;
  elapsed_ms: number | null;
  active_runtime_ms: number | null;
  waiting_ms: number | null;
  total_turns: number | null;
  total_tools: number | null;
  tool_call_counts_json: string | null;
  token_trajectory_json: string | null;
  context_trajectory_json: string | null;
  stall_gaps_json: string | null;
}

function readMetricsRows(dbPath: string, jobId: string): MetricsRow[] {
  const raw = new Database(dbPath);
  try {
    return raw.query('SELECT * FROM specialist_job_metrics WHERE job_id = ?').all(jobId) as MetricsRow[];
  } finally {
    raw.close();
  }
}

describe('native metrics reachability (SPECIALISTS-107)', () => {
  it('a completed native activation produces exactly one populated metrics row', async () => {
    const root = mkdtempSync(join(tmpdir(), 'native-metrics-'));
    scratchDirs.push(root);
    const dbPath = join(root, 'observability.db');
    const client = createObservabilitySqliteClientAtPath(dbPath);
    if (!client) throw new Error('isolated store unavailable');
    const sink = createActivationForensicSink(client);
    const session = fakeSession();
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(session),
      cwd: hostWorkspace(),
      now: () => 1_000_000,
    });
    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });
    const result = await handle.result;
    expect(result.status).toBe('completed');
    client.close();

    const rows = readMetricsRows(dbPath, handle.activationId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.specialist).toBe('researcher');
    // Terminal native status projects as `done` through the shared vocabulary.
    expect(row.status).toBe('done');
    expect(typeof row.elapsed_ms).toBe('number');
    expect(typeof row.active_runtime_ms).toBe('number');
    expect(typeof row.waiting_ms).toBe('number');
    expect((row.active_runtime_ms ?? 0) + (row.waiting_ms ?? 0)).toBeLessThanOrEqual(row.elapsed_ms ?? 0);
    // The fixture's assistant message arrives as TEXT + message_done usage rows, not as
    // a turn_summary row (no `turn_end` session event fires on this path), so the
    // turn/tool counters legitimately read zero. The populated durations + identity +
    // status below are the reachability proof; absence stays absence — nothing is
    // zero-filled into a shape the run never produced.
    expect(row.total_turns).toBe(0);
    expect(row.total_tools).toBe(0);
    expect(JSON.parse(row.tool_call_counts_json ?? '{}')).toEqual({});
    expect(JSON.parse(row.token_trajectory_json ?? '[]')).toEqual([]);
    expect(JSON.parse(row.context_trajectory_json ?? '[]')).toEqual([]);
    expect(JSON.parse(row.stall_gaps_json ?? '[]')).toEqual([]);
    expect(handle.activationId.startsWith('act:')).toBe(true);
  });

  it('aggregating the same activation twice neither duplicates nor drifts the row', async () => {
    const root = mkdtempSync(join(tmpdir(), 'native-metrics-idem-'));
    scratchDirs.push(root);
    const dbPath = join(root, 'observability.db');
    const client = createObservabilitySqliteClientAtPath(dbPath);
    if (!client) throw new Error('isolated store unavailable');
    const sink = createActivationForensicSink(client);
    const session = fakeSession();
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(session),
      cwd: hostWorkspace(),
      now: () => 2_000_000,
    });
    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });
    expect((await handle.result).status).toBe('completed');

    const first = client.aggregateJobMetrics(handle.activationId);
    const second = client.aggregateJobMetrics(handle.activationId);
    expect(first).toEqual(second);
    client.close();

    const raw = new Database(dbPath);
    try {
      const count = raw.query('SELECT COUNT(*) AS count FROM specialist_job_metrics WHERE job_id = ?').get(handle.activationId) as { count: number };
      expect(count.count).toBe(1);
    } finally {
      raw.close();
    }
  });

  it('a fixed legacy stream produces the same phase split as the pinned invariant (legacy unchanged)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'native-metrics-legacy-'));
    scratchDirs.push(root);
    const dbPath = join(root, 'observability.db');
    const client = createObservabilitySqliteClientAtPath(dbPath);
    if (!client) throw new Error('isolated store unavailable');
    client.upsertStatus({ id: 'legacy-pin', specialist: 'executor', status: 'done', started_at_ms: 1, last_event_at_ms: 5 });
    const events: Array<Record<string, unknown>> = [
      { t: 0, type: 'run_start', specialist: 'executor' },
      { t: 20000, type: 'status_change', status: 'waiting', previous_status: 'running' },
      { t: 40000, type: 'status_change', status: 'running', previous_status: 'waiting' },
      { t: 70000, type: 'run_complete', status: 'COMPLETE', elapsed_s: 70, model: 'test-model' },
    ];
    for (const event of events) client.appendEvent('legacy-pin', 'executor', 'bead-1', event as never);
    // EQ1 from the phase-accounting invariant file: the contract worked equation.
    const metrics = client.aggregateJobMetrics('legacy-pin');
    client.close();
    expect(metrics?.active_runtime_ms).toBe(50000);
    expect(metrics?.waiting_ms).toBe(20000);
  });

  it('the native row feeds the shared Prometheus projections with no label leak', async () => {
    const root = mkdtempSync(join(tmpdir(), 'native-metrics-prom-'));
    scratchDirs.push(root);
    const dbPath = join(root, 'observability.db');
    const client = createObservabilitySqliteClientAtPath(dbPath);
    if (!client) throw new Error('isolated store unavailable');
    const sink = createActivationForensicSink(client);
    const session = fakeSession();
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(session),
      cwd: hostWorkspace(),
      now: () => 3_000_000,
    });
    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });
    expect((await handle.result).status).toBe('completed');
    const stored = client.listJobMetrics();
    client.close();

    const native = stored.filter((record) => record.job_id === handle.activationId);
    expect(native).toHaveLength(1);
    const output = renderPrometheusProjection({
      repo: 'specialists',
      nowMs: 3_001_000,
      statuses: [
        { id: handle.activationId, specialist: 'researcher', status: 'done' } as unknown as SupervisorStatus,
      ],
      jobMetrics: stored,
    });
    expect(output).toContain('xtrm_job_active_runtime_seconds_bucket');
    expect(output).toContain('xtrm_job_wait_seconds_bucket');
    expect(validatePrometheusProjectionText(output)).toEqual({ ok: true });
    expect(output).not.toMatch(/job_id=|bead_id=|participant_id=|trace_id=/);
    expect(output).not.toContain(handle.activationId);
  });

  it('SPECIALISTS-108: elapsed_ms accumulates across rounds instead of keeping the last (312b6a shape)', async () => {
    // FAIL-FIRST anchor: on unmodified code this reads 10000 (last round wins) with
    // active + waiting (73,615,665) >> elapsed — the incoherent triple on 73% of rows.
    // After the change both rounds' elapsed_s=10 accumulate to 20000 while the phase
    // columns are byte-identical (the 106 boundary: this node never touches the split).
    const root = mkdtempSync(join(tmpdir(), 'native-metrics-108-'));
    scratchDirs.push(root);
    const dbPath = join(root, 'observability.db');
    const client = createObservabilitySqliteClientAtPath(dbPath);
    if (!client) throw new Error('isolated store unavailable');
    client.upsertStatus({ id: 'ff-312b6a', specialist: 'executor', status: 'done', started_at_ms: 1, last_event_at_ms: 5 });
    const events: Array<Record<string, unknown>> = [
      { t: 1782174047571, type: 'run_start', specialist: 'executor' },
      { t: 1782174051951, type: 'status_change', status: 'waiting', previous_status: 'running' },
      { t: 1782174057770, type: 'run_complete', status: 'COMPLETE', elapsed_s: 10, model: 'm' },
      { t: 1782174057928, type: 'status_change', status: 'waiting', previous_status: 'running' },
      { t: 1782247663394, type: 'run_complete', status: 'COMPLETE', elapsed_s: 10, model: 'm' },
    ];
    for (const event of events) client.appendEvent('ff-312b6a', 'executor', 'b', event as never);
    const metrics = client.aggregateJobMetrics('ff-312b6a');
    client.close();
    // Phase split is the hand-traced 106 value, unchanged by this node.
    expect(metrics?.active_runtime_ms).toBe(4380);
    expect(metrics?.waiting_ms).toBe(73611285);
    // ... while elapsed now covers both rounds instead of only the last.
    expect(metrics?.elapsed_ms).toBe(20000);
  });

  it('SPECIALISTS-108 degenerate input: zero-span and backwards streams stay non-negative', async () => {
    const root = mkdtempSync(join(tmpdir(), 'native-metrics-108-deg-'));
    scratchDirs.push(root);
    const dbPath = join(root, 'observability.db');
    const client = createObservabilitySqliteClientAtPath(dbPath);
    if (!client) throw new Error('isolated store unavailable');
    // Zero-span: a single instant round with elapsed_s=0 accumulates to 0, never negative.
    client.upsertStatus({ id: 'deg-zero', specialist: 'executor', status: 'done', started_at_ms: 1, last_event_at_ms: 5 });
    client.appendEvent('deg-zero', 'executor', 'b', { t: 5000, type: 'run_start', specialist: 'executor' } as never);
    client.appendEvent('deg-zero', 'executor', 'b', { t: 5000, type: 'run_complete', status: 'COMPLETE', elapsed_s: 0, model: 'm' } as never);
    const zero = client.aggregateJobMetrics('deg-zero');
    expect(zero?.elapsed_ms).toBe(0);
    // Backwards timestamps: accumulation clamps each round at zero via Math.max, so a
    // negative producer value can never drive the column negative.
    client.upsertStatus({ id: 'deg-neg', specialist: 'executor', status: 'done', started_at_ms: 1, last_event_at_ms: 5 });
    client.appendEvent('deg-neg', 'executor', 'b', { t: 9000, type: 'run_start', specialist: 'executor' } as never);
    client.appendEvent('deg-neg', 'executor', 'b', { t: 9000, type: 'run_complete', status: 'COMPLETE', elapsed_s: -5, model: 'm' } as never);
    const neg = client.aggregateJobMetrics('deg-neg');
    client.close();
    expect(neg?.elapsed_ms).toBe(0);
    expect((neg?.elapsed_ms ?? -1)).toBeGreaterThanOrEqual(0);
  });

  it('a stopped activation still materialises a row (no terminal lifecycle event exists on that path)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'native-metrics-stop-'));
    scratchDirs.push(root);
    const dbPath = join(root, 'observability.db');
    const client = createObservabilitySqliteClientAtPath(dbPath);
    if (!client) throw new Error('isolated store unavailable');
    const sink = createActivationForensicSink(client);
    const session = fakeSession({ holdOpen: true });
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(session),
      cwd: hostWorkspace(),
      now: () => 4_000_000,
    });
    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });
    await host.stop(handle.activationId);
    client.close();

    const rows = readMetricsRows(dbPath, handle.activationId);
    expect(rows).toHaveLength(1);
  });
});
