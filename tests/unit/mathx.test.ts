import { describe, expect, it } from 'vitest';
import { clamp } from '../../src/mathx';

describe('clamp', () => {
  it('returns n when n is inside inclusive bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('raises values below lower bound to lo', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });

  it('lowers values above upper bound to hi', () => {
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
