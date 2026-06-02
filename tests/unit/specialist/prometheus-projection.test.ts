import { describe, expect, it } from 'vitest';
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

  it('is replay-safe for table-derived counters across repeated renders', () => {
    const input = {
      repo: 'specialists',
      statuses: [] as SupervisorStatus[],
      jobMetrics: [metric(), metric({ job_id: 'job-2', elapsed_ms: 7_000 })],
      nowMs: 1_780_000_000_000,
    };

    expect(renderPrometheusProjection(input)).toBe(renderPrometheusProjection(input));
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
