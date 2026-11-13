// CORE-2694 / SPECIALISTS-4495: contract-section parsing runs on caller-supplied
// text, so a backtracking pattern is a ReDoS surface (CodeQL js/polynomial-redos
// alerts 3, 4 and 5). These tests pin the linear behaviour and the parse rules
// the manual scans replaced.
import { describe, expect, it } from 'vitest';

import { extractSections, scrutinyLevel } from '../../../src/activation/contract-sections.js';

function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

describe('contract sections: linear parsing (CORE-2694)', () => {
  it('heading split stays linear on a long space run before the colon', () => {
    // Old /^([A-Za-z][A-Za-z _-]*?)\s*:\s*(.*)$/ backtracked over the run.
    const description = 'PROBLEM' + ' '.repeat(200000) + ': body\n';
    const { value, ms } = timed(() => extractSections(description));
    expect(ms).toBeLessThan(100);
    expect(value.get('PROBLEM')).toBe('body');
  });

  it('scrutinyLevel stays linear on a long tab run after the heading', () => {
    // Old /SCRUTINY\b[^\n]*\n?\s*\**\s*(LEVEL)/ backtracked over the run.
    const description = 'SCRUTINY' + '\t'.repeat(200000) + '\n';
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

  it('reads the declared scrutiny level in both accepted shapes', () => {
    expect(scrutinyLevel('SCRUTINY\nMEDIUM')).toBe('MEDIUM');
    expect(scrutinyLevel('SCRUTINY: HIGH')).toBe('HIGH');
    expect(scrutinyLevel('**SCRUTINY** — critical')).toBe('CRITICAL');
  });
});
