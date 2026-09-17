// tests/unit/specialist/session-metrics-contract.test.ts
//
// SPECIALISTS-120 validation: the neutral telemetry contract must preserve what Pi reported,
// must never claim provenance it does not have, and must never fold `reasoning` into a total.
import { describe, expect, it } from 'vitest';
import {
  accumulateTokenUsage,
  capturePiUsageVerbatim,
  normalizePiSessionStats,
  normalizeSessionTokenUsage,
  reconcileSessionUsage,
} from '../../../src/specialist/session-metrics-contract.js';

/**
 * The exact `Usage` object Pi 0.85.1 returned for a live zai/glm-5.3-flash turn
 * (probe run, 2026-09-18). Copied verbatim on purpose: this fixture is the contract.
 */
const LIVE_PI_USAGE = {
  input: 2142,
  output: 16,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 12,
  totalTokens: 2158,
  cost: { input: 0.00016065, output: 0.000004, cacheRead: 0, cacheWrite: 0, total: 0.00016465 },
};

/** Anthropic-shaped usage: `cacheWrite1h` exists only on that provider. */
const ANTHROPIC_USAGE = {
  input: 100,
  output: 50,
  cacheRead: 1000,
  cacheWrite: 2000,
  cacheWrite1h: 1500,
  reasoning: 30,
  totalTokens: 3150,
  cost: { input: 0.001, output: 0.002, cacheRead: 0.003, cacheWrite: 0.004, total: 0.01 },
};

describe('normalizeSessionTokenUsage — verbatim capture (SPECIALISTS-120 criterion 1)', () => {
  it('keeps cacheWrite1h and the whole cost breakdown', () => {
    const usage = normalizeSessionTokenUsage(ANTHROPIC_USAGE);
    expect(usage).toBeDefined();
    expect(usage?.cache_write_1h_tokens).toBe(1500);
    expect(usage?.cache_creation_tokens).toBe(2000);
    expect(usage?.cache_read_tokens).toBe(1000);
    expect(usage?.cost).toEqual({ input: 0.001, output: 0.002, cacheRead: 0.003, cacheWrite: 0.004, total: 0.01 });
  });

  it('keeps the raw Pi usage object under pi_usage, including fields the normalizer does not name', () => {
    const usage = normalizeSessionTokenUsage({ ...LIVE_PI_USAGE, someFutureProviderField: 7 });
    expect(usage?.pi_usage).toMatchObject({
      input: 2142,
      output: 16,
      reasoning: 12,
      totalTokens: 2158,
      someFutureProviderField: 7,
    });
    expect(usage?.pi_usage?.cost).toEqual(LIVE_PI_USAGE.cost);
  });

  it('does not alias the input object: later mutation cannot rewrite captured telemetry', () => {
    const source = { ...LIVE_PI_USAGE, cost: { ...LIVE_PI_USAGE.cost } };
    const usage = normalizeSessionTokenUsage(source);
    source.cost.total = 999;
    source.input = 999;
    expect(usage?.pi_usage?.cost?.total).toBe(0.00016465);
    expect(usage?.pi_usage?.input).toBe(2142);
  });

  it('capturePiUsageVerbatim returns undefined for a usage-shaped object carrying no numbers', () => {
    expect(capturePiUsageVerbatim({ input: 'lots', output: null })).toBeUndefined();
    expect(capturePiUsageVerbatim(null)).toBeUndefined();
    expect(capturePiUsageVerbatim([1, 2, 3])).toBeUndefined();
  });
});

describe('usage provenance is truthful (SPECIALISTS-120 criterion 4)', () => {
  it('defaults to unknown, NOT provider_usage, when the payload carries no provenance marker', () => {
    const usage = normalizeSessionTokenUsage({ input: 10, output: 5 });
    expect(usage?.usage_source).toBe('unknown');
  });

  it('honours an explicit provider marker', () => {
    expect(normalizeSessionTokenUsage({ input: 10, usage_source: 'provider_usage' })?.usage_source).toBe('provider_usage');
    expect(normalizeSessionTokenUsage({ input: 10, usage_source: 'local_estimate' })?.usage_source).toBe('local_estimate');
  });

  it('downgrades an unrecognised provenance string to unknown rather than trusting it', () => {
    expect(normalizeSessionTokenUsage({ input: 10, usage_source: 'probably_fine' })?.usage_source).toBe('unknown');
  });

  it('returns undefined when nothing numeric survived, so no event claims Pi reported anything', () => {
    expect(normalizeSessionTokenUsage({ input: 'n/a' })).toBeUndefined();
    expect(normalizeSessionTokenUsage(undefined)).toBeUndefined();
  });
});

describe('reasoning is never added on top of output (SPECIALISTS-120 criterion 6)', () => {
  it('derives totalTokens from input+output+cache only when Pi omitted it', () => {
    const usage = normalizeSessionTokenUsage({ input: 100, output: 20, cacheRead: 5, cacheWrite: 2, reasoning: 15 });
    // 100 + 20 + 5 + 2 — reasoning (15) is a SUBSET of output and must not be added again.
    expect(usage?.total_tokens).toBe(127);
    expect(usage?.reasoning_tokens).toBe(15);
  });

  it('trusts Pi totalTokens verbatim instead of recomputing it', () => {
    const usage = normalizeSessionTokenUsage(LIVE_PI_USAGE);
    expect(usage?.total_tokens).toBe(2158);
    // 2142 + 16 = 2158: reasoning 12 is inside output, not beside it.
    expect(usage?.reasoning_tokens).toBe(12);
  });

  it('accumulating a reasoning-bearing message does not inflate output or total', () => {
    const seen: Record<string, number> = {};
    const first = accumulateTokenUsage(undefined, { input_tokens: 100, output_tokens: 20, total_tokens: 120, reasoning_tokens: 15 }, seen);
    const second = accumulateTokenUsage(first, { input_tokens: 10, output_tokens: 5, total_tokens: 15, reasoning_tokens: 3 }, seen);
    expect(second).toMatchObject({ input_tokens: 110, output_tokens: 25, total_tokens: 135, reasoning_tokens: 18 });
  });
});

describe('reconcileSessionUsage (SPECIALISTS-120 criterion 5)', () => {
  it('reconciles exactly when summed usage matches the Pi session snapshot, cost included', () => {
    const summed = normalizeSessionTokenUsage(LIVE_PI_USAGE)!;
    const stats = normalizePiSessionStats({
      sessionId: 'sess',
      tokens: { input: 2142, output: 16, cacheRead: 0, cacheWrite: 0, total: 2158 },
      cost: 0.00016465,
      contextUsage: { tokens: 2158, contextWindow: 1_000_000, percent: 0.2158 },
    })!;

    const result = reconcileSessionUsage(summed, stats);
    expect(result).toBeDefined();
    expect(result?.reconciled).toBe(true);
    expect(result?.cost_compared).toBe(true);
    for (const [field, entry] of Object.entries(result!.fields)) {
      expect(entry.delta, `${field} delta must be zero`).toBe(0);
    }
  });

  it('reports a per-field delta and reconciled=false when Pi counted usage Specialists did not sum', () => {
    const summed = normalizeSessionTokenUsage({ input: 100, output: 20, totalTokens: 120 })!;
    const stats = normalizePiSessionStats({ tokens: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, total: 180 } })!;

    const result = reconcileSessionUsage(summed, stats)!;
    expect(result.reconciled).toBe(false);
    expect(result.fields.total).toEqual({ summed: 120, session_stats: 180, delta: -60 });
    // Pi reported no cost total, so cost is not compared and cannot make the run "unreconciled".
    expect(result.cost_compared).toBe(false);
    expect(result.fields.cost).toBeUndefined();
  });

  it('does not compare `reasoning`, which would double-count the same tokens', () => {
    const summed = normalizeSessionTokenUsage({ input: 10, output: 20, reasoning: 5, totalTokens: 30 })!;
    const stats = normalizePiSessionStats({ tokens: { input: 10, output: 20, total: 30 } })!;
    const result = reconcileSessionUsage(summed, stats)!;
    expect(Object.keys(result.fields).sort()).toEqual(['cacheRead', 'cacheWrite', 'input', 'output', 'total']);
    expect(result.reconciled).toBe(true);
  });

  it('returns undefined rather than a false negative when Pi reported no token totals', () => {
    expect(reconcileSessionUsage(normalizeSessionTokenUsage(LIVE_PI_USAGE), undefined)).toBeUndefined();
    expect(reconcileSessionUsage(normalizeSessionTokenUsage(LIVE_PI_USAGE), normalizePiSessionStats({ cost: 1 }))).toBeUndefined();
  });
});

describe('normalizePiSessionStats', () => {
  it('keeps the measured --no-session response shape, sessionFile absent', () => {
    // Copied from a live `pi --mode rpc --no-session` probe; sessionFile is undefined there.
    const stats = normalizePiSessionStats({
      sessionId: '01a0b028-27a0-7485-ada1-15ef8b402e37',
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 2,
      tokens: { input: 2142, output: 16, cacheRead: 0, cacheWrite: 0, total: 2158 },
      cost: 0.00016465,
      contextUsage: { tokens: 2158, contextWindow: 1_000_000, percent: 0.2158 },
    });
    expect(stats?.sessionFile).toBeUndefined();
    expect(stats?.tokens?.total).toBe(2158);
    expect(stats?.cost).toBe(0.00016465);
    expect(stats?.contextUsage).toEqual({ tokens: 2158, contextWindow: 1_000_000, percent: 0.2158 });
  });

  it('preserves post-compaction nulls instead of turning them into zero', () => {
    const stats = normalizePiSessionStats({ contextUsage: { tokens: null, contextWindow: 200_000, percent: null } });
    expect(stats?.contextUsage?.tokens).toBeNull();
    expect(stats?.contextUsage?.percent).toBeNull();
  });
});
