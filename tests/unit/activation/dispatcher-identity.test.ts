import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  bridgedDispatcherEnv,
  defaultDispatcherRun,
  dispatcherBindingFields,
  isDispatcherLabel,
  isDispatcherSessionId,
  dispatcherEnvOverlay,
  dispatcherFromHostEnv,
  normalizeDispatcherIdentity,
  resetDispatcherWarning,
  resolveProcessDispatcher,
  sanitizeDispatcherValue,
  DISPATCHER_VALUE_MAX_LENGTH,
  DISPATCHER_ENV_KEYS, resolveRequestDispatcher, LOOKUP_FAILURE_COOLDOWN_MS } from '../../../src/activation/dispatcher-identity.js';
import { createSpecialistDispatchTool } from '../../../src/tools/specialist/activation.tool.js';

const ENV = { SUBSTRATE_HOLDER: 'sp-lead-1', XTRM_AGENT_NAME: 'serving-lead' };

describe('resolveProcessDispatcher — the Claude Code MCP path', () => {
  beforeEach(() => { resetDispatcherWarning(); });

  it('takes the participant from the process holder and the rest from core, once, bounded', async () => {
    const run = vi.fn().mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        name: 'core-99',
        address: 'uds:/run/user/1000/cc-socks/3880939.sock',
        sessionId: '0f7e7a52',
        source: 'ancestor',
      }),
    });

    const identity = await resolveProcessDispatcher({ env: ENV, pid: 4242, run, timeoutMs: 1234 });

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

  it('fails open with one warning when the installed xt predates the command', async () => {
    const run = vi.fn().mockReturnValue({
      status: 1,
      stdout: '',
      stderr: "error: unknown command 'dispatcher'",
    });
    const warn = vi.fn();

    const first = await resolveProcessDispatcher({ env: ENV, pid: 1, run, warn });
    const second = await resolveProcessDispatcher({ env: ENV, pid: 1, run, warn });

    // The dispatch still has the one value it can prove — never an adapter literal.
    expect(first).toEqual({ participant: 'sp-lead-1', name: 'serving-lead' });
    expect(second).toEqual(first);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toMatch(/predates|unknown command/i);
  });

  it('fails open on unparseable output and on a spawn error, without inventing a name', async () => {
    const badJson = await resolveProcessDispatcher({
      env: { SUBSTRATE_HOLDER: 'sp-lead-1' },
      pid: 1,
      run: () => ({ status: 0, stdout: 'not json' }),
      warn: () => {},
    });
    expect(badJson).toEqual({ participant: 'sp-lead-1' });

    resetDispatcherWarning();
    const spawnError = await resolveProcessDispatcher({
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

  it('spawns xt once after a failure and skips it inside the cool-down', async () => {
    const run = vi.fn(broken);
    let clock = 1_000_000;
    const lookup = () => resolveProcessDispatcher({ env: { SUBSTRATE_HOLDER: 'sp-lead-1' }, pid: 7, run, warn: () => undefined, now: () => clock });

    const first = await lookup();
    clock += 1_000;
    const second = await lookup();

    expect(run).toHaveBeenCalledTimes(1);
    expect(first.participant).toBe('sp-lead-1');
    expect(second.participant).toBe('sp-lead-1');  // the env participant survives the skip
  });

  it('tries again once the cool-down has passed', async () => {
    const run = vi.fn(broken);
    let clock = 1_000_000;
    const lookup = () => resolveProcessDispatcher({ env: {}, pid: 7, run, warn: () => undefined, now: () => clock });

    await lookup();
    clock += LOOKUP_FAILURE_COOLDOWN_MS + 1;
    await lookup();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a success clears the cool-down and is never itself cached', async () => {
    const calls: string[] = [];
    let healthy = false;
    const run = vi.fn(() => { calls.push(healthy ? 'ok' : 'bad'); return healthy ? good() : broken(); });
    let clock = 1_000_000;
    const lookup = () => resolveProcessDispatcher({ env: {}, pid: 7, run, warn: () => undefined, now: () => clock });

    await lookup();                              // fails, starts the cool-down
    clock += LOOKUP_FAILURE_COOLDOWN_MS + 1;
    healthy = true;
    expect((await lookup()).sessionId).toBe('sess-1');  // cool-down over, succeeds
    await lookup();                              // success is not cached: xt is asked again
    expect(calls).toEqual(['bad', 'ok', 'ok']);
  });
});

describe('dispatcher binding validators (SPECIALISTS-4506)', () => {
  const UUID = '3f7c1a1e-9b2d-4c5e-8f60-1a2b3c4d5e6f';

  beforeEach(() => { resetDispatcherWarning(); });

  it('accepts the labels Substrate accepts and nothing else', () => {
    for (const label of ['sp-lead-1', 'specialist::researcher', 'node::emitter::a.b_c+d@e/f', 'A'.repeat(128)]) {
      expect(isDispatcherLabel(label)).toBe(true);
    }
    // sb trims before it validates, so surrounding whitespace is not a rejection.
    for (const label of ['', '   ', '-lead', 'lead 1', 'lead;rm -rf /', 'A'.repeat(129), null, 7, undefined]) {
      expect(isDispatcherLabel(label)).toBe(false);
    }
  });

  // Substrate's SESSION_ID_PATTERN: a canonical UUID (sb lowercases it first, so either case) or a
  // tmux session id. This host accepts exactly that, so a value sb would record is never dropped here.
  it('accepts what Substrate accepts as a session id: a UUID in either case, or a tmux id', () => {
    expect(isDispatcherSessionId(UUID)).toBe(true);
    expect(isDispatcherSessionId(` ${UUID} `)).toBe(true);
    expect(isDispatcherSessionId(UUID.toUpperCase())).toBe(true);
    expect(isDispatcherSessionId('$3')).toBe(true);
    for (const session of ['$', '$x', '3', '0f7e7a52', 'not-a-uuid', `${UUID}x`, '', null, 7]) {
      expect(isDispatcherSessionId(session)).toBe(false);
    }
  });

  it('keeps the values Substrate accepts, trimmed', () => {
    expect(dispatcherBindingFields({ participant: ' sp-lead-1 ', sessionId: UUID }, () => undefined))
      .toEqual({ dispatcherParticipantId: 'sp-lead-1', dispatcherSessionId: UUID });
  });

  it('records nothing when the dispatcher is unknown — absent, never a placeholder', () => {
    expect(dispatcherBindingFields(undefined, () => undefined)).toEqual({});
    expect(dispatcherBindingFields({}, () => undefined)).toEqual({});
    expect(dispatcherBindingFields({ participant: '   ' }, () => undefined)).toEqual({});
  });

  it('drops an invalid half with one warning and keeps the valid one', () => {
    const warnings: string[] = [];
    const invalidParticipant = () => dispatcherBindingFields(
      { participant: 'lead 1', sessionId: UUID },
      (message) => warnings.push(message),
    );
    expect(invalidParticipant()).toEqual({ dispatcherSessionId: UUID });
    invalidParticipant(); // the same reason does not warn twice
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('not a Substrate-safe label');

    const sessionWarnings: string[] = [];
    expect(dispatcherBindingFields(
      { participant: 'sp-lead-1', sessionId: 'not-a-uuid' },
      (message) => sessionWarnings.push(message),
    )).toEqual({ dispatcherParticipantId: 'sp-lead-1' });
    expect(sessionWarnings).toHaveLength(1);
    expect(sessionWarnings[0]).toContain('not a UUID or a tmux session id');
  });
});

// Audit of #584 (F1): `requested_by` reached XTRM_DISPATCHER_PARTICIPANT and a durable evidence
// line unbounded and unescaped, so ~200 KB made every shell of that activation fail with E2BIG
// and a newline forged extra lines in the note. Every value is now bounded and single-line at the
// boundary AND at the host seam.
describe('every dispatcher value is bounded and single-line (SPECIALISTS-4510)', () => {
  const OVERSIZED = 'a'.repeat(200_000);

  beforeEach(() => { resetDispatcherWarning(); });

  it('drops an over-long participant instead of writing it into the activation env', () => {
    const warnings: string[] = [];
    const identity = normalizeDispatcherIdentity({ participant: OVERSIZED }, (message) => warnings.push(message));

    expect(identity).toEqual({});
    expect(warnings).toHaveLength(1);
    // The value an activation's shells inherit: one that does not fit is what made EVERY shell
    // of that dispatch fail with E2BIG, so the shell here must start with the bounded env.
    const shell = spawnSync('/bin/sh', ['-c', 'exit 0'], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...dispatcherEnvOverlay(identity, () => undefined).env },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(shell.status).toBe(0);
  });

  it('strips control characters so no value can forge a second evidence line', () => {
    expect(sanitizeDispatcherValue('sp-lead-1\nsp-forged')).toBe('sp-lead-1sp-forged');
    expect(sanitizeDispatcherValue('sp-lead-1\u0000\r\t')).toBe('sp-lead-1');
    expect(sanitizeDispatcherValue('a'.repeat(DISPATCHER_VALUE_MAX_LENGTH))).toHaveLength(DISPATCHER_VALUE_MAX_LENGTH);
    expect(sanitizeDispatcherValue('a'.repeat(DISPATCHER_VALUE_MAX_LENGTH + 1))).toBeUndefined();
    expect(sanitizeDispatcherValue('\n\u0000')).toBeUndefined();
  });

  it('holds the participant to the label grammar sb records and keeps the rest', () => {
    const warnings: string[] = [];
    const identity = normalizeDispatcherIdentity(
      { participant: 'lead 1', name: 'lead', sessionId: 'pi-sess-1' },
      (message) => warnings.push(message),
    );

    expect(identity).toEqual({ name: 'lead', sessionId: 'pi-sess-1' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('not a Substrate-safe label');
  });

  it('warns once for every unusable shape, including an over-long one', () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);

    normalizeDispatcherIdentity({ participant: OVERSIZED }, warn);
    normalizeDispatcherIdentity({ participant: '\n\u0000' }, warn);
    normalizeDispatcherIdentity({ participant: 'lead 1' }, warn);

    expect(warnings).toHaveLength(1);
  });

  it('drops the same value at the host seam, so a direct caller cannot widen it', () => {
    const { dispatcher, requestedByParticipantId, coordinatorSessionId } = resolveRequestDispatcher({
      requestedByParticipantId: `${'a'.repeat(200_000)}\nsp-forged=1`,
      coordinatorSessionId: 'pi-sess-1\nsp-forged=1',
    });

    expect(dispatcher.participant).toBeUndefined();
    expect(requestedByParticipantId).toBeUndefined();
    expect(coordinatorSessionId).toBe('pi-sess-1sp-forged=1');
  });
});

// Audit of #584 (F2): the lookup used spawnSync on the MCP event loop that also hosts the
// running activations, and the bound was unproven against an xt that ignores SIGTERM.
describe('the lookup never blocks the event loop and never outlives its bound (SPECIALISTS-4510)', () => {
  beforeEach(() => { resetDispatcherWarning(); });

  it('passes its bound as the spawn timeout argument', async () => {
    const run = vi.fn().mockResolvedValue({ status: 0, stdout: '{}' });

    await resolveProcessDispatcher({ env: {}, pid: 1, run, timeoutMs: 777, warn: () => undefined });

    expect(run).toHaveBeenCalledWith('xt', expect.any(Array), expect.objectContaining({ timeoutMs: 777 }));
  });

  it('services the event loop while the child is still running', async () => {
    const ticks: number[] = [];
    const ticker = setInterval(() => ticks.push(Date.now()), 10);
    try {
      const result = await defaultDispatcherRun(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 30_000)'],
        { timeoutMs: 300 },
      );
      expect(result.status).toBeNull();
    } finally {
      clearInterval(ticker);
    }

    expect(ticks.length).toBeGreaterThan(2);
  });

  it('ends a child that ignores SIGTERM at the bound instead of stalling on it', async () => {
    const started = Date.now();
    const result = await defaultDispatcherRun(
      process.execPath,
      ['-e', 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 30_000)'],
      { timeoutMs: 400 },
    );

    expect(result.error).toBeInstanceOf(Error);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('a dispatch answers while a stub xt sleeps 30 s (SPECIALISTS-4510)', () => {
  it('dispatches, keeps the loop serviced, and fails open on the slow lookup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xt-slow-'));
    writeFileSync(join(dir, 'xt'), `#!${process.execPath}\nprocess.on('SIGTERM', () => {});\nsetTimeout(() => {}, 30_000);\n`);
    chmodSync(join(dir, 'xt'), 0o755);
    const host = {
      start: vi.fn(async () => ({
        activationId: 'act:slow',
        result: new Promise(() => {}),
        stepContract: { rootWorkRef: 'ISSUE-1', inputs: [], outputs: [] },
      })),
      inspect: () => undefined,
    };
    const tool = createSpecialistDispatchTool(() => host as never, undefined, {
      env: { ...process.env, SUBSTRATE_HOLDER: 'sp-lead-1', PATH: `${dir}${delimiter}${process.env.PATH ?? ''}` },
      pid: 1,
      timeoutMs: 300,
      warn: () => undefined,
    });

    const ticks: number[] = [];
    const ticker = setInterval(() => ticks.push(Date.now()), 10);
    const started = Date.now();
    let out: Record<string, unknown>;
    try {
      out = await tool.execute({ specialist: 'researcher', bead_id: 'ISSUE-1' }) as Record<string, unknown>;
    } finally {
      clearInterval(ticker);
      rmSync(dir, { recursive: true, force: true });
    }

    expect(out.status).toBe('dispatched');
    expect(ticks.length).toBeGreaterThan(2);  // an in-flight activation keeps being serviced
    // The tool's own bound reached the spawn: the default 3 s would blow this window.
    expect(Date.now() - started).toBeLessThan(2_000);
    // Fail-open: the slow lookup costs the label, never the dispatch.
    expect(host.start).toHaveBeenCalledWith(expect.objectContaining({ requestedByParticipantId: 'sp-lead-1' }));
  });
});
