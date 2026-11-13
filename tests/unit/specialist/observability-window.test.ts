import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createForensicEvent } from '../../../src/specialist/forensic-events.js';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';
import type { SupervisorStatus } from '../../../src/specialist/status-contract.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function store() {
  const dir = mkdtempSync(join(tmpdir(), 'specialists-xtrm96-store-'));
  dirs.push(dir);
  const dbPath = join(dir, 'observability.db');
  const client = createObservabilitySqliteClientAtPath(dbPath);
  if (!client) throw new Error('failed to create observability client');
  return { dbPath, client };
}

function status(id: string, state: SupervisorStatus['status']): SupervisorStatus {
  return {
    id,
    specialist: 'reviewer',
    status: state,
    started_at_ms: 100,
    last_event_at_ms: 100,
  };
}

function forensic(jobId: string, seq: number, attemptId?: string, t = 1_000) {
  return createForensicEvent({
    event_family: 'job',
    event_name: seq === 1 ? 'job.started' : 'job.status_changed',
    t_unix_ms: t,
    seq,
    resource: {
      service_namespace: 'xtrm',
      service_name: 'specialists',
      service_component: 'test',
      deployment_environment: 'test',
      repo: 'specialists',
      participant_kind: 'specialist',
      participant_role: 'reviewer',
    },
    correlation: {
      job_id: jobId,
      ...(attemptId ? { attempt_id: attemptId } : {}),
    },
    body: { status: 'running' },
  });
}

describe('XTRM-96 bounded observability storage reads', () => {
  it('applies the Fleet row bound in SQL with a deterministic job-id tie break', () => {
    const { dbPath, client } = store();
    client.upsertStatus(status('job-a', 'running'));
    client.upsertStatus(status('job-b', 'waiting'));
    client.upsertStatus(status('job-c', 'done'));

    const raw = new Database(dbPath);
    raw.run('UPDATE specialist_jobs SET updated_at_ms = 1234');
    raw.close();

    const rows = client.listStatusesWindow({ limit: 2 });
    expect(rows.map((row) => row.id)).toEqual(['job-c', 'job-b']);
    client.close();
  });

  it('continues forensic LOG by per-job seq even when every event has the same timestamp', () => {
    const { client } = store();
    const times = [1_000, 1_000, 1_000, 900, 1_100, 800];
    for (let seq = 1; seq <= 6; seq += 1) {
      client.appendForensicEvent(
        'act:same-ms',
        'reviewer',
        undefined,
        forensic('act:same-ms', seq, 'att:same-ms:1', times[seq - 1]),
      );
    }

    const rows = client.readForensicEvents({
      jobId: 'act:same-ms',
      afterSeq: 3,
      limit: 10,
      order: 'asc',
    });
    expect(rows.map((row) => row.seq)).toEqual([4, 5, 6]);
    client.close();
  });

  it('filters one activation to an exact durable attempt identity', () => {
    const { client } = store();
    client.appendForensicEvent('act:retry', 'reviewer', undefined, forensic('act:retry', 1, 'att:retry:1'));
    client.appendForensicEvent('act:retry', 'reviewer', undefined, forensic('act:retry', 2, 'att:retry:2'));

    const rows = client.readForensicEvents({
      jobId: 'act:retry',
      attemptId: 'att:retry:1',
      limit: 10,
      order: 'asc',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempt_id).toBe('att:retry:1');
    expect(client.listForensicAttemptIds('act:retry')).toEqual(['att:retry:1', 'att:retry:2']);
    client.close();
  });

  it('restricts forensic reads to an explicit job candidate set before the row limit', () => {
    const { client } = store();
    client.appendForensicEvent('job-a', 'reviewer', undefined, forensic('job-a', 1));
    client.appendForensicEvent('job-b', 'reviewer', undefined, forensic('job-b', 1));

    expect(client.readForensicEvents({ jobIds: ['job-b'], limit: 10 }).map((row) => row.job_id))
      .toEqual(['job-b']);
    expect(client.readForensicEvents({ jobIds: [], limit: 10 })).toEqual([]);
    client.close();
  });

  it('rejects an afterSeq cursor without an exact job identity', () => {
    const { client } = store();
    expect(() => client.readForensicEvents({ afterSeq: 1 })).toThrow(/requires exact jobId/);
    client.close();
  });
});
