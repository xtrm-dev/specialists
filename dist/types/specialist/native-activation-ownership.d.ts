/** Why native activation ownership could not be resolved. */
export type NativeOwnershipUnavailableReason = 'no_session_identity' | 'authority_store_absent' | 'authority_store_unreadable';
export type NativeOwnershipResolution = {
    kind: 'resolved';
    /** Activations whose recorded Substrate claim holder equals `holder`. */
    activationIds: string[];
    /** The exact holder string matched against `issue_claims.holder`. */
    holder: string;
} | {
    kind: 'unavailable';
    reason: NativeOwnershipUnavailableReason;
    /** Operator-facing detail. Names the missing authority; never a guess. */
    detail: string;
};
/**
 * The session identity, in the order this codebase already reads it. Both are
 * treated as opaque holder strings: nothing is prefixed, stripped, or
 * normalized. Empty and whitespace-only values are absent (an unset-feeling
 * value must never become a holder, the same rule `resolveAuthorityDbPath`
 * applies to its own variables).
 */
export declare function resolveSessionHolder(env?: NodeJS.ProcessEnv): string | undefined;
export interface ResolveNativeOwnershipOptions {
    env?: NodeJS.ProcessEnv;
    /** Injected for tests; defaults to the one authority path. */
    dbPath?: string;
}
/**
 * Resolve the set of native activations owned by this session.
 *
 * Read-only, bounded and total: it never throws, and every failure is a typed
 * `unavailable` result rather than an empty set, because "ownership is unknown"
 * and "you own nothing" are different facts and the caller renders them
 * differently.
 */
export declare function resolveNativeActivationOwnership(opts?: ResolveNativeOwnershipOptions): NativeOwnershipResolution;
//# sourceMappingURL=native-activation-ownership.d.ts.map