import { delimiter } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  bashSpawnHookWith,
  composeActivationPath,
  hasActivationEnv,
} from '../../../src/activation/activation-bash-env.js';

const SHIM = '/home/agent/.local/bin';

describe('activation shell env (SPECIALISTS-4456)', () => {
  it('overlays the activation identity on the env pi resolved for the spawn', () => {
    const hook = bashSpawnHookWith({ XTRM_ROLE: 'reviewer', SUBSTRATE_HOLDER: 'sp-pr-reviewer-abc' });
    const applied = hook({ command: 'gh pr view 1', cwd: '/w', env: { PATH: '/usr/bin', HOME: '/h' } });

    expect(applied.env).toEqual({
      PATH: '/usr/bin',
      HOME: '/h',
      XTRM_ROLE: 'reviewer',
      SUBSTRATE_HOLDER: 'sp-pr-reviewer-abc',
    });
    expect(applied.command).toBe('gh pr view 1');
    expect(applied.cwd).toBe('/w');
  });

  it('wins per key, so the activation does not inherit the dispatcher role', () => {
    const hook = bashSpawnHookWith({ XTRM_ROLE: 'reviewer' });
    const applied = hook({ command: 'true', cwd: '/w', env: { XTRM_ROLE: 'worker' } });

    expect(applied.env.XTRM_ROLE).toBe('reviewer');
  });

  it('composes PATH from the inherited value instead of replacing it', () => {
    // pi prepends its own managed bin directory (fd, rg) to the PATH it resolves; an overlay
    // that replaced PATH would take that directory away from every activation with an identity
    // (review finding 2, reproduced against the real pi bash tool).
    const hook = bashSpawnHookWith({ XTRM_ROLE: 'reviewer' }, { shimDir: SHIM });
    const applied = hook({
      command: 'true',
      cwd: '/w',
      env: { PATH: ['/pi/agent/bin', '/usr/bin', '/bin'].join(delimiter) },
    });

    const entries = String(applied.env.PATH).split(delimiter);
    expect(entries[0]).toBe(SHIM);
    expect(entries).toContain('/pi/agent/bin');
    expect(entries).toContain('/usr/bin');
  });

  it('ignores a PATH inside the overlay rather than letting it clobber the composed one', () => {
    const hook = bashSpawnHookWith({ PATH: '/precomputed:/usr/bin' }, { shimDir: SHIM });
    const applied = hook({ command: 'true', cwd: '/w', env: { PATH: '/usr/bin' } });

    expect(applied.env.PATH).toBe([SHIM, '/usr/bin'].join(delimiter));
  });

  it('keeps an empty value, because an empty GIT_CONFIG_VALUE_* is a deliberate reset', () => {
    const hook = bashSpawnHookWith({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '' });
    const applied = hook({ command: 'git status', cwd: '/w', env: {} });

    expect(applied.env.GIT_CONFIG_VALUE_0).toBe('');
    expect(applied.env.GIT_CONFIG_COUNT).toBe('1');
  });

  it('does not mutate the context it was given', () => {
    const inherited = { XTRM_ROLE: 'worker', PATH: '/usr/bin' };
    bashSpawnHookWith({ XTRM_ROLE: 'reviewer' }, { shimDir: SHIM })({ command: 'true', cwd: '/w', env: inherited });

    expect(inherited).toEqual({ XTRM_ROLE: 'worker', PATH: '/usr/bin' });
  });
});

describe('composeActivationPath', () => {
  it('puts the shim first and keeps every inherited entry in order', () => {
    expect(composeActivationPath('/shim', '/a:/b', ':')).toBe('/shim:/a:/b');
  });

  it('does not duplicate a shim the inherited PATH already contains', () => {
    expect(composeActivationPath('/shim', '/shim:/a:/b', ':')).toBe('/shim:/a:/b');
    expect(composeActivationPath('/shim', '/a:/shim:/b', ':')).toBe('/shim:/a:/b');
  });

  it('handles an absent or empty inherited PATH', () => {
    expect(composeActivationPath('/shim', undefined, ':')).toBe('/shim');
    expect(composeActivationPath('/shim', '', ':')).toBe('/shim');
  });

  it('uses the platform separator it is given', () => {
    expect(composeActivationPath('C:\\shim', 'C:\\a;C:\\b', ';')).toBe('C:\\shim;C:\\a;C:\\b');
  });
});

describe('hasActivationEnv', () => {
  it('is false only when there is neither identity nor shim to apply', () => {
    expect(hasActivationEnv({})).toBe(false);
    expect(hasActivationEnv({}, undefined)).toBe(false);
    expect(hasActivationEnv({ SUBSTRATE_HOLDER: 'sp-x' })).toBe(true);
    // The shim alone still matters: without it `gh` is the real binary.
    expect(hasActivationEnv({}, '/home/agent/.local/bin')).toBe(true);
  });
});

describe('the READ_ONLY sandbox drops the activation identity (documented limit)', () => {
  /**
   * The permission guard wraps a bash call in `bwrap --clearenv … -- bash -c`, and builds its
   * `--setenv` passthrough from `process.env` with an allowlist that never included the
   * identity keys. So inside a READ_ONLY sandbox the activation's identity is absent — before
   * SPECIALISTS-4456 it was absent too, because the same allowlist dropped it; what changed
   * is PATH: the shim-first PATH used to arrive through `process.env.PATH` and now lives only
   * in the spawn env of the outer bwrap process.
   *
   * This test exists to make that limit explicit rather than implied: if a future change makes
   * the guard honour a per-session env, this test is the one that should start failing.
   */
  it('does not pass the identity keys into the sandbox, and passes the host PATH', async () => {
    const guard = await import('../../../config/pi-extensions/permission-guard/index.mjs');
    const hostEnv = {
      PATH: ['/host/bin', '/usr/bin'].join(delimiter),
      HOME: '/home/agent',
      XTRM_ROLE: 'reviewer',
      SUBSTRATE_HOLDER: 'sp-pr-reviewer-abc',
      GIT_AUTHOR_NAME: 'xtrm-reviewer',
    };

    const args = guard.buildClearenvArgs(hostEnv) as string[];
    const passed = args.filter((entry, index) => args[index - 1] === '--setenv');

    expect(passed).toContain('PATH');
    expect(passed).toContain('HOME');
    expect(passed).not.toContain('XTRM_ROLE');
    expect(passed).not.toContain('SUBSTRATE_HOLDER');
    expect(passed).not.toContain('GIT_AUTHOR_NAME');

    // And the wrapped command carries no spawn hook: the sandbox is built from the host env.
    const wrapped = guard.buildWrappedCommand({
      command: 'gh pr view 1',
      cwd: '/w',
      maskArgs: [],
      env: hostEnv,
    }) as string;
    expect(wrapped).toContain('gh pr view 1');
    expect(wrapped).toContain('--clearenv');
  });
});
