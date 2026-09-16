import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { resolveObservabilityDbLocation } from '../../../src/specialist/observability-db.js';

/**
 * The canary for unitAI-rrdnt.16. If this fails, the suite can once again read and write
 * the repository's authoritative forensic store — which it did on 2026-09-06, migrating
 * 678,561 rows in place from a test run.
 *
 * `source` is deliberately still `git-root`: the resolution REASON is unchanged and the
 * relocation is a test-only override on top of it. Asserting the path rather than the
 * source keeps this test honest about what the guard actually does.
 *
 * Worktree note (SPECIALISTS-99): every expectation below is anchored on the
 * git-common-root store (<main-checkout>/.specialists/db), never on a path relative to
 * this file (<worktree>/.specialists/db). The old worktree-relative anchor made these
 * assertions pass vacuously in a linked worktree while the suite wrote the shared store.
 */

/**
 * Independent oracle for the authoritative shared store: the same
 * `git --git-common-dir` anchoring production uses, computed WITHOUT calling
 * production code — so the suite fails if the forbid path and the resolved path can
 * disagree (e.g., a worktree-relative forbid vs a common-root resolution).
 */
function resolveSharedDbDirIndependent(): string {
  const anchor = resolve(import.meta.dirname, '../../..');
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: anchor,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (common.status === 0) {
    const commonDir = common.stdout.trim();
    if (commonDir.length > 0 && commonDir.endsWith(`${sep}.git`)) {
      return join(commonDir.slice(0, -4), '.specialists', 'db');
    }
  }
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: anchor,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (top.status === 0 && top.stdout.trim().length > 0) {
    return join(top.stdout.trim(), '.specialists', 'db');
  }
  throw new Error(`specialists: cannot resolve shared DB dir from ${anchor}`);
}

/** Production resolution with the test guard removed: what the code under test would open if isolation were absent. */
function resolveProductionDbDirUnguarded(): string {
  const savedForbid = process.env.SPECIALISTS_FORBID_DB_DIR;
  const savedFallback = process.env.SPECIALISTS_FALLBACK_DB_DIR;
  delete process.env.SPECIALISTS_FORBID_DB_DIR;
  delete process.env.SPECIALISTS_FALLBACK_DB_DIR;
  try {
    return resolveObservabilityDbLocation(resolve(import.meta.dirname, '../../..')).dbDirectory;
  } finally {
    if (savedForbid === undefined) delete process.env.SPECIALISTS_FORBID_DB_DIR;
    else process.env.SPECIALISTS_FORBID_DB_DIR = savedForbid;
    if (savedFallback === undefined) delete process.env.SPECIALISTS_FALLBACK_DB_DIR;
    else process.env.SPECIALISTS_FALLBACK_DB_DIR = savedFallback;
  }
}

describe('observability test isolation', () => {
  const repoDbDir = resolveSharedDbDirIndependent();

  it('never resolves to the repository store, even from the repository root', () => {
    const location = resolveObservabilityDbLocation(process.cwd());

    expect(location.dbDirectory.startsWith(repoDbDir)).toBe(false);
    expect(location.dbPath.startsWith(repoDbDir)).toBe(false);
    // dbDirectory and dbPath must agree, or ensureObservabilityDbFile would mkdir one
    // place and write another — which would recreate the repository directory.
    expect(location.dbPath.startsWith(location.dbDirectory)).toBe(true);
  });

  it('arms the guard for every test file', () => {
    expect(process.env.SPECIALISTS_FORBID_DB_DIR).toBe(repoDbDir);
    expect(process.env.SPECIALISTS_FALLBACK_DB_DIR).toBeTruthy();
    expect(process.env.SPECIALISTS_FALLBACK_DB_DIR?.startsWith(repoDbDir)).toBe(false);
  });

  it('forbid path equals production resolution, so they cannot disagree in a worktree', () => {
    // Regression for SPECIALISTS-99: the old worktree-relative forbid
    // (<worktree>/.specialists/db) never equalled the common-root production resolution
    // (<main-checkout>/.specialists/db), so relocation was inert and the suite wrote the
    // shared store while this file stayed green. Both oracles must agree with the guard.
    expect(process.env.SPECIALISTS_FORBID_DB_DIR).toBe(resolveProductionDbDirUnguarded());
    expect(process.env.SPECIALISTS_FORBID_DB_DIR).toBe(repoDbDir);
  });

  it('leaves a temp repository resolving inside itself, not to the fallback', () => {
    // The failure mode a global XDG_DATA_HOME override would cause: a test builds its own
    // git root, and writer and reader end up on different databases.
    const location = resolveObservabilityDbLocation('/tmp');
    expect(location.dbDirectory).not.toBe(process.env.SPECIALISTS_FALLBACK_DB_DIR);
  });
});
