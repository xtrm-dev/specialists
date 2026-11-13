import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { registerTempDir } from '../setup/tmp-registry.js';

// CORE-2612: every scratch directory this test file creates is registered here
// and removed once the file finishes. A full suite run used to add ~95 entries
// to the OS temp dir (tmpfs at 80% on 2026-11-11, which surfaced as unrelated
// disk I/O failures). Import this helper instead of calling mkdtemp directly in
// a test, and the cleanup happens even when the test fails.
const dirs = new Set<string>();

export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.add(dir);
  registerTempDir(dir);
  return dir;
}

/**
 * A registered scratch directory under an explicit base.
 *
 * Three files create their scratch trees inside the repository (`.tmp-specialists-<issue>-`)
 * because the code under test resolves paths relative to the working tree. They are scratch
 * directories all the same: an interrupted run leaves them behind exactly like a tempdir, so
 * they go through the same sweep. Nothing else should use this — prefer {@link tempDir}.
 */
export function scratchDir(base: string, prefix: string): string {
  const dir = mkdtempSync(join(base, prefix));
  dirs.add(dir);
  registerTempDir(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.clear();
}

afterAll(() => cleanupTempDirs());
