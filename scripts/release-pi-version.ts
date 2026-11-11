/**
 * Resolve the pi version a release is attested against (SPECIALISTS-4429).
 *
 * The attestation generator records `pi_runtime.version_or_range` and refuses when PI_VERSION
 * is missing, but nothing in the release path ever set it — so 4.2.0 needed a hand-supplied
 * value on the command line. This module derives it and fails closed, with an override for the
 * case where the release must be attested against a version other than the local one.
 *
 * Order: an explicit PI_VERSION wins; otherwise `pi --version` on PATH; otherwise refuse.
 *
 * Exit: 0 prints the version, 3 refuses with a reason on stderr.
 */

import { execFileSync } from 'node:child_process';

export type PiVersionResult =
  | { ok: true; version: string; source: 'env' | 'pi --version' }
  | { ok: false; reason: string };

export interface PiVersionDeps {
  env?: NodeJS.ProcessEnv;
  run?: (command: string, args: string[]) => string;
}

const VERSION = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/;

/**
 * Decide the version string. Pure apart from the injected command, so the release path and its
 * tests cannot disagree about what counts as usable.
 */
export function resolvePiVersion(deps: PiVersionDeps = {}): PiVersionResult {
  const env = deps.env ?? process.env;
  const run = deps.run ?? ((command: string, args: string[]) => execFileSync(command, args, { encoding: 'utf8' }));

  const supplied = env.PI_VERSION?.trim();
  if (supplied) {
    if (supplied === 'unavailable') {
      return { ok: false, reason: 'PI_VERSION is set to "unavailable"; the attestation would record no runtime' };
    }
    const match = supplied.match(VERSION);
    if (!match) {
      return { ok: false, reason: `PI_VERSION "${supplied}" is not a version; expected something like 1.4.0` };
    }
    return { ok: true, version: match[0], source: 'env' };
  }

  let output: string;
  try {
    output = run('pi', ['--version']);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `could not run \`pi --version\`: ${detail}` };
  }
  const match = output.match(VERSION);
  if (!match) {
    return { ok: false, reason: `\`pi --version\` printed no version (got "${output.trim()}")` };
  }
  return { ok: true, version: match[0], source: 'pi --version' };
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const result = resolvePiVersion();
  if (result.ok) {
    if (argv.includes('--explain')) {
      console.error(`PI_VERSION ${result.version} from ${result.source}`);
    }
    console.log(result.version);
    return 0;
  }
  console.error(`FAILED: ${result.reason}`);
  console.error('  Set PI_VERSION explicitly (for example PI_VERSION=1.4.0) or install pi on PATH.');
  return 3;
}

if (import.meta.main) process.exit(main());
