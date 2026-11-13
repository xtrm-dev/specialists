/**
 * Give a native activation its identity at the SHELL SPAWN BOUNDARY (SPECIALISTS-4456).
 *
 * A native activation runs in the HOST process, so until this module existed the only
 * channel that reached its tools was `process.env` — and writing there also reached the
 * dispatcher. A Pi worker that dispatched a `pr-reviewer` activation then found
 * `XTRM_ROLE=reviewer` in its own environment and `git push` refused with "the reviewer
 * role does not push; no credential is offered" (SPECIALISTS-4456, reported by two
 * workers). The child must get its own identity; the parent must keep its own.
 *
 * pi's shell tools resolve their env once per spawn, through
 * `BashToolOptions.spawnHook: (context: { command, cwd, env }) => context`
 * (`pi dist/core/tools/bash.js`, `resolveSpawnContext`). The host already reconstructs
 * `bash` as a lease-guarded custom tool (`createGuardedTools`), so the hook is reachable
 * without any SDK change: build the tool with the hook and the activation's env is
 * applied to its own shells only.
 *
 * ## What the hook does NOT cover
 *
 * Only tools the host reconstructs with a spawn hook carry the identity — today `bash`
 * and `powershell`. Two neighbouring channels are deliberately out of scope and must not
 * be described as covered:
 *
 * 1. **Tools that spawn a child from the host env.** The python tool is the real case: the
 *    python-kernel extension spawns its interpreter with `{ ...process.env }`, so a
 *    subprocess it starts carries the DISPATCHER's identity, not the activation's. Before
 *    this change it carried the activation's only because the host had overwritten
 *    `process.env`. Tracked as SPECIALISTS-4487 (fix belongs in the extension or in the
 *    tool-contract path); the host warns at dispatch when a contract grants such a tool.
 * 2. **The READ_ONLY sandbox.** The permission guard rewrites a bash call to
 *    `bwrap --clearenv … -- bash -c`, and builds its `--setenv` passthrough from
 *    `process.env` with an allowlist that never included the identity keys. Inside the
 *    sandbox the identity was already absent before this change; what changed is PATH:
 *    the shim-first PATH used to arrive through `process.env.PATH` and no longer does.
 *    The sandbox is `--unshare-net` and masks `~/.config/gh`, so the practical exposure is
 *    small — but the limit is real and is pinned by a test.
 */

import { delimiter as platformPathDelimiter } from 'node:path';

/** The shape pi passes to a shell spawn hook, and expects back. */
export interface BashSpawnContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Compose the activation's PATH from the PATH pi resolved for the spawn.
 *
 * `context.env.PATH` is not the host's PATH: pi prepends its own managed bin directory
 * (`<agentDir>/bin`, where fd and rg are installed) in `getShellEnv()`. An overlay that
 * carried a precomputed PATH would replace that directory and break `rg`/`fd` for every
 * activation that has an identity. So the shim goes first, the inherited PATH keeps every
 * entry it had, and the shim is not duplicated when it is already there.
 *
 * @param shimDir directory holding the gh/xt identity shim
 * @param inherited PATH pi resolved for this spawn
 * @param pathDelimiter platform list separator
 */
export function composeActivationPath(
  shimDir: string,
  inherited: string | undefined,
  pathDelimiter: string,
): string {
  const entries = (inherited ?? '')
    .split(pathDelimiter)
    .filter((entry) => entry.length > 0 && entry !== shimDir);
  return [shimDir, ...entries].join(pathDelimiter);
}

/**
 * A spawn hook that overlays `overlay` on the env pi resolved for this spawn.
 *
 * `overlay` wins per key, EXCEPT `PATH`: that is composed from the inherited value so pi's
 * managed bin directory survives (see {@link composeActivationPath}), and any `PATH` in the
 * overlay is ignored rather than allowed to clobber it.
 *
 * Empty values are kept, not dropped: the identity module writes empty
 * `GIT_CONFIG_VALUE_*` entries on purpose to reset a global credential helper, and git
 * refuses every command when `GIT_CONFIG_COUNT` names an index whose pair is absent.
 */
export function bashSpawnHookWith(
  overlay: Record<string, string>,
  options: { shimDir?: string; pathDelimiter?: string } = {},
): (context: BashSpawnContext) => BashSpawnContext {
  // `path.delimiter` is the default, not a literal ':': the hook is wired to the powershell
  // tool too, and a `:`-joined PATH on a `;` host drops System32 and unreaches the shim
  // (review round 2, finding 2 — probed with a Windows-shaped PATH).
  const { shimDir, pathDelimiter = platformPathDelimiter } = options;
  const identity = { ...overlay };
  delete identity.PATH;
  return (context) => {
    const env: NodeJS.ProcessEnv = { ...context.env, ...identity };
    if (shimDir) {
      env.PATH = composeActivationPath(shimDir, context.env.PATH, pathDelimiter);
    }
    return { ...context, env };
  };
}

/**
 * True when a spawn hook is worth installing for this activation.
 *
 * `shimDir` alone is enough: the identity may be empty on a machine without `xt`, and the
 * shim-first PATH is still the difference between posting a review as the App and posting
 * it as the operator.
 */
export function hasActivationEnv(overlay: Record<string, string>, shimDir?: string): boolean {
  return Object.keys(overlay).length > 0 || Boolean(shimDir);
}
