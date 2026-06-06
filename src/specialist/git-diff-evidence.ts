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

// Known-secret token patterns (prefix-anchored, high-confidence)
const TOKEN_RE = /\b(sk-[a-z0-9_-]{12,}|ghp_[a-z0-9_]{12,}|ghs_[a-z0-9_]{12,}|xox[baprs]-[a-z0-9-]{12,}|AIza[0-9A-Za-z_-]{35,}|ya29\.[0-9A-Za-z_-]{40,})/ig;
// env/config assignments whose RHS is a secret — covers DB_PASSWORD, APP_KEY, SIGNING_TOKEN, etc.
// (?<![a-z0-9_]) anchors to a word boundary so the unbounded prefix never causes catastrophic
// backtracking on large non-matching strings (e.g. diff bodies full of code).
// Bounded {0,40} quantifiers guard against degenerate input even at the start of a string.
const ENV_SECRET_RE = /(?<![a-z0-9_])[a-z0-9_]{0,40}(?:password|passwd|secret|api_?key|auth_?token|access_?token|refresh_?token|private_?key|credential|client_?secret|db_?pass|database_?pass|[a-z0-9]{1,20}_(?:key|token|secret))[a-z0-9_]{0,40}\s*[=:]\s*\S+/ig;
// PEM blocks
const PEM_BLOCK_RE = /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE|PUBLIC KEY|ENCRYPTED)[A-Z ]*-----[\s\S]*?-----END [A-Z ]*(?:PRIVATE KEY|CERTIFICATE|PUBLIC KEY|ENCRYPTED)[A-Z ]*-----/ig;
// Authorization / Cookie headers — capture to end of line so multi-word values (Bearer <token>) are fully redacted
const AUTH_HEADER_RE = /\b(authorization|cookie)\s*:[^\n]+/ig;
// URLs with embedded credentials (https://user:pass@host)
const URL_CREDS_RE = /https?:\/\/[^/:@\s]+:[^/@\s]+@/ig;
// JWT-like tokens (three base64url segments)
const JWT_RE = /\bey[a-z0-9_-]{10,}\.ey[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/ig;
// Email addresses (PII)
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/ig;

export function redactGitDiffHunks(hunks: string): string {
  return hunks
    .replace(PEM_BLOCK_RE, '[REDACTED-PEM]')
    .replace(JWT_RE, '[REDACTED-JWT]')
    .replace(URL_CREDS_RE, '[REDACTED-URL-CREDS]://')
    .replace(ENV_SECRET_RE, '[REDACTED]')
    .replace(AUTH_HEADER_RE, '[REDACTED]')
    .replace(TOKEN_RE, '[REDACTED-TOKEN]')
    .replace(EMAIL_RE, '[REDACTED-EMAIL]');
}

export function willHunksBeInline(hunks: string): boolean {
  return redactGitDiffHunks(hunks).length <= INLINE_HUNKS_LIMIT;
}

// Returns an opaque resolver ref; filesystem path stays internal.
export function writeGitDiffHunksArtifact(jobDir: string, artifactName: string, hunks: string): string {
  const artifactPath = join(jobDir, 'artifacts');
  mkdirSync(artifactPath, { recursive: true });
  const filePath = join(artifactPath, artifactName);
  writeFileSync(filePath, redactGitDiffHunks(hunks), 'utf-8');
  return `artifact://git-diff/${artifactName}`;
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
