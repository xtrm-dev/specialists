import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  bridgedDispatcherEnv,
  dispatcherEnvOverlay,
  dispatcherFromHostEnv,
  resetDispatcherWarning,
  resolveProcessDispatcher,
  DISPATCHER_ENV_KEYS, resolveRequestDispatcher, LOOKUP_FAILURE_COOLDOWN_MS } from '../../../src/activation/dispatcher-identity.js';

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

// Found in review of #584: the env and Substrate halves resolved the participant with opposite
// precedence, so a request carrying both fields made them disagree. One function now returns both.
describe('resolveRequestDispatcher: one value for both sinks (SPECIALISTS-4503)', () => {
  const sinks = (request: Parameters<typeof resolveRequestDispatcher>[0]) => {
    const { dispatcher, requestedByParticipantId } = resolveRequestDispatcher(request);
    return { env: dispatcher.participant, substrate: requestedByParticipantId };
  };

  it('gives env and Substrate the same participant when the request carries both fields', () => {
    const out = sinks({ requestedByParticipantId: 'coordinator', dispatcher: { participant: 'sp-lead-1' } });
    expect(out.env).toBe('sp-lead-1');
    expect(out.substrate).toBe(out.env);
  });

  it('uses the legacy requestedByParticipantId for both when no dispatcher participant exists', () => {
    const out = sinks({ requestedByParticipantId: 'coordinator', dispatcher: { name: 'lead' } });
    expect(out).toEqual({ env: 'coordinator', substrate: 'coordinator' });
  });

  it('uses the dispatcher participant for both when requestedByParticipantId is absent', () => {
    expect(sinks({ dispatcher: { participant: 'sp-lead-1' } })).toEqual({ env: 'sp-lead-1', substrate: 'sp-lead-1' });
  });

  it('records no participant anywhere when none is known, and never invents one', () => {
    const out = resolveRequestDispatcher({});
    expect(out.dispatcher.participant).toBeUndefined();
    expect(out.requestedByParticipantId).toBeUndefined();
  });

  it('takes the coordinator session from the request first, then from the dispatcher', () => {
    expect(resolveRequestDispatcher({ coordinatorSessionId: 's-req', dispatcher: { sessionId: 's-disp' } }).coordinatorSessionId).toBe('s-req');
    expect(resolveRequestDispatcher({ dispatcher: { sessionId: 's-disp' } }).coordinatorSessionId).toBe('s-disp');
    expect(resolveRequestDispatcher({}).coordinatorSessionId).toBeUndefined();
  });
});

// Found by the seconder on #584: a wedged or missing xt cost a 3 s synchronous stall on EVERY
// dispatch while the warning fired once per process, so the repeated stall was invisible.
describe('a failed xt lookup is not repeated for every dispatch (SPECIALISTS-4503)', () => {
  beforeEach(() => { resetDispatcherWarning(); });
  const broken = () => ({ status: 127, stdout: '', stderr: "error: unknown command 'dispatcher'" });
  const good = () => ({ status: 0, stdout: JSON.stringify({ sessionId: 'sess-1', name: 'lead' }) });

  it('spawns xt once after a failure and skips it inside the cool-down', () => {
    const run = vi.fn(broken);
    let clock = 1_000_000;
    const lookup = () => resolveProcessDispatcher({ env: { SUBSTRATE_HOLDER: 'sp-lead-1' }, pid: 7, run, warn: () => undefined, now: () => clock });

    const first = lookup();
    clock += 1_000;
    const second = lookup();

    expect(run).toHaveBeenCalledTimes(1);
    expect(first.participant).toBe('sp-lead-1');
    expect(second.participant).toBe('sp-lead-1');  // the env participant survives the skip
  });

  it('tries again once the cool-down has passed', () => {
    const run = vi.fn(broken);
    let clock = 1_000_000;
    const lookup = () => resolveProcessDispatcher({ env: {}, pid: 7, run, warn: () => undefined, now: () => clock });

    lookup();
    clock += LOOKUP_FAILURE_COOLDOWN_MS + 1;
    lookup();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a success clears the cool-down and is never itself cached', () => {
    const calls: string[] = [];
    let healthy = false;
    const run = vi.fn(() => { calls.push(healthy ? 'ok' : 'bad'); return healthy ? good() : broken(); });
    let clock = 1_000_000;
    const lookup = () => resolveProcessDispatcher({ env: {}, pid: 7, run, warn: () => undefined, now: () => clock });

    lookup();                                  // fails, starts the cool-down
    clock += LOOKUP_FAILURE_COOLDOWN_MS + 1;
    healthy = true;
    expect(lookup().sessionId).toBe('sess-1');  // cool-down over, succeeds
    lookup();                                  // success is not cached: xt is asked again
    expect(calls).toEqual(['bad', 'ok', 'ok']);
  });
});
