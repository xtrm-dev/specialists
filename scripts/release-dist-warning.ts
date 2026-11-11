/**
 * Optional, print-only host rebuild check for the release script (SPECIALISTS-4429).
 *
 * This is deliberately NOT a gate: the committed dist is built in the CI image and a host build
 * can differ (bun tree-shakes two unused pi-tui re-exports differently outside that image). The
 * only thing this may do is tell a curious operator that their local build differs.
 *
 * It is also the one place the old inline version was wrong: it ran `git checkout -- dist/` and
 * nothing else, so files the build had *created* under dist/ stayed behind as untracked files and
 * the next step's clean-tree check failed minutes later with a confusing message.
 *
 * Always exits 0. A warning is not a failure.
 */

import { execFileSync } from 'node:child_process';

export type ExecResult = { status: number; stdout?: string; stderr?: string };
export type Exec = (
  command: string,
  args: string[],
  options?: { env?: Record<string, string | undefined> },
) => ExecResult;

export interface DistWarningDeps {
  exec: Exec;
  log: (line: string) => void;
}

/**
 * Build, report the difference, then restore the tree (tracked changes AND untracked files).
 * Restores even when the build fails, so a failure here cannot poison the clean-tree check.
 */
export function runDistWarning(deps: DistWarningDeps): { differed: boolean } {
  const { exec, log } = deps;

  // NODE_ENV is part of the release build contract; dropping it here compared a different build.
  const build = exec('bun', ['run', 'build'], { env: { ...process.env, NODE_ENV: 'test' } });
  let differed = true;
  if (build.status !== 0) {
    log('WARNING: host rebuild failed; nothing to compare');
  } else if (exec('git', ['diff', '--quiet', '--', 'dist/']).status === 0) {
    log('   host rebuild matches the committed dist');
    differed = false;
  } else {
    log('WARNING: a host rebuild differs from the committed dist (expected; CI is authoritative):');
    const stat = exec('git', ['diff', '--stat', '--', 'dist/']);
    if (stat.stdout) log(stat.stdout.trimEnd());
  }

  // Always restore, both halves: checkout for tracked files, clean for files the build created.
  // A matching build can still leave untracked output, and returning early on a match left it
  // behind for the clean-tree check to trip over later.
  const restoreTracked = exec('git', ['checkout', '--', 'dist/']);
  const restoreUntracked = exec('git', ['clean', '-fdq', '--', 'dist/']);
  if (restoreTracked.status !== 0 || restoreUntracked.status !== 0) {
    log('WARNING: could not fully restore dist/; check `git status` before continuing');
  }
  return { differed };
}

export function main(): number {
  const exec: Exec = (command, args, options) => {
    try {
      const stdout = execFileSync(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options?.env,
      });
      return { status: 0, stdout };
    } catch (error) {
      const err = error as { status?: number; stdout?: string };
      return { status: err.status ?? 1, stdout: err.stdout };
    }
  };
  runDistWarning({ exec, log: (line) => console.error(line) });
  return 0;
}

if (import.meta.main) process.exit(main());
