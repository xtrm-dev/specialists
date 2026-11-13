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
 *   values from the CLI answer. Empty values are dropped, EXCEPT inside the
 *   `GIT_CONFIG_*` block: core writes an empty `GIT_CONFIG_VALUE_*` on purpose
 *   to reset a global credential helper, and git refuses every command when
 *   `GIT_CONFIG_COUNT` names an index whose pair is absent.
 * - PATH is never taken from the CLI. `resolveAgentLaunchEnv` appends it locally
 *   with the gh shim directory first (CORE-2524.4), because an identity the shim
 *   cannot intercept is not an identity.
 */

import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { runtimeWarn } from '../utils/runtime-diagnostics.js';
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
const GIT_CONFIG_COUNT_KEY = 'GIT_CONFIG_COUNT';
const GIT_CONFIG_KEY_PREFIX = 'GIT_CONFIG_KEY_';
const GIT_CONFIG_VALUE_PREFIX = 'GIT_CONFIG_VALUE_';

/** One `xt identity env --json` invocation. `error` mirrors spawnSync's ENOENT/signal field. */
export type IdentityEnvRun = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => { status: number | null; stdout: string; error?: unknown };

export interface IdentityEnvInput {
  /** Substrate holder of the launched agent; absent or blank means no identity. */
  holder?: string | null;
  /** Specialist or role name; `xt` maps it through the role map. */
  roleName?: string | null;
  /** Directory the `xt` lookup runs in. Default: the process cwd. */
  cwd?: string;
  /** Base env for the lookup. Default: process.env. */
  env?: NodeJS.ProcessEnv;
  /** Injected for tests and for a host that owns its own resolver; defaults to a real `xt identity env --json`. */
  run?: IdentityEnvRun;
  /** Lookup timeout floor. Default 5000 ms. */
  timeoutMs?: number;
  /**
   * Warning sink, called with one reason line. Default: the launcher channel, a
   * `[specialists] identity-env:` line on stderr (the same `[specialists]`
   * prefix the runner uses for pre-run warnings). Injected in tests.
   */
  warn?: (message: string) => void;
}

function isAllowed(key: string): boolean {
  if ((IDENTITY_ENV_ALLOWLIST as readonly string[]).includes(key)) return true;
  return GIT_CONFIG_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * The launcher's warning channel: one prefixed stderr line, the same shape the
 * runner emits for pre-run and output-contract warnings. Never a value.
 */
/** One `[specialists] identity-env:` line: the launcher's warning channel, and the only one. */
export function warnIdentityEnv(message: string): void {
  runtimeWarn('identity-env', `[specialists] identity-env: ${message}`);
}

const launcherWarning = warnIdentityEnv;

/**
 * Every key one identity env OWNS. PATH is deliberately not here: the launched
 * PATH is one process-wide value by design (CORE-2524.4), while these keys name a
 * holder and a transport and must never outlive the activation that set them.
 */
const IDENTITY_MANAGED_KEY = /^(?:SUBSTRATE_HOLDER|XTRM_ROLE|GIT_AUTHOR_NAME|GIT_AUTHOR_EMAIL|GIT_COMMITTER_NAME|GIT_COMMITTER_EMAIL|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_\d+|GIT_CONFIG_VALUE_\d+)$/;

export function isIdentityManagedKey(key: string): boolean {
  return IDENTITY_MANAGED_KEY.test(key);
}

/** Every identity-managed key present in `env`, with its value (or undefined when absent). */
export function snapshotIdentityEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    if (isIdentityManagedKey(key)) snapshot[key] = env[key];
  }
  return snapshot;
}

/**
 * Remove every identity-managed key from `env`. Called BEFORE an activation's
 * own identity is applied: a smaller answer must not leave a bigger answer's
 * GIT_CONFIG index or author behind, and the host's own git/gh calls must not
 * inherit a settled activation's identity.
 */
export function clearIdentityEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of Object.keys(env)) {
    if (isIdentityManagedKey(key)) delete env[key];
  }
}

/** Put `env` back to a snapshot: managed keys cleared first, then the snapshot's values. */
export function restoreIdentityEnv(
  snapshot: Record<string, string | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  clearIdentityEnv(env);
  for (const [key, value] of Object.entries(snapshot)) {
    if (typeof value === 'string') env[key] = value;
  }
}

/**
 * `GIT_CONFIG_COUNT` is authoritative for git: it reads exactly that many
 * KEY_i/VALUE_i pairs and dies with `fatal: unable to parse command-line config`
 * when one is absent, which breaks EVERY git command in the session. So the
 * block is exported all-or-nothing, and an empty `GIT_CONFIG_VALUE_*` is kept:
 * core's transport writes one to reset an inherited credential helper, and
 * dropping it is what desynchronises the count from the pairs.
 *
 * A malformed block is dropped whole rather than repaired. A partial rewrite
 * would silently change git transport; with no block git works and uses the
 * machine's transport, which is the pre-#525 behaviour. That fallback is a
 * CHANGE of identity for git, so it is never silent: one warning names the
 * reason before the block is dropped. Key names and indexes only, never values.
 */
function keepConsistentGitConfig(env: Record<string, string>, warn: (message: string) => void): void {
  const gitConfigKeys = Object.keys(env).filter((key) => GIT_CONFIG_PREFIXES.some((prefix) => key.startsWith(prefix)));
  if (gitConfigKeys.length === 0) return;
  const dropped = (reason: string): void => {
    for (const key of gitConfigKeys) delete env[key];
    warn(
      `dropped the GIT_CONFIG_* block (${reason}); git runs with the machine's transport, not this role's identity`,
    );
  };
  const count = (env[GIT_CONFIG_COUNT_KEY] ?? '').trim();
  if (!/^\d+$/.test(count)) return dropped(`GIT_CONFIG_COUNT is not a number`);
  const indices = Number(count);
  for (let index = 0; index < indices; index += 1) {
    if (!(GIT_CONFIG_KEY_PREFIX + index in env)) return dropped(`${GIT_CONFIG_KEY_PREFIX}${index} is missing`);
    if (!(GIT_CONFIG_VALUE_PREFIX + index in env)) return dropped(`${GIT_CONFIG_VALUE_PREFIX}${index} is missing`);
  }
  // No index outside the declared count may ride along: git ignores them, and a
  // stale one would reappear if a future count is smaller.
  for (const key of gitConfigKeys) {
    if (key === GIT_CONFIG_COUNT_KEY) continue;
    const suffix = key.replace(/^GIT_CONFIG_(?:KEY|VALUE)_/, '');
    if (!/^\d+$/.test(suffix) || Number(suffix) >= indices) return dropped(`${key} is outside GIT_CONFIG_COUNT`);
  }
}

/** A spawn error's class and code, e.g. `Error ENOENT`; never a value. */
function describeErrorClass(error: unknown): string {
  if (!(error instanceof Error)) return 'non-Error';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code ? `${error.name} ${code}` : error.name || 'Error';
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
    // N4: spawnSync reports ENOENT and signals in `error`, never by throwing. Dropping
    // it here made a missing `xt` look like "exited on a signal" — a wrong reason on the
    // one warning an operator uses to tell a broken install from a failing CLI.
    return { status: result.status, stdout: String(result.stdout ?? ''), error: result.error };
  });

  const warn = input.warn ?? launcherWarning;
  // MEDIUM F1: returning the holder without a role identity means git and gh act
  // as the operator, so every silent fallback is a warning. The reason names the
  // failure class only — never xt's output, never a value.
  const withoutRole = (reason: string): Record<string, string> => {
    warn(`identity env unavailable (${reason}); the session runs without an agent identity`);
    return base;
  };

  let result: { status: number | null; stdout: string; error?: unknown };
  try {
    result = run('xt', ['identity', 'env', '--json'], {
      cwd: input.cwd,
      env: { ...(input.env ?? process.env), ...base },
      timeoutMs: input.timeoutMs ?? 5000,
    });
  } catch (error) {
    return withoutRole(`lookup threw ${describeErrorClass(error)}`);
  }
  if (result.error) return withoutRole(`lookup did not run (${describeErrorClass(result.error)})`);
  if (result.status !== 0) {
    return withoutRole(result.status === null ? 'xt exited on a signal' : `xt exited ${result.status}`);
  }

  let answer: unknown;
  try {
    answer = JSON.parse(result.stdout);
  } catch {
    return withoutRole('returned unparseable JSON');
  }

  const env = (answer as { env?: unknown } | null)?.env;
  if (!env || typeof env !== 'object' || Array.isArray(env)) return withoutRole('returned no env');
  const merged: Record<string, string> = { ...base };
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (typeof value !== 'string' || !isAllowed(key)) continue;
    // An empty GIT_CONFIG_VALUE_* is a deliberate reset, not a missing value.
    if (value === '' && !key.startsWith(GIT_CONFIG_VALUE_PREFIX)) continue;
    merged[key] = value;
  }
  keepConsistentGitConfig(merged, warn);
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
