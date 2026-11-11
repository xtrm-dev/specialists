import { describe, expect, it } from 'vitest';

import { DIST_CHECK_JOBS, evaluateDistGate } from '../../../scripts/ci-dist-gate.ts';

const SHA = '42c77b68c42b725ccee7f69d42e4d3014a2ecfb2';

function run(name: string, conclusion: string | null, extra: Record<string, unknown> = {}) {
  return { name, head_sha: SHA, status: conclusion === null ? 'in_progress' : 'completed', conclusion, ...extra };
}

describe('release dist gate', () => {
  it('passes when both dist jobs are green on the commit', () => {
    const verdict = evaluateDistGate(SHA, {
      check_runs: [run('packed-smoke', 'success'), run('payload-contract', 'success'), run('test', 'failure')],
    });
    expect(verdict).toEqual({ ok: true });
  });

  it('passes on a green re-run even when an earlier attempt failed', () => {
    const verdict = evaluateDistGate(SHA, {
      check_runs: [
        run('packed-smoke', 'failure'),
        run('packed-smoke', 'success'),
        run('payload-contract', 'success'),
      ],
    });
    expect(verdict.ok).toBe(true);
  });

  it('refuses when a dist job failed, naming the job and the run', () => {
    const verdict = evaluateDistGate(SHA, {
      check_runs: [
        run('packed-smoke', 'failure', { html_url: 'https://github.com/o/r/actions/runs/1/job/2' }),
        run('payload-contract', 'success'),
      ],
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.reason).toContain('packed-smoke: failure');
    expect(verdict.reason).toContain('https://github.com/o/r/actions/runs/1/job/2');
    expect(verdict.reason).not.toContain('payload-contract:');
  });

  it('refuses when a dist job did not run at all', () => {
    const verdict = evaluateDistGate(SHA, { check_runs: [run('payload-contract', 'success'), run('test', 'success')] });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.reason).toContain('packed-smoke: did not run');
  });

  it('refuses when a job is still running', () => {
    const verdict = evaluateDistGate(SHA, {
      check_runs: [run('packed-smoke', null), run('payload-contract', 'success')],
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.reason).toContain('still running');
  });

  it('refuses when the only green jobs belong to another commit', () => {
    const verdict = evaluateDistGate(SHA, {
      check_runs: [
        { ...run('packed-smoke', 'success'), head_sha: 'a'.repeat(40) },
        { ...run('payload-contract', 'success'), head_sha: 'b'.repeat(40) },
      ],
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.reason).toContain('did not run');
  });

  it('requires payload-contract as well: a failed one refuses even when packed-smoke passed', () => {
    const verdict = evaluateDistGate(SHA, {
      check_runs: [
        run('packed-smoke', 'success'),
        run('payload-contract', 'failure', { html_url: 'https://github.com/o/r/actions/runs/9/job/8' }),
      ],
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.reason).toContain('payload-contract: failure');
    expect(verdict.reason).toContain('https://github.com/o/r/actions/runs/9/job/8');
  });

  it('requires payload-contract as well: a missing one refuses even when packed-smoke passed', () => {
    const verdict = evaluateDistGate(SHA, { check_runs: [run('packed-smoke', 'success'), run('test', 'success')] });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.reason).toContain('payload-contract: did not run');
    expect(verdict.reason).not.toContain('packed-smoke:');
  });

  it('names both dist jobs, so shrinking the list cannot pass silently', () => {
    expect([...DIST_CHECK_JOBS].sort()).toEqual(['packed-smoke', 'payload-contract']);
  });

  it('refuses on an empty payload rather than assuming success', () => {
    const verdict = evaluateDistGate(SHA, {});
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    for (const job of DIST_CHECK_JOBS) expect(verdict.reason).toContain(`${job}: did not run`);
  });
});
