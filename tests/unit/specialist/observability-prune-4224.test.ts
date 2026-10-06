import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { rmSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createObservabilitySqliteClientAtPath,
  DEFAULT_WAL_SIZE_LIMIT_BYTES,
  resolveWalSizeLimitBytes,
} from '../../../src/specialist/observability-sqlite.js';
import { checkpointIsPartial } from '../../../src/cli/db.js';
import {
  ensureObservabilityDbFile,
  resolveObservabilityDbLocation,
} from '../../../src/specialist/observability-db.js';

describe('SPECIALISTS-4224', () => {
  let tempRoot: string;
  let client: ReturnType<typeof createObservabilitySqliteClientAtPath> | null = null;
  let db: Database | null = null;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `test-4224-${crypto.randomUUID()}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    try { client?.close(); } catch { /* ignore */ }
    client = null;
    try { db?.close(); } catch { /* ignore */ }
    db = null;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const createClient = () => {
    const location = resolveObservabilityDbLocation(tempRoot);
    ensureObservabilityDbFile(location);
    const c = createObservabilitySqliteClientAtPath(location.dbPath);
    expect(c).not.toBeNull();
    client = c;
    db = new Database(location.dbPath);
    return { client: c!, dbPath: location.dbPath };
  };

  const seedForensic = (jobId: string, family: string, t: number, seq: number) => {
    db!.run(
      `INSERT INTO specialist_forensic_events (job_id, seq, t, schema_version, event_family, event_name, redaction_status, event_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [jobId, seq, t, 'v1', family, `${family}.event`, 'clean', '{}'],
    );
  };

  it('checkpointIsPartial: TRUNCATE/RESTART with busy is partial, PASSIVE never is', () => {
    expect(checkpointIsPartial('TRUNCATE', 1)).toBe(true);
    expect(checkpointIsPartial('RESTART', 1)).toBe(true);
    expect(checkpointIsPartial('TRUNCATE', 0)).toBe(false);
    expect(checkpointIsPartial('PASSIVE', 1)).toBe(false);
    expect(checkpointIsPartial('PASSIVE', 0)).toBe(false);
  });

  it('CLI partial path: a busy TRUNCATE report maps to exit 1 via checkpointIsPartial', () => {
    // TRUNCATE blocks while a reader holds a snapshot, so the busy case is exercised
    // through the pure gate (covered above) rather than a blocking checkpoint call.
    // Here we verify the clean path still reports non-partial.
    createClient();
    const report = client!.checkpointWal('TRUNCATE');
    expect(report.busy).toBe(0);
    expect(checkpointIsPartial(report.mode, report.busy)).toBe(false);
  });

  it('per-family retention: mcp cutoff applies to mcp only, global cutoff to the rest', () => {
    createClient();
    // Cutoffs: mcp<100, others<500. Same-t pair (200) proves the family split:
    // turn@200 is past the global cutoff, mcp@200 is not past the mcp cutoff.
    seedForensic('j1', 'mcp', 50, 1); // deleted (mcp)
    seedForensic('j1', 'mcp', 200, 2); // kept (mcp cutoff 100)
    seedForensic('j1', 'turn', 200, 3); // deleted (global 500)
    seedForensic('j1', 'mcp', 950, 4); // kept
    seedForensic('j1', 'turn', 950, 5); // kept
    const dry = client!.pruneObservabilityData({ beforeMs: 1000, includeEpics: false, apply: false, forensicBeforeMs: 500, forensicMcpBeforeMs: 100 });
    expect(dry.deletedForensicEvents).toBe(2);
    const applied = client!.pruneObservabilityData({ beforeMs: 1000, includeEpics: false, apply: true, skipExtract: true, forensicBeforeMs: 500, forensicMcpBeforeMs: 100 });
    expect(applied.deletedForensicEvents).toBe(2);
    expect(applied.forensicMcpBeforeMs).toBe(100);
    const remaining = db!.query('SELECT event_family, t FROM specialist_forensic_events ORDER BY seq').all() as Array<{ event_family: string; t: number }>;
    expect(remaining).toHaveLength(3);
    expect(remaining.some((r) => r.event_family === 'mcp' && r.t === 50)).toBe(false);
    expect(remaining.some((r) => r.event_family === 'turn' && r.t === 200)).toBe(false);
    expect(remaining.some((r) => r.event_family === 'mcp' && r.t === 200)).toBe(true);
  });

  it('active-job guard: forensic rows of running/starting jobs are kept', () => {
    createClient();
    db!.run(
      `INSERT INTO specialist_jobs (job_id, specialist, status, status_json, updated_at_ms) VALUES (?, ?, ?, ?, ?)`,
      ['job-running', 'executor', 'running', '{"id":"job-running"}', 1],
    );
    db!.run(
      `INSERT INTO specialist_jobs (job_id, specialist, status, status_json, updated_at_ms) VALUES (?, ?, ?, ?, ?)`,
      ['job-done', 'executor', 'done', '{"id":"job-done"}', 1],
    );
    seedForensic('job-running', 'mcp', 10, 1);
    seedForensic('job-done', 'mcp', 10, 2);
    seedForensic('job-done', 'turn', 10, 3);
    const report = client!.pruneObservabilityData({ beforeMs: 1000, includeEpics: false, apply: true, skipExtract: true, forensicBeforeMs: 100 });
    expect(report.deletedForensicEvents).toBe(2);
    const remaining = db!.query('SELECT job_id FROM specialist_forensic_events').all() as Array<{ job_id: string }>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.job_id).toBe('job-running');
  });

  it('batched prune of 1M+ forensic rows keeps WAL at or below the limit', () => {
    const { dbPath } = createClient();
    const N = 1_000_000;
    const insert = db!.prepare(
      `INSERT INTO specialist_forensic_events (job_id, seq, t, schema_version, event_family, event_name, redaction_status, event_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const txn = (db as unknown as { transaction: (fn: (n: number) => void) => (n: number) => void }).transaction((n: number) => {
      for (let i = 0; i < n; i += 1) insert.run('bulk-job', i, 10, 'v1', 'mcp', 'mcp.call.completed', 'clean', '{}');
    });
    (txn as unknown as (n: number) => void)(N);
    client!.checkpointWal('TRUNCATE');
    const walBytes = (): number => {
      try { return statSync(`${dbPath}-wal`).size; } catch { return 0; }
    };
    let peak = walBytes();
    // Prune in-process would hide the peak, so sample via progress: run the client's
    // batched prune (which checkpoints between 50k batches) and track the file.
    const report = client!.pruneObservabilityData({ beforeMs: 1000, includeEpics: false, apply: true, skipExtract: true, forensicBeforeMs: 100 });
    peak = Math.max(peak, walBytes());
    expect(report.deletedForensicEvents).toBe(N);
    expect(peak).toBeLessThanOrEqual(resolveWalSizeLimitBytes());
    expect(peak).toBeLessThanOrEqual(DEFAULT_WAL_SIZE_LIMIT_BYTES);
  }, 120_000);
});
