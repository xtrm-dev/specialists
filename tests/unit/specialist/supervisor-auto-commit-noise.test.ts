import { describe, expect, it } from 'vitest';
import { AUTO_COMMIT_NOISE_PREFIXES } from '../../../src/specialist/supervisor.js';

function isNoisePath(path: string): boolean {
  return AUTO_COMMIT_NOISE_PREFIXES.some(prefix => path.startsWith(prefix));
}

describe('auto-commit noise prefixes', () => {
  it('filters pi runtime cache paths from checkpoint commits', () => {
    expect(AUTO_COMMIT_NOISE_PREFIXES).toContain('.pi/');
    expect(isNoisePath('.pi/npm')).toBe(true);
    expect(isNoisePath('.pi/npm/package-lock.json')).toBe(true);
    expect(isNoisePath('src/pi/session.ts')).toBe(false);
  });
});
