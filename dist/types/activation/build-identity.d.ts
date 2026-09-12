export declare const BUILD_ID_BYTES = 12;
export declare const UNKNOWN_BUILD_ID = "unknown";
/** sha256 hex of a file's bytes. Throws if the file cannot be read. */
export declare function hashFileBytes(path: string): string;
export declare function shortBuildId(hash: string): string;
/** Short content id of an artifact file, or 'unknown' — never throws. */
export declare function readBuildId(path: string): string;
/**
 * True when the loaded module and the artifact on disk are both identified and
 * differ — the running process is stale. An unreadable side cannot rule
 * staleness out, but it cannot assert it either, so it returns false and the
 * `describeBuildIdentity` line keeps saying so.
 *
 * The single staleness predicate: `describeBuildIdentity` renders the same
 * comparison, so a caller never derives staleness a second way.
 */
export declare function isBuildStale(loadedId: string, onDiskId: string): boolean;
/**
 * One line stating which build rendered this outcome and whether the
 * artifact on disk has changed since this process loaded it. When the ids
 * differ the line names staleness outright, so a stale-build refusal can
 * never again read as a broken contract.
 */
export declare function describeBuildIdentity(loadedId: string, onDiskId: string): string;
//# sourceMappingURL=build-identity.d.ts.map