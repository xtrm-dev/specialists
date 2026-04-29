import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const removedJobIds: string[] = [];
let mockStatuses: any[] = [];
let mockUpsertedStatuses: any[] = [];

vi.mock('../../../src/specialist/observability-sqlite.js', () => ({
  createObservabilitySqliteClient: () => ({
    listStatuses: () => mockStatuses,
    removeJobs: (jobIds: readonly string[]) => {
      removedJobIds.push(...jobIds);
      return jobIds.length;
    },
    upsertStatus: (status: any) => {
      mockUpsertedStatuses.push(status);
    },
  }),
}));

function createCompletedJob(jobsDirectory: string, id: string, startedAtMs: number, completedAtMs: number): void {
  const directoryPath = join(jobsDirectory, id);
  mkdirSync(directoryPath, { recursive: true });
  writeFileSync(join(directoryPath, 'status.json'), JSON.stringify({ id, specialist: 'tester', status: 'done', started_at_ms: startedAtMs, completed_at_ms: completedAtMs }), 'utf-8');
  writeFileSync(join(directoryPath, 'result.txt'), 'output', 'utf-8');
}

function createRunningJob(jobsDirectory: string, id: string, updatedAtMs: number, pid: number): void {
  const directoryPath = join(jobsDirectory, id);
  mkdirSync(directoryPath, { recursive: true });
  writeFileSync(join(directoryPath, 'status.json'), JSON.stringify({ id, specialist: 'tester', status: 'running', updated_at_ms: updatedAtMs, pid }), 'utf-8');
}

describe('clean CLI — run()', () => {
  const originalCwd = process.cwd();
  const originalArgv = [...process.argv];
  const originalTtl = process.env.SPECIALISTS_JOB_TTL_DAYS;
  let testRoot: string;
  let jobsDirectory: string;

  beforeEach(() => {
    testRoot = join(tmpdir(), `clean-cli-${crypto.randomUUID()}`);
    jobsDirectory = join(testRoot, '.specialists', 'jobs');
    mkdirSync(jobsDirectory, { recursive: true });
    process.chdir(testRoot);
    delete process.env.SPECIALISTS_JOB_TTL_DAYS;
    delete process.env.SPECIALISTS_JOB_FILE_OUTPUT;
    mockStatuses = [];
    mockUpsertedStatuses = [];
    removedJobIds.length = 0;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.argv = [...originalArgv];
    if (originalTtl === undefined) delete process.env.SPECIALISTS_JOB_TTL_DAYS;
    else process.env.SPECIALISTS_JOB_TTL_DAYS = originalTtl;
    delete process.env.SPECIALISTS_JOB_FILE_OUTPUT;
    rmSync(testRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function invokeClean(args: string[]): Promise<string[]> {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message: string) => { logs.push(String(message)); });
    process.argv = ['node', 'specialists', 'clean', ...args];
    const { run } = await import('../../../src/cli/clean.js');
    await run();
    return logs;
  }

  it('removes completed job directories older than TTL by default', async () => {
    const now = Date.now();
    createCompletedJob(jobsDirectory, 'old-job', now - 8 * 86_400_000, now - 8 * 86_400_000);
    createCompletedJob(jobsDirectory, 'fresh-job', now, now);
    mockStatuses = [
      { id: 'old-job', specialist: 'tester', status: 'done', started_at_ms: now - 8 * 86_400_000, completed_at_ms: now - 8 * 86_400_000 },
      { id: 'fresh-job', specialist: 'tester', status: 'done', started_at_ms: now, completed_at_ms: now },
    ];

    await invokeClean([]);

    expect(existsSync(join(jobsDirectory, 'old-job'))).toBe(false);
    expect(existsSync(join(jobsDirectory, 'fresh-job'))).toBe(true);
  });

  it('--all removes every completed job directory regardless of age', async () => {
    const now = Date.now();
    createCompletedJob(jobsDirectory, 'one', now, now);
    createCompletedJob(jobsDirectory, 'two', now - 1_000, now - 1_000);
    mockStatuses = [
      { id: 'one', specialist: 'tester', status: 'done', started_at_ms: now, completed_at_ms: now },
      { id: 'two', specialist: 'tester', status: 'error', started_at_ms: now - 1_000, completed_at_ms: now - 1_000 },
    ];

    await invokeClean(['--all']);

    expect(existsSync(join(jobsDirectory, 'one'))).toBe(false);
    expect(existsSync(join(jobsDirectory, 'two'))).toBe(false);
  });

  it('--keep keeps only the N most recent completed jobs', async () => {
    const now = Date.now();
    createCompletedJob(jobsDirectory, 'job-1', now - 3_000, now - 3_000);
    createCompletedJob(jobsDirectory, 'job-2', now - 2_000, now - 2_000);
    createCompletedJob(jobsDirectory, 'job-3', now - 1_000, now - 1_000);
    mockStatuses = [
      { id: 'job-1', specialist: 'tester', status: 'done', started_at_ms: now - 3_000, completed_at_ms: now - 3_000 },
      { id: 'job-2', specialist: 'tester', status: 'done', started_at_ms: now - 2_000, completed_at_ms: now - 2_000 },
      { id: 'job-3', specialist: 'tester', status: 'done', started_at_ms: now - 1_000, completed_at_ms: now - 1_000 },
    ];

    await invokeClean(['--keep', '1']);

    expect(existsSync(join(jobsDirectory, 'job-3'))).toBe(true);
    expect(existsSync(join(jobsDirectory, 'job-2'))).toBe(false);
    expect(existsSync(join(jobsDirectory, 'job-1'))).toBe(false);
  });

  it('--dry-run prints plan and does not delete directories', async () => {
    const now = Date.now();
    createCompletedJob(jobsDirectory, 'old-job', now - 8 * 86_400_000, now - 8 * 86_400_000);
    mockStatuses = [{ id: 'old-job', specialist: 'tester', status: 'done', started_at_ms: now - 8 * 86_400_000, completed_at_ms: now - 8 * 86_400_000 }];

    const logs = await invokeClean(['--dry-run']);

    expect(existsSync(join(jobsDirectory, 'old-job'))).toBe(true);
    expect(logs.join('\n')).toContain('Would remove:');
    expect(logs.join('\n')).toContain('old-job');
  });

  it('prints a freed size summary after deletion', async () => {
    const now = Date.now();
    createCompletedJob(jobsDirectory, 'old-job', now - 8 * 86_400_000, now - 8 * 86_400_000);
    mockStatuses = [{ id: 'old-job', specialist: 'tester', status: 'done', started_at_ms: now - 8 * 86_400_000, completed_at_ms: now - 8 * 86_400_000 }];

    const logs = await invokeClean([]);
    expect(logs.join('\n')).toContain('Removed 1 job directory');
    expect(logs.join('\n')).toContain('freed');
  });

  it('never removes directories that contain sqlite database artifacts', async () => {
    const now = Date.now();
    createCompletedJob(jobsDirectory, 'protected-db', now - 8 * 86_400_000, now - 8 * 86_400_000);
    writeFileSync(join(jobsDirectory, 'protected-db', 'observability.db'), 'sqlite', 'utf-8');
    writeFileSync(join(jobsDirectory, 'protected-db', 'observability.db-wal'), 'wal', 'utf-8');
    writeFileSync(join(jobsDirectory, 'protected-db', 'observability.db-shm'), 'shm', 'utf-8');
    mockStatuses = [{ id: 'protected-db', specialist: 'tester', status: 'done', started_at_ms: now - 8 * 86_400_000, completed_at_ms: now - 8 * 86_400_000 }];

    await invokeClean(['--all']);

    expect(existsSync(join(jobsDirectory, 'protected-db'))).toBe(true);
  });

  it('uses file fallback only when env enabled and DB empty', async () => {
    mockStatuses = [];
    process.env.SPECIALISTS_JOB_FILE_OUTPUT = 'on';
    const now = Date.now();
    createCompletedJob(jobsDirectory, 'fallback-job', now - 8 * 86_400_000, now - 8 * 86_400_000);

    await invokeClean(['--all']);

    expect(existsSync(join(jobsDirectory, 'fallback-job'))).toBe(false);
  });

  it('--processes cancels dead or stale non-terminal jobs', async () => {
    const now = Date.now();
    createRunningJob(jobsDirectory, 'dead-job', now - 2 * 60 * 60 * 1000, 999999);
    createRunningJob(jobsDirectory, 'stale-job', now - 30 * 60 * 60 * 1000, process.pid);
    createRunningJob(jobsDirectory, 'active-job', now, process.pid);
    mockStatuses = [
      { id: 'dead-job', specialist: 'tester', status: 'running', updated_at_ms: now - 2 * 60 * 60 * 1000, pid: 999999 },
      { id: 'stale-job', specialist: 'tester', status: 'waiting', updated_at_ms: now - 30 * 60 * 60 * 1000, pid: process.pid },
      { id: 'active-job', specialist: 'tester', status: 'starting', updated_at_ms: now, pid: process.pid },
    ];

    const logs = await invokeClean(['--processes']);

    expect(logs.join('\n')).toContain('Removed 2 job directories');
    expect(mockUpsertedStatuses.map((status) => status.id)).toEqual(expect.arrayContaining(['dead-job', 'stale-job']));
    expect(mockUpsertedStatuses.every((status) => status.status === 'cancelled')).toBe(true);
    expect(mockUpsertedStatuses.some((status) => status.id === 'active-job')).toBe(false);
  });

  it('--processes --dry-run is read-only', async () => {
    const now = Date.now();
    createRunningJob(jobsDirectory, 'stale-job', now - 30 * 60 * 60 * 1000, process.pid);
    mockStatuses = [{ id: 'stale-job', specialist: 'tester', status: 'running', updated_at_ms: now - 30 * 60 * 60 * 1000, pid: process.pid }];

    const logs = await invokeClean(['--processes', '--dry-run']);

    expect(logs.join('\n')).toContain('Would cancel:');
    expect(mockUpsertedStatuses).toHaveLength(0);
    expect(readFileSync(join(jobsDirectory, 'stale-job', 'status.json'), 'utf-8')).toContain('running');
  });
});
