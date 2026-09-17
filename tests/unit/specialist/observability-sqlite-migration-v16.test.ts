// tests/unit/specialist/observability-sqlite-migration-v16.test.ts
//
// SPECIALISTS-120 validation: migration V16 must be additive and idempotent on an EXISTING
// observability database — every pre-V16 row survives, the new columns are nullable, and the
// aggregation populates them from the recorded timeline events.
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createObservabilitySqliteClientAtPath,
  initSchema,
} from '../../../src/specialist/observability-sqlite.js';
import type { ObservabilitySqliteClient } from '../../../src/specialist/observability-sqlite.js';
import type { SupervisorStatus } from '../../../src/specialist/status-contract.js';
import type { TimelineEvent } from '../../../src/specialist/timeline-events.js';

const V16_COLUMNS = [
  'cost_total',
  'session_stats_json',
  'usage_reconciliation_json',
  'pi_version',
  'context_pct_source',
] as const;

function columnsOf(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

function schemaVersions(db: Database): number[] {
  return (db.query('SELECT version FROM schema_version ORDER BY version').all() as Array<{ version: number }>)
    .map((row) => row.version);
}

/**
 * Build a pre-V16 database the way a long-lived operator's copy looks: the metrics table
 * exists WITHOUT the V16 columns, and schema_version stops at 15.
 */
function seedLegacyDatabase(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    db.run(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at_ms INTEGER NOT NULL);
      CREATE TABLE specialist_jobs (
        job_id TEXT PRIMARY KEY,
        specialist TEXT NOT NULL,
        worktree_column TEXT,
        bead_id TEXT,
        node_id TEXT,
        chain_kind TEXT NOT NULL DEFAULT 'prep',
        chain_id TEXT,
        chain_root_job_id TEXT,
        chain_root_bead_id TEXT,
        epic_id TEXT,
        status TEXT NOT NULL,
        status_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        last_output TEXT,
        startup_payload_json TEXT
      );
      CREATE TABLE specialist_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        specialist TEXT NOT NULL,
        bead_id TEXT,
        t INTEGER NOT NULL,
        type TEXT NOT NULL,
        event_json TEXT NOT NULL
      );
      CREATE TABLE specialist_results (
        job_id TEXT PRIMARY KEY,
        output TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE specialist_job_metrics (
        job_id TEXT PRIMARY KEY,
        specialist TEXT NOT NULL,
        model TEXT,
        status TEXT NOT NULL,
        chain_kind TEXT,
        chain_id TEXT,
        bead_id TEXT,
        node_id TEXT,
        epic_id TEXT,
        started_at_ms INTEGER,
        completed_at_ms INTEGER,
        elapsed_ms INTEGER,
        active_runtime_ms INTEGER,
        waiting_ms INTEGER,
        total_turns INTEGER NOT NULL DEFAULT 0,
        total_tools INTEGER NOT NULL DEFAULT 0,
        tool_call_counts_json TEXT NOT NULL,
        token_trajectory_json TEXT NOT NULL,
        context_trajectory_json TEXT NOT NULL,
        stall_gaps_json TEXT NOT NULL,
        run_complete_json TEXT,
        startup_payload_json TEXT,
        updated_at_ms INTEGER NOT NULL
      );
      INSERT INTO specialist_jobs (job_id, specialist, status, status_json, updated_at_ms)
        VALUES ('job-legacy', 'executor', 'done', '{"status":"done"}', 1000);
      INSERT INTO specialist_job_metrics (
        job_id, specialist, model, status, tool_call_counts_json, token_trajectory_json,
        context_trajectory_json, stall_gaps_json, total_turns, total_tools, updated_at_ms
      ) VALUES ('job-legacy', 'executor', 'glm-5.3-flash', 'done', '{}', '[]', '[]', '[]', 3, 7, 1000);
      INSERT INTO specialist_events (job_id, seq, specialist, t, type, event_json)
        VALUES ('job-legacy', 1, 'executor', 900, 'token_usage', '{"t":900,"type":"token_usage","source":"turn_end","token_usage":{"input_tokens":10}}');
    `);
    for (let version = 1; version <= 15; version += 1) {
      db.run('INSERT INTO schema_version (version, applied_at_ms) VALUES (?, 0)', [version]);
    }
  } finally {
    db.close();
  }
}

describe('observability sqlite migration V16 (SPECIALISTS-120)', () => {
  let tempRoot: string;
  let dbPath: string;
  let db: Database | null = null;
  let client: ObservabilitySqliteClient | null = null;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `specialists-v16-${crypto.randomUUID()}`);
    mkdirSync(tempRoot, { recursive: true });
    dbPath = join(tempRoot, 'observability.db');
  });

  afterEach(() => {
    if (client) {
      try { client.close(); } catch { /* ignore */ }
      client = null;
    }
    if (db) {
      try { db.close(); } catch { /* ignore */ }
      db = null;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('adds the V16 columns to a legacy metrics table without losing existing rows', () => {
    seedLegacyDatabase(dbPath);
    db = new Database(dbPath);
    expect(columnsOf(db, 'specialist_job_metrics')).not.toContain('cost_total');

    initSchema(db);

    expect(columnsOf(db, 'specialist_job_metrics')).toEqual(expect.arrayContaining([...V16_COLUMNS]));
    expect(schemaVersions(db)).toContain(16);

    // The pre-existing row survives, and every new column reads NULL — "not reported" —
    // never a fabricated zero.
    const row = db.query('SELECT * FROM specialist_job_metrics WHERE job_id = ?').get('job-legacy') as Record<string, unknown>;
    expect(row.total_turns).toBe(3);
    expect(row.total_tools).toBe(7);
    for (const column of V16_COLUMNS) {
      expect(row[column], `${column} must be NULL on a pre-V16 row`).toBeNull();
    }
    const legacyUsageEvent = db.query('SELECT event_json FROM specialist_events WHERE job_id = ?').get('job-legacy') as { event_json: string };
    expect(JSON.parse(legacyUsageEvent.event_json).token_usage.input_tokens).toBe(10);
  });

  it('is idempotent: a second open neither drops data nor re-runs destructively', () => {
    seedLegacyDatabase(dbPath);
    db = new Database(dbPath);
    initSchema(db);
    initSchema(db);
    db.close();
    db = null;

    // Re-open through the real client path, i.e. exactly what a running process does.
    const reopened = new Database(dbPath);
    db = reopened;
    initSchema(reopened);
    expect(schemaVersions(reopened).filter((version) => version === 16)).toHaveLength(1);
    const row = reopened.query('SELECT * FROM specialist_job_metrics WHERE job_id = ?').get('job-legacy') as Record<string, unknown>;
    expect(row.total_tools).toBe(7);
  });

  it('a fresh database gets the V16 columns from the start', () => {
    db = new Database(dbPath);
    initSchema(db);
    expect(columnsOf(db, 'specialist_job_metrics')).toEqual(expect.arrayContaining([...V16_COLUMNS]));
    expect(schemaVersions(db)).toContain(16);
  });

  it('aggregation populates cost, session stats, reconciliation, pi_version and context source', () => {
    seedLegacyDatabase(dbPath);
    client = createObservabilitySqliteClientAtPath(dbPath);
    expect(client).not.toBeNull();

    const jobId = 'job-120';
    const status: SupervisorStatus = {
      id: jobId,
      specialist: 'executor',
      status: 'done',
      model: 'zai/glm-5.3-flash',
      started_at_ms: 2_000,
      last_event_at_ms: 2_400,
    };
    const events: TimelineEvent[] = [
      { t: 2_000, type: 'run_start', specialist: 'executor' },
      {
        t: 2_050,
        type: 'turn_summary',
        turn_index: 1,
        context_pct: 0.22,
        context_pct_source: 'specialists_fallback',
      } as unknown as TimelineEvent,
      {
        t: 2_100,
        type: 'session_stats',
        source: 'settlement',
        session_stats: {
          sessionId: 'sess-120',
          tokens: { input: 2142, output: 16, cacheRead: 0, cacheWrite: 0, total: 2158 },
          cost: 0.00016465,
          contextUsage: { tokens: 2158, contextWindow: 1_000_000, percent: 0.2158 },
        },
      } as unknown as TimelineEvent,
      {
        t: 2_300,
        type: 'run_complete',
        status: 'COMPLETE',
        elapsed_s: 0.4,
        model: 'zai/glm-5.3-flash',
        pi_version: '0.85.1',
        metrics: {
          cost: { total: 0.00016465 },
          session_stats: {
            sessionId: 'sess-120',
            tokens: { input: 2142, output: 16, cacheRead: 0, cacheWrite: 0, total: 2158 },
            cost: 0.00016465,
          },
          reconciliation: {
            reconciled: true,
            cost_compared: true,
            fields: { total: { summed: 2158, session_stats: 2158, delta: 0 } },
          },
          pi_version: '0.85.1',
        },
      } as unknown as TimelineEvent,
    ];

    client!.upsertStatusWithEvents(status, events);
    const metrics = client!.aggregateJobMetrics(jobId);
    expect(metrics).not.toBeNull();

    expect(metrics!.cost_total).toBeCloseTo(0.00016465, 10);
    expect(metrics!.pi_version).toBe('0.85.1');
    // Pi's own context reading supersedes the labelled fallback recorded earlier.
    expect(metrics!.context_pct_source).toBe('pi_session_stats');
    expect(JSON.parse(metrics!.session_stats_json!).tokens.total).toBe(2158);
    const reconciliation = JSON.parse(metrics!.usage_reconciliation_json!);
    expect(reconciliation.reconciled).toBe(true);
    expect(reconciliation.fields.total.delta).toBe(0);
  });

  it('leaves the V16 columns NULL when a run reported no session stats', () => {
    seedLegacyDatabase(dbPath);
    client = createObservabilitySqliteClientAtPath(dbPath);
    expect(client).not.toBeNull();

    const jobId = 'job-nostats';
    client!.upsertStatusWithEvents(
      { id: jobId, specialist: 'executor', status: 'done', started_at_ms: 3_000, last_event_at_ms: 3_100 },
      [{ t: 3_050, type: 'run_complete', status: 'COMPLETE', elapsed_s: 0.1 } as unknown as TimelineEvent],
    );

    const metrics = client!.aggregateJobMetrics(jobId);
    expect(metrics).not.toBeNull();
    expect(metrics!.cost_total).toBeNull();
    expect(metrics!.session_stats_json).toBeNull();
    expect(metrics!.usage_reconciliation_json).toBeNull();
    expect(metrics!.pi_version).toBeNull();
    expect(existsSync(dbPath)).toBe(true);
  });
});
