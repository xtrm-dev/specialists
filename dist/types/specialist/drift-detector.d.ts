export type DriftScope = 'default' | 'user';
export type DriftStatus = 'redundant-safe-to-prune' | 'diverged-safe-to-prune' | 'useless-override-safe-to-remove' | 'diverged-consider-removing-or-refactoring';
export interface DriftAssetKind {
    kind: 'specialists' | 'mandatory-rules' | 'catalog' | 'nodes';
    managedDir: string;
    canonicalDir: string | null;
    packageLabel: string;
}
export interface DriftFinding {
    repo_root: string;
    kind: DriftAssetKind['kind'];
    scope: DriftScope;
    path: string;
    canonical_path: string | null;
    status: DriftStatus;
    bytes_equal: boolean | null;
    suggested_action: string;
    suggestion_command: string;
}
export interface DriftReport {
    root: string;
    repos: Array<{
        root: string;
        findings: DriftFinding[];
    }>;
    summary: {
        repos: number;
        findings: number;
        redundant_defaults: number;
        diverged_defaults: number;
        useless_overrides: number;
        diverged_overrides: number;
    };
}
export declare function resolveDriftAssets(): DriftAssetKind[];
export declare function detectDriftForRepo(repoRoot: string): DriftFinding[];
export declare function detectDriftUnderRoot(root: string): DriftReport;
export declare function pruneStaleDefaults(repoRoot: string, dryRun: boolean, keepDiverged?: boolean): string[];
//# sourceMappingURL=drift-detector.d.ts.map