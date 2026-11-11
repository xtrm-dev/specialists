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
/** Keys the session may take from `xt identity env --json`. */
export declare const IDENTITY_ENV_ALLOWLIST: readonly ["SUBSTRATE_HOLDER", "XTRM_ROLE", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
/** One `xt identity env --json` invocation. `error` mirrors spawnSync's ENOENT/signal field. */
export type IdentityEnvRun = (cmd: string, args: string[], opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
}) => {
    status: number | null;
    stdout: string;
    error?: unknown;
};
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
/**
 * The launcher's warning channel: one prefixed stderr line, the same shape the
 * runner emits for pre-run and output-contract warnings. Never a value.
 */
/** One `[specialists] identity-env:` line: the launcher's warning channel, and the only one. */
export declare function warnIdentityEnv(message: string): void;
export declare function isIdentityManagedKey(key: string): boolean;
/** Every identity-managed key present in `env`, with its value (or undefined when absent). */
export declare function snapshotIdentityEnv(env?: NodeJS.ProcessEnv): Record<string, string | undefined>;
/**
 * Remove every identity-managed key from `env`. Called BEFORE an activation's
 * own identity is applied: a smaller answer must not leave a bigger answer's
 * GIT_CONFIG index or author behind, and the host's own git/gh calls must not
 * inherit a settled activation's identity.
 */
export declare function clearIdentityEnv(env?: NodeJS.ProcessEnv): void;
/** Put `env` back to a snapshot: managed keys cleared first, then the snapshot's values. */
export declare function restoreIdentityEnv(snapshot: Record<string, string | undefined>, env?: NodeJS.ProcessEnv): void;
/**
 * The identity env for one launched session. Never throws: on any doubt it
 * returns the holder (and the role name) and nothing else.
 */
export declare function resolveAgentIdentityEnv(input?: IdentityEnvInput): Record<string, string>;
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
export declare function shimBinDir(env?: NodeJS.ProcessEnv): string;
/**
 * The PATH a Specialist process gets: the shim directory first, then the host
 * PATH, empty segments dropped (an empty entry means the current directory) and
 * duplicates removed. A PATH that already starts with the shim keeps exactly one
 * entry. Mirrors core panePath() so both repos apply one rule.
 */
export declare function specialistPath(env?: NodeJS.ProcessEnv): string;
/**
 * The full env one launched Specialist process receives: the agent identity env
 * plus the PATH that makes the shim reachable. Both launch paths call this — the
 * legacy runner's session env and the native host's process.env — so a Specialist
 * never gets the holder without the shim. Without a holder nothing is fabricated,
 * PATH included.
 */
export declare function resolveAgentLaunchEnv(input?: IdentityEnvInput): Record<string, string>;
/** The holder a supervised run claims: stable per job, unique per concurrent run. */
export declare function specialistHolderName(specialistName: string, jobId?: string | null, pid?: number): string;
//# sourceMappingURL=identity-env.d.ts.map