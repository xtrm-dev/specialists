/**
 * The work store native dispatch resolves at runtime (SPECIALISTS-57 closeout §3).
 *
 * `sp doctor` reported healthy on a machine where `specialist_dispatch` could not work at all:
 * the resolution is ordinary module resolution of an OPTIONAL runtime prerequisite, so nothing
 * in the doctor's own surfaces noticed its absence. Reported as a WARNING, not a failure: the
 * legacy `sp` CLI is fully usable without Substrate, so an install without it is not broken —
 * it is broken for the NATIVE path only, and the operator has to be told which.
 *
 * Deliberately model-call-free and side-effect-free: it resolves the same way the runtime does
 * (one rule, one home) and never opens the store.
 */
/**
 * Advisory: results are persisted to observability.db only when it already exists
 * (nothing creates it implicitly), so a missing file means `specialist_result` can
 * answer only from the live server's memory.
 */
export declare function checkObservabilityDb(cwd?: string): boolean;
export declare function resolvePackageAssetDir(relativePath: string): string | null;
export declare function parseVersionTuple(value: string): [number, number, number] | null;
export declare function compareVersions(left: string, right: string): number;
export declare function setStatusError(statusPath: string): void;
interface CleanupProcessesResult {
    total: number;
    running: number;
    zombies: number;
    updated: number;
    zombieJobIds: string[];
}
export declare function cleanupProcesses(jobsDir: string, dryRun: boolean): CleanupProcessesResult;
export declare function renderProcessSummary(result: CleanupProcessesResult, dryRun: boolean): string;
export declare function run(argv?: readonly string[]): Promise<void>;
export {};
//# sourceMappingURL=doctor.d.ts.map