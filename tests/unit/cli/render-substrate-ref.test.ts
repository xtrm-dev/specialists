// Substrate-only Issue refs render through the shared work boundary (SPECIALISTS-4353).
//
// `sp render-task --issue-ref` / `sp render-bead --issue-ref` resolve the locator
// through the same Substrate boundary dispatch uses (read-only: view +
// completedBlockers only), falling back to the legacy Beads reader for refs that
// exist only there. Unknown refs still fail with `bead_not_found` naming the ref.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeadRecord } from '../../../src/specialist/beads.js';
import type {
  SpecialistWorkItemBoundary,
  WorkItemView,
} from '../../../src/activation/workitem-store.js';
import type { Specialist } from '../../../src/specialist/schema.js';
import { __setWorkItemsForTests } from '../../../src/cli/render-task.js';

const SUBSTRATE_REF = 'SUB-1';
const LEGACY_BEAD: BeadRecord = {
  id: 'legacy-1',
  title: 'Legacy bead',
  description: 'PROBLEM: legacy only.',
  status: 'open',
} as BeadRecord;

const SUBSTRATE_CONTRACT = {
  problem: 'The board owns this work.',
  success: 'The render shows the pinned contract.',
  scope: ['Render the issue'],
  nonGoals: ['Mutate anything'],
  constraints: ['Read-only'],
  validation: [{ check: 'Contract text appears' }],
  output: [{ artifact: 'A finding' }],
};

let readBead: (id: string) => BeadRecord | null;
let specs: Record<string, Specialist>;

// Only the bd-shelling client is faked; the prompt assembly stays production.
vi.mock('../../../src/specialist/beads.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/specialist/beads.js')>();
  return {
    ...actual,
    BeadsClient: class {
      readBead(id: string) { return readBead(id); }
      getCompletedBlockers() { return []; }
    },
  };
});

vi.mock('../../../src/specialist/loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/specialist/loader.js')>();
  return {
    ...actual,
    SpecialistLoader: class {
      async get(name: string) {
        const spec = specs[name];
        if (!spec) throw new Error(`Specialist not found: ${name}`);
        return spec;
      }
      async getEffective(name: string) {
        return specs[name] ?? null;
      }
    },
  };
});

const originalArgv = [...process.argv];
let stdout: string[] = [];

function argv(...args: string[]): void {
  process.argv = ['node', 'specialists', ...args];
}

function captureStdout(): void {
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number | string) => {
    throw new Error(`exit:${code}`);
  }) as never);
}

/**
 * Strict fake boundary: read-only methods serve the Substrate-only ref,
 * every mutating method throws, so a render that claimed or mutated the
 * Issue would fail the test instead of silently passing.
 */
function fakeBoundary(
  viewFn: (ref: string) => WorkItemView,
  resolvedContext?: () => ReturnType<NonNullable<SpecialistWorkItemBoundary['resolvedContext']>>,
) {
  const view = vi.fn(viewFn);
  const completedBlockers = vi.fn((): never[] => []);
  const mustNotMutate = (name: string) => () => {
    throw new Error(`read-only render must not call ${name}`);
  };
  const boundary: SpecialistWorkItemBoundary = {
    view: (ref: string) => view(ref),
    epicAncestors: () => [],
    completedBlockers: (ref: string, depth: number) => completedBlockers(ref, depth),
    // Absent unless a case supplies it: a boundary without the reader renders no section,
    // which is what keeps a prompt for a ref without contextRefs byte-identical.
    ...(resolvedContext ? { resolvedContext } : {}),
    check: mustNotMutate('check'),
    bind: mustNotMutate('bind'),
    inlineCreate: mustNotMutate('inlineCreate'),
    journal: mustNotMutate('journal'),
  };
  return { boundary, view, completedBlockers };
}

function substrateView(ref: string): WorkItemView {
  if (ref !== SUBSTRATE_REF) throw new Error(`not found: ${ref}`);
  return {
    ref: SUBSTRATE_REF,
    issueId: 'iss_sub1',
    revision: 1,
    contractHash: 'hash-test',
    lifecycleState: 'open',
    title: 'Substrate task',
    contract: SUBSTRATE_CONTRACT,
    readinessState: 'ready',
    dispatchable: true,
    reasons: [],
  };
}

async function makeProbeSpecialist(): Promise<Specialist> {
  const { SpecialistSchema } = await import('../../../src/specialist/schema.js');
  return SpecialistSchema.parse({
    specialist: {
      metadata: { name: 'probe', version: '1.0.0', description: 'Render probe.', category: 'internal' },
      execution: { model: 'test-model', bare: true },
      prompt: { task_template: '$prompt' },
    },
  });
}

beforeEach(async () => {
  readBead = () => null;
  specs = { probe: await makeProbeSpecialist() };
  captureStdout();
});

afterEach(() => {
  process.argv = [...originalArgv];
  __setWorkItemsForTests(undefined);
  vi.restoreAllMocks();
});

describe('sp render-task --issue-ref resolves Substrate-only Issues', () => {
  it('renders the pinned contract for a ref that exists only in Substrate', async () => {
    readBead = () => null;
    const { boundary, view } = fakeBoundary(substrateView);
    __setWorkItemsForTests(boundary);

    argv('render-task', 'probe', '--issue-ref', SUBSTRATE_REF);
    const { run } = await import('../../../src/cli/render-task.js');
    await run();

    const out = JSON.parse(stdout.join(''));
    expect(out.ok).toBe(true);
    expect(out.specialist).toBe('probe');
    expect(out.bead_id).toBe(SUBSTRATE_REF);
    expect(out.initial_prompt).toContain('## Bead id: SUB-1');
    expect(out.initial_prompt).toContain('Substrate task');
    expect(out.initial_prompt).toContain('The board owns this work.');
    expect(out.initial_prompt).toContain('The render shows the pinned contract.');
    // Read-only: resolved through view, never claimed or mutated.
    expect(view).toHaveBeenCalledWith(SUBSTRATE_REF);
  });

  it('still renders a ref that exists only in the legacy Beads store', async () => {
    readBead = (id) => (id === LEGACY_BEAD.id ? LEGACY_BEAD : null);
    const { boundary } = fakeBoundary((ref) => { throw new Error(`not found: ${ref}`); });
    __setWorkItemsForTests(boundary);

    argv('render-task', 'probe', '--bead', LEGACY_BEAD.id);
    const { run } = await import('../../../src/cli/render-task.js');
    await run();

    const out = JSON.parse(stdout.join(''));
    expect(out.ok).toBe(true);
    expect(out.bead_id).toBe(LEGACY_BEAD.id);
    expect(out.initial_prompt).toContain('Legacy bead');
    expect(out.initial_prompt).toContain('PROBLEM: legacy only.');
  });

  it('fails truthfully for a ref in neither store', async () => {
    readBead = () => null;
    const { boundary } = fakeBoundary((ref) => { throw new Error(`not found: ${ref}`); });
    __setWorkItemsForTests(boundary);

    argv('render-task', 'probe', '--issue-ref', 'NOPE-1');
    const { run } = await import('../../../src/cli/render-task.js');
    await expect(run()).rejects.toThrow('exit:1');

    const out = JSON.parse(stdout.join(''));
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('bead_not_found');
    expect(out.error.message).toContain('NOPE-1');
  });
});

describe('sp render-bead --issue-ref shares the one resolution path', () => {
  it('renders a Substrate-only Issue with no specialist', async () => {
    readBead = () => null;
    const { boundary } = fakeBoundary(substrateView);
    __setWorkItemsForTests(boundary);

    argv('render-bead', '--issue-ref', SUBSTRATE_REF);
    const { run } = await import('../../../src/cli/render-bead.js');
    await run();

    const out = JSON.parse(stdout.join(''));
    expect(out.ok).toBe(true);
    expect(out.specialist).toBeNull();
    expect(out.bead_id).toBe(SUBSTRATE_REF);
    expect(out.initial_prompt).toContain('The board owns this work.');
  });
});

describe('sp render-task renders the Issue context native dispatch renders', () => {
  const CONTEXT = {
    hash: 'ctx-hash',
    entries: [
      { key: 'explorer-allowlist', value: 'src/a.ts\nsrc/b.ts', sourceRef: 'SUB-1', sourceRevision: 2, inherited: false },
      { key: 'venv', value: '/abs/.venv/bin/python', sourceRef: 'EPIC-1', sourceRevision: 3, inherited: true },
    ],
  };

  it('shows own and inherited contextRefs between the contract and the boundary rules', async () => {
    readBead = () => null;
    const { boundary } = fakeBoundary(substrateView, () => CONTEXT);
    __setWorkItemsForTests(boundary);

    argv('render-task', 'probe', '--issue-ref', SUBSTRATE_REF);
    const { run } = await import('../../../src/cli/render-task.js');
    await run();

    const out = JSON.parse(stdout.join(''));
    expect(out.ok).toBe(true);
    expect(out.initial_prompt).toContain('## Context references');
    expect(out.initial_prompt).toContain('### "explorer-allowlist" (from SUB-1 rev 2)');
    expect(out.initial_prompt).toContain('### "venv" (from EPIC-1 rev 3, inherited)');
    const section = out.initial_prompt.indexOf('## Context references');
    expect(section).toBeGreaterThan(out.initial_prompt.indexOf('The board owns this work.'));
    expect(section).toBeLessThan(out.initial_prompt.indexOf('## Runtime Boundary Rules'));
    // Measured where the prompt carries it, so the envelope's component list stays truthful.
    expect(out.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'bead_context', name: 'context_refs' }),
    ]));
  });

  it('renders no section when the Issue carries no contextRefs', async () => {
    readBead = () => null;
    const { boundary } = fakeBoundary(substrateView, () => ({ hash: 'ctx-hash', entries: [] }));
    __setWorkItemsForTests(boundary);

    argv('render-task', 'probe', '--issue-ref', SUBSTRATE_REF);
    const { run } = await import('../../../src/cli/render-task.js');
    await run();

    const out = JSON.parse(stdout.join(''));
    expect(out.initial_prompt).not.toContain('## Context references');
  });

  it('fails with the dispatch reason when Substrate refuses the Issue context', async () => {
    readBead = () => null;
    const { boundary } = fakeBoundary(substrateView, () => {
      throw new Error('fail-closed: context key "x" claims journal authority (§43)');
    });
    __setWorkItemsForTests(boundary);

    argv('render-task', 'probe', '--issue-ref', SUBSTRATE_REF);
    const { run } = await import('../../../src/cli/render-task.js');
    await expect(run()).rejects.toThrow('exit:1');

    const out = JSON.parse(stdout.join(''));
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('context_unresolvable');
    expect(out.error.message).toContain('journal authority');
  });
});
