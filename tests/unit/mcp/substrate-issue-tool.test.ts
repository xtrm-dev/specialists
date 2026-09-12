import { describe, it, expect } from 'vitest';
import { createSubstrateIssueTool, substrateIssueSchema } from '../../../src/tools/substrate/issue.tool.js';
import { resolveSubstrate, substrateUnavailablePayload } from '../../../src/substrate/services.js';

/**
 * The Issue tool (unitAI-aiwva.9). Every assertion here exists because the surface must
 * behave identically whether Substrate is reachable or not — on the runtime we ship today
 * it is NOT, so the degraded path is the common path, not the edge case.
 */
function fake(overrides: Record<string, unknown> = {}) {
  const calls: Array<[string, unknown[]]> = [];
  const rec = (name: string, value: unknown) => (...args: unknown[]) => { calls.push([name, args]); return value; };
  const svc = {
    resolveRef: rec('resolveRef', { id: 'P-1', title: 't' }),
    getIssue: rec('getIssue', { id: 'P-1', contract: 'x'.repeat(9000) }),
    createIssue: rec('createIssue', { id: 'P-2' }),
    updateContract: rec('updateContract', { id: 'P-1' }),
    resolveProject: rec('resolveProject', { projectId: 'proj', source: 'link' }),
    createProject: rec('createProject', { id: 'proj', prefix: 'P' }),
    linkCheckout: rec('linkCheckout', { gitRoot: '/r', projectId: 'proj' }),
    listLinks: rec('listLinks', Array.from({ length: 80 }, (_, i) => ({ gitRoot: `/r${i}` }))),
    ...overrides,
  };
  return { svc, calls };
}
const tool = (svc: unknown) => createSubstrateIssueTool(() => svc as never);

describe('substrate_issue availability', () => {
  it('answers with a diagnosis instead of disappearing when substrate is unreachable', async () => {
    // Registering-but-inert beats a missing tool: the coordinator can see the surface
    // exists and why it does nothing.
    const r = await tool(null).execute({ op: 'list_links' }) as Record<string, unknown>;
    expect(r.status).toBe('error');
    expect(String(r.error)).toContain('substrate unavailable');
    expect(r.reason).toBeDefined();
    expect(String(r.help ?? '')).not.toBe('');
  });

  it('reports a self-consistent runtime reason whether Substrate resolves or not (unitAI-tgdtw)', () => {
    // Whether @jaggerxtrm/substrate is installed is a property of the machine
    // running the suite, not something this test controls — so it must not pin
    // one branch as the expected outcome (that was the bug: it always assumed
    // absent). Instead it asserts each branch's own shape is internally sound.
    const h = resolveSubstrate();
    if (h.available) {
      expect(h.reason).toBeUndefined();
      expect(h.services).not.toBeNull();
    } else {
      expect(['module_not_resolvable', 'runtime_incompatible', 'open_failed']).toContain(h.reason);
      expect(substrateUnavailablePayload('t', h).help.length).toBeGreaterThan(0);
    }
  });
});

describe('substrate_issue ops', () => {
  it('routes each op to its service method', async () => {
    const { svc, calls } = fake();
    const t = tool(svc);
    await t.execute({ op: 'resolve', ref: 'P-1' });
    await t.execute({ op: 'get', issue_id: 'P-1' });
    await t.execute({ op: 'create', title: 'a', contract: {}, project_id: 'proj' });
    await t.execute({ op: 'update_contract', issue_id: 'P-1', contract: {} });
    await t.execute({ op: 'project_resolve' });
    await t.execute({ op: 'project_create', prefix: 'P', name: 'n' });
    await t.execute({ op: 'link_checkout', git_root: '/r' });
    await t.execute({ op: 'list_links' });
    expect(calls.map((c) => c[0])).toEqual([
      'resolveRef', 'getIssue', 'createIssue', 'updateContract',
      'resolveProject', 'createProject', 'linkCheckout', 'listLinks',
    ]);
  });

  // unitAI-jz978. Passing no git root relied on Substrate having exactly one project and
  // defaulting to it. With several, that default became a silent wrong answer, so the
  // caller's location has to be sent. These assert the ARGUMENT, not a real store: the
  // tool is service-injected and must not need a resolvable Substrate to be tested.
  it('resolves by the caller location when no project is named', async () => {
    const { svc, calls } = fake();
    await tool(svc).execute({ op: 'project_resolve' });
    const [, args] = calls.find((c) => c[0] === 'resolveProject')!;
    expect(args[0]).toEqual({ gitRoot: process.cwd() });
  });

  it('lets an explicit project win over the caller location', async () => {
    const { svc, calls } = fake();
    await tool(svc).execute({ op: 'project_resolve', project_id: 'prj_explicit' });
    const [, args] = calls.find((c) => c[0] === 'resolveProject')!;
    // No gitRoot at all: an explicit id is an answer, not a hint to be reconciled.
    expect(args[0]).toEqual({ explicit: 'prj_explicit' });
  });

  it('names the missing field instead of throwing', async () => {
    const { svc } = fake();
    const r = await tool(svc).execute({ op: 'create', title: 'a' }) as Record<string, unknown>;
    expect(r.status).toBe('error');
    expect(String(r.error)).toContain('contract');
    expect(String(r.error)).toContain('project_id');
  });

  it('truncates a large contract body with a marker', async () => {
    const { svc } = fake();
    const r = await tool(svc).execute({ op: 'get', issue_id: 'P-1' }) as Record<string, Record<string, Record<string, unknown>>>;
    expect(r.issue.contract.truncated).toBe(true);
    expect(r.issue.contract.bytes).toBe(9000);
  });

  it('caps list results and reports the true total', async () => {
    const { svc } = fake();
    const r = await tool(svc).execute({ op: 'list_links' }) as Record<string, unknown>;
    expect((r.links as unknown[]).length).toBe(50);
    expect(r.total).toBe(80);
    expect(r.capped).toBe(true);
  });

  it('returns a domain refusal as a payload, not an MCP error frame', async () => {
    const { svc } = fake({ resolveRef: () => { throw new Error('unknown ref "nope"'); } });
    const r = await tool(svc).execute({ op: 'resolve', ref: 'nope' }) as Record<string, unknown>;
    expect(r.status).toBe('error');
    expect(String(r.error)).toContain('unknown ref');
  });

  it('rejects an unknown op at the schema boundary', () => {
    expect(() => substrateIssueSchema.parse({ op: 'delete_everything' })).toThrow();
  });
});
