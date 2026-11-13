import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  changedDistPaths,
  evaluateBunSelection,
  isDirectInvocation,
  mismatchMessage,
  parseArgs,
  parseBunVersion,
  wrongBunMessage,
} from '../../../scripts/check-dist-reproducible.mjs';
import { tempDir } from '../../utils/temp-dir.js';

const GUARD = resolve(import.meta.dirname, '../../../scripts/check-dist-reproducible.mjs');

describe('dist reproducibility guard (SPECIALISTS-4445)', () => {
  describe('parseBunVersion', () => {
    it('reads a bare version', () => {
      expect(parseBunVersion('1.4.2')).toBe('1.4.2');
    });

    it('reads a version out of build metadata', () => {
      expect(parseBunVersion('1.4.2+0d1f8b6e4')).toBe('1.4.2');
    });

    it('strips surrounding whitespace from a pin file', () => {
      expect(parseBunVersion('1.4.2\n')).toBe('1.4.2');
    });

    it('returns undefined for noise instead of guessing', () => {
      expect(parseBunVersion('bun version unknown')).toBeUndefined();
      expect(parseBunVersion('')).toBeUndefined();
      expect(parseBunVersion(undefined)).toBeUndefined();
    });
  });

  describe('evaluateBunSelection', () => {
    it('accepts the running bun when it matches the pin', () => {
      expect(evaluateBunSelection({ pinned: '1.4.2', running: '1.4.2' }))
        .toEqual({ ok: true, useBinary: 'bun', errors: [] });
    });

    it('refuses the running bun when it differs from the pin', () => {
      // The exact real-world shape: the operator's global bun is 1.4.0, .bun-version pins 1.4.2.
      const result = evaluateBunSelection({ pinned: '1.4.2', running: '1.4.0' });
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toContain('the bun on PATH is 1.4.0');
      expect(result.errors.join(' ')).toContain('pins 1.4.2');
      // It must not silently fall back to the wrong bun: no binary may be handed to the build.
      expect(result.useBinary).toBeUndefined();
    });

    it('prefers an explicitly pinned binary over whatever is on PATH', () => {
      const result = evaluateBunSelection({
        pinned: '1.4.2',
        running: '1.4.0',
        pinnedBinary: '/tmp/bun142/bin/bun',
        pinnedBinaryVersion: '1.4.2',
      });
      expect(result).toEqual({ ok: true, useBinary: '/tmp/bun142/bin/bun', errors: [] });
    });

    it('refuses a pinned binary that is itself the wrong version', () => {
      // Naming a binary is not a promise it is the pinned one; a stale path must not pass.
      const result = evaluateBunSelection({
        pinned: '1.4.2',
        pinnedBinary: '/usr/local/bin/bun',
        pinnedBinaryVersion: '1.4.0',
      });
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toContain('reports bun 1.4.0');
    });

    it('refuses when no bun is available at all', () => {
      const result = evaluateBunSelection({ pinned: '1.4.2' });
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toContain('no bun on PATH');
    });

    it('refuses when the pin itself is missing', () => {
      const result = evaluateBunSelection({ pinned: undefined, running: '1.4.2' });
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toContain('.bun-version is missing');
    });
  });

  describe('changedDistPaths', () => {
    it('reads modified files and keeps the full path', () => {
      // Regression: an earlier version trimmed leading whitespace first, which shifted the
      // porcelain columns and dropped every path.
      expect(changedDistPaths(' M dist/index.js\0 M dist/lib.js\0')).toEqual(['dist/index.js', 'dist/lib.js']);
    });

    it('reads added, deleted and untracked entries', () => {
      expect(changedDistPaths('A  dist/new.js\0 D dist/old.js\0?? dist/types/x.d.ts\0'))
        .toEqual(['dist/new.js', 'dist/old.js', 'dist/types/x.d.ts']);
    });

    it('takes the new path of a rename', () => {
      // `-z` puts the original path in its own NUL-terminated field after the entry.
      expect(changedDistPaths('R  dist/b.js\0dist/a.js\0')).toEqual(['dist/b.js']);
    });

    it('ignores changes outside dist/', () => {
      expect(changedDistPaths(' M src/index.ts\0 M dist/index.js\0')).toEqual(['dist/index.js']);
    });

    it('reports nothing for a clean tree', () => {
      expect(changedDistPaths('')).toEqual([]);
      expect(changedDistPaths('\0')).toEqual([]);
    });

    it('reads NUL-separated entries verbatim, quotes and all', () => {
      // `-z` never quotes, so a name with a quote or an astral character arrives exactly as it is
      // on disk. The decoded-quoting design this replaced left such a file behind on restore.
      expect(changedDistPaths(' M dist/a"b.js\0')).toEqual(['dist/a"b.js']);
      expect(changedDistPaths('?? dist/a😀.js\0')).toEqual(['dist/a😀.js']);
    });

    it('reads rename entries by taking the new path and skipping the original', () => {
      expect(changedDistPaths('R  dist/new.js\0dist/old.js\0')).toEqual(['dist/new.js']);
    });

    it('reads several entries in one status', () => {
      expect(changedDistPaths(' M dist/a.js\0?? dist/b.js\0')).toEqual(['dist/a.js', 'dist/b.js']);
    });
  });

  describe('mismatchMessage', () => {
    const message = mismatchMessage({ pinned: '1.4.2', running: '1.4.2', files: ['dist/index.js', 'dist/lib.js'] });

    it('names the pinned version and the changed files', () => {
      expect(message).toContain('pinned bun 1.4.2');
      expect(message).toContain('dist/index.js, dist/lib.js');
    });

    it('names the actual symptom so the raw diff is not needed', () => {
      expect(message).toContain('__esm');
      expect(message).toContain('(fn, res, err) =>');
    });

    it('gives a copy-pasteable fix that does not upgrade the global bun', () => {
      expect(message).toContain('BUN_INSTALL=/tmp/bun142');
      expect(message).toContain('bun-v1.4.2');
      expect(message).toContain('PATH=/tmp/bun142/bin:$PATH');
      expect(message).toContain('--write');
      expect(message).not.toContain('bun upgrade');
    });

    it('warns that PATH — not just the outer invocation — must be pinned', () => {
      expect(message).toContain('shells out to `bun`');
    });

    it('counts the files it did not list', () => {
      const many = Array.from({ length: 12 }, (_, i) => `dist/f${i}.js`);
      expect(mismatchMessage({ pinned: '1.4.2', running: '1.4.2', files: many })).toContain('(+4 more)');
    });
  });

  describe('wrongBunMessage', () => {
    const message = wrongBunMessage({ pinned: '1.4.2', running: '1.4.0', errors: ['the bun on PATH is 1.4.0 but .bun-version pins 1.4.2'] });

    it('carries the refusal and the pinned install', () => {
      expect(message).toContain('the bun on PATH is 1.4.0');
      expect(message).toContain('BUN_INSTALL=/tmp/bun142');
      expect(message).toContain('SPECIALISTS_PINNED_BUN');
    });
  });

  describe('isDirectInvocation', () => {
    // The Node < 24.2 fallback: `import.meta.main` is undefined there, and a false negative means a
    // green guard that checked nothing.
    it('prefers import.meta.main when the runtime provides it', () => {
      expect(isDirectInvocation(true, '/somewhere/else.mjs', 'file:///guard.mjs')).toBe(true);
      expect(isDirectInvocation(false, '/abs/guard.mjs', 'file:///abs/guard.mjs')).toBe(false);
    });

    it('falls back to comparing the module URL with argv[1]', () => {
      expect(isDirectInvocation(undefined, '/abs/guard.mjs', 'file:///abs/guard.mjs')).toBe(true);
      expect(isDirectInvocation(undefined, '/abs/other.mjs', 'file:///abs/guard.mjs')).toBe(false);
    });

    it('returns false when there is no argv[1] at all', () => {
      expect(isDirectInvocation(undefined, undefined, 'file:///abs/guard.mjs')).toBe(false);
      expect(isDirectInvocation(undefined, '', 'file:///abs/guard.mjs')).toBe(false);
    });
  });

  describe('parseArgs', () => {
    it('defaults to check-only in the working directory', () => {
      const parsed = parseArgs([]);
      expect(parsed.write).toBe(false);
      expect(parsed.json).toBe(false);
      expect(parsed.cwd).toBe(process.cwd());
    });

    it('accepts --write and --json', () => {
      expect(parseArgs(['--write', '--json'])).toMatchObject({ write: true, json: true });
    });

    it('resolves --cwd', () => {
      expect(parseArgs(['--cwd', '/tmp']).cwd).toBe('/tmp');
    });

    it('rejects an unknown flag rather than ignoring it', () => {
      expect(() => parseArgs(['--allow-anything'])).toThrow(/unknown argument/);
    });

    it('rejects --cwd without a value', () => {
      expect(() => parseArgs(['--cwd'])).toThrow(/requires a path/);
    });
  });
});

/**
 * End-to-end coverage of `main()` — the four claims the PR makes (refusal exit 1, restore on
 * mismatch, keep on --write, and the pre-existing-rebuild warning) were only verified by hand
 * before this suite existed, which the REVIEW named as the coverage gap.
 *
 * A fake pinned bun keeps it honest and hermetic: it answers `--version` with the pin and, for
 * `run build`, copies a fixture over dist/index.js. No real build, no network, no operator bun.
 */
describe('CLI end to end (main)', () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function git(cwd: string, ...args: string[]): string {
    const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout;
  }

  /** A temp repo with a committed dist/ and a fake bun that writes `built` on `run build`. */
  function fixture(committed: string, built: string) {
    const root = tempDir('dist-guard-');
    dirs.push(root);
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'dist'), { recursive: true });
    writeFileSync(join(repo, 'dist', 'index.js'), committed);
    writeFileSync(join(repo, '.bun-version'), '1.4.2\n');
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'guard@example.test');
    git(repo, 'config', 'user.name', 'guard');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'init');

    const buildOutput = join(root, 'built.js');
    writeFileSync(buildOutput, built);
    const bun = join(root, 'bin', 'bun');
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(
      bun,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.4.2; exit 0; fi\ncp "${buildOutput}" "$PWD/dist/index.js"\n`,
    );
    chmodSync(bun, 0o755);
    return { repo, bun };
  }

  function runGuard(repo: string, bun: string, ...args: string[]) {
    const result = spawnSync(process.execPath, [GUARD, '--cwd', repo, ...args], {
      cwd: repo,
      encoding: 'utf-8',
      env: { ...process.env, SPECIALISTS_PINNED_BUN: bun },
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  }

  it('exits 0 when the committed bundle is what the pinned bun builds', () => {
    const { repo, bun } = fixture('committed\n', 'committed\n');
    const { status, out } = runGuard(repo, bun);
    expect(status).toBe(0);
    expect(out).toContain('a fresh build changed nothing');
  });

  it('exits 1 and restores the tree when the build differs from the committed bundle', () => {
    const { repo, bun } = fixture('committed\n', 'rebuilt\n');
    const { status, out } = runGuard(repo, bun);
    expect(status).toBe(1);
    expect(out).toContain('dist/index.js');
    expect(out).toContain('Restored your dist/');
    // The check must not leave the rebuild behind: the worker's next commit stays reviewable.
    expect(readFileSync(join(repo, 'dist', 'index.js'), 'utf-8')).toBe('committed\n');
    expect(git(repo, 'status', '--porcelain', '--', 'dist/')).toBe('');
  });

  it('exits 0 with --write and keeps the rebuild, so a fix loop can chain it', () => {
    const { repo, bun } = fixture('committed\n', 'rebuilt\n');
    const { status, out } = runGuard(repo, bun, '--write');
    expect(status).toBe(0);
    expect(out).toContain('leaving the rebuilt dist/ in place');
    expect(readFileSync(join(repo, 'dist', 'index.js'), 'utf-8')).toBe('rebuilt\n');
    expect(git(repo, 'status', '--porcelain', '--', 'dist/')).toContain('dist/index.js');
  });

  it('warns when it replaced a rebuild that was already in the working tree', () => {
    // The reproduction of the REVIEW's silent-loss finding: dist/ carries an uncommitted rebuild
    // that the fresh build overwrites with the committed bytes. Exit 0 is correct — the tree now
    // matches the committed bundle — but losing the worker's work without a word is not.
    const { repo, bun } = fixture('committed\n', 'committed\n');
    writeFileSync(join(repo, 'dist', 'index.js'), 'worker rebuild\n');
    const { status, out } = runGuard(repo, bun);
    expect(status).toBe(0);
    expect(out).toContain('had uncommitted changes before this check');
    expect(readFileSync(join(repo, 'dist', 'index.js'), 'utf-8')).toBe('committed\n');
  });

  it('removes a build artefact whose name git would have to quote', () => {
    // The restore compares paths from `git status` with paths from `git ls-files`; a name containing
    // a double quote is quoted in every non -z form, so the old comparison missed it and left the
    // file in a tree it had just called restored.
    const root = tempDir('dist-guard-quote-');
    dirs.push(root);
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'dist'), { recursive: true });
    writeFileSync(join(repo, 'dist', 'index.js'), 'committed\n');
    writeFileSync(join(repo, '.bun-version'), '1.4.2\n');
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'guard@example.test');
    git(repo, 'config', 'user.name', 'guard');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'init');
    const bun = join(root, 'bin', 'bun');
    mkdirSync(join(root, 'bin'), { recursive: true });
    writeFileSync(bun, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.4.2; exit 0; fi\ntouch \'dist/a"b.js\'\n');
    chmodSync(bun, 0o755);

    const { status } = runGuard(repo, bun);
    expect(status).toBe(1);
    expect(git(repo, 'status', '--porcelain', '-uall', '--', 'dist/')).toBe('');
  });

  it('refuses to build with a bun that is not the pinned one', () => {
    const { repo } = fixture('committed\n', 'rebuilt\n');
    const wrong = join(repo, 'bin-wrong-bun');
    writeFileSync(wrong, '#!/bin/sh\necho 1.4.0\n');
    chmodSync(wrong, 0o755);
    const { status, out } = runGuard(repo, wrong);
    expect(status).toBe(1);
    expect(out).toContain('pins 1.4.2');
  });
});
