// src/tools/substrate/journal.tool.ts
//
// MCP transport over Substrate's JournalService — the durable issue-scoped
// work journal. Hosts resume from here, never from compacted transcripts,
// so every payload is bounded: list caps at 50 rows and entry bodies carry
// a truncation marker instead of raw unbounded text.
//
// The service is injected (getJournal) and typed structurally, never
// imported: @xtrm/substrate is unpublished while this package ships, so a
// module-scope import would break the build for every user. A null service
// yields a payload error, never a throw.

import * as z from 'zod';

const JOURNAL_KINDS = [
  'checkpoint',
  'handoff',
  'milestone',
  'decision',
  'finding',
  'blocker',
  'compaction',
  'note',
] as const;

export const substrateJournalSchema = z.object({
  op: z
    .enum(['append', 'get', 'list', 'since', 'latest_checkpoint', 'checkpoint'])
    .describe('Journal operation to run.'),
  issueId: z.string().optional().describe('Issue the journal belongs to (all ops except get).'),
  entryId: z.string().optional().describe('Entry id (get only).'),
  kind: z
    .enum(JOURNAL_KINDS)
    .optional()
    .describe('Entry kind: required for append, optional filter for list.'),
  cursor: z.number().int().nonnegative().optional().describe('Sequence cursor (since only).'),
  limit: z.number().int().positive().optional().describe('Max rows (list only, capped at 50).'),
  summary: z.string().optional().describe('Summary text (append only, stored as semantic.summary).'),
  runId: z.string().optional().describe('Execution context passthrough (append/checkpoint only).'),
  participantId: z.string().optional().describe('Execution context passthrough (append/checkpoint only).'),
  sessionId: z.string().optional().describe('Execution context passthrough (append/checkpoint only).'),
});

type JournalInput = z.infer<typeof substrateJournalSchema>;

// Structural subset of Substrate's JournalService: only the methods this
// tool calls. Structural typing keeps the build free of the unpublished
// @xtrm/substrate package; the real service satisfies this shape.
export interface JournalServiceLike {
  appendEntry(
    issueId: string,
    input: Record<string, unknown>,
  ): unknown;
  getEntry(id: string): unknown;
  listEntries(issueId: string, opts?: { kind?: string; limit?: number }): unknown[];
  since(issueId: string, cursor: number): { issueId: string; afterSequence: number; entries: unknown[]; nextCursor: number };
  latestCheckpoint(issueId: string): unknown;
  collectMechanical(issueId: string, input?: Record<string, unknown>): Record<string, unknown>;
}

export type GetJournal = () => JournalServiceLike | null;

const LIST_CAP = 50;
const BODY_CAP = 2000;
const UNAVAILABLE = { status: 'error', error: 'substrate journal unavailable' } as const;

function missing(field: string, op: string) {
  return { status: 'error', error: `missing required field '${field}' for op '${op}'` } as const;
}

function fail(error: unknown) {
  return { status: 'error', error: error instanceof Error ? error.message : String(error) } as const;
}

// Bound one entry view: long summary text is cut with a marker carrying the
// original size; long file/commit arrays keep their head plus a total.
function boundEntry(entry: unknown): unknown {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const view = { ...(entry as Record<string, unknown>) };
  const semantic = view.semantic;
  if (semantic !== null && typeof semantic === 'object' && !Array.isArray(semantic)) {
    const sem = { ...(semantic as Record<string, unknown>) };
    if (typeof sem.summary === 'string' && sem.summary.length > BODY_CAP) {
      sem.summary = `${sem.summary.slice(0, BODY_CAP)}…`;
      sem.truncated = true;
      sem.bytes = (semantic as Record<string, unknown>).summary
        ? String((semantic as Record<string, unknown>).summary).length
        : 0;
    }
    view.semantic = sem;
  }
  const mechanical = view.mechanical;
  if (mechanical !== null && typeof mechanical === 'object' && !Array.isArray(mechanical)) {
    const mech = { ...(mechanical as Record<string, unknown>) };
    for (const field of ['changedFiles', 'commitsSincePrevious'] as const) {
      const arr = mech[field];
      if (Array.isArray(arr) && arr.length > LIST_CAP) {
        mech[field] = [...arr.slice(0, LIST_CAP)];
        mech[`${field}Total`] = arr.length;
        mech.truncated = true;
      }
    }
    view.mechanical = mech;
  }
  return view;
}

export function createSubstrateJournalTool(getJournal: GetJournal) {
  return {
    name: 'substrate_journal' as const,
    description:
      'Read or append an issue journal entry (Substrate JournalService). ' +
      'Ops: append | get | list | since | latest_checkpoint | checkpoint. ' +
      'since(issueId, cursor) is the pagination primitive and returns its next cursor. ' +
      'Payloads are bounded: list caps at 50 rows and entry bodies truncate with a marker.',
    inputSchema: substrateJournalSchema,
    async execute(input: JournalInput) {
      const journal = getJournal();
      if (!journal) return UNAVAILABLE;
      try {
        switch (input.op) {
          case 'get': {
            if (!input.entryId) return missing('entryId', 'get');
            return { status: 'ok', entry: boundEntry(journal.getEntry(input.entryId)) };
          }
          case 'list': {
            if (!input.issueId) return missing('issueId', 'list');
            const limit = Math.min(input.limit ?? LIST_CAP, LIST_CAP);
            const entries = journal.listEntries(input.issueId, {
              ...(input.kind ? { kind: input.kind } : {}),
              limit,
            });
            return {
              status: 'ok',
              entries: entries.map(boundEntry),
              count: entries.length,
              capped: entries.length >= LIST_CAP,
            };
          }
          case 'since': {
            if (!input.issueId) return missing('issueId', 'since');
            if (input.cursor === undefined) return missing('cursor', 'since');
            const delta = journal.since(input.issueId, input.cursor);
            return {
              status: 'ok',
              issueId: delta.issueId,
              afterSequence: delta.afterSequence,
              entries: delta.entries.map(boundEntry),
              nextCursor: delta.nextCursor,
            };
          }
          case 'latest_checkpoint': {
            if (!input.issueId) return missing('issueId', 'latest_checkpoint');
            return { status: 'ok', entry: boundEntry(journal.latestCheckpoint(input.issueId)) };
          }
          case 'append': {
            if (!input.issueId) return missing('issueId', 'append');
            if (!input.kind) return missing('kind', 'append');
            const entry = journal.appendEntry(input.issueId, {
              kind: input.kind,
              ...(input.runId ? { runId: input.runId } : {}),
              ...(input.participantId ? { participantId: input.participantId } : {}),
              ...(input.sessionId ? { sessionId: input.sessionId } : {}),
              ...(input.summary ? { semantic: { summary: input.summary } } : {}),
            });
            return { status: 'ok', entry: boundEntry(entry) };
          }
          case 'checkpoint': {
            if (!input.issueId) return missing('issueId', 'checkpoint');
            const mechanical = journal.collectMechanical(input.issueId, {
              ...(input.runId ? { runId: input.runId } : {}),
              ...(input.participantId ? { participantId: input.participantId } : {}),
              ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            });
            const entry = journal.appendEntry(input.issueId, {
              kind: 'checkpoint',
              ...(input.runId ? { runId: input.runId } : {}),
              ...(input.participantId ? { participantId: input.participantId } : {}),
              ...(input.sessionId ? { sessionId: input.sessionId } : {}),
              mechanical,
            });
            return { status: 'ok', entry: boundEntry(entry), degraded: false };
          }
          default:
            return { status: 'error', error: `unknown op: ${String((input as { op?: unknown }).op)}` };
        }
      } catch (error) {
        return fail(error);
      }
    },
  };
}
