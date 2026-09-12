import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The native path must never reach for a subprocess. `spawn` is replaced with a throwing
 * stub rather than a spy: if the host ever regressed to the legacy `sp run` boundary the
 * test fails at the call site with a clear cause, instead of passing and reporting a count
 * afterwards. Everything else in node:child_process stays real — `execSync` is used by
 * tool-catalog resolution and the system-prompt defaults.
 */
/**
 * SPECIALISTS-6: the curated extension set must be resolvable without depending on what
 * the machine happens to have installed. The python-kernel resolver is the one curated
 * entry that is resolved rather than existsSync-checked, so it is the one stubbed.
 */
vi.mock('../../../src/pi/python-kernel-extension.js', () => ({
  resolvePiExtensionsPythonKernelPath: () => '/fake/pi-extensions/python-kernel',
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => {
      throw new Error(`native activation must not spawn a subprocess; got spawn(${String(args[0])})`);
    },
  };
});
import { NativeActivationHost, type ActivationForensicSink } from '../../../src/activation/native-host.js';
import { buildSystemPrompt } from '../../../src/specialist/system-prompt.js';
import { resolveOutputContractSchema } from '../../../src/specialist/runner.js';
import { DispatchRejectedError } from '../../../src/activation/types.js';
import type { PiSdk, PiAgentSessionLike, PiAgentSessionEvent } from '../../../src/activation/pi-sdk.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';
import type { SpecialistWorkItemBoundary, WorkItemView } from '../../../src/activation/workitem-store.js';

/**
 * Phase 1 acceptance. The load-bearing assertions here are:
 *   - a real Specialist definition drives the child (acceptance A);
 *   - a read-only child cannot receive mutation tools (acceptance G);
 *   - NO subprocess is spawned — this is the whole point of the native path;
 *   - the session is NOT disposed when it settles (acceptance H's precondition);
 *   - a write-capable Specialist is refused while no lease exists.
 */

interface FakeSessionOptions { record: { createArgs?: Record<string, unknown> } }

/**
 * `holdOpen` suspends the turn: `prompt()` never resolves, so the activation stays RUNNING.
 *
 * Needed since unitAI-rrdnt.59 released the writer lease on settle AND on completion. A
 * writer now holds its workspace for the duration of its turn and no longer, so contention
 * and per-call mutation admission only exist inside that window. Without this the fake
 * finishes the turn inside `start()` and there is nothing left to contend with — the tests
 * would have to be weakened to pass, which would delete what they check.
 */
function fakeSession(opts: FakeSessionOptions & { assistantText?: string; stopReason?: string; errorMessage?: string; holdOpen?: boolean }): PiAgentSessionLike & {
  disposed: boolean; prompts: string[]; emit: (e: PiAgentSessionEvent) => void;
} {
  const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
  const messages: unknown[] = [];
  const session = {
    sessionId: 'pi-sess-123',
    messages,
    isIdle: true,
    disposed: false,
    prompts: [] as string[],
    activeTools: ['read', 'grep'],
    async prompt(text: string) {
      session.prompts.push(text);
      listeners.forEach(l => l({ type: 'agent_start' }));
      if (opts.holdOpen) return new Promise<never>(() => {});
      messages.push({
        role: 'assistant',
        content: opts.assistantText ?? 'done',
        ...(opts.stopReason ? { stopReason: opts.stopReason } : {}),
        ...(opts.errorMessage ? { errorMessage: opts.errorMessage } : {}),
      });
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
    emit: (e: PiAgentSessionEvent) => listeners.forEach(l => l(e)),
  };
  return session as unknown as ReturnType<typeof fakeSession>;
}

function makeSdk(record: { createArgs?: Record<string, unknown> }, session: PiAgentSessionLike): PiSdk {
  return {
    createAgentSession: async (options?: Record<string, unknown>) => {
      record.createArgs = options;
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
    // The mutating builtins pi exports. The host RECONSTRUCTS these and wraps their
    // execute with the lease check (unitAI-rrdnt.36.2), and refuses a dispatch when it
    // cannot — so a double that omits them models a runtime where nothing is fenceable,
    // and every writer dispatch is correctly refused. Modelling the real surface is the
    // point: the refusal is the guard working, not a test artefact.
    createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
    createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
    createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
    createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
  } as unknown as PiSdk;
}

/**
 * A COMPLETE task contract. The Phase 3 bead gate refuses anything less, so this fixture
 * carries all seven sections plus SCRUTINY — it is a stub for the host's other assertions,
 * not the subject of them. Gate behaviour itself is tested in activation-bead-gate.test.ts.
 */
const BEAD = {
  id: 'ISSUE-1',
  title: 'Investigate the thing',
  status: 'open',
  description: [
    'PROBLEM', 'The thing is unclear.', '',
    'SUCCESS', 'The thing is clear.', '',
    'SCOPE', 'Investigate the thing.', '',
    'NON_GOALS', 'Does not fix the thing.', '',
    'CONSTRAINTS', 'Read-only.', '',
    'VALIDATION', 'A written finding.', '',
    'OUTPUT', 'A finding.', '',
    'SCRUTINY', 'LOW — investigation only.',
  ].join('\n'),
};

/** Keeps the gate off the real `bd` binary in unit tests. */
/**
 * A throwaway repository root per host.
 *
 * Since unitAI-rrdnt.36 a write-capable activation ACQUIRES a real lease under
 * `<workspace>/.specialists/leases/`. A host built on `process.cwd()` writes that lease
 * into THIS repository, and when the vitest worker exits its holder pid is gone and the
 * lease is left uncertain — which by design cannot be stolen, so the next writer in any
 * suite, or a real dispatch by a developer, is refused. It happened once and had to be
 * reconciled by hand. Same class as the observability.db incident: a test operating on live
 * developer state, invisible until something downstream refuses.
 */
const hostWorkspaces: string[] = [];
function hostWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'native-host-ws-'));
  hostWorkspaces.push(root);
  return root;
}
afterEach(() => {
  while (hostWorkspaces.length > 0) {
    rmSync(hostWorkspaces.pop() as string, { recursive: true, force: true });
  }
});

const NO_CONTRACT_STATE = { readContractState: () => undefined };

function fakeWorkItems(options: { state?: string } = {}): SpecialistWorkItemBoundary {
  const contract = {
    problem: 'The thing is unclear.',
    success: 'The thing is clear.',
    scope: ['Investigate the thing.'],
    nonGoals: ['Does not fix the thing.'],
    constraints: ['Read-only.'],
    validation: [{ check: 'A written finding.' }],
    output: [{ artifact: 'A finding.' }],
  };
  const state = options.state ?? 'claimed';
  return {
    view(ref: string): WorkItemView {
      return {
        ref,
        issueId: `iss_${ref}`,
        revision: 1,
        contractHash: 'hash-test',
        title: 'Investigate the thing',
        contract,
        readinessState: state,
        dispatchable: state === 'ready' || state === 'claimed',
        reasons: state === 'draft' ? ['contract is draft'] : [],
      };
    },
    epicAncestors: () => [],
    check() {
      if (state !== 'ready' && state !== 'claimed') throw new Error(`dispatch rejected: issue is ${state}`);
      return { issueId: 'iss_test', revision: 1, contractHash: 'hash-test', report: { state, revision: 1, contractHash: 'hash-test', reasons: [] } as never };
    },
    bind() {
      return {
        id: 'exb_test', issueId: 'iss_test', issueRevision: 1, contractHash: 'hash-test',
        resolvedContextHash: 'context-test', claimId: 1, participantId: 'coordinator',
        activationId: 'activation-test', attemptId: 'attempt-test', sessionId: 'pi-sess-123',
        workspace: '/tmp/test-workspace', baseCommit: null, createdAt: Date.now(),
      } as never;
    },
    inlineCreate: () => ({ ref: 'ISSUE-INLINE', issueId: 'iss_inline', claimId: 1 }),
    journal: () => {},
  };
}

function loaderFor(spec: Record<string, unknown>) {
  return { get: async () => spec } as never;
}

function readOnlySpec(executionExtra: Record<string, unknown> = {}) {
  return {
    specialist: {
      metadata: { name: 'researcher', version: '1.0.0', description: 'd', category: 'c' },
      execution: {
        model: 'testprov/test-model',
        permission_required: 'READ_ONLY',
        response_format: 'text',
        output_type: 'research',
        bare: false,
        ...executionExtra,
      },
      prompt: { system: 'You are the researcher.', task_template: 'Do: {{bead_id}}' },
    },
  };
}

function collectingSink(): ActivationForensicSink & { names: string[]; events: Array<Record<string, unknown>> } {
  const names: string[] = [];
  const events: Array<Record<string, unknown>> = [];
  return {
    names, events,
    emit(e) { names.push(e.name); events.push(e as unknown as Record<string, unknown>); },
  };
}

describe('NativeActivationHost — Phase 1 read-only', () => {
  it('runs a read-only Specialist in-process without spawning a subprocess', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record, assistantText: 'the answer' });
    const sink = collectingSink();

    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });
    const result = await handle.result;

    // Reaching here at all proves no subprocess was spawned — the mock throws.
    expect(result.status).toBe('completed');
    expect(result.output).toBe('the answer');
    expect(result.piSessionId).toBe('pi-sess-123');
    expect(handle.access).toBe('read');
  });

  it('grants the child only its resolved tool contract, with pi builtins suppressed', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });

    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });

    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;

    const args = record.createArgs!;
    // `noTools: "builtin"` rather than `tools: []` — the latter also empties customTools.
    expect(args.noTools).toBe('builtin');

    const tools = args.tools as string[];
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    // Acceptance G: a read-only child must not hold mutation tools.
    expect(tools).not.toContain('edit');
    expect(tools).not.toContain('write');
  });

  it('does not dispose the session when the agent settles', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });

    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    await handle.result;

    // A settled Specialist stays alive and resumable. Disposal is explicit only.
    expect((session as unknown as { disposed: boolean }).disposed).toBe(false);
    expect(host.inspect(handle.activationId)?.state).toBe('settled');

    await host.stop(handle.activationId);
    expect((session as unknown as { disposed: boolean }).disposed).toBe(true);
    expect(host.inspect(handle.activationId)).toBeUndefined();
  });

  it('emits admission and lifecycle forensics, including a settled event', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const sink = collectingSink();

    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });

    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;

    expect(sink.names).toEqual(expect.arrayContaining([
      'activation_requested', 'activation_admitted', 'activation_starting',
      'activation_started', 'turn_started', 'turn_completed',
      'activation_settled', 'activation_completed',
    ]));
  });

  it('admits a write-capable Specialist now that it takes the workspace lease', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record, holdOpen: true });
    const sink = collectingSink();
    const spec = readOnlySpec();
    (spec.specialist.execution as Record<string, unknown>).permission_required = 'HIGH';

    const host = new NativeActivationHost({
            loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });

    // Before unitAI-rrdnt.36 this asserted a blanket refusal, because the lease existed and
    // nothing acquired it. Writers are now admitted by TAKING the lease, so the refusal
    // moved from "writers are not supported" to "this workspace is held by someone else" —
    // a statement about contention rather than about a missing phase.
    const handle = await host.start({
      specialist: 'executor', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });

    expect(handle.access).toBe('write');
    expect(record.createArgs).toBeDefined();
    expect(sink.names).toContain('lease_acquired');
    expect(sink.names).not.toContain('activation_rejected');

    // Contention is now the real refusal, and it names the holder rather than a phase.
    const second = new NativeActivationHost({
            loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk({}, fakeSession({ record: {}, holdOpen: true })),
      cwd: handle.workspace.worktreePath,
    });

    const refusal = await second.start({
      specialist: 'executor', issueRef: 'ISSUE-2', requestedByParticipantId: 'coordinator',
    }).catch((caught: unknown) => caught as DispatchRejectedError);

    expect(refusal).toBeInstanceOf(DispatchRejectedError);
    expect((refusal as DispatchRejectedError).reason).toBe('workspace_held_by_another_writer');
    expect(sink.names).toContain('lease_denied');
  });

  it('rejects an unavailable model override before creating a session', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const sink = collectingSink();

    const sdk = makeSdk(record, session);
    sdk.resolveModelScopeWithDiagnostics = () => ({
      scopedModels: [],
      diagnostics: [{ type: 'warning', code: 'no-match', message: 'No models match pattern "bogus/model"', pattern: 'bogus/model' }],
    });

    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });

    await expect(host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
      modelOverride: 'bogus/model',
    })).rejects.toThrow(/model_unavailable/);

    expect(record.createArgs).toBeUndefined();
    expect(sink.names).toContain('activation_rejected');
  });

  it('resolves an explicit thinking override over the definition level and records it', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record, assistantText: 'the answer' });

    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec({ thinking_level: 'low' })),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
      thinkingOverride: 'high',
    });
    const result = await handle.result;

    expect(record.createArgs!.thinkingLevel).toBe('high');
    const snapshot = host.inspect(handle.activationId)!;
    expect(snapshot.thinkingLevel).toBe('high');
    expect(snapshot.thinkingOverride).toBe(true);
    expect(result.thinkingLevel).toBe('high');
    expect(result.thinkingOverride).toBe(true);
  });

  it('preserves the definition level when no thinking override is given', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record, assistantText: 'the answer' });

    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec({ thinking_level: 'low' })),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    });
    const result = await handle.result;

    expect(record.createArgs!.thinkingLevel).toBe('low');
    const snapshot = host.inspect(handle.activationId)!;
    expect(snapshot.thinkingLevel).toBe('low');
    expect(snapshot.thinkingOverride).toBe(false);
    expect(result.thinkingLevel).toBe('low');
    expect(result.thinkingOverride).toBe(false);
  });

  it('rejects an unknown thinking override before creating a session', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const sink = collectingSink();

    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec({ thinking_level: 'low' })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });

    await expect(host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
      thinkingOverride: 'turbo' as never,
    })).rejects.toThrow(/invalid_thinking_override/);

    expect(record.createArgs).toBeUndefined();
    expect(sink.names).toContain('activation_rejected');
  });
});

describe('createActivationForensicSink', () => {
  it('routes native events through the shared timeline writer and never throws on writer failure', async () => {
    const { createActivationForensicSink } = await import('../../../src/activation/forensic-sink.js');
    const statuses: Array<Record<string, unknown>> = [];
    const rows: Array<{ jobId: string; event: Record<string, unknown>; identity: Record<string, unknown> }> = [];

    const sink = createActivationForensicSink({
      upsertStatus: (status: Record<string, unknown>) => statuses.push(status),
      upsertStatusWithEvents: (
        status: Record<string, unknown>,
        events: Record<string, unknown>[],
        identity: Record<string, unknown>,
      ) => {
        statuses.push(status);
        rows.push(...events.map(event => ({ jobId: String(status.id), event, identity })));
      },
    } as never);

    sink.emit({
      activationId: 'act:abc', attemptId: 'att:abc:1', participantId: 'specialist::researcher',
      specialist: 'researcher', beadId: 'ISSUE-1', name: 'activation_requested',
    });
    sink.emit({
      activationId: 'act:abc', attemptId: 'att:abc:1', participantId: 'specialist::researcher',
      specialist: 'researcher', beadId: 'ISSUE-1', name: 'activation_rejected', payload: { reason: 'x' },
    });

    expect(statuses).toHaveLength(2);
    expect(statuses[1]).toMatchObject({
      id: 'act:abc', specialist: 'researcher', bead_id: 'ISSUE-1', status: 'error', error: 'x',
    });
    expect(rows.map(row => row.event.type)).toEqual(['run_complete']);
    expect(rows[0]).toMatchObject({
      jobId: 'act:abc',
      identity: { attemptId: 'att:abc:1', attemptNo: 1 },
    });

    // Observability must never be the reason an activation fails.
    const exploding = createActivationForensicSink({
      upsertStatus: () => {},
      upsertStatusWithEvents: () => { throw new Error('db gone'); },
    } as never);
    expect(() => exploding.emit({
      activationId: 'a', attemptId: 'att:a:1', participantId: 'specialist::d', specialist: 'd', name: 'activation_started',
    })).not.toThrow();
    expect(() => exploding.sessionEvent?.({
      activationId: 'a', attemptId: 'att:a:1', participantId: 'specialist::d', specialist: 'd',
      piSessionId: 'pi-a', workspacePath: '/tmp/a', event: { type: 'turn_start' },
    })).not.toThrow();

    // A null client yields a no-op sink rather than throwing at construction.
    const noOp = createActivationForensicSink(null);
    expect(() => noOp.emit({
      activationId: 'a', attemptId: 'att:a:1', participantId: 'specialist::d', specialist: 'd', name: 'activation_started',
    })).not.toThrow();
    expect(() => noOp.sessionEvent?.({
      activationId: 'a', attemptId: 'att:a:1', participantId: 'specialist::d', specialist: 'd',
      piSessionId: 'pi-a', workspacePath: '/tmp/a', event: { type: 'turn_start' },
    })).not.toThrow();
  });
});

/**
 * Both cases below are regressions found by the live smoke (unitAI-rrdnt.11), not by this
 * file. The original doubles were permissive enough to pass while the real runtime failed:
 * a stub `createAgentSession` accepts any `model` value, and a stub session never reports a
 * failed turn. Each is now pinned here so the cheap suite catches it next time.
 */
describe('NativeActivationHost — defects found by the live smoke', () => {
  it('derives participant_id with the house `::` separator, the lineage join key', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const sink = collectingSink();
    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      forensics: sink,
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator:test',
    });
    await handle.result;

    // `orch::`, `node::` and `<container>::emitter::` all use `::`. A single colon here
    // writes a participant_id that no cross-runtime lineage query joins against.
    expect(handle.participantId).toBe('specialist::researcher');
    expect(sink.events.every(e => e.participantId === 'specialist::researcher')).toBe(true);
  });

  it('attaches a compiled StepContract to the activation and records its provenance', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const sink = collectingSink();
    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      forensics: sink,
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator:test',
    });
    await handle.result;

    expect(handle.stepContract.rootWorkRef).toBe('ISSUE-1');
    expect(handle.stepContract.provenance.specialist).toBe('researcher');
    expect(handle.stepContract.nonGoals).toEqual(['Does not fix the thing.']);
    expect(sink.names).toContain('step_contract_compiled');

    // Compilation is derived and creates nothing: the root ref is the Bead itself, never
    // a synthetic step id that would seed a second work graph.
    expect(handle.stepContract.rootWorkRef).toBe(handle.issueRef);
  });

  it('passes the resolved pi Model object to createAgentSession, never a provider-qualified string', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator:test',
    });
    await handle.result;

    // pi's createAgentSession takes `model?: Model<any>`. A string is accepted silently and
    // then fails mid-turn with "No API key found for undefined".
    expect(record.createArgs?.model).toEqual({ id: 'test-model', provider: 'testprov' });
    expect(typeof record.createArgs?.model).not.toBe('string');
  });

  it('reports a turn that ended in error as failed, not as completed with empty output', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({
      record,
      assistantText: '',
      stopReason: 'error',
      errorMessage: '429: monthly usage limit reached',
    });
    const sink = collectingSink();
    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      forensics: sink,
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator:test',
    });
    const result = await handle.result;

    expect(result.status).toBe('failed');
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors?.[0]).toContain('429');
    expect(sink.names).toContain('activation_failed');
    expect(sink.names).not.toContain('activation_completed');
  });

  // unitAI-8s7xx: live logs showed one disposal pushing BOTH `completed` (from
  // `activation_settled`) and `failed` (from `activation_failed`) 10ms apart, because
  // `agent_settled` fired the terminal `activation_settled` event unconditionally, before
  // `runToSettled` had inspected stopReason. `fakeSession.prompt()` fires its listeners
  // (agent_start, agent_end, agent_settled) synchronously before its own promise resolves —
  // the exact ordering that produced the bug — so this drives a real settle/stopReason
  // sequence through the host rather than a synthetic single event.
  it('emits exactly one terminal event for a turn that settles aborted, never both settled and failed', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({
      record,
      assistantText: '',
      stopReason: 'aborted',
      errorMessage: 'The operation was aborted.',
    });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      forensics: sink,
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator:test',
    });
    const result = await handle.result;

    const terminalEvents = sink.names.filter(
      (name) => name === 'activation_settled' || name === 'activation_completed' || name === 'activation_failed',
    );
    expect(terminalEvents).toEqual(['activation_failed']);
    expect(result.status).toBe('failed');
  });

  // unitAI-v2om5: `validation.valid` was hardcoded `true` regardless of output, so a
  // no-op turn (no ask_coordinator call, no text) reported as validated as any real delivery.
  it.each([
    ['empty string', ''],
    ['whitespace only', '   \n\t  '],
  ])('reports a settled activation with %s output as invalid, not failed', async (_label, assistantText) => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record, assistantText });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      forensics: sink,
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator:test',
    });
    const result = await handle.result;

    expect(result.status).toBe('completed');
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors?.[0]).toContain('empty output');
    expect(sink.names).toContain('output_validation_failed');
    expect(sink.names).not.toContain('output_validation_passed');
  });

  it('still reports valid: true for non-empty output', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record, assistantText: 'the answer' });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      forensics: sink,
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator:test',
    });
    const result = await handle.result;

    expect(result.status).toBe('completed');
    expect(result.validation.valid).toBe(true);
    expect(sink.names).toContain('output_validation_passed');
    expect(sink.names).not.toContain('output_validation_failed');
  });
});

/**
 * unitAI-rrdnt.27. The Phase 7 parity lane produces timeline rows from the RAW event
 * stream, so the hook must offer every event — including the types the switch does not
 * translate — and must stay optional so existing sinks are unaffected.
 */
describe('NativeActivationHost — raw session event hook', () => {
  it('offers every raw event to sessionEvent, including untranslated types', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const raw: string[] = [];
    const sink: ActivationForensicSink = {
      emit: () => {},
      sessionEvent: (input) => { raw.push(String(input.event.type)); },
    };

    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      forensics: sink,
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator:test',
    });
    await handle.result;

    // `some_unmapped_event` has no case in the switch — the translated path drops it and
    // the raw path must not, or Phase 7 cannot reach parity with the legacy runner.
    session.emit({ type: 'some_unmapped_event' } as never);

    expect(raw).toContain('agent_start');
    expect(raw).toContain('agent_end');
    expect(raw).toContain('agent_settled');
    expect(raw).toContain('some_unmapped_event');
  });

  it('carries the activation identity needed to attribute a raw event', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const seen: Array<Record<string, unknown>> = [];
    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      forensics: { emit: () => {}, sessionEvent: (i) => { seen.push(i as never); } },
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator:test',
    });
    await handle.result;

    expect(seen[0]).toMatchObject({
      activationId: handle.activationId,
      participantId: 'specialist::researcher',
      specialist: 'researcher',
      beadId: 'ISSUE-1',
      piSessionId: 'pi-sess-123',
    });
  });

  it('works with a sink that has no sessionEvent, so existing sinks are unaffected', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      forensics: collectingSink(),
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator:test',
    });

    await expect(handle.result).resolves.toMatchObject({ status: 'completed' });
  });
});

describe('snapshot tokenUsage (unitAI-crjh7)', () => {
  it('populates snapshot.tokenUsage from the nested message.usage short-key shape', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record, holdOpen: true });
    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      forensics: { emit: () => {} },
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator:test',
    });

    expect(host.inspect(handle.activationId)?.tokenUsage).toBeUndefined();

    // Realistic message_end: usage nests under event.message with short keys, and no
    // top-level token_usage/tokenUsage/usage exists — the shape the old extractor read.
    session.emit({
      type: 'message_end',
      message: {
        role: 'assistant', provider: 'provider', model: 'model', stopReason: 'stop',
        usage: { input: 12000, output: 1500, cacheWrite: 200, cacheRead: 100, reasoning: 52, totalTokens: 13852 },
        content: [{ type: 'text', text: 'answer' }],
      },
    } as never);

    expect(host.inspect(handle.activationId)?.tokenUsage).toEqual({
      input_tokens: 12000,
      output_tokens: 1500,
      cache_creation_tokens: 200,
      cache_read_tokens: 100,
      reasoning_tokens: 52,
      total_tokens: 13852,
    });
    expect(host.liveStats(handle.activationId)?.token_usage?.total_tokens).toBe(13852);
  });

  it('accumulates per-message counts monotonically across interleaved usage/no-usage events (unitAI-beqby.12)', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record, holdOpen: true });
    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, session),
      forensics: { emit: () => {} },
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator:test',
    });
    const totals = () => {
      const usage = host.inspect(handle.activationId)?.tokenUsage;
      return ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens', 'reasoning_tokens', 'tool_tokens']
        .reduce((n, k) => n + ((usage as Record<string, number> | undefined)?.[k] ?? 0), 0);
    };
    const assistantEnd = (usage?: Record<string, number>) => ({
      type: 'message_end',
      message: {
        role: 'assistant', provider: 'provider', model: 'model', stopReason: 'stop',
        ...(usage ? { usage } : {}),
        content: [{ type: 'text', text: 'answer' }],
      },
    } as never);

    // First message: large context load, as seen live.
    session.emit(assistantEnd({ input: 15798, output: 118, cacheWrite: 0, cacheRead: 0, reasoning: 7, totalTokens: 15916 }));
    expect(totals()).toBe(15923);

    // Interleaved events with no usage (tool traffic, streaming updates, user echo)
    // must leave the total untouched — this is the flap window.
    session.emit({ type: 'tool_execution_start', toolName: 'grep' } as never);
    session.emit({ type: 'message_update', message: { role: 'assistant', content: [] } } as never);
    session.emit(assistantEnd());
    session.emit({ type: 'agent_end', willRetry: false } as never);
    expect(totals()).toBe(15923);

    // Second message is small with cache hits; the old spread-merge replaced the
    // total with these per-message counts and the row visibly dropped.
    session.emit(assistantEnd({ input: 303, output: 120, cacheWrite: 0, cacheRead: 15729, reasoning: 0, totalTokens: 16152 }));
    expect(totals()).toBe(15923 + 16152);
    expect(host.liveStats(handle.activationId)?.token_usage?.input_tokens).toBe(15798 + 303);
  });

  it('stays monotonic on reset-shape deltas and takes latest on cumulative-shape counters (unitAI-beqby.15)', async () => {
    const startHost = async () => {
      const record: { createArgs?: Record<string, unknown> } = {};
      const session = fakeSession({ record, holdOpen: true });
      const host = new NativeActivationHost({
                loader: loaderFor(readOnlySpec()),
        workItems: fakeWorkItems(),
        loadSdk: async () => makeSdk(record, session),
        forensics: { emit: () => {} },
        cwd: hostWorkspace(),
      });
      const handle = await host.start({
        specialist: 'researcher',
        issueRef: 'ISSUE-1',
        requestedByParticipantId: 'coordinator:test',
      });
      return { host, session, handle };
    };
    const assistantEnd = (usage: Record<string, number>) => ({
      type: 'message_end',
      message: {
        role: 'assistant', provider: 'provider', model: 'model', stopReason: 'stop',
        usage,
        content: [{ type: 'text', text: 'answer' }],
      },
    } as never);
    const inputOf = (h: NativeActivationHost, id: string) =>
      h.inspect(id)?.tokenUsage?.input_tokens ?? 0;

    // Spark symptom 1 (act:7e5baa87-c42): successive per-message counts DECREASE
    // (293->206). A spread-merge shows 206; the total must hold 293+206 and climb.
    {
      const { host, session, handle } = await startHost();
      session.emit(assistantEnd({ input: 293, output: 739, cacheRead: 49649, reasoning: 496 }));
      expect(inputOf(host, handle.activationId)).toBe(293);
      session.emit(assistantEnd({ input: 206, output: 204, cacheRead: 51313, reasoning: 0 }));
      const usage = host.inspect(handle.activationId)?.tokenUsage;
      expect(usage?.input_tokens).toBe(293 + 206);
      expect(usage?.output_tokens).toBe(739 + 204);
      // Zero carries no information: it neither clears the total nor corrupts the
      // next delta, so reasoning holds at 496 instead of dropping to 0.
      expect(usage?.reasoning_tokens).toBe(496);
      // Cache reads are per-message deltas on this shape (input reset proves it),
      // so they sum like the rest.
      expect(usage?.cache_read_tokens).toBe(49649 + 51313);
    }

    // Spark symptom 2 (act:10e9333c-983): message_end usage is cumulative per
    // message. Blind summing double-counts every message toward 990k; the total
    // must track the latest counter instead.
    {
      const { host, session, handle } = await startHost();
      session.emit(assistantEnd({ input: 10000, output: 500, cacheRead: 40000 }));
      session.emit(assistantEnd({ input: 30000, output: 900, cacheRead: 120000 }));
      session.emit(assistantEnd({ input: 60000, output: 1300, cacheRead: 250000 }));
      const usage = host.inspect(handle.activationId)?.tokenUsage;
      expect(usage?.input_tokens).toBe(60000);
      expect(usage?.output_tokens).toBe(1300);
      expect(usage?.cache_read_tokens).toBe(250000);
    }
  });
});

/**
 * unitAI-rrdnt.40. `reject()` takes `Record<string, unknown>`, so passing a key that
 * `DispatchRejectedError` does not render compiles cleanly and the explanation is dropped.
 * Four call sites had drifted onto `detail:` when the only free-text field is `note:`.
 *
 * These assert on the RENDERED message, which is the whole point. A test that checked the
 * object handed to `reject()` would have passed for as long as the defect existed — the
 * object was always right; the rendering discarded it.
 */
describe('dispatch refusals carry their explanation', () => {
  it('names the draft state when a contract:draft bead is refused', async () => {
    const spec = readOnlySpec();
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems({ state: 'draft' }),
      loadSdk: async () => makeSdk({}, fakeSession({ record: {} })),
      cwd: hostWorkspace(),
    });

    const error = await host.start({
      specialist: 'reader', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    }).catch((caught: unknown) => caught as DispatchRejectedError);

    expect(error).toBeInstanceOf(DispatchRejectedError);
    // Without this, the operator sees `reason: bead_contract_incomplete` and nothing else —
    // for a bead whose seven sections are all present and correct.
    expect(String((error as Error).message)).toMatch(/draft/i);
  });

  it('renders the provider explanation when a model cannot be resolved', async () => {
    const spec = readOnlySpec();
    const host = new NativeActivationHost({
            loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      loadSdk: async () => ({
        ...makeSdk({}, fakeSession({ record: {} })),
        resolveModelScopeWithDiagnostics: () => ({
          scopedModels: [],
          diagnostics: [{ kind: 'no-match', requested: 'nowhere/nothing' }],
        }),
      }) as never,
      cwd: hostWorkspace(),
    });

    const error = await host.start({
      specialist: 'reader',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
      execution: { model: 'nowhere/nothing' },
    } as never).catch((caught: unknown) => caught as DispatchRejectedError);

    expect(error).toBeInstanceOf(DispatchRejectedError);
    const message = String((error as Error).message);
    expect(message).toContain('reason:');
    // The refusal must say something beyond its reason code, or the gate is unhelpful.
    expect(message).toMatch(/note:/);
  });
});

/**
 * PRD §52, unitAI-rrdnt.7. The guard must be a per-CALL verdict, not a tool-set change:
 * within a turn the agent loop runs against a snapshot taken at turn start, so revoking a
 * tool cannot cancel a call that is already planned. Every handler in a batch fires before
 * any execution, so a block is enforceable exactly where `setActiveToolsByName` is not.
 */
describe('per-call mutation admission', () => {
  it('lets the lease holder mutate and refuses a reader the same call', async () => {
    const writerSpec = readOnlySpec();
    (writerSpec.specialist.execution as Record<string, unknown>).permission_required = 'HIGH';
    const sink = collectingSink();

    const writerHost = new NativeActivationHost({
            loader: loaderFor(writerSpec),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk({}, fakeSession({ record: {}, holdOpen: true })),
      cwd: hostWorkspace(),
    });

    const writer = await writerHost.start({
      specialist: 'executor', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });

    // The holder may mutate; a non-mutating call is never gated at all.
    expect(writerHost.admitToolCall(writer.activationId, 'write').allow).toBe(true);
    expect(writerHost.admitToolCall(writer.activationId, 'read').allow).toBe(true);

    // A READER in the same workspace holds no lease, because it is not entitled to one.
    // Refusing it is the capability grant being enforced, not an error state.
    const readerHost = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk({}, fakeSession({ record: {}, holdOpen: true })),
      cwd: writer.workspace.worktreePath,
    });
    const reader = await readerHost.start({
      specialist: 'reader', issueRef: 'ISSUE-2', requestedByParticipantId: 'coordinator',
    });

    const verdict = readerHost.admitToolCall(reader.activationId, 'write');
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toContain('write');
    expect(sink.names).toContain('tool_blocked');

    // Reading is untouched: readers coexist with a writer (acceptance T).
    expect(readerHost.admitToolCall(reader.activationId, 'read').allow).toBe(true);
  });

  it('refuses an unknown activation rather than defaulting to allow', async () => {
    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk({}, fakeSession({ record: {} })),
      cwd: hostWorkspace(),
    });

    // Fail closed. An activation this host does not know is not one it can vouch for.
    expect(host.admitToolCall('act:does-not-exist', 'write').allow).toBe(false);
  });
});

/**
 * unitAI-rrdnt.43. `tools` is a hard filter on pi 0.85.1 and it applies to `customTools`
 * too, so the ask tools have to be NAMED in the allowlist as well as supplied. Before the
 * fix, `customTools: [ask_coordinator]` with `tools: ['read']` produced a session whose
 * tool set was exactly `['read']` — silently, with no error and no diagnostic. No
 * Specialist could ever reach its coordinator.
 *
 * This asserts on what is REQUESTED, which is the most a double can see; the SDK-side
 * behaviour is proven by a live probe recorded on the bead. The complementary trap is
 * worth stating: a test that only checked `customTools` was passed would have been green
 * for the entire life of the defect, because that argument was always correct.
 */
describe('ask tools reach the child', () => {
  it('names both ask tools in the allowlist without widening it', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      loadSdk: async () => makeSdk(record, fakeSession({ record })),
      cwd: hostWorkspace(),
    });

    await host.start({
      specialist: 'reader', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });

    const tools = (record.createArgs?.tools ?? []) as string[];
    expect(tools).toContain('ask_coordinator');
    expect(tools).toContain('escalate_to_coordinator');

    // Asking is not a workspace operation. A read-only Specialist gains the ability to ask
    // and gains no mutation capability — widening the allowlist to admit the ask tools must
    // not smuggle an edit tool in with them.
    for (const forbidden of ['bash', 'edit', 'write', 'powershell']) {
      expect(tools).not.toContain(forbidden);
    }

    // And they are still supplied as custom tools: naming them is necessary, not sufficient.
    const custom = (record.createArgs?.customTools ?? []) as Array<{ name: string }>;
    expect(custom.map(t => t.name).sort()).toEqual(['ask_coordinator', 'escalate_to_coordinator']);
  });
});

describe('PRD acceptance Z — a resume conflict is refused (unitAI-rrdnt.36)', () => {
  it('refuses to resume a settled writer whose workspace another writer took', async () => {
    // Z was structurally UNREACHABLE until unitAI-rrdnt.59: while the lease was held until
    // explicit disposal, a resuming activation still held its own lease and could never
    // contend. The lease now releases on settle and resume() reacquires, so a settled writer
    // CAN lose its workspace — and its resume must then be refused.
    //
    // The model session is faked; the LEASE IS REAL, a file store under
    // <workspace>/.specialists/leases/. Faking it would assert the fixture, not the system.
    const spec = readOnlySpec();
    (spec.specialist.execution as Record<string, unknown>).permission_required = 'HIGH';
    const shared = hostWorkspace();

    const hostA = new NativeActivationHost({
            loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => makeSdk({}, fakeSession({ record: {} })),
      cwd: shared,
    });
    const a = await hostA.start({
      specialist: 'executor', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    await a.result.catch(() => undefined);
    expect(a.access).toBe('write');

    // B takes the freed workspace. Under hold-until-disposal this dispatch was REFUSED,
    // which is precisely why Z could never occur.
    const sinkB = collectingSink();
    const hostB = new NativeActivationHost({
            loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: sinkB,
      loadSdk: async () => makeSdk({}, fakeSession({ record: {}, holdOpen: true })),
      cwd: a.workspace.worktreePath,
    });
    const b = await hostB.start({
      specialist: 'executor', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    expect(sinkB.names).toContain('lease_acquired');
    expect(b.activationId).not.toBe(a.activationId);

    const refusal = await hostA.resume(a.activationId, 'carry on')
      .catch((caught: unknown) => caught as DispatchRejectedError);

    expect(refusal).toBeInstanceOf(DispatchRejectedError);
    expect((refusal as DispatchRejectedError).reason).toBe('workspace_held_by_another_writer');

    // A refused resume leaves the activation exactly as it was — still settled, still
    // resumable if the workspace frees later. A half-advanced resume is worse than a failed one.
    expect(hostA.inspect(a.activationId)?.state).toBe('settled');
    expect(hostA.inspect(a.activationId)?.attemptId).toBe(a.attemptId);
  });
});

/**
 * unitAI-3emr7 — a 429 must walk the fallback chain (reversing the unitAI-rrdnt.35
 * never-fallback ruling) and a failed activation must be retryable in place.
 *
 * The model sessions are faked; the CLASSIFIER is real (`classifyFallbackError` shared
 * with the CLI runner) and the LEASE IS REAL (a file store under the tmp workspace).
 * Faking either would assert the fixture, not the parity the bead demands.
 */
describe('NativeActivationHost — fallback walk + retry (unitAI-3emr7)', () => {
  let sessionCounter = 0;

  /** One session per script: each prompt consumes the next step (last step repeats). */
  function scriptSession(
    script: Array<{ text?: string; stopReason?: string; errorMessage?: string; throw?: unknown }>,
  ): PiAgentSessionLike & { prompts: string[]; disposed: boolean; sessionId: string } {
    const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
    const messages: unknown[] = [];
    let n = 0;
    const session = {
      sessionId: `pi-sess-${(sessionCounter += 1)}`,
      messages,
      isIdle: true,
      disposed: false,
      prompts: [] as string[],
      async prompt(text: string) {
        session.prompts.push(text);
        listeners.forEach(l => l({ type: 'agent_start' }));
        const step = script[Math.min(n, script.length - 1)];
        n += 1;
        if (step.throw) throw step.throw;
        messages.push({
          role: 'assistant',
          content: step.text ?? 'done',
          ...(step.stopReason ? { stopReason: step.stopReason } : {}),
          ...(step.errorMessage ? { errorMessage: step.errorMessage } : {}),
        });
        listeners.forEach(l => l({ type: 'agent_end', willRetry: false }));
        listeners.forEach(l => l({ type: 'agent_settled' }));
      },
      async steer() {}, async followUp() {}, async abort() {},
      dispose() { session.disposed = true; },
      subscribe(l: (e: PiAgentSessionEvent) => void) {
        listeners.push(l);
        return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
      },
      getActiveToolNames: () => [] as string[],
      setActiveToolsByName() {},
      async waitForIdle() {},
    };
    return session as unknown as PiAgentSessionLike & { prompts: string[]; disposed: boolean; sessionId: string };
  }

  /** Serves one session per created model; resolves each requested pattern to itself. */
  function chainSdk(created: unknown[], sessions: PiAgentSessionLike[], unavailable: string[] = []): PiSdk {
    return {
      createAgentSession: async (options?: Record<string, unknown>) => {
        created.push((options as { model?: unknown } | undefined)?.model);
        const session = sessions[created.length - 1];
        if (!session) throw new Error(`chainSdk: no session scripted for model attempt ${created.length}`);
        return { session };
      },
      DefaultResourceLoader: FakeResourceLoader,
      getAgentDir: () => FAKE_AGENT_DIR,
      ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
      resolveModelScopeWithDiagnostics: (patterns: string[]) => {
        if (unavailable.includes(patterns[0])) {
          return {
            scopedModels: [],
            diagnostics: [{ type: 'warning', code: 'no-match', message: `No models match pattern "${patterns[0]}"`, pattern: patterns[0] }],
          };
        }
        const [provider, ...rest] = patterns[0].split('/');
        return { scopedModels: [{ model: { id: rest.join('/') || patterns[0], provider } }], diagnostics: [] };
      },
      defineTool: (d) => d,
      createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
      createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
      createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
      createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
    } as unknown as PiSdk;
  }

  function chainHost(opts: {
    executionExtra?: Record<string, unknown>;
    sessions: PiAgentSessionLike[];
    unavailable?: string[];
    permission?: string;
  }) {
    const created: unknown[] = [];
    const sink = collectingSink();
    const spec = readOnlySpec({ model: 'primaryprov/primary-model', ...(opts.executionExtra ?? {}) });
    if (opts.permission) (spec.specialist.execution as Record<string, unknown>).permission_required = opts.permission;
    const host = new NativeActivationHost({
            loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => chainSdk(created, opts.sessions, opts.unavailable),
      cwd: hostWorkspace(),
    });
    return { host, sink, created };
  }

  const quotaError = () => {
    const error = new Error('Free usage limit exceeded for this model');
    error.name = 'FreeUsageLimitError';
    return error;
  };

  const start = (host: NativeActivationHost) => host.start({
    specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
  });

  it('walks fallback_models after a thrown FreeUsageLimitError and records the winner', async () => {
    const fallback = scriptSession([{ text: 'recovered' }]);
    const { host, sink, created } = chainHost({
      executionExtra: { fallback_models: ['fallbackprov/fallback-model'] },
      sessions: [scriptSession([{ throw: quotaError() }]), fallback],
    });

    const handle = await start(host);
    const result = await handle.result;

    expect(result.status).toBe('completed');
    expect(result.output).toBe('recovered');
    expect(created).toHaveLength(2);
    expect(result.resolvedModel).toBe('fallbackprov/fallback-model');
    expect(result.fallbackUsed).toBe(true);
    const snapshot = host.inspect(handle.activationId)!;
    expect(snapshot.resolvedModel).toBe('fallbackprov/fallback-model');
    expect(snapshot.requestedModel).toBe('primaryprov/primary-model');
    expect(snapshot.piSessionId).toBe(fallback.sessionId);
    const step = sink.events.find(e => e.name === 'model_fallback');
    expect(step?.payload).toMatchObject({
      from_model: 'primaryprov/primary-model',
      to_model: 'fallbackprov/fallback-model',
      error_class: 'rate_limit',
      terminal: false,
    });
  });

  it('walks the chain on the silent stopReason-error path too', async () => {
    const { host, sink, created } = chainHost({
      executionExtra: { fallback_models: ['fallbackprov/fallback-model'] },
      sessions: [
        scriptSession([{ text: '', stopReason: 'error', errorMessage: '429: monthly usage limit reached' }]),
        scriptSession([{ text: 'recovered' }]),
      ],
    });

    const result = await (await start(host)).result;

    expect(result.status).toBe('completed');
    expect(created).toHaveLength(2);
    expect(result.resolvedModel).toBe('fallbackprov/fallback-model');
    expect(result.fallbackUsed).toBe(true);
    expect(sink.events.find(e => e.name === 'model_fallback')?.payload).toMatchObject({
      error_class: 'rate_limit',
      terminal: false,
    });
  });

  it('does not walk the chain after an auth failure', async () => {
    const { host, sink, created } = chainHost({
      executionExtra: { fallback_models: ['fallbackprov/fallback-model'] },
      sessions: [scriptSession([{ throw: new Error('401 Unauthorized') }])],
    });

    const result = await (await start(host)).result;

    expect(result.status).toBe('failed');
    expect(created).toHaveLength(1);
    expect(result.fallbackUsed).toBe(false);
    expect(sink.names).not.toContain('model_fallback');
  });

  it('skips an unavailable primary with forensics when a fallback is configured', async () => {
    const { host, sink, created } = chainHost({
      executionExtra: { fallback_models: ['fallbackprov/fallback-model'] },
      unavailable: ['primaryprov/primary-model'],
      sessions: [scriptSession([{ text: 'recovered' }])],
    });

    const result = await (await start(host)).result;

    expect(result.status).toBe('completed');
    expect(created).toHaveLength(1);
    expect(result.resolvedModel).toBe('fallbackprov/fallback-model');
    expect(result.fallbackUsed).toBe(true);
    expect(sink.events.find(e => e.name === 'model_fallback')?.payload).toMatchObject({
      from_model: 'primaryprov/primary-model',
      error_class: 'unavailable',
    });
  });

  it('refuses retry for live and unknown activations with the right pointer', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const host = new NativeActivationHost({
            loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => makeSdk(record, fakeSession({ record, holdOpen: true })),
      cwd: hostWorkspace(),
    });

    const handle = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    const refusal = await host.retry(handle.activationId).catch((caught: unknown) => caught);
    expect((refusal as DispatchRejectedError).reason).toBe('not_resumable');
    expect((refusal as DispatchRejectedError).detail.note).toMatch(/steer|stop/);

    const unknown = await host.retry('act:nope').catch((caught: unknown) => caught);
    expect((unknown as DispatchRejectedError).reason).toBe('unknown_activation');

    await host.stop(handle.activationId);
  });

  it('retries a failed activation in place on the same session', async () => {
    const session = scriptSession([
      { text: '', stopReason: 'error', errorMessage: 'permanent boom' },
      { text: 'recovered' },
    ]);
    const { host, sink } = chainHost({ sessions: [session] });

    const handle = await start(host);
    expect((await handle.result).status).toBe('failed');

    const retried = await host.retry(handle.activationId);
    expect(retried.activationId).toBe(handle.activationId);
    expect(retried.attemptId).not.toBe(handle.attemptId);
    const result = await retried.result;
    expect(result.status).toBe('completed');
    expect(result.output).toBe('recovered');
    expect(session.prompts).toHaveLength(2);
    expect(result.fallbackUsed).toBe(false);
    expect(sink.events.find(e => e.name === 'activation_retried')?.payload).toMatchObject({
      reused_session: true,
    });

    // A settled activation resumes — retry refuses it with the pointer, not a rerun.
    const again = await host.retry(handle.activationId).catch((caught: unknown) => caught);
    expect((again as DispatchRejectedError).reason).toBe('not_resumable');
    expect((again as DispatchRejectedError).detail.note).toMatch(/resume/);
  });

  it('retries with a model override on a new session and records it', async () => {
    const failed = scriptSession([{ text: '', stopReason: 'error', errorMessage: 'permanent boom' }]);
    const fresh = scriptSession([{ text: 'recovered elsewhere' }]);
    const { host, sink } = chainHost({ sessions: [failed, fresh] });

    const handle = await start(host);
    expect((await handle.result).status).toBe('failed');

    const retried = await host.retry(handle.activationId, { modelOverride: 'otherprov/other-model' });
    const result = await retried.result;
    expect(result.status).toBe('completed');
    expect(result.output).toBe('recovered elsewhere');
    const snapshot = host.inspect(handle.activationId)!;
    expect(snapshot.resolvedModel).toBe('otherprov/other-model');
    expect(snapshot.requestedModel).toBe('otherprov/other-model');
    expect(snapshot.modelOverride).toBe(true);
    expect(failed.disposed).toBe(true);
    expect(sink.events.find(e => e.name === 'activation_retried')?.payload).toMatchObject({
      reused_session: false,
      model_override: true,
    });
  });

  it('leaves a refused override retryable and the lease untouched', async () => {
    const session = scriptSession([{ text: '', stopReason: 'error', errorMessage: 'permanent boom' }]);
    const { host } = chainHost({ sessions: [session], unavailable: ['bogus/model'] });

    const handle = await start(host);
    expect((await handle.result).status).toBe('failed');

    const refusal = await host.retry(handle.activationId, { modelOverride: 'bogus/model' })
      .catch((caught: unknown) => caught);
    expect((refusal as DispatchRejectedError).reason).toBe('model_unavailable');
    // Half-advanced is worse than failed: same attempt, still failed, still retryable.
    expect(host.inspect(handle.activationId)?.attemptId).toBe(handle.attemptId);
    expect(host.inspect(handle.activationId)?.state).toBe('failed');
    expect(session.prompts).toHaveLength(1);
  });

  it('holds a failed writer lease across the retry — no orphan, no contention with itself', async () => {
    // The thrown path never emits agent_settled, so the failed writer still holds its
    // lease — the exact case a naive retry would trip over as contention with itself.
    // The lease is real (file store under the tmp workspace); the session is faked.
    const session = scriptSession([{ throw: new Error('permanent boom') }, { text: 'recovered' }]);
    const { host, sink } = chainHost({ sessions: [session], permission: 'HIGH' });

    const handle = await host.start({
      specialist: 'executor', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    expect(handle.access).toBe('write');
    expect((await handle.result).status).toBe('failed');
    expect(sink.names).toContain('lease_acquired');

    const result = await (await host.retry(handle.activationId)).result;
    expect(result.status).toBe('completed');
    expect(session.prompts).toHaveLength(2);
    expect(sink.names).not.toContain('lease_denied');
    expect(sink.names).not.toContain('lease_uncertain');
    expect(sink.names).toContain('activation_retried');
  });
});


/**
 * SPECIALISTS-4. The legacy CLI isolates the child and then re-adds its DECLARED
 * skills (`--no-skills` + `--skill <path>`), and the native host did neither: it
 * called `createAgentSession` with no `resourceLoader`, so pi auto-discovered the
 * host project's skills, extensions and `AGENTS.md` while the specialist's own
 * declared skills were absent — the exact inverse of the contract. Worse, the
 * turn-1 prompt still commanded `/skill:<name>` for skills the session never got.
 */
describe('native resource isolation (SPECIALISTS-4)', () => {
  /** Real on-disk skill roots: validateBeforeRun hard-fails a path that does not exist. */
  function skillRoots(workspace: string, names: string[]): string[] {
    return names.map((name) => {
      const dir = join(workspace, 'skills', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n\nbody\n`);
      return dir;
    });
  }

  function specWithSkills(paths: string[]) {
    const spec = readOnlySpec() as { specialist: Record<string, unknown> };
    spec.specialist.skills = { paths, scripts: [] };
    return spec;
  }

  async function dispatch(spec: Record<string, unknown>, session: PiAgentSessionLike, record: { createArgs?: Record<string, unknown> }) {
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });
    return host.start({ specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator' });
  }

  it('hands the session a loader built from the declared skills.paths, with discovery off', async () => {
    const workspace = hostWorkspace();
    const declared = skillRoots(workspace, ['gitnexus', 'engineering-quality']);
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });

    await (await dispatch(specWithSkills(declared), session, record)).result;

    const loader = record.createArgs!.resourceLoader as FakeResourceLoader;
    expect(loader).toBeInstanceOf(FakeResourceLoader);
    // The SAME resolved paths validateBeforeRun checked — a validated skill is a loaded one.
    expect(loader.options.additionalSkillPaths).toEqual(declared);
    expect(loader.options.cwd).toBeDefined();
    // Isolation: no ambient skills, extensions, prompt templates, themes or AGENTS.md.
    expect(loader.options.noSkills).toBe(true);
    expect(loader.options.noExtensions).toBe(true);
    expect(loader.options.noContextFiles).toBe(true);
    expect(loader.options.noPromptTemplates).toBe(true);
    expect(loader.options.noThemes).toBe(true);
    expect(loader.reloadCalls).toBeGreaterThan(0);
    // Exactly the declared skills, and nothing belonging to the host project.
    expect(loader.getSkills().skills.map((s) => s.name)).toEqual(['gitnexus', 'engineering-quality']);
  });

  it('a specialist declaring no skills loads none', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });

    await (await dispatch(readOnlySpec(), session, record)).result;

    const loader = record.createArgs!.resourceLoader as FakeResourceLoader;
    expect(loader.options.additionalSkillPaths).toEqual([]);
    expect(loader.getSkills().skills).toEqual([]);
  });

  it('the turn-1 /skill: prefix names only skills the session can actually load', async () => {
    const workspace = hostWorkspace();
    const declared = skillRoots(workspace, ['gitnexus', 'engineering-quality']);
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });

    await (await dispatch(specWithSkills(declared), session, record)).result;

    const loader = record.createArgs!.resourceLoader as FakeResourceLoader;
    const loadable = new Set(loader.getSkills().skills.map((s) => s.name));
    const prompt = session.prompts[0] ?? '';
    const commanded = [...prompt.matchAll(/\/skill:([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    // A specialist that declares skills must not open by commanding a skill it cannot load.
    expect(commanded.length).toBeGreaterThan(0);
    for (const name of commanded) expect(loadable.has(name)).toBe(true);
  });

  it('refuses the dispatch rather than auto-discovering when the SDK cannot declare resources', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const sdk = makeSdk(record, session) as unknown as Record<string, unknown>;
    delete sdk.DefaultResourceLoader;
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => sdk as unknown as PiSdk,
      cwd: hostWorkspace(),
    });

    const refusal = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    }).catch((error: unknown) => error);

    expect((refusal as DispatchRejectedError).reason).toBe('pi_sdk_resource_loader_unavailable');
    expect(record.createArgs).toBeUndefined();
  });
});


/**
 * SPECIALISTS-5. Ten of twenty-four specialists declare `prompt.output_schema`, and the
 * native host hardcoded `outputContractSchema: undefined`, so every one of them lost the
 * structured-output contract the legacy CLI hands the same definition. The child was asked
 * for structured output by its prompt and never told the schema.
 */
describe('output contract schema parity (SPECIALISTS-5)', () => {
  const DECLARED_SCHEMA = {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      confidence: { enum: ['low', 'medium', 'high'] },
    },
    required: ['summary'],
  };

  function specWithSchema() {
    const spec = readOnlySpec() as { specialist: { prompt: Record<string, unknown>; execution: Record<string, unknown> } };
    spec.specialist.prompt.output_schema = DECLARED_SCHEMA;
    spec.specialist.execution.response_format = 'markdown';
    spec.specialist.execution.output_type = 'analysis';
    return spec;
  }

  function outputContractSection(systemPrompt: string): string {
    const start = systemPrompt.indexOf('## Output Contract');
    if (start < 0) return '';
    const rest = systemPrompt.slice(start);
    const end = rest.indexOf('\n## ', 1);
    return (end < 0 ? rest : rest.slice(0, end)).trimEnd();
  }

  async function nativeSystemPrompt(): Promise<string> {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const host = new NativeActivationHost({
      loader: loaderFor(specWithSchema()),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    return record.createArgs!.systemPrompt as string;
  }

  it('puts the declared schema in the native system prompt', async () => {
    const systemPrompt = await nativeSystemPrompt();
    expect(systemPrompt).toContain('## Output Contract');
    expect(systemPrompt).toContain('Structure your output to match this schema:');
    expect(systemPrompt).toContain('"confidence"');
    expect(systemPrompt).toContain('## Machine-readable block');
  });

  it('renders the same output contract section the legacy call site renders', async () => {
    const native = outputContractSection(await nativeSystemPrompt());
    // Exactly what src/specialist/runner.ts does for the same definition.
    const legacy = outputContractSection(
      buildSystemPrompt({
        systemPromptTemplate: 'You are the researcher.',
        templateVariables: {},
        bare: false,
        runCwd: process.cwd(),
        specialistName: 'researcher',
        inputIssueRef: 'ISSUE-1',
        responseFormat: 'markdown',
        outputType: 'analysis',
        outputContractSchema: resolveOutputContractSchema('markdown', 'analysis', DECLARED_SCHEMA),
        beadContextText: '',
        readBeadForMemory: () => null,
      }).text,
    );
    expect(legacy).not.toBe('');
    expect(native).toBe(legacy);
  });
});


/**
 * SPECIALISTS-6. Two legacy capabilities were absent from the native path: pre-phase
 * scripts (`runner.ts:1093-1100` — required-script failure refuses before launch, and
 * `inject_output` stdout reaches the prompt as `$pre_script_output`), and the curated Pi
 * extension set that `session.ts` re-enables after `--no-extensions`.
 */
describe('pre-scripts and curated extensions (SPECIALISTS-6)', () => {
  const PY_KERNEL = '/fake/pi-extensions/python-kernel';

  function specWithScripts(scripts: Array<Record<string, unknown>>, executionExtra: Record<string, unknown> = {}) {
    const spec = readOnlySpec(executionExtra) as { specialist: { skills?: Record<string, unknown> } };
    spec.specialist.skills = { paths: [], scripts };
    return spec;
  }

  /** A real executable on disk: validateBeforeRun hard-fails a missing script or bad shebang. */
  function preScriptFile(workspace: string, name: string, body: string): string {
    const file = join(workspace, `${name}.sh`);
    writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
  }

  it('injects an optional pre-script stdout into the turn-1 prompt', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const workspace = hostWorkspace();
    const script = preScriptFile(workspace, 'pre-ok', 'echo PRE-SCRIPT-MARKER');
    const spec = specWithScripts([{ phase: 'pre', run: script, inject_output: true }]) as {
      specialist: { prompt: Record<string, unknown> };
    };
    spec.specialist.prompt.task_template = 'Do: $bead_id\nPre: $pre_script_output';
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => makeSdk(record, session),
      cwd: workspace,
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;

    expect(session.prompts[0]).toContain('PRE-SCRIPT-MARKER');
  });

  it('refuses a failing REQUIRED pre-script before any session exists', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const workspace = hostWorkspace();
    const script = preScriptFile(workspace, 'pre-fail', 'exit 7');
    const host = new NativeActivationHost({
      loader: loaderFor(specWithScripts([
        { phase: 'pre', run: script, inject_output: false, required: true },
      ])),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => makeSdk(record, session),
      cwd: workspace,
    });
    const refusal = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    }).catch((error: unknown) => error);

    expect((refusal as DispatchRejectedError).reason).toBe('required_pre_script_failed');
    expect(record.createArgs).toBeUndefined();
  });

  it('gives the write tier the curated extensions and applies same-identity de-duplication', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const host = new NativeActivationHost({
      loader: loaderFor(specWithScripts([], {
        permission_required: 'HIGH',
        extensions: { 'npm:pi-mcp-adapter': true, [PY_KERNEL]: true },
      })),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;

    const loader = record.createArgs!.resourceLoader as FakeResourceLoader;
    const paths = loader.options.additionalExtensionPaths as string[];
    // The curated python-kernel is injected for a write tier...
    expect(paths).toContain(PY_KERNEL);
    // ...exactly once, even though the definition also declares it (unitAI-il2io rule).
    expect(paths.filter((p) => p === PY_KERNEL)).toHaveLength(1);
    // A non-local source cannot be loaded by the in-process resource loader and is not
    // forwarded as if it were a path.
    expect(paths.some((p) => p.startsWith('npm:'))).toBe(false);
  });

  it('withholds the write-tier-only curated extensions from a read-only specialist', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const host = new NativeActivationHost({
      loader: loaderFor(specWithScripts([])),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;

    const loader = record.createArgs!.resourceLoader as FakeResourceLoader;
    expect(loader.options.additionalExtensionPaths as string[]).not.toContain(PY_KERNEL);
  });
});
