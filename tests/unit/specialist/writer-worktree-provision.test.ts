import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DispatchRejectedError } from '../../../src/activation/types.js';
import { provisionWriterWorkspace } from '../../../src/activation/workspace-lease.js';

/** SPECIALISTS-4393: writer worktrees live under .xtrm/worktrees and branch from origin/<default>. */

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const run = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf-8' }).trim();

function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wt-provision-')));
  dirs.push(dir);
  return dir;
}

/** A clone whose local HEAD is one commit behind origin/main, with the extra commit only on the remote. */
function cloneBehindRemote(): { clone: string; remoteTip: string; localHead: string } {
  const root = scratch();
  const bare = join(root, 'remote.git');
  const seed = join(root, 'seed');
  const clone = join(root, 'myrepo');
  mkdirSync(seed);
  run(root, 'init', '-q', '--bare', '-b', 'main', bare);
  run(seed, 'init', '-q', '-b', 'main');
  run(seed, 'commit', '-q', '--allow-empty', '-m', 'one');
  run(seed, 'remote', 'add', 'origin', bare);
  run(seed, 'push', '-q', 'origin', 'main');
  run(root, 'clone', '-q', bare, clone);
  run(seed, 'commit', '-q', '--allow-empty', '-m', 'two');
  run(seed, 'push', '-q', 'origin', 'main');
  return { clone, remoteTip: run(seed, 'rev-parse', 'HEAD'), localHead: run(clone, 'rev-parse', 'HEAD') };
}

describe('provisionWriterWorkspace', () => {
  it('creates <repo>-sp-<role>-<slug> under .xtrm/worktrees from the fetched origin default branch', () => {
    const { clone, remoteTip, localHead } = cloneBehindRemote();
    expect(remoteTip).not.toBe(localHead);

    const ws = provisionWriterWorkspace(clone, 'CORE-2513', 'executor');

    expect(ws.worktreePath).toBe(join(clone, '.xtrm', 'worktrees', `${basename(clone)}-sp-executor-core-2513`));
    expect(ws.branch).toBe('sp/core-2513');
    expect(run(ws.worktreePath, 'rev-parse', 'HEAD')).toBe(remoteTip);
  });

  it('keeps .xtrm/worktrees out of the dispatcher status without touching tracked files', () => {
    const { clone } = cloneBehindRemote();
    provisionWriterWorkspace(clone, 'CORE-2513', 'executor');
    expect(run(clone, 'status', '--porcelain')).toBe('');
  });

  it('reuses a worktree already on sp/<slug> at the legacy .worktrees root', () => {
    const { clone } = cloneBehindRemote();
    const legacy = join(clone, '.worktrees', 'core-9');
    run(clone, 'worktree', 'add', '-q', '-b', 'sp/core-9', legacy, 'HEAD');

    const ws = provisionWriterWorkspace(clone, 'CORE-9', 'executor');

    expect(ws.worktreePath).toBe(legacy);
    expect(ws.created).toBe(false);
    expect(existsSync(join(clone, '.xtrm', 'worktrees'))).toBe(false);
  });

  it('reuses its own new-root worktree on a second call', () => {
    const { clone } = cloneBehindRemote();
    const first = provisionWriterWorkspace(clone, 'CORE-5', 'executor');
    const second = provisionWriterWorkspace(clone, 'CORE-5', 'reviewer');
    expect(second.worktreePath).toBe(first.worktreePath);
    expect(second.created).toBe(false);
  });

  it('falls back to HEAD with a warning when there is no remote', () => {
    const repo = join(scratch(), 'solo');
    mkdirSync(repo);
    run(repo, 'init', '-q', '-b', 'main');
    run(repo, 'commit', '-q', '--allow-empty', '-m', 'one');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ws = provisionWriterWorkspace(repo, 'CORE-7', 'executor');

    expect(run(ws.worktreePath, 'rev-parse', 'HEAD')).toBe(run(repo, 'rev-parse', 'HEAD'));
    expect(ws.worktreePath).toBe(join(repo, '.xtrm', 'worktrees', 'solo-sp-executor-core-7'));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('uses the remote real HEAD (master) when origin/HEAD is unset locally and main also exists', () => {
    const root = scratch();
    const bare = join(root, 'remote.git');
    const seed = join(root, 'seed');
    const local = join(root, 'localrepo');
    mkdirSync(seed);
    mkdirSync(local);
    run(root, 'init', '-q', '--bare', '-b', 'master', bare);
    run(seed, 'init', '-q', '-b', 'main');
    run(seed, 'commit', '-q', '--allow-empty', '-m', 'main-tip');
    run(seed, 'checkout', '-q', '-b', 'master');
    run(seed, 'commit', '-q', '--allow-empty', '-m', 'master-tip');
    run(seed, 'remote', 'add', 'origin', bare);
    run(seed, 'push', '-q', 'origin', 'main', 'master');
    const masterTip = run(seed, 'rev-parse', 'master');
    expect(masterTip).not.toBe(run(seed, 'rev-parse', 'main'));
    run(local, 'init', '-q', '-b', 'main');
    run(local, 'remote', 'add', 'origin', bare);
    run(local, 'fetch', '-q', 'origin');
    // Newer git creates origin/HEAD on fetch; the scenario under test is a checkout without it.
    spawnSync('git', ['remote', 'set-head', 'origin', '-d'], { cwd: local });
    expect(spawnSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: local }).status).not.toBe(0);
    run(local, 'commit', '-q', '--allow-empty', '-m', 'local');

    const ws = provisionWriterWorkspace(local, 'CORE-8', 'executor');

    expect(run(ws.worktreePath, 'rev-parse', 'HEAD')).toBe(masterTip);
  });

  it('refuses with workspace_isolation_unavailable and leaves no worktree or branch when the fetch fails', () => {
    const repo = join(scratch(), 'broken');
    mkdirSync(repo);
    run(repo, 'init', '-q', '-b', 'main');
    run(repo, 'commit', '-q', '--allow-empty', '-m', 'one');
    run(repo, 'remote', 'add', 'origin', join(repo, 'no-such-remote.git'));

    let error: unknown;
    try {
      provisionWriterWorkspace(repo, 'CORE-6', 'executor');
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(DispatchRejectedError);
    expect((error as DispatchRejectedError).reason).toBe('workspace_isolation_unavailable');
    expect(existsSync(join(repo, '.xtrm', 'worktrees'))).toBe(false);
    expect(run(repo, 'branch', '--list', 'sp/core-6')).toBe('');
  });
});
