import { describe, it, expect } from 'vitest';

import {
  activationDisplayEntry,
  activationDisplayMarker,
  activationDisplayMetrics,
  buildFleetDisplay,
  fleetDisplayHeader,
  formatDisplayElapsed,
  formatDisplaySpend,
  formatDisplayTurns,
  DISPLAY_IDLE_AFTER_S,
} from '../../../src/tools/specialist/specialist-display.js';

const NOW = 1_000_000;

// A fixed running snapshot shape (camelCase, as the host holds it).
function runningSnapshot(overrides = {}) {
  return {
    activationId: 'act:aaaa1111-bb2',
    state: 'running',
    issueRef: 'XTRM-241',
    bead_id: 'bd-legacy-1',
    startedAt: NOW - 134_000,
    turnCount: 3,
    tokenUsage: { input_tokens: 9000, output_tokens: 3000 },
    lastActivityAt: NOW - 5_000,
    ...overrides,
  };
}

describe('specialist display formatter (SPECIALISTS-4365 canonical rules)', () => {
  it('spends input + output + cache_creation + cache_read only', () => {
    expect(formatDisplaySpend(undefined)).toBe('');
    expect(formatDisplaySpend({})).toBe('');
    expect(formatDisplaySpend({ input_tokens: 9000, output_tokens: 3000 })).toBe('12k');
    // reasoning_tokens is a SUBSET of output and tool_tokens is outside Pi's
    // precomputed total — both are display-only splits, never summands.
    expect(
      formatDisplaySpend({
        input_tokens: 9000,
        output_tokens: 3000,
        reasoning_tokens: 2000,
        tool_tokens: 4000,
        total_tokens: 999_999,
      }),
    ).toBe('12k');
    expect(
      formatDisplaySpend({ input_tokens: 100, output_tokens: 200, cache_creation_tokens: 300, cache_read_tokens: 400 }),
    ).toBe('1.0k');
    // Legacy camel keys (test/fixture shape) are honoured the same way.
    expect(formatDisplaySpend({ input: 500, output: 300, cache: 100 })).toBe('900');
    expect(formatDisplaySpend({ input_tokens: 500, cache_write_1h_tokens: 500 })).toBe('500');
  });

  it('formats elapsed and turns like both frontends did', () => {
    expect(formatDisplayElapsed(0)).toBe('0s');
    expect(formatDisplayElapsed(42)).toBe('42s');
    expect(formatDisplayElapsed(134)).toBe('2m14s');
    expect(formatDisplayElapsed(3900)).toBe('1h05m');
    expect(formatDisplayTurns(undefined)).toBe('');
    expect(formatDisplayTurns(null)).toBe('');
    expect(formatDisplayTurns(0)).toBe('0 turns');
    expect(formatDisplayTurns(1)).toBe('1 turn');
    expect(formatDisplayTurns(56)).toBe('56 turns');
  });

  it('uses one ask wording', () => {
    const metrics = activationDisplayMetrics(runningSnapshot(), {
      activationId: 'act:aaaa1111-bb2',
      askedAt: NOW - 19_000,
    }, NOW);
    expect(metrics).toBe('asked 19s');
  });

  it(`reports the idle reason after ${DISPLAY_IDLE_AFTER_S}s instead of stats`, () => {
    const metrics = activationDisplayMetrics(
      runningSnapshot({ lastActivityAt: NOW - 42_000 }),
      undefined,
      NOW,
    );
    expect(metrics).toBe('idle 42s');
    // Fresh activity keeps the stats.
    expect(activationDisplayMetrics(runningSnapshot(), undefined, NOW)).toBe('2m14s 3 turns 12k');
  });

  it('identifies work by issue_ref, never the legacy bead id', () => {
    const entry = activationDisplayEntry(runningSnapshot(), undefined, NOW);
    expect(entry.work).toBe('XTRM-241');
    expect(activationDisplayEntry(runningSnapshot({ issueRef: undefined }), undefined, NOW).work).toBe('bd-legacy-1');
    expect(activationDisplayEntry({ activationId: 'act:x', state: 'running' }, undefined, NOW).work).toBe('—');
  });

  it('marks blocked, settled, failed, working and quiet distinctly', () => {
    const ask = { activationId: 'act:aaaa1111-bb2', askedAt: NOW };
    expect(activationDisplayMarker(runningSnapshot(), ask, NOW)).toBe('!');
    expect(activationDisplayMarker({ ...runningSnapshot(), state: 'settled' }, undefined, NOW)).toBe('✓');
    expect(activationDisplayMarker({ ...runningSnapshot(), state: 'failed' }, undefined, NOW)).toBe('✕');
    // Working: a spinner frame.
    expect(['◐', '◓', '◑', '◒']).toContain(activationDisplayMarker(runningSnapshot(), undefined, NOW));
    // Quiet past the threshold: the static dot, like a waiting row.
    expect(
      activationDisplayMarker(runningSnapshot({ lastActivityAt: NOW - 60_000 }), undefined, NOW),
    ).toBe('●');
    expect(activationDisplayMarker({ ...runningSnapshot(), state: 'waiting' }, undefined, NOW)).toBe('●');
  });

  it('headers an empty fleet idle and keeps buckets exclusive', () => {
    expect(fleetDisplayHeader([], [])).toBe('idle');
    const one = [runningSnapshot({ activationId: 'act:1', issueRef: 'XTRM-1' })];
    expect(fleetDisplayHeader(one, [])).toBe('1 running');
    // blocked counts ACTIVATIONS with an ask, and running excludes them.
    const two = [
      runningSnapshot({ activationId: 'act:1', issueRef: 'XTRM-1' }),
      { ...runningSnapshot({ activationId: 'act:2', issueRef: 'XTRM-2' }), state: 'waiting' },
    ];
    expect(
      fleetDisplayHeader(two, [{ activationId: 'act:2', askedAt: NOW }]),
    ).toBe('1 running 1 blocked');
  });

  it('builds one entry per activation in payload order', () => {
    const activations = [
      runningSnapshot({ activationId: 'act:1', issueRef: 'XTRM-1' }),
      { ...runningSnapshot({ activationId: 'act:2', issueRef: 'XTRM-2' }), state: 'settled' },
    ];
    const display = buildFleetDisplay(activations, [], NOW);
    // Settled work is neither live nor blocked, so it lands in `waiting` — the
    // same bucket both frontends already used for non-live, non-blocked rows.
    expect(display.header).toBe('1 running 1 waiting');
    expect(display.activations.map((e) => e.activation_id)).toEqual(['act:1', 'act:2']);
    expect(display.activations[1]?.work).toBe('XTRM-2');
    expect(display.activations[1]?.marker).toBe('✓');
  });

  it('reads wire (snake_case) views as well as snapshots', () => {
    const display = buildFleetDisplay(
      [{
        activation_id: 'act:wire-1',
        state: 'running',
        issue_ref: 'XTRM-9',
        elapsed_s: 61,
        turn_count: 1,
        token_usage: { input_tokens: 10 },
        last_activity_at: NOW - 1000,
      }],
      [{ activation_id: 'act:wire-1', asked_at: NOW - 9000 }],
      NOW,
    );
    expect(display.header).toBe('1 blocked');
    expect(display.activations[0]).toMatchObject({
      activation_id: 'act:wire-1',
      marker: '!',
      metrics: 'asked 9s',
      work: 'XTRM-9',
    });
  });
});
