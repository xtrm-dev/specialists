import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createForensicEvent } from '../../../src/specialist/forensic-events.js';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';
import { withForensicObservability } from '../../../src/cli/console/observability-runtime.js';
import type { RuntimeClient } from '../../../src/cli/console/types.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runtimeStub(readFeed = vi.fn(async () => [])): RuntimeClient {
  return { readFeed } as unknown as RuntimeClient;
}

describe('console forensic observability adapter', () => {
  it('reads the forensic source from persisted xtrm.forensic.v1 rows without calling the timeline fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'specialists-console-observability-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'observability.db');
    const client = createObservabilitySqliteClientAtPath(dbPath);
    expect(client).not.toBeNull();
    client!.appendForensicEvent('act:test', 'reviewer', 'unitAI-test', createForensicEvent({
      event_family: 'job',
      event_name: 'job.started',
      t_unix_ms: 100,
      seq: 1,
      resource: {
        service_namespace: 'xtrm',
        service_name: 'specialists',
        service_component: 'native',
        deployment_environment: 'test',
        repo: 'specialists',
        participant_kind: 'specialist',
        participant_role: 'reviewer',
      },
      correlation: { job_id: 'act:test', bead_id: 'unitAI-test' },
      body: { status: 'running' },
    }));
    client!.close();

    const fallback = vi.fn(async () => [{
      jobId: 'legacy', specialist: 'legacy', t: 1, type: 'legacy', line: 'legacy timeline fallback',
    }]);
    const runtime = withForensicObservability(runtimeStub(fallback));
    const rows = await runtime.readFeed({
      repo: { id: 'specialists', name: 'specialists', path: dir, dbPath },
      jobId: 'act:test',
      source: 'forensic',
      limit: 20,
    });

    expect(fallback).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.jobId).toBe('act:test');
    expect(rows[0]?.line).toContain('job.started');
  });

  it('keeps sp_feed on the existing runtime projection', async () => {
    const fallback = vi.fn(async () => [{
      jobId: 'job-a', specialist: 'reviewer', t: 1, type: 'run_start', line: 'legacy feed',
    }]);
    const runtime = withForensicObservability(runtimeStub(fallback));
    const rows = await runtime.readFeed({
      repo: { id: 'repo', name: 'repo', path: '/does/not/matter' },
      jobId: 'job-a',
      source: 'sp_feed',
      limit: 20,
    });

    expect(fallback).toHaveBeenCalledOnce();
    expect(rows[0]?.line).toBe('legacy feed');
  });
});
