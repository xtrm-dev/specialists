import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Ad hoc dispatch with a parent (XT-108): `specialist_dispatch` accepts an optional
 * `parent_ref` (and `kind`) with an inline `contract`, and the host creates the issue
 * as a child of that parent in ONE atomic step.
 *
 * Two layers, matching the two adapter surfaces: the host is exercised through the
 * REAL `createWorkItemBoundary` over in-memory producer ports (so the parentId
 * passthrough, the lifecycle gate and the journal-evidence routing are the shipped
 * code, not a boundary double), and the MCP adapter is exercised for its refusal
 * shape and param plumbing. The Pi extension mirrors the MCP adapter; its own
 * forwarding is asserted in tests/unit/pi/native-specialists-extension.test.ts.
 */

import {
  createSpecialistDispatchTool,
} from '../../../src/tools/specialist/activation.tool.js';
import { NativeActivationHost } from '../../../src/activation/native-host.js';
import {
  createWorkItemBoundary,
  defaultKindForOutputType,
  INLINE_PARENT_TERMINAL_STATES,
  type SpecialistWorkItemBoundary,
} from '../../../src/activation/workitem-store.js';
import { defaultInlineTitle } from '../../../src/activation/native-host.js';
import type { PiSdk, PiAgentSessionLike, PiAgentSessionEvent } from '../../../src/activation/pi-sdk.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';

const INLINE_CONTRACT =
  'PROBLEM\nProve the parented inline-dispatch path.\n\nSUCCESS\nA read-only activation settles.\n\n' +
  'SCOPE\nRead-only.\n\nNON_GOALS\nNo writes.\n\nCONSTRAINTS\nRead-only.\n\n' +
  'VALIDATION\nOutput confirms.\n\nOUTPUT\nA short report.\n\nSCRUTINY LOW';

interface IssueRec {
  id: string;
  humanRef: string;
  title: string;
  lifecycleState: string;
}

function makePorts() {
  const records = new Map<string, IssueRec>();
  const parents = new Map<string, string>();
  let childSeq = 0;
  const createdInputs: Array<Record<string, unknown>> = [];
  const notes: Array<{ issueId: string; input: Record<string, unknown> }> = [];
  const storeNotes: Array<{ ref: string; kind: string }> = [];

  const resolve = (ref: string): IssueRec => {
    if (records.has(ref)) return records.get(ref) as IssueRec;
    for (const rec of records.values()) {
      if (rec.humanRef === ref) return rec;
    }
    throw new Error(`unknown issue: ${ref}`);
  };

  const issues = {
    resolveRef: (ref: string) => ({ id: resolve(ref).id, humanRef: resolve(ref).humanRef }),
    getActiveClaim: () => null,
    getParent: (childId: string) => {
      const parentId = parents.get(childId);
      if (!parentId) return null;
      const parent = records.get(parentId) as IssueRec;
      return { id: parent.id, humanRef: parent.humanRef, title: parent.title, currentRevision: 1 };
    },
    getRevision: () => ({ contract: {} }),
    resolveProject: () => ({ projectId: 'proj-test' }),
    createIssue: (input: Record<string, unknown>) => {
      // Mirrors the producer: existence is checked, then the link is written.
      if (input.parentId !== undefined && !records.has(input.parentId as string)) {
        throw new Error(`unknown issue: ${input.parentId}`);
      }
      childSeq += 1;
      const id = `iss_child${childSeq}`;
      records.set(id, {
        id,
        humanRef: `TST-${childSeq}`,
        title: String(input.title),
        lifecycleState: 'open',
      });
      createdInputs.push(input);
      if (input.parentId !== undefined) parents.set(id, input.parentId as string);
      return { id };
    },
    claimReady: () => ({ claim: { id: 1 } }),
  };
  const store = {
    get: (ref: string) => {
      const rec = resolve(ref);
      return {
        issue: {
          humanRef: rec.humanRef,
          id: rec.id,
          currentRevision: 1,
          currentContractHash: 'hash-test',
          title: rec.title,
          lifecycleState: rec.lifecycleState,
        },
        contract: {},
        readinessState: 'claimed',
        dispatchable: true,
        reasons: [] as string[],
      };
    },
    addJournal: (ref: string, kind: string) => {
      storeNotes.push({ ref, kind });
    },
  };
  const gate = {
    check: (_i: unknown, req: { ref: string }) => ({
      issueId: resolve(req.ref).id, revision: 1, contractHash: 'hash-test', report: {},
    }),
    dispatch: (_i: unknown, _p: unknown, req: Record<string, unknown>) => ({
      binding: {
        id: 'exb_test', issueId: 'iss_test', issueRevision: 1, contractHash: 'hash-test',
        claimId: req.claimId ?? 1,
      },
    }),
  };
  const journalService = {
    appendEntry: (issueId: string, input: Record<string, unknown>) => {
      notes.push({ issueId, input });
      return { id: 'jrn_1', sequence: 1 };
    },
  };

  // The theme parent every dispatch parents under unless a test re-seeds it.
  const seedParent = (lifecycleState = 'open'): IssueRec => {
    const rec = { id: 'iss_theme1', humanRef: 'THEME-1', title: 'Theme', lifecycleState };
    records.set(rec.id, rec);
    return rec;
  };
  seedParent();

  const boundary = createWorkItemBoundary({
    issues: issues as never,
    provenance: {},
    store: store as never,
    gate: gate as never,
    journalService: journalService as never,
  });

  return { boundary, issues, parents, createdInputs, notes, storeNotes, seedParent, records };
}

function fakeSession(): PiAgentSessionLike {
  const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
  const session = {
    sessionId: 'pi-sess-parent',
    messages: [],
    isIdle: true,
    disposed: false,
    activeTools: ['read', 'grep'],
    async prompt() {
      listeners.forEach(l => l({ type: 'agent_start' }));
      listeners.forEach(l => l({ type: 'agent_end', willRetry: false }));
      listeners.forEach(l => l({ type: 'agent_settled' }));
    },
    async steer() {}, async followUp() {}, async abort() {},
    dispose() { session.disposed = false; },
    subscribe(l: (e: PiAgentSessionEvent) => void) {
      listeners.push(l);
      return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
    },
    getActiveToolNames: () => session.activeTools,
    setActiveToolsByName(names: string[]) { session.activeTools = names; },
    async waitForIdle() {},
  };
  return session as unknown as PiAgentSessionLike;
}

function specFor(name: string, outputType: string): Record<string, unknown> {
  return {
    specialist: {
      metadata: { name, version: '1.0.0', description: 'd', category: 'c' },
      execution: {
        model: 'testprov/test-model',
        permission_required: 'READ_ONLY',
        response_format: 'text',
        output_type: outputType,
        bare: false,
      },
      prompt: { system: `You are the ${name}.`, task_template: 'Do: {{bead_id}}' },
    },
  };
}

const workspaces: string[] = [];
// A READ_ONLY host dispatch merges the guard tier into process.env (sticky by design
// for the long-lived server). Vitest reuses worker processes across files with a shared
// env, so a dispatch-heavy file would otherwise leak PI_SPECIALIST_PERMISSION_TIER into
// whatever file runs next in the same worker. Restored here, never in production code.
const TIER_ENV_KEY = 'PI_SPECIALIST_PERMISSION_TIER';
let savedTierEnv: string | undefined;
beforeEach(() => {
  savedTierEnv = process.env[TIER_ENV_KEY];
});
afterEach(() => {
  while (workspaces.length > 0) {
    rmSync(workspaces.pop() as string, { recursive: true, force: true });
  }
  if (savedTierEnv === undefined) delete process.env[TIER_ENV_KEY];
  else process.env[TIER_ENV_KEY] = savedTierEnv;
});

function hostWith(boundary: SpecialistWorkItemBoundary, specialist: string, outputType: string) {
  const root = mkdtempSync(join(tmpdir(), 'parent-inline-ws-'));
  workspaces.push(root);
  const session = fakeSession();
  const sdk: PiSdk = {
    createAgentSession: async (options?: Record<string, unknown>) => {
      if (Array.isArray(options?.tools)) session.getActiveToolNames = () => options!.tools as string[];
      return { session };
    },
    DefaultResourceLoader: FakeResourceLoader,
    getAgentDir: () => FAKE_AGENT_DIR,
    ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
    resolveModelScopeWithDiagnostics: () => ({
      scopedModels: [{ model: { id: 'test-model', provider: 'testprov' } }],
      diagnostics: [],
    }),
    defineTool: (d) => d,
    createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
    createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
    createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
    createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
  } as unknown as PiSdk;
  const host = new NativeActivationHost({
    workItems: boundary,
    loader: { get: async () => specFor(specialist, outputType) } as never,
    loadSdk: async () => sdk,
    forensics: { emit: () => {} },
    cwd: root,
  });
  return { host };
}

describe('defaultKindForOutputType + defaultInlineTitle (pure derivation)', () => {
  it('maps investigatory output to research and everything else to task', () => {
    expect(defaultKindForOutputType('research')).toBe('research');
    expect(defaultKindForOutputType('analysis')).toBe('research');
    for (const other of ['codegen', 'review', 'synthesis', 'orchestration', 'workflow', 'custom', undefined]) {
      expect(defaultKindForOutputType(other)).toBe('task');
    }
  });

  it('excludes epic structurally and never emits it', () => {
    expect(defaultKindForOutputType('epic' as string)).toBe('task');
  });

  it('names the specialist and the first PROBLEM line, trimmed', () => {
    expect(defaultInlineTitle('explorer', INLINE_CONTRACT)).toBe('explorer: Prove the parented inline-dispatch path.');
    const padded =
      'PROBLEM\n\n   Spaced first line.   \nsecond line.\n\nSUCCESS\ns\n\nSCOPE\ns\n\nNON_GOALS\nn\n\n' +
      'CONSTRAINTS\nc\n\nVALIDATION\nv\n\nOUTPUT\no\n\nSCRUTINY LOW';
    expect(defaultInlineTitle('researcher', padded)).toBe('researcher: Spaced first line.');
  });
});

describe('host: parent_ref creates a child of the parent (XT-108)', () => {
  it('a dispatch with parent_ref creates a child with getParent(createdRef) == parent', async () => {
    const ports = makePorts();
    const { host } = hostWith(ports.boundary, 'researcher', 'research');

    const handle = await host.start({
      specialist: 'researcher',
      contract: INLINE_CONTRACT,
      parentRef: 'THEME-1',
      requestedByParticipantId: 'adapter::test',
      surface: 'test-surface',
    });

    expect(ports.createdInputs).toHaveLength(1);
    expect(ports.createdInputs[0]).toMatchObject({ parentId: 'iss_theme1', kind: 'research' });
    const childId = ports.boundary.view(handle.issueRef).issueId;
    expect(ports.issues.getParent(childId)).toMatchObject({ id: 'iss_theme1', humanRef: 'THEME-1' });
  });

  it('an unknown parent is refused BEFORE any issue is created (board unchanged)', async () => {
    const ports = makePorts();
    const { host } = hostWith(ports.boundary, 'researcher', 'research');

    const refusal = await host.start({
      specialist: 'researcher',
      contract: INLINE_CONTRACT,
      parentRef: 'NOPE-9',
      requestedByParticipantId: 'adapter::test',
    }).catch((caught: unknown) => caught);

    expect((refusal as Error).name).toBe('DispatchRejectedError');
    expect((refusal as { reason: string }).reason).toBe('parent_unresolvable');
    expect(ports.createdInputs).toHaveLength(0);
  });

  it.each(['done', 'cancelled', 'archived'])('a %s parent is refused BEFORE any issue is created', async (state) => {
    const ports = makePorts();
    ports.seedParent(state);
    const { host } = hostWith(ports.boundary, 'researcher', 'research');

    const refusal = await host.start({
      specialist: 'researcher',
      contract: INLINE_CONTRACT,
      parentRef: 'THEME-1',
      requestedByParticipantId: 'adapter::test',
    }).catch((caught: unknown) => caught);

    expect((refusal as { reason: string }).reason).toBe('parent_terminal');
    expect(String((refusal as Error).message)).toContain(state);
    expect(ports.createdInputs).toHaveLength(0);
  });

  it('a deferred parent is accepted (deferred is not terminal)', async () => {
    const ports = makePorts();
    ports.seedParent('deferred');
    const { host } = hostWith(ports.boundary, 'researcher', 'research');

    const handle = await host.start({
      specialist: 'researcher',
      contract: INLINE_CONTRACT,
      parentRef: 'THEME-1',
      requestedByParticipantId: 'adapter::test',
    });

    expect(handle.issueRef).toBeDefined();
    expect(ports.createdInputs).toHaveLength(1);
    expect(ports.issues.getParent(ports.boundary.view(handle.issueRef).issueId)).toMatchObject({ id: 'iss_theme1' });
  });

  it('parent_ref with issue_ref is refused as conflicting', async () => {
    const ports = makePorts();
    const { host } = hostWith(ports.boundary, 'researcher', 'research');

    const refusal = await host.start({
      specialist: 'researcher',
      issueRef: 'THEME-1',
      parentRef: 'THEME-1',
      requestedByParticipantId: 'adapter::test',
    }).catch((caught: unknown) => caught);

    expect((refusal as { reason: string }).reason).toBe('parent_ref_and_ref');
    expect(ports.createdInputs).toHaveLength(0);
  });

  it('kind with issue_ref is refused as conflicting', async () => {
    const ports = makePorts();
    const { host } = hostWith(ports.boundary, 'researcher', 'research');

    const refusal = await host.start({
      specialist: 'researcher',
      issueRef: 'THEME-1',
      kind: 'bug',
      requestedByParticipantId: 'adapter::test',
    }).catch((caught: unknown) => caught);

    expect((refusal as { reason: string }).reason).toBe('kind_and_ref');
    expect(ports.createdInputs).toHaveLength(0);
  });

  it('kind=epic is refused authoritatively at the host', async () => {
    const ports = makePorts();
    const { host } = hostWith(ports.boundary, 'researcher', 'research');

    const refusal = await host.start({
      specialist: 'researcher',
      contract: INLINE_CONTRACT,
      kind: 'epic',
      requestedByParticipantId: 'adapter::test',
    }).catch((caught: unknown) => caught);

    expect((refusal as { reason: string }).reason).toBe('unknown_kind');
    expect(ports.createdInputs).toHaveLength(0);
  });
});

describe('host: kind default from output_type + explicit override (XT-108)', () => {
  it.each([
    ['researcher', 'research', 'research'],
    ['explorer', 'analysis', 'research'],
    ['executor', 'codegen', 'task'],
    ['reviewer', 'review', 'task'],
    ['planner', 'workflow', 'task'],
  ])('%s (%s output) defaults to kind %s', async (specialist, outputType, kind) => {
    const ports = makePorts();
    const { host } = hostWith(ports.boundary, specialist, outputType);

    await host.start({
      specialist,
      contract: INLINE_CONTRACT,
      parentRef: 'THEME-1',
      requestedByParticipantId: 'adapter::test',
    });

    expect(ports.createdInputs[0]).toMatchObject({ kind });
  });

  it('an explicit kind wins over the output_type default', async () => {
    const ports = makePorts();
    const { host } = hostWith(ports.boundary, 'researcher', 'research');

    await host.start({
      specialist: 'researcher',
      contract: INLINE_CONTRACT,
      kind: 'bug',
      requestedByParticipantId: 'adapter::test',
    });

    expect(ports.createdInputs[0]).toMatchObject({ kind: 'bug' });
  });
});

describe('host: title default names the specialist + explicit title wins (XT-108)', () => {
  it('defaults the title to <specialist>: <first PROBLEM line>', async () => {
    const ports = makePorts();
    const { host } = hostWith(ports.boundary, 'explorer', 'analysis');

    await host.start({
      specialist: 'explorer',
      contract: INLINE_CONTRACT,
      requestedByParticipantId: 'adapter::test',
    });

    expect(ports.createdInputs[0]).toMatchObject({ title: 'explorer: Prove the parented inline-dispatch path.' });
  });

  it('an explicit title still wins', async () => {
    const ports = makePorts();
    const { host } = hostWith(ports.boundary, 'explorer', 'analysis');

    await host.start({
      specialist: 'explorer',
      contract: INLINE_CONTRACT,
      title: 'My explicit title',
      requestedByParticipantId: 'adapter::test',
    });

    expect(ports.createdInputs[0]).toMatchObject({ title: 'My explicit title' });
  });

  it('a blank explicit title falls back to the default', async () => {
    const ports = makePorts();
    const { host } = hostWith(ports.boundary, 'explorer', 'analysis');

    await host.start({
      specialist: 'explorer',
      contract: INLINE_CONTRACT,
      title: '   ',
      requestedByParticipantId: 'adapter::test',
    });

    expect(ports.createdInputs[0]).toMatchObject({ title: 'explorer: Prove the parented inline-dispatch path.' });
  });
});

describe('host: creation evidence journal note (XT-108)', () => {
  it('records surface, specialist, requested_by, parent_ref, kind and title-source at creation', async () => {
    const ports = makePorts();
    const { host } = hostWith(ports.boundary, 'researcher', 'research');

    const handle = await host.start({
      specialist: 'researcher',
      contract: INLINE_CONTRACT,
      parentRef: 'THEME-1',
      requestedByParticipantId: 'coordinator-1',
      surface: 'mcp',
    });

    expect(ports.notes).toHaveLength(1);
    expect(ports.notes[0].issueId).toBe(ports.boundary.view(handle.issueRef).issueId);
    expect(ports.notes[0].input).toMatchObject({ kind: 'note' });
    const summary = String((ports.notes[0].input as { semantic: { summary: string } }).semantic.summary);
    for (const token of [
      'surface=mcp', 'specialist=researcher', 'requested_by=coordinator-1',
      'parent_ref=THEME-1', 'issue_kind=research', 'title=default',
    ]) {
      expect(summary).toContain(token);
    }
  });

  it('records parent_ref=none, the explicit kind and title=explicit when defaulted otherwise', async () => {
    const ports = makePorts();
    const { host } = hostWith(ports.boundary, 'explorer', 'analysis');

    await host.start({
      specialist: 'explorer',
      contract: INLINE_CONTRACT,
      kind: 'decision',
      title: 'Chosen title',
      requestedByParticipantId: 'coordinator-2',
      surface: 'pi-extension',
    });

    expect(ports.notes).toHaveLength(1);
    const summary = String((ports.notes[0].input as { semantic: { summary: string } }).semantic.summary);
    for (const token of [
      'surface=pi-extension', 'specialist=explorer', 'requested_by=coordinator-2',
      'parent_ref=none', 'issue_kind=decision', 'title=explicit',
    ]) {
      expect(summary).toContain(token);
    }
  });

  it('a failing evidence write never fails the dispatch', async () => {
    const ports = makePorts();
    const failing = {
      ...ports.boundary,
      journal: () => { throw new Error('journal unavailable'); },
    };
    const { host } = hostWith(failing, 'researcher', 'research');

    const handle = await host.start({
      specialist: 'researcher',
      contract: INLINE_CONTRACT,
      requestedByParticipantId: 'adapter::test',
    });

    expect(handle.issueRef).toBeDefined();
    expect(ports.createdInputs).toHaveLength(1);
  });
});

describe('MCP adapter: parent_ref/kind plumbing carries the surface (XT-108)', () => {
  it('forwards parentRef, kind, epicContextDepth and surface=mcp to the host', async () => {
    const ports = makePorts();
    const { host } = hostWith(ports.boundary, 'researcher', 'research');
    const startSpy = vi.spyOn(host, 'start');
    const tool = createSpecialistDispatchTool(() => host);

    const out = await tool.execute({
      specialist: 'researcher',
      contract: INLINE_CONTRACT,
      parent_ref: 'THEME-1',
      kind: 'bug',
      epic_context_depth: 2,
    }) as Record<string, unknown>;

    expect(out.status).toBe('dispatched');
    expect(startSpy.mock.calls[0][0]).toMatchObject({
      contract: INLINE_CONTRACT,
      parentRef: 'THEME-1',
      kind: 'bug',
      epicContextDepth: 2,
      surface: 'mcp',
    });
  });

  it('terminal states the adapter cannot see are still the host refusal vocabulary', () => {
    // The terminal set is producer vocabulary mirrored for the host gate; the
    // adapter never re-derives it. Pin the mirror where the refusal is enforced.
    expect([...INLINE_PARENT_TERMINAL_STATES].sort()).toEqual(['archived', 'cancelled', 'done']);
  });
});
