/**
 * Give a bridged activation's Claude Code child its identity (SPECIALISTS-4498).
 *
 * On the claude-bridge route the model is a Claude Code child that pi-claude-bridge spawns with
 * `ccChildEnv(options.env)`: a copy of the HOST `process.env` with pi's per-request provider env
 * laid over it. Since SPECIALISTS-4456 the activation's identity no longer lives in
 * `process.env` — it reaches the activation's shells through the bash spawn hook only — so
 * without a provider env the child carried the DISPATCHER's `XTMUX_AGENT_ROLE`,
 * `SUBSTRATE_HOLDER` and `XTRM_AGENT_NAME`, and Claude Code hooks and the agent host in that
 * child resolved the Specialist as the lead (CORE-2722).
 *
 * The seam is the activation's own `ModelRuntime`. A bridged session is created with the
 * runtime the host built for THIS dispatch, and pi 1.5.2 resolves every request's provider env
 * there: `ModelRuntime.streamSimple` → `prepareRequest` → `this.getAuth(model)`, whose
 * `resolution.env` becomes `options.env` (the same channel a stored credential's `env` uses).
 * Scoping `getAuth` on that one runtime instance hands the identity to the child and to nobody
 * else; the host process env is never written.
 */

import { CLAUDE_BRIDGE_PROVIDER } from '../pi/claude-bridge.js';
import type { PiModelRuntimeLike } from './pi-sdk.js';

/**
 * Keys pi-claude-bridge refuses in a provider env: it reads Claude Code's session files through
 * pi's own values, so `ccChildEnv` throws on any of them (case-insensitive).
 */
const BRIDGE_FORBIDDEN_KEYS = ['HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR'];
const GIT_CONFIG_PREFIXES = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_', 'GIT_CONFIG_VALUE_'];

/**
 * The part of an activation's env the bridge can carry to its child.
 *
 * - `PATH` is dropped: the shim-first PATH is composed per shell spawn, never precomputed.
 * - The bridge-forbidden storage keys are dropped rather than allowed to fail the request.
 * - The `GIT_CONFIG_*` block travels all-or-nothing: `ccChildEnv` turns an empty value into a
 *   DELETE, so a block holding the deliberate empty `GIT_CONFIG_VALUE_*` reset would arrive with
 *   `GIT_CONFIG_COUNT` naming a missing pair, and git refuses every command on that. Such a block
 *   is not representable on this channel and is left out whole.
 */
export function bridgedChildEnv(overlay: Record<string, string>): Record<string, string> {
  const isGitConfig = (key: string) => GIT_CONFIG_PREFIXES.some((prefix) => key.startsWith(prefix));
  const gitBlockRepresentable = Object.entries(overlay).every(([key, value]) => !isGitConfig(key) || value !== '');
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(overlay)) {
    if (key === 'PATH' || BRIDGE_FORBIDDEN_KEYS.includes(key.toUpperCase())) continue;
    if (isGitConfig(key) && !gitBlockRepresentable) continue;
    env[key] = value;
  }
  return env;
}

/**
 * Lay `overlay` over the provider env `runtime` resolves for `providerId` requests.
 *
 * Instance-scoped on purpose: the runtime is the one this dispatch created, so the dispatcher's
 * own runtime — and its own Claude Code child, when the lead itself runs on the bridge — keep
 * their identity. The overlay wins per key over a stored credential's env.
 *
 * @returns true when installed; false when there is nothing to carry or the runtime has no
 *          `getAuth` to scope (the caller reports the latter).
 */
export function scopeBridgedChildEnv(
  runtime: PiModelRuntimeLike,
  overlay: Record<string, string>,
  providerId: string = CLAUDE_BRIDGE_PROVIDER,
): boolean {
  const env = bridgedChildEnv(overlay);
  const original = runtime.getAuth;
  if (Object.keys(env).length === 0 || typeof original !== 'function') return false;
  runtime.getAuth = async (providerOrModel, overrides) => {
    const resolution = await original.call(runtime, providerOrModel, overrides);
    const provider = typeof providerOrModel === 'string' ? providerOrModel : providerOrModel?.provider;
    if (provider !== providerId || !resolution || typeof resolution !== 'object') return resolution;
    const existing = (resolution as { env?: Record<string, string> }).env;
    return { ...resolution, env: { ...(existing ?? {}), ...env } };
  };
  return true;
}
