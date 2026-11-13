// src/utils/runtime-ignore.ts
//
// ONE inventory of the paths the Specialists runtime writes into a repository and that
// git must therefore not report. Two writers consume it: `sp init` appends them to the
// repository's tracked .gitignore, and `provisionWriterWorkspace` appends the same set to
// the per-clone .git/info/exclude before it creates a writer worktree.
//
// Two hand-maintained lists is how the coverage drifted: the exclude list covered the
// directories one test happened to create while the tracked ignore list covered a
// different subset, so a repository could report a clean status under one writer and a
// dirty one under the other. Callers may add a prefix (`/` for info/exclude patterns);
// none may subtract, or the split returns.
//
// Authored files under `.specialists/` (`user/`, `default/`, `catalog/`, project-scope
// Specialist definitions) are deliberately NOT listed: they are source, and a repository
// chooses whether to track them. A repository whose own .gitignore masks the whole
// directory still masks it — this list does not override a tracked ignore, and it is not
// meant to.
export const RUNTIME_IGNORE_PATTERNS = [
  // The writer worktrees themselves; they live inside the dispatcher checkout.
  '.xtrm/worktrees/',
  // Job and scheduling state.
  '.specialists/jobs/',
  '.specialists/ready/',
  // Settlement records hold full raw model output; never commit them.
  '.specialists/settlements/',
  // Observability database and its write-ahead/shared-memory companions.
  '.specialists/db/*.db',
  '.specialists/db/*.db-wal',
  '.specialists/db/*.db-shm',
  // Writer-lease and peer-interaction state.
  '.specialists/leases/',
  '.specialists/interactions/',
  // Runtime diagnostics written by the in-process host.
  '.specialists/logs/',
  // Runtime artifacts written at the repository root of .specialists/.
  '.specialists/trace.jsonl',
  '.specialists/version-check.json',
  '.specialists/executor-result.md',
  '.specialists/*-result.md',
  '.specialists/sync-docs-report.md',
] as const;

/** The same inventory as gitignore patterns (no leading slash, as `git check-ignore` expects). */
export function runtimeIgnorePatterns(): string[] {
  return [...RUNTIME_IGNORE_PATTERNS];
}

/** The inventory rooted at the repository root, for `.git/info/exclude`. */
export function runtimeIgnoreExcludePatterns(): string[] {
  return RUNTIME_IGNORE_PATTERNS.map((pattern) => `/${pattern}`);
}
