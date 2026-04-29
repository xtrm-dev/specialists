import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_CWD = process.cwd();

function setupTty(): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
}

function setupNonTty(): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
}

async function loadModule() {
  return import('../../../src/cli/version-check.js');
}

describe('version-check CLI', () => {
  let tempDir = '';

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.chdir(ORIGINAL_CWD);
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('skips when not tty', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'version-check-'));
    process.chdir(tempDir);
    setupNonTty();

    const { shouldRunVersionCheck } = await loadModule();
    expect(shouldRunVersionCheck()).toBe(false);
  });

  it('skips when offline or in specialist sandbox', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'version-check-'));
    process.chdir(tempDir);
    setupTty();

    process.env.SPECIALISTS_OFFLINE = '1';
    let mod = await loadModule();
    expect(mod.shouldRunVersionCheck()).toBe(false);

    delete process.env.SPECIALISTS_OFFLINE;
    process.env.SPECIALISTS_JOB_ID = 'job-1';
    mod = await loadModule();
    expect(mod.shouldRunVersionCheck()).toBe(false);

    delete process.env.SPECIALISTS_JOB_ID;
    process.env.PI_SESSION_ID = 'session-1';
    mod = await loadModule();
    expect(mod.shouldRunVersionCheck()).toBe(false);
  });

  it('reads cache when fresh', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'version-check-'));
    process.chdir(tempDir);
    setupTty();

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      const cache = {
        checked_at_ms: Date.now(),
        latest_tag: 'v3.11.0',
        notified_for_tag: '',
      };
      return {
        ...actual,
        existsSync: (path: string) => path.endsWith('version-check.json'),
        readFileSync: () => JSON.stringify(cache),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
      };
    });
    const spawnSync = vi.fn();
    vi.doMock('node:child_process', () => ({ spawnSync }));

    const { getVersionCheckResult } = await loadModule();
    const result = getVersionCheckResult();

    expect(result?.latestTag).toBe('v3.11.0');
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('returns null on spawn timeout error without throwing', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'version-check-'));
    process.chdir(tempDir);
    setupTty();

    vi.doMock('node:child_process', () => ({
      spawnSync: vi.fn(() => ({ error: new Error('timeout'), status: null })),
    }));
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        mkdirSync: vi.fn(),
      };
    });

    const { getVersionCheckResult } = await loadModule();
    expect(getVersionCheckResult()).toBeNull();
  });

  it('parses remote tags, caches result, and nudges on newer release', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'version-check-'));
    process.chdir(tempDir);
    setupTty();

    const writes: Array<{ path: string; payload: string }> = [];
    const spawnSync = vi.fn(() => ({
      status: 0,
      error: null,
      stdout: [
        'abc\trefs/tags/v3.9.0',
        'def\trefs/tags/v3.10.1',
        'ghi\trefs/tags/v3.11.0',
      ].join('\n'),
    }));

    vi.doMock('node:child_process', () => ({ spawnSync }));
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        existsSync: vi.fn((path: string) => path.endsWith('version-check.json')),
        readFileSync: vi.fn(() => '{"checked_at_ms":0,"latest_tag":"v0.0.0","notified_for_tag":""}'),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn((path: string, payload: string) => writes.push({ path, payload })),
      };
    });

    const { formatVersionCheckNudge, getVersionCheckResult, markVersionCheckNotified } = await loadModule();
    const result = getVersionCheckResult();

    expect(result?.latestTag).toBe('v3.11.0');
    expect(formatVersionCheckNudge(result!)).toBe('specialists v3.10.0 is local; v3.11.0 published — consider /update-specialists before substantial work.');
    expect(writes.length).toBeGreaterThan(0);

    markVersionCheckNotified(result!);
    expect(writes.at(-1)?.payload).toContain('"notified_for_tag": "v3.11.0"');
  });
});
