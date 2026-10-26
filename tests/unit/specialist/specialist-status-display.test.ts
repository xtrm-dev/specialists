import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Contract and fingerprint tests for the `display` block (SPECIALISTS-4365).
 *
 * - the runtime ALWAYS emits `display` (compact and full, host or no host)
 *   with the canonical spend rule;
 * - raw fields are unchanged (no display keys leak into rows or views);
 * - a change in volatile display values alone (spend/idle/elapsed) never wakes
 *   `wait_for_change` — the fingerprint still reads only the actionable set.
 */

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => {
      throw new Error(`MCP dispatch must not spawn a subprocess; got spawn(${String(args[0])})`);
    },
  };
});

import { toActivationCompactView } from '../../../src/tools/specialist/activation.tool.js';
import { createSpecialistStatusTool } from '../../../src/tools/specialist/specialist_status.tool.js';
import { createSpecialistDispatchTool } from '../../../src/tools/specialist/activation.tool.js';
import { NativeActivationHost } from '../../../src/activation/native-host.js';
import { workspaceIdentityFor } from '../../../src/activation/workspace-lease.js';
import { REQUIRED_SECTIONS } from '../../../src/activation/contract-sections.js';
import { CircuitBreaker } from '../../../src/utils/circuitBreaker.js';
import type { PiSdk, PiAgentSessionLike, PiAgentSessionEvent } from '../../../src/activation/pi-sdk.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';
import { testWorkItems } from '../../utils/test-work-items.js';

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

function fakeSession(holdOpen = false): PiAgentSessionLike {
  const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
  const messages: unknown[] = [];
  const session = {
    sessionId: 'pi-sess-display',
    messages,
    isIdle: true,
    disposed: false,
    activeTools: ['read', 'grep'],
    async prompt() {
      listeners.forEach(l => l({ type: 'agent_start' }));
      if (holdOpen) return new Promise<never>(() => {});
      messages.push({ role: 'assistant', content: 'done' });
      listeners.forEach(l => l({ type: 'agent_end', willRetry: false }));
      listeners.forEach(l => l({ type: 'agent_settled' }));
    },
    async steer() {},
    async followUp() {}, async abort() {},
    dispose() { session.disposed = true; },
    emit(event: PiAgentSessionEvent) { listeners.forEach(l => l(event)); },
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

function tempWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'status-display-'));
  workspaces.push(root);
  return { repositoryRoot: root, worktreePath: root };
}

function hostWith(holdOpen = true) {
  const workspace = tempWorkspace();
  const session = fakeSession(holdOpen);
  const sdk: PiSdk = {
    createAgentSession: async (options?: Record<string, unknown>) => {
      if (Array.isArray(options?.tools)) session.setActiveToolsByName(options.tools as string[]);
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
    provisionWriterWorkspace: workspaceIdentityFor,
    loader: { get: async () => ({
      specialist: {
        metadata: { name: 'researcher', version: '1.0.0', description: 'd', category: 'c' },
        execution: { model: 'testprov/test-model', permission_required: 'READ_ONLY', response_format: 'text', output_type: 'research', bare: false },
        prompt: { system: 'You are the researcher.', task_template: 'Do: $bead_id' },
      },
    }) } as never,
    workItems: testWorkItems({ description: contract().description, title: contract().title }),
    loadSdk: async () => sdk,
    forensics: { emit: () => {} },
    cwd: workspace.worktreePath,
  });
  return { host, session };
}

describe('specialist_status display contract (SPECIALISTS-4365)', () => {
  it('compact and full always emit a display block, even with no host', async () => {
    const status = createSpecialistStatusTool({ list: async () => [] } as never, new CircuitBreaker());
    for (const input of [{}, { full: true }]) {
      const out = await status.execute(input) as Record<string, unknown>;
      expect(out.display, `display for ${JSON.stringify(input)}`).toBeDefined();
      const display = out.display as { header: string; activations: unknown[] };
      expect(display.header).toBe('idle');
      expect(display.activations).toEqual([]);
    }
  });

  it('compact and full emit display for a live fleet', async () => {
    const { host } = hostWith();
    const dispatch = createSpecialistDispatchTool(() => host);
    await dispatch.execute({ specialist: 'researcher', bead_id: 'ISSUE-1' });
    const status = createSpecialistStatusTool({ list: async () => [] } as never, new CircuitBreaker(), () => host);

    const compact = await status.execute({}) as Record<string, unknown>;
    const full = await status.execute({ full: true }) as Record<string, unknown>;
    for (const out of [compact, full]) {
      const display = out.display as { header: string; activations: Array<Record<string, unknown>> };
      expect(display.header).toBe('1 running');
      expect(display.activations).toHaveLength(1);
      expect(display.activations[0]).toEqual({
        activation_id: expect.stringMatching(/^act:/),
        marker: expect.any(String),
        metrics: expect.any(String),
        work: 'ISSUE-1',
      });
    }
  });

  it('applies the canonical spend rule: reasoning/tool/total never count', async () => {
    const { host } = hostWith();
    const dispatch = createSpecialistDispatchTool(() => host);
    await dispatch.execute({ specialist: 'researcher', bead_id: 'ISSUE-1' });
    // A spend report heavy with display-only splits: only input + output count.
    host.inspect(host.list()[0]!.activationId);
    const snap = host.list()[0]!;
    (snap as { tokenUsage?: unknown }).tokenUsage = {
      input_tokens: 9000,
      output_tokens: 3000,
      reasoning_tokens: 50_000,
      tool_tokens: 70_000,
      total_tokens: 200_000,
      usage_source: 'provider_usage',
    };
    const status = createSpecialistStatusTool({ list: async () => [] } as never, new CircuitBreaker(), () => host);
    const out = await status.execute({}) as Record<string, unknown>;
    const display = out.display as { activations: Array<{ metrics: string }> };
    // 9000 + 3000 = 12k. The mod's old rule would have read 132k.
    expect(display.activations[0]!.metrics).toContain('12k');
    expect(display.activations[0]!.metrics).not.toContain('132k');
  });

  it('raw fields are unchanged: no display keys leak into views or rows', async () => {
    const { host } = hostWith();
    const dispatch = createSpecialistDispatchTool(() => host);
    await dispatch.execute({ specialist: 'researcher', bead_id: 'ISSUE-1' });
    const status = createSpecialistStatusTool({ list: async () => [] } as never, new CircuitBreaker(), () => host);
    const compact = await status.execute({}) as Record<string, unknown>;
    const full = await status.execute({ full: true }) as Record<string, unknown>;
    const compactRows = compact.activations as Record<string, unknown>[];
    const fullRows = (full.activations as Record<string, unknown>[]);
    for (const row of [...compactRows, ...fullRows]) {
      expect(row).not.toHaveProperty('display');
      expect(row).not.toHaveProperty('marker');
      expect(row).not.toHaveProperty('metrics');
      expect(row).not.toHaveProperty('header');
    }
    // The compact row is exactly the shared projection plus result_status.
    const expected = toActivationCompactView(host.list()[0]!);
    expect(compactRows[0]).toMatchObject(expected);
    expect(Object.keys(compact)).toEqual(expect.arrayContaining(['activations', 'pending_asks', 'display']));
  });

  it('a change in volatile display values alone does not wake wait_for_change', async () => {
    const { host, session } = hostWith(true);
    const dispatch = createSpecialistDispatchTool(() => host);
    const status = createSpecialistStatusTool(
      { list: async () => [] } as never,
      new CircuitBreaker(),
      () => host,
    );
    await dispatch.execute({ specialist: 'researcher', bead_id: 'ISSUE-1' });

    const before = (await status.execute({})) as Record<string, unknown>;
    const beforeMetrics = (before.display as { activations: Array<{ metrics: string }> }).activations[0]!.metrics;

    // Park a wait, then change ONLY what the display derives from: a spend
    // report lands (token_usage moves, so display.metrics moves) while state,
    // result status and asks — the fingerprint — stay put.
    const t0 = Date.now();
    const waiting = status.execute({ wait_for_change: true, timeout_s: 1 });
    await new Promise(resolve => setTimeout(resolve, 150)); // let the call park
    session.emit({
      type: 'message_end',
      message: { role: 'assistant', usage: { input_tokens: 4000, output_tokens: 2000 } },
    } as unknown as PiAgentSessionEvent);

    const out = await waiting as Record<string, unknown>;
    const took = Date.now() - t0;
    expect(took, 'volatile display values must not wake the wait').toBeGreaterThanOrEqual(900);
    expect(took).toBeLessThan(5000);

    const afterMetrics = ((out.display as { activations: Array<{ metrics: string }> }).activations[0]!).metrics;
    expect(afterMetrics, 'the test really did move the display').not.toBe(beforeMetrics);
    expect(afterMetrics).toContain('6.0k');
  });
});
