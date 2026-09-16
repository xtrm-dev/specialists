import { describe, expect, it } from 'vitest';
import { createForensicEvent, type ForensicEvent } from '../../../src/specialist/forensic-events.js';
import {
  parseForensicRecords,
  readFleetSnapshot,
  readForensicWindow,
  type ObservabilityReadSource,
} from '../../../src/specialist/observability-read-model.js';
import type {
  ForensicEventRecord,
  ListForensicEventsFilters,
  ListNativeActivationIdsFilters,
} from '../../../src/specialist/observability-sqlite.js';
import type { SupervisorStatus } from '../../../src/specialist/status-contract.js';

function event(
  jobId: string,
  seq: number,
  t: number,
  name: string,
  family = 'job',
  extras: Partial<ForensicEvent> = {},
): ForensicEvent {
  return createForensicEvent({
    event_family: family,
    event_name: name,
    t_unix_ms: t,
    seq,
    resource: {
      service_namespace: 'xtrm',
      service_name: 'specialists',
      service_component: 'runtime',
      deployment_environment: 'test',
      repo: 'specialists',
      participant_kind: 'specialist',
      participant_role: jobId.includes('child') ? 'explorer' : 'reviewer',
    },
    correlation: { job_id: jobId, ...(extras.correlation ?? {}) },
    body: { status: 'running', ...(extras.body ?? {}) },
    links: extras.links,
    severity: extras.severity ?? 'info',
  });
}

function record(ev: ForensicEvent, id?: number): ForensicEventRecord {
  return {
    id: id ?? ev.seq ?? 0,
    job_id: String(ev.correlation.job_id ?? ''),
    seq: ev.seq ?? 0,
    t: ev.t_unix_ms,
    schema_version: ev.schema_version,
    event_family: ev.event_family,
    event_name: ev.event_name,
    participant_kind: ev.resource.participant_kind ?? null,
    participant_role: ev.resource.participant_role ?? null,
    participant_id: typeof ev.correlation.participant_id === 'string' ? ev.correlation.participant_id : null,
    redaction_status: ev.redaction.status,
    event_json: JSON.stringify(ev),
  };
}

class FakeSource implements ObservabilityReadSource {
  constructor(
    readonly forensic: ForensicEventRecord[],
    readonly statuses: SupervisorStatus[] = [],
    readonly nativeIds: string[] = [],
  ) {}

  readForensicEvents(filters: ListForensicEventsFilters = {}): ForensicEventRecord[] {
    let rows = this.forensic.filter((row) => {
      if (filters.jobId && row.job_id !== filters.jobId) return false;
      if (filters.jobIdPrefix && !row.job_id.startsWith(filters.jobIdPrefix)) return false;
      if (filters.sinceMs !== undefined && row.t < filters.sinceMs) return false;
      if (filters.eventFamily && row.event_family !== filters.eventFamily) return false;
      if (filters.eventName && row.event_name !== filters.eventName) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => a.t - b.t || a.seq - b.seq || a.id - b.id);
    if (filters.order === 'desc') rows.reverse();
    return filters.limit ? rows.slice(0, filters.limit) : rows;
  }

  listStatuses(): SupervisorStatus[] {
    return this.statuses;
  }

  listNativeActivationIds(filters: ListNativeActivationIdsFilters = {}): string[] {
    return this.nativeIds.slice(0, filters.limit ?? this.nativeIds.length);
  }

  readForensicEventsForActivations(jobIds: readonly string[], filters: { sinceMs?: number } = {}): ForensicEventRecord[] {
    const ids = new Set(jobIds);
    return this.forensic.filter((row) => ids.has(row.job_id) && (filters.sinceMs === undefined || row.t >= filters.sinceMs));
  }

  readResult(): string | null {
    return null;
  }
}

function status(id: string, specialist: string, state: SupervisorStatus['status'], startedAtMs: number): SupervisorStatus {
  return {
    id,
    specialist,
    status: state,
    started_at_ms: startedAtMs,
    last_event_at_ms: startedAtMs + 10,
  } as SupervisorStatus;
}

describe('observability read model', () => {
  it('parses valid forensic rows and counts malformed persisted rows without throwing', () => {
    const valid = record(event('job-a', 1, 100, 'job.started'));
    const malformed: ForensicEventRecord = { ...valid, id: 2, seq: 2, event_json: '{nope' };
    const result = parseForensicRecords([valid, malformed]);
    expect(result.parsed).toHaveLength(1);
    expect(result.invalidRecords).toBe(1);
  });

  it('renders LOG from persisted forensic rows, suppresses default agent noise, and resumes by tuple cursor', () => {
    const rows = [
      record(event('job-a', 1, 100, 'job.started'), 1),
      record(event('job-a', 2, 101, 'tool.call.started', 'tool'), 2),
      record(event('job-a', 3, 102, 'review.finding', 'review', { body: { status: 'warn', prompt: 'DO_NOT_RENDER' } }), 3),
      record(event('job-a', 4, 103, 'job.status_changed'), 4),
    ];
    const source = new FakeSource(rows);

    const first = readForensicWindow(source, { jobId: 'job-a', limit: 2 });
    expect(first.events.map((ev) => ev.event_name)).toEqual(['review.finding', 'job.status_changed']);
    expect(first.rows.some((row) => row.payload.includes('DO_NOT_RENDER'))).toBe(false);
    expect(first.cursor).toEqual({ t: 103, seq: 4, id: 4 });

    const later = record(event('job-a', 5, 104, 'job.completed'), 5);
    source.forensic.push(later);
    const resumed = readForensicWindow(source, { jobId: 'job-a', after: first.cursor, limit: 10 });
    expect(resumed.events.map((ev) => ev.event_name)).toEqual(['job.completed']);
  });

  it('reconstructs nested fleet lineage and persisted tmux attachment without name heuristics', () => {
    const parent = event('job-parent', 1, 100, 'job.started', 'job', {
      links: {
        spawned_by: {
          kind: 'xtmux.agent_instance',
          host_id: 'host-1',
          tmux_session_id: '$1',
          tmux_window_id: '@2',
          tmux_pane_id: '%3',
          agent_instance_id: 'agent-root',
        },
      },
    });
    const child = event('job-child', 1, 110, 'job.started', 'job', {
      correlation: { parent_job_id: 'job-parent' },
      links: { spawned_by: { kind: 'specialist.job', job_id: 'job-parent' } },
    });
    const source = new FakeSource(
      [record(parent, 1), record(child, 2)],
      [
        status('job-parent', 'reviewer', 'running', 100),
        status('job-child', 'explorer', 'waiting', 110),
      ],
    );

    const fleet = readFleetSnapshot(source);
    expect(fleet.roots).toEqual(['job-parent']);
    expect(fleet.byId.get('job-parent')?.children).toEqual(['job-child']);
    expect(fleet.byId.get('job-child')?.parentJobId).toBe('job-parent');
    expect(fleet.byId.get('job-child')?.attention).toBe('blocked');
    expect(fleet.byId.get('job-parent')?.attachment).toEqual({
      kind: 'xtmux.agent_instance',
      hostId: 'host-1',
      paneId: '%3',
      sessionId: '$1',
      windowId: '@2',
      agentInstanceId: 'agent-root',
      direct: true,
    });
  });
});
