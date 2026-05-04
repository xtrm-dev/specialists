import { afterEach, describe, expect, it } from 'vitest';
import { rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimJobStartWithStore } from '../../../src/specialist/observability-sqlite.js';

describe('claimJobStart', () => {
  let tempRoot = '';

  afterEach(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = '';
  });

  function createStore() {
    tempRoot = join(tmpdir(), `sp-claim-${crypto.randomUUID()}`);
    mkdirSync(tempRoot, { recursive: true });

    const activeJobs = new Map<string, { job_id: string; status: string }>();
    const events: Array<{ jobId: string; specialist: string; beadId?: string }> = [];

    return {
      transaction<T>(callback: () => T): T {
        return callback();
      },
      findActiveJob(beadId: string | null, specialist: string) {
        return activeJobs.get(`${beadId ?? 'null'}:${specialist}`);
      },
      writeStatusRow(status: { id: string; specialist: string; bead_id?: string; status: string }) {
        activeJobs.set(`${status.bead_id ?? 'null'}:${status.specialist}`, { job_id: status.id, status: status.status });
      },
      writeEventRow(jobId: string, specialist: string, beadId: string | undefined) {
        events.push({ jobId, specialist, beadId });
      },
      events,
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
