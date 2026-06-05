import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GitChangedFileEvidence {
  path: string;
  added_lines: number;
  removed_lines: number;
}

export interface GitDiffEvidence {
  base_ref?: string;
  base_sha?: string;
  head_sha?: string;
  changed_files: GitChangedFileEvidence[];
  hunks?: string;
  hunks_artifact_ref?: string;
  hunks_inline?: boolean;
  hunks_truncated?: boolean;
}

const INLINE_HUNKS_LIMIT = 4_000;
const SECRET_VALUE_RE = /(sk-[a-z0-9_-]{12,}|ghp_[a-z0-9_]{12,}|xox[baprs]-[a-z0-9-]{12,}|bearer\s+[a-z0-9._-]{12,}|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/ig;

export function redactGitDiffHunks(hunks: string): string {
  return hunks.replace(SECRET_VALUE_RE, '[REDACTED]');
}

export function writeGitDiffHunksArtifact(jobDir: string, artifactName: string, hunks: string): string {
  const artifactPath = join(jobDir, 'artifacts');
  mkdirSync(artifactPath, { recursive: true });
  const filePath = join(artifactPath, artifactName);
  writeFileSync(filePath, redactGitDiffHunks(hunks), 'utf-8');
  return 'artifact://' + join(artifactPath, artifactName);
}

export function parseGitNumstat(output: string): GitChangedFileEvidence[] {
  return output
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [addedRaw, removedRaw, ...pathParts] = line.split(/\s+/);
      const path = pathParts.join(' ');
      return {
        path,
        added_lines: parseGitCount(addedRaw),
        removed_lines: parseGitCount(removedRaw),
      };
    })
    .filter((entry) => entry.path.length > 0);
}

export function buildGitDiffEvidence(options: {
  base_ref?: string;
  base_sha?: string;
  head_sha?: string;
  numstat_output: string;
  hunks_output?: string;
  artifact_ref?: string;
}): GitDiffEvidence {
  const hunks = options.hunks_output?.trim();
  const redactedHunks = hunks ? redactGitDiffHunks(hunks) : undefined;
  const inline = redactedHunks !== undefined && redactedHunks.length <= INLINE_HUNKS_LIMIT;
  return {
    ...(options.base_ref ? { base_ref: options.base_ref } : {}),
    ...(options.base_sha ? { base_sha: options.base_sha } : {}),
    ...(options.head_sha ? { head_sha: options.head_sha } : {}),
    changed_files: parseGitNumstat(options.numstat_output),
    ...(redactedHunks
      ? inline
        ? { hunks: redactedHunks, hunks_inline: true }
        : { hunks_artifact_ref: options.artifact_ref ?? 'artifact://git-diff-hunks', hunks_truncated: true }
      : {}),
  };
}

function parseGitCount(value: string | undefined): number {
  if (!value || value === '-') return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
