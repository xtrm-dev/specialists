export declare const RUNTIME_IGNORE_PATTERNS: readonly [".xtrm/worktrees/", ".specialists/jobs/", ".specialists/ready/", ".specialists/settlements/", ".specialists/db/*.db", ".specialists/db/*.db-wal", ".specialists/db/*.db-shm", ".specialists/leases/", ".specialists/interactions/", ".specialists/logs/", ".specialists/trace.jsonl", ".specialists/version-check.json", ".specialists/executor-result.md", ".specialists/*-result.md", ".specialists/sync-docs-report.md"];
/** The same inventory as gitignore patterns (no leading slash, as `git check-ignore` expects). */
export declare function runtimeIgnorePatterns(): string[];
/** The inventory rooted at the repository root, for `.git/info/exclude`. */
export declare function runtimeIgnoreExcludePatterns(): string[];
//# sourceMappingURL=runtime-ignore.d.ts.map