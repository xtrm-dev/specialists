import { describe, expect, it } from 'vitest';
import {
  annotateFleetWithLive,
  createFleetOverlayState,
  flattenFleet,
  reduceFleetOverlayState,
  renderFleetOverlay,
} from '../../../config/pi-extensions/specialist-subagents/fleet-overlay.mjs';

function snapshot() {
  const parent = {
    jobId: 'act:parent123456', specialist: 'reviewer', beadId: 'XTRM-96', state: 'active', attention: 'active', native: true,
    children: ['act:child123456'], lastEventAtMs: 200,
  };
  const child = {
    jobId: 'act:child123456', specialist: 'explorer', beadId: 'unitAI-child', state: 'waiting', attention: 'blocked', native: true,
    parentJobId: parent.jobId, children: [], lastEventAtMs: 210,
  };
  const tmux = {
    jobId: 'sp:legacy123456', specialist: 'test-engineer', beadId: 'unitAI-test', state: 'running', attention: 'active', native: false,
    children: [], lastEventAtMs: 190,
    attachment: { kind: 'xtmux.agent_instance', hostId: 'host', paneId: '%7', direct: true },
  };
  return {
    nodes: [child, parent, tmux],
    byId: new Map([[parent.jobId, parent], [child.jobId, child], [tmux.jobId, tmux]]),
    roots: [parent.jobId, tmux.jobId],
    counts: { total: 3, active: 2, waiting: 1, warning: 0, failed: 0, settled: 0 },
  };
}

describe('native fleet overlay model', () => {
  it('renders persisted parent/child topology and keeps ancestors when filtering a child', () => {
    const fleet = snapshot();
    expect(flattenFleet(fleet).map((row) => [row.node.specialist, row.depth])).toEqual([
      ['reviewer', 0],
      ['explorer', 1],
      ['test-engineer', 0],
    ]);

    const filtered = flattenFleet(fleet, { filter: 'explorer' });
    expect(filtered.map((row) => [row.node.specialist, row.depth])).toEqual([
      ['reviewer', 0],
      ['explorer', 1],
    ]);
  });

  it('selection follows visible fleet rows and scrolling pauses live follow', () => {
    const fleet = snapshot();
    let state = createFleetOverlayState();
    state = reduceFleetOverlayState(state, { type: 'next' }, fleet);
    expect(state.selectedJobId).toBe('act:parent123456');

    state = reduceFleetOverlayState(state, { type: 'next' }, fleet);
    expect(state.selectedJobId).toBe('act:child123456');

    state = reduceFleetOverlayState(state, { type: 'scroll', delta: 4 }, fleet);
    expect(state.follow).toBe(false);
    expect(state.scroll).toBe(4);

    state = reduceFleetOverlayState(state, { type: 'follow' }, fleet);
    expect(state.follow).toBe(true);
    expect(state.scroll).toBe(0);
  });

  it('cycles LOG/FEED/RESULT/DETAIL without losing selected activation', () => {
    const fleet = snapshot();
    let state = createFleetOverlayState({ selectedJobId: 'act:child123456' });
    for (const mode of ['feed', 'result', 'detail', 'log']) {
      state = reduceFleetOverlayState(state, { type: 'next-mode' }, fleet);
      expect(state.mode).toBe(mode);
      expect(state.selectedJobId).toBe('act:child123456');
    }
  });

  it('produces a bounded responsive operator surface from redaction-safe chronology rows', () => {
    const fleet = snapshot();
    const state = createFleetOverlayState({ selectedJobId: 'act:parent123456', mode: 'log' });
    const view = renderFleetOverlay({
      snapshot: fleet,
      state,
      chronology: [
        { ts: 100, type: 'job.started', actor: 'reviewer:parent', payload: 'status=active repo=specialists' },
        { ts: 200, type: 'review.finding', actor: 'reviewer:parent', payload: 'severity=warn' },
      ],
      width: 64,
      height: 18,
    });

    expect(view.lines).toHaveLength(18);
    expect(view.lines.every((line) => line.length <= 64)).toBe(true);
    expect(view.lines.some((line) => line.includes('reviewer:parent1234'))).toBe(true);
    expect(view.lines.some((line) => line.includes('╰─ ! explorer:child12345'))).toBe(true);
    expect(view.lines.some((line) => line.includes('LOG · FOLLOW'))).toBe(true);
    expect(view.lines.some((line) => line.includes('review.finding'))).toBe(true);
  });

  it('never exceeds a narrow viewport and preserves the close keybar', () => {
    const fleet = snapshot();
    const view = renderFleetOverlay({
      snapshot: fleet,
      state: createFleetOverlayState({ selectedJobId: 'act:parent123456' }),
      chronology: [{ ts: '2026-09-16T22:45:12Z', type: 'job.started', actor: 'reviewer', payload: 'status=active' }],
      width: 28,
      height: 8,
    });
    expect(view.lines).toHaveLength(8);
    expect(view.lines.every((line) => line.length <= 28)).toBe(true);
    expect(view.lines.some((line) => line.includes('22:45:12'))).toBe(true);
    expect(view.lines.at(-1)).toContain('Esc');
  });

  it('renders an attempt-aware result projection and fail-closed attempt error', () => {
    const fleet = snapshot();
    const view = renderFleetOverlay({
      snapshot: fleet,
      state: createFleetOverlayState({ selectedJobId: 'act:parent123456', mode: 'result' }),
      result: {
        jobId: 'act:parent123456',
        attemptId: 'att:parent123456:2',
        attemptVerified: true,
        output: 'accepted result',
        available: true,
      },
      width: 60,
      height: 14,
    });
    expect(view.lines.some((line) => line.includes('att:parent123456:2'))).toBe(true);
    expect(view.lines.some((line) => line.includes('accepted result'))).toBe(true);

    const rejected = renderFleetOverlay({
      snapshot: fleet,
      state,
      result: {
        jobId: 'act:parent123456',
        attemptId: 'att:parent123456:9',
        attemptVerified: false,
        output: null,
        available: false,
        error: 'Cannot verify attempt',
      },
      width: 60,
      height: 14,
    });
    expect(rejected.lines.some((line) => line.includes('Cannot verify attempt'))).toBe(true);
  });

  it('renders warning attention separately from failure', () => {
    const fleet = snapshot();
    const warned = { ...fleet.byId.get('act:parent123456'), attention: 'warning', currentEvent: 'stale_warning' };
    fleet.nodes = fleet.nodes.map((node) => node.jobId === warned.jobId ? warned : node);
    fleet.byId.set(warned.jobId, warned);
    fleet.counts = { ...fleet.counts, active: 1, warning: 1 };
    const view = renderFleetOverlay({
      snapshot: fleet,
      state: createFleetOverlayState({ selectedJobId: warned.jobId }),
      width: 80,
      height: 14,
    });
    expect(view.lines.some((line) => line.includes('1 warning'))).toBe(true);
    expect(view.lines.some((line) => line.includes('⚠ reviewer:parent1234'))).toBe(true);
  });

  it('annotates only already-persisted nodes from the live host and never creates phantom fleet rows', () => {
    const fleet = snapshot();
    const annotated = annotateFleetWithLive(fleet, {
      activations: [
        {
          activation_id: 'act:parent123456',
          attempt_id: 'att:parent123456:2',
          state: 'running',
          requested_model: 'alias/model',
          resolved_model: 'canon/model',
          model_override: true,
          turn_count: 7,
          token_usage: { total_tokens: 9000 },
          last_activity_at: 500,
          purpose: 'review the migration',
        },
        {
          activation_id: 'act:not-materialized',
          attempt_id: 'att:not-materialized:1',
          state: 'running',
        },
      ],
      asks: [{ activation_id: 'act:parent123456' }],
    });

    expect(annotated.nodes).toHaveLength(3);
    expect(annotated.byId.has('act:not-materialized')).toBe(false);
    expect(annotated.byId.get('act:parent123456')).toMatchObject({
      state: 'active',
      attention: 'active',
      presentationAttention: 'blocked',
      live: {
        state: 'running',
        attemptId: 'att:parent123456:2',
        requestedModel: 'alias/model',
        resolvedModel: 'canon/model',
        turnCount: 7,
        purpose: 'review the migration',
      },
    });
    expect(annotated.counts.waiting).toBe(2);
  });

  it('renders only persisted runtime attachment metadata in detail mode', () => {
    const fleet = snapshot();
    const state = createFleetOverlayState({ selectedJobId: 'sp:legacy123456', mode: 'detail' });
    const view = renderFleetOverlay({ snapshot: fleet, state, width: 80, height: 18 });
    expect(view.lines.some((line) => line.includes('xtmux.agent_instance'))).toBe(true);
    expect(view.lines.some((line) => line.includes('%7'))).toBe(true);
  });
});
