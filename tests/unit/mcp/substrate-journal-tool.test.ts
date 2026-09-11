import { describe, it, expect } from 'vitest';
import { createSubstrateJournalTool, type JournalServiceLike } from '../../../src/tools/substrate/journal.tool.js';

/**
 * Journal tool tests (unitAI-aiwva.10). Fake stands in for the unpublished
 * @xtrm/substrate JournalService; the tool only needs the structural shape.
 */
function fakeEntry(seq: number, summary = `summary ${seq}`) {
  return {
    id: `jrn_${seq}`,
    issueId: 'iss-1',
    issueRevision: 1,
    sequence: seq,
    runId: null,
    participantId: null,
    activationId: null,
    sessionId: null,
    kind: 'note',
    mechanical: null,
    semantic: { summary },
    refs: [],
    createdAt: Date.now(),
  };
}

function fakeJournal(): JournalServiceLike & { entries: ReturnType<typeof fakeEntry>[] } {
  const entries = [fakeEntry(1), fakeEntry(2), fakeEntry(3, 'checkpoint here')];
  return {
    entries,
    appendEntry(issueId: string, input: Record<string, unknown>) {
      const entry = {
        ...fakeEntry(entries.length + 1),
        issueId,
        kind: (input.kind as string) ?? 'note',
        semantic: input.semantic ?? null,
        mechanical: (input.mechanical as null) ?? null,
      };
      entries.push(entry as ReturnType<typeof fakeEntry>);
      return entry;
    },
    getEntry(id: string) {
      const found = entries.find((e) => e.id === id);
      if (!found) throw new Error(`unknown entry: ${id}`);
      return found;
    },
    listEntries(_issueId: string, opts?: { kind?: string; limit?: number }) {
      const rows = opts?.kind ? entries.filter((e) => e.kind === opts.kind) : [...entries];
      return opts?.limit !== undefined ? rows.slice(0, opts.limit) : rows;
    },
    since(issueId: string, cursor: number) {
      const rows = entries.filter((e) => e.sequence > cursor);
      return { issueId, afterSequence: cursor, entries: rows, nextCursor: rows.at(-1)?.sequence ?? cursor };
    },
    latestCheckpoint(_issueId: string) {
      return null;
    },
    collectMechanical(issueId: string) {
      return { issueId, issueRevision: 1, contractHash: 'h', collectedAt: Date.now() };
    },
  };
}

describe('substrate journal tool', () => {
  it('get returns a bounded entry', async () => {
    const tool = createSubstrateJournalTool(() => fakeJournal());
    const result = (await tool.execute({ op: 'get', entryId: 'jrn_1' })) as { status: string; entry: { id: string } };
    expect(result.status).toBe('ok');
    expect(result.entry.id).toBe('jrn_1');
  });

  it('list caps at 50 and reports the cap', async () => {
    const journal = fakeJournal();
    for (let i = 0; i < 60; i++) journal.entries.push(fakeEntry(100 + i));
    const tool = createSubstrateJournalTool(() => journal);
    const result = (await tool.execute({ op: 'list', issueId: 'iss-1', limit: 500 })) as {
      status: string;
      entries: unknown[];
      count: number;
      capped: boolean;
    };
    expect(result.status).toBe('ok');
    expect(result.entries.length).toBeLessThanOrEqual(50);
    expect(result.capped).toBe(true);
  });

  it('since returns the pagination delta with next cursor', async () => {
    const tool = createSubstrateJournalTool(() => fakeJournal());
    const result = (await tool.execute({ op: 'since', issueId: 'iss-1', cursor: 1 })) as {
      status: string;
      entries: { sequence: number }[];
      nextCursor: number;
    };
    expect(result.status).toBe('ok');
    expect(result.entries.every((e) => e.sequence > 1)).toBe(true);
    expect(result.nextCursor).toBe(3);
  });

  it('latest_checkpoint returns null when no checkpoint exists', async () => {
    const tool = createSubstrateJournalTool(() => fakeJournal());
    const result = (await tool.execute({ op: 'latest_checkpoint', issueId: 'iss-1' })) as {
      status: string;
      entry: unknown;
    };
    expect(result.status).toBe('ok');
    expect(result.entry).toBeNull();
  });

  it('append stores the summary and checkpoint writes a mechanical entry', async () => {
    const journal = fakeJournal();
    const tool = createSubstrateJournalTool(() => journal);
    const appended = (await tool.execute({ op: 'append', issueId: 'iss-1', kind: 'finding', summary: 'found it' })) as {
      status: string;
      entry: { kind: string; semantic: { summary: string } };
    };
    expect(appended.status).toBe('ok');
    expect(appended.entry.semantic.summary).toBe('found it');
    const checkpointed = (await tool.execute({ op: 'checkpoint', issueId: 'iss-1' })) as {
      status: string;
      entry: { kind: string };
      degraded: boolean;
    };
    expect(checkpointed.status).toBe('ok');
    expect(checkpointed.entry.kind).toBe('checkpoint');
    expect(checkpointed.degraded).toBe(false);
  });

  it('truncates long bodies with a marker', async () => {
    const journal = fakeJournal();
    journal.entries.push(fakeEntry(9, 'x'.repeat(5000)));
    const tool = createSubstrateJournalTool(() => journal);
    const result = (await tool.execute({ op: 'get', entryId: 'jrn_9' })) as {
      status: string;
      entry: { semantic: { summary: string; truncated: boolean; bytes: number } };
    };
    expect(result.entry.semantic.truncated).toBe(true);
    expect(result.entry.semantic.bytes).toBe(5000);
    expect(result.entry.semantic.summary.length).toBeLessThan(5000);
  });

  it('null service yields a payload error, never a throw', async () => {
    const tool = createSubstrateJournalTool(() => null);
    for (const op of ['get', 'list', 'since', 'latest_checkpoint', 'append', 'checkpoint'] as const) {
      const result = (await tool.execute({ op, issueId: 'iss-1', entryId: 'jrn_1', cursor: 0 })) as {
        status: string;
        error: string;
      };
      expect(result.status).toBe('error');
      expect(result.error).toBe('substrate journal unavailable');
    }
  });

  it('per-op validation names the missing field', async () => {
    const tool = createSubstrateJournalTool(() => fakeJournal());
    const cases = [
      [{ op: 'get' }, 'entryId'],
      [{ op: 'list' }, 'issueId'],
      [{ op: 'since', issueId: 'iss-1' }, 'cursor'],
      [{ op: 'append', issueId: 'iss-1' }, 'kind'],
      [{ op: 'checkpoint' }, 'issueId'],
    ] as const;
    for (const [args, field] of cases) {
      const result = (await tool.execute(args as never)) as { status: string; error: string };
      expect(result.status).toBe('error');
      expect(result.error).toContain(field);
    }
  });

  it('service throws surface as payload errors', async () => {
    const tool = createSubstrateJournalTool(() => fakeJournal());
    const result = (await tool.execute({ op: 'get', entryId: 'nope' })) as { status: string; error: string };
    expect(result.status).toBe('error');
    expect(result.error).toContain('unknown entry');
  });
});
