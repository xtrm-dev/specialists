/**
 * Dist reproducibility guard (SPECIALISTS-4445).
 *
 * `payload-contract` and `packed-smoke` rebuild `dist/` with the bun pinned in `.bun-version` and
 * then require `git diff --exit-code -- dist/`. A bundle built with a different bun is not that
 * bundle: 1.4.0 emits `var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res)` where 1.4.2
 * emits `var __esm = (fn, res, err) => () => {`, and the two retain different `exports_*` helper
 * blocks. Two PRs in a row (#553, #554) failed on it, and each worker rediscovered the cause from
 * a raw diff.
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
import { pathToFileURL } from 'node:url';

/**
 * The pin the guard builds with. `.bun-version` is the source this script reads; the workflows pass
 * the same version to `setup-bun` as a literal, and `toolchain-pin.yml` ties those literals to
 * `package.json` `packageManager`. Three pins, one value — change them together.
 */
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
  const entries = statusOutput.split('\0');
  const paths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    // `-z` emits "XY <path>" per entry and, for a rename or copy, the ORIGINAL path as the next
    // NUL-terminated field. Only the new path is a path a worker has to look at.
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (status.includes('R') || status.includes('C')) index += 1;
  }
  return paths.filter((path) => path === 'dist' || path.startsWith('dist/'));
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
  // `-z` is the only form with no quoting: git cannot escape a path it never quotes. Parsing the
  // escaped form was fragile (`"` and tab still get quoted under core.quotePath=false, and decoding
  // octet by octet broke astral characters), so the paths are read NUL-separated instead.
  const result = run(cwd, ['git', 'status', '--porcelain', '-z', '-uall', '--', 'dist/']);
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
  const untracked = run(cwd, ['git', 'ls-files', '-z', '--others', '--exclude-standard', '--', 'dist/']).stdout
    .split('\0').filter(Boolean);
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
      console.log(JSON.stringify({ ok: true, pinned, running: running ?? pinned, files: [], overwritten: before.trim() !== '' }));
    } else {
      console.log(`dist/ is reproducible with bun ${pinned}: a fresh build changed nothing.`);
      // A clean verdict is not the same as "nothing was there": if dist/ carried uncommitted work,
      // this build replaced it with the committed content. Say so, or a worker who rebuilt before
      // re-checking loses that rebuild and commits src/ without it.
      if (before.trim() !== '') {
        console.error(
          '\nNote: dist/ had uncommitted changes before this check and the fresh build replaced them. ' +
            'If you wanted to keep that rebuild, it is gone: rebuild and commit dist/ in the same change.',
        );
      }
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
    // --write asked for the rebuild; producing it is the success this mode reports. Exit 1 here
    // would break `check:dist-reproducible --write && git commit ...` for the exact worker the flag
    // exists to help.
    return 0;
  }

  restoreDist(cwd, files);
  if (!options.json) {
    console.error('\nRestored your dist/ so this check did not modify the tree. Re-run with --write to keep the rebuild.');
    if (before.trim() !== '') {
      console.error('Note: dist/ already had changes before this check; they were restored with it.');
    }
  }
  return 1;
}

/**
 * Whether this module is the entry point.
 *
 * `import.meta.main` only exists on Node >= 24.2. Without the fallback, an older Node evaluates this
 * module, skips main() and exits 0 — a green guard that checked nothing, which is the one failure
 * mode this script must not have. Exported so that fallback is pinned by a test rather than by the
 * Node version the test happens to run on.
 *
 * @param {boolean | undefined} metaMain
 * @param {string | undefined} argv1
 * @param {string} moduleUrl
 * @returns {boolean}
 */
export function isDirectInvocation(metaMain, argv1, moduleUrl) {
  if (typeof metaMain === 'boolean') return metaMain;
  if (argv1 === undefined || argv1 === '') return false;
  return moduleUrl === pathToFileURL(argv1).href;
}

if (isDirectInvocation(import.meta.main, process.argv[1], import.meta.url)) process.exit(main());
