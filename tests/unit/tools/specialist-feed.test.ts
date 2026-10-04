import { describe, it, expect } from 'vitest';
import { createSpecialistFeedTool, feedLine, FEED_LINE_MAX } from '../../../src/tools/specialist/specialist_feed.tool.js';
import type { ObservabilitySqliteClient } from '../../../src/specialist/observability-sqlite.js';
import type { TimelineEvent } from '../../../src/specialist/timeline-events.js';

const T = new Date(2026, 9, 4, 12, 56, 46).getTime();

const EVENTS = [
  { t: T, seq: 1, type: 'run_start', specialist: 'explorer', bead_id: 'XTRM-1' },
  { t: T, seq: 2, type: 'meta', model: 'commandcode/meta/muse-spark-1.3-contributor', backend: 'pi' },
  { t: T, seq: 3, type: 'turn', phase: 'start' },
  { t: T, seq: 4, type: 'tool', tool: 'read', phase: 'start', args: { path: 'src/x.ts' } },
  { t: T, seq: 5, type: 'tool', tool: 'read', phase: 'update' },
  { t: T, seq: 6, type: 'tool', tool: 'read', phase: 'end', result_summary: 'export const x = 1', is_error: false },
  { t: T, seq: 7, type: 'text', content: 'The   answer\nis 42.' },
  { t: T, seq: 8, type: 'turn_summary', turn_index: 1, token_usage: { input_tokens: 4000, output_tokens: 1000 }, finish_reason: 'stop' },
  { t: T, seq: 9, type: 'status_change', previous_status: 'running', status: 'waiting' },
  { t: T, seq: 10, type: 'run_complete', status: 'COMPLETE', elapsed_s: 16.4, tool_calls: ['read'] },
] as unknown as TimelineEvent[];

function fakeClient(events = EVENTS): ObservabilitySqliteClient {
  return {
    listNativeActivationIds: () => ['act:13a65caa-6c8', 'act:13a6ffff-000'],
    readEvents: (id: string) => (id === 'act:13a65caa-6c8' ? events : []),
    readForensicEvents: ({ jobId }: { jobId?: string }) =>
      jobId === 'act:13a65caa-6c8'
        ? [1, 2, 3].map((seq) => ({ seq, t: T, event_name: `e${seq}` }))
        : [],
    close: () => {},
  } as unknown as ObservabilitySqliteClient;
}

type Feed = { activation_id: string; events: string[]; last_seq: number; total: number; truncated: boolean };

describe('feedLine', () => {
  it('renders what the specialist did and hides bookkeeping', () => {
    const lines = EVENTS.map(feedLine).filter(Boolean);
    expect(lines).toEqual([
      '12:56:46 #1 start   explorer on XTRM-1',
      '12:56:46 #2 model   commandcode/meta/muse-spark-1.3-contributor',
      '12:56:46 #4 tool    read src/x.ts',
      '12:56:46 #6 tool ✓  read · export const x = 1',
      '12:56:46 #7 text    The answer is 42.',
      '12:56:46 #8 turn    turn 1 · 5.0k tok · stop',
      '12:56:46 #9 status  running → waiting',
      '12:56:46 #10 done    COMPLETE · 16s · 1 tool calls',
    ]);
  });

  it('caps a line whatever the event held', () => {
    const line = feedLine({ t: T, seq: 1, type: 'text', content: 'x'.repeat(5000) } as unknown as TimelineEvent);
    expect(line!.length).toBeLessThanOrEqual(FEED_LINE_MAX);
  });
});

describe('specialist_feed', () => {
  const tool = createSpecialistFeedTool(undefined, () => fakeClient());

  it('resolves a short prefix and returns the newest events with a cursor', async () => {
    const out = (await tool.execute({ activation_id: '13a65caa', limit: 3 })) as Feed;
    expect(out.activation_id).toBe('act:13a65caa-6c8');
    expect(out.events).toHaveLength(3);
    expect(out.events[out.events.length - 1]).toContain('done');
    expect(out).toMatchObject({ last_seq: 10, total: 8, truncated: true });
  });

  it('follows from since_seq', async () => {
    const out = (await tool.execute({ activation_id: 'act:13a65caa-6c8', since_seq: 8 })) as Feed;
    expect(out.events.map((l) => l.split(' ')[2])).toEqual(['status', 'done']);
    const none = (await tool.execute({ activation_id: 'act:13a65caa-6c8', since_seq: 10 })) as Feed;
    expect(none).toMatchObject({ events: [], last_seq: 10 });
  });

  it('serves the forensic view', async () => {
    const out = (await tool.execute({ activation_id: '13a65caa', view: 'forensic' })) as Feed;
    expect(out.events).toEqual(['12:56:46 #1 e1', '12:56:46 #2 e2', '12:56:46 #3 e3']);
  });

  it('refuses an ambiguous prefix and an unknown id', async () => {
    expect(await tool.execute({ activation_id: '13a6' })).toMatchObject({ status: 'error', candidates: ['act:13a65caa-6c8', 'act:13a6ffff-000'] });
    expect(await tool.execute({ activation_id: 'nope' })).toMatchObject({ status: 'error' });
  });

  it('reports a missing observability.db instead of an empty feed', async () => {
    const none = createSpecialistFeedTool(undefined, () => null);
    expect(await none.execute({ activation_id: 'x' })).toMatchObject({ status: 'error' });
  });
});
