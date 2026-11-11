import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// CORE-2612: a run-scoped temp directory plus a registry of scratch dirs.
//
// The whole run gets its own TMPDIR, so the guard can count exactly what this
// run left behind and nothing else. Per-file `afterAll` hooks remove their own
// directories, and the registry sweeps whatever a killed file (timeout, OOM)
// never reached. Teardown fails the run when an entry survives: a green suite
// that leaks its temp dirs is the leak that filled /tmp on 2026-11-11.
const runRoot = tmpdir();
const registry = join(runRoot, `specialists-run-${process.pid}.registry`);
let runTmp = '';

export function registerTempDir(dir: string): void {
  if (!process.env.SPECIALISTS_TMP_REGISTRY) return;
  try {
    appendFileSync(process.env.SPECIALISTS_TMP_REGISTRY, `${dir}\n`);
  } catch {
    /* the file's own afterAll still runs; the guard reports anything left */
  }
}

export async function setup(): Promise<void> {
  runTmp = mkdtempSync(join(runRoot, `specialists-run-${process.pid}-`));
  writeFileSync(registry, '');
  process.env.SPECIALISTS_TMP_REGISTRY = registry;
  // Workers inherit this, so every test's os.tmpdir() is inside runTmp.
  process.env.TMPDIR = runTmp;
  process.env.TMP = runTmp;
  process.env.TEMP = runTmp;
}

export async function teardown(): Promise<void> {
  if (existsSync(registry)) {
    for (const dir of readFileSync(registry, 'utf8').split('\n').filter(Boolean)) {
      rmSync(dir, { recursive: true, force: true });
    }
    rmSync(registry, { force: true });
  }

  // The bun/vitest runner keeps its own state inside TMPDIR (`.bun`, its
  // compile cache, and prefix-less `tmp.*` dirs). They are not test scratch
  // dirs, so the guard does not count them; every test here passes a prefix.
  const runnerOwned = /^(\.bun|node-compile-cache|tmp\.[A-Za-z0-9]+)$/;
  const left = (existsSync(runTmp) ? readdirSync(runTmp) : []).filter((name) => !runnerOwned.test(name));
  if (left.length > 0) {
    // A throw from globalSetup teardown is only logged by vitest; the explicit
    // exitCode is what turns the CI job red.
    process.exitCode = 1;
    rmSync(runTmp, { recursive: true, force: true });
    throw new Error(
      `test suite left ${left.length} entries in ${runTmp}: ${left.slice(0, 20).join(', ')}. `
      + 'Every mkdtemp must be removed in an afterAll/afterEach/finally hook, '
      + 'including when its test fails (CORE-2612).',
    );
  }
  rmSync(runTmp, { recursive: true, force: true });
}
