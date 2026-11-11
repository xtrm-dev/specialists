import { connect } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MAX_RETAINED_RECEIPTS,
  RECEIPT_TTL_MS,
  createSocketReceiptSource,
  receiptExpired,
  type ReceiptSource,
} from '../../../src/activation/transport/peer-transport.js';

const sources: ReceiptSource[] = [];

afterEach(async () => {
  while (sources.length > 0) await sources.pop()!.close();
});

async function startSource(): Promise<{ source: ReceiptSource; socketPath: string }> {
  const socketPath = join(mkdtempSync(join(tmpdir(), 'receipt-bound-')), 'r.sock');
  const source = await createSocketReceiptSource(socketPath);
  sources.push(source);
  return { source, socketPath };
}

const controlFrame = (id: string) => ({ type: 'control', action: 'peer_message_status', orig_msg_id: id, status: 'delivered' });

/** Send many frames over ONE connection: the peer multiplexes, and it keeps floods fast. */
function sendMany(socketPath: string, ids: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath, () => {
      const chunkSize = 200;
      for (let offset = 0; offset < ids.length; offset += chunkSize) {
        const chunk = ids.slice(offset, offset + chunkSize).map((id) => `${JSON.stringify(controlFrame(id))}\n`).join('');
        socket.write(chunk);
      }
      socket.end();
    });
    socket.on('error', reject);
    socket.on('close', () => resolve());
  });
}

function collectGarbage(): void {
  const bun = (globalThis as { Bun?: { gc?: (force: boolean) => void } }).Bun;
  bun?.gc?.(true);
}

describe('retained receipts are bounded', () => {
  it('holds the count bound and drops the oldest receipts first', async () => {
    const { source, socketPath } = await startSource();
    const flood = Array.from({ length: MAX_RETAINED_RECEIPTS + 200 }, (_, index) => `act:flood-${index}`);
    await sendMany(socketPath, flood);

    expect(source.retainedCount?.()).toBe(MAX_RETAINED_RECEIPTS);
    // Oldest evicted, newest retained.
    expect(await source.waitForReceipt('act:flood-0', 0)).toBeUndefined();
    expect(await source.waitForReceipt(`act:flood-${flood.length - 1}`, 0)).toBeDefined();
  });

  it('still resolves a waiter registered after an early receipt arrives', async () => {
    // The protocol guarantee: a fast peer's receipt can land before the sender asks for it.
    const { source, socketPath } = await startSource();
    await sendMany(socketPath, ['act:early']);
    const frame = await source.waitForReceipt('act:early', 0);
    expect(frame?.orig_msg_id).toBe('act:early');
  });

  it('still resolves a waiter registered before the receipt arrives', async () => {
    const { source, socketPath } = await startSource();
    const pending = source.waitForReceipt('act:pending', 2000);
    await sendMany(socketPath, ['act:pending']);
    expect((await pending)?.orig_msg_id).toBe('act:pending');
  });

  it('expires a receipt after the retention window', () => {
    expect(receiptExpired(0, RECEIPT_TTL_MS - 1)).toBe(false);
    expect(receiptExpired(0, RECEIPT_TTL_MS)).toBe(true);
  });

  it('keeps heap growth for a flood far below the unbounded measurement', async () => {
    const { source, socketPath } = await startSource();
    const flood = Array.from({ length: MAX_RETAINED_RECEIPTS * 20 }, (_, index) => `act:heap-${index}`);

    collectGarbage();
    const before = process.memoryUsage().heapUsed;
    await sendMany(socketPath, flood);
    collectGarbage();
    const growth = process.memoryUsage().heapUsed - before;

    expect(source.retainedCount?.()).toBe(MAX_RETAINED_RECEIPTS);
    // SPECIALISTS-4433 measured ~1.2 MB retained for 2000 frames when nothing was evicted, i.e.
    // ~600 B/frame; an unbounded store would keep this flood (~10k frames) at roughly 6 MB.
    expect(growth).toBeLessThan(3 * 1024 * 1024);
  });
});
