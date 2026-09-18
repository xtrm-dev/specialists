import { describe, expect, it } from 'vitest';
import { createForensicEvent, type ForensicEvent } from '../../../src/specialist/forensic-events.js';
import {
  parseForensicRecords,
  readActivationInspect,
  readFleetSnapshot,
  readForensicWindow,
  readResultProjection,
  type ObservabilityReadSource,
} from '../../../src/specialist/observability-read-model.js';
import type {
  ForensicEventRecord,
  ListForensicEventsFilters,
  ListStatusesWindowFilters,
} from '../../../src/specialist/observability-sqlite.js';
import type { SupervisorStatus } from '../../../src/specialist/status-contract.js';

function event(
  jobId: string,
  seq: number,
  name: string,
  family = 'job',
  extras: Partial<ForensicEvent> = {},
): ForensicEvent {
  return createForensicEvent({
    event_family: family,
    event_name: name,
    t_unix_ms: 1_000,
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

function record(ev: ForensicEvent, id?: number, attemptId?: string): ForensicEventRecord {
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
    attempt_id: attemptId ?? (typeof ev.correlation.attempt_id === 'string' ? ev.correlation.attempt_id : null),
    redaction_status: ev.redaction.status,
    event_json: JSON.stringify(ev),
  };
}

function status(
  id: string,
  specialist: string,
  state: SupervisorStatus['status'],
  currentEvent?: string,
): SupervisorStatus {
  return {
    id,
    specialist,
    status: state,
    started_at_ms: 100,
    last_event_at_ms: 200,
    ...(currentEvent ? { current_event: currentEvent } : {}),
  };
}

class FakeSource implements ObservabilityReadSource {
  readonly windows: ListStatusesWindowFilters[] = [];
  result: string | null = null;

  constructor(
    readonly forensic: ForensicEventRecord[],
    readonly statuses: SupervisorStatus[] = [],
  ) {}

  readForensicEvents(filters: ListForensicEventsFilters = {}): ForensicEventRecord[] {
    let rows = this.forensic.filter((row) => {
      if (filters.jobId && row.job_id !== filters.jobId) return false;
      if (filters.jobIds !== undefined && !filters.jobIds.includes(row.job_id)) return false;
      if (filters.jobIdPrefix && !row.job_id.startsWith(filters.jobIdPrefix)) return false;
      if (filters.sinceMs !== undefined && row.t < filters.sinceMs) return false;
      if (filters.afterSeq !== undefined && row.seq <= filters.afterSeq) return false;
      if (filters.attemptId !== undefined && row.attempt_id !== filters.attemptId) return false;
      if (filters.eventFamily && row.event_family !== filters.eventFamily) return false;
      if (filters.eventName && row.event_name !== filters.eventName) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => a.seq - b.seq || a.id - b.id);
    if (filters.order === 'desc') rows.reverse();
    return filters.limit ? rows.slice(0, filters.limit) : rows;
  }

  listForensicAttemptIds(jobId: string): string[] {
    return [...new Set(this.forensic
      .filter((row) => row.job_id === jobId && typeof row.attempt_id === 'string')
      .sort((a, b) => a.seq - b.seq)
      .map((row) => row.attempt_id as string))];
  }

  listStatusesWindow(filters: ListStatusesWindowFilters = {}): SupervisorStatus[] {
    this.windows.push(filters);
    const filtered = this.statuses.filter((row) => {
      if (filters.sinceMs !== undefined && (row.last_event_at_ms ?? row.started_at_ms) < filters.sinceMs) return false;
      if (filters.statuses?.length && !filters.statuses.includes(row.status)) return false;
      return true;
    });
    return filtered.slice(0, filters.limit ?? filtered.length);
  }

  readStatus(jobId: string): SupervisorStatus | null {
    return this.statuses.find((row) => row.id === jobId) ?? null;
  }

  readResult(): string | null {
    return this.result;
  }
}

describe('XTRM-96 reconciled observability read model', () => {
  it('parses valid forensic rows and counts malformed rows without throwing', () => {
    const valid = record(event('job-a', 1, 'job.started'));
    const malformed: ForensicEventRecord = { ...valid, id: 2, seq: 2, event_json: '{nope' };
    const result = parseForensicRecords([valid, malformed]);
    expect(result.parsed).toHaveLength(1);
    expect(result.invalidRecords).toBe(1);
  });

  it('continues LOG by seq and cannot starve on same-millisecond noise', () => {
    const rows = [
      record(event('job-a', 1, 'job.started'), 1),
      ...Array.from({ length: 12 }, (_, i) =>
        record(event('job-a', i + 2, 'tool.call.started', 'tool'), i + 2)),
      record(event('job-a', 14, 'review.finding', 'review'), 14),
      record(event('job-a', 15, 'job.status_changed'), 15),
    ];
    const source = new FakeSource(rows);

    const first = readForensicWindow(source, { jobId: 'job-a', limit: 2 });
    expect(first.events.map((ev) => ev.event_name)).toEqual(['review.finding', 'job.status_changed']);
    expect(first.cursor).toEqual({ seq: 15 });

    source.forensic.push(record(event('job-a', 16, 'job.completed'), 16));
    const resumed = readForensicWindow(source, { jobId: 'job-a', after: first.cursor, limit: 10 });
    expect(resumed.events.map((ev) => ev.event_name)).toEqual(['job.completed']);
  });

  it('uses the SQL-bounded status window and treats stale_warning as warning, not failure', () => {
    const source = new FakeSource([], [
      status('act:warn', 'reviewer', 'running', 'stale_warning'),
      status('act:ok', 'executor', 'running'),
      status('act:wait', 'explorer', 'waiting'),
    ]);
    const fleet = readFleetSnapshot(source, { limit: 2 });

    expect(source.windows).toEqual([{ limit: 2 }]);
    expect(fleet.nodes).toHaveLength(2);
    expect(fleet.byId.get('act:warn')?.state).toBe('active');
    expect(fleet.byId.get('act:warn')?.attention).toBe('warning');
    expect(fleet.byId.get('act:warn')?.currentEvent).toBe('stale_warning');
    expect(fleet.counts.warning).toBe(1);
    expect(fleet.counts.failed).toBe(0);
  });

  it('reconstructs parent/child lineage and real tmux attachment only from persisted evidence', () => {
    const parent = event('job-parent', 1, 'job.started', 'job', {
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
    const child = event('job-child', 1, 'job.started', 'job', {
      correlation: { parent_job_id: 'job-parent' },
      links: { spawned_by: { kind: 'specialist.job', job_id: 'job-parent' } },
    });
    const source = new FakeSource(
      [record(parent, 1), record(child, 2)],
      [status('job-parent', 'reviewer', 'running'), status('job-child', 'explorer', 'waiting')],
    );

    const fleet = readFleetSnapshot(source);
    expect(fleet.roots).toEqual(['job-parent']);
    expect(fleet.byId.get('job-parent')?.children).toEqual(['job-child']);
    expect(fleet.byId.get('job-parent')?.attachment?.paneId).toBe('%3');
    expect(fleet.byId.get('job-child')?.parentJobId).toBe('job-parent');
  });

  it('fails RESULT closed for an unproven attempt and accepts an exact forensic attempt', () => {
    const source = new FakeSource([
      record(event('act:retry', 1, 'job.started'), 1, 'att:retry:1'),
      record(event('act:retry', 2, 'job.status_changed'), 2, 'att:retry:2'),
    ], [status('act:retry', 'reviewer', 'done')]);
    source.result = 'final result';

    const missing = readResultProjection(source, { jobId: 'act:retry', attemptId: 'att:retry:3' });
    expect(missing.attemptVerified).toBe(false);
    expect(missing.available).toBe(false);
    expect(missing.error).toContain("No such attempt 'att:retry:3'");

    const proven = readResultProjection(source, { jobId: 'act:retry', attemptId: 'att:retry:1' });
    expect(proven.attemptVerified).toBe(true);
    expect(proven.output).toBe('final result');
  });

  it('keeps the canonical no-job RESULT distinction', () => {
    const source = new FakeSource([], []);
    const result = readResultProjection(source, { jobId: 'act:missing', attemptId: 'att:missing:1' });
    expect(result.attemptVerified).toBe(false);
    expect(result.error).toBe('No job found: act:missing');
  });

  it('projects current N3 model identity and session metrics into DETAIL from durable state', () => {
    const admitted = event('act:model', 1, 'control.activation_admitted.recorded', 'control', {
      correlation: { attempt_id: 'att:model:1', pi_session_id: 'pi-1', workspace_id: 'ws-1' },
      body: {
        legacy_timeline_event: {
          configured_model: 'cfg/model',
          requested_model: 'alias/model',
          resolved_model: 'canon/model',
          model_override: true,
          thinking_level: 'medium',
        },
      },
    });
    const finished = event('act:model', 2, 'job.completed', 'job', {
      correlation: { attempt_id: 'att:model:1', pi_session_id: 'pi-1', workspace_id: 'ws-1' },
      body: { status: 'done' },
    });
    const s = status('act:model', 'reviewer', 'done');
    s.model = 'canon/model';
    s.context_pct = 42;
    s.context_pct_source = 'pi_session_stats';
    s.metrics = {
      token_usage: { total_tokens: 1234, usage_source: 'provider_usage' },
      cost: { total: 0.01 },
      session_stats: { tokens: { total: 1234 }, cost: 0.01 },
      reconciliation: {
        reconciled: true,
        fields: { total: { summed: 1234, session_stats: 1234, delta: 0 }, cost: { summed: 0.01, session_stats: 0.01, delta: 0 } },
        cost_compared: true,
      },
      pi_version: '0.85.1',
    };
    const source = new FakeSource([
      record(admitted, 1, 'att:model:1'),
      record(finished, 2, 'att:model:1'),
    ], [s]);

    const detail = readActivationInspect(source, 'act:model');
    expect(detail).toMatchObject({
      configuredModel: 'cfg/model',
      requestedModel: 'alias/model',
      resolvedModel: 'canon/model',
      modelOverride: true,
      thinkingLevel: 'medium',
      latestAttemptId: 'att:model:1',
      attempts: ['att:model:1'],
      piSessionId: 'pi-1',
      workspaceId: 'ws-1',
      contextPct: 42,
      contextPctSource: 'pi_session_stats',
    });
    expect(detail?.metrics?.reconciliation?.reconciled).toBe(true);
    expect(detail?.metrics?.cost?.total).toBe(0.01);
  });
});
