import { describe, expect, it } from 'vitest';
import { createForensicEvent } from '../../../src/specialist/forensic-events.js';
import { renderPrometheusProjection, validatePrometheusProjectionText } from '../../../src/specialist/prometheus-projection.js';
import type { JobMetricsRecord } from '../../../src/specialist/observability-sqlite.js';
import type { SupervisorStatus } from '../../../src/specialist/supervisor.js';

function metric(overrides: Partial<JobMetricsRecord> = {}): JobMetricsRecord {
  return {
    job_id: 'job-1',
    specialist: 'executor',
    model: 'openai/gpt-5.4-mini',
    status: 'completed',
    chain_kind: 'job',
    chain_id: 'chain-1',
    bead_id: 'unitAI-1',
    node_id: null,
    epic_id: null,
    started_at_ms: 1_000,
    completed_at_ms: 6_000,
    elapsed_ms: 5_000,
    active_runtime_ms: 4_000,
    waiting_ms: 1_000,
    total_turns: 2,
    total_tools: 3,
    tool_call_counts_json: JSON.stringify({ bash: 2, read_file: 1 }),
    token_trajectory_json: JSON.stringify([{ input_tokens: 100, output_tokens: 50, cache_read_tokens: 25 }]),
    context_trajectory_json: JSON.stringify([{ pct: 42 }]),
    stall_gaps_json: '[]',
    run_complete_json: null,
    startup_payload_json: null,
    updated_at_ms: 10_000,
    ...overrides,
  };
}

describe('prometheus-projection', () => {
  it('rejects forbidden labels in Prometheus text fixtures', () => {
    const result = validatePrometheusProjectionText('xtrm_jobs_total{service_name="specialists",job_id="job-1"} 1\n');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain('job_id');
  });

  it('renders contract metrics with only low-cardinality labels', () => {
    const output = renderPrometheusProjection({
      repo: 'specialists',
      nowMs: 1_780_000_000_000,
      statuses: [
        { id: 'job-1', specialist: 'executor', status: 'running', worktree_path: '/tmp/wt' } as unknown as SupervisorStatus,
        { id: 'job-2', specialist: 'reviewer', status: 'waiting' } as unknown as SupervisorStatus,
      ],
      jobMetrics: [metric()],
    });

    expect(output).toContain('# TYPE xtrm_job_state gauge');
    expect(output).toContain('xtrm_jobs_total');
    expect(output).toContain('xtrm_job_duration_seconds_bucket');
    expect(output).toContain('xtrm_job_active_runtime_seconds_bucket');
    expect(output).toContain('xtrm_job_wait_seconds_bucket');
    expect(output).toContain('xtrm_job_queue_depth');
    expect(output).toContain('xtrm_processes');
    expect(output).toContain('xtrm_worktrees');
    expect(output).toContain('xtrm_turns_total');
    expect(output).toContain('xtrm_context_usage_ratio');
    expect(output).toContain('xtrm_tool_calls_total');
    expect(output).toContain('xtrm_llm_tokens_total');
    expect(output).toContain('participant_kind="specialist"');
    expect(output).toContain('participant_role="executor"');
    expect(output).toContain('tool_name="bash"');
    expect(output).toContain('direction="input"');
    expect(validatePrometheusProjectionText(output)).toEqual({ ok: true });
    expect(output).not.toMatch(/job_id=|bead_id=|chain_id=|participant_id=|trace_id=/);
  });


  it('projects token splits and uses total only as unsplit fallback', () => {
    const output = renderPrometheusProjection({
      repo: 'specialists',
      statuses: [],
      jobMetrics: [
        metric({
          token_trajectory_json: JSON.stringify([{
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 25,
            cache_creation_tokens: 10,
            reasoning_tokens: 7,
            tool_tokens: 3,
            total_tokens: 195,
          }]),
        }),
        metric({
          job_id: 'job-unsplit',
          token_trajectory_json: JSON.stringify([{ total_tokens: 42 }]),
        }),
      ],
      nowMs: 1_780_000_000_000,
    });

    expect(output).toContain('direction="input"');
    expect(output).toContain('direction="output"');
    expect(output).toContain('direction="cache_read"');
    expect(output).toContain('direction="cache_creation"');
    expect(output).toContain('direction="reasoning"');
    expect(output).toContain('direction="tool"');
    expect(output).toContain('direction="total"');
    expect(output).not.toContain('cost_usd');
  });

  it('is replay-safe for table-derived counters across repeated renders', () => {
    const input = {
      repo: 'specialists',
      statuses: [] as SupervisorStatus[],
      jobMetrics: [metric(), metric({ job_id: 'job-2', elapsed_ms: 7_000 })],
      nowMs: 1_780_000_000_000,
    };

    expect(renderPrometheusProjection(input)).toBe(renderPrometheusProjection(input));
  });


  it('projects MCP forensic events without opaque id labels', () => {
    const resource = {
      service_namespace: 'xtrm',
      service_name: 'specialists',
      service_component: 'test',
      deployment_environment: 'local',
      repo: 'specialists',
    };
    const output = renderPrometheusProjection({
      repo: 'specialists',
      statuses: [],
      jobMetrics: [],
      forensicEvents: [
        createForensicEvent({
          event_family: 'mcp',
          event_name: 'mcp.call.completed',
          resource,
          correlation: { mcp_session_id: 'mcp-session-1', jsonrpc_request_id: 'rpc-1', trace_id: 'trace-1' },
          body: { mcp_server: 'grafana', mcp_method: 'tools/call', duration_ms: 120 },
        }),
        createForensicEvent({
          event_family: 'mcp',
          event_name: 'mcp.auth.failed',
          resource,
          correlation: { mcp_session_id: 'mcp-session-2', jsonrpc_request_id: 'rpc-2' },
          body: { mcp_server: 'prometheus', mcp_method: 'tools/call', error_type: 'auth_failed' },
        }),
        createForensicEvent({
          event_family: 'mcp',
          event_name: 'mcp.rate_limited',
          resource,
          correlation: { mcp_session_id: 'mcp-session-3' },
          body: { mcp_server: 'grafana', mcp_method: 'tools/call' },
        }),
      ],
      nowMs: 1_780_000_000_000,
    });

    expect(output).toContain('xtrm_mcp_operations_total');
    expect(output).toContain('mcp_server="grafana"');
    expect(output).toContain('mcp_server="prometheus"');
    expect(output).toContain('mcp_method="tools_call"');
    expect(output).toContain('result="success"');
    expect(output).toContain('result="error"');
    expect(output).toContain('result="rate_limited"');
    expect(validatePrometheusProjectionText(output)).toEqual({ ok: true });
    expect(output).not.toMatch(/mcp_session_id=|jsonrpc_request_id=|trace_id=/);
  });

  it('projects identity, policy, and eval forensic events without opaque id labels', () => {
    const resource = {
      service_namespace: 'xtrm',
      service_name: 'specialists',
      service_component: 'test',
      deployment_environment: 'local',
      repo: 'specialists',
    };
    const output = renderPrometheusProjection({
      repo: 'specialists',
      statuses: [],
      jobMetrics: [],
      forensicEvents: [
        createForensicEvent({
          event_family: 'identity',
          event_name: 'identity.credential.issued',
          resource,
          correlation: { identity_request_id: 'identity-1' },
          body: { credential_kind: 'api_key', provider: 'anthropic' },
        }),
        createForensicEvent({
          event_family: 'identity',
          event_name: 'identity.credential.failed',
          resource,
          correlation: { identity_request_id: 'identity-2' },
          body: { credential_kind: 'oauth_token', provider: 'github', error_type: 'auth_failed' },
        }),
        createForensicEvent({
          event_family: 'policy',
          event_name: 'policy.decision.allowed',
          resource,
          correlation: { policy_decision_id: 'policy-1' },
          body: { policy_kind: 'tool_policy', action_kind: 'tool_call' },
        }),
        createForensicEvent({
          event_family: 'policy',
          event_name: 'policy.mismatch.detected',
          resource,
          correlation: { policy_decision_id: 'policy-2' },
          body: { policy_kind: 'permission_tier', action_kind: 'repo_write', severity: 'high' },
        }),
        createForensicEvent({
          event_family: 'eval',
          event_name: 'eval.completed',
          resource,
          correlation: { eval_id: 'eval-1' },
          body: { eval_kind: 'safety', result: 'pass', score: 0.98 },
        }),
        createForensicEvent({
          event_family: 'eval',
          event_name: 'eval.score.recorded',
          resource,
          correlation: { eval_id: 'eval-2' },
          body: { eval_kind: 'policy_compliance', score: 0.88 },
        }),
      ],
      nowMs: 1_780_000_000_000,
    });

    expect(output).toContain('xtrm_identity_operations_total');
    expect(output).toContain('credential_kind="api_key"');
    expect(output).toContain('credential_kind="oauth_token"');
    expect(output).toContain('xtrm_policy_decisions_total');
    expect(output).toContain('policy_kind="tool_policy"');
    expect(output).toContain('action_kind="tool_call"');
    expect(output).toContain('xtrm_policy_mismatches_total');
    expect(output).toContain('severity="high"');
    expect(output).toContain('xtrm_eval_runs_total');
    expect(output).toContain('eval_kind="safety"');
    expect(output).toContain('xtrm_eval_score');
    expect(output).toContain('eval_kind="policy_compliance"');
    expect(validatePrometheusProjectionText(output)).toEqual({ ok: true });
    expect(output).not.toMatch(/identity_request_id=|policy_decision_id=|eval_id=/);
  });

  it('normalizes terminal results without exposing raw ids as labels', () => {
    const output = renderPrometheusProjection({
      repo: 'specialists',
      statuses: [],
      jobMetrics: [metric({ status: 'error', elapsed_ms: 12_000 })],
      nowMs: 1,
    });

    expect(output).toContain('result="error"');
    expect(output).toContain('xtrm_job_duration_seconds_count');
    expect(output).not.toContain('job-1');
    expect(output).not.toContain('unitAI-1');
    expect(output).not.toContain('chain-1');
  });
});
