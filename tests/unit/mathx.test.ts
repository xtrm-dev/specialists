import { describe, expect, it } from 'vitest';
import { clamp } from '../../src/mathx.js';

describe('clamp', () => {
  it('returns value when already inside inclusive bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('returns lower bound when value is below range', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('returns upper bound when value is above range', () => {
    expect(clamp(99, 0, 10)).toBe(10);
  });
});
