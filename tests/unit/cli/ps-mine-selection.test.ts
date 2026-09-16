// XTRM-93 N3 (SPECIALISTS-104, residual of unitAI-kmbb9): `sp ps --mine` on the
// native activation block.
//
// THE COUNTEREXAMPLE THIS FILE REPRODUCES. PR #380 made native selection
// activation-first and pushed --bead/--since into the id selection, but left
// --mine as a filter over the post-limit survivors. With N = 20 and more than
// 20 newer non-matching activations, a real matching activation sitting below
// the bound can never be reached:
//
//   positions 1..25  foreign activations (newer)
//   positions 26..27 this operator's activations (older)
//     -> select latest 20        (the bound is applied HERE)
//     -> post-filter --mine      (can only REMOVE; never recovers 26..27)
//     -> []
//
// The second defect meets it: the ownership predicate was resolved with
// `bd query 'assignee=me'`, which is not a supported token (`bd query --help`
// documents `assignee=<user>` and `assignee=none`) and therefore SUCCEEDS with
// an empty array even when the operator has assignments. The empty set was read
// as "you own nothing" and hard-excluded everything, while the documented
// no-op fallback never fired.
//
// These tests bind the ps.ts CALL SITE, not only the reader: they assert that
// the ownership pre-image reaches `listNativeActivationIds` and that the
// reference to the Beads result cannot influence the native block.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

const bdSpawnSync = vi.fn(() => ({ status: 0, stdout: '[]', stderr: '', error: undefined, pid: 1, signal: null, output: [] }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: (...args: unknown[]) => bdSpawnSync(...(args as [])) };
});

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

const NOW = Date.now();
const HOUR = 3_600_000;
const MINE_IDS = ['act:mine-a', 'act:mine-b'] as const;
const FOREIGN_COUNT = 25;

let nextId = 0;
let mockRows: FakeRow[] = [];
const mockJobMeta = new Map<string, { updated_at_ms: number; bead_id?: string }>();

function addRow(jobId: string, name: string, t: number, beadId: string): void {
  nextId += 1;
  mockRows.push({
    id: nextId,
    job_id: jobId,
    seq: nextId,
    t,
    schema_version: 'xtrm.forensic.v1',
    event_family: 'job',
    event_name: name,
    participant_kind: 'specialist',
    participant_role: 'executor',
    participant_id: 'specialist::executor',
    attempt_id: `att:${jobId}:1`,
    redaction_status: 'clean',
    event_json: JSON.stringify({
      schema_version: 'xtrm.forensic.v1',
      t_unix_ms: t,
      event_family: 'job',
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
        bead_id: beadId,
        attempt_id: `att:${jobId}:1`,
        pi_session_id: 'pi-mine-1',
        session_id: 'pi-mine-1',
      },
      body: {},
      redaction: { status: 'clean' },
    }),
  });
}

function buildScenario(): void {
  mockRows = [];
  mockJobMeta.clear();
  nextId = 0;
  // 25 foreign activations, all NEWER than this operator's two.
  for (let i = 1; i <= FOREIGN_COUNT; i += 1) {
    const index = String(i).padStart(2, '0');
    const jobId = `act:foreign-${index}`;
    const beadId = `unitAI-foreign-${index}`;
    const at = NOW - 5 * 60_000 + i * 1000;
    mockJobMeta.set(jobId, { updated_at_ms: at, bead_id: beadId });
    addRow(jobId, 'job.started', at, beadId);
    addRow(jobId, 'job.completed', at + 10, beadId);
  }
  // This operator's two activations, OLDER than every foreign one.
  MINE_IDS.forEach((jobId, index) => {
    const beadId = `unitAI-mine-${index === 0 ? 'a' : 'b'}`;
    const at = NOW - 30 * 60_000 + index;
    mockJobMeta.set(jobId, { updated_at_ms: at, bead_id: beadId });
    addRow(jobId, 'job.started', at, beadId);
    addRow(jobId, 'job.completed', at + 10, beadId);
  });
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
  listNativeActivationIds: vi.fn(),
  readForensicEvents: vi.fn(() => []),
  readForensicEventsForActivations: vi.fn(),
};

interface FakeIdFilters {
  limit?: number;
  sinceMs?: number;
  beadId?: string;
  activationIds?: readonly string[];
}

function setupMockImplementations(): void {
  // Faithful stand-in for the real SQL: every predicate is applied BEFORE the
  // bound, and an empty pre-image selects nothing (not everything).
  mockNativeSqlite.listNativeActivationIds.mockImplementation((filters: FakeIdFilters = {}) => {
    if (filters.activationIds !== undefined && filters.activationIds.length === 0) return [];
    const preImage = filters.activationIds === undefined ? undefined : new Set(filters.activationIds);
    const limit = Math.max(1, Math.min(filters.limit ?? 20, 100));
    return [...mockJobMeta.entries()]
      .filter(([jobId, meta]) =>
        (filters.sinceMs === undefined || meta.updated_at_ms >= filters.sinceMs)
        && (filters.beadId === undefined || meta.bead_id === filters.beadId)
        && (preImage === undefined || preImage.has(jobId)))
      .sort((a, b) => b[1].updated_at_ms - a[1].updated_at_ms)
      .slice(0, limit)
      .map(([jobId]) => jobId);
  });
  mockNativeSqlite.readForensicEventsForActivations.mockImplementation(
    (jobIds?: readonly string[], filters?: { sinceMs?: number }) => {
      if (!jobIds || jobIds.length === 0) return [];
      const wanted = new Set(jobIds);
      return mockRows
        .filter((row) => wanted.has(row.job_id) && (filters?.sinceMs === undefined || row.t >= filters.sinceMs))
        .sort(descByTime);
    },
  );
}

vi.mock('../../../src/specialist/observability-sqlite.js', () => ({
  createObservabilitySqliteClient: vi.fn(() => mockNativeSqlite),
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

interface PsJson {
  native_activations: Array<{ activation_id: string; bead_id?: string }>;
  native_activations_note: string;
  native_activation_filters?: {
    mine: { requested: boolean; applied: boolean; reason?: string };
  };
}

describe('ps --mine native activation selection (SPECIALISTS-104)', () => {
  const TEST_TIMEOUT_MS = 20_000;
  const originalArgv = process.argv;
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let tempDir = '';
  let authorityDbPath = '';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'specialists-ps-mine-'));
    process.chdir(tempDir);
    mkdirSync(join(tempDir, '.specialists', 'jobs'), { recursive: true });
    buildScenario();
    setupMockImplementations();
    vi.clearAllMocks();

    // A real authority store holding this operator's claims. The resolver reads
    // it end-to-end; nothing about ownership is mocked.
    authorityDbPath = join(tempDir, 'authority.db');
    const db = new Database(authorityDbPath);
    db.run('CREATE TABLE issue_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, issue_id TEXT NOT NULL, holder TEXT NOT NULL, activation_id TEXT NULL, released_at INTEGER NULL, generation INTEGER NOT NULL)');
    let generation = 0;
    for (const jobId of MINE_IDS) {
      generation += 1;
      db.query('INSERT INTO issue_claims (issue_id, holder, activation_id, released_at, generation) VALUES (?, ?, ?, ?, ?)')
        .run(`iss_${generation}`, 'session-mine', jobId, null, generation);
    }
    for (let i = 1; i <= FOREIGN_COUNT; i += 1) {
      generation += 1;
      db.query('INSERT INTO issue_claims (issue_id, holder, activation_id, released_at, generation) VALUES (?, ?, ?, ?, ?)')
        .run(`iss_${generation}`, 'session-other', `act:foreign-${String(i).padStart(2, '0')}`, null, generation);
    }
    db.close();

    process.env.SUBSTRATE_DB = authorityDbPath;
    delete process.env.XTRM_SESSION_ID;
    delete process.env.XTRM_SESSION_NAME;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function runPs(flags: string[]): Promise<PsJson> {
    process.argv = ['node', 'specialists', 'ps', ...flags, '--json'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    return JSON.parse(output.join('\n')) as PsJson;
  }

  function nativeIds(parsed: PsJson): string[] {
    return parsed.native_activations.map((entry) => entry.activation_id);
  }

  it('returns matching activations that sit BELOW the bound (fail-first starvation)', async () => {
    // The failure mode this pins: ownership is not part of the candidate set,
    // so >N newer foreign activations consume the whole window and the two
    // matching activations at positions 26-27 are unreachable.
    process.env.XTRM_SESSION_NAME = 'session-mine';
    const parsed = await runPs(['--mine']);

    expect(nativeIds(parsed).sort()).toEqual([...MINE_IDS].sort());
    // The pre-image reached the SELECTION, not a post-filter over survivors.
    expect(mockNativeSqlite.listNativeActivationIds).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, activationIds: expect.arrayContaining([...MINE_IDS]) }),
    );
    // Presentation/post-selection filtering is gone: nothing removes a
    // candidate after the bound.
    expect(nativeIds(parsed)).toHaveLength(2);
  });

  it('proves the Beads assignee result cannot decide the native block', async () => {
    process.env.XTRM_SESSION_NAME = 'session-mine';
    // `bd query 'assignee=me'` returns [] on this board — the measured cause of
    // the old hard-empty. It must no longer be able to empty the native block.
    expect(bdSpawnSync).toBeDefined();
    const parsed = await runPs(['--mine']);
    expect(nativeIds(parsed).sort()).toEqual([...MINE_IDS].sort());
  });

  it('composes --mine with --since (both are selection predicates)', async () => {
    process.env.XTRM_SESSION_NAME = 'session-mine';
    const within = await runPs(['--mine', '--since', '1d']);
    expect(nativeIds(within).sort()).toEqual([...MINE_IDS].sort());

    // Matching activations older than the window are genuinely out of it —
    // --since is a real predicate, not a post-filter over the bounded set.
    const outside = await runPs(['--mine', '--since', '1m']);
    expect(nativeIds(outside)).toEqual([]);
    expect(mockNativeSqlite.listNativeActivationIds).toHaveBeenCalledWith(
      expect.objectContaining({ sinceMs: expect.any(Number), activationIds: expect.arrayContaining([...MINE_IDS]) }),
    );
  });

  it('composes --mine with --bead (intersection, evaluated before the bound)', async () => {
    process.env.XTRM_SESSION_NAME = 'session-mine';
    const parsed = await runPs(['--mine', '--bead', 'unitAI-mine-a']);
    expect(nativeIds(parsed)).toEqual(['act:mine-a']);
    expect(mockNativeSqlite.listNativeActivationIds).toHaveBeenCalledWith(
      expect.objectContaining({ beadId: 'unitAI-mine-a', activationIds: expect.arrayContaining([...MINE_IDS]) }),
    );
  });

  it('resolves a holder with zero claims to an EMPTY block, not an unavailable filter', async () => {
    // Resolved-to-empty is a real answer — this holder owns nothing — and must
    // stay distinguishable from "ownership could not be resolved".
    process.env.XTRM_SESSION_NAME = 'session-nobody';

    const parsed = await runPs(['--mine']);

    expect(parsed.native_activations).toEqual([]);
    expect(parsed.native_activation_filters).toEqual({ mine: { requested: true, applied: true } });
    expect(parsed.native_activations_note).toBe('LAST-KNOWN state from forensics, not live registry state.');
    expect(mockNativeSqlite.listNativeActivationIds).toHaveBeenCalledWith(
      expect.objectContaining({ activationIds: [] }),
    );
  });

  it('FAILS CLOSED when the holder cannot be resolved: --mine selects nothing', async () => {
    // No XTRM_SESSION_NAME/XTRM_SESSION_ID: the measured state of an ordinary
    // `sp ps` invocation. Ownership is UNKNOWN, so the conjunct is unknown, so
    // the candidate set is empty. An explicitly requested filter is never
    // dropped.
    const parsed = await runPs(['--mine']);

    expect(parsed.native_activations).toEqual([]);
    expect(parsed.native_activation_filters).toEqual({
      mine: { requested: true, applied: false, reason: 'no_session_identity' },
    });
    expect(parsed.native_activations_note).toContain('--mine could not be evaluated for native activations');
    expect(parsed.native_activations_note).toContain('No native activations are shown');
    // The pre-existing prefix is still the prefix: current consumers of
    // native_activations_note keep working.
    expect(parsed.native_activations_note).toContain('LAST-KNOWN state from forensics, not live registry state.');
  });

  it('MUTATION GUARD: unavailable ownership must not degrade into an unfiltered selection', async () => {
    // The dangerous simplification is "no identity -> drop the predicate and
    // return the latest window". That still shows SOME data, so a naive "did
    // --mine return anything" test passes while the output asserts that 20
    // unrelated activations satisfy --mine. Pin the shape, not just emptiness.
    const unfiltered = await runPs([]);
    const filtered = await runPs(['--mine']);

    // Behavioural: the window this mutant would have leaked is real and
    // non-empty, and the fail-closed result is not it.
    expect(nativeIds(unfiltered)).toHaveLength(20);
    expect(nativeIds(filtered)).toEqual([]);
    expect(nativeIds(filtered)).not.toEqual(nativeIds(unfiltered));

    // Shape: the unconstrained selection is precisely this call, and no filter
    // can be evaluated without it having been made.
    vi.clearAllMocks();
    await runPs(['--mine']);
    expect(mockNativeSqlite.listNativeActivationIds).toHaveBeenCalledTimes(0);
    expect(mockNativeSqlite.readForensicEventsForActivations).toHaveBeenCalledTimes(0);
  });

  it('reports the --mine filter status even when the observability store is UNAVAILABLE', async () => {
    // A fresh machine: no observability store. The filter status describes the
    // REQUEST, so a bare `[]` with no status would reintroduce exactly the
    // ambiguity this node removes — a consumer could not tell "your store is
    // empty" from "your filter was never evaluated".
    // `mockReturnValue` (not `Once`): loadStatuses/epic-readiness reach the
    // same factory first, so a one-shot override is consumed before the native
    // block is ever built.
    const { createObservabilitySqliteClient } = await import('../../../src/specialist/observability-sqlite.js');
    process.env.XTRM_SESSION_NAME = 'session-mine';
    vi.mocked(createObservabilitySqliteClient).mockReturnValue(null as never);
    try {
      const parsed = await runPs(['--mine']);

      expect(parsed.native_activations).toEqual([]);
      expect(parsed.native_activation_filters).toEqual({ mine: { requested: true, applied: true } });
    } finally {
      vi.mocked(createObservabilitySqliteClient).mockReturnValue(mockNativeSqlite as never);
    }
  });

  it('decides fail-closed BEFORE the observability store is consulted', async () => {
    // Ordering: an unresolvable --mine must not depend on the store at all, so
    // that the status it reports is the filter's failure and not a store
    // artifact.
    const parsed = await runPs(['--mine']);

    expect(parsed.native_activations).toEqual([]);
    expect(parsed.native_activation_filters).toEqual({
      mine: { requested: true, applied: false, reason: 'no_session_identity' },
    });
    expect(mockNativeSqlite.listNativeActivationIds).toHaveBeenCalledTimes(0);
    // The store was opened (it is available here) but never used to select.
    expect(mockNativeSqlite.readForensicEventsForActivations).toHaveBeenCalledTimes(0);
  });

  it('states in HUMAN output that --mine could not be evaluated, and shows no activations', async () => {
    process.argv = ['node', 'specialists', 'ps', '--mine'];
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');

    expect(clean).toContain('Native activations');
    expect(clean).toContain('note: --mine could not be evaluated for native activations');
    expect(clean).toContain('No native activations are shown');
    // The activations that an unfiltered read WOULD have produced are absent —
    // a human must not be able to mistake "could not filter" for "yours are
    // here".
    expect(clean).not.toContain('act:foreign-25');
    expect(clean).not.toContain('act:mine-a');
  });

  it('leaves the unfiltered and --bead-only paths unchanged', async () => {
    const plain = await runPs([]);
    expect(nativeIds(plain)).toHaveLength(20);
    expect(nativeIds(plain)).not.toContain('act:mine-a');
    expect(plain.native_activations_note).toBe('LAST-KNOWN state from forensics, not live registry state.');

    // --bead is a selection predicate: a bead whose activation is older than
    // the bound still resolves.
    const byBead = await runPs(['--bead', 'unitAI-mine-b']);
    expect(nativeIds(byBead)).toEqual(['act:mine-b']);
  });
});
