import { describe, expect, it } from 'vitest';

import { bashSpawnHookWith, hasActivationEnv } from '../../../src/activation/activation-bash-env.js';

describe('activation bash env (SPECIALISTS-4456)', () => {
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

  it('wins per key, so the activation does not inherit the dispatcher role or PATH', () => {
    const hook = bashSpawnHookWith({ XTRM_ROLE: 'reviewer', PATH: '/shim:/usr/bin' });
    const applied = hook({ command: 'true', cwd: '/w', env: { XTRM_ROLE: 'worker', PATH: '/usr/bin' } });

    expect(applied.env.XTRM_ROLE).toBe('reviewer');
    expect(applied.env.PATH).toBe('/shim:/usr/bin');
  });

  it('keeps an empty value, because an empty GIT_CONFIG_VALUE_* is a deliberate reset', () => {
    // Dropping it would leave GIT_CONFIG_COUNT naming an index whose pair is absent, and
    // git refuses every command in that state (identity-env.ts says the same thing).
    const hook = bashSpawnHookWith({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '' });
    const applied = hook({ command: 'git status', cwd: '/w', env: {} });

    expect(applied.env.GIT_CONFIG_VALUE_0).toBe('');
    expect(applied.env.GIT_CONFIG_COUNT).toBe('1');
  });

  it('does not mutate the context it was given', () => {
    const inherited = { XTRM_ROLE: 'worker' };
    const hook = bashSpawnHookWith({ XTRM_ROLE: 'reviewer' });
    hook({ command: 'true', cwd: '/w', env: inherited });

    expect(inherited).toEqual({ XTRM_ROLE: 'worker' });
  });

  it('reports an empty overlay so the host can skip a pointless hook', () => {
    expect(hasActivationEnv({})).toBe(false);
    expect(hasActivationEnv({ SUBSTRATE_HOLDER: 'sp-x' })).toBe(true);
  });
});
