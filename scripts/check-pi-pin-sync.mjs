/**
 * Pin-sync check for the image's pi version (SPECIALISTS-4438).
 *
 * Three declarations describe the same thing: `ARG PI_VERSION` in the Dockerfile (what the image
 * installs), `@earendil-works/pi-tui` in package.json (the pi release train this repository builds
 * against; pi and pi-tui are released in lockstep), and the peer range in the extension manifest
 * (what the extension claims to support). They drifted before: the image tracked `latest` while the
 * sources declared `^0.99.0`, so the image could ship a pi the sources never claimed.
 *
 * Usage:
 *   node scripts/check-pi-pin-sync.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {object} PinSyncInputs
 * @property {string | undefined} dockerfilePin
 * @property {string | undefined} declaredVersion
 * @property {string | undefined} peerRange
 */

/**
 * @typedef {object} PinSyncResult
 * @property {boolean} ok
 * @property {readonly string[]} errors
 */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Compare two release cores; returns <0, 0, >0. Prerelease/build metadata is ignored on purpose. */
/** @param {string} a @param {string} b @returns {number} */
export function compareVersions(a, b) {
  const left = SEMVER.exec(a);
  const right = SEMVER.exec(b);
  if (!left || !right) return Number.NaN;
  for (let i = 1; i <= 3; i += 1) {
    const diff = Number(left[i]) - Number(right[i]);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Minimal semver range check for the shapes this repository uses: `*`, an exact version, `^x.y.z`
 * and `>=x.y.z <x.y.z`. Anything else is reported as unsupported rather than silently accepted,
 * because a range we cannot read cannot prove anything.
 */
/** @param {string} version @param {string} range @returns {boolean | undefined} */
export function satisfies(version, range) {
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*' || trimmed === 'latest') return true;
  if (SEMVER.test(trimmed)) return compareVersions(version, trimmed) === 0;

  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (caret) {
    const [, major, minor, patch] = caret.map(Number);
    const lower = `${major}.${minor}.${patch}`;
    const upper = major > 0 ? `${major + 1}.0.0` : `0.${minor + 1}.0`;
    return compareVersions(version, lower) >= 0 && compareVersions(version, upper) < 0;
  }

  const bounded = /^>=(\d+\.\d+\.\d+)\s+<(\d+\.\d+\.\d+)$/.exec(trimmed);
  if (bounded) {
    return compareVersions(version, bounded[1]) >= 0 && compareVersions(version, bounded[2]) < 0;
  }

  return undefined;
}

/**
 * @param {PinSyncInputs} inputs
 * @returns {PinSyncResult}
 */
export function checkPinSync(inputs) {
  /** @type {string[]} */
  const errors = [];
  if (!inputs.dockerfilePin) {
    errors.push('Dockerfile has no ARG PI_VERSION');
  } else if (!SEMVER.test(inputs.dockerfilePin)) {
    errors.push(`Dockerfile ARG PI_VERSION is not a pinned semver version: ${inputs.dockerfilePin}`);
  }

  if (!inputs.declaredVersion) {
    errors.push('package.json does not declare @earendil-works/pi-tui');
  } else if (inputs.dockerfilePin && SEMVER.test(inputs.dockerfilePin)
    && compareVersions(inputs.dockerfilePin, inputs.declaredVersion) !== 0) {
    errors.push(
      `Dockerfile ARG PI_VERSION (${inputs.dockerfilePin}) does not match the declared pi version `
      + `@earendil-works/pi-tui (${inputs.declaredVersion})`,
    );
  }

  if (!inputs.peerRange) {
    errors.push('the extension manifest does not declare the pi-coding-agent peer range');
  } else if (inputs.declaredVersion) {
    const admitted = satisfies(inputs.declaredVersion, inputs.peerRange);
    if (admitted === undefined) {
      errors.push(`unsupported peer range for the check: ${inputs.peerRange}`);
    } else if (!admitted) {
      errors.push(
        `the declared pi version (${inputs.declaredVersion}) is outside the extension peer range `
        + `"${inputs.peerRange}"`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function main() {
  const root = process.cwd();
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf-8');
  const pin = /^ARG PI_VERSION=([^\s#]+)/m.exec(dockerfile)?.[1];
  const pkg = readJson(join(root, 'package.json'));
  const dependencies = /** @type {Record<string, string>} */ (pkg.dependencies ?? {});
  const extension = readJson(join(root, 'config/pi-extensions/native-specialists/package.json'));
  const peers = /** @type {Record<string, string>} */ (extension.peerDependencies ?? {});

  const result = checkPinSync({
    dockerfilePin: pin,
    declaredVersion: dependencies['@earendil-works/pi-tui'],
    peerRange: peers['@earendil-works/pi-coding-agent'],
  });

  if (!result.ok) {
    for (const error of result.errors) console.error(`::error title=pi pin sync::${error}`);
    process.exit(1);
  }
  console.log(`pi pin in sync: Dockerfile ${pin}, declared ${dependencies['@earendil-works/pi-tui']}, `
    + `peer "${peers['@earendil-works/pi-coding-agent']}"`);
}

if (import.meta.main) main();
