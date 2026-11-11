/**
 * Dist gate for the release script (SPECIALISTS-4420).
 *
 * The committed dist is built in the CI image, and a host build can disagree with it (bun
 * tree-shakes two unused pi-tui re-exports differently on a maintainer machine). So the
 * release pre-flight does not rebuild on the host: it asks GitHub which checks ran on the
 * exact commit and refuses unless both dist-comparison jobs passed there.
 *
 * Usage:
 *   bun scripts/ci-dist-gate.ts --sha <commit>             # query GitHub, decide
 *   bun scripts/ci-dist-gate.ts --sha <commit> --json <f>  # decide from a saved response
 *
 * Exit: 0 the dist checks passed on that commit, 3 they did not run or did not pass.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Jobs whose failure means the committed dist is not what CI builds. */
export const DIST_CHECK_JOBS = ['packed-smoke', 'payload-contract'] as const;

/** GitHub's maximum page size for check runs, and a bound so a broken response cannot loop. */
export const CHECK_RUNS_PER_PAGE = 100;
export const MAX_CHECK_RUN_PAGES = 20;

export interface CheckRun {
  name?: string;
  head_sha?: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  details_url?: string;
}

export interface CheckRunsPayload {
  check_runs?: CheckRun[];
}

export type DistGateVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Decide from a GitHub check-runs payload. Pure, so the release path and its tests agree.
 */
export function evaluateDistGate(sha: string, payload: CheckRunsPayload): DistGateVerdict {
  const runs = Array.isArray(payload.check_runs) ? payload.check_runs : [];
  // Strict: a check run without a head_sha is not evidence about this commit. Accepting an
  // unknown commit is how a green run from somewhere else passes as proof.
  const forSha = runs.filter((run) => run.head_sha === sha);
  const problems: string[] = [];

  for (const job of DIST_CHECK_JOBS) {
    const matches = forSha.filter((run) => run.name === job);
    if (matches.length === 0) {
      problems.push(`${job}: did not run on ${sha}`);
      continue;
    }
    // A commit can collect several runs of the same job (re-runs). One green one is enough.
    if (matches.some((run) => run.conclusion === 'success')) continue;
    const pending = matches.some((run) => run.status !== 'completed');
    const url = matches[0]?.html_url ?? matches[0]?.details_url ?? '(no url)';
    problems.push(pending ? `${job}: still running (${url})` : `${job}: ${matches[0]?.conclusion ?? 'unknown'} (${url})`);
  }

  if (problems.length === 0) return { ok: true };
  return { ok: false, reason: `dist checks are not green on ${sha}: ${problems.join('; ')}` };
}

/**
 * Read every check run for a commit. A busy commit can exceed one page, and a job that fell on
 * page two would otherwise read as "did not run".
 */
export function fetchCheckRuns(
  sha: string,
  request: (page: number) => string = (page) =>
    execFileSync(
      'gh',
      ['api', `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100&page=${page}`, '--jq', '.'],
      { encoding: 'utf8' },
    ),
): CheckRunsPayload {
  const collected: CheckRun[] = [];
  for (let page = 1; page <= MAX_CHECK_RUN_PAGES; page += 1) {
    const payload = JSON.parse(request(page)) as CheckRunsPayload;
    const runs = Array.isArray(payload.check_runs) ? payload.check_runs : [];
    collected.push(...runs);
    if (runs.length < CHECK_RUNS_PER_PAGE) break;
  }
  return { check_runs: collected };
}

export function main(argv: string[]): number {
  const shaIndex = argv.indexOf('--sha');
  const jsonIndex = argv.indexOf('--json');
  const sha = shaIndex === -1 ? undefined : argv[shaIndex + 1];
  if (!sha) {
    console.error('usage: ci-dist-gate.ts --sha <commit> [--json <file>]');
    return 3;
  }
  const payload = jsonIndex === -1 ? fetchCheckRuns(sha) : (JSON.parse(readFileSync(argv[jsonIndex + 1]!, 'utf8')) as CheckRunsPayload);
  const verdict = evaluateDistGate(sha, payload);
  if (verdict.ok) {
    console.log(`     ${DIST_CHECK_JOBS.join(' + ')} green on ${sha}`);
    return 0;
  }
  console.error(`FAILED: ${verdict.reason}`);
  console.error('  Run them for that commit, then re-check:');
  console.error('    gh workflow run package-payload.yml --ref master');
  console.error(`    bun scripts/ci-dist-gate.ts --sha ${sha}`);
  return 3;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
