/**
 * Keep the test suite off the repository's authoritative observability store.
 *
 * `resolveObservabilityDbLocation` falls back to `<gitRoot>/.specialists/db` when
 * XDG_DATA_HOME is unset. That is correct for production and catastrophic for tests: on
 * 2026-09-06 a full suite run with an unreleased schema migration in the tree migrated the
 * live store in place — 678,561 forensic rows — with no operator action, and concurrent
 * workers contending on that one file produced `database is locked` failures that read as
 * flaky tests.
 *
 * This relocates ONLY the repository's own directory, per test file. Forcing
 * XDG_DATA_HOME globally was tried first and is wrong: tests that build their own temp
 * repository expect git-root resolution INSIDE it, so a global override puts the writer
 * and the reader of a single test on different databases. A targeted relocation leaves
 * every legitimate pattern untouched.
 *
 * Worktree note (SPECIALISTS-99): the forbidden directory MUST be derived through the
 * same resolver the code under test uses. Production anchors to `git --git-common-dir`,
 * so in a linked worktree it resolves to <main-checkout>/.specialists/db while a path
 * relative to this file resolves to <worktree>/.specialists/db. The old
 * worktree-relative forbid never matched, the comparison was inert, and the suite read
 * AND wrote the shared store. Deriving the forbid through the resolver follows
 * production by construction instead of duplicating its git logic in a way that drifts.
 */

import { afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveObservabilityDbLocation } from '../../src/specialist/observability-db.js';
import { createObservabilitySqliteClientAtPath } from '../../src/specialist/observability-sqlite.js';

const isolated = mkdtempSync(join(tmpdir(), 'specialists-test-db-'));

// Anchor on this file's repository, not process.cwd(), so the forbid is stable
// regardless of where vitest was invoked from. Guard env is cleared first so the
// resolver returns the true production (shared) directory, not an already-relocated one.
delete process.env.SPECIALISTS_FORBID_DB_DIR;
delete process.env.SPECIALISTS_FALLBACK_DB_DIR;
process.env.SPECIALISTS_FORBID_DB_DIR = resolveObservabilityDbLocation(
  resolve(import.meta.dirname, '../..'),
).dbDirectory;
process.env.SPECIALISTS_FALLBACK_DB_DIR = isolated;

// Fail loud, not silent: if the guard cannot redirect the shared store to the per-file
// temp dir, fail the file here rather than run assertions against (and write rows to)
// the authoritative store. A warning would preserve the silent failure mode being fixed.
for (const cwd of [resolve(import.meta.dirname, '../..'), process.cwd()]) {
  const guarded = resolveObservabilityDbLocation(cwd);
  if (resolve(guarded.dbDirectory) !== resolve(isolated)) {
    throw new Error(
      `specialists: test isolation failed — resolveObservabilityDbLocation(${cwd}) lands on ` +
        `${guarded.dbDirectory}, not the per-file temp store ${isolated}. ` +
        `FORBID=${process.env.SPECIALISTS_FORBID_DB_DIR}. Refusing to run against the shared store.`,
    );
  }
}

// Create the relocated store eagerly. `createObservabilitySqliteClient` returns null when
// the file is absent, and several supervisor and CLI tests require a real client — they
// used to get one only because they were opening the REPOSITORY's database. They need
// *a* store, not *the* store, so give them an empty migrated one.
createObservabilitySqliteClientAtPath(join(isolated, 'observability.db'))?.close();

afterAll(() => {
  rmSync(isolated, { recursive: true, force: true });
});
