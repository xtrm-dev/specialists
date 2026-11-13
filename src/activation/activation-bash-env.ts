/**
 * Give a native activation its identity at the BASH SPAWN BOUNDARY (SPECIALISTS-4456).
 *
 * A native activation runs in the HOST process, so until this module existed the only
 * channel that reached its tools was `process.env` — and writing there also reached the
 * dispatcher. A Pi worker that dispatched a `pr-reviewer` activation then found
 * `XTRM_ROLE=reviewer` in its own environment and `git push` refused with "the reviewer
 * role does not push; no credential is offered" (SPECIALISTS-4456, reported by two
 * workers). The child must get its own identity; the parent must keep its own.
 *
 * pi's shell tool resolves its env once per spawn, through
 * `BashToolOptions.spawnHook: (context: { command, cwd, env }) => context`
 * (`pi dist/core/tools/bash.js`, `resolveSpawnContext`). The host already reconstructs
 * `bash` as a lease-guarded custom tool (`createGuardedTools`), so the hook is reachable
 * without any SDK change: build the tool with the hook and the activation's env is
 * applied to its own shells only.
 *
 * What must NOT ride along: the hook merges an allowlisted env (#525's identity keys plus
 * `PATH` with the gh shim first) over the inherited one. Nothing is deleted, so a shell
 * still inherits the host's ordinary environment — the activation's identity simply wins
 * on the keys it owns, exactly as the CLI-spawn path does per child process.
 */

/** The shape pi passes to a bash spawn hook, and expects back. */
export interface BashSpawnContext {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/**
 * A spawn hook that overlays `overlay` on the env pi resolved for this spawn.
 *
 * `overlay` wins per key. Empty values are kept, not dropped: the identity module writes
 * empty `GIT_CONFIG_VALUE_*` entries on purpose to reset a global credential helper, and
 * git refuses every command when `GIT_CONFIG_COUNT` names an index whose pair is absent.
 */
export function bashSpawnHookWith(
  overlay: Record<string, string>,
): (context: BashSpawnContext) => BashSpawnContext {
  return (context) => ({ ...context, env: { ...context.env, ...overlay } });
}

/**
 * True when a spawn hook is worth installing for this activation.
 *
 * An empty overlay would only replace pi's own env object with an identical copy, which
 * is noise in a diff and one more thing to explain; skip it.
 */
export function hasActivationEnv(overlay: Record<string, string>): boolean {
  return Object.keys(overlay).length > 0;
}
