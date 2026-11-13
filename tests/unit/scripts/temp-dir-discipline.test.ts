import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CORE-2612 / SPECIALISTS-4474: the sweep in tests/setup/tmp-registry.ts can only remove
 * scratch directories that were registered, and registration happens only through
 * tests/utils/temp-dir.ts. A file that calls `mkdtemp` + `Sync` directly creates a directory
 * nothing will remove, so an interrupted run leaves it behind and the next run reports it
 * as a leak nobody can find — the failure that made master red at 1218426a.
 *
 * 118 files did exactly that. This check is what stops it coming back one file at a time:
 * a raw `mkdtemp` + `Sync` anywhere under tests/ is a failure, with the two files that ARE the
 * registry as the only exceptions.
 */

const TESTS_ROOT = join(process.cwd(), 'tests');

/**
 * Spelled in two halves on purpose: this file is under tests/, so a literal token here would
 * make the check fail on itself. The rule has no exception for the file that states it.
 */
const RAW_CALL = 'mkdtemp' + 'Sync';

/** The only two files allowed to create a scratch directory without going through tempDir. */
const EXCEPTIONS = new Set([
  'tests/setup/tmp-registry.ts',
  'tests/utils/temp-dir.ts',
]);

function testFiles(dir = TESTS_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...testFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('scratch directories go through tempDir (SPECIALISTS-4474)', () => {
  it('finds the test tree it is meant to police', () => {
    // Without this, a broken walk would make the check below vacuously green — the exact
    // shape of a guard that survives removing the thing it pins.
    const files = testFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(files.map((file) => relative(process.cwd(), file))).toContain('tests/utils/temp-dir.ts');
  });

  it('has no raw scratch-directory call outside the registry itself', () => {
    const offenders = testFiles()
      .map((file) => relative(process.cwd(), file))
      .filter((file) => !EXCEPTIONS.has(file))
      .filter((file) => readFileSync(join(process.cwd(), file), 'utf8').includes(RAW_CALL));

    expect(
      offenders,
      'these test files create a scratch directory nothing will clean up. Import tempDir ' +
        '(or scratchDir when the base must be the working tree) from tests/utils/temp-dir.ts ' +
        'instead of calling ' + RAW_CALL + ': ' + offenders.join(', '),
    ).toEqual([]);
  });

  it('keeps both exceptions real and still registered', () => {
    // An exception list that outlives its files silently widens: a renamed file would leave
    // a dead entry, and the next raw call could hide behind a stale path.
    for (const file of EXCEPTIONS) {
      expect(readFileSync(join(process.cwd(), file), 'utf8')).toContain(RAW_CALL);
    }
    const registry = readFileSync(join(process.cwd(), 'tests/utils/temp-dir.ts'), 'utf8');
    expect(registry).toContain('registerTempDir(dir)');
    expect(registry).toContain('export function tempDir(');
    expect(registry).toContain('export function scratchDir(');
  });
});
