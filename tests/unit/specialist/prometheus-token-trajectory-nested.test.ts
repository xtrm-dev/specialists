import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';
import {
  ensureObservabilityDbFile,
  resolveObservabilityDbLocation,
} from '../../../src/specialist/observability-db.js';
import { renderPrometheusProjection } from '../../../src/specialist/prometheus-projection.js';

/**
 * XTRM-93 N3: xtrm_llm_tokens_total is emitted with zero series because the
 * reader looks for flat keys while the writer nests counters under
 * `token_usage`. This regression drives the REAL writer path
 * (aggregateJobMetrics producing specialist_job_metrics.token_trajectory_json)
 * and asserts the projection is non-empty.
 */
describe('prometheus token trajectory nested shape (XTRM-93 N3)', () => {
  let tempRoot: string;
  let sqliteClient: ReturnType<typeof createObservabilitySqliteClientAtPath> | null = null;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `test-prom-token-nested-${crypto.randomUUID()}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    if (sqliteClient) {
      try { sqliteClient.close(); } catch { /* ignore */ }
      sqliteClient = null;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function createClient() {
    const location = resolveObservabilityDbLocation(tempRoot);
    ensureObservabilityDbFile(location);
    const client = createObservabilitySqliteClientAtPath(location.dbPath);
    expect(client).not.toBeNull();
    sqliteClient = client;
    return client!;
  }

  it('projects nested token_usage from the real aggregation path', () => {
    const client = createClient();
    client.upsertStatus({
      id: 'job-nested',
      specialist: 'executor',
      status: 'done',
      started_at_ms: 1,
      last_event_at_ms: 5,
    } as never);
    // First boundary: turn_summary nests its counters under token_usage.
    client.appendEvent('job-nested', 'executor', 'bead-1', {
      t: 70,
      type: 'turn_summary',
      turn_index: 1,
      token_usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 },
    } as never);
    // Last boundary (what the reader reads): token_usage event, also nested.
    // Distinct values prove the projection reflects the LAST element.
    client.appendEvent('job-nested', 'executor', 'bead-1', {
      t: 80,
      type: 'token_usage',
      source: 'turn_end',
      token_usage: {
        input_tokens: 2097,
        output_tokens: 150,
        cache_read_tokens: 40,
        cache_creation_tokens: 5,
        total_tokens: 2292,
      },
    } as never);
    client.appendEvent('job-nested', 'executor', 'bead-1', {
      t: 100,
      type: 'run_complete',
      status: 'COMPLETE',
      elapsed_s: 0.1,
      model: 'openai/gpt-5.4-mini',
    } as never);

    const record = client.aggregateJobMetrics('job-nested');
    expect(record).not.toBeNull();

    // Prove we exercised the real writer shape: the trajectory came from the
    // aggregator, the last element nests under token_usage, and it carries
    // NO flat keys for the reader to (incorrectly) rely on.
    const trajectory = JSON.parse(record!.token_trajectory_json) as Array<Record<string, unknown>>;
    expect(trajectory).toHaveLength(2);
    const last = trajectory.at(-1)!;
    expect(last.token_usage).toMatchObject({ input_tokens: 2097, output_tokens: 150 });
    expect(last).not.toHaveProperty('input_tokens');
    expect(last).not.toHaveProperty('total_tokens');

    // The projection must yield a non-empty sample with the values present
    // in the JSON and the expected direction labels.
    const output = renderPrometheusProjection({
      repo: 'test-repo',
      statuses: [],
      jobMetrics: [record!],
      nowMs: 1_780_000_000_000,
    });

    expect(output).toContain('xtrm_llm_tokens_total');
    expect(output).toContain('direction="input"');
    expect(output).toContain('direction="output"');
    expect(output).toContain('direction="cache_read"');
    expect(output).toContain('direction="cache_creation"');
    expect(output).toMatch(/xtrm_llm_tokens_total\{[^}]*direction="input"[^}]*\} 2097/);
    expect(output).toMatch(/xtrm_llm_tokens_total\{[^}]*direction="output"[^}]*\} 150/);
    expect(output).toMatch(/xtrm_llm_tokens_total\{[^}]*direction="cache_read"[^}]*\} 40/);
    expect(output).toMatch(/xtrm_llm_tokens_total\{[^}]*direction="cache_creation"[^}]*\} 5/);
  });

  it('still projects the legacy flat shape', () => {
    const output = renderPrometheusProjection({
      repo: 'test-repo',
      statuses: [],
      jobMetrics: [{
        job_id: 'job-flat',
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
        total_turns: 1,
        total_tools: 0,
        tool_call_counts_json: '{}',
        token_trajectory_json: JSON.stringify([{
          input_tokens: 100,
          output_tokens: 50,
          cache_read_tokens: 25,
        }]),
        context_trajectory_json: '[]',
        stall_gaps_json: '[]',
        run_complete_json: null,
        startup_payload_json: null,
        cost_total: null,
        session_stats_json: null,
        usage_reconciliation_json: null,
        pi_version: null,
        context_pct_source: null,
        updated_at_ms: 10_000,
      }],
      nowMs: 1_780_000_000_000,
    });

    expect(output).toContain('xtrm_llm_tokens_total');
    expect(output).toMatch(/xtrm_llm_tokens_total\{[^}]*direction="input"[^}]*\} 100/);
    expect(output).toMatch(/xtrm_llm_tokens_total\{[^}]*direction="output"[^}]*\} 50/);
    expect(output).toMatch(/xtrm_llm_tokens_total\{[^}]*direction="cache_read"[^}]*\} 25/);
  });
});
