import { describe, it, expect } from 'vitest';
import {
  createSubstrateProvenanceTool,
  MAX_PROVENANCE_ENTRIES,
  type ProvenanceServiceLike,
} from '../../../src/tools/substrate/provenance.tool.js';

function fake(overrides?: Partial<ProvenanceServiceLike>): ProvenanceServiceLike {
  return {
    trace: (issueId: string) => ({
      issueId,
      locator: 'loc',
      bindings: [{ id: 'b1' }],
      receipts: [{ id: 'r1' }],
      checkpoints: [],
      commits: ['abc'],
      prs: [],
      claims: [],
      externalBindings: [],
    }),
    listBindings: () => [{ id: 'b1' }],
    listReceipts: () => [{ id: 'r1' }],
    findByCommit: () => [{ receipt: { id: 'r1' } }],
    findByPr: () => [{ receipt: { id: 'r2' } }],
    listArtifacts: () => [{ kind: 'commit', value: 'abc' }],
    bindCommit: (receiptId: string, sha: string) => ({ receiptId, sha }),
    generateBundle: () => ({ path: '.xtrm/provenance/bundles/b1.json' }),
    ...overrides,
  };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('substrate provenance tool', () => {
  it('trace returns capped collections with totals', async () => {
    const tool = createSubstrateProvenanceTool(() =>
      fake({
        trace: () => ({
          issueId: 'I-1',
          locator: 'loc',
          bindings: range(80),
          receipts: range(70),
          checkpoints: range(60),
          commits: range(55),
          prs: range(51),
          claims: range(10),
          externalBindings: range(5),
        }),
      }),
    );
    const out = (await tool.execute({ op: 'trace', issueId: 'I-1' })) as Record<string, unknown>;
    expect(out.status).toBe('ok');
    expect((out.bindings as unknown[]).length).toBe(MAX_PROVENANCE_ENTRIES);
    expect(out.bindingsTotal).toBe(80);
    expect(out.bindingsTruncated).toBe(true);
    expect((out.commits as unknown[]).length).toBe(MAX_PROVENANCE_ENTRIES);
    expect(out.commitsTotal).toBe(55);
    expect((out.claims as unknown[]).length).toBe(10);
  });

  it('each read op routes to the service', async () => {
    const tool = createSubstrateProvenanceTool(() => fake());
    expect(((await tool.execute({ op: 'bindings', issueId: 'I' })) as { status: string }).status).toBe('ok');
    expect(((await tool.execute({ op: 'receipts', issueId: 'I' })) as { status: string }).status).toBe('ok');
    expect(((await tool.execute({ op: 'find_by_commit', sha: 'abc' })) as { status: string }).status).toBe('ok');
    expect(((await tool.execute({ op: 'find_by_pr', pr: '12' })) as { status: string }).status).toBe('ok');
    expect(((await tool.execute({ op: 'artifacts', receiptId: 'r' })) as { status: string }).status).toBe('ok');
    const bound = (await tool.execute({ op: 'bind_commit', receiptId: 'r', sha: 'abc' })) as {
      status: string;
      receipt: unknown;
    };
    expect(bound.status).toBe('ok');
    expect(bound.receipt).toEqual({ receiptId: 'r', sha: 'abc' });
  });

  it('bundle returns a path only, never contents', async () => {
    const tool = createSubstrateProvenanceTool(() => fake());
    const out = (await tool.execute({ op: 'bundle', issueId: 'I' })) as Record<string, unknown>;
    expect(out).toEqual({ status: 'ok', path: '.xtrm/provenance/bundles/b1.json' });
  });

  it('null service yields an unavailable payload, never a throw', async () => {
    const tool = createSubstrateProvenanceTool(() => null);
    for (const input of [
      { op: 'trace', issueId: 'I' },
      { op: 'bundle', issueId: 'I' },
      { op: 'bind_commit', receiptId: 'r', sha: 's' },
    ] as Parameters<typeof tool.execute>[0][]) {
      await expect(tool.execute(input)).resolves.toEqual({
        status: 'error',
        error: 'substrate provenance unavailable',
      });
    }
  });

  it('missing required params name the field', async () => {
    const tool = createSubstrateProvenanceTool(() => fake());
    expect(await tool.execute({ op: 'trace' })).toEqual({ status: 'error', error: 'missing required param: issueId' });
    expect(await tool.execute({ op: 'find_by_commit' })).toEqual({ status: 'error', error: 'missing required param: sha' });
    expect(await tool.execute({ op: 'find_by_pr' })).toEqual({ status: 'error', error: 'missing required param: pr' });
    expect(await tool.execute({ op: 'artifacts' })).toEqual({ status: 'error', error: 'missing required param: receiptId' });
    expect(await tool.execute({ op: 'bind_commit', receiptId: 'r' })).toEqual({
      status: 'error',
      error: 'missing required param: sha',
    });
    expect(await tool.execute({ op: 'bundle' })).toEqual({ status: 'error', error: 'missing required param: issueId' });
  });

  it('service throws become payload errors', async () => {
    const tool = createSubstrateProvenanceTool(() =>
      fake({
        trace: () => {
          throw new Error('unknown issue: NOPE');
        },
      }),
    );
    expect(await tool.execute({ op: 'trace', issueId: 'NOPE' })).toEqual({
      status: 'error',
      error: 'unknown issue: NOPE',
    });
  });
});
