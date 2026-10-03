// tests/unit/tools/specialist-result.test.ts
// SPECIALISTS-4247 (MCP half): specialist_result reads ONE activation's complete result.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { createSpecialistResultTool } from '../../../src/tools/specialist/specialist_result.tool.js';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';
import { buildChannelFrame } from '../../../src/mcp/channel.js';
import { checkObservabilityDb } from '../../../src/cli/doctor.js';

const LONG = 'line\n'.repeat(5000);

function memoryResult(activationId: string, output: unknown = LONG) {
  return {
    activationId, participantId: 'p', attemptId: 'a', issueId: 'iss_1', issueRef: 'XTRM-1',
    issueRevision: 1, contractHash: 'h', executionBindingId: 'exb_1', status: 'completed' as const,
    output, validation: { valid: true }, resolvedModel: 'm', modelOverride: false, completedAt: 1700000000000,
  };
}

const pusherWith = (...results: ReturnType<typeof memoryResult>[]) => () => ({ allResults: () => results }) as never;
const hostWith = (...snaps: { activationId: string; specialist: string; state: string }[]) => () => ({ list: () => snaps }) as never;
const noDb = () => null;

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('specialist_result', () => {
  it('returns the complete in-memory result untruncated, with source memory', async () => {
    const tool = createSpecialistResultTool(
      hostWith({ activationId: 'act:a2924153-111', specialist: 'executor', state: 'settled' }),
      pusherWith(memoryResult('act:a2924153-111')),
      noDb,
    );
    const out = await tool.execute({ activation_id: 'act:a2924153-111' }) as Record<string, unknown>;
    expect(out).toMatchObject({ activation_id: 'act:a2924153-111', specialist: 'executor', issue_ref: 'XTRM-1', status: 'completed', source: 'memory' });
    expect(out.output).toBe(LONG);
  });

  it('resolves a unique short prefix with or without the act: prefix', async () => {
    const tool = createSpecialistResultTool(undefined, pusherWith(memoryResult('act:a2924153-111')), noDb);
    for (const id of ['a2924153', 'act:a2924153']) {
      const out = await tool.execute({ activation_id: id }) as Record<string, unknown>;
      expect(out.activation_id).toBe('act:a2924153-111');
    }
  });

  it('reports an ambiguous prefix with its candidates', async () => {
    const tool = createSpecialistResultTool(
      undefined,
      pusherWith(memoryResult('act:a2924153-111'), memoryResult('act:a2924153-222')),
      noDb,
    );
    const out = await tool.execute({ activation_id: 'a2924153' }) as Record<string, unknown>;
    expect(out.status).toBe('error');
    expect(out.candidates).toEqual(['act:a2924153-111', 'act:a2924153-222']);
  });

  it('reports an unknown activation', async () => {
    const tool = createSpecialistResultTool(hostWith(), pusherWith(), noDb);
    expect(await tool.execute({ activation_id: 'act:zzzz' })).toEqual({ status: 'error', error: 'Unknown activation: act:zzzz' });
  });

  it('names the next tool for an activation that has not settled', async () => {
    const snaps = [
      { activationId: 'act:run-1', specialist: 'executor', state: 'running' },
      { activationId: 'act:wait-1', specialist: 'executor', state: 'waiting' },
      { activationId: 'act:fail-1', specialist: 'executor', state: 'failed' },
    ];
    const tool = createSpecialistResultTool(hostWith(...snaps), pusherWith(), noDb);
    const next = async (id: string) => (await tool.execute({ activation_id: id }) as { next: string }).next;
    expect(await next('act:run-1')).toContain('specialist_steer');
    expect(await next('act:wait-1')).toContain('specialist_reply');
    expect(await next('act:fail-1')).toContain('specialist_retry');
  });

  it('falls back to the durable observability.db row, with source observability_db', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sp-result-'));
    dirs.push(dir);
    const dbPath = join(dir, 'observability.db');
    createObservabilitySqliteClientAtPath(dbPath)?.close();
    const raw = new Database(dbPath);
    raw.run('INSERT INTO specialist_results (job_id, output, updated_at_ms) VALUES (?, ?, ?)', ['act:db-1', LONG, 1]);
    raw.close();

    const tool = createSpecialistResultTool(undefined, pusherWith(), () => createObservabilitySqliteClientAtPath(dbPath));
    const out = await tool.execute({ activation_id: 'act:db-1' }) as Record<string, unknown>;
    expect(out).toMatchObject({ activation_id: 'act:db-1', source: 'observability_db' });
    expect(out.output).toBe(LONG);
  });
});

describe('channel actions', () => {
  it('names specialist_result for completed and failed, specialist_status for asks', () => {
    const frame = (event: string) => buildChannelFrame({ specialist: 'executor', beadId: 'XTRM-1', activationId: 'act:a2924153-111', eventClass: event }).params.content;
    expect(frame('completed')).toContain('Call specialist_result for the full result.');
    expect(frame('failed')).toContain('Call specialist_result for the failure detail.');
    expect(buildChannelFrame({ specialist: 'executor', activationId: 'act:x', eventClass: 'completed' }).params.meta.read_with).toBe('specialist_result');
    expect(frame('needs_reply')).toContain('specialist_status');
    expect(frame('escalation')).toContain('specialist_status');
  });
});

describe('doctor observability check', () => {
  it('reports a missing observability.db with the fix and does not create it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sp-doctor-'));
    dirs.push(dir);
    const lines: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
    try {
      expect(checkObservabilityDb(dir)).toBe(false);
    } finally { console.log = log; }
    expect(lines.join('\n')).toContain('specialists db setup');
  });
});
