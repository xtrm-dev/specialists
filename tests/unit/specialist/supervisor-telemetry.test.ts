import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Supervisor } from '../../../src/specialist/supervisor.js';
import type { SupervisorStatus } from '../../../src/specialist/supervisor.js';

function makeSupervisor(jobsDir: string): Supervisor {
  return new Supervisor({
    jobsDir,
    runner: { run: async () => ({ output: '', model: 'test', backend: 'test' }) } as any,
    runOptions: { name: 'test-specialist', prompt: 'test' } as any,
  });
}

describe('supervisor telemetry fallback', () => {
  let tmpDir: string;
  let jobsDir: string;
  let originalJobFileOutput: string | undefined;

  beforeEach(() => {
    originalJobFileOutput = process.env.SPECIALISTS_JOB_FILE_OUTPUT;
    process.env.SPECIALISTS_JOB_FILE_OUTPUT = 'on';
    tmpDir = mkdtempSync(join(tmpdir(), 'supervisor-telemetry-'));
    jobsDir = join(tmpDir, 'jobs');
    mkdirSync(jobsDir, { recursive: true });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (originalJobFileOutput === undefined) {
      delete process.env.SPECIALISTS_JOB_FILE_OUTPUT;
    } else {
      process.env.SPECIALISTS_JOB_FILE_OUTPUT = originalJobFileOutput;
    }
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('updates file status when SQLite is unavailable', async () => {
    const supervisor = makeSupervisor(jobsDir);
    try {
      (supervisor as any).sqliteClient = undefined;
      const jobId = 'job-status-fallback';
      const jobDir = join(jobsDir, jobId);
      mkdirSync(jobDir, { recursive: true });
      const status: SupervisorStatus = {
        id: jobId,
        specialist: 'test-specialist',
        status: 'running',
        started_at_ms: Date.now(),
      };
      writeFileSync(join(jobDir, 'status.json'), JSON.stringify(status), 'utf-8');

      expect(() => supervisor.updateJobStatus(jobId, 'cancelled')).not.toThrow();

      const updated = JSON.parse(readFileSync(join(jobDir, 'status.json'), 'utf-8')) as SupervisorStatus;
      expect(updated.status).toBe('cancelled');
    } finally {
      await supervisor.dispose();
    }
  });

  it('does not throw when control telemetry cannot be persisted', async () => {
    const supervisor = makeSupervisor(jobsDir);
    try {
      (supervisor as any).sqliteClient = undefined;

      expect(() => supervisor.emitControlEvent('missing-job', 'stop_requested', { source: 'cli' })).not.toThrow();
    } finally {
      await supervisor.dispose();
    }
  });
});
