import { describe, expect, it } from 'vitest';
import {
  IDENTITY_ENV_ALLOWLIST,
  resolveAgentIdentityEnv,
  specialistHolderName,
} from '../../../src/pi/identity-env.js';

describe('resolveAgentIdentityEnv', () => {
  it('fabricates nothing without a holder', () => {
    expect(resolveAgentIdentityEnv({})).toEqual({});
    expect(resolveAgentIdentityEnv({ holder: '   ', roleName: 'pr-reviewer' })).toEqual({});
  });

  it('carries the holder and the specialist name when xt is unavailable', () => {
    const env = resolveAgentIdentityEnv({
      holder: 'sp-pr-reviewer-1a2b3c4d',
      roleName: 'pr-reviewer',
      env: {},
      run: () => ({ status: 127, stdout: 'xt: not found' }),
    });
    expect(env).toEqual({ SUBSTRATE_HOLDER: 'sp-pr-reviewer-1a2b3c4d', XTRM_ROLE: 'pr-reviewer' });
  });

  it('survives a throwing runner and junk output', () => {
    const base = { SUBSTRATE_HOLDER: 'h', XTRM_ROLE: 'r' };
    expect(resolveAgentIdentityEnv({ holder: 'h', roleName: 'r', run: () => { throw new Error('EAGAIN'); } })).toEqual(base);
    expect(resolveAgentIdentityEnv({ holder: 'h', roleName: 'r', run: () => ({ status: 0, stdout: 'not json' }) })).toEqual(base);
    expect(resolveAgentIdentityEnv({ holder: 'h', roleName: 'r', run: () => ({ status: 0, stdout: '{"env":"x"}' }) })).toEqual(base);
  });

  it('asks xt identity env with the holder in the lookup env and merges its answer', () => {
    let seen: { cmd: string; args: string[]; env?: NodeJS.ProcessEnv; cwd?: string } | null = null;
    const env = resolveAgentIdentityEnv({
      holder: 'sp-pr-reviewer-1a2b3c4d',
      roleName: 'pr-reviewer',
      cwd: '/repo/.xtrm/worktrees/x',
      env: { PATH: '/usr/bin' },
      run: (cmd, args, opts) => {
        seen = { cmd, args, env: opts.env, cwd: opts.cwd };
        return {
          status: 0,
          stdout: JSON.stringify({
            holder: 'sp-pr-reviewer-1a2b3c4d',
            role: 'reviewer',
            env: {
              SUBSTRATE_HOLDER: 'sp-pr-reviewer-1a2b3c4d',
              XTRM_ROLE: 'reviewer',
              GIT_AUTHOR_NAME: 'sp-pr-reviewer-1a2b3c4d',
              GIT_AUTHOR_EMAIL: 'op@example.com',
              GIT_COMMITTER_NAME: 'sp-pr-reviewer-1a2b3c4d',
              GIT_COMMITTER_EMAIL: 'op@example.com',
              GIT_CONFIG_COUNT: '3',
              GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
              GIT_CONFIG_VALUE_0: 'git@github.com:',
              PATH: '/usr/bin',
              GITHUB_TOKEN: 'ghs_must_not_ride',
              EMPTY: '',
            },
          }),
        };
      },
    });

    expect(seen!.cmd).toBe('xt');
    expect(seen!.args).toEqual(['identity', 'env', '--json']);
    expect(seen!.env).toMatchObject({ PATH: '/usr/bin', SUBSTRATE_HOLDER: 'sp-pr-reviewer-1a2b3c4d', XTRM_ROLE: 'pr-reviewer' });
    expect(seen!.cwd).toBe('/repo/.xtrm/worktrees/x');
    expect(env).toEqual({
      SUBSTRATE_HOLDER: 'sp-pr-reviewer-1a2b3c4d',
      XTRM_ROLE: 'reviewer',
      GIT_AUTHOR_NAME: 'sp-pr-reviewer-1a2b3c4d',
      GIT_AUTHOR_EMAIL: 'op@example.com',
      GIT_COMMITTER_NAME: 'sp-pr-reviewer-1a2b3c4d',
      GIT_COMMITTER_EMAIL: 'op@example.com',
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
      GIT_CONFIG_VALUE_0: 'git@github.com:',
    });
    // Allowlist holds: no token, no unrelated process env, no empty value.
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.PATH).toBeUndefined();
    expect(env.EMPTY).toBeUndefined();
    expect(IDENTITY_ENV_ALLOWLIST).toContain('XTRM_ROLE');
  });

  it('keeps the holder it was asked to carry over the CLI echo', () => {
    const env = resolveAgentIdentityEnv({
      holder: 'mine',
      roleName: 'pr-reviewer',
      run: () => ({ status: 0, stdout: JSON.stringify({ env: { SUBSTRATE_HOLDER: 'someone-else', XTRM_ROLE: 'reviewer' } }) }),
    });
    expect(env.SUBSTRATE_HOLDER).toBe('mine');
    expect(env.XTRM_ROLE).toBe('reviewer');
  });
});

describe('specialistHolderName', () => {
  it('is stable per job and unique per run without one', () => {
    expect(specialistHolderName('pr-reviewer', '1a2b3c4d-5e6f-7890')).toBe('sp-pr-reviewer-1a2b3c4d');
    expect(specialistHolderName('pr-reviewer', null, 4242)).toBe('sp-pr-reviewer-4242');
    expect(specialistHolderName('pr reviewer!', '')).toBe(`sp-pr-reviewer-${process.pid}`);
  });
});
