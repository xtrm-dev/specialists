import { describe, expect, it } from 'vitest';
import {
  EPIC_STATES,
  canTransitionEpicState,
  evaluateEpicMergeReadiness,
  isEpicTerminalState,
  isEpicUnresolvedState,
  resolveChainId,
  transitionEpicState,
} from '../../../src/specialist/epic-lifecycle.js';

describe('epic-lifecycle', () => {
  it('supports canonical positive transition paths', () => {
    const mergedPath = ['open', 'resolving', 'merge_ready', 'merged'] as const;
    const failedPath = ['open', 'resolving', 'failed'] as const;
    const abandonedPath = ['open', 'abandoned'] as const;

    for (const path of [mergedPath, failedPath, abandonedPath]) {
      let current = path[0];
      for (const next of path.slice(1)) {
        current = transitionEpicState(current, next);
      }
      expect(current).toBe(path[path.length - 1]);
    }
  });

  it('rejects deterministic invalid transitions', () => {
    expect(canTransitionEpicState('open', 'merged')).toBe(false);
    expect(canTransitionEpicState('failed', 'resolving')).toBe(false);
    expect(canTransitionEpicState('abandoned', 'merge_ready')).toBe(false);

    expect(() => transitionEpicState('open', 'merged')).toThrow('Invalid epic transition: open -> merged');
    expect(() => transitionEpicState('failed', 'open')).toThrow('Invalid epic transition: failed -> open');
  });

  it('keeps terminal states terminal and unresolved states non-terminal', () => {
    for (const state of EPIC_STATES) {
      const terminal = isEpicTerminalState(state);
      expect(isEpicUnresolvedState(state)).toBe(!terminal);

      if (!terminal) continue;
      for (const next of EPIC_STATES) {
        if (state === 'failed' && next === 'abandoned') {
          expect(canTransitionEpicState(state, next)).toBe(true);
          continue;
        }
        expect(canTransitionEpicState(state, next)).toBe(false);
      }
    }
  });

  it('allows failed -> abandoned recovery transition only', () => {
    expect(canTransitionEpicState('failed', 'abandoned')).toBe(true);
    expect(canTransitionEpicState('failed', 'merged')).toBe(false);
    expect(canTransitionEpicState('failed', 'merge_ready')).toBe(false);
    expect(canTransitionEpicState('failed', 'resolving')).toBe(false);
    expect(canTransitionEpicState('failed', 'open')).toBe(false);
  });

  it('resolves one canonical chain identifier with deterministic priority', () => {
    expect(resolveChainId({ id: 'job-1', chain_id: 'chain-1' })).toBe('chain-1');
    expect(resolveChainId({ id: 'job-2', worktree_owner_job_id: 'owner-2' })).toBe('owner-2');
    expect(resolveChainId({ id: 'job-3', worktree_path: '/tmp/wt' })).toBe('job-3');
    expect(resolveChainId({ id: 'job-4' })).toBeUndefined();
  });

  it('derives merge readiness from live chain terminality, not persisted state ceremony', () => {
    const ready = evaluateEpicMergeReadiness({
      epicId: 'unitAI-epic',
      epicStatus: 'failed',
      chainStatuses: [
        { chainId: 'chain-a', hasRunningJob: false },
        { chainId: 'chain-b', hasRunningJob: false },
      ],
    });

    const blocked = evaluateEpicMergeReadiness({
      epicId: 'unitAI-epic',
      epicStatus: 'open',
      chainStatuses: [
        { chainId: 'chain-a', hasRunningJob: true },
      ],
    });

    expect(ready.isReady).toBe(true);
    expect(ready.summary).toContain('live-ready');
    expect(blocked.isReady).toBe(false);
    expect(blocked.blockingChains).toEqual(['chain-a']);
    expect(blocked.summary).toContain('blocked by active chains');
  });
});
