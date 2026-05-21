import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

describe('appendBeadNote', () => {
  it('times out when bd reader stays dead', async () => {
    vi.useFakeTimers();
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as any;
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      return child;
    });

    const { appendBeadNote } = await import('../../../src/specialist/bead-notes.js');
    const promise = appendBeadNote('bd.1', 'note text', { timeoutMs: 25 });

    await vi.advanceTimersByTimeAsync(25);
    await expect(promise).resolves.toEqual({ ok: false, error: 'bd update timed out after 25ms' });

    vi.useRealTimers();
  });
});
