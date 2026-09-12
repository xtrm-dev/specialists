import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * MCP dispatch mirror for contract/title/epic_context_depth (unitAI-t2kol.5).
 *
 * The inline path is tool + shared text gate + real host + injected work
 * boundary: creation is host-owned through `boundary.inlineCreate`
 * (validate → create → attest → claim), never a `bd` subprocess. "Refused
 * dispatch leaves the board unchanged" is asserted as "inlineCreate was never
 * called and no session was created". Everything else is real: the zod schema,
 * the execute mutual-exclusion checks, `validateContractText`, and
 * `NativeActivationHost.start` with only the Pi SDK and the work boundary
 * faked (boundary fake from tests/utils/test-work-items.ts).
 */

import {
  createSpecialistDispatchTool,
  specialistDispatchSchema,
} from '../../../src/tools/specialist/activation.tool.js';
import { NativeActivationHost } from '../../../src/activation/native-host.js';
import { REQUIRED_SECTIONS } from '../../../src/activation/bead-gate.js';
import { testWorkItems } from '../../utils/test-work-items.js';
import type { PiSdk, PiAgentSessionLike, PiAgentSessionEvent } from '../../../src/activation/pi-sdk.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';

const INLINE_CONTRACT =
  'PROBLEM\nProve the inline-dispatch path.\n\nSUCCESS\nA read-only activation settles.\n\n' +
  'SCOPE\nRead-only.\n\nNON_GOALS\nNo writes.\n\nCONSTRAINTS\nRead-only.\n\n' +
  'VALIDATION\nOutput confirms.\n\nOUTPUT\nA short report.\n\nSCRUTINY LOW';

function contract(extra = 'SCRUTINY\nLOW — routine.') {
  const bodies: Record<string, string> = {
    PROBLEM: 'The thing is unclear.',
    SUCCESS: 'The thing is clear.',
    SCOPE: 'Investigate the thing.',
    NON_GOALS: 'Does not fix the thing.',
    CONSTRAINTS: 'Read-only.',
    VALIDATION: 'A written finding.',
    OUTPUT: 'A finding.',
  };
  const lines: string[] = [];
  for (const section of REQUIRED_SECTIONS) lines.push(section, bodies[section] ?? '', '');
  lines.push(extra);
  return { id: 'ISSUE-1', title: 'A task', status: 'open', description: lines.join('\n') };
}

function fakeSession(): PiAgentSessionLike {
  const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
  const messages: unknown[] = [];
  const session = {
    sessionId: 'pi-sess-mcp-inline',
    messages,
    isIdle: true,
    disposed: false,
    activeTools: ['read', 'grep'],
    async prompt() {
      listeners.forEach(l => l({ type: 'agent_start' }));
      messages.push({ role: 'assistant', content: 'done' });
      listeners.forEach(l => l({ type: 'agent_end', willRetry: false }));
      listeners.forEach(l => l({ type: 'agent_settled' }));
    },
    async steer() {}, async followUp() {}, async abort() {},
    dispose() { session.disposed = true; },
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

const workspaces: string[] = [];
afterEach(() => {
  while (workspaces.length > 0) {
    rmSync(workspaces.pop() as string, { recursive: true, force: true });
  }
});

function hostWith(fixture: { permission?: string; inlineCreate?: (contract: string, opts?: { title?: string; holder?: string; activationId?: string }) => { ref: string; issueId: string; claimId: number | null } } = {}) {
  const sessionsCreated = { count: 0 };
  const root = mkdtempSync(join(tmpdir(), 'mcp-inline-ws-'));
  workspaces.push(root);
  const session = fakeSession();
  const sdk: PiSdk = {
    createAgentSession: async () => { sessionsCreated.count += 1; return { session }; },
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
  const workItems = testWorkItems({ ref: 'bd-inline-1' });
  if (fixture.inlineCreate) {
    vi.spyOn(workItems, 'inlineCreate').mockImplementation(fixture.inlineCreate);
  } else {
    vi.spyOn(workItems, 'inlineCreate');
  }
  const host = new NativeActivationHost({
    workItems,
    loader: { get: async () => ({
      specialist: {
        metadata: { name: 'researcher', version: '1.0.0', description: 'd', category: 'c' },
        execution: {
          model: 'testprov/test-model',
          permission_required: fixture.permission ?? 'READ_ONLY',
          response_format: 'text',
          output_type: 'research',
          bare: false,
        },
        prompt: { system: 'You are the researcher.', task_template: 'Do: {{bead_id}}' },
      },
    }) } as never,
    loadSdk: async () => sdk,
    forensics: { emit: () => {} },
    cwd: root,
  });
  return { host, sessionsCreated, workItems };
}

describe('specialist_dispatch schema — contract/title/epic_context_depth mirror Pi', () => {
  it('the work-item parameters are optional and the inline fields keep their descriptions', () => {
    const shape = specialistDispatchSchema.shape;
    expect(shape.issue_ref.isOptional()).toBe(true);
    expect(shape.bead_id.isOptional()).toBe(true);
    expect(shape.contract.isOptional()).toBe(true);
    expect(shape.title.isOptional()).toBe(true);
    expect(shape.epic_context_depth.isOptional()).toBe(true);
    expect(String(shape.contract.description)).toContain('SAME readiness gate');
    expect(String(shape.title.description)).toContain('derived from PROBLEM');
    expect(String(shape.epic_context_depth.description)).toContain('## Epic lineage');
    // issue_ref is primary and bead_id is its permanent alias (SPECIALISTS-20); both say
    // that exactly one of the three may be supplied.
    expect(String(shape.issue_ref.description)).toContain('Supply EXACTLY ONE of issue_ref, bead_id or contract');
    expect(String(shape.bead_id.description)).toContain('Supply EXACTLY ONE of issue_ref, bead_id or contract');
  });
});

describe('specialist_dispatch inline path — one gate, create only after it passes', () => {
  it('refuses bead_id plus contract instead of picking a precedence', async () => {
    const { host, sessionsCreated, workItems } = hostWith();
    const tool = createSpecialistDispatchTool(() => host);

    const out = await tool.execute({
      specialist: 'researcher', bead_id: 'ISSUE-1', contract: INLINE_CONTRACT,
    }) as Record<string, unknown>;

    expect(out.status).toBe('rejected');
    expect(String(out.reason)).toContain('both bead_id and contract were provided');
    expect(workItems.inlineCreate).not.toHaveBeenCalled();
    expect(sessionsCreated.count).toBe(0);
  });

  it('refuses neither bead_id nor contract', async () => {
    const { host, sessionsCreated, workItems } = hostWith();
    const tool = createSpecialistDispatchTool(() => host);

    const out = await tool.execute({ specialist: 'researcher' }) as Record<string, unknown>;

    expect(out.status).toBe('rejected');
    expect(String(out.reason)).toContain('neither issue_ref, bead_id nor contract');
    expect(workItems.inlineCreate).not.toHaveBeenCalled();
    expect(sessionsCreated.count).toBe(0);
  });

  it('refuses epic_context_depth outside 1|2 without dispatching', async () => {
    const { host, sessionsCreated, workItems } = hostWith();
    const tool = createSpecialistDispatchTool(() => host);

    for (const bad of [0, 3, -1, 1.5]) {
      const out = await tool.execute({
        specialist: 'researcher', bead_id: 'ISSUE-1', epic_context_depth: bad,
      }) as Record<string, unknown>;
      expect(out.status).toBe('rejected');
      expect(String(out.reason)).toContain('epic_context_depth must be 1 or 2');
    }
    expect(workItems.inlineCreate).not.toHaveBeenCalled();
    expect(sessionsCreated.count).toBe(0);
  });

  it('gate runs BEFORE creating the bead: a draft inline contract leaves the board unchanged', async () => {
    const { host, sessionsCreated, workItems } = hostWith();
    const tool = createSpecialistDispatchTool(() => host);

    const out = await tool.execute({
      specialist: 'researcher', contract: 'PROBLEM\nMissing everything else.',
    }) as Record<string, unknown>;

    expect(out.status).toBe('rejected');
    expect(out.missing).toContain('SUCCESS');
    expect(out.missing).not.toContain('PROBLEM');
    expect(workItems.inlineCreate).not.toHaveBeenCalled();
    expect(sessionsCreated.count).toBe(0);

    // All seven sections present but no SCRUTINY: refused with SCRUTINY missing.
    const noScrutiny = await tool.execute({
      specialist: 'researcher',
      contract: 'PROBLEM\np\n\nSUCCESS\ns\n\nSCOPE\nsc\n\nNON_GOALS\nng\n\nCONSTRAINTS\nc\n\nVALIDATION\nv\n\nOUTPUT\no',
    }) as Record<string, unknown>;
    expect(noScrutiny.status).toBe('rejected');
    expect(noScrutiny.missing).toEqual(['SCRUTINY']);
    expect(workItems.inlineCreate).not.toHaveBeenCalled();
  });

  it('valid inline contract creates the issue then dispatches against it', async () => {
    const { host, sessionsCreated, workItems } = hostWith();
    const tool = createSpecialistDispatchTool(() => host);

    const out = await tool.execute({
      specialist: 'researcher', contract: INLINE_CONTRACT,
    }) as Record<string, unknown>;

    // Host-owned creation through the boundary: validate → create → attest →
    // claim, claiming WITH the activation id the bind path pins.
    expect(workItems.inlineCreate).toHaveBeenCalledTimes(1);
    const [createdContract, createdOpts] = (workItems.inlineCreate as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(createdContract).toBe(INLINE_CONTRACT);
    expect(createdOpts).toMatchObject({ holder: 'specialist::researcher' });
    expect(typeof (createdOpts as { activationId?: unknown }).activationId).toBe('string');
    expect(out.status).toBe('dispatched');
    expect(out.bead_id).toBe('bd-inline-1');
    expect(out.issue_ref).toBe('bd-inline-1');
    expect(out.created_bead_id).toBe('bd-inline-1');
    expect(String(out.created_bead_note)).toMatch(/yours to track/i);
    expect(sessionsCreated.count).toBe(1);
    // The created issue reads back through the host Fleet.
    expect(host.list().map(s => s.issueRef)).toContain('bd-inline-1');
  });

  it('passes title through to issue creation', async () => {
    const { host, workItems } = hostWith();
    const tool = createSpecialistDispatchTool(() => host);

    const out = await tool.execute({
      specialist: 'researcher', contract: INLINE_CONTRACT, title: 'My inline title',
    }) as Record<string, unknown>;

    expect(out.status).toBe('dispatched');
    const [, createdOpts] = (workItems.inlineCreate as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(createdOpts).toMatchObject({ title: 'My inline title' });
  });

  it('drops epic_context_depth for auto-created parentless beads (Pi :932 rule)', async () => {
    const { host } = hostWith();
    const startSpy = vi.spyOn(host, 'start');
    const tool = createSpecialistDispatchTool(() => host);

    const out = await tool.execute({
      specialist: 'researcher', contract: INLINE_CONTRACT, epic_context_depth: 2,
    }) as Record<string, unknown>;

    expect(out.status).toBe('dispatched');
    expect(startSpy.mock.calls[0][0]).not.toHaveProperty('epicContextDepth');
  });

  it('passes epic_context_depth through on bead_id dispatch, omitted by default', async () => {
    const { host } = hostWith();
    const startSpy = vi.spyOn(host, 'start');
    const tool = createSpecialistDispatchTool(() => host);

    await tool.execute({ specialist: 'researcher', bead_id: 'ISSUE-1', epic_context_depth: 2 });
    expect(startSpy.mock.calls[0][0]).toMatchObject({ epicContextDepth: 2 });
    await tool.execute({ specialist: 'researcher', bead_id: 'ISSUE-1' });
    expect(startSpy.mock.calls[1][0]).not.toHaveProperty('epicContextDepth');
  });

  it('ignores title on the bead_id path, creating nothing', async () => {
    const { host, sessionsCreated, workItems } = hostWith();
    const startSpy = vi.spyOn(host, 'start');
    const tool = createSpecialistDispatchTool(() => host);

    const out = await tool.execute({
      specialist: 'researcher', bead_id: 'ISSUE-1', title: 'Ignored title',
    }) as Record<string, unknown>;

    expect(out.status).toBe('dispatched');
    expect(out.bead_id).toBe('ISSUE-1');
    expect(out).not.toHaveProperty('created_bead_id');
    expect(workItems.inlineCreate).not.toHaveBeenCalled();
    expect(startSpy.mock.calls[0][0]).toMatchObject({ issueRef: 'ISSUE-1' });
    expect(sessionsCreated.count).toBe(1);
  });

  it('surfaces issue-creation failure without creating a session', async () => {
    const { host, sessionsCreated } = hostWith({
      inlineCreate: () => { throw new Error('claim failed: store unavailable'); },
    });
    const tool = createSpecialistDispatchTool(() => host);

    await expect(tool.execute({
      specialist: 'researcher', contract: INLINE_CONTRACT,
    })).rejects.toThrow('claim failed');
    expect(sessionsCreated.count).toBe(0);
  });
});
