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
  buildBwrapPrefix: (opts: { maskArgs: string[]; secretUnsetArgs?: string[] }) => string[];
  buildWrappedCommand: (opts: { command: string; cwd: string; maskArgs: string[]; bwrapBin?: string; secretEnv?: string[] }) => string;
  bwrapSelfCheck: (execFn?: unknown, fsHooks?: unknown) => Promise<{ checked: boolean; ok: boolean; detail: string; bwrapBin: string | null }>;
  resolveBwrapBin: (fsHooks?: unknown) => Promise<string | null>;
  secretEnvNames: (env: Record<string, string | undefined>) => string[];
  __resetSelfCheckForTest: () => void;
  tierRefusal: () => string | null;
  bashRefusalReason: () => string | null;
  CREDENTIAL_PATHS: string[];
  CREDENTIAL_GLOBS: string[];
};

// The fake pi passes ctx through to handlers, mirroring Pi's
// ExtensionHandler<Event> = (event, ctx: ExtensionContext) => ... — ctx.cwd
// is the session (worktree) cwd. input.cwd must NEVER decide the sandbox
// cwd: Pi's bash input schema is {command, timeout} only.
function makeCtx(cwd: string) {
  return { cwd };
}

async function loadGuard(): Promise<GuardModule> {
  const mod = (await import(pathToFileURL(join(GUARD_DIR, 'index.mjs')).href)) as GuardModule;
  mod.__resetSelfCheckForTest();
  return mod;
}

function makeFakePi() {
  const handlers = new Map<string, Array<(event: unknown, ctx?: unknown) => unknown>>();
  return {
    on: (name: string, handler: (event: unknown, ctx?: unknown) => unknown) => {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name)!.push(handler);
    },
    emit: async (name: string, event: unknown, ctx?: unknown) => {
      let verdict: unknown;
      for (const h of handlers.get(name) ?? []) verdict = (await h(event, ctx)) ?? verdict;
      return verdict;
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
      '--tmpfs', '/tmp', '--tmpfs', '/run', '--unshare-net', '--unshare-pid', '--unshare-ipc',
      '--cap-drop', 'ALL', '--die-with-parent', '--new-session']) {
      expect(prefix).toContain(flag);
    }
    expect(prefix).toContain('--setenv');
    expect(prefix.indexOf('TMPDIR') - prefix.indexOf('--setenv')).toBeGreaterThanOrEqual(0);
  });

  it('secretEnvNames strips token/key/secret vars, keeps the rest', async () => {
    const m = await loadGuard();
    expect(m.secretEnvNames({
      GH_TOKEN: 'x', AWS_SECRET_ACCESS_KEY: 'x', DB_PASSWORD: 'x', MY_AUTH: 'x',
      PATH: '/bin', HOME: '/h', PI_MODEL: 'm', HTTPS_PROXY: 'p',
    }).sort()).toEqual(['AWS_SECRET_ACCESS_KEY', 'DB_PASSWORD', 'GH_TOKEN', 'MY_AUTH']);
  });

  it('buildWrappedCommand emits secret --unsetenv pairs and the absolute bwrap path', async () => {
    const m = await loadGuard();
    const wrapped = m.buildWrappedCommand({
      command: 'env', cwd: '/work', maskArgs: [], bwrapBin: '/usr/bin/bwrap', secretEnv: ['GH_TOKEN'],
    });
    expect(wrapped.startsWith("'/usr/bin/bwrap'")).toBe(true);
    expect(wrapped).toContain(`'--unsetenv' 'GH_TOKEN'`);
  });

  it('resolveBwrapBin finds an executable, ignores non-executable entries', async () => {
    const m = await loadGuard();
    const bin = await m.resolveBwrapBin({
      path: { delimiter: ':', join: (...p: string[]) => p.join('/') },
      fs: { accessSync: (p: string) => { if (!p.endsWith('/good/bwrap')) throw new Error('ENOENT'); }, constants: { X_OK: 1 } },
      pathEnv: '/bad:/good',
    });
    expect(bin).toBe('/good/bwrap');
    expect(await m.resolveBwrapBin({
      path: { delimiter: ':', join: (...p: string[]) => p.join('/') },
      fs: { accessSync: () => { throw new Error('ENOENT'); }, constants: { X_OK: 1 } },
      pathEnv: '/empty',
    })).toBeNull();
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

  it('new credential masks cover gcloud, docker, git-credentials, glab and the whole .pi/agent dir', async () => {
    const m = await loadGuard();
    expect(m.CREDENTIAL_PATHS).toEqual(expect.arrayContaining([
      '.config/gcloud', '.docker', '.git-credentials', '.config/glab-cli',
    ]));
    expect(m.CREDENTIAL_GLOBS).toContain('.pi/agent*');
    const hooks = {
      statSync: () => ({ isDirectory: () => true }),
      readdirSync: (dir: string) => (dir.endsWith('.pi') ? ['agent'] : []),
    };
    const args = await m.buildCredentialMaskArgs('/home/u', hooks);
    expect(args).toContain('/home/u/.pi/agent');
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
        if (dir.endsWith('.pi')) return ['agent', 'other.txt'];
        if (dir.endsWith('.claude')) return ['.credentials-main'];
        return [];
      },
    };
    const args = await m.buildCredentialMaskArgs('/home/u', hooks);
    expect(args).toContain('/home/u/.pi/agent');
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
    const event = { toolName: 'bash', input: { command: 'echo hi' } };
    const verdict = await fake.emit('tool_call', event, makeCtx('/work'));
    expect(verdict).toMatchObject({ block: true, reason: expect.stringContaining('self-check') });
    expect((event.input as { command: string }).command).toBe('echo hi');
  });

  it('uses ctx.cwd (the session worktree), never input.cwd or process.cwd()', async () => {
    const m = await loadGuard();
    await m.bwrapSelfCheck((_bin: string, _args: string[], _opts: unknown, cb: (e: null) => void) => cb(null));
    const fake = makeFakePi();
    m.default(fake);
    // input.cwd is NOT part of Pi's bash schema — even when present it must not win.
    const event = { toolName: 'bash', toolCallId: '1', input: { command: 'pwd', cwd: '/decoy-input' } };
    const verdict = await fake.emit('tool_call', event, makeCtx('/real/worktree'));
    expect(verdict).toBeUndefined();
    const command = (event.input as { command: string }).command;
    expect(command).toContain(`'--chdir' '/real/worktree'`);
    expect(command).not.toContain('/decoy-input');
  });

  it('wraps bash after a passing self-check, including nested codemode calls', async () => {
    const m = await loadGuard();
    await m.bwrapSelfCheck((_bin: string, _args: string[], _opts: unknown, cb: (e: null) => void) => cb(null));
    const fake = makeFakePi();
    m.default(fake);
    for (const event of [
      { toolName: 'bash', toolCallId: '1', input: { command: 'git diff' } },
      { toolName: 'bash', toolCallId: '9/3', parentToolCallId: '9', input: { command: 'ls' } },
    ]) {
      const verdict = await fake.emit('tool_call', event, makeCtx('/work'));
      expect(verdict).toBeUndefined();
      const command = (event.input as { command: string }).command;
      // Absolute bwrap path from the self-check, never a PATH lookup.
      expect(command).toMatch(/^'\/[^']*bwrap'/);
      expect(command).not.toContain("'bwrap' '--ro-bind'");
      expect(command).toContain('--unshare-net');
    }
  });

  it('refuses non-READ_ONLY tiers when the channel names them', async () => {
    const m = await loadGuard();
    await m.bwrapSelfCheck((_bin: string, _args: string[], _opts: unknown, cb: (e: null) => void) => cb(null));
    process.env.PI_SPECIALIST_PERMISSION_TIER = 'LOW';
    try {
      const fake = makeFakePi();
      m.default(fake);
      const event = { toolName: 'bash', input: { command: 'echo hi' } };
      const verdict = await fake.emit('tool_call', event, makeCtx('/work'));
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
    const verdict = await fake.emit('tool_call', event, makeCtx('/work'));
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
