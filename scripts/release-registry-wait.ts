/**
 * Wait for a published version to appear on the registry (SPECIALISTS-4429).
 *
 * npm accepts the publish and then processes it: the 4.2.0 publish job was green at 12:12:36 and
 * the version became readable about six minutes later. The release script's old 60-second window
 * therefore reported `registry reports 4.1.1, expected 4.2.0` *after* a successful publish, which
 * is the worst possible message: it reads like a failed release.
 *
 * This waits ten minutes by default, says so while it waits, and on timeout names what it did see
 * and points at the publish run instead of implying that nothing was published.
 *
 * Exit: 0 the version is visible, 5 it is not visible within the window.
 */

import { execFileSync } from 'node:child_process';

export interface RegistryWaitDeps {
  /** Latest version visible for the package, or undefined when the query fails. */
  read: (pkg: string) => string | undefined;
  sleep: (ms: number) => void;
  now?: () => number;
}

export interface RegistryWaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  reportEveryMs?: number;
  onReport?: (elapsedMs: number, lastSeen: string | undefined) => void;
}

export interface RegistryWaitResult {
  ok: boolean;
  lastSeen?: string;
  elapsedMs: number;
  attempts: number;
}

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_INTERVAL_MS = 15 * 1000;
export const DEFAULT_REPORT_EVERY_MS = 60 * 1000;

/**
 * Poll until `version` is visible or the window closes. Pure apart from the injected clock,
 * reader and sleep, so tests can run ten minutes of waiting in microseconds.
 */
export function waitForPublishedVersion(
  pkg: string,
  version: string,
  deps: RegistryWaitDeps,
  options: RegistryWaitOptions = {},
): RegistryWaitResult {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const reportEveryMs = options.reportEveryMs ?? DEFAULT_REPORT_EVERY_MS;
  const now = deps.now ?? (() => Date.now());

  const startedAt = now();
  let lastSeen: string | undefined;
  let attempts = 0;
  let lastReport = 0;

  for (;;) {
    attempts += 1;
    const seen = deps.read(pkg);
    if (seen) lastSeen = seen;
    if (seen === version) {
      return { ok: true, lastSeen, elapsedMs: now() - startedAt, attempts };
    }

    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) {
      return { ok: false, lastSeen, elapsedMs: elapsed, attempts };
    }
    if (elapsed - lastReport >= reportEveryMs) {
      lastReport = elapsed;
      options.onReport?.(elapsed, lastSeen);
    }
    deps.sleep(Math.min(intervalMs, timeoutMs - elapsed));
  }
}

function readRegistryVersion(pkg: string): string | undefined {
  try {
    const out = execFileSync('npm', ['view', pkg, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const trimmed = out.trim();
    return trimmed === '' ? undefined : trimmed;
  } catch {
    return undefined;
  }
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const [pkg, version] = argv;
  if (!pkg || !version) {
    console.error('usage: release-registry-wait.ts <package> <version>');
    return 5;
  }
  const result = waitForPublishedVersion(pkg, version, {
    read: readRegistryVersion,
    sleep: (ms) => {
      // Synchronous on purpose: the release script is a linear shell script and must not proceed
      // while the registry is still processing.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    },
  }, {
    onReport: (elapsedMs, lastSeen) => {
      const seconds = Math.round(elapsedMs / 1000);
      console.error(`   still waiting: ${pkg}@${version} not visible after ${seconds}s (registry says ${lastSeen ?? 'nothing'})`);
    },
  });

  if (result.ok) {
    console.log(`     ${pkg}@${version} visible after ${Math.round(result.elapsedMs / 1000)}s`);
    return 0;
  }
  console.error(`FAILED: ${pkg}@${version} is not visible after ${Math.round(result.elapsedMs / 1000)}s (registry reports ${result.lastSeen ?? 'nothing'}).`);
  console.error('  The publish job may still be processing, which is normal for a few minutes.');
  console.error('  Check the publish run, then re-check by hand:');
  console.error(`    npm view ${pkg} version`);
  return 5;
}

if (import.meta.main) process.exit(main());
