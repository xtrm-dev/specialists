import { describe, expect, it } from 'vitest';
import {
  assertKnownTopLevelFields,
  assertNoForbiddenLabels,
  createForensicEvent,
  deriveParticipantId,
  FORBIDDEN_PROMETHEUS_LABELS,
  pickAllowedLabels,
  type ForensicEvent,
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

  const catalogFixtures: Array<{ name: string; event: ForensicEvent }> = [
    {
      name: 'job.completed',
      event: createForensicEvent({
        event_family: 'job',
        event_name: 'job.completed',
        resource,
        correlation: {
          participant_id: 'chain:1::executor',
          job_id: 'job-1',
          bead_id: 'unitAI-eoqxp.3.5',
          chain_id: 'chain:1',
          session_id: 'session-1',
          conversation_id: 'conversation-1',
        },
        body: { elapsed_ms: 1_250, active_runtime_ms: 1_100, turns: 2, result_ref: 'sqlite:result:job-1' },
      }),
    },
    {
      name: 'mcp.call.failed',
      event: createForensicEvent({
        event_family: 'mcp',
        event_name: 'mcp.call.failed',
        resource: { ...resource, participant_role: 'devops' },
        correlation: { participant_id: 'chain:1::devops', job_id: 'job-2', mcp_session_id: 'mcp-session-1', jsonrpc_request_id: 'rpc-1' },
        body: { mcp_server: 'grafana', mcp_method: 'tools/call', duration_ms: 350, error_type: 'tool_error' },
      }),
    },
    {
      name: 'identity.credential.issued',
      event: createForensicEvent({
        event_family: 'identity',
        event_name: 'identity.credential.issued',
        resource,
        correlation: { identity_request_id: 'identity-request-1' },
        body: { credential_kind: 'api_key', provider: 'anthropic', ttl_seconds: 3_600, scope_kind: 'model' },
      }),
    },
    {
      name: 'policy.decision.denied',
      event: createForensicEvent({
        event_family: 'policy',
        event_name: 'policy.decision.denied',
        resource,
        correlation: { policy_decision_id: 'policy-decision-1' },
        body: { policy_kind: 'tool_policy', action_kind: 'terraform_apply', reason_code: 'requires_human_approval' },
      }),
    },
    {
      name: 'eval.completed',
      event: createForensicEvent({
        event_family: 'eval',
        event_name: 'eval.completed',
        resource,
        correlation: { eval_id: 'eval-1' },
        body: { eval_kind: 'policy_compliance', target_kind: 'job', result: 'pass', score: 0.98, threshold: 0.95 },
      }),
    },
    {
      name: 'service_skills.drift_detected',
      event: createForensicEvent({
        event_family: 'service_skills',
        event_name: 'service_skills.drift_detected',
        resource: { ...resource, service_name: 'service-skills', participant_kind: 'adapter', participant_role: 'service-skills-sync' },
        correlation: { participant_id: 'adapter:service-skills-sync', issue_id: 'unitAI-eoqxp.3.5' },
        body: { service_id: 'specialists-runtime', drift_tier: 'high', tier_source: 'drift_detector', files_count: 2 },
      }),
    },
    {
      name: 'pulse.emitted',
      event: createForensicEvent({
        event_family: 'pulse',
        event_name: 'pulse.emitted',
        resource: { ...resource, service_name: 'substrate', participant_kind: 'pulse_emitter', participant_role: 'devops-advisor' },
        correlation: { participant_id: 'container:1::emitter::devops-advisor', container_id: 'container:1', pulse_id: 'pulse-1' },
        body: { pulse_kind: 'proposal', idempotency_key_hash: 'sha256:abc123', source_kind: 'devops_advisor' },
      }),
    },
    {
      name: 'model.token_usage.recorded',
      event: createForensicEvent({
        event_family: 'model',
        event_name: 'model.token_usage.recorded',
        resource: { ...resource, model_provider: 'openai', model: 'gpt-5.4-mini' },
        correlation: { participant_id: 'chain:1::executor', job_id: 'job-3', turn_id: 'turn-1' },
        body: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 25, usage_source: 'provider_usage' },
      }),
    },
  ];

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

  it('rejects the full forbidden high-cardinality label set', () => {
    for (const label of FORBIDDEN_PROMETHEUS_LABELS) {
      expect(() => assertNoForbiddenLabels({ [label]: `${label}-value` })).toThrow(label);
    }
  });

  it('keeps AgentOps catalog fixtures enveloped and label-safe', () => {
    expect(catalogFixtures.map((fixture) => fixture.name)).toEqual([
      'job.completed',
      'mcp.call.failed',
      'identity.credential.issued',
      'policy.decision.denied',
      'eval.completed',
      'service_skills.drift_detected',
      'pulse.emitted',
      'model.token_usage.recorded',
    ]);

    for (const { event } of catalogFixtures) {
      expect(event.schema_version).toBe('xtrm.forensic.v1');
      expect(event.event_version).toBe(1);
      expect(event.resource.participant_kind).toBeTruthy();
      expect(event.resource.participant_role).toBeTruthy();
      expect(event.redaction.status).toBe('clean');
      expect(() => assertNoForbiddenLabels(pickAllowedLabels({
        ...event.resource,
        ...event.correlation,
        ...event.body,
        event_family: event.event_family,
        severity: event.severity,
      }))).not.toThrow();
    }

    const tokenFixture = catalogFixtures.find((fixture) => fixture.name === 'model.token_usage.recorded')?.event;
    expect(tokenFixture?.body).toMatchObject({ usage_source: 'provider_usage' });
    expect(tokenFixture?.body).not.toHaveProperty('cost_usd');
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

  it('keeps bounded identity/policy/eval fields while redacting secrets', () => {
    const event = createForensicEvent({
      event_family: 'identity',
      event_name: 'identity.credential.issued',
      resource,
      correlation: { identity_request_id: 'identity-request-1' },
      body: {
        credential_kind: 'api_key',
        provider: 'anthropic',
        scope_kind: 'model',
        api_key: 'sk-test-secret-value-1234567890',
        access_token: 'bearer abcdefghijklmnop',
      },
    });

    expect(event.body).toMatchObject({
      credential_kind: 'api_key',
      provider: 'anthropic',
      scope_kind: 'model',
      api_key: '[REDACTED]',
      access_token: '[REDACTED]',
    });
    expect(event.correlation.identity_request_id).toBe('identity-request-1');
    expect(event.redaction.status).toBe('redacted');
  });

  it('allows bounded policy and eval labels while dropping opaque ids', () => {
    const labels = pickAllowedLabels({
      service_name: 'specialists',
      policy_kind: 'tool_policy',
      action_kind: 'tool_call',
      eval_kind: 'safety',
      credential_kind: 'api_key',
      policy_decision_id: 'policy-decision-1',
      eval_id: 'eval-1',
    });

    expect(labels).toEqual({
      service_name: 'specialists',
      policy_kind: 'tool_policy',
      action_kind: 'tool_call',
      eval_kind: 'safety',
      credential_kind: 'api_key',
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
      {
        jobId: 'job-1',
        specialist: 'executor',
        beadId: 'unitAI-1',
        repo: 'specialists',
        chainId: 'chain:1',
        serviceComponent: 'cli.log',
        sessionId: 'session-1',
        conversationId: 'conversation-1',
        traceId: 'trace-1',
        spanId: 'span-1',
        parentSpanId: 'span-parent-1',
      },
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
        session_id: 'session-1',
        conversation_id: 'conversation-1',
        trace_id: 'trace-1',
        span_id: 'span-1',
        parent_span_id: 'span-parent-1',
        tool_call_id: 'tool-1',
      },
      redaction: { status: 'redacted' },
    });
  });

  it('normalizes MCP timeline events with semconv-aligned body and opaque correlation', async () => {
    const { forensicEventFromTimelineEvent } = await import('../../../src/specialist/forensic-events.js');
    const event = forensicEventFromTimelineEvent(
      {
        t: 1_780_000_000_002,
        type: 'mcp',
        action: 'failed',
        mcp_server: 'grafana',
        mcp_method: 'tools/call',
        tool_name: 'query_loki',
        duration_ms: 1200,
        error_type: 'tool_error',
        status_code: 'ERROR',
        duplicate_span_suppressed: true,
        _meta: {
          trace_id: 'trace-from-meta',
          span_id: 'span-from-meta',
          parent_span_id: 'parent-span-from-meta',
          mcp_session_id: 'mcp-session-from-meta',
          jsonrpc_request_id: 'jsonrpc-from-meta',
          trace_carrier: '_meta',
        },
      },
      { jobId: 'job-mcp', specialist: 'devops', repo: 'specialists' },
    );

    expect(event).toMatchObject({
      event_family: 'mcp',
      event_name: 'mcp.call.failed',
      severity: 'error',
      correlation: {
        job_id: 'job-mcp',
        trace_id: 'trace-from-meta',
        span_id: 'span-from-meta',
        parent_span_id: 'parent-span-from-meta',
        mcp_session_id: 'mcp-session-from-meta',
        jsonrpc_request_id: 'jsonrpc-from-meta',
      },
      body: {
        mcp_server: 'grafana',
        mcp_method: 'tools/call',
        tool_name: 'query_loki',
        duration_ms: 1200,
        error_type: 'tool_error',
        status_code: 'ERROR',
        duplicate_span_suppressed: true,
        trace_carrier: '_meta',
      },
      otel: {
        'mcp.method.name': 'tools/call',
        'mcp.session.id': 'mcp-session-from-meta',
        'jsonrpc.request.id': 'jsonrpc-from-meta',
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'query_loki',
      },
    });
    expect(() => assertNoForbiddenLabels(pickAllowedLabels({ ...event.resource, ...event.correlation, ...event.body }))).not.toThrow();
  });

  it.each([
    ['connected', 'mcp.connected', 'info'],
    ['disconnected', 'mcp.disconnected', 'info'],
    ['start', 'mcp.call.started', 'info'],
    ['failed', 'mcp.call.failed', 'error'],
    ['auth_failed', 'mcp.auth.failed', 'error'],
    ['rate_limited', 'mcp.rate_limited', 'warn'],
    ['latency_observed', 'mcp.latency.observed', 'info'],
  ])('maps MCP action %s to %s', async (action, eventName, severity) => {
    const { forensicEventFromTimelineEvent } = await import('../../../src/specialist/forensic-events.js');
    const event = forensicEventFromTimelineEvent(
      { t: 1_780_000_000_003, type: 'mcp', action, mcp_server: 'grafana', mcp_method: 'tools/call' },
      { jobId: `job-${action}`, specialist: 'devops', repo: 'specialists' },
    );

    expect(event.event_name).toBe(eventName);
    expect(event.severity).toBe(severity);
  });

  it('falls back to timeline correlation fields when context fields are absent', async () => {
    const { forensicEventFromTimelineEvent } = await import('../../../src/specialist/forensic-events.js');
    const event = forensicEventFromTimelineEvent(
      {
        t: 1_780_000_000_001,
        type: 'turn',
        phase: 'start',
        session_id: 'session-from-event',
        conversation_id: 'conversation-from-event',
        trace_id: 'trace-from-event',
        span_id: 'span-from-event',
        parent_span_id: 'parent-span-from-event',
      },
      { jobId: 'job-2', specialist: 'executor', repo: 'specialists' },
    );

    expect(event.correlation).toMatchObject({
      job_id: 'job-2',
      session_id: 'session-from-event',
      conversation_id: 'conversation-from-event',
      trace_id: 'trace-from-event',
      span_id: 'span-from-event',
      parent_span_id: 'parent-span-from-event',
    });
  });
});
