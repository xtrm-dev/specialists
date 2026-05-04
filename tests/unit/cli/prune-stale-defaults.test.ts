import { afterEach, describe, expect, it, vi } from 'vitest';

const pruneSpy = vi.fn();
const detectDriftSpy = vi.fn(() => []);

vi.mock('../../../src/specialist/drift-detector.js', () => ({
  pruneStaleDefaults: pruneSpy,
  detectDriftForRepo: detectDriftSpy,
}));

describe('prune-stale-defaults cli', () => {
  afterEach(() => {
    pruneSpy.mockClear();
    detectDriftSpy.mockClear();
  });

  it('prints help and skips prune', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };

    const { run } = await import('../../../src/cli/prune-stale-defaults.js');
    await run(['--help']);
    await run(['-h']);

    console.log = originalLog;

    expect(logs[0]).toContain('Usage: sp prune-stale-defaults');
    expect(pruneSpy).not.toHaveBeenCalled();
    expect(detectDriftSpy).not.toHaveBeenCalled();
  });
});
