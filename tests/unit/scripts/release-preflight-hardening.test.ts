import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CHECK_RUNS_PER_PAGE,
  DIST_CHECK_JOBS,
  evaluateDistGate,
  fetchCheckRuns,
} from '../../../scripts/ci-dist-gate.ts';
import { runDistWarning, type Exec, type ExecResult } from '../../../scripts/release-dist-warning.ts';
import { resolvePiVersion } from '../../../scripts/release-pi-version.ts';
import { waitForPublishedVersion } from '../../../scripts/release-registry-wait.ts';

const SHA = 'f43c5cef833b3fd7327f3e577229260a5ee21008';
const run = (name: string, conclusion: string | null, head_sha: string | undefined = SHA) => ({
  name,
  head_sha,
  status: conclusion === null ? 'in_progress' : 'completed',
  conclusion,
});

describe('dist gate: commit identity and pagination', () => {
  it('refuses a green run that carries no head_sha', () => {
    // No head_sha key at all: a default parameter would silently substitute the commit.
    const withoutSha = (name: string) => ({ name, status: 'completed', conclusion: 'success' });
    const verdict = evaluateDistGate(SHA, {
      check_runs: [withoutSha('packed-smoke'), withoutSha('payload-contract')],
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.reason).toContain('did not run');
  });

  it('finds a job that only appears on the second page', () => {
    const filler = Array.from({ length: CHECK_RUNS_PER_PAGE }, (_, index) => run(`noise-${index}`, 'success'));
    const pages = [JSON.stringify({ check_runs: filler }), JSON.stringify({ check_runs: [run('packed-smoke', 'success'), run('payload-contract', 'success')] })];
    const payload = fetchCheckRuns(SHA, (page) => pages[page - 1] ?? JSON.stringify({ check_runs: [] }));
    expect(payload.check_runs).toHaveLength(CHECK_RUNS_PER_PAGE + 2);
    expect(evaluateDistGate(SHA, payload).ok).toBe(true);
  });

  it('stops after one short page instead of asking for more', () => {
    const calls: number[] = [];
    fetchCheckRuns(SHA, (page) => {
      calls.push(page);
      return JSON.stringify({ check_runs: [run('packed-smoke', 'success')] });
    });
    expect(calls).toEqual([1]);
  });

  it('still requires both jobs after the page merge', () => {
    const payload = {
      check_runs: [run('packed-smoke', 'success'), run('payload-contract', 'failure')],
    };
    const verdict = evaluateDistGate(SHA, payload);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.reason).toContain('payload-contract: failure');
    expect(DIST_CHECK_JOBS).toHaveLength(2);
  });
});

describe('pi version resolution', () => {
  it('takes an explicit PI_VERSION', () => {
    const result = resolvePiVersion({ env: { PI_VERSION: '1.4.0' }, run: () => 'ignored' });
    expect(result).toEqual({ ok: true, version: '1.4.0', source: 'env' });
  });

  it('extracts the version from a decorated PI_VERSION', () => {
    const result = resolvePiVersion({ env: { PI_VERSION: 'v1.4.0-beta.2' }, run: () => 'ignored' });
    expect(result).toEqual({ ok: true, version: '1.4.0-beta.2', source: 'env' });
  });

  it('refuses PI_VERSION=unavailable instead of attesting nothing', () => {
    const result = resolvePiVersion({ env: { PI_VERSION: 'unavailable' }, run: () => 'ignored' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('unavailable');
  });

  it('refuses an override that merely contains a version', () => {
    for (const value of ['not 1.4.0', 'unavailable 1.0.0', '>=1.4.0', '1.4.0 extra']) {
      const result = resolvePiVersion({ env: { PI_VERSION: value }, run: () => 'ignored' });
      expect(result.ok, `expected ${JSON.stringify(value)} to be refused`).toBe(false);
    }
  });

  it('falls back to pi --version', () => {
    const result = resolvePiVersion({ env: {}, run: (command, args) => `${command} ${args.join(' ')} → 1.4.0` });
    expect(result).toEqual({ ok: true, version: '1.4.0', source: 'pi --version' });
  });

  it('refuses when pi is not installed', () => {
    const result = resolvePiVersion({
      env: {},
      run: () => {
        throw new Error('spawnSync pi ENOENT');
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('could not run');
    expect(result.reason).toContain('ENOENT');
  });

  it('refuses when pi prints no version', () => {
    const result = resolvePiVersion({ env: {}, run: () => 'development build\n' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toContain('no version');
  });
});

describe('registry wait', () => {
  const clock = (start = 0) => {
    let t = start;
    return { now: () => t, sleep: (ms: number) => { t += ms; } };
  };

  it('returns as soon as the version is visible', () => {
    const { now, sleep } = clock();
    const result = waitForPublishedVersion('pkg', '4.2.0', {
      read: () => '4.2.0',
      sleep,
      now,
    });
    expect(result).toMatchObject({ ok: true, attempts: 1 });
  });

  it('waits through a six-minute processing lag without reporting failure', () => {
    const { now, sleep } = clock();
    const started = now();
    const result = waitForPublishedVersion(
      'pkg',
      '4.2.0',
      {
        read: () => (now() - started < 6 * 60 * 1000 ? '4.1.1' : '4.2.0'),
        sleep,
        now,
      },
      // Defaults on purpose: the ten-minute window is the fix, so the test must use it.
    );
    expect(result.ok).toBe(true);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(6 * 60 * 1000);
  });

  it('reports what it did see when the window closes', () => {
    const { now, sleep } = clock();
    const reports: Array<string | undefined> = [];
    const result = waitForPublishedVersion(
      'pkg',
      '4.2.0',
      { read: () => '4.1.1', sleep, now },
      { timeoutMs: 180 * 1000, intervalMs: 15 * 1000, onReport: (_elapsed, seen) => reports.push(seen) },
    );
    expect(result.ok).toBe(false);
    expect(result.lastSeen).toBe('4.1.1');
    expect(reports).toContain('4.1.1');
  });

  it('does not spin when the window is already spent', () => {
    let reads = 0;
    const result = waitForPublishedVersion(
      'pkg',
      '4.2.0',
      { read: () => { reads += 1; return undefined; }, sleep: () => {}, now: () => 1_000_000 },
      { timeoutMs: 0 },
    );
    expect(result.ok).toBe(false);
    expect(reads).toBe(1);
  });
});

describe('host rebuild warning', () => {
  function recorder(responses: Record<string, ExecResult>) {
    const calls: string[] = [];
    const environments: Array<Record<string, string | undefined> | undefined> = [];
    const exec: Exec = (command, args, options) => {
      const key = `${command} ${args.join(' ')}`;
      calls.push(key);
      environments.push(options?.env);
      return responses[key] ?? { status: 0, stdout: '' };
    };
    return { calls, environments, exec };
  }

  it('restores tracked and untracked files after a differing build', () => {
    const { calls, exec } = recorder({
      'bun run build': { status: 0 },
      'git diff --quiet -- dist/': { status: 1 },
      'git diff --stat -- dist/': { status: 0, stdout: ' dist/index.js | 2 +-' },
    });
    const lines: string[] = [];
    const outcome = runDistWarning({ exec, log: (line) => lines.push(line) });
    expect(outcome.differed).toBe(true);
    expect(calls).toContain('git checkout -- dist/');
    expect(calls).toContain('git clean -fdq -- dist/');
    expect(lines.join('\n')).toContain('host rebuild differs');
  });

  it('still restores when the build fails', () => {
    const { calls, exec } = recorder({ 'bun run build': { status: 1 } });
    const lines: string[] = [];
    runDistWarning({ exec, log: (line) => lines.push(line) });
    expect(lines.join('\n')).toContain('host rebuild failed');
    expect(calls).toContain('git clean -fdq -- dist/');
  });

  it('builds with NODE_ENV=test, like the release does', () => {
    const { environments, exec } = recorder({
      'bun run build': { status: 0 },
      'git diff --quiet -- dist/': { status: 0 },
    });
    runDistWarning({ exec, log: () => {} });
    expect(environments[0]?.NODE_ENV).toBe('test');
  });

  it('still removes untracked files when the build matches', () => {
    // A matching build can create untracked output; leaving it behind breaks the clean-tree
    // check two steps later, far from the cause.
    const { calls, exec } = recorder({
      'bun run build': { status: 0 },
      'git diff --quiet -- dist/': { status: 0 },
    });
    const outcome = runDistWarning({ exec, log: () => {} });
    expect(outcome.differed).toBe(false);
    expect(calls).toContain('git checkout -- dist/');
    expect(calls).toContain('git clean -fdq -- dist/');
  });
});

describe('release script wiring', () => {
  const script = readFileSync(path.join(process.cwd(), 'scripts/release-4.2.0.sh'), 'utf8');

  it('derives PI_VERSION instead of requiring an undocumented variable', () => {
    expect(script).toContain('release-pi-version.ts');
    expect(script).toContain('export PI_VERSION=');
  });

  it('uses the registry wait instead of a short inline retry', () => {
    expect(script).toContain('release-registry-wait.ts');
    // The old inline retry set PUBLISHED in a ten-iteration loop; the wait now owns that logic.
    expect(script).not.toContain('PUBLISHED=""');
  });

  it('delegates the optional host rebuild to the restoring helper', () => {
    expect(script).toContain('release-dist-warning.ts');
    expect(script).not.toContain('git checkout -- dist/');
  });
});
