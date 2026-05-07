import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/specialist/observability-sqlite.js', () => ({
  createObservabilitySqliteClient: () => ({
    close: vi.fn(),
    readStatus: () => null,
    listStatuses: () => [],
    upsertStatus: vi.fn(),
    upsertEpicRun: vi.fn(),
    upsertEpicChainMembership: vi.fn(),
  }),
}));

describe('Supervisor finalizeWaitingJob', () => {
  let tmpDir: string;
  let jobsDir: string;

  beforeEach(() => {
    process.env.SPECIALISTS_JOB_FILE_OUTPUT = 'on';
    tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-finalize-'));
    jobsDir = join(tmpDir, 'jobs');
    mkdirSync(jobsDir, { recursive: true });
  });

  afterEach(() => {
    delete process.env.SPECIALISTS_JOB_FILE_OUTPUT;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('marks waiting job done through canonical status writer', async () => {
    const { Supervisor } = await import('../../../src/specialist/supervisor.js');
    const supervisor = new Supervisor({ runner: null as any, runOptions: null as any, jobsDir });

    const id = 'job-a';
    mkdirSync(join(jobsDir, id), { recursive: true });
    writeFileSync(join(jobsDir, id, 'status.json'), JSON.stringify({
      id,
      specialist: 'executor',
      status: 'waiting',
      started_at_ms: Date.now() - 1000,
    }), 'utf-8');

    const finalized = supervisor.finalizeWaitingJob(id);

    expect(finalized?.status).toBe('done');
    expect(JSON.parse(readFileSync(join(jobsDir, id, 'status.json'), 'utf-8')).status).toBe('done');
    await supervisor.dispose();
  });

  it('leaves non-waiting job unchanged', async () => {
    const { Supervisor } = await import('../../../src/specialist/supervisor.js');
    const supervisor = new Supervisor({ runner: null as any, runOptions: null as any, jobsDir });

    const id = 'job-b';
    mkdirSync(join(jobsDir, id), { recursive: true });
    writeFileSync(join(jobsDir, id, 'status.json'), JSON.stringify({
      id,
      specialist: 'executor',
      status: 'running',
      started_at_ms: Date.now() - 1000,
    }), 'utf-8');

    const finalized = supervisor.finalizeWaitingJob(id);

    expect(finalized?.status).toBe('running');
    expect(JSON.parse(readFileSync(join(jobsDir, id, 'status.json'), 'utf-8')).status).toBe('running');
    await supervisor.dispose();
  });
});
