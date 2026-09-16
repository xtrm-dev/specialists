// unitAI-rrdnt.47: tests for summarizeNativeActivations.
// XTRM-93 N2B: native rows now use the SHARED timeline vocabulary
// (families job/control/turn/model/tool, distinguished by job_id 'act:'
// prefix). Historical activation.* shapes below are kept for the retired
// rows still in the store; shared-vocabulary shapes were copied from LIVE
// rows measured 2026-09-16 in .specialists/db/observability.db —
// act:758931b7-9ce (executor, settled) and act:edb6af5c-224 (explorer,
// failed with body.error). If the forensic writer changes its envelope,
// update from a fresh live measurement, not invented fixtures.
import { describe, expect, it } from 'vitest';
import {
  formatActivationAge,
  summarizeNativeActivations,
} from '../../../src/specialist/native-activation-summary.js';
import type { ForensicEventRecord } from '../../../src/specialist/observability-sqlite.js';

let seq = 0;

function row(
  jobId: string,
  eventName: string,
  t: number,
  body: Record<string, unknown> = {},
  role = 'explorer',
): ForensicEventRecord {
  seq += 1;
  return {
    id: seq,
    job_id: jobId,
    seq,
    t,
    schema_version: 'xtrm.forensic.v1',
    event_family: 'activation',
    event_name: eventName,
    participant_kind: 'specialist',
    participant_role: role,
    participant_id: `specialist::${role}`,
    attempt_id: `att:${jobId}:1`,
    redaction_status: 'clean',
    event_json: JSON.stringify({
      schema_version: 'xtrm.forensic.v1',
      t_unix_ms: t,
      event_family: 'activation',
      event_name: eventName,
      resource: {
        service_namespace: 'xtrm',
        service_name: 'specialists',
        service_component: 'native-activation-host',
        participant_kind: 'specialist',
        participant_role: role,
      },
      correlation: { participant_id: `specialist::${role}`, job_id: jobId, bead_id: 'unitAI-89b8i' },
      body: { attempt_id: `att:${jobId}:1`, ...body },
      redaction: { status: 'clean' },
    }),
  };
}

const T0 = 1_788_824_247_906;

// Shared-vocabulary row (post-febef0ad): family/name from
// familyForTimelineType/eventNameForTimelineEvent, identity by job_id
// 'act:' prefix, pi_session_id in correlation (measured 2026-09-16).

function fullLifecycle(jobId: string): ForensicEventRecord[] {
  return [
    row(jobId, 'activation.activation_requested', T0),
    row(jobId, 'activation.activation_admitted', T0 + 11_000),
    row(jobId, 'activation.step_contract_compiled', T0 + 12_000),
    row(jobId, 'activation.activation_starting', T0 + 15_000),
    row(jobId, 'activation.activation_started', T0 + 24_000, { pi_session_id: '01a07e3c-1ce4-7561-a37a-0c6cbf844fed' }),
    row(jobId, 'activation.turn_started', T0 + 24_500),
    row(jobId, 'activation.turn_completed', T0 + 70_000),
    row(jobId, 'activation.activation_settled', T0 + 71_000),
    // Measured order quirk: disposed was written BEFORE failed (t 38741 < 38755).
    row(jobId, 'activation.activation_disposed', T0 + 71_500, { reason: 'session shutdown' }),
    row(jobId, 'activation.activation_failed', T0 + 71_600, { error: 'This operation was aborted', stop_reason: 'error' }),
  ];
}

function sharedRow(
  jobId: string,
  family: string,
  eventName: string,
  t: number,
  opts: { beadId?: string; piSessionId?: string; body?: Record<string, unknown>; role?: string } = {},
): ForensicEventRecord {
  seq += 1;
  const role = opts.role ?? 'executor';
  const pi = opts.piSessionId ?? '01a0a95a-cdb1-7e1a-9249-77a0c50d0858';
  return {
    id: seq,
    job_id: jobId,
    seq,
    t,
    schema_version: 'xtrm.forensic.v1',
    event_family: family,
    event_name: eventName,
    participant_kind: 'specialist',
    participant_role: role,
    participant_id: `specialist::${role}`,
    attempt_id: `att:${jobId.slice(4, 12)}:1`,
    redaction_status: 'clean',
    event_json: JSON.stringify({
      schema_version: 'xtrm.forensic.v1',
      t_unix_ms: t,
      event_family: family,
      event_name: eventName,
      resource: {
        service_namespace: 'xtrm',
        service_name: 'specialists',
        service_component: 'runtime',
        participant_kind: 'specialist',
        participant_role: role,
      },
      correlation: {
        participant_id: `specialist::${role}`,
        job_id: jobId,
        ...(opts.beadId ? { bead_id: opts.beadId } : {}),
        attempt_id: `att:${jobId.slice(4, 12)}:1`,
        pi_session_id: pi,
        session_id: pi,
      },
      body: { ...(opts.body ?? {}) },
      redaction: { status: 'clean' },
    }),
  };
}

describe('summarizeNativeActivations', () => {
  it('derives failed + error detail from a full measured lifecycle (latest event wins)', () => {
    const [summary] = summarizeNativeActivations(fullLifecycle('act:198ce538-0c7'));
    expect(summary.activation_id).toBe('act:198ce538-0c7');
    expect(summary.specialist).toBe('explorer');
    expect(summary.bead_id).toBe('unitAI-89b8i');
    expect(summary.state).toBe('failed');
    expect(summary.detail).toBe('This operation was aborted');
    expect(summary.turns).toBe(1);
    expect(summary.event_count).toBe(10);
    expect(summary.pi_session_id).toBe('01a07e3c-1ce4-7561-a37a-0c6cbf844fed');
  });

  it('reports a mid-flight activation as last-known active, never as running', () => {
    const rows = fullLifecycle('act:live-1').slice(0, 6);
    const [summary] = summarizeNativeActivations(rows);
    expect(summary.state).toBe('active');
    expect(summary.state).not.toBe('running');
  });

  it('maps rejected and pre-start states without inventing liveness', () => {
    const rejected = summarizeNativeActivations([row('act:r', 'activation.activation_rejected', T0)]);
    expect(rejected[0].state).toBe('rejected');
    const requested = summarizeNativeActivations([row('act:q', 'activation.activation_requested', T0)]);
    expect(requested[0].state).toBe('requested');
  });

  it('sorts newest-first across activations', () => {
    const summaries = summarizeNativeActivations([
      ...fullLifecycle('act:old'),
      row('act:new', 'activation.activation_requested', T0 + 1_000_000),
    ]);
    expect(summaries.map((s) => s.activation_id)).toEqual(['act:new', 'act:old']);
  });

  it('tolerates malformed event_json instead of throwing the whole section', () => {
    const bad: ForensicEventRecord = { ...row('act:bad', 'activation.activation_started', T0), event_json: '{nope' };
    const [summary] = summarizeNativeActivations([bad]);
    expect(summary.state).toBe('active');
    expect(summary.bead_id).toBeUndefined();
  });

  it('returns [] for no rows so ps can omit the section', () => {
    expect(summarizeNativeActivations([])).toEqual([]);
  });

  it('maps shared-vocabulary terminal states (job.completed/failed) with turns from turn.summarized', () => {
    const done = [
      sharedRow('act:shared-done', 'control', 'control.lease_acquired.recorded', T0),
      sharedRow('act:shared-done', 'job', 'job.started', T0 + 1000),
      sharedRow('act:shared-done', 'turn', 'turn.turn', T0 + 2000),
      sharedRow('act:shared-done', 'turn', 'turn.summarized', T0 + 3000),
      sharedRow('act:shared-done', 'turn', 'turn.summarized', T0 + 4000),
      sharedRow('act:shared-done', 'job', 'job.status_changed', T0 + 5000),
      sharedRow('act:shared-done', 'job', 'job.completed', T0 + 6000),
    ];
    const [summary] = summarizeNativeActivations(done);
    expect(summary.activation_id).toBe('act:shared-done');
    expect(summary.state).toBe('completed');
    expect(summary.last_event).toBe('job.completed');
    expect(summary.turns).toBe(2);
    expect(summary.pi_session_id).toBe('01a0a95a-cdb1-7e1a-9249-77a0c50d0858');
    expect(summary.state).not.toBe('running');

    const failed = [
      sharedRow('act:shared-fail', 'job', 'job.started', T0),
      sharedRow('act:shared-fail', 'job', 'job.failed', T0 + 1000, { body: { status: 'ERROR', error: 'OpenAI Responses stream ended' } }),
    ];
    const [failSummary] = summarizeNativeActivations(failed);
    expect(failSummary.state).toBe('failed');
    expect(failSummary.detail).toBe('OpenAI Responses stream ended');
  });

  it('maps shared-vocabulary mid-flight and admission signals without inventing running', () => {
    const mid = [
      sharedRow('act:mid', 'job', 'job.started', T0),
      sharedRow('act:mid', 'turn', 'turn.message', T0 + 1000),
      sharedRow('act:mid', 'model', 'model.token_usage.recorded', T0 + 2000),
      sharedRow('act:mid', 'tool', 'tool.call.started', T0 + 3000),
    ];
    const [midSummary] = summarizeNativeActivations(mid);
    expect(midSummary.state).toBe('active');
    expect(midSummary.state).not.toBe('running');

    expect(summarizeNativeActivations([sharedRow('act:w', 'job', 'job.status_changed', T0)])[0]?.state).toBe('settled');
    expect(summarizeNativeActivations([sharedRow('act:a', 'control', 'control.lease_acquired.recorded', T0)])[0]?.state).toBe('admitted');
    expect(summarizeNativeActivations([sharedRow('act:d', 'control', 'control.lease_denied.recorded', T0)])[0]?.state).toBe('rejected');
  });
});

describe('formatActivationAge', () => {
  it('renders compact ages', () => {
    expect(formatActivationAge(1_000_000, 955_000)).toBe('45s ago');
    expect(formatActivationAge(4_000_000, 1_000_000)).toBe('50m ago');
    expect(formatActivationAge(10_000_000, 2_800_000)).toBe('2h ago');
  });
});
