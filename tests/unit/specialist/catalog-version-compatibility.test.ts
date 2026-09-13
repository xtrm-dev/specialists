import { describe, expect, it } from 'vitest';
import { resolveCatalogVersionVerdict } from '../../../src/specialist/tool-catalog.js';

/**
 * The catalog compatibility rule (SPECIALISTS-42).
 *
 * Pure and table-driven on purpose: it takes no filesystem and no installed package, so it
 * cannot become a machine-dependent test — the defect class where a test passes or fails
 * according to what happens to be installed on the host.
 */
describe('catalog version compatibility', () => {
  const cases: Array<{ installed: string; baseline: string; compatible: boolean; why: string }> = [
    { installed: '0.6.4', baseline: '0.6.4', compatible: true, why: 'the baseline itself' },
    { installed: '0.6.5', baseline: '0.6.4', compatible: true, why: 'patch above baseline, same 0.x line' },
    { installed: '0.6.3', baseline: '0.6.4', compatible: false, why: 'older than the baseline' },
    { installed: '0.7.0', baseline: '0.6.4', compatible: false, why: '0.x minor bump is a break (caret semantics)' },
    { installed: '0.5.9', baseline: '0.6.4', compatible: false, why: 'earlier minor line' },
    { installed: '1.2.0', baseline: '1.2.0', compatible: true, why: 'the baseline itself, major > 0' },
    { installed: '1.9.0', baseline: '1.2.0', compatible: true, why: 'same major, above baseline' },
    { installed: '1.2.0', baseline: '1.9.0', compatible: false, why: 'downgrade inside one major' },
    { installed: '2.0.0', baseline: '1.9.0', compatible: false, why: 'major break' },
    { installed: '0.0.3', baseline: '0.0.3', compatible: true, why: '0.0.x matches exactly' },
    { installed: '0.0.4', baseline: '0.0.3', compatible: false, why: '0.0.x is exact-only' },
    { installed: '0.0.2', baseline: '0.0.3', compatible: false, why: '0.0.x is exact-only' },
  ];

  for (const { installed, baseline, compatible, why } of cases) {
    it(`${installed} vs baseline ${baseline} -> ${compatible ? 'compatible' : 'incompatible'} (${why})`, () => {
      expect(resolveCatalogVersionVerdict(installed, baseline).compatible).toBe(compatible);
    });
  }

  it('fails closed and names the reason for a prerelease', () => {
    const verdict = resolveCatalogVersionVerdict('0.6.5-beta.1', '0.6.4');
    expect(verdict.compatible).toBe(false);
    expect(verdict.reason).toContain('not comparable');
  });

  it('fails closed and names the reason for an unparseable version', () => {
    expect(resolveCatalogVersionVerdict('not-a-version', '0.6.4').compatible).toBe(false);
  });

  it('treats a range as not comparable rather than guessing', () => {
    const verdict = resolveCatalogVersionVerdict('0.6.4', '^0.6.4');
    expect(verdict.compatible).toBe(false);
    expect(verdict.reason).toContain('not comparable');
  });

  it('names both versions in the out-of-range reason, so the drift is diagnosable', () => {
    const verdict = resolveCatalogVersionVerdict('0.7.0', '0.6.4');
    expect(verdict.reason).toContain('0.7.0');
    expect(verdict.reason).toContain('0.6.4');
    expect(verdict.reason).toContain('outside the compatible range');
  });
});
