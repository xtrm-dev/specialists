import { describe, expect, it } from 'vitest';

import {
  checkPinSync,
  compareVersions,
  satisfies,
} from '../../../scripts/check-pi-pin-sync.js';

describe('pi pin sync (SPECIALISTS-4438)', () => {
  it('accepts a pin that matches the declared version inside the peer range', () => {
    expect(checkPinSync({
      dockerfilePin: '1.5.2',
      declaredVersion: '1.5.2',
      peerRange: '>=1.4.0 <2.0.0',
    })).toEqual({ ok: true, errors: [] });
  });

  it('fails when the Dockerfile pin drifts from the declared pi version', () => {
    // The exact shape of the drift that produced this Issue: image on one line, sources on another.
    const result = checkPinSync({
      dockerfilePin: '1.4.0',
      declaredVersion: '1.5.2',
      peerRange: '>=1.4.0 <2.0.0',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('does not match the declared pi version');
  });

  it('fails on an unpinned value', () => {
    const result = checkPinSync({
      dockerfilePin: 'latest',
      declaredVersion: '1.5.2',
      peerRange: '>=1.4.0 <2.0.0',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('not a pinned semver version');
  });

  it('fails when the declared version falls outside the peer range', () => {
    const result = checkPinSync({
      dockerfilePin: '1.5.2',
      declaredVersion: '1.5.2',
      peerRange: '^0.80.0',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('outside the extension peer range');
  });

  it('reports a range it cannot read instead of assuming it passes', () => {
    const result = checkPinSync({
      dockerfilePin: '1.5.2',
      declaredVersion: '1.5.2',
      peerRange: '~> 1.5',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('unsupported peer range');
  });

  it('compares release cores and ignores pre-release suffixes', () => {
    expect(compareVersions('1.5.2', '1.5.2')).toBe(0);
    expect(compareVersions('1.5.2-rc.1', '1.5.2')).toBe(0);
    expect(compareVersions('1.4.0', '1.5.2')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('reads the range shapes this repository uses, including caret-on-0.x', () => {
    expect(satisfies('1.5.2', '>=1.4.0 <2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>=1.4.0 <2.0.0')).toBe(false);
    expect(satisfies('0.99.4', '^0.99.0')).toBe(true);
    expect(satisfies('1.4.0', '^0.99.0')).toBe(false);
    expect(satisfies('1.5.2', '1.5.2')).toBe(true);
    expect(satisfies('1.5.1', '1.5.2')).toBe(false);
    expect(satisfies('1.5.2', '*')).toBe(true);
  });
});
