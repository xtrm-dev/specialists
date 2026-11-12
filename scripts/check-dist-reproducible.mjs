/**
 * Dist reproducibility guard (SPECIALISTS-4445).
 *
 * `payload-contract` and `packed-smoke` rebuild `dist/` with the bun pinned in `.bun-version` and
 * then require `git diff --exit-code -- dist/`. A bundle built with a different bun is not that
 * bundle: 1.4.0 emits `var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res)` where 1.4.2
 * emits `var __esm = (fn, res, err) => () => {`, and the two retain different `exports_*` helper
 * blocks. Three PRs in a row (#553, #554, #556) failed on it, and each worker rediscovered the
 * cause from a raw diff.
 *
 * So this script does what CI does, locally, and says what the raw diff never did: which bun built
 * the committed bundle, which bun the repository pins, and the one command that fixes it without
 * touching the operator's global bun.
 *
 * Usage:
 *   node scripts/check-dist-reproducible.mjs           # check; restores dist/ when it differs
 *   node scripts/check-dist-reproducible.mjs --write   # keep the rebuilt dist/ (that is the fix)
 *   node scripts/check-dist-reproducible.mjs --json    # machine-readable result
 *
 * Exit codes: 0 reproducible or (with --write) rebuilt, 1 not reproducible / wrong bun, 2 usage.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The pin file is the single source of truth; CI's setup-bun step reads the same value. */
export const PIN_FILE = '.bun-version';

/** Env override for a pinned bun binary, so a contributor never has to change their global bun. */
export const PINNED_BUN_ENV = 'SPECIALISTS_PINNED_BUN';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)/;

/**
 * Extract a release version from `bun --version` output or a pin file.
 * @param {string | undefined | null} text
 * @returns {string | undefined}
 */
export function parseBunVersion(text) {
  if (!text) return undefined;
  const match = SEMVER.exec(text.trim());
  return match ? match[0] : undefined;
}

/**
 * Decide which bun may build the bundle.
 *
 * The operator's global bun is never upgraded and never assumed correct: a mismatch is a refusal
 * that names the pinned binary route, not a silent fallback to whatever version happens to be on
 * PATH (a silent fallback would reproduce the exact bug this guard exists to stop).
 *
 * @param {{ pinned?: string, running?: string, pinnedBinary?: string, pinnedBinaryVersion?: string }} input
 * @returns {{ ok: boolean, useBinary?: string, errors: string[] }}
 */
export function evaluateBunSelection(input) {
  const errors = [];
  if (!input.pinned) {
    errors.push(`no bun pin: ${PIN_FILE} is missing or does not name a version`);
    return { ok: false, errors };
  }

  if (input.pinnedBinary) {
    if (input.pinnedBinaryVersion === input.pinned) {
      return { ok: true, useBinary: input.pinnedBinary, errors: [] };
    }
    errors.push(
      `${PINNED_BUN_ENV} (${input.pinnedBinary}) reports bun ${input.pinnedBinaryVersion ?? '<unknown>'}, `
      + `but ${PIN_FILE} pins ${input.pinned}`,
    );
    return { ok: false, errors };
  }

  if (!input.running) {
    errors.push('no bun on PATH: cannot rebuild dist/');
    return { ok: false, errors };
  }
  if (input.running !== input.pinned) {
    errors.push(
      `the bun on PATH is ${input.running} but ${PIN_FILE} pins ${input.pinned}`,
    );
    return { ok: false, errors };
  }
  return { ok: true, useBinary: 'bun', errors: [] };
}

/**
 * The message a worker needs to act on, without reading the bundle diff.
 *
 * @param {{ pinned: string, running?: string, files: readonly string[] }} input
 * @returns {string}
 */
export function mismatchMessage(input) {
  const fileList = input.files.length > 0 ? input.files.slice(0, 8).join(', ') : 'dist/';
  const more = input.files.length > 8 ? ` (+${input.files.length - 8} more)` : '';
  return [
    `dist/ is not reproducible with the pinned bun ${input.pinned}.`,
    `A fresh build with bun ${input.pinned} differs from the committed bundle; changed: ${fileList}${more}.`,
    'This is usually the __esm wrapper: 1.4.0 emits "(fn, res) => () => (…)" where 1.4.2 emits "(fn, res, err) => () => {".',
    'Fix without touching your global bun:',
    `  curl -fsSL https://bun.sh/install | BUN_INSTALL=/tmp/bun${input.pinned.replaceAll('.', '')} bash -s "bun-v${input.pinned}"`,
    `  PATH=/tmp/bun${input.pinned.replaceAll('.', '')}/bin:$PATH node scripts/check-dist-reproducible.mjs --write`,
    'PATH matters: the build shells out to `bun` for the nested builds, so the pinned binary must come first.',
    'Then commit dist/ in its own toolchain-only commit, so the source change stays reviewable.',
  ].join('\n');
}

/**
 * A wrong-bun refusal, in the same actionable shape as a dist mismatch.
 *
 * @param {{ pinned: string, running?: string, errors: readonly string[] }} input
 * @returns {string}
 */
export function wrongBunMessage(input) {
  const installDir = `/tmp/bun${input.pinned.replaceAll('.', '')}`;
  return [
    ...input.errors,
    `Refusing to build: a bundle built by the wrong bun is exactly what makes payload-contract red.`,
    'Rebuild with the pinned binary (this does not upgrade any global install):',
    `  curl -fsSL https://bun.sh/install | BUN_INSTALL=${installDir} bash -s "bun-v${input.pinned}"`,
    `  PATH=${installDir}/bin:$PATH node scripts/check-dist-reproducible.mjs --write`,
    `Or point ${PINNED_BUN_ENV} at an existing bun ${input.pinned} binary.`,
  ].join('\n');
}

/**
 * Paths under dist/ that a fresh build changed or added, from `git status --porcelain -uall`.
 *
 * @param {string} statusOutput
 * @returns {string[]}
 */
export function changedDistPaths(statusOutput) {
  return statusOutput
    .split('\n')
    // Trailing whitespace only: porcelain encodes the index/worktree state in the FIRST two
    // columns, so trimming the leading space shifts every path by one and silently drops them.
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.length > 3)
    // Renames carry "old -> new"; the new path is what a worker has to look at.
    .map((line) => (line.includes(' -> ') ? line.slice(line.indexOf(' -> ') + 4) : line.slice(3)))
    .map((path) => path.replace(/^"|"$/g, '').trim())
    .filter((path) => path === 'dist' || path.startsWith('dist/'));
}

/**
 * @param {string[]} args
 * @returns {{ write: boolean, json: boolean, cwd: string }}
 */
export function parseArgs(args) {
  const parsed = { write: false, json: false, cwd: process.cwd() };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--write') parsed.write = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--cwd') {
      const value = args[i + 1];
      if (!value) throw new Error('--cwd requires a path');
      parsed.cwd = resolve(value);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      throw new Error('usage');
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

/** @param {string} cwd @param {string[]} args */
function run(cwd, args, env = process.env) {
  return spawnSync(args[0], args.slice(1), { cwd, encoding: 'utf-8', env });
}

/** @param {string} cwd */
function readDistStatus(cwd) {
  const result = run(cwd, ['git', 'status', '--porcelain', '-uall', '--', 'dist/']);
  if (result.status !== 0) {
    throw new Error(`git status failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/** @param {string} cwd @param {readonly string[]} paths */
function restoreDist(cwd, paths) {
  // Tracked files go back to HEAD; only files THIS build created are removed, so a worker's own
  // uncommitted work is never deleted by a check.
  run(cwd, ['git', 'checkout', '--', 'dist/']);
  const untracked = run(cwd, ['git', 'ls-files', '--others', '--exclude-standard', '--', 'dist/']).stdout
    .split('\n').map((line) => line.trim()).filter(Boolean);
  for (const path of untracked) {
    if (paths.includes(path)) run(cwd, ['rm', '-f', '--', path]);
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'usage') {
      console.log('usage: node scripts/check-dist-reproducible.mjs [--write] [--json] [--cwd <path>]');
      return 0;
    }
    console.error(`::error title=dist reproducible::${message}`);
    return 2;
  }

  const cwd = options.cwd;
  const pinPath = join(cwd, PIN_FILE);
  if (!existsSync(pinPath)) {
    console.error(`::error title=dist reproducible::no ${PIN_FILE} in ${cwd}`);
    return 1;
  }
  const pinned = parseBunVersion(readFileSync(pinPath, 'utf-8'));
  const pinnedBinary = process.env[PINNED_BUN_ENV];
  const pinnedBinaryVersion = pinnedBinary
    ? parseBunVersion(run(cwd, [pinnedBinary, '--version']).stdout || '')
    : undefined;
  const runningProbe = pinnedBinary
    ? { stdout: '', status: 0 }
    : run(cwd, ['bun', '--version']);
  const running = pinnedBinary
    ? undefined
    : parseBunVersion(runningProbe.stdout || '');

  const selection = evaluateBunSelection({ pinned, running, pinnedBinary, pinnedBinaryVersion });
  if (!selection.ok) {
    const message = wrongBunMessage({ pinned: pinned ?? '<unset>', running, errors: selection.errors });
    if (options.json) {
      console.log(JSON.stringify({ ok: false, reason: 'wrong_bun', pinned, running, errors: selection.errors }));
    } else {
      for (const error of selection.errors) console.error(`::error title=dist reproducible::${error}`);
      console.error(message);
    }
    return 1;
  }

  const binary = /** @type {string} */ (selection.useBinary);
  // The build shells out to `bun` for its nested invocations, so the pinned binary must be first on
  // PATH — pinning only the outer process silently builds half the bundle with the wrong bun.
  const env = { ...process.env, NODE_ENV: 'test' };
  if (binary !== 'bun') {
    const dir = dirname(binary);
    env.PATH = `${dir}:${env.PATH ?? ''}`;
  }

  const before = readDistStatus(cwd);
  const build = run(cwd, [binary, 'run', 'build'], env);
  if (build.status !== 0) {
    console.error('::error title=dist reproducible::the build failed; fix the build before checking dist/');
    console.error(build.stdout ?? '');
    console.error(build.stderr ?? '');
    return 1;
  }

  const after = readDistStatus(cwd);
  const files = changedDistPaths(after);

  if (files.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ ok: true, pinned, running: running ?? pinned, files: [] }));
    } else {
      console.log(`dist/ is reproducible with bun ${pinned}: a fresh build changed nothing.`);
    }
    return 0;
  }

  const message = mismatchMessage({ pinned: /** @type {string} */ (pinned), running: running ?? pinned, files });
  if (options.json) {
    console.log(JSON.stringify({ ok: false, reason: 'not_reproducible', pinned, running, files }));
  } else {
    console.error(`::error title=dist reproducible::dist/ differs from a fresh bun ${pinned} build (${files.length} path(s))`);
    console.error(message);
  }

  if (options.write) {
    if (!options.json) console.error('\n--write: leaving the rebuilt dist/ in place. Review and commit it.');
  } else {
    restoreDist(cwd, files);
    if (!options.json) {
      console.error('\nRestored your dist/ so this check did not modify the tree. Re-run with --write to keep the rebuild.');
    }
    if (before.trim() !== '' && !options.json) {
      console.error('Note: dist/ already had changes before this check; they were restored with it.');
    }
  }
  return 1;
}

if (import.meta.main) process.exit(main());
