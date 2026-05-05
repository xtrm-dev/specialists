type PackageRequire = (specifier: string) => unknown;
export declare function readBundledPackageVersion(requireFn?: PackageRequire): string;
export declare const localVersion: string;
export interface VersionCheckCache {
    checked_at_ms: number;
    latest_tag: string;
    notified_for_tag: string;
}
export interface VersionCheckResult {
    latestTag: string;
    localVersion: string;
    cache: VersionCheckCache;
}
export declare function shouldRunVersionCheck(): boolean;
export declare function readCachedVersionCheck(): VersionCheckCache | null;
export declare function getVersionCheckResult(): VersionCheckResult | null;
export declare function formatVersionCheckNudge(result: VersionCheckResult): string | null;
export declare function markVersionCheckNotified(result: VersionCheckResult): void;
export {};
//# sourceMappingURL=version-check.d.ts.map