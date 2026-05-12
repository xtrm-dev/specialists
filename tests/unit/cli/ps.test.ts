import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockSqlite = {
  listStatuses: vi.fn(() => []),
  listEpicRuns: vi.fn(() => []),
  readEpicRun: vi.fn(() => null),
  listEpicChains: vi.fn(() => []),
  close: vi.fn(),
};

const mockProcessHealth = vi.fn(() => ({
  status: 'WARN',
  statusReasons: ['orphan process count 1 > 0'],
  memAvailableBytes: 1024 * 1024 * 1024,
  totalRssBytes: 256 * 1024 * 1024,
  totalCpuPct: 12.5,
  specialistCount: 2,
  doltCount: 1,
  serenaLspCount: 1,
  orphanCount: 1,
  thresholdPct: 25,
  warnPct: 70,
  refusePct: 85,
  warnLimitBytes: 700 * 1024 * 1024,
  refuseLimitBytes: 850 * 1024 * 1024,
  specialistProcesses: [{ pid: 1, ppid: 1, kind: 'specialist', role: 'specialist', cmdline: 'specialists', cwd: '/x', rssBytes: 64 * 1024 * 1024, cpuPct: 5.5, ageSeconds: 60, worktree: '/x' }],
  doltProcesses: [{ pid: 2, ppid: 1, kind: 'dolt', role: 'dolt', cmdline: 'dolt sql-server', cwd: '/x', rssBytes: 128 * 1024 * 1024, cpuPct: 2.5, ageSeconds: 60, worktree: '/x' }],
  serenaWorkspaces: [{ workspace: '/x', count: 1, rssBytes: 32 * 1024 * 1024, processes: [{ pid: 3, ppid: 1, kind: 'serena-lsp', role: 'serena-lsp', cmdline: 'serena language-server', cwd: '/x', rssBytes: 32 * 1024 * 1024, cpuPct: 1, ageSeconds: 60, worktree: '/x' }] }],
  orphanProcesses: [{ pid: 4, ppid: 1, kind: 'orphan', role: 'orphan', cmdline: 'gitnexus mcp', cwd: '/x', rssBytes: 16 * 1024 * 1024, cpuPct: 0.5, ageSeconds: 60, worktree: '/x', reason: 'gitnexus-orphan' }],
}));

vi.mock('../../../src/specialist/observability-sqlite.js', () => ({
  createObservabilitySqliteClient: () => mockSqlite,
}));
vi.mock('../../../src/specialist/process-health.js', () => ({
  collectProcessHealth: () => mockProcessHealth(),
}));

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}

function createJob(
  rootDir: string,
  jobId: string,
  overrides: Record<string, unknown> = {},
): void {
  const jobDir = join(rootDir, '.specialists', 'jobs', jobId);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(
    join(jobDir, 'status.json'),
    JSON.stringify({
      id: jobId,
      specialist: 'executor',
      status: 'running',
      model: 'anthropic/claude-sonnet-4-6',
      backend: 'anthropic',
      elapsed_s: 60,
      started_at_ms: Date.now() - 60_000,
      pid: process.pid, // current PID = alive
      metrics: { turns: 3, tool_calls: 5 },
      ...overrides,
    }),
    'utf-8',
  );
}

describe('ps CLI — run()', () => {
  const TEST_TIMEOUT_MS = 20_000;
  const originalArgv = process.argv;
  const originalCwd = process.cwd();
  let tempDir = '';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'specialists-ps-'));
    process.chdir(tempDir);
    // Ensure .specialists/jobs exists
    mkdirSync(join(tempDir, '.specialists', 'jobs'), { recursive: true });
    mockSqlite.listStatuses.mockReturnValue([]);
    mockSqlite.listEpicRuns.mockReturnValue([]);
    mockSqlite.readEpicRun.mockReturnValue(null);
    mockSqlite.listEpicChains.mockReturnValue([]);
    mockProcessHealth.mockClear();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('completes without throwing when no jobs exist', async () => {
    process.argv = ['node', 'specialists', 'ps'];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { run } = await import('../../../src/cli/ps.js');
    await expect(run()).resolves.toBeUndefined();
  }, TEST_TIMEOUT_MS);

  it('shows empty summary when no jobs exist', async () => {
    process.argv = ['node', 'specialists', 'ps'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    expect(clean).toContain('0 jobs');
    expect(clean).toContain('0 running');
    expect(clean).toContain('0 waiting');
  }, TEST_TIMEOUT_MS);

  it('shows compact system health block with process counts by default', async () => {
    createJob(tempDir, 'aaa111', { pid: process.pid });
    process.argv = ['node', 'specialists', 'ps'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    expect(clean).toContain('System health');
    expect(clean).toContain('WARN');
    expect(clean).toContain('specialists=2 dolt=1 serena-lsp=1 orphans=1');
    expect(clean).toContain('alerts=orphan process count 1 > 0');
    expect(clean).not.toContain('Dolt sql-server');
    expect(clean).not.toContain('Serena LSP');
  }, TEST_TIMEOUT_MS);

  it('--health shows detailed process tables', async () => {
    createJob(tempDir, 'aaa111', { pid: process.pid });
    process.argv = ['node', 'specialists', 'ps', '--health'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    expect(clean).toContain('System health');
    expect(clean).toContain('Dolt sql-server');
    expect(clean).toContain('Serena LSP');
    expect(clean).toContain('Specialists');
    expect(clean).toContain('Orphans');
  }, TEST_TIMEOUT_MS);

  it('shows running job with alive PID', async () => {
    createJob(tempDir, 'aaa111', {
      specialist: 'explorer',
      status: 'running',
      pid: process.pid, // current process = alive
    });
    process.argv = ['node', 'specialists', 'ps'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    expect(clean).toContain('aaa111');
    expect(clean).toContain('explorer');
    expect(clean).toContain('1 running');
  }, TEST_TIMEOUT_MS);

  it('filters dead jobs from default output', async () => {
    createJob(tempDir, 'dead01', {
      status: 'running',
      pid: 99999999, // very unlikely to be alive
    });
    process.argv = ['node', 'specialists', 'ps'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    expect(clean).not.toContain('dead01');
    expect(clean).toContain('0 jobs');
  }, TEST_TIMEOUT_MS);

  it('--all includes dead jobs with dead label', async () => {
    createJob(tempDir, 'dead02', {
      status: 'waiting',
      pid: 99999999,
    });
    process.argv = ['node', 'specialists', 'ps', '--all'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    expect(clean).toContain('dead02');
    expect(clean).toContain('dead');
  }, TEST_TIMEOUT_MS);

  it('--all includes terminal jobs (done/error)', async () => {
    createJob(tempDir, 'done01', { status: 'done' });
    createJob(tempDir, 'err01', { status: 'error', error: 'crashed' });
    process.argv = ['node', 'specialists', 'ps', '--all'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    expect(clean).toContain('done01');
    expect(clean).toContain('err01');
  }, TEST_TIMEOUT_MS);

  it('hides terminal historical jobs by default', async () => {
    createJob(tempDir, 'done02', { status: 'done' });
    createJob(tempDir, 'err02', { status: 'error', error: 'crashed' });
    process.argv = ['node', 'specialists', 'ps'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    expect(clean).not.toContain('done02');
    expect(clean).not.toContain('err02');
    expect(clean).toContain('0 jobs');
  }, TEST_TIMEOUT_MS);

  it('--include-terminal includes terminal history without --all', async () => {
    createJob(tempDir, 'done03', { status: 'done' });
    process.argv = ['node', 'specialists', 'ps', '--include-terminal'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    expect(clean).toContain('done03');
  }, TEST_TIMEOUT_MS);

  it('--json outputs valid JSON with trees array', async () => {
    createJob(tempDir, 'json01', { pid: process.pid });
    process.argv = ['node', 'specialists', 'ps', '--json'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const raw = output.join('\n');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty('trees');
    expect(parsed).toHaveProperty('process_health');
    expect(Array.isArray(parsed.trees)).toBe(true);
  }, TEST_TIMEOUT_MS);

  it('sorts waiting jobs before running jobs', async () => {
    createJob(tempDir, 'run01', {
      status: 'running',
      pid: process.pid,
      started_at_ms: Date.now() - 120_000,
    });
    createJob(tempDir, 'wait01', {
      status: 'waiting',
      pid: process.pid,
      started_at_ms: Date.now() - 60_000,
    });
    process.argv = ['node', 'specialists', 'ps'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    const waitPos = clean.indexOf('wait01');
    const runPos = clean.indexOf('run01');
    expect(waitPos).toBeGreaterThan(-1);
    expect(runPos).toBeGreaterThan(-1);
    expect(waitPos).toBeLessThan(runPos);
  }, TEST_TIMEOUT_MS);

  it('shows context_pct when available', async () => {
    createJob(tempDir, 'ctx01', {
      pid: process.pid,
      context_pct: 54.2,
      context_health: 'MONITOR',
      startup_payload_json: JSON.stringify({ totals: { bytes: 12288, tokens: 3400 } }),
    });
    writeFileSync(join(tempDir, '.specialists', 'jobs', 'ctx01', 'status.json'), JSON.stringify({
      id: 'ctx01',
      specialist: 'explorer',
      status: 'running',
      model: 'anthropic/claude-sonnet-4-6',
      backend: 'anthropic',
      elapsed_s: 60,
      started_at_ms: Date.now() + 60_000,
      pid: process.pid,
      metrics: { turns: 3, tool_calls: 5 },
      context_pct: 54.2,
      context_health: 'MONITOR',
      startup_payload_json: JSON.stringify({ totals: { bytes: 12288, tokens: 3400 } }),
    }), 'utf-8');
    process.argv = ['node', 'specialists', 'ps'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    expect(clean).toContain('54');
    expect(clean).toContain('12.0kb');
    expect(clean).toContain('3400');
  }, TEST_TIMEOUT_MS);

  it('groups jobs by worktree_owner_job_id', async () => {
    const wt = join(tempDir, 'wt-test');
    mkdirSync(wt, { recursive: true });
    createJob(tempDir, 'owner1', {
      pid: process.pid,
      worktree_path: wt,
      worktree_owner_job_id: 'owner1',
      branch: 'feature/test',
    });
    createJob(tempDir, 'child1', {
      pid: process.pid,
      worktree_path: wt,
      worktree_owner_job_id: 'owner1',
      reused_from_job_id: 'owner1',
    });
    process.argv = ['node', 'specialists', 'ps'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    // Both should appear
    expect(clean).toContain('owner1');
    expect(clean).toContain('child1');
    // Should be in same worktree section
    expect(clean).toContain('feature/test');
  }, TEST_TIMEOUT_MS);

  it('--include-terminal shows abandoned epic even after chain job purge', async () => {
    mockSqlite.listEpicRuns.mockReturnValue([
      { epic_id: 'epic-orphan', status: 'abandoned', status_json: '{}', updated_at_ms: Date.now() },
    ]);
    mockSqlite.readEpicRun.mockReturnValue({ epic_id: 'epic-orphan', status: 'abandoned', status_json: '{}', updated_at_ms: Date.now() });
    mockSqlite.listEpicChains.mockReturnValue([
      { chain_id: 'chain-a', epic_id: 'epic-orphan', chain_root_bead_id: 'bead-a', chain_root_job_id: 'job-a', updated_at_ms: Date.now() },
      { chain_id: 'chain-b', epic_id: 'epic-orphan', chain_root_bead_id: 'bead-b', chain_root_job_id: 'job-b', updated_at_ms: Date.now() },
    ]);
    process.argv = ['node', 'specialists', 'ps', '--include-terminal'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    expect(clean).toContain('EPIC epic-orphan');
    expect(clean).toContain('abandoned');
    expect(clean).toContain('chain-a');
    expect(clean).toContain('chain-b');
    expect(clean).toContain('no retained jobs');
  }, TEST_TIMEOUT_MS);

  it('shows derived epic pass label instead of persisted uppercase state', async () => {
    mockSqlite.listEpicRuns.mockReturnValue([
      { epic_id: 'epic-pass', status: 'open', status_json: '{}', updated_at_ms: Date.now() },
    ]);
    mockSqlite.readEpicRun.mockReturnValue({ epic_id: 'epic-pass', status: 'open', status_json: '{}', updated_at_ms: Date.now() });
    mockSqlite.listEpicChains.mockReturnValue([
      { chain_id: 'chain-pass', epic_id: 'epic-pass', chain_root_bead_id: 'bead-pass', chain_root_job_id: 'job-pass', updated_at_ms: Date.now() },
    ]);
    createJob(tempDir, 'job-pass', { pid: process.pid, epic_id: 'epic-pass', status: 'waiting', chain_kind: 'chain', chain_id: 'chain-pass' });
    process.argv = ['node', 'specialists', 'ps'];
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    const { run } = await import('../../../src/cli/ps.js');
    await run();
    const clean = stripAnsi(output.join('\n'));
    expect(clean).toContain('EPIC epic-pass');
    expect(clean).toContain('pass');
    expect(clean).not.toContain('OPEN');
  }, TEST_TIMEOUT_MS);
});
