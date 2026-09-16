// XTRM-93 N3 (unitAI-kmbb9): sp ps must enumerate the latest-N ACTIVATIONS,
// not the latest-1000 event rows. Fail-first regression: one very noisy
// activation (1200 rows, all newer than the quiet ones) plus three quiet
// activations (2 rows each). The old row-capped reader
// (readForensicEvents({jobIdPrefix:'act:', limit:1000, order:'desc'})) returns
// only noisy rows, so the quiet activations are absent. The fixed reader
// selects activation ids first (listNativeActivationIds) and then fetches
// their events, so every activation is present. This test binds the ps.ts
// CALL SITE (not just the sqlite reader): it fails while ps.ts calls the
// row-capped path and passes only when ps.ts calls the id-first path.
// A retired-family row (event_family='activation', no specialist_jobs row,
// no attempt_id — the frozen 2026-09-08 vocabulary) is also present and must
// never render as a current activation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface FakeRow {
  id: number;
  job_id: string;
  seq: number;
  t: number;
  schema_version: string;
  event_family: string;
  event_name: string;
  participant_kind: string;
  participant_role: string;
  participant_id: string;
  attempt_id: string | null;
  redaction_status: string;
  event_json: string;
}

const T0 = 1_788_900_000_000;
let nextId = 0;

// specialist_jobs stand-in: updated_at_ms ordering drives id selection.
const mockJobMeta = new Map<string, { updated_at_ms: number; bead_id?: string }>();
let mockRows: FakeRow[] = [];

function mockEventJson(jobId: string, family: string, name: string, t: number, beadId?: string): string {
  return JSON.stringify({
    schema_version: 'xtrm.forensic.v1',
    t_unix_ms: t,
    event_family: family,
    event_name: name,
    resource: {
      service_namespace: 'xtrm',
      service_name: 'specialists',
      service_component: 'runtime',
      participant_kind: 'specialist',
      participant_role: 'executor',
    },
    correlation: {
      participant_id: 'specialist::executor',
      job_id: jobId,
      ...(beadId ? { bead_id: beadId } : {}),
      attempt_id: `att:${jobId}:1`,
      pi_session_id: 'pi-starve-1',
      session_id: 'pi-starve-1',
    },
    body: {},
    redaction: { status: 'clean' },
  });
}

function addRow(jobId: string, family: string, name: string, t: number, opts: { attemptId?: string | null; beadId?: string } = {}): void {
  nextId += 1;
  mockRows.push({
    id: nextId,
    job_id: jobId,
    seq: nextId,
    t,
    schema_version: 'xtrm.forensic.v1',
    event_family: family,
    event_name: name,
    participant_kind: 'specialist',
    participant_role: 'executor',
    participant_id: 'specialist::executor',
    attempt_id: opts.attemptId === undefined ? `att:${jobId}:1` : opts.attemptId,
    redaction_status: 'clean',
    event_json: mockEventJson(jobId, family, name, t, opts.beadId),
  });
}

function buildScenario(): void {
  mockJobMeta.clear();
  mockRows = [];
  nextId = 0;
  // One very noisy activation: 1200 shared-vocabulary rows, ALL newer than
  // every quiet row, so the newest-1000 event window holds only noisy rows.
  const noisy = 'act:noisy-1200';
  mockJobMeta.set(noisy, { updated_at_ms: T0 + 50, bead_id: 'unitAI-noisy' });
  addRow(noisy, 'job', 'job.started', T0 + 1000, { beadId: 'unitAI-noisy' });
  for (let i = 0; i < 1198; i += 1) {
    addRow(noisy, 'turn', 'turn.summarized', T0 + 1001 + i, { beadId: 'unitAI-noisy' });
  }
  addRow(noisy, 'job', 'job.completed', T0 + 2199, { beadId: 'unitAI-noisy' });
  // Three quiet activations: 2 rows each, older events but NEWER job rows
  // (settled after the noisy activation started, as in the live store where
  // quiet activations sit beneath noisy ones in event order).
  const quiets = ['act:quiet-a1', 'act:quiet-b2', 'act:quiet-c3'] as const;
  quiets.forEach((jobId, index) => {
    mockJobMeta.set(jobId, { updated_at_ms: T0 + 2100 + index, bead_id: `unitAI-quiet-${index}` });
    addRow(jobId, 'job', 'job.started', T0 + 100 + index, { beadId: `unitAI-quiet-${index}` });
    addRow(jobId, 'job', 'job.completed', T0 + 101 + index, { beadId: `unitAI-quiet-${index}` });
  });
  // Retired vocabulary: activation-family rows with NO job row and NO
  // attempt_id. Must never render as current.
  addRow('act:retired-9', 'activation', 'activation.activation_started', T0 - 5000, { attemptId: null });
  addRow('act:retired-9', 'activation', 'activation.activation_completed', T0 - 4999, { attemptId: null });
}

function descByTime(a: FakeRow, b: FakeRow): number {
  return b.t - a.t || b.seq - a.seq || b.id - a.id;
}

const mockNativeSqlite = {
  listStatuses: vi.fn(() => []),
  listEpicRuns: vi.fn(() => []),
  readEpicRun: vi.fn(() => null),
  listEpicChains: vi.fn(() => []),
  readEvents: vi.fn(() => []),
  close: vi.fn(),
  // New id-first selection: latest-N activation ids by job-row recency.
  listNativeActivationIds: vi.fn(),
  // Legacy row-capped reader, faithfully emulated: prefix range, newest-first,
  // ROW limit. With the scenario above the newest 1000 rows are all noisy.
  readForensicEvents: vi.fn(),
  // New per-activation fetch: all events for the selected ids, no row cap.
  readForensicEventsForActivations: vi.fn(),
};

function setupMockImplementations(): void {
  mockNativeSqlite.listNativeActivationIds.mockImplementation((filters?: { limit?: number; sinceMs?: number }) => {
    const limit = filters?.limit ?? 20;
    return [...mockJobMeta.entries()]
      .filter(([, meta]) => filters?.sinceMs === undefined || meta.updated_at_ms >= filters.sinceMs)
      .sort((a, b) => b[1].updated_at_ms - a[1].updated_at_ms)
      .slice(0, limit)
      .map(([jobId]) => jobId);
  });
  mockNativeSqlite.readForensicEvents.mockImplementation((filters?: { jobId?: string; jobIdPrefix?: string; sinceMs?: number; eventFamily?: string; limit?: number; order?: string }) => {
    if (filters?.eventFamily === 'activation') {
      return mockRows.filter((row) => row.event_family === 'activation');
    }
    if (filters?.jobId) {
      return mockRows.filter((row) => row.job_id === filters.jobId
        && (filters.sinceMs === undefined || row.t >= filters.sinceMs));
    }
    if (filters?.jobIdPrefix) {
      return mockRows
        .filter((row) => row.job_id.startsWith(filters.jobIdPrefix!)
          && (filters.sinceMs === undefined || row.t >= filters.sinceMs))
        .sort(descByTime)
        .slice(0, filters.limit ?? 1000);
    }
    return [];
  });
  mockNativeSqlite.readForensicEventsForActivations.mockImplementation((jobIds?: readonly string[], filters?: { sinceMs?: number }) => {
    if (!jobIds || jobIds.length === 0) return [];
    const wanted = new Set(jobIds);
    return mockRows
      .filter((row) => wanted.has(row.job_id)
        && (filters?.sinceMs === undefined || row.t >= filters.sinceMs))
      .sort(descByTime);
  });
}

vi.mock('../../../src/specialist/observability-sqlite.js', () => ({
  createObservabilitySqliteClient: () => mockNativeSqlite,
}));
vi.mock('../../../src/specialist/process-health.js', () => ({
  collectProcessHealth: () => ({
    status: 'OK',
    statusReasons: [],
    memAvailableBytes: 1024,
    totalRssBytes: 1,
    totalCpuPct: 0,
    specialistCount: 0,
    doltCount: 0,
    serenaLspCount: 0,
    orphanCount: 0,
    thresholdPct: 25,
    warnPct: 70,
    refusePct: 85,
    warnLimitBytes: 1,
    refuseLimitBytes: 2,
    specialistProcesses: [],
    doltProcesses: [],
    serenaWorkspaces: [],
    orphanProcesses: [],
  }),
}));

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('ps native starvation (unitAI-kmbb9)', () => {
  const TEST_TIMEOUT_MS = 20_000;
  const originalArgv = process.argv;
  const originalCwd = process.cwd();
  let tempDir = '';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'specialists-ps-starve-'));
    process.chdir(tempDir);
    mkdirSync(join(tempDir, '.specialists', 'jobs'), { recursive: true });
    buildScenario();
    setupMockImplementations();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('shows quiet activations alongside a noisy one instead of starving them', async () => {
    process.argv = ['node', 'specialists', 'ps', '--json'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const parsed = JSON.parse(output.join('\n')) as {
      native_activations: Array<{ activation_id: string }>;
    };
    const ids = parsed.native_activations.map((entry) => entry.activation_id);
    // The noisy activation is present ...
    expect(ids).toContain('act:noisy-1200');
    // ... and the quiet ones are NOT starved by its 1200 rows.
    expect(ids).toContain('act:quiet-a1');
    expect(ids).toContain('act:quiet-b2');
    expect(ids).toContain('act:quiet-c3');
    // The retired vocabulary never renders as current work.
    expect(ids).not.toContain('act:retired-9');
  }, TEST_TIMEOUT_MS);

  it('selects activations id-first and never queries the retired family', async () => {
    process.argv = ['node', 'specialists', 'ps'];
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    // Binds the ps.ts call site to the id-first selection (fails while ps.ts
    // uses the row-capped readForensicEvents prefix query).
    expect(mockNativeSqlite.listNativeActivationIds).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20 }),
    );
    expect(mockNativeSqlite.readForensicEventsForActivations).toHaveBeenCalledWith(
      expect.arrayContaining(['act:noisy-1200', 'act:quiet-a1']),
      expect.anything(),
    );
    // The retired event_family='activation' vocabulary is never queried ...
    for (const call of mockNativeSqlite.readForensicEvents.mock.calls) {
      expect((call[0] as { eventFamily?: string } | undefined)?.eventFamily).not.toBe('activation');
    }
    for (const call of mockNativeSqlite.readForensicEventsForActivations.mock.calls) {
      expect(JSON.stringify(call[0] ?? [])).not.toContain('act:retired-9');
    }
    const clean = stripAnsi(lines.join('\n'));
    expect(clean).toContain('act:quiet-a1');
    expect(clean).not.toContain('act:retired-9');
  }, TEST_TIMEOUT_MS);
});
