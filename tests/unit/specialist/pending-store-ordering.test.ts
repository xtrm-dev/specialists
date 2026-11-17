// SPECIALISTS-4436: two asks recorded in the same millisecond must have a stable order.
// The sort used to compare createdAtMs only, so the result was readdir order — a flaky
// expectation for every caller that lists outstanding asks.
import { rmSync } from 'node:fs';


import { afterEach, describe, expect, it } from 'vitest';

import { create, listAll } from '../../../src/activation/transport/pending-store.js';
import { projectOutstandingAsks } from '../../../src/activation/transport/polling.js';
import { tempDir } from '../../utils/temp-dir.js';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function freshRoot(): string {
  const root = tempDir('pending-order-');
  roots.push(root);
  return root;
}

describe('pending interaction ordering', () => {
  it('orders tied timestamps by message id, not by the order files landed on disk', () => {
    const root = freshRoot();
    const createdAtMs = 1_700_000_000_000;
    // Eight activations, one ask each, all in the same millisecond. The ids are written
    // odds-then-evens, an order that is unsorted forwards AND backwards, so no filesystem
    // readdir direction can accidentally produce the expected order.
    const ids = ['m-1', 'm-3', 'm-5', 'm-7', 'm-0', 'm-2', 'm-4', 'm-6'];
    const pairs = ids.map((messageId, index) => ({ activationId: `act:a${index}`, messageId }));

    for (const { activationId, messageId } of pairs) {
      create(root, {
        messageId,
        activationId,
        kind: 'question',
        message: { kind: 'question', body: 'ping' } as never,
        createdAtMs,
      });
    }

    expect(listAll(root).map(view => view.messageId)).toEqual(pairs.map(pair => pair.messageId).sort());
  });

  it('keeps that order in the coordinator projection', () => {
    const root = freshRoot();
    const createdAtMs = 1_700_000_000_001;
    for (const messageId of ['m-2', 'm-1']) {
      create(root, {
        messageId,
        activationId: 'act:tie2',
        kind: 'question',
        message: { kind: 'question', body: 'ping' } as never,
        createdAtMs,
      });
    }

    expect(projectOutstandingAsks(root).map(ask => ask.message_id)).toEqual(['m-1', 'm-2']);
  });
});
