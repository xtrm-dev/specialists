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
  const forSha = runs.filter((run) => !run.head_sha || run.head_sha === sha);
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

function fetchCheckRuns(sha: string): CheckRunsPayload {
  const out = execFileSync(
    'gh',
    ['api', `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`, '--jq', '.'],
    { encoding: 'utf8' },
  );
  return JSON.parse(out) as CheckRunsPayload;
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
