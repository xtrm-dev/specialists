/** Opt-out for the permission guard. Default on (SPECIALISTS-4290); '0' or 'false' disables it, restoring the pre-guard tool sets. */
export declare const PERMISSION_GUARD_ENV_KEY = "SPECIALISTS_PERMISSION_GUARD";
/** Bounded channel carrying the specialist tier to the guard inside the child session. */
export declare const PERMISSION_GUARD_TIER_ENV_KEY = "PI_SPECIALIST_PERMISSION_TIER";
export declare function getPermissionGuardExtensionPath(): string | null;
export declare function isPermissionGuardEnabled(env?: NodeJS.ProcessEnv): boolean;
/**
 * Whether the resolver may grant sandboxed bash to a tier (SPECIALISTS-4285).
 * Phase 1 is READ_ONLY only. Both conditions must hold: the flag is on AND the
 * guard artifact resolves — a surface that cannot load the guard must not
 * grant READ_ONLY bash.
 */
export declare function shouldGrantGuardedBash(tier: string | undefined, env?: NodeJS.ProcessEnv): boolean;
/** Test-only reset for the module-level cache. */
export declare function __resetPermissionGuardExtensionPathCacheForTest(): void;
/**
 * Shared load decision for all three launch surfaces (SPECIALISTS-4285):
 * legacy CLI spawn (PiAgentSession.start in src/pi/session.ts), raw CLI
 * spawn (src/specialist/script-runner.ts), and native activation
 * (src/activation/native-host.ts, reached via MCP specialist_dispatch and
 * the native-specialists Pi extension).
 *
 * Returns the guard path plus the bounded tier env channel when the tier is
 * READ_ONLY and the flag is on. Throws when wanted but the artifact is
 * missing — a surface that cannot load the guard must fail closed, never
 * run with bash granted but unsandboxed. Returns null when the guard does
 * not apply (flag off or non-READ_ONLY tier): callers load nothing and the
 * resolver grants nothing, so behaviour is byte-for-byte unchanged.
 */
export declare function resolvePermissionGuardForSpawn(tier: string | undefined): {
    path: string;
    tierEnv: Record<string, string>;
} | null;
//# sourceMappingURL=permission-guard-extension.d.ts.map