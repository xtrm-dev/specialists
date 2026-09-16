// ISSUE: xtrm-wiy5n.4.11 — tmux-gated skip is intentional.
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as childProcess from 'node:child_process';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual };
});
import {
  AGENT_PARENT_PANE_OPTION,
  AGENT_PARENT_SESSION_OPTION,
  buildSessionName,
  createTmuxSession,
  isTmuxAvailable,
  killTmuxSession,
  parentPaneOptions,
} from '../../../src/cli/tmux-utils.js';
import type { RuntimeOriginV1 } from '../../../src/specialist/runtime-origin.js';

const ORIGIN: RuntimeOriginV1 = {
  schema_version: 'xtrm.runtime-origin.v1',
  kind: 'xtmux.agent_instance',
  host_id: 'host-01',
  tmux_session_id: '$7',
  tmux_window_id: '@13',
  tmux_pane_id: '%70',
  captured_at_ms: 1_700_000_000_000,
  capture_source: 'xtmux-context',
  verified: true,
};

describe('tmux-utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buildSessionName returns canonical format', () => {
    expect(buildSessionName('executor', 'a1b2c3')).toBe('sp-executor-a1b2c3');
  });

  it('buildSessionName keeps hyphenated specialist names without double hyphens', () => {
    const sessionName = buildSessionName('code-review', 'a1b2c3');
    expect(sessionName).toBe('sp-code-review-a1b2c3');
    expect(sessionName).not.toContain('--');
  });

  it('isTmuxAvailable returns a boolean', () => {
    expect(typeof isTmuxAvailable()).toBe('boolean');
  });

  it('createTmuxSession throws when tmux exits non-zero', () => {
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({
      pid: 0,
      output: [],
      stdout: '',
      stderr: 'tmux failed',
      status: 1,
      signal: null,
    } as any);

    expect(() =>
      createTmuxSession('sp-executor-a1b2c3', '/tmp', 'echo hello'),
    ).toThrow(/Failed to create tmux session/);
  });

  it.skipIf(!isTmuxAvailable())('killTmuxSession does not throw for a non-existent session', () => {
    expect(() => killTmuxSession(`sp-missing-${Date.now()}`)).not.toThrow();
  });

  // ── Pane lineage (unitAI-vc7tl) ──────────────────────────────────────────
  describe('parentPaneOptions', () => {
    it('maps session id and pane id onto the agent parent options', () => {
      expect(parentPaneOptions(ORIGIN)).toEqual({
        [AGENT_PARENT_SESSION_OPTION]: '$7',
        [AGENT_PARENT_PANE_OPTION]: '%70',
      });
    });

    it('uses the session id ($N), never the session name', () => {
      expect(parentPaneOptions(ORIGIN)[AGENT_PARENT_SESSION_OPTION]).toMatch(/^\$/);
    });

    it('returns {} when there is no dispatcher identity (unset, not guessed)', () => {
      expect(parentPaneOptions(undefined)).toEqual({});
    });
  });

  it('createTmuxSession stamps pane options via set-option -p', () => {
    const spawnSyncSpy = vi.spyOn(childProcess, 'spawnSync').mockReturnValue({
      pid: 0,
      output: [],
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
    } as any);

    createTmuxSession('sp-executor-a1b2c3', '/tmp', 'echo hello', {}, parentPaneOptions(ORIGIN));

    const setOptionCalls = spawnSyncSpy.mock.calls.filter(([, args]) => (args as string[])[0] === 'set-option');
    expect(setOptionCalls).toHaveLength(2);
    expect(setOptionCalls[0]?.[1]).toEqual(['set-option', '-t', 'sp-executor-a1b2c3', '-p', '@agent_parent_session', '$7']);
    expect(setOptionCalls[1]?.[1]).toEqual(['set-option', '-t', 'sp-executor-a1b2c3', '-p', '@agent_parent_pane', '%70']);
  });

  it('createTmuxSession skips set-option when there are no pane options', () => {
    const spawnSyncSpy = vi.spyOn(childProcess, 'spawnSync').mockReturnValue({
      pid: 0,
      output: [],
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
    } as any);

    createTmuxSession('sp-executor-a1b2c3', '/tmp', 'echo hello');

    const setOptionCalls = spawnSyncSpy.mock.calls.filter(([, args]) => (args as string[])[0] === 'set-option');
    expect(setOptionCalls).toHaveLength(0);
  });

  it('createTmuxSession does not throw when stamping fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(childProcess, 'spawnSync').mockImplementation(((cmd: string, args: string[]) => {
      if (args[0] === 'set-option') {
        return { pid: 0, output: [], stdout: '', stderr: 'no such session', status: 1, signal: null };
      }
      return { pid: 0, output: [], stdout: '', stderr: '', status: 0, signal: null };
    }) as any);

    expect(() =>
      createTmuxSession('sp-executor-a1b2c3', '/tmp', 'echo hello', {}, parentPaneOptions(ORIGIN)),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('@agent_parent_session'));
  });

  it.skipIf(!isTmuxAvailable())('live pane carries the stamped parent edge (read-back)', () => {
    const session = `sp-lineage-${Date.now().toString(36)}`;
    try {
      createTmuxSession(session, '/tmp', 'sleep 30', {}, parentPaneOptions(ORIGIN));
      const read = (key: string): string => {
        const result = childProcess.spawnSync('tmux', ['show-options', '-p', '-qv', '-t', session, key], {
          encoding: 'utf8',
          stdio: 'pipe',
        });
        return (result.stdout ?? '').trim();
      };
      expect(read('@agent_parent_session')).toBe('$7');
      expect(read('@agent_parent_pane')).toBe('%70');
    } finally {
      killTmuxSession(session);
    }
  });

});
