import { describe, expect, it } from 'vitest';
import os, { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import {
  IDENTITY_ENV_ALLOWLIST,
  resolveAgentIdentityEnv,
  resolveAgentLaunchEnv,
  shimBinDir,
  specialistHolderName,
  specialistPath,
} from '../../../src/pi/identity-env.js';

const D = path.delimiter;

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
              GIT_CONFIG_COUNT: '2',
              GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
              GIT_CONFIG_VALUE_0: 'git@github.com:',
              GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
              GIT_CONFIG_VALUE_1: '',
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
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
      GIT_CONFIG_VALUE_0: 'git@github.com:',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_1: '',
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

  it('keeps a deliberately empty GIT_CONFIG value so the exported count stays valid', () => {
    // core git-transport.ts writes `credential.https://github.com.helper` with an
    // EMPTY value to reset an inherited helper. Dropping it desynchronises
    // GIT_CONFIG_COUNT from the pairs and breaks every git command.
    const env = resolveAgentIdentityEnv({
      holder: 'h',
      roleName: 'pr-reviewer',
      run: () => ({
        status: 0,
        stdout: JSON.stringify({
          env: {
            GIT_CONFIG_COUNT: '3',
            GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
            GIT_CONFIG_VALUE_0: 'git@github.com:',
            GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
            GIT_CONFIG_VALUE_1: '',
            GIT_CONFIG_KEY_2: 'credential.https://github.com.useHttpPath',
            GIT_CONFIG_VALUE_2: 'true',
            EMPTY: '',
          },
        }),
      }),
    });

    expect(env.GIT_CONFIG_COUNT).toBe('3');
    expect(env.GIT_CONFIG_VALUE_1).toBe('');
    expect(env.GIT_CONFIG_KEY_2).toBe('credential.https://github.com.useHttpPath');
    // The empty-value rule still drops unrelated empty keys.
    expect(env.EMPTY).toBeUndefined();
  });

  it('drops the whole GIT_CONFIG block rather than export a count git cannot satisfy, and says why', () => {
    const warnings: string[] = [];
    const env = resolveAgentIdentityEnv({
      holder: 'h',
      warn: (message) => warnings.push(message),
      run: () => ({
        status: 0,
        stdout: JSON.stringify({
          env: {
            GIT_CONFIG_COUNT: '3',
            GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
            GIT_CONFIG_VALUE_0: 'git@github.com:',
            GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
            GIT_CONFIG_VALUE_1: '!xt identity credential',
            GIT_CONFIG_KEY_3: 'credential.https://github.com.useHttpPath',
            GIT_CONFIG_VALUE_3: 'true',
          },
        }),
      }),
    });

    expect(Object.keys(env).filter((key) => key.startsWith('GIT_CONFIG_'))).toEqual([]);
    expect(env.SUBSTRATE_HOLDER).toBe('h');
    // Operator-visible: the fallback to the machine transport changes which
    // identity git runs as, so it never happens silently. The reason names the
    // missing pair (indexes and key names only, never a value).
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('dropped the GIT_CONFIG_* block');
    expect(warnings[0]).toContain('GIT_CONFIG_KEY_2 is missing');
    expect(warnings[0]).not.toContain('git@github.com:');
  });

  it('drops a GIT_CONFIG block whose count is not a number, and says why', () => {
    const warnings: string[] = [];
    const env = resolveAgentIdentityEnv({
      holder: 'h',
      warn: (message) => warnings.push(message),
      run: () => ({ status: 0, stdout: JSON.stringify({ env: { GIT_CONFIG_COUNT: 'three', GIT_CONFIG_KEY_0: 'a', GIT_CONFIG_VALUE_0: 'b' } }) }),
    });
    expect(Object.keys(env).filter((key) => key.startsWith('GIT_CONFIG_'))).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('GIT_CONFIG_COUNT is not a number');
  });

  it('drops a GIT_CONFIG block whose index sits outside the count, and says why', () => {
    const warnings: string[] = [];
    const env = resolveAgentIdentityEnv({
      holder: 'h',
      warn: (message) => warnings.push(message),
      run: () => ({
        status: 0,
        stdout: JSON.stringify({
          env: {
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
            GIT_CONFIG_VALUE_0: 'git@github.com:',
            GIT_CONFIG_KEY_4: 'credential.https://github.com.useHttpPath',
            GIT_CONFIG_VALUE_4: 'true',
          },
        }),
      }),
    });
    expect(Object.keys(env).filter((key) => key.startsWith('GIT_CONFIG_'))).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('GIT_CONFIG_KEY_4 is outside GIT_CONFIG_COUNT');
  });

  it('stays quiet for a valid block, including the empty reset value', () => {
    const warnings: string[] = [];
    const env = resolveAgentIdentityEnv({
      holder: 'h',
      warn: (message) => warnings.push(message),
      run: () => ({
        status: 0,
        stdout: JSON.stringify({
          env: {
            GIT_CONFIG_COUNT: '2',
            GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
            GIT_CONFIG_VALUE_0: 'git@github.com:',
            GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
            GIT_CONFIG_VALUE_1: '',
          },
        }),
      }),
    });
    expect(warnings).toEqual([]);
    expect(env.GIT_CONFIG_VALUE_1).toBe('');
  });

  it('exports an env git can actually run with, empty reset included', () => {
    const env = resolveAgentIdentityEnv({
      holder: 'h',
      roleName: 'pr-reviewer',
      run: () => ({
        status: 0,
        stdout: JSON.stringify({
          env: {
            GIT_CONFIG_COUNT: '2',
            GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
            GIT_CONFIG_VALUE_0: 'git@github.com:',
            GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
            GIT_CONFIG_VALUE_1: '',
          },
        }),
      }),
    });

    const dir = mkdtempSync(join(tmpdir(), 'identity-env-git-'));
    try {
      // git exits non-zero with `fatal: unable to parse command-line config` when
      // GIT_CONFIG_COUNT names a pair it does not have.
      const result = spawnSync('git', ['init', '--quiet'], {
        cwd: dir,
        env: { ...env, PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? dir },
        encoding: 'utf8',
      });
      expect(result.stderr, String(result.stderr)).not.toContain('unable to parse command-line config');
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('specialistPath (CORE-2524.4)', () => {
  it('is the directory `xt identity setup` installs the shim into', () => {
    expect(shimBinDir({ HOME: '/home/worker' })).toBe(path.join('/home/worker', '.local', 'bin'));
  });

  it('falls back to the OS home when HOME is unset', () => {
    expect(shimBinDir({})).toBe(path.join(os.homedir(), '.local', 'bin'));
  });

  it('prepends the shim directory when the host PATH does not contain it', () => {
    expect(specialistPath({ HOME: '/home/worker', PATH: `/usr/bin${D}/bin` }))
      .toBe(`/home/worker/.local/bin${D}/usr/bin${D}/bin`);
  });

  it('keeps exactly one entry when the shim directory is already first', () => {
    const found = specialistPath({ HOME: '/home/worker', PATH: `/home/worker/.local/bin${D}/usr/bin` });
    expect(found).toBe(`/home/worker/.local/bin${D}/usr/bin`);
    expect(found.split(D).filter((entry) => entry === '/home/worker/.local/bin')).toHaveLength(1);
  });

  it('removes a later duplicate instead of adding a second one', () => {
    expect(specialistPath({ HOME: '/home/worker', PATH: `/usr/bin${D}/home/worker/.local/bin${D}/bin` }))
      .toBe(`/home/worker/.local/bin${D}/usr/bin${D}/bin`);
  });

  it('drops empty segments, which would mean the current directory', () => {
    expect(specialistPath({ HOME: '/home/worker', PATH: `${D}/usr/bin${D}${D}/bin${D}` }))
      .toBe(`/home/worker/.local/bin${D}/usr/bin${D}/bin`);
  });

  it('returns just the shim directory when PATH is unset or empty', () => {
    expect(specialistPath({ HOME: '/home/worker' })).toBe('/home/worker/.local/bin');
    expect(specialistPath({ HOME: '/home/worker', PATH: '' })).toBe('/home/worker/.local/bin');
  });
});

describe('resolveAgentLaunchEnv', () => {
  it('fabricates no PATH without a holder', () => {
    expect(resolveAgentLaunchEnv({ env: { HOME: '/home/worker', PATH: '/usr/bin' } })).toEqual({});
  });

  it('adds PATH and nothing else to the identity env', () => {
    const env = resolveAgentLaunchEnv({
      holder: 'sp-pr-reviewer-1a2b3c4d',
      roleName: 'pr-reviewer',
      env: { HOME: '/home/worker', PATH: '/usr/bin' },
      run: () => ({ status: 0, stdout: JSON.stringify({ env: { SUBSTRATE_HOLDER: 'h', XTRM_ROLE: 'reviewer', GITHUB_TOKEN: 'ghs_must_not_ride' } }) }),
    });
    expect(env).toEqual({
      SUBSTRATE_HOLDER: 'sp-pr-reviewer-1a2b3c4d',
      XTRM_ROLE: 'reviewer',
      PATH: `/home/worker/.local/bin${D}/usr/bin`,
    });
  });

  it('never takes PATH from the CLI answer', () => {
    const env = resolveAgentLaunchEnv({
      holder: 'h',
      env: { HOME: '/home/worker', PATH: '/usr/bin' },
      run: () => ({ status: 0, stdout: JSON.stringify({ env: { PATH: '/cli/answer/bin' } }) }),
    });
    expect(env.PATH).toBe(`/home/worker/.local/bin${D}/usr/bin`);
    expect(env.PATH.split(D)).not.toContain('/cli/answer/bin');
  });

  it('carries the shim PATH even when xt is unavailable', () => {
    const env = resolveAgentLaunchEnv({
      holder: 'h',
      roleName: 'pr-reviewer',
      env: { HOME: '/home/worker', PATH: '/usr/bin' },
      run: () => ({ status: 127, stdout: '' }),
    });
    expect(env.PATH).toBe(`/home/worker/.local/bin${D}/usr/bin`);
    expect(env.SUBSTRATE_HOLDER).toBe('h');
  });
});

describe('specialistHolderName', () => {
  it('is stable per job and unique per run without one', () => {
    expect(specialistHolderName('pr-reviewer', '1a2b3c4d-5e6f-7890')).toBe('sp-pr-reviewer-1a2b3c4d');
    expect(specialistHolderName('pr-reviewer', null, 4242)).toBe('sp-pr-reviewer-4242');
    expect(specialistHolderName('pr reviewer!', '')).toBe(`sp-pr-reviewer-${process.pid}`);
  });
});
