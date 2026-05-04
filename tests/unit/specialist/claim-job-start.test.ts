import { afterEach, describe, expect, it } from 'vitest';
import { rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimJobStartWithStore, STALE_CLAIM_AGE_MS } from '../../../src/specialist/observability-sqlite.js';

describe('claimJobStart', () => {
  let tempRoot = '';

  afterEach(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = '';
  });

  function createStore() {
    tempRoot = join(tmpdir(), `sp-claim-${crypto.randomUUID()}`);
    mkdirSync(tempRoot, { recursive: true });

    type Row = { job_id: string; status: string; pid?: number; updated_at_ms?: number };
    const activeJobs = new Map<string, Row>();
    const events: Array<{ jobId: string; specialist: string; beadId?: string }> = [];
    const cancelled: string[] = [];

    return {
      transaction<T>(callback: () => T): T {
        return callback();
      },
      findActiveJob(beadId: string | null, specialist: string) {
        return activeJobs.get(`${beadId ?? 'null'}:${specialist}`);
      },
      writeStatusRow(status: { id: string; specialist: string; bead_id?: string; status: string; pid?: number }) {
        activeJobs.set(`${status.bead_id ?? 'null'}:${status.specialist}`, {
          job_id: status.id,
          status: status.status,
          pid: status.pid,
          updated_at_ms: Date.now(),
        });
      },
      writeEventRow(jobId: string, specialist: string, beadId: string | undefined) {
        events.push({ jobId, specialist, beadId });
      },
      cancelStaleClaim(jobId: string) {
        cancelled.push(jobId);
        for (const [key, row] of activeJobs.entries()) {
          if (row.job_id === jobId) {
            activeJobs.delete(key);
            break;
          }
        }
      },
      /** Test-only: seed a row directly without going through writeStatusRow. */
      _seed(beadId: string | null, specialist: string, row: Row) {
        activeJobs.set(`${beadId ?? 'null'}:${specialist}`, row);
      },
      events,
      cancelled,
    };
  }

  it('lets first claim win and rejects duplicate bead+specialist claim', async () => {
    const store = createStore();
    const now = Date.now();
    const event = { t: now, type: 'run_start', specialist: 'executor', bead_id: 'bead-x' } as never;

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => claimJobStartWithStore(store, {
        id: 'job-a',
        specialist: 'executor',
        status: 'starting',
        started_at_ms: now,
        pid: 101,
        bead_id: 'bead-x',
      } as never, event)),
      Promise.resolve().then(() => claimJobStartWithStore(store, {
        id: 'job-b',
        specialist: 'executor',
        status: 'starting',
        started_at_ms: now,
        pid: 102,
        bead_id: 'bead-x',
      } as never, event)),
    ]);

    expect(first).toEqual({ ok: true });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.existingJobId).toBe('job-a');
      expect(second.existingStatus).toBe('starting');
    }
  });

  it('reports real existingJobId and existingStatus on refusal (no undefined)', () => {
    const store = createStore();
    const now = Date.now();
    const event = { t: now, type: 'run_start', specialist: 'executor', bead_id: 'bead-msg' } as never;

    // Seed a fresh active row.
    store._seed('bead-msg', 'executor', {
      job_id: 'job-existing',
      status: 'running',
      pid: process.pid, // alive — not stale-eligible
      updated_at_ms: now,
    });

    const result = claimJobStartWithStore(store, {
      id: 'job-new',
      specialist: 'executor',
      status: 'starting',
      started_at_ms: now,
      pid: 999_999,
      bead_id: 'bead-msg',
    } as never, event);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.existingJobId).toBe('job-existing');
      expect(result.existingStatus).toBe('running');
      expect(result.existingJobId).not.toContain('undefined');
      expect(result.existingStatus).not.toContain('undefined');
    }
  });

  it('reclaims orphan starting row when prior pid is dead and row is stale', () => {
    const store = createStore();
    const now = Date.now();
    const event = { t: now, type: 'run_start', specialist: 'executor', bead_id: 'bead-orphan' } as never;

    store._seed('bead-orphan', 'executor', {
      job_id: 'job-orphan',
      status: 'starting',
      pid: 1, // unlikely to be alive; we'll force isPidAlive=false anyway
      updated_at_ms: now - (STALE_CLAIM_AGE_MS + 1000), // beyond stale threshold
    });

    const result = claimJobStartWithStore(
      store,
      {
        id: 'job-fresh',
        specialist: 'executor',
        status: 'starting',
        started_at_ms: now,
        pid: 12345,
        bead_id: 'bead-orphan',
      } as never,
      event,
      { isPidAlive: () => false, nowMs: () => now },
    );

    expect(result).toEqual({ ok: true });
    expect(store.cancelled).toContain('job-orphan');
  });

  it('refuses claim when prior pid is alive even if row is stale', () => {
    const store = createStore();
    const now = Date.now();
    const event = { t: now, type: 'run_start', specialist: 'executor', bead_id: 'bead-alive' } as never;

    store._seed('bead-alive', 'executor', {
      job_id: 'job-alive',
      status: 'running',
      pid: 4242,
      updated_at_ms: now - (STALE_CLAIM_AGE_MS + 5000),
    });

    const result = claimJobStartWithStore(
      store,
      {
        id: 'job-new',
        specialist: 'executor',
        status: 'starting',
        started_at_ms: now,
        pid: 5555,
        bead_id: 'bead-alive',
      } as never,
      event,
      { isPidAlive: (pid) => pid === 4242, nowMs: () => now },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.existingJobId).toBe('job-alive');
    }
    expect(store.cancelled).toEqual([]);
  });

  it('refuses claim when prior row is recent even if pid is dead', () => {
    const store = createStore();
    const now = Date.now();
    const event = { t: now, type: 'run_start', specialist: 'executor', bead_id: 'bead-recent' } as never;

    store._seed('bead-recent', 'executor', {
      job_id: 'job-recent',
      status: 'starting',
      pid: 99999,
      updated_at_ms: now - 1000, // 1s old, under threshold
    });

    const result = claimJobStartWithStore(
      store,
      {
        id: 'job-new',
        specialist: 'executor',
        status: 'starting',
        started_at_ms: now,
        pid: 5555,
        bead_id: 'bead-recent',
      } as never,
      event,
      { isPidAlive: () => false, nowMs: () => now },
    );

    expect(result.ok).toBe(false);
    expect(store.cancelled).toEqual([]);
  });

  it('returns ok when self-claim repeats', () => {
    const store = createStore();
    const now = Date.now();
    const event = { t: now, type: 'run_start', specialist: 'executor', bead_id: 'bead-y' } as never;

    const first = claimJobStartWithStore(store, {
      id: 'job-self',
      specialist: 'executor',
      status: 'starting',
      started_at_ms: now,
      pid: 201,
      bead_id: 'bead-y',
    } as never, event);

    const second = claimJobStartWithStore(store, {
      id: 'job-self',
      specialist: 'executor',
      status: 'starting',
      started_at_ms: now,
      pid: 202,
      bead_id: 'bead-y',
    } as never, event);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
  });
});
