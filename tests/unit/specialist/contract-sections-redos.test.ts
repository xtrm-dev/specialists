// CORE-2694 / SPECIALISTS-4495: contract-section parsing runs on caller-supplied
// text, so a backtracking pattern is a ReDoS surface (CodeQL js/polynomial-redos
// alerts 3, 4 and 5). These tests pin the linear behaviour and the parse rules
// the manual scans replaced.
import { describe, expect, it } from 'vitest';

import {
  extractSections,
  scrutinyLevel,
  SCRUTINY_LEVEL_WINDOW,
} from '../../../src/activation/contract-sections.js';

function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

describe('contract sections: linear parsing (CORE-2694)', () => {
  it('heading split stays linear when a space run never reaches a colon', () => {
    // Discriminating: the run must have NO colon after it. With a colon present
    // the old /^([A-Za-z][A-Za-z _-]*?)\s*:\s*(.*)$/ matched on its first
    // attempt (0 ms), so the test passed pre-fix; without one it backtracks the
    // whole run (~400 ms at 40k).
    const description = 'PROBLEM' + ' '.repeat(40000) + 'x\n';
    const { value, ms } = timed(() => extractSections(description));
    expect(ms).toBeLessThan(100);
    expect(value.has('PROBLEM')).toBe(false); // no colon: not a heading
  });

  it('scrutinyLevel stays linear on a long tab run after the heading', () => {
    // Old /SCRUTINY\b[^\n]*\n?\s*\**\s*(LEVEL)/ backtracked over the run:
    // 4000 tabs cost 6.8 s, so this test HANGS on master rather than failing,
    // which is a worse signal than a red assertion. 2000 tabs keeps the old
    // cost near 1.7 s — clearly over the bound, and the suite still finishes.
    const description = 'SCRUTINY' + '\t'.repeat(2000) + '\n';
    const { value, ms } = timed(() => scrutinyLevel(description));
    expect(ms).toBeLessThan(100);
    expect(value).toBeUndefined();
  });

  it('keeps the section rules the parser documented', () => {
    // Inline body after the colon is the section's first body line.
    expect(extractSections('PROBLEM: the body\nSUCCESS: ok\n').get('PROBLEM')).toBe('the body');
    // A section name inside prose is not a heading: the name must start the line.
    expect(extractSections('see OUTPUT: below').has('OUTPUT')).toBe(false);
    // Empty body is "declared but empty", distinct from absent.
    expect(extractSections('PROBLEM:\n')).toBeTruthy();
    expect(extractSections('PROBLEM:\n').get('PROBLEM')).toBe('');
    // Bold and heading markers are still stripped.
    expect(extractSections('**PROBLEM:** body\n').get('PROBLEM')).toBe('body');
    expect(extractSections('## PROBLEM\nbody\n').get('PROBLEM')).toBe('body');
  });

  it('treats Unicode whitespace around the colon like the old \\s* did', () => {
    // The scan replaced /\\s*/, so NBSP and friends must stay separators: a
    // narrowing here would refuse a contract that parsed before.
    for (const space of ['\u00a0', '\u2028', '\u2003', '\ufeff', ' ', '\t']) {
      expect(extractSections(`PROBLEM${space}: body${space}\n`).get('PROBLEM')).toBe('body');
    }
  });

  it('bounds the SCRUTINY level window and says so', () => {
    // A deliberate narrowing: the level must sit within SCRUTINY_LEVEL_WINDOW
    // characters of the heading (the unbounded form cost 6.8 s on tabs).
    expect(scrutinyLevel('SCRUTINY' + ' '.repeat(SCRUTINY_LEVEL_WINDOW) + 'HIGH')).toBe('HIGH');
    // The window plus the bounded separator runs (20 + 20) is the hard ceiling,
    // so a gap well past it must not resolve.
    expect(scrutinyLevel('SCRUTINY' + ' '.repeat(SCRUTINY_LEVEL_WINDOW + 200) + 'high')).toBeUndefined();
  });

  it('reads the declared scrutiny level in both accepted shapes', () => {
    expect(scrutinyLevel('SCRUTINY\nMEDIUM')).toBe('MEDIUM');
    expect(scrutinyLevel('SCRUTINY: HIGH')).toBe('HIGH');
    expect(scrutinyLevel('**SCRUTINY** — critical')).toBe('CRITICAL');
  });
});
