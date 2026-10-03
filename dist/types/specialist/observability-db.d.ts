export declare const OBSERVABILITY_SCHEMA_VERSION = 16;
export interface ObservabilityDbLocation {
    gitRoot: string;
    dbDirectory: string;
    dbPath: string;
    dbWalPath: string;
    dbShmPath: string;
    source: 'git-root' | 'xdg-data-home';
}
export declare function resolveObservabilityDbLocation(cwd?: string): ObservabilityDbLocation;
/**
 * True when no observability database exists at the resolved location. Activation
 * results are persisted to `specialist_results` only when the file exists; the
 * writers never create it, so a missing file means results live in memory only.
 */
export declare function isObservabilityDbMissing(cwd?: string): boolean;
export declare const OBSERVABILITY_DB_MISSING_FIX = "specialists db setup";
export declare function ensureObservabilityDbFile(location: ObservabilityDbLocation): {
    created: boolean;
};
export declare function ensureGitignoreHasObservabilityDbEntries(gitRoot: string): {
    changed: boolean;
};
export declare function isObservabilityDbInitialized(location: ObservabilityDbLocation): boolean;
export declare function isPathInsideJobsDirectory(pathToCheck: string, gitRoot: string): boolean;
//# sourceMappingURL=observability-db.d.ts.map