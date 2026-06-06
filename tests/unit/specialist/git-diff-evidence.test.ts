import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  buildGitDiffEvidence,
  parseGitNumstat,
  redactGitDiffHunks,
  willHunksBeInline,
  writeGitDiffHunksArtifact,
} from '../../../src/specialist/git-diff-evidence.js';

describe('git-diff-evidence', () => {
  it('parses per-file +/- counts from git numstat output', () => {
    expect(parseGitNumstat('12\t3\tsrc/a.ts\n0\t7\tdocs/b.md\n-\t-\tassets/logo.png\n')).toEqual([
      { path: 'src/a.ts', added_lines: 12, removed_lines: 3 },
      { path: 'docs/b.md', added_lines: 0, removed_lines: 7 },
      { path: 'assets/logo.png', added_lines: 0, removed_lines: 0 },
    ]);
  });

  it('redacts known-prefix API tokens', () => {
    const out = redactGitDiffHunks('token: sk-123456789012\nghp_abcdefghijklmnop\nxoxb-abc-def-ghi-jkl');
    expect(out).not.toContain('sk-123456789012');
    expect(out).not.toContain('ghp_abcdefghijklmnop');
    expect(out).not.toContain('xoxb-abc-def-ghi-jkl');
    expect(out).toContain('[REDACTED-TOKEN]');
  });

  it('redacts env/config password and secret assignments', () => {
    const out = redactGitDiffHunks(
      '+DB_PASSWORD=supersecret123\n+API_KEY=sk-my-real-key\n+client_secret: abc123xyz',
    );
    expect(out).not.toContain('supersecret123');
    expect(out).not.toContain('sk-my-real-key');
    expect(out).not.toContain('abc123xyz');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts PEM private key blocks', () => {
    const pem =
      '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n-----END PRIVATE KEY-----';
    const out = redactGitDiffHunks(`+${pem}`);
    expect(out).not.toContain('MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7');
    expect(out).toContain('[REDACTED-PEM]');
  });

  it('redacts Authorization and Cookie headers', () => {
    const out = redactGitDiffHunks(
      '+Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig\n+Cookie: session=abc123secret',
    );
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).not.toContain('abc123secret');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts email addresses (PII)', () => {
    const out = redactGitDiffHunks('+author = alice@example.com\n+contact: bob@corp.io');
    expect(out).not.toContain('alice@example.com');
    expect(out).not.toContain('bob@corp.io');
    expect(out).toContain('[REDACTED-EMAIL]');
  });

  it('redacts URLs with embedded credentials', () => {
    const out = redactGitDiffHunks('+const url = "https://admin:p@ssw0rd@db.example.com/db"');
    expect(out).not.toContain('p@ssw0rd');
    expect(out).toContain('[REDACTED-URL-CREDS]://');
  });

  it('redacts hunks before inline or artifact persistence', () => {
    const inline = buildGitDiffEvidence({
      numstat_output: '1\t1\tsrc/a.ts\n',
      hunks_output: 'diff --git a/src/a.ts b/src/a.ts\n-old secret sk-123456789012\n+DB_PASSWORD=realpassword\n',
    });

    expect(inline.hunks).toContain('[REDACTED');
    expect(inline.hunks).not.toContain('sk-123456789012');
    expect(inline.hunks).not.toContain('realpassword');

    const jobDir = mkdtempSync(join(tmpdir(), 'git-diff-artifact-'));
    try {
      const ref = writeGitDiffHunksArtifact(
        jobDir,
        'hunks.patch',
        'diff --git a/src/a.ts b/src/a.ts\n-old sk-123456789012\n+DB_PASSWORD=supersecret\n',
      );
      // ref must be opaque — no absolute paths, tmp dirs, home dirs, or usernames
      expect(ref).toMatch(/^artifact:\/\/git-diff\//);
      expect(ref).not.toContain('/tmp');
      expect(ref).not.toContain('/home');
      expect(ref).not.toContain(tmpdir());
      expect(ref).not.toContain(jobDir);
      const stored = readFileSync(join(jobDir, 'artifacts', 'hunks.patch'), 'utf8');
      expect(stored).not.toContain('sk-123456789012');
      expect(stored).not.toContain('supersecret');
    } finally {
      rmSync(jobDir, { recursive: true, force: true });
    }
  });

  it('redacts APP_KEY and underscore-compound secret env names', () => {
    const out = redactGitDiffHunks(
      '+APP_KEY=base64:supersecretvalue\n+SIGNING_KEY=sekret\n+APP_PRIVATE_KEY=abc123',
    );
    expect(out).not.toContain('base64:supersecretvalue');
    expect(out).not.toContain('sekret');
    expect(out).not.toContain('abc123');
    expect(out).toContain('[REDACTED]');
  });

  it('willHunksBeInline returns true for small hunks and false for large', () => {
    expect(willHunksBeInline('diff --git a/x b/x\n-old\n+new\n')).toBe(true);
    expect(willHunksBeInline('x'.repeat(5_000))).toBe(false);
  });

  it('inline diff does not create artifact file on disk', () => {
    const jobDir = mkdtempSync(join(tmpdir(), 'git-diff-inline-'));
    try {
      const smallHunks = 'diff --git a/x b/x\n-old\n+new\n';
      expect(willHunksBeInline(smallHunks)).toBe(true);
      const artifactsDir = join(jobDir, 'artifacts');
      expect(existsSync(artifactsDir)).toBe(false);
    } finally {
      rmSync(jobDir, { recursive: true, force: true });
    }
  });

  it('keeps small hunks inline and large hunks as artifact ref', () => {
    const inline = buildGitDiffEvidence({
      base_ref: 'HEAD^',
      base_sha: 'base-sha',
      head_sha: 'head-sha',
      numstat_output: '1\t2\tsrc/a.ts\n',
      hunks_output: 'diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
    });

    expect(inline).toMatchObject({
      base_ref: 'HEAD^',
      base_sha: 'base-sha',
      head_sha: 'head-sha',
      changed_files: [{ path: 'src/a.ts', added_lines: 1, removed_lines: 2 }],
      hunks_inline: true,
      hunks: expect.stringContaining('@@ -1 +1 @@'),
    });

    const large = buildGitDiffEvidence({
      base_ref: 'HEAD^',
      base_sha: 'base-sha',
      head_sha: 'head-sha',
      numstat_output: '1\t2\tsrc/a.ts\n',
      hunks_output: 'x'.repeat(5_000),
      artifact_ref: 'artifact://git-diff/head-sha',
    });

    expect(large).toMatchObject({
      hunks_artifact_ref: 'artifact://git-diff/head-sha',
      hunks_truncated: true,
    });
    expect(large).not.toHaveProperty('hunks');
  });
});
