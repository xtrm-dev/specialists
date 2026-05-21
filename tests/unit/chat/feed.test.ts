import { describe, expect, it } from 'vitest';
import { wrapTextWithAnsi } from '@earendil-works/pi-tui';
import { ChatFeed } from '../../../src/cli/chat/feed.js';

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeVisibleText(random: () => number, length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789 ';
  let text = '';
  for (let index = 0; index < length; index++) {
    text += alphabet[Math.floor(random() * alphabet.length)];
  }
  return text.trim() || 'x';
}

function makeRows(seed: number): Array<{ kind: 'token' | 'tool' | 'event' | 'result'; text: string }> {
  const random = createSeededRandom(seed);
  const rows: Array<{ kind: 'token' | 'tool' | 'event' | 'result'; text: string }> = [];
  for (let index = 0; index < 12; index++) {
    const kind = ['token', 'tool', 'event', 'result'][Math.floor(random() * 4)] as 'token' | 'tool' | 'event' | 'result';
    const length = 4 + Math.floor(random() * 36);
    rows.push({ kind, text: makeVisibleText(random, length) });
  }
  return rows;
}

describe('ChatFeed', () => {
  it('renders mixed rows at width 80', () => {
    const feed = new ChatFeed();
    feed.appendToken('alpha token');
    feed.appendToolStart('bash', '/tmp/demo.ts');
    feed.appendEvent('event', 'details here');
    feed.appendResult('done');
    feed.appendToolEnd('bash', 'complete');

    const lines = feed.render(80);

    expect(lines).toEqual([
      'alpha token',
      '▶ bash /tmp/demo.ts',
      'event: details here',
      'done',
      '✓ bash complete',
    ]);
  });

  it('preserves ANSI codes across wrap boundary', () => {
    const feed = new ChatFeed();
    feed.appendToken('\x1b[31mredredred\x1b[0m');

    const rendered = feed.render(4);
    expect(rendered).toEqual(wrapTextWithAnsi('\x1b[31mredredred\x1b[0m', 4));
    expect(rendered[0].startsWith('\x1b[31m')).toBe(true);
    expect(rendered.at(-1)?.endsWith('\x1b[0m')).toBe(true);
    expect(stripAnsi(rendered.join(''))).toBe('redredred');
  });

  it('keeps visible width within bound for fixed seeded sequences', () => {
    for (const [seed, width] of [[1, 20], [2, 37], [3, 80], [4, 200]] as const) {
      const feed = new ChatFeed();
      for (const row of makeRows(seed)) {
        if (row.kind === 'token') feed.appendToken(row.text);
        if (row.kind === 'tool') feed.appendToolStart('tool', row.text);
        if (row.kind === 'event') feed.appendEvent('event', row.text);
        if (row.kind === 'result') feed.appendResult(row.text);
      }

      for (const line of feed.render(width)) {
        expect(stripAnsi(line).length).toBeLessThanOrEqual(width);
      }
    }
  });

  it('preserves visible content across wrapped lines for fixed seeded sequences', () => {
    for (const seed of [11, 22, 33, 44]) {
      const feed = new ChatFeed();
      const rows = makeRows(seed);
      for (const row of rows) {
        if (row.kind === 'token') feed.appendToken(row.text);
        if (row.kind === 'tool') feed.appendToolStart('tool', row.text);
        if (row.kind === 'event') feed.appendEvent('event', row.text);
        if (row.kind === 'result') feed.appendResult(row.text);
      }

      const width = 20 + (seed % 5) * 30;
      const rendered = feed.render(width);
      const sourceVisible = rows
        .map((row) => (row.kind === 'tool' ? `▶ tool ${row.text}` : row.kind === 'event' ? `event: ${row.text}` : row.text))
        .join('');

      expect(stripAnsi(rendered.join(''))).toBe(sourceVisible);
    }
  });
});
