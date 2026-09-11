import { describe, it, expect } from 'vitest';
import {
  createSubstrateProvenanceTool,
  MAX_PROVENANCE_ENTRIES,
  type ProvenanceServiceLike,
} from '../../../src/tools/substrate/provenance.tool.js';

function fake(overrides?: Partial<ProvenanceServiceLike>): ProvenanceServiceLike {
  return {
    trace: (issue_id: string) => ({
      issue_id,
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
    bindCommit: (receipt_id: string, sha: string) => ({ receipt_id, sha }),
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
          issue_id: 'I-1',
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
    const out = (await tool.execute({ op: 'trace', issue_id: 'I-1' })) as Record<string, unknown>;
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
    expect(((await tool.execute({ op: 'bindings', issue_id: 'I' })) as { status: string }).status).toBe('ok');
    expect(((await tool.execute({ op: 'receipts', issue_id: 'I' })) as { status: string }).status).toBe('ok');
    expect(((await tool.execute({ op: 'find_by_commit', sha: 'abc' })) as { status: string }).status).toBe('ok');
    expect(((await tool.execute({ op: 'find_by_pr', pr: '12' })) as { status: string }).status).toBe('ok');
    expect(((await tool.execute({ op: 'artifacts', receipt_id: 'r' })) as { status: string }).status).toBe('ok');
    const bound = (await tool.execute({ op: 'bind_commit', receipt_id: 'r', sha: 'abc' })) as {
      status: string;
      receipt: unknown;
    };
    expect(bound.status).toBe('ok');
    expect(bound.receipt).toEqual({ receipt_id: 'r', sha: 'abc' });
  });

  it('bundle returns a path only, never contents', async () => {
    const tool = createSubstrateProvenanceTool(() => fake());
    const out = (await tool.execute({ op: 'bundle', issue_id: 'I' })) as Record<string, unknown>;
    expect(out).toEqual({ status: 'ok', path: '.xtrm/provenance/bundles/b1.json' });
  });

  it('null service yields an unavailable payload, never a throw', async () => {
    const tool = createSubstrateProvenanceTool(() => null);
    for (const input of [
      { op: 'trace', issue_id: 'I' },
      { op: 'bundle', issue_id: 'I' },
      { op: 'bind_commit', receipt_id: 'r', sha: 's' },
    ] as Parameters<typeof tool.execute>[0][]) {
      const r = (await tool.execute(input)) as { status: string; error: string; reason?: string; help?: string };
      expect(r.status).toBe('error');
      expect(r.error).toContain('substrate unavailable');
      // Shared diagnosis contract (.9): every substrate tool reports why, one dialect.
      expect(r.reason).toBeDefined();
      expect(r.help).toBeTruthy();
    }
  });

  it('missing required params name the field', async () => {
    const tool = createSubstrateProvenanceTool(() => fake());
    expect(await tool.execute({ op: 'trace' })).toEqual({ status: 'error', error: 'missing required param: issue_id' });
    expect(await tool.execute({ op: 'find_by_commit' })).toEqual({ status: 'error', error: 'missing required param: sha' });
    expect(await tool.execute({ op: 'find_by_pr' })).toEqual({ status: 'error', error: 'missing required param: pr' });
    expect(await tool.execute({ op: 'artifacts' })).toEqual({ status: 'error', error: 'missing required param: receipt_id' });
    expect(await tool.execute({ op: 'bind_commit', receipt_id: 'r' })).toEqual({
      status: 'error',
      error: 'missing required param: sha',
    });
    expect(await tool.execute({ op: 'bundle' })).toEqual({ status: 'error', error: 'missing required param: issue_id' });
  });

  it('service throws become payload errors', async () => {
    const tool = createSubstrateProvenanceTool(() =>
      fake({
        trace: () => {
          throw new Error('unknown issue: NOPE');
        },
      }),
    );
    expect(await tool.execute({ op: 'trace', issue_id: 'NOPE' })).toEqual({
      status: 'error',
      error: 'unknown issue: NOPE',
    });
  });
});
