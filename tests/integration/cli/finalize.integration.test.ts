import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('finalize CLI wiring', () => {
  it('prints finalize help', () => {
    const result = spawnSync('bun', ['src/index.ts', 'finalize', '--help'], {
      encoding: 'utf-8',
    });

    expect(result.stdout).toContain('Usage: specialists finalize <job-id>');
  });
});
