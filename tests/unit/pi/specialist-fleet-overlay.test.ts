import { describe, expect, it } from 'vitest';
import {
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
    counts: { total: 3, active: 2, waiting: 1, failed: 0, settled: 0 },
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

  it('renders a null result as unavailable instead of object coercion', () => {
    const fleet = snapshot();
    const view = renderFleetOverlay({
      snapshot: fleet,
      state: createFleetOverlayState({ selectedJobId: 'act:parent123456', mode: 'result' }),
      result: { jobId: 'act:parent123456', output: null, available: false },
      width: 60,
      height: 14,
    });
    expect(view.lines.some((line) => line.includes('result unavailable'))).toBe(true);
    expect(view.lines.some((line) => line.includes('[object Object]'))).toBe(false);
  });

  it('renders only persisted runtime attachment metadata in detail mode', () => {
    const fleet = snapshot();
    const state = createFleetOverlayState({ selectedJobId: 'sp:legacy123456', mode: 'detail' });
    const view = renderFleetOverlay({ snapshot: fleet, state, width: 80, height: 18 });
    expect(view.lines.some((line) => line.includes('xtmux.agent_instance'))).toBe(true);
    expect(view.lines.some((line) => line.includes('%7'))).toBe(true);
  });
});
