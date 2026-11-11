/**
 * Agent identity env for a supervised Specialist (CORE-2525/2528, core #881/#882).
 *
 * A launched Specialist must be able to act as its GitHub App: Substrate names
 * the agent (`SUBSTRATE_HOLDER`), the role decides which App mints the token
 * (`XTRM_ROLE`), and the xt CLI resolves the git author and git transport env
 * from those two values. This module asks `xt identity env --json` for that env
 * instead of duplicating the role map here.
 *
 * Rules:
 * - No holder, no identity: nothing is fabricated.
 * - `xt` missing, failing, slow or printing junk never blocks the session; the
 *   holder and the specialist name still ride along so that `xt` inside the
 *   session can resolve the role itself.
 * - Only an allowlist of keys is merged. The child never inherits arbitrary
 *   values from the CLI answer.
 * - PATH is never taken from the CLI. `resolveAgentLaunchEnv` appends it locally
 *   with the gh shim directory first (CORE-2524.4), because an identity the shim
 *   cannot intercept is not an identity.
 */

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/** Keys the session may take from `xt identity env --json`. */
export const IDENTITY_ENV_ALLOWLIST = [
  'SUBSTRATE_HOLDER',
  'XTRM_ROLE',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
] as const;

const GIT_CONFIG_PREFIXES = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_', 'GIT_CONFIG_VALUE_'];

export interface IdentityEnvInput {
  /** Substrate holder of the launched agent; absent or blank means no identity. */
  holder?: string | null;
  /** Specialist or role name; `xt` maps it through the role map. */
  roleName?: string | null;
  /** Directory the `xt` lookup runs in. Default: the process cwd. */
  cwd?: string;
  /** Base env for the lookup. Default: process.env. */
  env?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to a real `xt identity env --json`. */
  run?: (
    cmd: string,
    args: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
  ) => { status: number | null; stdout: string };
  /** Lookup timeout floor. Default 5000 ms. */
  timeoutMs?: number;
}

function isAllowed(key: string): boolean {
  if ((IDENTITY_ENV_ALLOWLIST as readonly string[]).includes(key)) return true;
  return GIT_CONFIG_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * The identity env for one launched session. Never throws: on any doubt it
 * returns the holder (and the role name) and nothing else.
 */
export function resolveAgentIdentityEnv(input: IdentityEnvInput = {}): Record<string, string> {
  const holder = (input.holder ?? '').trim();
  if (!holder) return {};
  const roleName = (input.roleName ?? '').trim();
  const base: Record<string, string> = { SUBSTRATE_HOLDER: holder };
  if (roleName) base.XTRM_ROLE = roleName;

  const run = input.run ?? ((cmd, args, opts) => {
    const result = spawnSync(cmd, args, {
      encoding: 'utf8',
      cwd: opts.cwd,
      env: opts.env,
      timeout: opts.timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: result.status, stdout: String(result.stdout ?? '') };
  });

  let answer: unknown;
  try {
    const result = run('xt', ['identity', 'env', '--json'], {
      cwd: input.cwd,
      env: { ...(input.env ?? process.env), ...base },
      timeoutMs: input.timeoutMs ?? 5000,
    });
    if (result.status !== 0) return base;
    answer = JSON.parse(result.stdout);
  } catch {
    return base;
  }

  const env = (answer as { env?: unknown } | null)?.env;
  if (!env || typeof env !== 'object') return base;
  const merged: Record<string, string> = { ...base };
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (typeof value === 'string' && value !== '' && isAllowed(key)) merged[key] = value;
  }
  // The holder we were asked to carry always wins over the CLI's echo.
  merged.SUBSTRATE_HOLDER = holder;
  return merged;
}

/**
 * CORE-2524.4: a Specialist's `gh` must resolve to the xt shim, not the real
 * binary. The identity env above makes the shim INTERESTED in an agent call;
 * PATH decides whether the shim is reached at all. A host whose PATH lacks the
 * shim directory — or a pane that inherits the tmux server's PATH — still runs
 * the real `gh`, and a review posts under the operator identity, silently.
 *
 * The directory `xt identity setup` installs the shim into, one source: the
 * same rule as core `cli/src/core/pane-path.ts` (shimBinDir there).
 */
export function shimBinDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.HOME || os.homedir(), '.local', 'bin');
}

/**
 * The PATH a Specialist process gets: the shim directory first, then the host
 * PATH, empty segments dropped (an empty entry means the current directory) and
 * duplicates removed. A PATH that already starts with the shim keeps exactly one
 * entry. Mirrors core panePath() so both repos apply one rule.
 */
export function specialistPath(env: NodeJS.ProcessEnv = process.env): string {
  const shim = shimBinDir(env);
  const seen = new Set<string>([shim]);
  const entries = [shim];
  for (const raw of (env.PATH ?? '').split(path.delimiter)) {
    const entry = raw.trim();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    entries.push(entry);
  }
  return entries.join(path.delimiter);
}

/**
 * The full env one launched Specialist process receives: the agent identity env
 * plus the PATH that makes the shim reachable. Both launch paths call this — the
 * legacy runner's session env and the native host's process.env — so a Specialist
 * never gets the holder without the shim. Without a holder nothing is fabricated,
 * PATH included.
 */
export function resolveAgentLaunchEnv(input: IdentityEnvInput = {}): Record<string, string> {
  const identity = resolveAgentIdentityEnv(input);
  if (!identity.SUBSTRATE_HOLDER) return identity;
  return { ...identity, PATH: specialistPath(input.env ?? process.env) };
}

/** The holder a supervised run claims: stable per job, unique per concurrent run. */
export function specialistHolderName(specialistName: string, jobId?: string | null, pid = process.pid): string {
  const name = (specialistName || 'specialist').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'specialist';
  const job = (jobId ?? '').trim().replace(/[^A-Za-z0-9]/g, '');
  return job ? `sp-${name}-${job.slice(0, 8)}` : `sp-${name}-${pid}`;
}
