// Phase 2b dual-emit: every emitted dispatch/status/feed/result payload carries
// issue_ref (and created_issue_ref where an emission pair exists) alongside the
// bead_* alias, with both spellings equal from the same read.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  toActivationCompactView,
  toActivationView,
  toActivationResultView,
  createSpecialistDispatchTool,
} from '../../../src/tools/specialist/activation.tool.js';
import { createSpecialistStatusTool } from '../../../src/tools/specialist/specialist_status.tool.js';
import { createSpecialistResultTool } from '../../../src/tools/specialist/specialist_result.tool.js';
import { createFeedSpecialistTool } from '../../../src/tools/specialist/feed_specialist.tool.js';
import { buildChannelFrame } from '../../../src/mcp/channel.js';
import { CircuitBreaker } from '../../../src/utils/circuitBreaker.js';

const SNAPSHOT: any = {
  activationId: 'act:dual-1',
  participantId: 'participant::x',
  attemptId: 'att:dual-1',
  specialist: 'researcher',
  issueId: 'iss_dual-1',
  issueRef: 'XTRM-241',
  issueRevision: 3,
  contractHash: 'hash-dual',
  executionBindingId: 'exb-dual',
  state: 'running',
  access: 'read',
  workspace: { worktreePath: '/tmp/dual-wt' },
  resolvedModel: 'testprov/test-model',
  modelOverride: false,
  thinkingOverride: false,
  startedAt: Date.now() - 5000,
  lastActivityAt: Date.now(),
};

const RESULT: any = {
  activationId: 'act:dual-1',
  participantId: 'participant::x',
  attemptId: 'att:dual-1',
  issueId: 'iss_dual-1',
  issueRef: 'XTRM-241',
  issueRevision: 3,
  contractHash: 'hash-dual',
  executionBindingId: 'exb-dual',
  status: 'completed',
  output: 'report',
  validation: { valid: true },
  resolvedModel: 'testprov/test-model',
  modelOverride: false,
  thinkingOverride: false,
  fallbackUsed: false,
  completedAt: 1700000000000,
};

const VALID_CONTRACT = [
  'PROBLEM: p',
  'SUCCESS: s',
  'SCRUTINY: LOW',
  'SCOPE: sc',
  'NON_GOALS: n',
  'CONSTRAINTS: c',
  'VALIDATION: v',
  'OUTPUT: o',
].join('\n');

const tmpRoots: string[] = [];
afterEach(() => {
  while (tmpRoots.length > 0) rmSync(tmpRoots.pop() as string, { recursive: true, force: true });
});

function dispatchHost(issueRef = 'XTRM-241', snapshot: any = SNAPSHOT) {
  const handle = {
    activationId: snapshot.activationId,
    issueRef,
    stepContract: { rootWorkRef: issueRef, inputs: 1, outputs: 1 },
    result: Promise.resolve(RESULT),
  };
  return {
    start: async () => handle,
    inspect: () => snapshot,
  } as never;
}

describe('dual-emit issue_ref / bead_id', () => {
  it('toActivationCompactView carries an equal pair from the same read', () => {
    const view = toActivationCompactView(SNAPSHOT) as Record<string, unknown>;
    expect(view.bead_id).toBe('XTRM-241');
    expect(view.issue_ref).toBe('XTRM-241');
    expect(view.issue_ref).toBe(view.bead_id);
  });

  it('toActivationView carries an equal pair', () => {
    const view = toActivationView(SNAPSHOT) as Record<string, unknown>;
    expect(view.bead_id).toBe(view.issue_ref);
    expect(view.issue_ref).toBe('XTRM-241');
  });

  it('toActivationResultView carries an equal pair', () => {
    const view = toActivationResultView(RESULT) as Record<string, unknown>;
    expect(view.bead_id).toBe(view.issue_ref);
    expect(view.issue_ref).toBe('XTRM-241');
  });

  it('compact dispatch emits issue_ref == bead_id', async () => {
    const tool = createSpecialistDispatchTool(dispatchHost);
    const out = (await tool.execute({ specialist: 'researcher', bead_id: 'XTRM-241' })) as Record<string, unknown>;
    expect(out.status).toBe('dispatched');
    expect(out.bead_id).toBe('XTRM-241');
    expect(out.issue_ref).toBe('XTRM-241');
    expect(out.issue_ref).toBe(out.bead_id);
  });

  it('full dispatch emits issue_ref == bead_id', async () => {
    const tool = createSpecialistDispatchTool(dispatchHost);
    const out = (await tool.execute({ specialist: 'researcher', bead_id: 'XTRM-241', full: true })) as Record<string, unknown>;
    expect(out.status).toBe('dispatched');
    expect(out.bead_id).toBe('XTRM-241');
    expect(out.issue_ref).toBe('XTRM-241');
    expect(out.issue_ref).toBe(out.bead_id);
  });

  it('inline dispatch emits created_issue_ref == created_bead_id', async () => {
    const tool = createSpecialistDispatchTool(() => dispatchHost('XTRM-inline-1', { ...SNAPSHOT, activationId: 'act:inline-1' }));
    const out = (await tool.execute({ specialist: 'researcher', contract: VALID_CONTRACT })) as Record<string, unknown>;
    expect(out.status).toBe('dispatched');
    expect(out.created_issue_ref).toBeDefined();
    expect(out.created_bead_id).toBe(out.created_issue_ref);
  });

  it('compact status rows emit issue_ref == bead_id', async () => {
    const status = createSpecialistStatusTool(
      { list: async () => [] } as never,
      new CircuitBreaker(),
      () => ({ list: () => [SNAPSHOT], pendingAsks: () => [] }) as never,
      () => ({ allResults: () => [] }) as never,
    );
    const out = (await status.execute({})) as { activations: Record<string, unknown>[] };
    expect(out.activations).toHaveLength(1);
    expect(out.activations[0].bead_id).toBe('XTRM-241');
    expect(out.activations[0].issue_ref).toBe('XTRM-241');
    expect(out.activations[0].issue_ref).toBe(out.activations[0].bead_id);
  });

  it('full status rows emit issue_ref == bead_id', async () => {
    const status = createSpecialistStatusTool(
      { list: async () => [{ name: 'researcher' }] } as never,
      new CircuitBreaker(),
      () => ({ list: () => [SNAPSHOT], pendingAsks: () => [] }) as never,
      () => ({ allResults: () => [] }) as never,
    );
    const out = (await status.execute({ full: true })) as { activations: Record<string, unknown>[] };
    expect(out.activations[0].bead_id).toBe(out.activations[0].issue_ref);
    expect(out.activations[0].issue_ref).toBe('XTRM-241');
  });

  it('specialist_result memory path emits bead_id == issue_ref', async () => {
    const tool = createSpecialistResultTool(
      () => ({ list: () => [{ activationId: 'act:dual-1', specialist: 'researcher' }] }) as never,
      () => ({ allResults: () => [RESULT] }) as never,
      () => null,
    );
    const out = (await tool.execute({ activation_id: 'act:dual-1' })) as Record<string, unknown>;
    expect(out.bead_id).toBe('XTRM-241');
    expect(out.issue_ref).toBe('XTRM-241');
    expect(out.issue_ref).toBe(out.bead_id);
  });

  it('specialist_result observability_db path emits bead_id == issue_ref from the same read', async () => {
    const fakeClient = {
      readResult: () => 'report',
      readStatus: () => ({ specialist: 'researcher', bead_id: 'XTRM-9', status: 'done', model: 'm', last_event_at_ms: 5 }),
      close: () => {},
    };
    const tool = createSpecialistResultTool(undefined, () => ({ allResults: () => [] }) as never, () => fakeClient as never);
    const out = (await tool.execute({ activation_id: 'act:db-1' })) as Record<string, unknown>;
    expect(out.bead_id).toBe('XTRM-9');
    expect(out.issue_ref).toBe('XTRM-9');
    expect(out.issue_ref).toBe(out.bead_id);
  });

  it('feed_specialist emits issue_ref == bead_id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dual-feed-'));
    tmpRoots.push(root);
    const jobsDir = join(root, 'jobs');
    const jobDir = join(jobsDir, 'job-dual');
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(join(jobDir, 'events.jsonl'), JSON.stringify({ t: Date.now(), type: 'run_start', specialist: 'test-spec' }), 'utf-8');
    writeFileSync(
      join(jobDir, 'status.json'),
      JSON.stringify({ id: 'job-dual', specialist: 'executor', status: 'done', started_at_ms: Date.now(), bead_id: 'XTRM-77' }),
      'utf-8',
    );
    const prev = process.env.SPECIALISTS_JOB_FILE_OUTPUT;
    process.env.SPECIALISTS_JOB_FILE_OUTPUT = 'on';
    try {
      const tool = createFeedSpecialistTool(jobsDir);
      const out = (await tool.execute({ job_id: 'job-dual', cursor: 0, limit: 50 })) as Record<string, unknown>;
      expect(out.bead_id).toBe('XTRM-77');
      expect(out.issue_ref).toBe('XTRM-77');
      expect(out.issue_ref).toBe(out.bead_id);
    } finally {
      if (prev === undefined) delete process.env.SPECIALISTS_JOB_FILE_OUTPUT;
      else process.env.SPECIALISTS_JOB_FILE_OUTPUT = prev;
    }
  });

  it('channel meta emits bead_id == issue_ref from the same work ref', () => {
    const { params } = buildChannelFrame({ activationId: 'act:1', specialist: 'executor', beadId: 'XTRM-241', eventClass: 'completed' });
    expect(params.meta.bead_id).toBe('XTRM-241');
    expect(params.meta.issue_ref).toBe('XTRM-241');
    expect(params.meta.issue_ref).toBe(params.meta.bead_id);
  });

  it('channel meta accepts issueRef spelling and still emits the pair', () => {
    const { params } = buildChannelFrame({ activationId: 'act:1', specialist: 'executor', issueRef: 'XTRM-241', eventClass: 'completed' });
    expect(params.meta.bead_id).toBe('XTRM-241');
    expect(params.meta.issue_ref).toBe('XTRM-241');
  });

  it('channel meta omits both keys when no work ref is given', () => {
    const { params } = buildChannelFrame({ activationId: 'act:2', specialist: 'researcher', eventClass: 'needs_reply' });
    expect(params.meta.bead_id).toBeUndefined();
    expect(params.meta.issue_ref).toBeUndefined();
  });
});
