// Resolves the shipped Specialists-owned permission-guard Pi extension directory
// (SPECIALISTS-4285 phase 1). The .mjs body lives at
// config/pi-extensions/permission-guard/ and is packaged via package.json
// `files`. Pi loads the whole directory (`-e <dir>`) and picks up the
// extension via its own package.json `main` / `pi.extensions`.
//
// Path resolution walks the same candidate list as read-line-numbers so both
// the bundled build (dist/) and dev source (src/pi/) resolve. Missing asset
// returns null and callers fail closed on the READ_ONLY bash grant — never
// warn-and-continue with raw bash.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REL = join('config', 'pi-extensions', 'permission-guard');

const CANDIDATES = [
  join(HERE, '..', REL),
  join(HERE, '..', '..', REL),
  join(HERE, '..', '..', '..', REL),
];

/** Opt-out for the permission guard. Default on (SPECIALISTS-4290); '0' or 'false' disables it, restoring the pre-guard tool sets. */
export const PERMISSION_GUARD_ENV_KEY = 'SPECIALISTS_PERMISSION_GUARD';

/** Bounded channel carrying the specialist tier to the guard inside the child session. */
export const PERMISSION_GUARD_TIER_ENV_KEY = 'PI_SPECIALIST_PERMISSION_TIER';

let cached: string | null | undefined;

export function getPermissionGuardExtensionPath(): string | null {
  if (cached !== undefined) return cached;
  for (const candidate of CANDIDATES) {
    if (existsSync(join(candidate, 'index.mjs'))) {
      cached = resolve(candidate);
      return cached;
    }
  }
  cached = null;
  return cached;
}

export function isPermissionGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env[PERMISSION_GUARD_ENV_KEY] ?? '').trim().toLowerCase();
  return raw !== '0' && raw !== 'false';
}

/**
 * Whether the resolver may grant sandboxed bash to a tier (SPECIALISTS-4285).
 * Phase 1 is READ_ONLY only. Both conditions must hold: the guard is not opted out AND the
 * guard artifact resolves — a surface that cannot load the guard must not
 * grant READ_ONLY bash.
 */
export function shouldGrantGuardedBash(tier: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if ((tier ?? '').toUpperCase() !== 'READ_ONLY') return false;
  if (!isPermissionGuardEnabled(env)) return false;
  return getPermissionGuardExtensionPath() !== null;
}

/** Test-only reset for the module-level cache. */
export function __resetPermissionGuardExtensionPathCacheForTest(): void {
  cached = undefined;
}

/**
 * Shared load decision for all three launch surfaces (SPECIALISTS-4285):
 * legacy CLI spawn (PiAgentSession.start in src/pi/session.ts), raw CLI
 * spawn (src/specialist/script-runner.ts), and native activation
 * (src/activation/native-host.ts, reached via MCP specialist_dispatch and
 * the native-specialists Pi extension).
 *
 * Returns the guard path plus the bounded tier env channel when the tier is
 * READ_ONLY and the guard is not opted out. Returns null (with a warning)
 * when the artifact is missing: shouldGrantGuardedBash applies the same
 * check, so the contract has already withheld bash and the launch proceeds
 * without it — never with bash unsandboxed. Returns null when the guard does
 * not apply (opted out or non-READ_ONLY tier): callers load nothing and the
 * resolver grants nothing.
 */
export function resolvePermissionGuardForSpawn(
  tier: string | undefined,
): { path: string; tierEnv: Record<string, string> } | null {
  if ((tier ?? '').toUpperCase() !== 'READ_ONLY') return null;
  if (!isPermissionGuardEnabled()) return null;
  const path = getPermissionGuardExtensionPath();
  if (!path) {
    // Same artifact check as shouldGrantGuardedBash, so the contract already
    // withholds bash here: warn and launch without bash, never unsandboxed.
    console.warn(
      '[permission-guard] guard artifact config/pi-extensions/permission-guard is missing; ' +
        'READ_ONLY bash withheld.',
    );
    return null;
  }
  return { path, tierEnv: { [PERMISSION_GUARD_TIER_ENV_KEY]: 'READ_ONLY' } };
}
