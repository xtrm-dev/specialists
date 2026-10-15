// Unit tests for the phase-1 permission guard (SPECIALISTS-4285).
// Exercises the REAL bundled artifact
// (config/pi-extensions/permission-guard/index.mjs) through its factory with
// a fake pi, mirroring tests/unit/pi/extension-tool-policy.test.ts style:
// no pi peer dep installed in the worktree, so createBashTool is stubbed at
// the module boundary and argv construction is asserted directly.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createBashTool: () => ({ name: 'bash' }),
}));

import { getPermissionGuardExtensionPath } from '../../../src/pi/permission-guard-extension.js';

const GUARD_DIR = await (async () => {
  const p = getPermissionGuardExtensionPath();
  expect(p).toBeTruthy();
  expect(existsSync(join(p!, 'index.mjs'))).toBe(true);
  return p!;
})();

type GuardModule = {
  default: (pi: unknown) => void;
  shq: (word: string) => string;
  buildCredentialMaskArgs: (home: string, fsHooks?: unknown) => Promise<string[]>;
  buildBwrapPrefix: (opts: { maskArgs: string[] }) => string[];
  buildWrappedCommand: (opts: { command: string; cwd: string; maskArgs: string[] }) => string;
  bwrapSelfCheck: (execFn?: unknown) => Promise<{ checked: boolean; ok: boolean; detail: string }>;
  __resetSelfCheckForTest: () => void;
  tierRefusal: () => string | null;
  bashRefusalReason: () => string | null;
  CREDENTIAL_PATHS: string[];
  CREDENTIAL_GLOBS: string[];
};

async function loadGuard(): Promise<GuardModule> {
  const mod = (await import(pathToFileURL(join(GUARD_DIR, 'index.mjs')).href)) as GuardModule;
  mod.__resetSelfCheckForTest();
  return mod;
}

function makeFakePi() {
  const handlers = new Map<string, Array<(event: unknown) => unknown>>();
  return {
    on: (name: string, handler: (event: unknown) => unknown) => {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name)!.push(handler);
    },
    emit: async (name: string, event: unknown) => {
      for (const h of handlers.get(name) ?? []) await h(event);
    },
    handlers,
  };
}

const fakeStat = (isDir: boolean) => () => ({ isDirectory: () => isDir });
const throwingStat = () => {
  throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
};

describe('permission-guard pure builders', () => {
  it('shq shell-quotes safely', async () => {
    const m = await loadGuard();
    expect(m.shq('/tmp/x')).toBe("'/tmp/x'");
    expect(m.shq(`a'b`)).toBe(`'a'\\''b'`);
    expect(m.shq('a; rm -rf /')).toBe("'a; rm -rf /'");
  });

  it('buildBwrapPrefix carries the full boundary', async () => {
    const m = await loadGuard();
    const prefix = m.buildBwrapPrefix({ maskArgs: [] });
    for (const flag of ['--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev',
      '--tmpfs', '/tmp', '--unshare-net', '--die-with-parent', '--new-session']) {
      expect(prefix).toContain(flag);
    }
    expect(prefix).toContain('--setenv');
    expect(prefix.indexOf('TMPDIR') - prefix.indexOf('--setenv')).toBeGreaterThanOrEqual(0);
  });

  it('dropping --unshare-net or --ro-bind changes the prefix (mutation control)', async () => {
    const m = await loadGuard();
    const full = m.buildWrappedCommand({ command: 'true', cwd: '/tmp', maskArgs: [] });
    expect(full).toContain('--unshare-net');
    expect(full).toContain('--ro-bind');
    const stripped = full.replace(`'--unshare-net' `, '').replace(`'--ro-bind' '/' '/' `, '');
    expect(stripped).not.toContain('--unshare-net');
  });

  it('buildWrappedCommand nests the command under bash -c with quoted cwd', async () => {
    const m = await loadGuard();
    const wrapped = m.buildWrappedCommand({ command: 'git diff', cwd: '/work/tree', maskArgs: ['--tmpfs', '/home/u/.ssh'] });
    expect(wrapped.startsWith("'bwrap'")).toBe(true);
    expect(wrapped).toContain(`'--chdir' '/work/tree'`);
    expect(wrapped).toContain(`'--' 'bash' '-c' 'git diff'`);
    expect(wrapped).toContain(`'--tmpfs' '/home/u/.ssh'`);
  });

  it('buildCredentialMaskArgs masks dirs with tmpfs and files with /dev/null, skipping absent paths', async () => {
    const m = await loadGuard();
    const hooks = {
      statSync: (p: string) => {
        if (p.endsWith('.ssh')) return { isDirectory: () => true };
        if (p.endsWith('.netrc')) return { isDirectory: () => false };
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
      readdirSync: () => [],
    };
    const args = await m.buildCredentialMaskArgs('/home/u', hooks);
    expect(args).toEqual(['--tmpfs', '/home/u/.ssh', '--ro-bind', '/dev/null', '/home/u/.netrc']);
    for (const p of m.CREDENTIAL_PATHS) {
      if (p !== '.ssh' && p !== '.netrc') expect(args.join(' ')).not.toContain(p);
    }
  });

  it('buildCredentialMaskArgs expands glob prefixes', async () => {
    const m = await loadGuard();
    const hooks = {
      statSync: fakeStat(false),
      readdirSync: (dir: string) => {
        if (dir.endsWith('.pi/agent')) return ['auth-token.json', 'other.txt'];
        if (dir.endsWith('.claude')) return ['.credentials-main'];
        return [];
      },
    };
    const args = await m.buildCredentialMaskArgs('/home/u', hooks);
    expect(args).toContain('/home/u/.pi/agent/auth-token.json');
    expect(args.join(' ')).not.toContain('other.txt');
    expect(args).toContain('/home/u/.claude/.credentials-main');
  });
});

describe('permission-guard fail-closed behavior', () => {
  beforeEach(() => {
    delete process.env.PI_SPECIALIST_PERMISSION_TIER;
  });

  it('blocks bash when the self-check has not passed', async () => {
    const m = await loadGuard();
    const fake = makeFakePi();
    m.default(fake);
    const event = { toolName: 'bash', input: { command: 'echo hi', cwd: '/tmp' } };
    let verdict: unknown;
    for (const h of fake.handlers.get('tool_call') ?? []) verdict = (await h(event)) ?? verdict;
    expect(verdict).toMatchObject({ block: true, reason: expect.stringContaining('self-check') });
    expect((event.input as { command: string }).command).toBe('echo hi');
  });

  it('wraps bash after a passing self-check, including nested codemode calls', async () => {
    const m = await loadGuard();
    await m.bwrapSelfCheck((_bin: string, _args: string[], _opts: unknown, cb: (e: null) => void) => cb(null));
    const fake = makeFakePi();
    m.default(fake);
    for (const event of [
      { toolName: 'bash', toolCallId: '1', input: { command: 'git diff', cwd: '/work' } },
      { toolName: 'bash', toolCallId: '9/3', parentToolCallId: '9', input: { command: 'ls', cwd: '/work' } },
    ]) {
      let verdict: unknown;
      for (const h of fake.handlers.get('tool_call') ?? []) verdict = (await h(event)) ?? verdict;
      expect(verdict).toBeUndefined();
      expect((event.input as { command: string }).command).toContain("'bwrap'");
      expect((event.input as { command: string }).command).toContain('--unshare-net');
    }
  });

  it('refuses non-READ_ONLY tiers when the channel names them', async () => {
    const m = await loadGuard();
    await m.bwrapSelfCheck((_bin: string, _args: string[], _opts: unknown, cb: (e: null) => void) => cb(null));
    process.env.PI_SPECIALIST_PERMISSION_TIER = 'LOW';
    try {
      const fake = makeFakePi();
      m.default(fake);
      const event = { toolName: 'bash', input: { command: 'echo hi', cwd: '/tmp' } };
      let verdict: unknown;
      for (const h of fake.handlers.get('tool_call') ?? []) verdict = (await h(event)) ?? verdict;
      expect(verdict).toMatchObject({ block: true, reason: expect.stringContaining('LOW') });
    } finally {
      delete process.env.PI_SPECIALIST_PERMISSION_TIER;
    }
  });

  it('ignores non-bash tools', async () => {
    const m = await loadGuard();
    const fake = makeFakePi();
    m.default(fake);
    const event = { toolName: 'read', input: { path: '/etc/hostname' } };
    let verdict: unknown;
    for (const h of fake.handlers.get('tool_call') ?? []) verdict = (await h(event)) ?? verdict;
    expect(verdict).toBeUndefined();
  });

  it('self-check failure records the detail and keeps blocking', async () => {
    const m = await loadGuard();
    const check = await m.bwrapSelfCheck((_b: string, _a: string[], _o: unknown, cb: (e: Error) => void) =>
      cb(new Error('bwrap: command not found')),
    );
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('command not found');
    expect(m.bashRefusalReason()).toContain('self-check failed');
  });
});
