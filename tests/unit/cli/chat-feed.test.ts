import { describe, expect, it } from 'vitest';
import { ChatFeed, wrapTextWithAnsi } from '../../../src/cli/chat/feed.js';

describe('ChatFeed', () => {
  it('accepts mixed appends and renders recent rows fast', () => {
    const feed = new ChatFeed();
    const styled = '\x1b[32mgreen token stream\x1b[0m';

    const start = performance.now();
    for (let index = 0; index < 1000; index++) {
      feed.appendToken(index % 2 === 0 ? styled : `token-${index}`);
      feed.appendEvent('event', `details-${index}`);
      feed.appendToolStart('bash', `/tmp/file-${index}.ts`);
      feed.appendToolEnd('bash', `done-${index}`);
    }
    const lines = feed.render(80);
    const elapsed = performance.now() - start;

    expect(lines.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10);
  });

  it('preserves ANSI styling across wrap boundary', () => {
    const wrapped = wrapTextWithAnsi('\x1b[31mabcdef\x1b[0m', 3);

    expect(wrapped).toHaveLength(2);
    expect(wrapped[0]).toContain('\x1b[31m');
    expect(wrapped[0]).toContain('\x1b[0m');
    expect(wrapped[1]).toContain('\x1b[31m');
    expect(wrapped[1]).toContain('\x1b[0m');
  });
});
