import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  createObservabilitySqliteClientAtPath: () => ({
    listStatuses: () => sqliteState.statuses,
    readEvents: (jobId: string) => sqliteState.events.get(jobId) ?? [],
    close: vi.fn(),
  }),
}));

function seedJob(jobId: string, worktreePath: string = tempRoot): void {
  const status: SupervisorStatus = {
    id: jobId,
    specialist: 'reviewer',
    status: 'cancelled',
    started_at_ms: 1000,
    last_event_at_ms: 3000,
    pid: 123,
    bead_id: 'unitAI-log',
    branch: 'feature/log',
    worktree_path: worktreePath,
    model: 'gpt-5.3-codex',
    backend: 'openai-codex',
  };
  sqliteState.statuses = [status];
  sqliteState.events.set(jobId, [
    { t: 1000, seq: 1, type: 'run_start', specialist: 'reviewer', bead_id: 'unitAI-log' },
    { t: 1500, seq: 2, type: 'tool', tool: 'bash', phase: 'start', args: { command: 'echo noisy' } },
    { t: 2000, seq: 3, type: 'control_signal', action: 'stop_requested', source: 'cli', pid: 123, previous_status: 'running', next_status: 'cancelled', reason: 'operator_stop' },
    { t: 3000, seq: 4, type: 'status_change', previous_status: 'running', status: 'cancelled' },
  ] as TimelineEvent[]);
}

describe('log CLI', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'sp-log-test-'));
    sqliteState.statuses = [];
    sqliteState.events.clear();
    mkdirSync(join(tempRoot, '.specialists', 'db'), { recursive: true });
    writeFileSync(join(tempRoot, '.specialists', 'db', 'observability.db'), '');
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('prints lean colorized runtime rows with compact worktree and control signal detail', async () => {
    seedJob('joblog');
    process.argv = ['node', 'specialists', 'log', 'joblog'];

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => logs.push(String(msg ?? '')));

    const { run } = await import('../../../src/cli/log.js');
    await run();

    const output = logs.join('\n');
    expect(output).toContain('joblog');
    expect(output).toContain('reviewer');
    expect(output).toContain('bead=unitAI-log');
    expect(output).toContain(`worktree=${tempRoot.split('/').pop()}`);
    expect(output).toContain('CTRL');
    expect(output).not.toContain('tool=bash');
    expect(output).not.toContain(`path=${tempRoot}`);
    expect(output).toContain('action=stop_requested');
    expect(output).toContain('status=running->cancelled');
  });





  it('discovers a single child repo when run from its parent directory', async () => {
    rmSync(join(tempRoot, '.specialists'), { recursive: true, force: true });
    const repoRoot = join(tempRoot, 'onlyrepo');
    mkdirSync(join(repoRoot, '.specialists', 'db'), { recursive: true });
    writeFileSync(join(repoRoot, '.specialists', 'db', 'observability.db'), '');
    seedJob('parentjob', repoRoot);
    process.argv = ['node', 'specialists', 'log', 'parentjob'];

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => logs.push(String(msg ?? '')));

    const { run } = await import('../../../src/cli/log.js');
    await run();

    expect(logs.join('\n')).toContain('worktree=onlyrepo');
    expect(logs.join('\n')).toContain('parentjob');
  });

  it('can include agent-internal events when --all-events is set', async () => {
    seedJob('jobverbose');
    process.argv = ['node', 'specialists', 'log', 'jobverbose', '--all-events'];

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => logs.push(String(msg ?? '')));

    const { run } = await import('../../../src/cli/log.js');
    await run();

    expect(logs.join('\n')).toContain('tool=bash');
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
