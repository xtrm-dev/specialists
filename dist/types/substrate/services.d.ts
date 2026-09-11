/** Why the Substrate surface is inert. Reported verbatim through every tool. */
export type SubstrateUnavailableReason = 'module_not_resolvable' | 'runtime_incompatible' | 'open_failed';
export interface SubstrateServices {
    issues: unknown;
    journal: unknown;
    provenance: unknown;
}
export interface SubstrateHandle {
    available: boolean;
    services: SubstrateServices | null;
    reason?: SubstrateUnavailableReason;
    detail?: string;
}
/**
 * Resolve once per process. The result cannot change without a restart — a module either
 * resolves on this runtime or it does not — and retrying per tool call would pay the
 * failure repeatedly to reach the same answer.
 */
export declare function resolveSubstrate(): SubstrateHandle;
/**
 * The payload every Substrate-backed tool returns when the surface is inert.
 *
 * Shared so all three tools answer identically: a coordinator that learns the reason once
 * should not have to learn three dialects of it.
 */
export declare function substrateUnavailablePayload(tool: string, handle: SubstrateHandle): {
    status: "error";
    error: string;
    reason: SubstrateUnavailableReason;
    detail: string | undefined;
    help: string;
};
/** Test seam: forget the cached resolution. Never called in production. */
export declare function __resetSubstrateCacheForTests(): void;
//# sourceMappingURL=services.d.ts.map