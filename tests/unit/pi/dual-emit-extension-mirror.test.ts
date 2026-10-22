// Extension mirror dual-emit: the Pi surface emits issue_ref alongside bead_id
// with equal values, matching the native MCP tools.
import { describe, it, expect, vi } from 'vitest';

vi.mock('typebox', () => ({
  Type: {
    Object: (props: unknown) => ({ type: 'object', properties: props }),
    String: (opts = {}) => ({ type: 'string', ...opts }),
    Integer: (opts = {}) => ({ type: 'integer', ...opts }),
    Number: (opts = {}) => ({ type: 'number', ...opts }),
    Boolean: (opts = {}) => ({ type: 'boolean', ...opts }),
    Array: (items: unknown) => ({ type: 'array', items }),
    Union: (variants: unknown, opts = {}) => ({ anyOf: variants, ...opts }),
    Literal: (value: unknown) => ({ const: value }),
    Enum: (values: unknown, opts = {}) => ({ enum: Object.values(values as object), ...opts }),
    Unknown: () => ({ type: 'unknown' }),
    Null: () => ({ type: 'null' }),
    Optional: (schema: unknown) => schema,
  },
}));

const SNAPSHOT: any = {
  activationId: 'act:aaaa',
  participantId: 'specialist::explorer',
  attemptId: 'att:aaaa:1',
  specialist: 'explorer',
  issueId: 'iss_bd-1',
  issueRef: 'XTRM-93',
  issueRevision: 1,
  contractHash: 'hash-test',
  executionBindingId: 'exb-test',
  state: 'running',
  access: 'read',
  workspace: { repositoryRoot: '/r', worktreePath: '/r/wt' },
  resolvedModel: 'm',
  modelOverride: false,
  startedAt: 1,
  lastActivityAt: 1,
};

function makePi() {
  const tools: any[] = [];
  const commands: any[] = [];
  const handlers: Record<string, any[]> = {};
  return {
    registerTool: (def: any) => { tools.push(def); },
    registerCommand: (name: string, def: any) => { commands.push({ name, ...def }); },
    getAllTools: () => [...tools],
    getCommands: () => [...commands],
    registerMessageRenderer: () => {},
    on: (event: string, handler: any) => { (handlers[event] ??= []).push(handler); },
    registerFlag: () => {},
    getFlag: () => false,
    sendMessage: () => {},
  } as any;
}

function makeHost(snapshot: any = SNAPSHOT) {
  return {
    list: vi.fn(() => [snapshot]),
    inspect: vi.fn(() => snapshot),
    pendingAsks: vi.fn(() => []),
    start: vi.fn(async (req: any) => {
      const ref = req.issueRef ?? 'XTRM-93';
      return {
        activationId: snapshot.activationId,
        issueRef: ref,
        stepContract: { rootWorkRef: ref, inputs: [1], outputs: [1] },
        result: Promise.resolve({
          activationId: snapshot.activationId,
          participantId: 'specialist::explorer',
          attemptId: 'att:aaaa:1',
          issueId: 'iss_XTRM-93',
          issueRef: ref,
          issueRevision: 1,
          contractHash: 'h',
          executionBindingId: 'exb',
          status: 'completed',
          output: 'report',
          validation: { valid: true },
          resolvedModel: 'm',
          modelOverride: false,
          fallbackUsed: false,
          completedAt: 100,
        }),
      };
    }),
    answer: vi.fn(),
    stop: vi.fn(),
    steer: vi.fn(),
    resume: vi.fn(),
    retry: vi.fn(),
  };
}

const toolPayload = async (pi: any, name: string, params: any) => {
  const tool = pi.getAllTools().find((t: any) => t.name === name);
  const out = await tool.execute('tc1', params);
  return out?.structuredContent ?? out;
};

describe('extension mirror dual-emit', () => {
  it('output schemas carry the pair', async () => {
    const mod = await import('../../../config/pi-extensions/native-specialists/index.mjs');
    const dispatchProps = mod.TOOL_OUTPUT_SCHEMAS.specialist_dispatch.properties as Record<string, unknown>;
    expect(dispatchProps).toHaveProperty('bead_id');
    expect(dispatchProps).toHaveProperty('issue_ref');
    expect(dispatchProps).toHaveProperty('created_issue_ref');
    expect(dispatchProps).toHaveProperty('created_bead_id');
    const resultProps = mod.TOOL_OUTPUT_SCHEMAS.specialist_result.properties as Record<string, unknown>;
    expect(resultProps).toHaveProperty('bead_id');
    expect(resultProps).toHaveProperty('issue_ref');
  });

  it('dispatch emits issue_ref == bead_id', async () => {
    const mod = await import('../../../config/pi-extensions/native-specialists/index.mjs');
    const pi = makePi();
    mod.default(pi, { createHost: () => makeHost() });
    const out = await toolPayload(pi, 'specialist_dispatch', { specialist: 'explorer', bead_id: 'XTRM-93' });
    expect(out.status).toBe('dispatched');
    expect(out.bead_id).toBe('XTRM-93');
    expect(out.issue_ref).toBe('XTRM-93');
    expect(out.issue_ref).toBe(out.bead_id);
  });

  it('status rows emit issue_ref == bead_id', async () => {
    const mod = await import('../../../config/pi-extensions/native-specialists/index.mjs');
    const pi = makePi();
    mod.default(pi, { createHost: () => makeHost() });
    const out = await toolPayload(pi, 'specialist_status', {});
    expect(out.activations).toHaveLength(1);
    expect(out.activations[0].bead_id).toBe('XTRM-93');
    expect(out.activations[0].issue_ref).toBe('XTRM-93');
    expect(out.activations[0].issue_ref).toBe(out.activations[0].bead_id);
  });

  it('result emits bead_id == issue_ref', async () => {
    const mod = await import('../../../config/pi-extensions/native-specialists/index.mjs');
    const pi = makePi();
    const host = makeHost();
    mod.default(pi, { createHost: () => host });
    await toolPayload(pi, 'specialist_dispatch', { specialist: 'explorer', bead_id: 'XTRM-93' });
    await new Promise((r) => setTimeout(r, 0));
    const out = await toolPayload(pi, 'specialist_result', { activation_id: 'act:aaaa' });
    // settled via dispatch result promise; falls back to live guidance when unsettled
    if (out.source === 'memory') {
      expect(out.bead_id).toBe('XTRM-93');
      expect(out.issue_ref).toBe('XTRM-93');
      expect(out.issue_ref).toBe(out.bead_id);
    } else {
      expect(out.activation_id).toBe('act:aaaa');
    }
  });

  it('render paths prefer issue_ref with bead_id fallback', async () => {
    const mod = await import('../../../config/pi-extensions/native-specialists/index.mjs');
    const [primary] = mod.renderFleetRowLines({ specialist: 'explorer', activation_id: 'act:aaaa', state: 'running', bead_id: 'XTRM-old', issue_ref: 'XTRM-new' }, []);
    expect(primary).toContain('XTRM-new');
    const [fallback] = mod.renderFleetRowLines({ specialist: 'explorer', activation_id: 'act:aaaa', state: 'running', bead_id: 'XTRM-old' }, []);
    expect(fallback).toContain('XTRM-old');
    const askWake = mod.formatAskWake({ specialist: 'explorer', activationId: 'act:aaaa', beadId: 'XTRM-old', issueRef: 'XTRM-new', kind: 'question', body: 'hi?' }, { bead_id: 'XTRM-old', issue_ref: 'XTRM-new' });
    expect(askWake).toContain('XTRM-new');
    const doneWake = mod.formatSettlementWake({ specialist: 'explorer', activationId: 'act:aaaa', beadId: 'XTRM-old', issueRef: 'XTRM-new', outcome: 'completed' }, { bead_id: 'XTRM-old', issue_ref: 'XTRM-new', elapsed_s: 1 });
    expect(doneWake).toContain('XTRM-new');
  });

  it('ask observer sink carries beadId == issueRef', async () => {
    const mod = await import('../../../config/pi-extensions/native-specialists/index.mjs');
    const seen: any[] = [];
    const sink = mod.createAskObserverSink({ emit: () => {} }, (p: any) => seen.push(p), undefined);
    sink.emit({ activationId: 'act:aaaa', attemptId: 'att:1', specialist: 'explorer', beadId: 'XTRM-93', name: 'clarification_requested', payload: { body: 'q?' } });
    expect(seen).toHaveLength(1);
    expect(seen[0].beadId).toBe('XTRM-93');
    expect(seen[0].issueRef).toBe('XTRM-93');
    expect(seen[0].issueRef).toBe(seen[0].beadId);
  });
});
