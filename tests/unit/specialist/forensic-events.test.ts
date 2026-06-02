import { describe, expect, it } from 'vitest';
import {
  assertKnownTopLevelFields,
  assertNoForbiddenLabels,
  createForensicEvent,
  deriveParticipantId,
  pickAllowedLabels,
} from '../../../src/specialist/forensic-events.js';

describe('forensic-events', () => {
  const resource = {
    service_namespace: 'xtrm',
    service_name: 'specialists',
    service_component: 'supervisor',
    deployment_environment: 'local',
    repo: 'specialists',
    participant_kind: 'specialist',
    participant_role: 'executor',
  };

  it('stamps the xtrm forensic envelope', () => {
    const event = createForensicEvent({
      event_family: 'job',
      event_name: 'job.started',
      resource,
      correlation: { participant_id: 'chain:1::executor', job_id: 'job-1' },
      body: { state: 'running' },
      t_unix_ms: 1_780_000_000_000,
      seq: 7,
    });

    expect(event).toMatchObject({
      schema_version: 'xtrm.forensic.v1',
      timestamp: '2026-05-28T20:26:40.000Z',
      t_unix_ms: 1_780_000_000_000,
      seq: 7,
      severity: 'info',
      event_family: 'job',
      event_name: 'job.started',
      event_version: 1,
      resource,
      correlation: { participant_id: 'chain:1::executor', job_id: 'job-1' },
      body: { state: 'running' },
      redaction: { status: 'clean' },
    });
  });

  it('normalizes legacy specialist to participant identity fields', () => {
    const event = createForensicEvent({
      event_family: 'tool',
      event_name: 'tool.call.completed',
      resource: { ...resource, participant_kind: undefined, participant_role: undefined, specialist: 'reviewer' },
    });

    expect(event.resource.participant_kind).toBe('specialist');
    expect(event.resource.participant_role).toBe('reviewer');
    expect(event.resource.specialist).toBeUndefined();
  });

  it('derives stable participant_id separately from per-run job_id', () => {
    const participantId = deriveParticipantId({ participant_kind: 'specialist', participant_role: 'executor', chain_id: 'chain:7f3a' });
    const first = createForensicEvent({ event_family: 'job', event_name: 'job.started', resource, correlation: { participant_id: participantId, job_id: 'job-a' } });
    const second = createForensicEvent({ event_family: 'job', event_name: 'job.started', resource, correlation: { participant_id: participantId, job_id: 'job-b' } });

    expect(participantId).toBe('chain:7f3a::executor');
    expect(first.correlation.participant_id).toBe(second.correlation.participant_id);
    expect(first.correlation.job_id).not.toBe(second.correlation.job_id);
  });

  it('derives participant ids for orchestrator, pulse emitters, adapters, and node members', () => {
    expect(deriveParticipantId({ participant_kind: 'orchestrator', participant_role: 'claude-code-session', session_uuid: 's1' })).toBe('orch::s1');
    expect(deriveParticipantId({ participant_kind: 'pulse_emitter', participant_role: 'devops-advisor', container_id: 'chain:1' })).toBe('chain:1::emitter::devops-advisor');
    expect(deriveParticipantId({ participant_kind: 'adapter', participant_role: 'mcp-grafana', adapter_id: 'adapter:grafana' })).toBe('adapter:grafana');
    expect(deriveParticipantId({ participant_kind: 'node_member', participant_role: 'coordinator', node_id: 'node:1', member_index: 2 })).toBe('node::node:1::coordinator::2');
  });

  it('rejects unknown top-level fields', () => {
    expect(() => assertKnownTopLevelFields({ schema_version: 'xtrm.forensic.v1', surprise: true })).toThrow(/Unknown forensic event top-level field: surprise/);
  });

  it('rejects high-cardinality labels', () => {
    expect(() => assertNoForbiddenLabels({ participant_id: 'chain:1::executor' })).toThrow(/participant_id/);
    expect(() => assertNoForbiddenLabels({ job_id: 'job-1' })).toThrow(/job_id/);
    expect(() => assertNoForbiddenLabels({ chain_id: 'chain:1' })).toThrow(/chain_id/);
    expect(() => assertNoForbiddenLabels({ trace_id: 'trace-1' })).toThrow(/trace_id/);
    expect(() => assertNoForbiddenLabels({ tool_call_id: 'tool-1' })).toThrow(/tool_call_id/);
  });

  it('picks only allowlisted low-cardinality labels', () => {
    const labels = pickAllowedLabels({
      service_name: 'specialists',
      participant_kind: 'specialist',
      participant_role: 'executor',
      result: 'success',
      participant_id: 'chain:1::executor',
      job_id: 'job-1',
    });

    expect(labels).toEqual({
      service_name: 'specialists',
      participant_kind: 'specialist',
      participant_role: 'executor',
      result: 'success',
    });
  });

  it('redacts sensitive forensic body fields before output or persistence', () => {
    const event = createForensicEvent({
      event_family: 'tool',
      event_name: 'tool.call.completed',
      resource,
      body: {
        raw_command: 'cat ~/.ssh/id_rsa',
        nested: { api_key: 'sk-test-secret-value-1234567890', input_tokens: 42 },
      },
    });

    expect(event.body).toEqual({
      raw_command: '[REDACTED]',
      nested: { api_key: '[REDACTED]', input_tokens: 42 },
    });
    expect(event.redaction.status).toBe('redacted');
    expect(event.redaction.fields).toContain('body.raw_command');
    expect(event.redaction.fields).toContain('body.nested.api_key');
  });

  it('normalizes timeline events to forensic events for JSON surfaces', async () => {
    const { forensicEventFromTimelineEvent } = await import('../../../src/specialist/forensic-events.js');
    const event = forensicEventFromTimelineEvent(
      { t: 1_780_000_000_000, seq: 3, type: 'tool', phase: 'end', tool: 'bash', is_error: true, tool_call_id: 'tool-1' },
      { jobId: 'job-1', specialist: 'executor', beadId: 'unitAI-1', repo: 'specialists', chainId: 'chain:1', serviceComponent: 'cli.log' },
    );

    expect(event).toMatchObject({
      schema_version: 'xtrm.forensic.v1',
      event_family: 'tool',
      event_name: 'tool.call.failed',
      severity: 'error',
      resource: {
        service_name: 'specialists',
        service_component: 'cli.log',
        participant_kind: 'specialist',
        participant_role: 'executor',
      },
      correlation: {
        participant_id: 'chain:1::executor',
        job_id: 'job-1',
        bead_id: 'unitAI-1',
        chain_id: 'chain:1',
        tool_call_id: 'tool-1',
      },
      redaction: { status: 'redacted' },
    });
  });
});
