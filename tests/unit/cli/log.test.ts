import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SupervisorStatus } from '../../../src/specialist/supervisor.js';
import type { TimelineEvent } from '../../../src/specialist/timeline-events.js';

let tempRoot: string;

const sqliteState = {
  statuses: [] as SupervisorStatus[],
  events: new Map<string, TimelineEvent[]>(),
};

vi.mock('../../../src/specialist/observability-sqlite.js', () => ({
  createObservabilitySqliteClient: () => ({
    listStatuses: () => sqliteState.statuses,
    readEvents: (jobId: string) => sqliteState.events.get(jobId) ?? [],
    close: vi.fn(),
  }),
}));

function seedJob(jobId: string): void {
  const status: SupervisorStatus = {
    id: jobId,
    specialist: 'reviewer',
    status: 'cancelled',
    started_at_ms: 1000,
    last_event_at_ms: 3000,
    pid: 123,
    bead_id: 'unitAI-log',
    branch: 'feature/log',
    worktree_path: tempRoot,
    model: 'gpt-5.3-codex',
    backend: 'openai-codex',
  };
  sqliteState.statuses = [status];
  sqliteState.events.set(jobId, [
    { t: 1000, seq: 1, type: 'run_start', specialist: 'reviewer', bead_id: 'unitAI-log' },
    { t: 2000, seq: 2, type: 'control_signal', action: 'stop_requested', source: 'cli', pid: 123, previous_status: 'running', next_status: 'cancelled', reason: 'operator_stop' },
    { t: 3000, seq: 3, type: 'status_change', previous_status: 'running', status: 'cancelled' },
  ] as TimelineEvent[]);
}

describe('log CLI', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'sp-log-test-'));
    sqliteState.statuses = [];
    sqliteState.events.clear();
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('prints runtime rows with bead repo path and control signal detail', async () => {
    seedJob('joblog');
    process.argv = ['node', 'specialists', 'log', 'joblog'];

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => logs.push(String(msg ?? '')));

    const { run } = await import('../../../src/cli/log.js');
    await run();

    const output = logs.join('\n');
    expect(output).toContain('job=joblog');
    expect(output).toContain('specialist=reviewer');
    expect(output).toContain('bead=unitAI-log');
    expect(output).toContain('repo=');
    expect(output).toContain(`path=${tempRoot}`);
    expect(output).toContain('event=control_signal');
    expect(output).toContain('action=stop_requested');
    expect(output).toContain('status=running->cancelled');
  });

  it('emits JSON rows with full event payload', async () => {
    seedJob('jobjson');
    process.argv = ['node', 'specialists', 'log', 'jobjson', '--json', '--limit', '1'];

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => logs.push(String(msg ?? '')));

    const { run } = await import('../../../src/cli/log.js');
    await run();

    const row = JSON.parse(logs[0]) as { job_id: string; bead_id: string; event: { type: string } };
    expect(row.job_id).toBe('jobjson');
    expect(row.bead_id).toBe('unitAI-log');
    expect(row.event.type).toBe('status_change');
  });
});
