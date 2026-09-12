import { describe, it, expect } from 'vitest';
import {
  EXCLUDED_FILES,
  FORBIDDEN_CLAIMS,
  NATIVE_SECTION_HEADER,
  describeViolation,
  findViolations,
  scanTargets,
  HISTORICAL_SAMPLES,
} from '../../utils/native-vocabulary-guard.js';

describe('native-facing surfaces reject pre-Substrate vocabulary (SPECIALISTS-19)', () => {
  it('scans a non-empty native surface and honours the documented exclusions', () => {
    const targets = scanTargets();
    expect(targets.length).toBeGreaterThanOrEqual(5);
    const scanned = targets.map((target) => target.path);
    for (const exclusion of EXCLUDED_FILES) {
      expect(scanned, `${exclusion.path} is excluded: ${exclusion.reason}`).not.toContain(exclusion.path);
    }
    // The native half of the two-runtime skill is scanned, and only that half.
    const twoRuntime = targets.find((target) => target.path === 'config/skills/using-specialists/SKILL.md');
    expect(twoRuntime?.lines[0]?.text).toMatch(NATIVE_SECTION_HEADER);
  });

  it('finds no pre-Substrate claim on any native-facing surface', () => {
    const violations = findViolations();
    // A failure must name the file, the line and the phrase, so the reader can go straight there.
    expect(violations.map(describeViolation)).toEqual([]);
  });

  it('rejects each forbidden claim when it is present (the guard is not vacuous)', () => {
    for (const claim of FORBIDDEN_CLAIMS) {
      // Every pattern must have at least one known-true historical sample. Without this, a
      // pattern that can never match would silently protect nothing.
      const sample = HISTORICAL_SAMPLES[claim.what];
      expect(sample, `no historical sample for "${claim.what}"`).toBeDefined();
      expect(claim.pattern.test(sample as string), `pattern does not match its own sample: ${claim.what}`).toBe(true);
    }
  });
});
