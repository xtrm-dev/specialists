// XTRM-93 N3 (unitAI-kmbb9): pins for the activation-first selection.
// Uses a real observability database through the real writer (upsertStatus +
// appendEvent), so writer and reader cannot drift apart silently.
//
// Scenario: one very noisy activation (1200 shared-vocabulary rows, all newer
// than every quiet row) plus three quiet activations (3 rows each) whose job
// rows are NEWER (upserted after the noisy one). The old row-capped reader
// (readForensicEvents({jobIdPrefix:'act:', limit:1000, order:'desc'})) sees
// only noisy rows; the id-first selection (listNativeActivationIds +
// readForensicEventsForActivations) sees every activation.
//
// Also pins: the activation-count bound, the --bead pushdown, the retired
// event_family='activation' disposition (excluded as obsolete: no job row, no
// attempt_id, frozen pre-febef0ad vocabulary), and the index-backed plan.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createObservabilitySqliteClientAtPath,
} from '../../../src/specialist/observability-sqlite.js';
import { createForensicEvent } from '../../../src/specialist/forensic-events.js';
import { summarizeNativeActivations } from '../../../src/specialist/native-activation-summary.js';
import {
  ensureObservabilityDbFile,
  resolveObservabilityDbLocation,
} from '../../../src/specialist/observability-db.js';

describe('native activation selection (unitAI-kmbb9)', () => {
  let tempRoot = '';
  let db: Database | null = null;
  let sqliteClient: ReturnType<typeof createObservabilitySqliteClientAtPath> | null = null;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `test-native-selection-${crypto.randomUUID()}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    if (sqliteClient) {
      try { sqliteClient.close(); } catch { /* ignore */ }
      sqliteClient = null;
    }
    if (db) {
      try { db.close(); } catch { /* ignore */ }
      db = null;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const createClient = () => {
    const location = resolveObservabilityDbLocation(tempRoot);
    ensureObservabilityDbFile(location);
    const client = createObservabilitySqliteClientAtPath(location.dbPath);
    expect(client).not.toBeNull();
    sqliteClient = client;
    return { client: client!, dbPath: location.dbPath };
  };

  const upsertJob = (client: NonNullable<typeof sqliteClient>, jobId: string, beadId: string) => {
    client.upsertStatus({
      id: jobId,
      specialist: 'executor',
      status: 'running',
      bead_id: beadId,
      started_at_ms: Date.now(),
      updated_at_ms: Date.now(),
    } as never);
  };

  const appendTimeline = (client: NonNullable<typeof sqliteClient>, jobId: string, beadId: string, t: number, type: string, extra: Record<string, unknown> = {}) => {
    client.appendEvent(jobId, 'executor', beadId, { t, type, specialist: 'executor', bead_id: beadId, ...extra } as never);
  };

  // Builds the starvation scenario; returns the shared time base.
  const buildScenario = (client: NonNullable<typeof sqliteClient>) => {
    const base = Date.now();
    // Noisy activation first (older job row), then the quiet ones (newer job
    // rows). The noisy EVENTS are all newer than every quiet event.
    upsertJob(client, 'act:sel-noisy', 'unitAI-sel-noisy');
    appendTimeline(client, 'act:sel-noisy', 'unitAI-sel-noisy', base + 1000, 'run_start');
    for (let i = 0; i < 1198; i += 1) {
      appendTimeline(client, 'act:sel-noisy', 'unitAI-sel-noisy', base + 1001 + i, 'turn_summary', { turn_index: i + 1 });
    }
    appendTimeline(client, 'act:sel-noisy', 'unitAI-sel-noisy', base + 2199, 'run_complete', { status: 'COMPLETE', elapsed_s: 2 });
    const quiets = ['act:sel-quiet-a', 'act:sel-quiet-b', 'act:sel-quiet-c'] as const;
    quiets.forEach((jobId, index) => {
      upsertJob(client, jobId, `unitAI-sel-quiet-${index}`);
      appendTimeline(client, jobId, `unitAI-sel-quiet-${index}`, base + 100 + index * 2, 'run_start');
      appendTimeline(client, jobId, `unitAI-sel-quiet-${index}`, base + 101 + index * 2, 'turn_summary', { turn_index: 1 });
      appendTimeline(client, jobId, `unitAI-sel-quiet-${index}`, base + 102 + index * 2, 'run_complete', { status: 'COMPLETE', elapsed_s: 1 });
    });
    // Retired vocabulary: activation-family rows with NO job row and NO
    // attempt_id — the frozen 2026-09-08 shape. Written via the public
    // forensic API without any upsertStatus, so no specialist_jobs row exists.
    for (const [seq, name] of [[1, 'activation.activation_started'], [2, 'activation.activation_completed']] as const) {
      client.appendForensicEvent('act:sel-retired', 'explorer', undefined, createForensicEvent({
        event_family: 'activation',
        event_name: name,
        seq,
        t_unix_ms: base - 5000 + seq,
        resource: {
          service_namespace: 'xtrm',
          service_name: 'specialists',
          service_component: 'runtime',
          participant_kind: 'specialist',
          participant_role: 'explorer',
        },
        correlation: { participant_id: 'specialist::explorer', job_id: 'act:sel-retired' },
        body: {},
      }));
    }
    return { base, quiets };
  };

  it('documents the old row-cap starvation: newest-1000 rows hide the quiet activations', () => {
    const { client } = createClient();
    const { quiets } = buildScenario(client);
    const rows = client.readForensicEvents({ jobIdPrefix: 'act:', limit: 1000, order: 'desc' });
    expect(rows).toHaveLength(1000);
    const summaries = summarizeNativeActivations(rows);
    expect(summaries.map((s) => s.activation_id)).toEqual(['act:sel-noisy']);
    for (const quiet of quiets) {
      expect(summaries.map((s) => s.activation_id)).not.toContain(quiet);
    }
  });

  it('selects the latest-N activation ids first, then fetches every one of their events', () => {
    const { client } = createClient();
    const { quiets } = buildScenario(client);
    const ids = client.listNativeActivationIds({ limit: 20 });
    expect(ids).toContain('act:sel-noisy');
    for (const quiet of quiets) expect(ids).toContain(quiet);
    // Retired forensic-only rows have no job row: excluded as obsolete.
    expect(ids).not.toContain('act:sel-retired');

    const rows = client.readForensicEventsForActivations(ids);
    const summaries = summarizeNativeActivations(rows);
    const byId = new Map(summaries.map((s) => [s.activation_id, s]));
    // Full histories, not window truncations: 1200 noisy, 3 per quiet.
    expect(byId.get('act:sel-noisy')?.window_event_count).toBe(1200);
    expect(byId.get('act:sel-noisy')?.window_turns).toBe(1198);
    for (const quiet of quiets) {
      expect(byId.get(quiet)?.window_event_count).toBe(3);
      expect(byId.get(quiet)?.state).toBe('completed');
    }
    expect(byId.has('act:sel-retired')).toBe(false);
  });

  it('bounds activation count, not event count, and pushes --bead into the id selection', () => {
    const { client } = createClient();
    buildScenario(client);
    const all = client.listNativeActivationIds({ limit: 20 });
    expect(all).toHaveLength(4);
    const two = client.listNativeActivationIds({ limit: 2 });
    expect(two).toHaveLength(2);
    // The bound slices the same newest-first ordering (self-consistent).
    expect(two).toEqual(all.slice(0, 2));
    // --bead returns that bead's latest activations even when they sit
    // beneath the global noisy ones.
    expect(client.listNativeActivationIds({ limit: 20, beadId: 'unitAI-sel-quiet-1' })).toEqual(['act:sel-quiet-b']);
    expect(client.listNativeActivationIds({ limit: 20, beadId: 'unitAI-sel-noisy' })).toEqual(['act:sel-noisy']);
  });

  it('serves the id selection from an index (SEARCH, never SCAN)', () => {
    const { dbPath } = createClient();
    db = new Database(dbPath, { readonly: true });
    const idPlan = db.query(
      "EXPLAIN QUERY PLAN SELECT job_id FROM specialist_jobs WHERE job_id >= 'act:' AND job_id < 'act;' ORDER BY updated_at_ms DESC LIMIT 20",
    ).all() as Array<Record<string, unknown>>;
    const idPlanText = JSON.stringify(idPlan);
    expect(idPlanText).toContain('SEARCH');
    expect(idPlanText).not.toContain('SCAN');
    // Stage 2 touches only the selected activations' rows, not the table.
    const eventPlan = db.query(
      'EXPLAIN QUERY PLAN SELECT id FROM specialist_forensic_events WHERE job_id IN (?, ?, ?, ?) ORDER BY t DESC, seq DESC, id DESC',
    ).all('act:sel-noisy', 'act:sel-quiet-a', 'act:sel-quiet-b', 'act:sel-quiet-c') as Array<Record<string, unknown>>;
    const eventPlanText = JSON.stringify(eventPlan);
    expect(eventPlanText).toContain('SEARCH');
    expect(eventPlanText).not.toContain('SCAN');
  });

  // XTRM-93 N3 (SPECIALISTS-104): the candidate pre-image. Ownership is
  // resolved OUTSIDE SQL (Substrate issue_claims), so the reader takes it as an
  // id set. It is evaluated in the WHERE clause, i.e. BEFORE the bound — which
  // is the whole point: a predicate applied to the post-limit survivors can
  // only remove candidates and can never recover an older matching activation.
  describe('candidate pre-image (activationIds)', () => {
    it('restricts the selection to the pre-image, still bounded and newest-first', () => {
      const { client } = createClient();
      const { quiets } = buildScenario(client);

      const preImage = [quiets[0], 'act:not-in-the-store'];
      const ids = client.listNativeActivationIds({ limit: 20, activationIds: preImage });
      expect(ids).toEqual([quiets[0]]);

      // The pre-image is a WHERE clause, not a post-slice: it composes with
      // the bound and the ordering rather than being applied afterwards. The
      // input order is deliberately wrong, so the result order can only come
      // from the query.
      const bounded = client.listNativeActivationIds({ limit: 20, activationIds: [quiets[1], quiets[2]] });
      expect(bounded).toEqual([quiets[2], quiets[1]]);
    });

    it('selects NOTHING for an empty pre-image (never everything)', () => {
      const { client } = createClient();
      buildScenario(client);
      // A resolved predicate that matched no activation is a real answer. It
      // must not degrade into "unconstrained", which is what turns an unknown
      // owner into a hard-excluded block or a silently unfiltered one.
      expect(client.listNativeActivationIds({ limit: 20, activationIds: [] })).toEqual([]);
    });

    it('composes the pre-image with --since and --bead before the bound', () => {
      const { client } = createClient();
      const { base, quiets } = buildScenario(client);
      const ids = client.listNativeActivationIds({
        limit: 20,
        sinceMs: base - 10_000,
        beadId: 'unitAI-sel-quiet-1',
        activationIds: [quiets[0], quiets[1]],
      });
      expect(ids).toEqual([quiets[1]]);
    });

    it('is index-backed for the IN-list form (SEARCH, never SCAN)', () => {
      const { dbPath } = createClient();
      db = new Database(dbPath, { readonly: true });
      const plan = db.query(
        "EXPLAIN QUERY PLAN SELECT job_id FROM specialist_jobs WHERE job_id >= 'act:' AND job_id < 'act;' AND job_id IN (?, ?) ORDER BY updated_at_ms DESC LIMIT 20",
      ).all('act:sel-quiet-a', 'act:sel-quiet-b') as Array<Record<string, unknown>>;
      const planText = JSON.stringify(plan);
      expect(planText).toContain('SEARCH');
      expect(planText).not.toContain('SCAN');
    });

    it('tolerates a pre-image far larger than any observed claim holder', () => {
      const { client } = createClient();
      const { quiets } = buildScenario(client);
      // The largest single Substrate claim holder carries 54 activations today;
      // this proves the one-flat-IN-list shape has real headroom rather than
      // silently relying on small data.
      const bulk = Array.from({ length: 2_000 }, (_, index) => `act:absent-${index}`);
      const ids = client.listNativeActivationIds({ limit: 20, activationIds: [...bulk, ...quiets] });
      expect(ids.sort()).toEqual([...quiets].sort());
    });
  });
});
