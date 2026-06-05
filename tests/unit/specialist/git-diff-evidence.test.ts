import { describe, expect, it } from 'vitest';
import { buildGitDiffEvidence, parseGitNumstat } from '../../../src/specialist/git-diff-evidence.js';

describe('git-diff-evidence', () => {
  it('parses per-file +/- counts from git numstat output', () => {
    expect(parseGitNumstat('12\t3\tsrc/a.ts\n0\t7\tdocs/b.md\n-\t-\tassets/logo.png\n')).toEqual([
      { path: 'src/a.ts', added_lines: 12, removed_lines: 3 },
      { path: 'docs/b.md', added_lines: 0, removed_lines: 7 },
      { path: 'assets/logo.png', added_lines: 0, removed_lines: 0 },
    ]);
  });

  it('keeps small hunks inline and large hunks redacted as artifact ref', () => {
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
