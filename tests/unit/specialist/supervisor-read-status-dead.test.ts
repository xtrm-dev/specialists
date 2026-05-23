import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type SupervisorType = typeof import('../../../src/specialist/supervisor.js').Supervisor;

describe('Supervisor dead-status recovery', () => {
  let tmpDir: string;
  let jobsDir: string;
  let previousJobFileOutputMode: string | undefined;
  let supervisors: Array<InstanceType<SupervisorType>>;
  let Supervisor: SupervisorType;

  const createSupervisor = (options: ConstructorParameters<SupervisorType>[0]): InstanceType<SupervisorType> => {
    const supervisor = new Supervisor(options);
    supervisors.push(supervisor);
    return supervisor;
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../../../src/specialist/observability-sqlite.js', () => {
      const statusById = new Map<string, any>();
      const eventsById = new Map<string, any[]>();
      return {
        createObservabilitySqliteClient: () => ({
          close: vi.fn(),
          readStatus: vi.fn((id: string) => statusById.get(id) ?? null),
          listStatuses: vi.fn(() => [...statusById.values()]),
          upsertStatus: vi.fn((status: any) => {
            statusById.set(status.id, status);
          }),
          upsertStatusWithEvent: vi.fn((status: any, event: any) => {
            statusById.set(status.id, status);
            const existing = eventsById.get(status.id) ?? [];
            existing.push(event);
            eventsById.set(status.id, existing);
          }),
          upsertStatusWithEventAndResult: vi.fn((status: any, event: any) => {
            statusById.set(status.id, status);
            const existing = eventsById.get(status.id) ?? [];
            existing.push(event);
            eventsById.set(status.id, existing);
          }),
          appendEvent: vi.fn((id: string, _specialist: string, _beadId: string | undefined, event: any) => {
            const existing = eventsById.get(id) ?? [];
            existing.push(event);
            eventsById.set(id, existing);
          }),
          upsertEpicRun: vi.fn(),
          upsertEpicChainMembership: vi.fn(),
          __statusById: statusById,
          __eventsById: eventsById,
        }),
      };
    });

    ({ Supervisor } = await import('../../../src/specialist/supervisor.js'));
    tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-read-status-dead-'));
    jobsDir = join(tmpDir, 'jobs');
    mkdirSync(jobsDir, { recursive: true });
    supervisors = [];
    previousJobFileOutputMode = process.env.SPECIALISTS_JOB_FILE_OUTPUT;
    process.env.SPECIALISTS_JOB_FILE_OUTPUT = 'off';
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(supervisors.map((supervisor) => supervisor.dispose()));
    if (previousJobFileOutputMode === undefined) {
      delete process.env.SPECIALISTS_JOB_FILE_OUTPUT;
    } else {
      process.env.SPECIALISTS_JOB_FILE_OUTPUT = previousJobFileOutputMode;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reconciles dead running job to terminal error on readStatus', () => {
    const sup = createSupervisor({ jobsDir, runner: { run: vi.fn() } as any, runOptions: { name: 'test-specialist', prompt: 'do something' } });
    const deadPid = 999_999_999;
    const sqliteClient = (sup as any).sqliteClient;
    sqliteClient.readStatus.mockReturnValueOnce({
      id: 'dead01',
      specialist: 'test-specialist',
      status: 'running',
      started_at_ms: Date.now() - 10_000,
      last_event_at_ms: Date.now() - 10_000,
      pid: deadPid,
    });

    const status = sup.readStatus('dead01');

    expect(status?.status).toBe('error');
    expect(status?.is_dead).toBe(false);
    expect(status?.error).toBe('Process crashed or was killed');
    expect(sqliteClient.upsertStatusWithEvent).toHaveBeenCalledTimes(1);
    const [persistedStatus, event] = sqliteClient.upsertStatusWithEvent.mock.calls[0];
    expect(persistedStatus.status).toBe('error');
    expect(sqliteClient.readStatus('dead01')?.status).toBe('error');
    expect(event.type).toBe('run_complete');
    expect(event.status).toBe('ERROR');
  });

  it('does not append file event when file output is off', () => {
    const sup = createSupervisor({ jobsDir, runner: { run: vi.fn() } as any, runOptions: { name: 'test-specialist', prompt: 'do something' } });
    (sup as any).sqliteClient = null;

    const jobId = 'dead02';
    mkdirSync(join(jobsDir, jobId), { recursive: true });
    writeFileSync(join(jobsDir, jobId, 'status.json'), JSON.stringify({
      id: jobId,
      specialist: 'test-specialist',
      status: 'running',
      started_at_ms: Date.now() - 10_000,
      last_event_at_ms: Date.now() - 10_000,
      pid: 999_999_998,
    }), 'utf-8');

    const status = sup.readStatus(jobId);

    expect(status?.status).toBe('error');
    expect(existsSync(join(jobsDir, jobId, 'events.jsonl'))).toBe(false);
  });

  it('skips dead recovery when started_at_ms is invalid', () => {
    const sup = createSupervisor({ jobsDir, runner: { run: vi.fn() } as any, runOptions: { name: 'test-specialist', prompt: 'do something' } });
    (sup as any).sqliteClient = null;

    const jobId = 'dead03';
    mkdirSync(join(jobsDir, jobId), { recursive: true });
    writeFileSync(join(jobsDir, jobId, 'status.json'), JSON.stringify({
      id: jobId,
      specialist: 'test-specialist',
      status: 'running',
      started_at_ms: null,
      last_event_at_ms: Date.now() - 10_000,
      pid: 999_999_997,
    }), 'utf-8');

    const status = sup.readStatus(jobId);

    expect(status?.status).toBe('running');
    expect(status?.is_dead).toBe(true);
    expect(existsSync(join(jobsDir, jobId, 'events.jsonl'))).toBe(false);
  });
});
