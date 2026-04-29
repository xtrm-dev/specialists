import { describe, expect, it, vi, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Supervisor } from '../../../src/specialist/supervisor.js';

function makeRunOptions() {
  return { name: 'ordering-specialist', prompt: 'do something' };
}

describe('payload ordering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SPECIALISTS_JOB_FILE_OUTPUT;
  });

  it('emits run_start before payload_breakdown and persists payload JSON', async () => {
    process.env.SPECIALISTS_JOB_FILE_OUTPUT = 'on';
    const tmpDir = mkdtempSync(join(tmpdir(), 'payload-ordering-'));
    const jobsDir = join(tmpDir, 'jobs');
    mkdirSync(jobsDir, { recursive: true });

    const payloadBreakdown = {
      components: [
        { kind: 'system_prompt', name: 'system_prompt', tokens: 4, bytes: 16 },
        { kind: 'task_template', name: 'task_template', tokens: 3, bytes: 12 },
      ],
      totals: { tokens: 7, bytes: 28 },
    };

    const fakeClient = {
      upsertStatus: vi.fn(),
      upsertStatusWithEvent: vi.fn(),
      upsertStatusWithEventAndResult: vi.fn(),
      appendEvent: vi.fn(),
      upsertResult: vi.fn(),
      readStatus: vi.fn().mockReturnValue(null),
      aggregateJobMetrics: vi.fn().mockReturnValue(null),
      listStatuses: vi.fn().mockReturnValue([]),
    };
    vi.spyOn(Supervisor.prototype as never, 'withSqliteOperation').mockImplementation(function (_label: string, callback: (client: typeof fakeClient) => unknown) {
      return callback(fakeClient);
    } as never);

    const runner = {
      run: async (_runOptions: unknown, _onProgress?: unknown, onEvent?: (eventType: string, details?: { summary?: string }) => void) => {
        onEvent?.('payload_breakdown', {
          summary: JSON.stringify({ payload_breakdown: payloadBreakdown }),
        });
        return {
          output: 'output text',
          backend: 'anthropic',
          model: 'claude-haiku',
          durationMs: 100,
          specialistVersion: '1.0.0',
          promptHash: 'abc123def4567890',
          beadId: undefined,
          payloadBreakdown,
        };
      },
    };

    try {
      const sup = new Supervisor({ runner: runner as never, runOptions: makeRunOptions(), jobsDir });
      const id = await sup.run();

      const eventsPath = join(jobsDir, id, 'events.jsonl');
      expect(existsSync(eventsPath)).toBe(true);
      const events = readFileSync(eventsPath, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; payload_breakdown?: typeof payloadBreakdown });

      expect(events[0]?.type).toBe('run_start');
      expect(events[1]?.type).toBe('payload_breakdown');
      expect(events[1]?.payload_breakdown).toEqual(payloadBreakdown);

      const status = JSON.parse(readFileSync(join(jobsDir, id, 'status.json'), 'utf-8')) as { startup_payload_json?: string };
      expect(status.startup_payload_json).toBe(JSON.stringify(payloadBreakdown));
      expect(fakeClient.upsertStatus).toHaveBeenCalledWith(expect.objectContaining({ startup_payload_json: JSON.stringify(payloadBreakdown) }));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
