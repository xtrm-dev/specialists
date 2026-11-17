import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  bridgedDispatcherEnv,
  dispatcherEnvOverlay,
  dispatcherFromHostEnv,
  resetDispatcherWarning,
  resolveProcessDispatcher,
  DISPATCHER_ENV_KEYS,
} from '../../../src/activation/dispatcher-identity.js';

const ENV = { SUBSTRATE_HOLDER: 'sp-lead-1', XTRM_AGENT_NAME: 'serving-lead' };

describe('resolveProcessDispatcher — the Claude Code MCP path', () => {
  beforeEach(() => { resetDispatcherWarning(); });

  it('takes the participant from the process holder and the rest from core, once, bounded', () => {
    const run = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        name: 'core-99',
        address: 'uds:/run/user/1000/cc-socks/3880939.sock',
        sessionId: '0f7e7a52',
        source: 'ancestor',
      }),
    });

    const identity = resolveProcessDispatcher({ env: ENV, pid: 4242, run, timeoutMs: 1234 });

    expect(identity).toEqual({
      participant: 'sp-lead-1',
      name: 'core-99',
      address: 'uds:/run/user/1000/cc-socks/3880939.sock',
      sessionId: '0f7e7a52',
    });
    // One invocation per dispatch, with the caller's pid, no inherited fallback, JSON.
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      'xt',
      ['identity', 'dispatcher', '--pid', '4242', '--no-inherit', '--json'],
      expect.objectContaining({ timeoutMs: 1234 }),
    );
  });

  it('fails open with one warning when the installed xt predates the command', () => {
    const run = vi.fn().mockReturnValue({
      status: 1,
      stdout: '',
      stderr: "error: unknown command 'dispatcher'",
    });
    const warn = vi.fn();

    const first = resolveProcessDispatcher({ env: ENV, pid: 1, run, warn });
    const second = resolveProcessDispatcher({ env: ENV, pid: 1, run, warn });

    // The dispatch still has the one value it can prove — never an adapter literal.
    expect(first).toEqual({ participant: 'sp-lead-1', name: 'serving-lead' });
    expect(second).toEqual(first);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toMatch(/predates|unknown command/i);
  });

  it('fails open on unparseable output and on a spawn error, without inventing a name', () => {
    const badJson = resolveProcessDispatcher({
      env: { SUBSTRATE_HOLDER: 'sp-lead-1' },
      pid: 1,
      run: () => ({ status: 0, stdout: 'not json' }),
      warn: () => {},
    });
    expect(badJson).toEqual({ participant: 'sp-lead-1' });

    resetDispatcherWarning();
    const spawnError = resolveProcessDispatcher({
      env: { SUBSTRATE_HOLDER: 'sp-lead-1' },
      pid: 1,
      run: () => ({ status: null, stdout: '', error: new Error('ENOENT') }),
      warn: () => {},
    });
    expect(spawnError).toEqual({ participant: 'sp-lead-1' });
  });
});

describe('dispatcherFromHostEnv — the Pi path', () => {
  it('reads the lead process’s own holder and name, plus the live session id', () => {
    expect(dispatcherFromHostEnv(ENV, 'pi-sess-1')).toEqual({
      participant: 'sp-lead-1',
      name: 'serving-lead',
      sessionId: 'pi-sess-1',
    });
  });

  it('fabricates nothing when the host carries no identity', () => {
    expect(dispatcherFromHostEnv({}, null)).toEqual({});
    expect(dispatcherFromHostEnv({ SUBSTRATE_HOLDER: '   ' })).toEqual({});
  });
});

describe('dispatcherEnvOverlay', () => {
  it('writes one hop and marks every unknown key for deletion', () => {
    expect(dispatcherEnvOverlay({ participant: 'sp-lead-1', name: 'lead', address: 'activation:act:1' }))
      .toEqual({
        env: {
          XTRM_DISPATCHER_PARTICIPANT: 'sp-lead-1',
          XTRM_DISPATCHER_NAME: 'lead',
          XTRM_DISPATCHER_ADDRESS: 'activation:act:1',
        },
        unset: [],
      });
  });

  it('unsets inherited keys when the dispatcher is unknown', () => {
    const overlay = dispatcherEnvOverlay(undefined);
    expect(overlay.env).toEqual({});
    expect(overlay.unset).toEqual([...DISPATCHER_ENV_KEYS]);
  });

  it('represents the unknown half of a partial identity on the bridge as a delete', () => {
    const overlay = dispatcherEnvOverlay({ participant: 'sp-lead-1' });
    expect(bridgedDispatcherEnv(overlay)).toEqual({
      XTRM_DISPATCHER_PARTICIPANT: 'sp-lead-1',
      XTRM_DISPATCHER_NAME: '',
      XTRM_DISPATCHER_ADDRESS: '',
    });
  });
});
