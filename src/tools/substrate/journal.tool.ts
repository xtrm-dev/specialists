// src/tools/substrate/journal.tool.ts
//
// MCP transport over Substrate's JournalService — the durable issue-scoped
// work journal. Hosts resume from here, never from compacted transcripts,
// so every payload is bounded: list caps at 50 rows and entry bodies carry
// a truncation marker instead of raw unbounded text.
//
// The service is injected (getJournal) and typed structurally, never
// imported: @jaggerxtrm/substrate is an optional peer this package does not
// depend on, so a module-scope import would break the build wherever it is
// absent. A null service yields a payload error, never a throw.

import * as z from 'zod';
import { resolveSubstrate, substrateUnavailablePayload } from '../../substrate/services.js';

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
  issue_id: z.string().optional().describe('Issue the journal belongs to (all ops except get).'),
  entry_id: z.string().optional().describe('Entry id (get only).'),
  kind: z
    .enum(JOURNAL_KINDS)
    .optional()
    .describe('Entry kind: required for append, optional filter for list.'),
  cursor: z.number().int().nonnegative().optional().describe('Sequence cursor (since only).'),
  limit: z.number().int().positive().optional().describe('Max rows (list only, capped at 50).'),
  summary: z.string().optional().describe('Summary text (append only, stored as semantic.summary).'),
  run_id: z.string().optional().describe('Execution context passthrough (append/checkpoint only).'),
  participant_id: z.string().optional().describe('Execution context passthrough (append/checkpoint only).'),
  session_id: z.string().optional().describe('Execution context passthrough (append/checkpoint only).'),
});

type JournalInput = z.infer<typeof substrateJournalSchema>;

// Structural subset of Substrate's JournalService: only the methods this
// tool calls. Structural typing keeps the build free of the unpublished
// @jaggerxtrm/substrate package; the real service satisfies this shape.
export interface JournalServiceLike {
  appendEntry(
    issue_id: string,
    input: Record<string, unknown>,
  ): unknown;
  getEntry(id: string): unknown;
  listEntries(issue_id: string, opts?: { kind?: string; limit?: number }): unknown[];
  since(issue_id: string, cursor: number): { issue_id: string; afterSequence: number; entries: unknown[]; nextCursor: number };
  latestCheckpoint(issue_id: string): unknown;
  collectMechanical(issue_id: string, input?: Record<string, unknown>): Record<string, unknown>;
}

export type GetJournal = () => JournalServiceLike | null;

const LIST_CAP = 50;
const BODY_CAP = 2000;

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
      'since(issue_id, cursor) is the pagination primitive and returns its next cursor. ' +
      'Payloads are bounded: list caps at 50 rows and entry bodies truncate with a marker.',
    inputSchema: substrateJournalSchema,
    async execute(input: JournalInput) {
      const journal = getJournal();
      if (!journal) return substrateUnavailablePayload('substrate_journal', resolveSubstrate());
      try {
        switch (input.op) {
          case 'get': {
            if (!input.entry_id) return missing('entry_id', 'get');
            return { status: 'ok', entry: boundEntry(journal.getEntry(input.entry_id)) };
          }
          case 'list': {
            if (!input.issue_id) return missing('issue_id', 'list');
            const limit = Math.min(input.limit ?? LIST_CAP, LIST_CAP);
            const entries = journal.listEntries(input.issue_id, {
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
            if (!input.issue_id) return missing('issue_id', 'since');
            if (input.cursor === undefined) return missing('cursor', 'since');
            const delta = journal.since(input.issue_id, input.cursor);
            return {
              status: 'ok',
              issue_id: delta.issue_id,
              afterSequence: delta.afterSequence,
              entries: delta.entries.map(boundEntry),
              nextCursor: delta.nextCursor,
            };
          }
          case 'latest_checkpoint': {
            if (!input.issue_id) return missing('issue_id', 'latest_checkpoint');
            return { status: 'ok', entry: boundEntry(journal.latestCheckpoint(input.issue_id)) };
          }
          case 'append': {
            if (!input.issue_id) return missing('issue_id', 'append');
            if (!input.kind) return missing('kind', 'append');
            const entry = journal.appendEntry(input.issue_id, {
              kind: input.kind,
              ...(input.run_id ? { run_id: input.run_id } : {}),
              ...(input.participant_id ? { participant_id: input.participant_id } : {}),
              ...(input.session_id ? { session_id: input.session_id } : {}),
              ...(input.summary ? { semantic: { summary: input.summary } } : {}),
            });
            return { status: 'ok', entry: boundEntry(entry) };
          }
          case 'checkpoint': {
            if (!input.issue_id) return missing('issue_id', 'checkpoint');
            const mechanical = journal.collectMechanical(input.issue_id, {
              ...(input.run_id ? { run_id: input.run_id } : {}),
              ...(input.participant_id ? { participant_id: input.participant_id } : {}),
              ...(input.session_id ? { session_id: input.session_id } : {}),
            });
            const entry = journal.appendEntry(input.issue_id, {
              kind: 'checkpoint',
              ...(input.run_id ? { run_id: input.run_id } : {}),
              ...(input.participant_id ? { participant_id: input.participant_id } : {}),
              ...(input.session_id ? { session_id: input.session_id } : {}),
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
