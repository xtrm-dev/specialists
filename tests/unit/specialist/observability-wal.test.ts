import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_WAL_SIZE_LIMIT_BYTES,
  WAL_AUTOCHECKPOINT_PAGES,
  applyWalRuntimePragmas,
  createObservabilitySqliteClientAtPath,
  resolveWalSizeLimitBytes,
} from '../../../src/specialist/observability-sqlite.js';
import { createForensicEvent } from '../../../src/specialist/forensic-events.js';

/**
 * SPECIALISTS-4219: the observability -wal file grew to 1.5 GB on a 4.98 GB database.
 *
 * Two independent facts, both reproduced here:
 *  1. WITHOUT a blocking reader, a checkpoint copies every frame and the WAL FILE STILL does
 *     not shrink — SQLite resets the WAL to frame 0 but never truncates the file. The
 *     production file sat at 1.5 GB while its live content was 830 frames (3.4 MB).
 *  2. WITH one reader holding a read transaction, no checkpoint can pass that reader's
 *     snapshot, so the WAL grows by every write until the reader lets go. That is the window
 *     that produced the 1.5 GB high-water mark in the first place.
 *
 * The fix is `journal_size_limit` (reclaim the file at every reset) plus the explicit
 * autocheckpoint threshold, applied on EVERY connection by applyWalRuntimePragmas, plus a
 * checkpoint owner (`specialists db checkpoint`) for the reclaim that must wait for readers.
 */
describe('observability WAL bounding', () => {
  const PAGE_SIZE = 4096;
  // One autocheckpoint window: below this, "the WAL grew" means nothing.
  const AUTOCHECKPOINT_BYTES = WAL_AUTOCHECKPOINT_PAGES * PAGE_SIZE;

  let tempRoot: string;
  let dbPath: string;
  let client: ReturnType<typeof createObservabilitySqliteClientAtPath>;
  let readers: Database[];

  const walBytes = (): number => {
    try {
      return statSync(`${dbPath}-wal`).size;
    } catch {
      return 0;
    }
  };

  /**
   * Write forensic rows the way the MCP gateway does: one autocommit per event. The filler
   * only makes each row span many pages, so a few hundred writes produce the megabytes of
   * WAL frames the assertions need without a slow test; the mechanism under test is frame
   * count, not payload realism.
   */
  const writeForensicRows = (count: number, fillerBytes: number): void => {
    for (let index = 0; index < count; index += 1) {
      client.appendForensicEvent('mcp-gateway', 'specialists-mcp', undefined, createForensicEvent({
        event_family: 'mcp',
        event_name: 'mcp.call.completed',
        severity: 'info',
        resource: { service_namespace: 'xtrm', service_name: 'specialists', service_component: 'mcp-gateway', deployment_environment: 'test', repo: 'specialists', participant_kind: 'adapter', participant_role: 'specialists-mcp' },
        correlation: { mcp_session_id: 'session', trace_id: `trace-${index}`, span_id: `span-${index}` },
        body: { tool_name: 'specialist_status', filler: 'x'.repeat(fillerBytes) },
        redaction: { status: 'clean' },
      }));
    }
  };

  beforeEach(() => {
    tempRoot = join(tmpdir(), `test-observability-wal-${crypto.randomUUID()}`);
    mkdirSync(tempRoot, { recursive: true });
    dbPath = join(tempRoot, 'observability.db');
    readers = [];
    client = createObservabilitySqliteClientAtPath(dbPath)!;
    expect(client).not.toBeNull();
  });

  afterEach(() => {
    for (const reader of readers) {
      try { reader.close(); } catch { /* already closed */ }
    }
    readers = [];
    try { client?.close(); } catch { /* already closed */ }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('applies the checkpoint threshold and the WAL size limit on every connection', () => {
    const reader = new Database(dbPath);
    readers.push(reader);
    applyWalRuntimePragmas(reader);

    const autocheckpoint = reader.query('PRAGMA wal_autocheckpoint').get() as { wal_autocheckpoint?: number };
    const sizeLimit = reader.query('PRAGMA journal_size_limit').get() as { journal_size_limit?: number };

    expect(autocheckpoint.wal_autocheckpoint).toBe(WAL_AUTOCHECKPOINT_PAGES);
    expect(sizeLimit.journal_size_limit).toBe(DEFAULT_WAL_SIZE_LIMIT_BYTES);
    expect(resolveWalSizeLimitBytes()).toBe(DEFAULT_WAL_SIZE_LIMIT_BYTES);
  });

  it('reproduces the growth: one held read transaction lets the WAL grow past the bound, and the checkpoint owner reclaims it after release', () => {
    // Second connection: a reader that opens a read transaction and never closes it, exactly
    // like a long poll or an unbounded scan on another connection to the shared database.
    const reader = new Database(dbPath, { readonly: true });
    readers.push(reader);
    reader.exec('BEGIN');
    reader.query('SELECT COUNT(*) AS count FROM specialist_forensic_events').get();

    writeForensicRows(600, 32 * 1024);
    const blockedWalBytes = walBytes();
    const blocked = client.checkpointWal('PASSIVE');

    // The regression, in one assertion: the WAL passed the autocheckpoint window by a wide
    // margin and the checkpoint could not clear it, because that reader is behind.
    expect(blockedWalBytes).toBeGreaterThan(AUTOCHECKPOINT_BYTES * 4);
    expect(blocked.checkpointedFrames).toBeLessThan(blocked.logFrames);

    // Before the fix nothing ever brought the file back: a PASSIVE checkpoint that copies
    // every frame still leaves the file at its high-water mark.
    reader.exec('COMMIT');
    const passive = client.checkpointWal('PASSIVE');
    expect(passive.checkpointedFrames).toBe(passive.logFrames);
    expect(client.getWalSizeBytes()).toBeGreaterThan(AUTOCHECKPOINT_BYTES * 4);

    // The checkpoint owner reclaims it. TRUNCATE is the one mode that shrinks the FILE.
    const truncated = client.checkpointWal('TRUNCATE');
    expect(truncated.busy).toBe(0);
    expect(truncated.afterWalBytes).toBeLessThanOrEqual(DEFAULT_WAL_SIZE_LIMIT_BYTES);
    expect(client.getWalSizeBytes()).toBe(truncated.afterWalBytes);

    // And it stays bounded: further traffic under the same limit never regrows the file past it.
    writeForensicRows(600, 32 * 1024);
    client.checkpointWal('PASSIVE');
    expect(client.getWalSizeBytes()).toBeLessThanOrEqual(DEFAULT_WAL_SIZE_LIMIT_BYTES);
  });

  it('bounds the WAL file in steady state, with no reader holding a transaction', () => {
    writeForensicRows(400, 32 * 1024);
    client.checkpointWal('PASSIVE');
    expect(client.getWalSizeBytes()).toBeLessThanOrEqual(DEFAULT_WAL_SIZE_LIMIT_BYTES);

    writeForensicRows(400, 32 * 1024);
    client.checkpointWal('PASSIVE');
    expect(client.getWalSizeBytes()).toBeLessThanOrEqual(DEFAULT_WAL_SIZE_LIMIT_BYTES);
    expect(existsSync(dbPath)).toBe(true);
  });

  it('honours SPECIALISTS_WAL_SIZE_LIMIT_BYTES and ignores nonsense values', () => {
    const previous = process.env.SPECIALISTS_WAL_SIZE_LIMIT_BYTES;
    try {
      process.env.SPECIALISTS_WAL_SIZE_LIMIT_BYTES = String(1024 * 1024);
      expect(resolveWalSizeLimitBytes()).toBe(1024 * 1024);

      const reader = new Database(dbPath);
      readers.push(reader);
      applyWalRuntimePragmas(reader);
      expect((reader.query('PRAGMA journal_size_limit').get() as { journal_size_limit?: number }).journal_size_limit).toBe(1024 * 1024);

      process.env.SPECIALISTS_WAL_SIZE_LIMIT_BYTES = 'not-a-number';
      expect(resolveWalSizeLimitBytes()).toBe(DEFAULT_WAL_SIZE_LIMIT_BYTES);
    } finally {
      if (previous === undefined) delete process.env.SPECIALISTS_WAL_SIZE_LIMIT_BYTES;
      else process.env.SPECIALISTS_WAL_SIZE_LIMIT_BYTES = previous;
    }
  });

  it('reports the WAL size and checkpoint outcome without touching the data', () => {
    writeForensicRows(50, 100);
    const report = client.checkpointWal('PASSIVE');

    expect(report.mode).toBe('PASSIVE');
    expect(report.busy).toBe(0);
    expect(report.logFrames).toBeGreaterThan(0);
    expect(report.checkpointedFrames).toBeLessThanOrEqual(report.logFrames);
    expect(report.afterWalBytes).toBe(client.getWalSizeBytes());

    const verifier = new Database(dbPath, { readonly: true });
    readers.push(verifier);
    const rows = verifier.query('SELECT COUNT(*) AS count FROM specialist_forensic_events').get() as { count: number };
    expect(rows.count).toBe(50);
  });
});