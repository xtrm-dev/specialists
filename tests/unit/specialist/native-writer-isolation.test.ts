import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { NativeActivationHost } from '../../../src/activation/native-host.js';
import { createMemorySettlementStore } from '../../../src/activation/settlement-store.js';
import { DispatchRejectedError } from '../../../src/activation/types.js';
import { workspaceIdentityFor } from '../../../src/activation/workspace-lease.js';
import type { PiAgentSessionEvent, PiAgentSessionLike, PiSdk } from '../../../src/activation/pi-sdk.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';
import { testWorkItems } from '../../utils/test-work-items.js';

/**
 * SPECIALISTS-4310. A write-capable activation dispatched over MCP ran in the coordinator's
 * main checkout (the MCP server's cwd) and settled `completed` while its own `bg_run` suite
 * was still running. These drive the real host with a scripted session.
 */

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function gitRepo(): string {
  const repo = scratch('writer-isolation-repo-');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf-8' }).trim();
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return repo;
}

/** One turn that optionally reports a started background task, then settles. */
function scriptedSession(toolEnd?: PiAgentSessionEvent): PiAgentSessionLike & { cwd?: string } {
  const listeners: Array<(event: PiAgentSessionEvent) => void> = [];
  let activeTools: string[] = [];
  const messages: unknown[] = [];
  const emit = (event: PiAgentSessionEvent) => listeners.forEach((l) => l(event));
  return {
    sessionId: 'pi-sess-iso',
    messages,
    isIdle: true,
    async prompt() {
      emit({ type: 'agent_start' });
      if (toolEnd) emit(toolEnd);
      messages.push({ role: 'assistant', content: 'suite running in background', stopReason: 'stop' });
      emit({ type: 'agent_end', willRetry: false });
      emit({ type: 'agent_settled' });
    },
    async steer() {},
    async followUp() {},
    async abort() {},
    dispose() {},
    subscribe(l) {
      listeners.push(l);
      return () => listeners.splice(listeners.indexOf(l), 1);
    },
    getActiveToolNames: () => activeTools,
    setActiveToolsByName(names: string[]) { activeTools = names; },
    async waitForIdle() {},
  };
}

function sdkFor(session: PiAgentSessionLike & { cwd?: string }): PiSdk {
  return {
    createAgentSession: async (options?: Record<string, unknown>) => {
      if (Array.isArray(options?.tools)) session.setActiveToolsByName(options.tools as string[]);
      session.cwd = options?.cwd as string;
      return { session };
    },
    DefaultResourceLoader: FakeResourceLoader,
    getAgentDir: () => FAKE_AGENT_DIR,
    ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
    resolveModelScopeWithDiagnostics: () => ({ scopedModels: [{ model: { id: 'test-model', provider: 'testprov' } }], diagnostics: [] }),
    defineTool: (d: unknown) => d,
    createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
    createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
    createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
    createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
  } as unknown as PiSdk;
}

function spec(tier: string) {
  return {
    specialist: {
      metadata: { name: 'executor', version: '1.0.0', description: 'd', category: 'c' },
      execution: { model: 'testprov/test-model', permission_required: tier, response_format: 'text', output_type: 'codegen', bare: false },
      prompt: { system: 'You are the executor.', task_template: 'Do: {{bead_id}}' },
    },
  };
}

function host(cwd: string, session: PiAgentSessionLike, extra: Record<string, unknown> = {}) {
  return new NativeActivationHost({
    loader: { get: async () => spec('HIGH') } as never,
    workItems: testWorkItems({ ref: 'CORE-2412' }),
    loadSdk: async () => sdkFor(session),
    settlements: createMemorySettlementStore(),
    cwd,
    ...extra,
  });
}

const dispatch = { specialist: 'executor', issueRef: 'CORE-2412', requestedByParticipantId: 'coordinator' };

describe('write-capable native activation workspace (SPECIALISTS-4310)', () => {
  it('runs in its own per-Issue worktree and leaves the dispatcher checkout untouched', async () => {
    const repo = gitRepo();
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' }).trim();
    const session = scriptedSession();

    const handle = await host(repo, session).start(dispatch);
    await handle.result;

    const expected = join(repo, '.worktrees', 'core-2412');
    expect(handle.workspace.worktreePath).toBe(expected);
    expect(handle.workspace.branch).toBe('sp/core-2412');
    expect(session.cwd).toBe(expected);
    expect(git('status', '--porcelain')).toBe('');
    expect(git('branch', '--show-current')).toBe('main');

    // A later writer on the same Issue reuses the tree instead of creating a second one.
    const again = await host(repo, scriptedSession()).start(dispatch);
    await again.result;
    expect(again.workspace.worktreePath).toBe(expected);
  });

  it('removes the worktree and branch it created when the dispatch is then refused', async () => {
    const repo = gitRepo();
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' }).trim();
    const items = testWorkItems({ ref: 'CORE-2412' });
    const refusing = { ...items, check: () => { throw new Error('issue not dispatchable: draft'); } };

    const refusal = await host(repo, scriptedSession(), { workItems: refusing })
      .start(dispatch)
      .catch((caught: unknown) => caught);

    expect(refusal).toBeInstanceOf(DispatchRejectedError);
    expect(git('worktree', 'list', '--porcelain')).not.toContain('.worktrees/core-2412');
    expect(git('branch', '--list', 'sp/core-2412')).toBe('');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('refuses a writer with a structured reason when no worktree can be created', async () => {
    const refusal = await host(scratch('writer-isolation-nogit-'), scriptedSession())
      .start(dispatch)
      .catch((caught: unknown) => caught);
    expect(refusal).toBeInstanceOf(DispatchRejectedError);
    expect((refusal as DispatchRejectedError).reason).toBe('workspace_isolation_unavailable');
  });
});

describe('settlement with own background tasks (SPECIALISTS-4310)', () => {
  const bgRun: PiAgentSessionEvent = {
    type: 'tool_execution_end',
    toolName: 'bg_run',
    toolCallId: 'call-bg',
    isError: false,
    result: { content: [{ type: 'text', text: 'Started background task full CLI suite run (b0c0403f1)\nStatus: running\nPID: 3208325\nTerminal notification: enabled.' }] },
  };

  function bgHost(ws: string, alive: { value: boolean }, ref = 'CORE-2412') {
    return host(ws, scriptedSession(bgRun), {
      workItems: testWorkItems({ ref }),
      provisionWriterWorkspace: workspaceIdentityFor,
      backgroundTaskAlive: () => alive.value,
      backgroundPollMs: 5,
    });
  }

  async function settle(alive: boolean) {
    return (await bgHost(scratch('writer-isolation-bg-'), { value: alive }).start(dispatch)).result;
  }

  it('does not report completed while a background task it started is running', async () => {
    const settlements = createMemorySettlementStore();
    const handle = await host(scratch('writer-isolation-bg-'), scriptedSession(bgRun), {
      provisionWriterWorkspace: workspaceIdentityFor,
      backgroundTaskAlive: () => true,
      settlements,
    }).start(dispatch);
    const result = await handle.result;
    expect(result.status).toBe('uncertain');
    // The stored settlement says `uncertain`, not `failed`.
    expect(settlements.listAttempts(handle.activationId).map((r) => r.status)).toEqual(['uncertain']);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors?.[0]).toContain('full CLI suite run (b0c0403f1) (pid 3208325)');
  });

  it('keeps the writer lease while its background task runs and releases it when the task exits', async () => {
    const ws = scratch('writer-isolation-lease-');
    const alive = { value: true };
    const first = await bgHost(ws, alive).start(dispatch);
    expect((await first.result).status).toBe('uncertain');

    const next = { specialist: 'executor', issueRef: 'CORE-2413', requestedByParticipantId: 'coordinator' };
    const refusal = await host(ws, scriptedSession(), {
      workItems: testWorkItems({ ref: 'CORE-2413' }),
      provisionWriterWorkspace: workspaceIdentityFor,
    }).start(next).catch((caught: unknown) => caught);
    expect((refusal as DispatchRejectedError).reason).toBe('workspace_held_by_another_writer');

    alive.value = false;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const admitted = await host(ws, scriptedSession(), {
      workItems: testWorkItems({ ref: 'CORE-2413' }),
      provisionWriterWorkspace: workspaceIdentityFor,
    }).start(next);
    expect((await admitted.result).status).toBe('completed');
  });

  it('forgets the background tasks of a stopped activation', async () => {
    const h = bgHost(scratch('writer-isolation-stop-'), { value: true });
    const handle = await h.start(dispatch);
    await handle.result;
    const internals = h as unknown as { backgroundTasks: Map<string, unknown>; backgroundWatch: Map<string, unknown> };
    expect(internals.backgroundTasks.has(handle.activationId)).toBe(true);
    await h.stop(handle.activationId);
    expect(internals.backgroundTasks.has(handle.activationId)).toBe(false);
    expect(internals.backgroundWatch.has(handle.activationId)).toBe(false);
  });

  it('completes once that background task has exited', async () => {
    const result = await settle(false);
    expect(result.status).toBe('completed');
    expect(result.validation.valid).toBe(true);
  });
});
