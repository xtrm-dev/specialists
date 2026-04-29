import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../../package.json') as { version: string };

export const localVersion = packageVersion;

const CACHE_PATH = join(process.cwd(), '.specialists', 'version-check.json');
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const NETWORK_TIMEOUT_MS = 2000;

export interface VersionCheckCache {
  checked_at_ms: number;
  latest_tag: string;
  notified_for_tag: string;
}

export interface VersionCheckResult {
  latestTag: string;
  localVersion: string;
  cache: VersionCheckCache;
}

export function shouldRunVersionCheck(): boolean {
  if (process.env.SPECIALISTS_OFFLINE === '1') return false;
  if (process.env.SPECIALISTS_JOB_ID || process.env.PI_SESSION_ID) return false;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  return true;
}

function readCache(): VersionCheckCache | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as VersionCheckCache;
  } catch {
    return null;
  }
}

export function readCachedVersionCheck(): VersionCheckCache | null {
  return readCache();
}

function writeCache(cache: VersionCheckCache): void {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function isFresh(cache: VersionCheckCache): boolean {
  return Date.now() - cache.checked_at_ms < CACHE_MAX_AGE_MS;
}

function parseLatestTag(stdout: string): string | null {
  const tags = stdout
    .split('\n')
    .map(line => line.trim().split(/\s+/).at(-1) ?? '')
    .filter(line => /^refs\/tags\/v\d+\.\d+\.\d+$/.test(line))
    .map(line => line.slice('refs/tags/'.length))
    .sort((left, right) => compareVersions(left, right));

  return tags.at(-1) ?? null;
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] | null => {
    const match = value.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };

  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function runRemoteTagLookup(): string | null {
  const result = spawnSync('git', ['ls-remote', '--tags', '--refs', 'origin'], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: NETWORK_TIMEOUT_MS,
  });

  if (result.status !== 0 || result.error) return null;
  return parseLatestTag(result.stdout ?? '');
}

export function getVersionCheckResult(): VersionCheckResult | null {
  if (!shouldRunVersionCheck()) return null;

  const cached = readCache();
  if (cached && isFresh(cached)) {
    return {
      latestTag: cached.latest_tag,
      localVersion: packageVersion,
      cache: cached,
    };
  }

  const latestTag = runRemoteTagLookup();
  if (!latestTag) return null;

  const cache: VersionCheckCache = {
    checked_at_ms: Date.now(),
    latest_tag: latestTag,
    notified_for_tag: cached?.notified_for_tag ?? '',
  };
  writeCache(cache);

  return {
    latestTag,
    localVersion: packageVersion,
    cache,
  };
}

export function formatVersionCheckNudge(result: VersionCheckResult): string | null {
  if (compareVersions(result.latestTag, `v${result.localVersion}`) <= 0) return null;
  if (result.cache.notified_for_tag === result.latestTag) return null;
  return `specialists v${result.localVersion} is local; ${result.latestTag} published — consider /update-specialists before substantial work.`;
}

export function markVersionCheckNotified(result: VersionCheckResult): void {
  if (result.cache.notified_for_tag === result.latestTag) return;
  writeCache({
    ...result.cache,
    notified_for_tag: result.latestTag,
  });
}
