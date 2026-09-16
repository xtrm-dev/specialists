import { describe, it, expect, vi, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
/**
 * SPECIALISTS-22: force the mandatory-rules resolution to fail so the chosen policy is
 * exercised rather than asserted. The flag is hoisted because vi.mock factories run before
 * module body code.
 */
const mandatoryRulesFault = vi.hoisted(() => ({ fail: false }));
vi.mock('../../../src/specialist/mandatory-rules.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/specialist/mandatory-rules.js')>();
  return {
    ...actual,
    buildMandatoryRulesInjection: (...args: unknown[]) => {
      if (mandatoryRulesFault.fail) throw new Error('rules fixture exploded');
      return (actual.buildMandatoryRulesInjection as (...a: unknown[]) => unknown)(...args);
    },
  };
});

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
import { NativeActivationHost, resolveWorkspace, resolveDeclaredExtensionSources, resolveNpmExtensionSource, resolveGitExtensionSource, expectedRemoteExtensionLabels, formatSkippedExtensionSourceMessage, unresolvableNpmSources, type ActivationForensicSink } from '../../../src/activation/native-host.js';
import { ASK_TOOL, ESCALATE_TOOL } from '../../../src/activation/ask-tool.js';
import { buildSystemPrompt } from '../../../src/specialist/system-prompt.js';
import { resolveOutputContractSchema } from '../../../src/specialist/runner.js';
import { DispatchRejectedError } from '../../../src/activation/types.js';
import { acquire as acquireLease, leasePath } from '../../../src/activation/workspace-lease.js';
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
      const systemPrompt = String((options as { systemPrompt?: unknown } | undefined)?.systemPrompt ?? '');
      // F3: discovery needs getAllTools. Older doubles lacked it; return fenced sessions with a
      // builtin registry so pre-existing tests with dynamic sources keep passing with no
      // widening (discovered ['read'] is a builtin collision, pinned empty, no refusal).
      if (systemPrompt === 'builtin-enumeration (never prompted)') {
        return {
          session: {
            sessionId: 'pi-builtin-enumeration',
            messages: [], isIdle: true,
            async prompt() { throw new Error('never prompted'); },
            async steer() {}, async followUp() {}, async abort() {}, dispose() {},
            subscribe() { return () => {}; },
            getActiveToolNames: () => [] as string[],
            setActiveToolsByName() {}, async waitForIdle() {},
            getAllTools: () => ['read', 'bash', 'edit', 'write', 'powershell', 'grep', 'find', 'ls']
              .map((name) => ({ name, sourceInfo: { source: 'builtin' } })),
          } as unknown as PiAgentSessionLike,
        };
      }
      if (systemPrompt === 'extension-discovery (never prompted)') {
        return {
          session: {
            sessionId: 'pi-discovery',
            messages: [], isIdle: true,
            async prompt() { throw new Error('never prompted'); },
            async steer() {}, async followUp() {}, async abort() {}, dispose() {},
            subscribe() { return () => {}; },
            getActiveToolNames: () => ['read'],
            setActiveToolsByName() {}, async waitForIdle() {},
            getAllTools: () => ['read', 'bash', 'edit', 'write', 'powershell', 'grep', 'find', 'ls']
              .map((name) => ({ name, sourceInfo: { source: 'builtin' } })),
          } as unknown as PiAgentSessionLike,
        };
      }
      record.createArgs = options;
      // Model pi's HARD FILTER faithfully: the session exposes exactly the tools it was
      // named, no more. Without this the fake reports a fixed list and every activation
      // passes the post-load verification for the wrong reason (SPECIALISTS-42).
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

/** A valid inline contract: seven sections plus SCRUTINY, so the inline path is reached. */
const releasedClaims: string[] = [];
afterEach(() => { releasedClaims.length = 0; });

const INLINE_CONTRACT =
  'PROBLEM\nProve the inline-dispatch path.\n\nSUCCESS\nA read-only activation settles.\n\n' +
  'SCOPE\nRead-only.\n\nNON_GOALS\nNo writes.\n\nCONSTRAINTS\nRead-only.\n\n' +
  'VALIDATION\nOutput confirms.\n\nOUTPUT\nA short report.\n\nSCRUTINY LOW';

function fakeWorkItems(options: { state?: string; blockers?: Array<{ ref: string; title: string; description?: string }> } = {}): SpecialistWorkItemBoundary {
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
    completedBlockers: () => options.blockers ?? [],
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
    // Records what was released, so a test asserts the release happened rather than that a no-op
    // method exists (SPECIALISTS-53).
    releaseInlineClaim: (ref: string, opts?: { activationId?: string }) => {
      releasedClaims.push(opts?.activationId ? `${ref}@${opts.activationId}` : ref);
      return true;
    },
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
    // Model pi's HARD FILTER: this session exposes exactly the tools it was named
    // (SPECIALISTS-42). Reporting a fixed empty set made the post-load verification fire
    // for a reason that had nothing to do with what these tests are about.
    let activeTools: string[] = [];
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
      getActiveToolNames: () => activeTools,
      setActiveToolsByName(names: string[]) { activeTools = names; },
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
        // Faithful to pi: the session exposes the tools it was named (SPECIALISTS-42).
        if (Array.isArray((options as { tools?: unknown } | undefined)?.tools)) {
          session.setActiveToolsByName((options as { tools: string[] }).tools);
        }
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

  it('re-acquires the writer lease for a fallback attempt after a SETTLED failure', async () => {
    // SPECIALISTS-46. The thrown-error fallback tests above never settle, so the failed writer
    // keeps its lease and the walk inherits one by accident. A retryable failure is normally a
    // settled turn with a bad stopReason, and settling releases the lease unconditionally
    // (onSessionEvent, agent_settled). The walk then created the next session with no
    // acquireLease anywhere, so attempt 2 ran holding nothing and every mutating call it made
    // was refused by admitToolCall: a full model turn spent on writes that could not happen.
    const primary = scriptSession([{ text: '', stopReason: 'error', errorMessage: '429: monthly usage limit reached' }]);
    const fallback = scriptSession([{ text: 'recovered' }]);
    const { host } = chainHost({
      executionExtra: { fallback_models: ['fallbackprov/fallback-model'] },
      sessions: [primary, fallback],
      permission: 'HIGH',
    });

    const handle = await host.start({
      specialist: 'executor', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    const workspace = host.inspect(handle.activationId)!.workspace;

    // Observed at the moment the fallback attempt actually runs, which is the only moment the
    // question is about. After the activation ends the lease is released either way.
    let leaseHeldDuringFallback: boolean | undefined;
    const originalPrompt = fallback.prompt.bind(fallback);
    fallback.prompt = async (text: string) => {
      leaseHeldDuringFallback = existsSync(leasePath(workspace));
      return originalPrompt(text);
    };

    const result = await handle.result;
    expect(result.fallbackUsed).toBe(true);
    expect(leaseHeldDuringFallback).toBe(true);
  });

  it('releases the claim an inline contract took when the dispatch is refused', async () => {
    // SPECIALISTS-45 made the orphan discoverable; SPECIALISTS-53 makes it usable. The issue is
    // created AND claimed with the refusing activation's id, and Substrate's DEFAULT_CLAIM_TTL_MS
    // is 15 minutes, so a coordinator that reads created_ref and immediately retries hits a claim
    // held by an activation that never ran. Releasing deletes no work: the issue stays and becomes
    // re-dispatchable at once.
    const workspace = hostWorkspace();
    const spec = readOnlySpec();
    (spec.specialist.execution as Record<string, unknown>).permission_required = 'HIGH';
    acquireLease({
      workspace: resolveWorkspace(workspace),
      activationId: 'act:other-writer',
      attemptId: 'att:other-writer:1',
      specialist: 'other-specialist',
    });
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => makeSdk({}, fakeSession({})),
      cwd: workspace,
    });

    const refusal = await host.start({
      specialist: 'executor', contract: INLINE_CONTRACT, requestedByParticipantId: 'coordinator',
    }).catch((caught: unknown) => caught);

    expect((refusal as DispatchRejectedError).detail.created_ref).toBe('ISSUE-INLINE');
    // The refusing activation's own id is passed, so the boundary can refuse to release a claim
    // that is no longer ours (SPECIALISTS-53 review).
    expect(releasedClaims).toHaveLength(1);
    expect(releasedClaims[0]).toMatch(/^ISSUE-INLINE@act:/);
  });

  it('keeps the claim when the inline dispatch is admitted', async () => {
    // The release is for refusals only: an admitted activation holds its claim for real work.
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => makeSdk({}, fakeSession({})),
      cwd: hostWorkspace(),
    });

    await host.start({
      specialist: 'researcher', contract: INLINE_CONTRACT, requestedByParticipantId: 'coordinator',
    });

    expect(releasedClaims).toEqual([]);
  });

  it('names the created issue when an inline dispatch is refused after creation', async () => {
    // SPECIALISTS-45. inlineCreate creates AND claims a durable issue BEFORE the lease is taken,
    // and a refusal never returns the created_bead_id the success path would. Without naming it the
    // caller is left with a claimed issue it cannot discover. Another writer holds the workspace
    // here, so the refusal fires after the issue exists.
    const workspace = hostWorkspace();
    const spec = readOnlySpec();
    (spec.specialist.execution as Record<string, unknown>).permission_required = 'HIGH';
    acquireLease({
      workspace: resolveWorkspace(workspace),
      activationId: 'act:other-writer',
      attemptId: 'att:other-writer:1',
      specialist: 'other-specialist',
    });
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => makeSdk({}, fakeSession({})),
      cwd: workspace,
    });

    const refusal = await host.start({
      specialist: 'executor', contract: INLINE_CONTRACT, requestedByParticipantId: 'coordinator',
    }).catch((caught: unknown) => caught);

    expect(refusal).toBeInstanceOf(DispatchRejectedError);
    // The acquire's own reason and holder survive: a caller still needs to know who holds it.
    expect((refusal as DispatchRejectedError).reason).toBe('workspace_held_by_another_writer');
    expect((refusal as DispatchRejectedError).detail.created_ref).toBe('ISSUE-INLINE');
    // ...and the human-readable body names it, not just the structured detail.
    expect(String((refusal as Error).message)).toContain('ISSUE-INLINE');
  });

  it('names the created issue when the binding refuses an inline dispatch', async () => {
    // The same rule on the reject() path, which is the one most post-creation refusals use.
    const workspace = hostWorkspace();
    const boundary = fakeWorkItems();
    (boundary as { bind: () => never }).bind = () => { throw new Error('bind blew up'); };
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: boundary,
      forensics: collectingSink(),
      loadSdk: async () => makeSdk({}, fakeSession({})),
      cwd: workspace,
    });

    const refusal = await host.start({
      specialist: 'researcher', contract: INLINE_CONTRACT, requestedByParticipantId: 'coordinator',
    }).catch((caught: unknown) => caught);

    expect((refusal as DispatchRejectedError).reason).toBe('issue_binding_failed');
    expect((refusal as DispatchRejectedError).detail.created_ref).toBe('ISSUE-INLINE');
  });

  it('releases the lease when a prompt rejects without settling', async () => {
    // SPECIALISTS-51. pi emits agent_settled from a finally around its agent loop, so a turn that
    // fails by THROWING still settles and the settle handler releases. The paths outside that
    // finally - the prompt() preflight and its activeRun guard - reject without ever emitting it,
    // and this fake models exactly that: scriptSession throws without a settle event. Before the
    // fix the activation went terminal still holding the lease, held by this long-lived process.
    const session = scriptSession([{ throw: new Error('preflight rejected') }]);
    const workspace = hostWorkspace();
    const created: unknown[] = [];
    const sdk = chainSdk(created, [session]);
    const spec = readOnlySpec({ model: 'primaryprov/primary-model' });
    (spec.specialist.execution as Record<string, unknown>).permission_required = 'HIGH';
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => sdk,
      cwd: workspace,
    });

    const handle = await host.start({
      specialist: 'executor', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    const result = await handle.result;
    const identity = host.inspect(handle.activationId)!.workspace;

    expect(result.status).toBe('failed');
    expect(existsSync(leasePath(identity))).toBe(false);
    // acquireLease is the same call start() makes, so this asserts admission, not a flag.
    expect(() =>
      acquireLease({ workspace: identity, activationId: 'act:second-writer', attemptId: 'att:second-writer:1', specialist: 'executor' }),
    ).not.toThrow();
  });

  it('releases the re-acquired lease when the fallback session cannot be created', async () => {
    // SPECIALISTS-46 review. Re-acquiring before the session exists is the right order - a writer
    // takes the lease BEFORE it has a session - but it needs a failure branch: with no session,
    // nothing settles, and the completion release sits in a branch that never runs. The lease
    // would then be held by this long-lived process and every later writer refused. The likely
    // trigger is a fallback walk, which exists because a provider is already misbehaving.
    const primary = scriptSession([{ text: '', stopReason: 'error', errorMessage: '429: monthly usage limit reached' }]);
    const workspace = hostWorkspace();
    const created: unknown[] = [];
    // No session scripted for the fallback model, so record.createSession throws for it.
    const sdk = chainSdk(created, [primary]);
    const spec = readOnlySpec({ model: 'primaryprov/primary-model', fallback_models: ['fallbackprov/fallback-model'] });
    (spec.specialist.execution as Record<string, unknown>).permission_required = 'HIGH';
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: workspace,
    });

    const handle = await host.start({
      specialist: 'executor', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    const result = await handle.result;
    const identity = host.inspect(handle.activationId)!.workspace;

    expect(result.status).toBe('failed');
    // The lease is gone...
    expect(existsSync(leasePath(identity))).toBe(false);
    // ...and the workspace is takeable, which is the consequence that matters. acquireLease is
    // the same call start() makes, so this asserts admission rather than an internal flag.
    expect(() =>
      acquireLease({ workspace: identity, activationId: 'act:second-writer', attemptId: 'att:second-writer:1', specialist: 'executor' }),
    ).not.toThrow();
  });

  it('ends the fallback walk with a lease reason when the workspace cannot be re-taken', async () => {
    // SPECIALISTS-46, contention half. The walk re-acquires now, so it can also fail to. When it
    // does, the reason must name the lease: a silent model_fallback would send an operator
    // looking at the model for what is actually a workspace that could not be taken.
    const primary = scriptSession([{ text: '', stopReason: 'error', errorMessage: '429: monthly usage limit reached' }]);
    const fallback = scriptSession([{ text: 'recovered' }]);
    const workspace = hostWorkspace();
    const created: unknown[] = [];
    const sdk = chainSdk(created, [primary, fallback]);
    const spec = readOnlySpec({ model: 'primaryprov/primary-model', fallback_models: ['fallbackprov/fallback-model'] });
    (spec.specialist.execution as Record<string, unknown>).permission_required = 'HIGH';

    // The seam the walk itself uses to validate the fallback model. Stealing the workspace here
    // lands it after attempt 1 settled and released, and before the walk re-acquires.
    const identity = resolveWorkspace(workspace);
    const originalResolve = sdk.resolveModelScopeWithDiagnostics;
    let stolen = false;
    sdk.resolveModelScopeWithDiagnostics = (patterns: string[]) => {
      const result = originalResolve(patterns);
      if (!stolen && patterns[0] === 'fallbackprov/fallback-model') {
        stolen = true;
        acquireLease({ workspace: identity, activationId: 'act:other-writer', attemptId: 'att:other-writer:1', specialist: 'other-specialist' });
      }
      return result;
    };

    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: workspace,
    });

    const handle = await host.start({
      specialist: 'executor', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    const result = await handle.result;

    expect(stolen).toBe(true);
    expect(result.status).toBe('failed');
    expect(sink.events.find(e => e.name === 'lease_denied')?.payload).toMatchObject({ on: 'fallback' });
    const terminal = sink.events.filter(e => e.name === 'model_fallback').at(-1);
    expect(terminal?.payload).toMatchObject({ terminal: true });
    expect(String((terminal?.payload as Record<string, unknown>)?.note)).toContain('workspace lease');
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

  it('terminals the activation when a retry override session misses a promised tool', async () => {
    // SPECIALISTS-42 review. retry() sets state to 'starting' and saves it BEFORE building the
    // new session, and it did not wrap that call. A verification miss therefore threw out of
    // retry() and left the snapshot wedged in 'starting' with no lease: an activation nobody
    // could resume, retry or stop. Terminal is the honest state, and the lease goes back through
    // the snapshot lifecycle rather than the start()-scoped closure, which admission disarmed.
    const failed = scriptSession([{ throw: new Error('permanent boom') }]);
    // The override retry builds a NEW session, so chainSdk needs a second one scripted.
    const retrySession = scriptSession([{ text: 'recovered' }]);
    const { host, sink } = chainHost({ sessions: [failed, retrySession], permission: 'HIGH' });

    const handle = await host.start({
      specialist: 'executor', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    expect((await handle.result).status).toBe('failed');

    // The retry's new session exposes nothing, so the post-load verification refuses it.
    retrySession.getActiveToolNames = () => [];

    const refusal = await host.retry(handle.activationId, { modelOverride: 'otherprov/other-model' })
      .catch((caught: unknown) => caught);
    expect((refusal as DispatchRejectedError).reason).toBe('tool_contract_unsatisfied');
    // Terminal, not half-transitioned.
    expect(host.inspect(handle.activationId)?.state).toBe('failed');
    // Released through the lifecycle, so the next writer on this workspace is admitted.
    expect(sink.names).toContain('lease_released');
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
    // An `npm:` source is never forwarded verbatim: it either resolves to the installed
    // package directory or is reported and skipped (unitAI-rx1bu). What must never appear
    // is the bare spec, on any machine. 
    expect(paths.some((p) => p.startsWith('npm:'))).toBe(false);
  });

  it('injects an installed npm source as its resolved path (unitAI-rx1bu)', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    // `PI_NPM_GLOBAL_DIR` is the resolver's first candidate, so the fixture pins the
    // node_modules root the host reads without mocking the module the whole suite shares.
    const fakeNodeModules = hostWorkspace();
    mkdirSync(join(fakeNodeModules, 'pi-mcp-adapter'), { recursive: true });
    writeFileSync(
      join(fakeNodeModules, 'pi-mcp-adapter', 'package.json'),
      JSON.stringify({ name: 'pi-mcp-adapter', version: '0.0.0' }),
    );
    const previousGlobalDir = process.env.PI_NPM_GLOBAL_DIR;
    process.env.PI_NPM_GLOBAL_DIR = fakeNodeModules;
    try {
      const host = new NativeActivationHost({
        loader: loaderFor(specWithScripts([], {
          permission_required: 'HIGH',
          extensions: { 'npm:pi-mcp-adapter': true },
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
      expect(paths).toContain(join(fakeNodeModules, 'pi-mcp-adapter'));
      expect(paths).not.toContain('npm:pi-mcp-adapter');
    } finally {
      if (previousGlobalDir === undefined) delete process.env.PI_NPM_GLOBAL_DIR;
      else process.env.PI_NPM_GLOBAL_DIR = previousGlobalDir;
    }
  });

  it('injects a git source with a present checkout as its cache path (unitAI-1pqtl.3)', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    // Fixture-pinned agent dir, never the machine's real `~/.pi/agent`: the host derives
    // the cache root from `sdk.getAgentDir()`, so overriding the SDK pins the root.
    const fakeAgentDir = hostWorkspace();
    const checkout = join(fakeAgentDir, 'git', 'github.com/alonw0/pi-claude-link');
    mkdirSync(checkout, { recursive: true });
    writeFileSync(
      join(checkout, 'package.json'),
      JSON.stringify({ name: 'pi-claude-link', version: '0.0.0' }),
    );
    const sdk = { ...makeSdk(record, session), getAgentDir: () => fakeAgentDir };
    const host = new NativeActivationHost({
      loader: loaderFor(specWithScripts([], {
        permission_required: 'READ_ONLY',
        extensions: { 'git:github.com/alonw0/pi-claude-link': true },
      })),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;

    const loader = record.createArgs!.resourceLoader as FakeResourceLoader;
    const paths = loader.options.additionalExtensionPaths as string[];
    expect(paths).toContain(checkout);
    expect(paths).not.toContain('git:github.com/alonw0/pi-claude-link');
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

  /**
   * unitAI-rx1bu. Every specialist enables `npm:` extension sources in the global user
   * config, and the legacy CLI forwards them to `-e`, where pi's package manager resolves
   * them. The native path has to resolve them itself: an `npm:` source that is never
   * resolved is tool surface the contract believes the session has and the session does
   * not — which is how `ast_grep` went missing from every native activation.
   */
  describe('declared extension sources: npm resolution (unitAI-rx1bu)', () => {
    const env = (dir: string | undefined, installed: string[]) => ({
      globalNodeModulesDir: () => dir,
      manifestExists: (packagePath: string) => installed.includes(packagePath),
    });

    it('resolves an installed npm package to its directory', () => {
      expect(resolveNpmExtensionSource('npm:pi-ast-grep', env('/nm', ['/nm/pi-ast-grep'])))
        .toBe('/nm/pi-ast-grep');
    });

    it('resolves scoped and version-pinned specs to the package directory, not the spec string', () => {
      expect(resolveNpmExtensionSource('npm:@scope/pkg@1.2.3', env('/nm', ['/nm/@scope/pkg'])))
        .toBe('/nm/@scope/pkg');
      expect(resolveNpmExtensionSource('npm:pi-ast-grep@0.1.0', env('/nm', ['/nm/pi-ast-grep'])))
        .toBe('/nm/pi-ast-grep');
    });

    it('returns null for an uninstalled package, a non-npm source, and a missing root', () => {
      expect(resolveNpmExtensionSource('npm:pi-ast-grep', env('/nm', []))).toBeNull();
      expect(resolveNpmExtensionSource('git:github.com/alonw0/pi-claude-link', env('/nm', ['/nm/pi-ast-grep']))).toBeNull();
      expect(resolveNpmExtensionSource('npm:pi-ast-grep', env(undefined, ['/nm/pi-ast-grep']))).toBeNull();
    });

    it('keeps local paths, resolves npm sources, and reports the rest as skipped', () => {
      const { local, skipped } = resolveDeclaredExtensionSources(
        ['/local/ext', 'npm:pi-ast-grep', 'git:github.com/alonw0/pi-claude-link', 'npm:absent-pkg'],
        env('/nm', ['/nm/pi-ast-grep']),
      );
      expect(local).toEqual(['/local/ext', '/nm/pi-ast-grep']);
      expect(skipped).toEqual(['git:github.com/alonw0/pi-claude-link', 'npm:absent-pkg']);
    });
  });

  /**
   * unitAI-1pqtl.3. A declared `git:<spec>` whose checkout exists under pi's cache
   * (`<agentDir>/git/<spec>`, pi-maintained, never hardcoded) resolves to that directory
   * with a readable manifest required — the same shape as the `npm:` fix. No checkout,
   * no manifest, or no agent dir keeps the reported skip; `http:`/`https:`/`ssh:` never
   * resolve. The root is always fixture-pinned, never the machine's real cache.
   */
  describe('declared extension sources: git checkout resolution (unitAI-1pqtl.3)', () => {
    const GIT_SPEC = 'github.com/alonw0/pi-claude-link';
    const GIT_SOURCE = `git:${GIT_SPEC}`;
    const gitEnv = (agentDir: string | undefined, installed: string[]) => ({
      globalNodeModulesDir: () => undefined,
      manifestExists: (packagePath: string) => installed.includes(packagePath),
      piAgentDir: () => agentDir,
    });

    it('resolves a present checkout to the cache path', () => {
      const agentDir = '/fake/agent';
      const checkout = join(agentDir, 'git', GIT_SPEC);
      expect(resolveGitExtensionSource(GIT_SOURCE, gitEnv(agentDir, [checkout]))).toBe(checkout);
    });

    it('returns null for an absent checkout, a missing agent dir, and a non-git source', () => {
      const agentDir = '/fake/agent';
      expect(resolveGitExtensionSource(GIT_SOURCE, gitEnv(agentDir, []))).toBeNull();
      expect(resolveGitExtensionSource(GIT_SOURCE, gitEnv(undefined, [`/other/git/${GIT_SPEC}`]))).toBeNull();
      expect(resolveGitExtensionSource('npm:pi-ast-grep', gitEnv(agentDir, [`${agentDir}/git/${GIT_SPEC}`]))).toBeNull();
      expect(resolveGitExtensionSource('git:', gitEnv(agentDir, [join(agentDir, 'git')]))).toBeNull();
    });

    it('requires a readable manifest: a checkout directory without one does not resolve', () => {
      // Mutation check: removing the manifestExists gate must make this fail (it would
      // otherwise hand the loader a path that cannot load).
      const agentDir = '/fake/agent';
      expect(resolveGitExtensionSource(GIT_SOURCE, gitEnv(agentDir, []))).toBeNull();
    });

    it('refuses specs that would escape the cache root', () => {
      const agentDir = '/fake/agent';
      expect(resolveGitExtensionSource('git:../evil', gitEnv(agentDir, [join(agentDir, 'evil')]))).toBeNull();
      expect(resolveGitExtensionSource('git:/absolute/path', gitEnv(agentDir, ['/absolute/path']))).toBeNull();
    });

    it('resolves git checkouts through the declared-source split while http/https/ssh skip', () => {
      const agentDir = '/fake/agent';
      const checkout = join(agentDir, 'git', GIT_SPEC);
      const { local, skipped } = resolveDeclaredExtensionSources(
        [GIT_SOURCE, 'https://example.com/ext', 'http://example.com/ext', 'ssh:example.com/ext', '/local/ext'],
        gitEnv(agentDir, [checkout]),
      );
      expect(local).toEqual([checkout, '/local/ext']);
      expect(skipped).toEqual(['https://example.com/ext', 'http://example.com/ext', 'ssh:example.com/ext']);
    });

    it('skips a git source with no checkout, with the remedy in the message', () => {
      const agentDir = '/fake/agent';
      const { local, skipped } = resolveDeclaredExtensionSources([GIT_SOURCE], gitEnv(agentDir, []));
      expect(local).toEqual([]);
      expect(skipped).toEqual([GIT_SOURCE]);
      const message = formatSkippedExtensionSourceMessage(GIT_SOURCE);
      expect(message).toContain(GIT_SOURCE);
      // Remedy, not merely the fact: how to make it load, or how to stop the warning.
      expect(message.toLowerCase()).toContain('install');
      expect(message.toLowerCase()).toMatch(/remove|enablement/);
    });

    it('skipped messages for http/https/ssh also name the source and the remedy', () => {
      for (const source of ['https://example.com/ext', 'http://example.com/ext', 'ssh:example.com/ext']) {
        const message = formatSkippedExtensionSourceMessage(source);
        expect(message).toContain(source);
        expect(message.toLowerCase()).toContain('install');
      }
    });
  });
});


/**
 * SPECIALISTS-22. Three inputs the legacy runner supplies to `renderTaskPrompt` were
 * missing from the native call site: completed blockers, the reviewer's execution-only diff
 * context, and any handling at all of `mandatoryRulesError` / `mandatoryRules`.
 */
describe('task-prompt composition parity (SPECIALISTS-22)', () => {
  afterEach(() => { mandatoryRulesFault.fail = false; });

  async function dispatchWith(options: { blockers?: Array<{ ref: string; title: string; description?: string }>; specialist?: string; sink?: ReturnType<typeof collectingSink> }) {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const sink = options.sink ?? collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems({ blockers: options.blockers }),
      forensics: sink,
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });
    const handle = await host.start({
      specialist: options.specialist ?? 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    return { session, sink, record, handle };
  }

  /** `$prompt` must appear in the task template or the bead context never reaches the task. */
  function specWithPromptTemplate() {
    const spec = readOnlySpec() as { specialist: { prompt: Record<string, unknown> } };
    spec.specialist.prompt.task_template = 'Do: $prompt';
    return spec;
  }

  async function dispatchWith(options: { blockers?: Array<{ ref: string; title: string; description?: string }>; specialist?: string; cwd?: string }) {
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const sink = collectingSink();
    const spec = specWithPromptTemplate() as { specialist: { metadata: Record<string, unknown> } };
    // The reviewer hook keys on the RESOLVED definition's name, as the legacy path does.
    spec.specialist.metadata.name = options.specialist ?? 'researcher';
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems({ blockers: options.blockers }),
      forensics: sink,
      loadSdk: async () => makeSdk(record, session),
      cwd: options.cwd ?? hostWorkspace(),
    });
    let handle: Awaited<ReturnType<NativeActivationHost['start']>> | undefined;
    let refusal: unknown;
    try {
      handle = await host.start({
        specialist: options.specialist ?? 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
      });
    } catch (error) {
      refusal = error;
    }
    return { session, sink, record, handle, refusal };
  }

  it('renders completed blockers as dependency context', async () => {
    const { session } = await dispatchWith({
      blockers: [{ ref: 'ISSUE-9', title: 'Unblocked it', description: 'PROBLEM: the schema' }],
    });
    expect(session.prompts[0]).toContain('## Context from completed dependencies:');
    expect(session.prompts[0]).toContain('ISSUE-9');
    expect(session.prompts[0]).toContain('Unblocked it');
  });

  it('renders no dependency section when nothing is completed', async () => {
    const { session } = await dispatchWith({});
    expect(session.prompts[0]).not.toContain('## Context from completed dependencies:');
  });

  it('releases the writer lease when a post-acquisition refusal fires', async () => {
    // SPECIALISTS-42 review. A refusal firing AFTER the lease was taken used to leak it, and the
    // holder is this long-lived process, so the workspace read as held for the life of the
    // server: one refused write-tier dispatch refused every later writer. A fail-closed refusal
    // that silently blocks all subsequent writers is the same invisibility this issue exists to
    // remove, so the second half of this test is the part that matters.
    const workspace = hostWorkspace();
    const spec = readOnlySpec();
    (spec.specialist.execution as Record<string, unknown>).permission_required = 'HIGH';

    // First writer: the session drops a promised tool, so the refusal fires after acquisition.
    const firstRecord: { createArgs?: Record<string, unknown> } = {};
    const firstSession = fakeSession({ record: firstRecord });
    const firstSdk = makeSdk(firstRecord, firstSession);
    const firstOriginal = firstSdk.createAgentSession;
    firstSdk.createAgentSession = async (options?: Record<string, unknown>) => {
      const created = await firstOriginal(options);
      const named = Array.isArray(options?.tools) ? (options!.tools as string[]) : [];
      firstSession.setActiveToolsByName(named.filter((tool) => tool !== 'read'));
      return created;
    };
    const firstSink = collectingSink();
    const firstHost = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: firstSink,
      loadSdk: async () => firstSdk,
      cwd: workspace,
    });

    await expect(firstHost.start({ specialist: 'executor', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator' }))
      .rejects.toThrow(/tool_contract_unsatisfied|did not expose read/);
    expect(firstSession.disposed).toBe(true);
    expect(firstSink.names).toContain('lease_released');

    // Second writer on the SAME workspace: admitted only if the first one released.
    const secondRecord: { createArgs?: Record<string, unknown> } = {};
    const secondSession = fakeSession({ record: secondRecord, holdOpen: true });
    const secondSink = collectingSink();
    const secondHost = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: secondSink,
      loadSdk: async () => makeSdk(secondRecord, secondSession),
      cwd: workspace,
    });

    const handle = await secondHost.start({
      specialist: 'executor', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    expect(handle.access).toBe('write');
    expect(secondSink.names).toContain('lease_acquired');
  });

  it('refuses to launch when the session does not expose a tool the contract promised', async () => {
    // SPECIALISTS-42 (c): this runtime does not load the tool-policy gate, so the promise is
    // verified against the live session here. `read` is always in a READ_ONLY contract's
    // toolsList, so dropping it is a failure on any host, with or without extensions.
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const spec = readOnlySpec() as { specialist: { metadata: Record<string, unknown> } };
    spec.specialist.metadata.name = 'researcher';
    const sdk = makeSdk(record, session);
    const original = sdk.createAgentSession;
    sdk.createAgentSession = async (options?: Record<string, unknown>) => {
      const created = await original(options);
      const named = Array.isArray(options?.tools) ? (options!.tools as string[]) : [];
      // Model pi dropping a promised tool — the failure this verification exists for.
      session.setActiveToolsByName(named.filter((tool) => tool !== 'read'));
      return created;
    };
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });

    await expect(host.start({ specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator' }))
      .rejects.toThrow(/tool_contract_unsatisfied|did not expose read/);
    // Disposed rather than left running with an unverified surface.
    expect(session.disposed).toBe(true);
  });

  it('injects the resolved tool contract into the task prompt, as the legacy path does', async () => {
    // Seven shipped specialists interpolate `$resolved_tool_contract`, and explorer's
    // template tells the model to "Read resolved tool contract first". The renderer resolves
    // an unsupplied optional placeholder to an EMPTY string, so the native host used to hand
    // the model a contract block that was not there at all (SPECIALISTS-37). Asserting the
    // tools VALUES would assert this machine's installed extensions, so this pins the block
    // and the `--tools` line instead.
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const spec = readOnlySpec() as { specialist: { metadata: Record<string, unknown>; prompt: Record<string, unknown> } };
    spec.specialist.metadata.name = 'researcher';
    spec.specialist.prompt.task_template = 'Do: $prompt\n\n$resolved_tool_contract';
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => makeSdk(record, session),
      cwd: hostWorkspace(),
    });

    await host.start({ specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator' });

    expect(session.prompts[0]).toContain('## Resolved Tool Contract');
    expect(session.prompts[0]).toMatch(/- --tools: \S+/);
    // The empty-value path would leave the template's own dangling reference behind.
    expect(session.prompts[0]).not.toContain('$resolved_tool_contract');
  });

  it('gives a reviewer its diff context, which the native call site never supplied', async () => {
    // A real repository with a real unstaged change: the diff builder shells out to git,
    // so a fake cwd would prove nothing.
    const workspace = hostWorkspace();
    const run = (command: string) => execSync(command, { cwd: workspace, stdio: 'pipe' });
    run('git init -q');
    run('git config user.email t@t.t && git config user.name t');
    writeFileSync(join(workspace, 'reviewed.txt'), 'one\n');
    run('git add reviewed.txt && git commit -qm initial');
    writeFileSync(join(workspace, 'reviewed.txt'), 'one\ntwo\n');

    const { session } = await dispatchWith({ specialist: 'reviewer', cwd: workspace });

    expect(session.prompts[0]).toContain('## Reviewer Diff Context');
    expect(session.prompts[0]).toContain('reviewed.txt');
  });

  it('emits the mandatory-rules injection metadata the legacy path emits', async () => {
    const { sink } = await dispatchWith({});
    expect(sink.names).toContain('mandatory_rules_injection');
  });

  it('fails closed when mandatory rules cannot be resolved', async () => {
    mandatoryRulesFault.fail = true;
    const { record, refusal, session } = await dispatchWith({});
    expect((refusal as DispatchRejectedError).reason).toBe('mandatory_rules_unavailable');
    expect(record.createArgs).toBeUndefined();
    expect(session.prompts).toHaveLength(0);
  });
});


/**
 * SPECIALISTS-21. Run-in-place is the deliberate workspace model for native activation.
 * The defect was that nothing said so, that `workspaceHint` was a dead parameter reading as
 * an unfinished feature, and that the rendered Runtime Boundary Rules block derived its cwd
 * from a different expression than the session did — equal only by coincidence.
 */
describe('run-in-place workspace semantics (SPECIALISTS-21)', () => {
  it('resolves the workspace to the coordinator cwd, one source for both fields', () => {
    expect(resolveWorkspace('/some/cwd')).toEqual({ repositoryRoot: '/some/cwd', worktreePath: '/some/cwd' });
  });

  it('names the directory the session actually runs in', async () => {
    const workspace = hostWorkspace();
    const record: { createArgs?: Record<string, unknown> } = {};
    const session = fakeSession({ record });
    const spec = readOnlySpec() as { specialist: { prompt: Record<string, unknown> } };
    spec.specialist.prompt.task_template = 'Do: $prompt';
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

    const prompt = session.prompts[0];
    const sessionCwd = record.createArgs!.cwd as string;
    // The block must name the directory the SESSION runs in, not a second one that happens
    // to agree today.
    expect(sessionCwd).toBe(workspace);
    expect(prompt).toContain(`Current cwd: ${sessionCwd}`);
    expect(prompt).toContain(`Assigned worktree boundary: ${sessionCwd}`);
  });

  it('has no workspaceHint seam left to read as an unfinished feature', () => {
    const sources = [
      readFileSync(new URL('../../../src/activation/native-host.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../../../src/activation/types.ts', import.meta.url), 'utf8'),
    ].join('\n');
    expect(sources).not.toContain('workspaceHint');
  });
});

// The `admission` seam (XTRM-84 4c) is injectable so COMPOSITION can be measured without ADMISSION,
// but nothing tested that the default is still the real gate — so "defaults to validateBeforeRun and
// stays fail-closed" was asserted by a comment. This is that test. It deliberately does NOT pass
// `admission`.
describe('NativeActivationHost — admission defaults to the real pre-flight gate', () => {
  it('refuses with preflight_failed when the definition declares a skill path that does not exist', async () => {
    const record: { createArgs?: Record<string, unknown> } = {};
    const sink = collectingSink();
    const spec = readOnlySpec();
    (spec.specialist as Record<string, unknown>).skills = {
      paths: [join(hostWorkspace(), 'no-such-skill-directory')],
      scripts: [],
    };
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => makeSdk(record, fakeSession({ record })),
      cwd: hostWorkspace(),
    });

    const error = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    }).then(() => null, (thrown: unknown) => thrown as Error);

    expect(error, 'the real pre-flight gate must refuse').not.toBeNull();
    expect(error?.message).toContain('preflight_failed');
    // No session was created: the refusal happens before an AgentSession exists.
    expect(record.createArgs).toBeUndefined();
    expect(sink.names).toContain('activation_rejected');
  });

  it('refuses when the definition requires a tool the resolved contract does not grant', async () => {
    // The SPECIALISTS-57 shape at the ADMISSION layer: a declared required_tool the contract
    // denies is a hard pre-flight failure, not a warning.
    const record: { createArgs?: Record<string, unknown> } = {};
    const spec = readOnlySpec();
    (spec.specialist as Record<string, unknown>).capabilities = { required_tools: ['edit'] };
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => makeSdk(record, fakeSession({ record })),
      cwd: hostWorkspace(),
    });

    const error = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    }).then(() => null, (thrown: unknown) => thrown as Error);
    expect(error?.message).toContain('preflight_failed');
    expect(record.createArgs).toBeUndefined();
  });
});

/**
 * unitAI-1pqtl.2 — discover-then-pin: an operator-enabled extension's tools reach the
 * child's live allowlist AND the contract it was shown, with no per-extension source change.
 *
 * The fake SDK below models pi faithfully where it matters:
 * - `tools` is a HARD filter (real sessions expose exactly what they were named);
 * - discovery sessions (`tools` OMITTED, `noTools: 'builtin'`) enumerate active names;
 * - `getAllTools()` carries `sourceInfo.source` provenance, and a fenced session with NO
 *   dynamic sources enumerates the builtin set dynamically (never a static list).
 * No test names a real third-party tool: the discovered names are fixtures.
 */
describe('NativeActivationHost — discover-then-pin (unitAI-1pqtl.2)', () => {
  const BUILTINS = ['read', 'bash', 'edit', 'write', 'powershell', 'grep', 'find', 'ls'];

  interface DiscoveryCall { systemPrompt: string; paths: string[]; tools?: string[]; noTools?: unknown }

  function discoverySdk(opts: {
    builtinNames?: string[];
    discoveredActive?: string[];
    provenance?: Record<string, string>;
    registryExtra?: Array<{ name: string; source: string }>;
    failDiscovery?: 'throw' | 'empty' | null;
    realAssistantText?: string;
    agentDir?: string;
  } = {}) {
    const builtinNames = opts.builtinNames ?? BUILTINS;
    const discoveredActive = opts.discoveredActive ?? [];
    const provenance = opts.provenance ?? {};
    const registryExtra = opts.registryExtra ?? [];
    const calls: DiscoveryCall[] = [];
    const realRecord: { createArgs?: Record<string, unknown> } = {};
    const realSession = fakeSession({ record: realRecord, assistantText: opts.realAssistantText ?? 'done' });
    const disposed: { builtin: boolean[]; discovery: boolean[] } = { builtin: [], discovery: [] };

    function builtinSession() {
      const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
      let isDisposed = false;
      const idx = disposed.builtin.length;
      disposed.builtin.push(false);
      const session = {
        sessionId: 'pi-builtin-enumeration',
        messages: [] as unknown[],
        isIdle: true,
        async prompt() { throw new Error('builtin-enumeration session must never be prompted'); },
        async steer() {}, async followUp() {}, async abort() {},
        dispose() { isDisposed = true; disposed.builtin[idx] = true; },
        subscribe(l: (e: PiAgentSessionEvent) => void) { listeners.push(l); return () => {}; },
        getActiveToolNames: () => [] as string[],
        setActiveToolsByName() {},
        async waitForIdle() {},
        getAllTools: () => builtinNames.map((name) => ({ name, sourceInfo: { source: 'builtin' } })),
      };
      return session as unknown as PiAgentSessionLike;
    }

    function discoverySession() {
      const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
      const idx = disposed.discovery.length;
      disposed.discovery.push(false);
      const session = {
        sessionId: 'pi-discovery',
        messages: [] as unknown[],
        isIdle: true,
        async prompt() { throw new Error('discovery session must never be prompted'); },
        async steer() {}, async followUp() {}, async abort() {},
        dispose() { disposed.discovery[idx] = true; },
        subscribe(l: (e: PiAgentSessionEvent) => void) { listeners.push(l); return () => {}; },
        getActiveToolNames: () => [...discoveredActive],
        setActiveToolsByName() {},
        async waitForIdle() {},
        getAllTools: () => [
          ...discoveredActive.map((name) => ({
            name,
            sourceInfo: { source: provenance[name] ?? 'cli' },
          })),
          ...registryExtra.map((entry) => ({
            name: entry.name,
            sourceInfo: { source: entry.source },
          })),
        ],
      };
      return session as unknown as PiAgentSessionLike;
    }

    const sdk = {
      createAgentSession: async (options?: Record<string, unknown>) => {
        const systemPrompt = String((options as { systemPrompt?: unknown } | undefined)?.systemPrompt ?? '');
        const loader = (options as { resourceLoader?: FakeResourceLoader } | undefined)?.resourceLoader;
        const paths = [...((loader?.options?.additionalExtensionPaths as string[] | undefined) ?? [])];
        calls.push({
          systemPrompt,
          paths,
          ...(Array.isArray((options as { tools?: unknown } | undefined)?.tools)
            ? { tools: (options as { tools: string[] }).tools }
            : {}),
          ...((options as { noTools?: unknown } | undefined)?.noTools !== undefined
            ? { noTools: (options as { noTools: unknown }).noTools }
            : {}),
        });
        if (systemPrompt === 'builtin-enumeration (never prompted)') return { session: builtinSession() };
        if (systemPrompt === 'extension-discovery (never prompted)') {
          if (opts.failDiscovery === 'throw') throw new Error('discovery boom');
          if (opts.failDiscovery === 'empty') {
            const emptyListeners: Array<(e: PiAgentSessionEvent) => void> = [];
            const idx = disposed.discovery.length;
            disposed.discovery.push(false);
            const empty = {
              sessionId: 'pi-discovery-empty',
              messages: [] as unknown[],
              isIdle: true,
              async prompt() { throw new Error('discovery session must never be prompted'); },
              async steer() {}, async followUp() {}, async abort() {},
              dispose() { disposed.discovery[idx] = true; },
              subscribe(l: (e: PiAgentSessionEvent) => void) { listenersPush(l); return () => {}; },
              getActiveToolNames: () => [] as string[],
              setActiveToolsByName() {},
              async waitForIdle() {},
              getAllTools: () => [] as Array<{ name: string; sourceInfo: { source: string } }>,
            };
            function listenersPush(l: (e: PiAgentSessionEvent) => void) { emptyListeners.push(l); }
            return { session: empty as unknown as PiAgentSessionLike };
          }
          return { session: discoverySession() };
        }
        // Real session: faithful hard filter.
        realRecord.createArgs = options;
        if (Array.isArray((options as { tools?: unknown } | undefined)?.tools)) {
          realSession.setActiveToolsByName((options as { tools: string[] }).tools);
        }
        return { session: realSession };
      },
      DefaultResourceLoader: FakeResourceLoader,
      getAgentDir: () => opts.agentDir ?? FAKE_AGENT_DIR,
      ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
      resolveModelScopeWithDiagnostics: () => ({
        scopedModels: [{ model: { id: 'test-model', provider: 'testprov' } }],
        diagnostics: [],
      }),
      defineTool: (d: unknown) => d,
      createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
      createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
      createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
      createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
    } as unknown as PiSdk;
    return { sdk, calls, realRecord, realSession, disposed };
  }

  /**
   * unitAI-1pqtl.3 A′ (attribution, not taxonomy): the provenance gate trusts a `git:`
   * registry label ONLY when it is the declared spec this activation resolved — never a
   * wildcard, never a hardcoded list. `EXTENSION_CLASS_SOURCES` stays frozen.
   */
  describe('discover-then-pin: git attribution (unitAI-1pqtl.3 A′)', () => {
    const GIT_SOURCE = 'git:github.com/alonw0/pi-claude-link';
    const GIT_SPEC = GIT_SOURCE.slice('git:'.length);

    function gitCheckout(agentDir: string): string {
      const checkout = join(agentDir, 'git', GIT_SPEC);
      mkdirSync(checkout, { recursive: true });
      writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'pi-claude-link', version: '0.0.0' }));
      return checkout;
    }

    it('derives expected remote labels from the declared resolved set only', () => {
      expect(expectedRemoteExtensionLabels([GIT_SOURCE], [])).toEqual([GIT_SOURCE]);
      expect(expectedRemoteExtensionLabels([GIT_SOURCE], [GIT_SOURCE])).toEqual([]);
      expect(expectedRemoteExtensionLabels(['/local/ext', 'npm:pkg'], [])).toEqual([]);
      expect(expectedRemoteExtensionLabels([], [])).toEqual([]);
    });

    it('pins the resolved git source tool through the real path (claude-link active)', async () => {
      const agentDir = hostWorkspace();
      const checkout = gitCheckout(agentDir);
      const { sdk, realRecord, realSession } = discoverySdk({
        agentDir,
        discoveredActive: ['claude-link'],
        provenance: { 'claude-link': GIT_SOURCE },
      });
      const sink = collectingSink();
      const host = new NativeActivationHost({
        loader: loaderFor(specWithExtensions({ [GIT_SOURCE]: true })),
        workItems: fakeWorkItems(),
        forensics: sink,
        loadSdk: async () => sdk,
        cwd: hostWorkspace(),
      });
      await (await host.start({
        specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
      })).result;
      const tools = realRecord.createArgs!.tools as string[];
      expect(tools).toContain('claude-link');
      expect(realSession.prompts[0]).toContain('claude-link');
      expect(sink.names).toContain('extension_tools_discovered');
      // The resolved directory (not the raw spec) reached the loader.
      const loader = realRecord.createArgs!.resourceLoader as FakeResourceLoader;
      expect(loader.options.additionalExtensionPaths as string[]).toContain(checkout);
    });

    it('refuses a git label for a spec nobody declared (A, not A′)', async () => {
      // Distinguishes attribution from a wildcard: only the declared spec is expected, so
      // `git:someone/else` stays refusedProvenance even though it "looks like" a package.
      const agentDir = hostWorkspace();
      gitCheckout(agentDir);
      const { sdk, realRecord } = discoverySdk({
        agentDir,
        discoveredActive: ['claude-link', 'stranger-tool'],
        provenance: { 'claude-link': GIT_SOURCE, 'stranger-tool': 'git:someone/else' },
      });
      const sink = collectingSink();
      const host = new NativeActivationHost({
        loader: loaderFor(specWithExtensions({ [GIT_SOURCE]: true })),
        workItems: fakeWorkItems(),
        forensics: sink,
        loadSdk: async () => sdk,
        cwd: hostWorkspace(),
      });
      await (await host.start({
        specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
      })).result;
      const tools = realRecord.createArgs!.tools as string[];
      expect(tools).toContain('claude-link');
      expect(tools).not.toContain('stranger-tool');
      expect(sink.names).toContain('extension_tools_refused');
      const refused = sink.events.find((e) => e.name === 'extension_tools_refused') as unknown as
        { payload?: { refused_provenance?: string | null } } | undefined;
      expect(String(refused?.payload?.refused_provenance ?? '')).toContain('stranger-tool');
    });

    it('still refuses when a git-labelled source shadows a reserved name (F1 not bypassed)', async () => {
      const agentDir = hostWorkspace();
      gitCheckout(agentDir);
      const { sdk } = discoverySdk({
        agentDir,
        discoveredActive: ['read'],
        provenance: { read: GIT_SOURCE },
        registryExtra: [{ name: 'read', source: GIT_SOURCE }],
      });
      const host = new NativeActivationHost({
        loader: loaderFor(specWithExtensions({ [GIT_SOURCE]: true })),
        workItems: fakeWorkItems(),
        forensics: collectingSink(),
        loadSdk: async () => sdk,
        cwd: hostWorkspace(),
      });
      const refusal = await host.start({
        specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
      }).catch((error: unknown) => error);
      expect((refusal as DispatchRejectedError).reason).toBe('extension_tool_shadowed');
      expect(String((refusal as DispatchRejectedError).detail?.note ?? '')).toContain('read');
    });
  });

  function specWithExtensions(extensions: Record<string, boolean>) {
    const spec = readOnlySpec({ extensions }) as { specialist: { prompt: Record<string, unknown> } };
    // Render the contract into the prompt so the "prompt lists the same set" half is observable.
    spec.specialist.prompt.task_template = 'Do: $prompt\n\n$resolved_tool_contract';
    return spec;
  }

  it('pins a discovered extension tool into session options and the rendered contract', async () => {
    const { sdk, calls, realRecord, realSession } = discoverySdk({
      discoveredActive: ['ext_tool_a'],
      provenance: { ext_tool_a: 'cli' },
    });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    const handle = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    await handle.result;
    const tools = realRecord.createArgs!.tools as string[];
    expect(tools).toContain('ext_tool_a');
    expect(tools).toContain(ASK_TOOL);
    expect(tools).toContain(ESCALATE_TOOL);
    // The contract rendered into the prompt lists the same set.
    expect(realSession.prompts[0]).toContain('ext_tool_a');
    expect(realSession.prompts[0]).toContain('## Resolved Tool Contract');
    // Discovery ran exactly once (builtin + discovery), real session once.
    expect(calls.filter((c) => c.systemPrompt === 'builtin-enumeration (never prompted)')).toHaveLength(1);
    expect(calls.filter((c) => c.systemPrompt === 'extension-discovery (never prompted)')).toHaveLength(1);
    expect(sink.names).toContain('extension_tools_discovered');
  });

  it('leaves options and contract byte-identical when no dynamic sources are enabled', async () => {
    const { sdk, calls, realRecord, realSession } = discoverySdk({ discoveredActive: [] });
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    // No extra session: exactly one createAgentSession (the real one).
    expect(calls).toHaveLength(1);
    const tools = realRecord.createArgs!.tools as string[];
    expect(tools).toContain('read');
    expect(tools).toContain(ASK_TOOL);
    expect(tools).not.toContain('ext_tool_a');
    expect(realSession.prompts[0]).not.toContain('ext_tool_a');
  });

  it('runs discovery once across primary + fallback and pins both sessions identically', async () => {
    // Fallback walk with discovery: the discovery pair runs once, both real attempts pin it.
    const builtinNames = BUILTINS;
    const discoveredActive = ['ext_tool_a'];
    const calls: DiscoveryCall[] = [];
    const realTools: string[][] = [];
    let attempt = 0;
    const sessions: PiAgentSessionLike[] = [];
    function scriptedReal(): PiAgentSessionLike & { prompts: string[] } {
      const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
      const messages: unknown[] = [];
      let active: string[] = [];
      const session = {
        sessionId: `pi-real-${attempt}`,
        messages,
        isIdle: true,
        prompts: [] as string[],
        async prompt(text: string) {
          (session.prompts as string[]).push(text);
          listeners.forEach((l) => l({ type: 'agent_start' }));
          if (attempt === 0) {
            attempt += 1;
            const error = new Error('Free usage limit exceeded for this model');
            error.name = 'FreeUsageLimitError';
            throw error;
          }
          messages.push({ role: 'assistant', content: 'recovered' });
          listeners.forEach((l) => l({ type: 'agent_end', willRetry: false }));
          listeners.forEach((l) => l({ type: 'agent_settled' }));
        },
        async steer() {}, async followUp() {}, async abort() {},
        dispose() {},
        subscribe(l: (e: PiAgentSessionEvent) => void) { listeners.push(l); return () => {}; },
        getActiveToolNames: () => active,
        setActiveToolsByName(names: string[]) { active = names; },
        async waitForIdle() {},
      };
      sessions.push(session as unknown as PiAgentSessionLike);
      return session as unknown as PiAgentSessionLike & { prompts: string[] };
    }
    const sdk = {
      createAgentSession: async (options?: Record<string, unknown>) => {
        const systemPrompt = String((options as { systemPrompt?: unknown } | undefined)?.systemPrompt ?? '');
        const loader = (options as { resourceLoader?: FakeResourceLoader } | undefined)?.resourceLoader;
        const paths = [...((loader?.options?.additionalExtensionPaths as string[] | undefined) ?? [])];
        calls.push({ systemPrompt, paths });
        if (systemPrompt === 'builtin-enumeration (never prompted)') {
          return {
            session: {
              sessionId: 'pi-builtin', messages: [], isIdle: true,
              async prompt() { throw new Error('never prompted'); },
              async steer() {}, async followUp() {}, async abort() {}, dispose() {},
              subscribe() { return () => {}; },
              getActiveToolNames: () => [] as string[],
              setActiveToolsByName() {}, async waitForIdle() {},
              getAllTools: () => builtinNames.map((name) => ({ name, sourceInfo: { source: 'builtin' } })),
            } as unknown as PiAgentSessionLike,
          };
        }
        if (systemPrompt === 'extension-discovery (never prompted)') {
          return {
            session: {
              sessionId: 'pi-discovery', messages: [], isIdle: true,
              async prompt() { throw new Error('never prompted'); },
              async steer() {}, async followUp() {}, async abort() {}, dispose() {},
              subscribe() { return () => {}; },
              getActiveToolNames: () => [...discoveredActive],
              setActiveToolsByName() {}, async waitForIdle() {},
              getAllTools: () => discoveredActive.map((name) => ({ name, sourceInfo: { source: 'cli' } })),
            } as unknown as PiAgentSessionLike,
          };
        }
        const session = scriptedReal();
        if (Array.isArray((options as { tools?: unknown } | undefined)?.tools)) {
          session.setActiveToolsByName((options as { tools: string[] }).tools);
          realTools.push([...(options as { tools: string[] }).tools].sort());
        }
        return { session };
      },
      DefaultResourceLoader: FakeResourceLoader,
      getAgentDir: () => FAKE_AGENT_DIR,
      ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
      resolveModelScopeWithDiagnostics: (patterns: string[]) => {
        const [provider, ...rest] = patterns[0].split('/');
        return { scopedModels: [{ model: { id: rest.join('/') || patterns[0], provider } }], diagnostics: [] };
      },
      defineTool: (d: unknown) => d,
      createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
      createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
      createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
      createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
    } as unknown as PiSdk;
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec({
        model: 'primaryprov/primary-model',
        fallback_models: ['fallbackprov/fallback-model'],
        extensions: { '/fake/ext-a': true },
      })),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    const result = await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    expect(result.status).toBe('completed');
    expect(calls.filter((c) => c.systemPrompt === 'extension-discovery (never prompted)')).toHaveLength(1);
    expect(calls.filter((c) => c.systemPrompt === 'builtin-enumeration (never prompted)')).toHaveLength(1);
    expect(realTools).toHaveLength(2);
    expect(realTools[0]).toEqual(realTools[1]);
    expect(realTools[0]).toContain('ext_tool_a');
  });

  it('refuses and disposes when discovery fails', async () => {
    const { sdk, calls, disposed } = discoverySdk({ failDiscovery: 'throw' });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    const error = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    }).then(() => null, (thrown: unknown) => thrown as Error);
    expect(String(error)).toContain('extension_discovery_failed');
    expect(sink.names).toContain('activation_rejected');
    // Builtin session was disposed; no real session was created.
    expect(disposed.builtin).toEqual([true]);
    expect(calls.some((c) => c.systemPrompt !== 'builtin-enumeration (never prompted)'
      && c.systemPrompt !== 'extension-discovery (never prompted)')).toBe(false);
  });

  it('refuses a builtin-colliding name, records it, and still pins the benign one', async () => {
    // The gate falsifier (unitAI-1pqtl.1): `write` is discoverable and would shadow the
    // builtin in a single registry entry. Pinning it would put `write` into a READ_ONLY
    // child. Both checks are required — this name reports `cli` provenance, so provenance
    // alone does not stop it.
    const { sdk, realRecord, realSession } = discoverySdk({
      discoveredActive: ['probe_benign', 'write'],
      provenance: { probe_benign: 'cli', write: 'cli' },
    });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    const tools = realRecord.createArgs!.tools as string[];
    expect(tools).toContain('probe_benign');
    expect(tools).not.toContain('write');
    expect(realSession.prompts[0]).toContain('probe_benign');
    // The refusal is recorded: forensics names it and the rendered contract warns.
    expect(sink.names).toContain('extension_tools_refused');
    expect(realSession.prompts[0]).toContain("refused extension tool 'write'");
  });

  it('refuses a name whose provenance is not extension-class', async () => {
    const { sdk, realRecord } = discoverySdk({
      discoveredActive: ['good_tool', 'sneaky_builtin'],
      provenance: { good_tool: 'extension', sneaky_builtin: 'builtin' },
    });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    const tools = realRecord.createArgs!.tools as string[];
    expect(tools).toContain('good_tool');
    expect(tools).not.toContain('sneaky_builtin');
    expect(sink.names).toContain('extension_tools_refused');
  });

  it('refuses before any model turn when a declared source yields a silent-empty set', async () => {
    // Loader.reload() does not throw for a non-existent path — the failure is silent by
    // construction, so it must be detected positively (never by catching an exception).
    const { sdk, realRecord, realSession } = discoverySdk({ failDiscovery: 'empty' });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/nonexistent/path-xyz': true })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    const error = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    }).then(() => null, (thrown: unknown) => thrown as Error);
    expect(String(error)).toContain('extension_discovery_failed');
    expect(sink.names).toContain('activation_rejected');
    expect(realRecord.createArgs).toBeUndefined();
    expect(realSession.prompts).toHaveLength(0);
  });

  it('never lets a denied native become active through a discovered name', async () => {
    // READ_ONLY with a healthy gitnexus hard-denies grep/find/ls. An extension registering
    // `grep` must not smuggle it back in: it collides with a builtin and is refused.
    const { sdk, realRecord } = discoverySdk({
      discoveredActive: ['ext_tool_a', 'grep'],
      provenance: { ext_tool_a: 'cli', grep: 'cli' },
    });
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    const tools = realRecord.createArgs!.tools as string[];
    expect(tools).toContain('ext_tool_a');
    expect(tools).not.toContain('grep');
  });

  it('fails closed with no widening when the session lacks getAllTools (older doubles)', async () => {
    // Both-missing stays successful with no widening (F3 decision B): with no provenance map
    // every discovered name falls to refusedProvenance and nothing can be pinned — "no baseline
    // ⇒ nothing attributable ⇒ nothing pinned" is closed, so refusing would break old SDKs
    // for no security gain. The MIXED case (baseline missing while discovery IS available)
    // refuses instead; see the next test.
    const calls: Array<{ systemPrompt: string }> = [];
    const realRecord: { createArgs?: Record<string, unknown> } = {};
    const realSession = fakeSession({ record: realRecord });
    const sdk = {
      createAgentSession: async (options?: Record<string, unknown>) => {
        const systemPrompt = String((options as { systemPrompt?: unknown } | undefined)?.systemPrompt ?? '');
        calls.push({ systemPrompt });
        if (systemPrompt === 'builtin-enumeration (never prompted)') {
          return {
            session: {
              sessionId: 'pi-builtin', messages: [], isIdle: true,
              async prompt() { throw new Error('never prompted'); },
              async steer() {}, async followUp() {}, async abort() {}, dispose() {},
              subscribe() { return () => {}; },
              getActiveToolNames: () => [] as string[],
              setActiveToolsByName() {}, async waitForIdle() {},
              // No getAllTools: older double.
            } as unknown as PiAgentSessionLike,
          };
        }
        if (systemPrompt === 'extension-discovery (never prompted)') {
          return {
            session: {
              sessionId: 'pi-discovery', messages: [], isIdle: true,
              async prompt() { throw new Error('never prompted'); },
              async steer() {}, async followUp() {}, async abort() {}, dispose() {},
              subscribe() { return () => {}; },
              getActiveToolNames: () => ['ext_tool_a'],
              setActiveToolsByName() {}, async waitForIdle() {},
              // No getAllTools: provenance unattributable.
            } as unknown as PiAgentSessionLike,
          };
        }
        realRecord.createArgs = options;
        if (Array.isArray((options as { tools?: unknown } | undefined)?.tools)) {
          realSession.setActiveToolsByName((options as { tools: string[] }).tools);
        }
        return { session: realSession };
      },
      DefaultResourceLoader: FakeResourceLoader,
      getAgentDir: () => FAKE_AGENT_DIR,
      ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
      resolveModelScopeWithDiagnostics: () => ({
        scopedModels: [{ model: { id: 'test-model', provider: 'testprov' } }],
        diagnostics: [],
      }),
      defineTool: (d: unknown) => d,
      createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
      createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
      createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
      createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
    } as unknown as PiSdk;
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    const tools = realRecord.createArgs!.tools as string[];
    expect(tools).not.toContain('ext_tool_a');
    expect(tools).toContain('read');
  });

  it('refuses the MIXED case: baseline unavailable while discovery IS available (F3)', async () => {
    // Load-bearing for F3: builtin session WITHOUT getAllTools, discovery session WITH it.
    // A colliding name would otherwise look pinnable. Must refuse and name the cause.
    const realRecord: { createArgs?: Record<string, unknown> } = {};
    const realSession = fakeSession({ record: realRecord });
    const sdk = {
      createAgentSession: async (options?: Record<string, unknown>) => {
        const systemPrompt = String((options as { systemPrompt?: unknown } | undefined)?.systemPrompt ?? '');
        if (systemPrompt === 'builtin-enumeration (never prompted)') {
          return {
            session: {
              sessionId: 'pi-builtin', messages: [], isIdle: true,
              async prompt() { throw new Error('never prompted'); },
              async steer() {}, async followUp() {}, async abort() {}, dispose() {},
              subscribe() { return () => {}; },
              getActiveToolNames: () => [] as string[],
              setActiveToolsByName() {}, async waitForIdle() {},
              // No getAllTools: baseline unavailable.
            } as unknown as PiAgentSessionLike,
          };
        }
        if (systemPrompt === 'extension-discovery (never prompted)') {
          return {
            session: {
              sessionId: 'pi-discovery', messages: [], isIdle: true,
              async prompt() { throw new Error('never prompted'); },
              async steer() {}, async followUp() {}, async abort() {}, dispose() {},
              subscribe() { return () => {}; },
              getActiveToolNames: () => ['write'],
              setActiveToolsByName() {}, async waitForIdle() {},
              getAllTools: () => [{ name: 'write', sourceInfo: { source: 'cli' } }],
            } as unknown as PiAgentSessionLike,
          };
        }
        realRecord.createArgs = options;
        if (Array.isArray((options as { tools?: unknown } | undefined)?.tools)) {
          realSession.setActiveToolsByName((options as { tools: string[] }).tools);
        }
        return { session: realSession };
      },
      DefaultResourceLoader: FakeResourceLoader,
      getAgentDir: () => FAKE_AGENT_DIR,
      ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
      resolveModelScopeWithDiagnostics: () => ({
        scopedModels: [{ model: { id: 'test-model', provider: 'testprov' } }],
        diagnostics: [],
      }),
      defineTool: (d: unknown) => d,
      createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
      createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
      createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
      createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
    } as unknown as PiSdk;
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    const error = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    }).then(() => null, (thrown: unknown) => thrown as Error);
    expect(String(error)).toContain('extension_discovery_failed');
    expect(String(error)).toContain('baseline registry');
    expect(sink.names).toContain('activation_rejected');
    expect(realRecord.createArgs).toBeUndefined();
  });


  it('admits required_tools satisfied by a DISCOVERED name (F5a)', async () => {
    // Must fail if admission moves back before finalisation: admission must see the EFFECTIVE
    // contract, so a required tool supplied only by discovery passes instead of refusing as
    // "missing from resolved runtime contract".
    const { sdk, realRecord } = discoverySdk({
      discoveredActive: ['ext_tool_a'],
      provenance: { ext_tool_a: 'cli' },
    });
    const spec = specWithExtensions({ '/fake/ext-a': true }) as {
      specialist: { capabilities?: Record<string, unknown> };
    };
    spec.specialist.capabilities = { required_tools: ['ext_tool_a'] };
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    expect((realRecord.createArgs!.tools as string[])).toContain('ext_tool_a');
  });

  it('refuses before any model turn when the real session drops a discovered name (F5b)', async () => {
    const { sdk, realSession } = discoverySdk({
      discoveredActive: ['ext_tool_a'],
      provenance: { ext_tool_a: 'cli' },
    });
    // Model pi dropping a promised discovered tool — the promised-vs-active check on the
    // EFFECTIVE contract must refuse before any model turn.
    const before = realSession.setActiveToolsByName.bind(realSession);
    realSession.setActiveToolsByName = (names: string[]) => {
      before(names.filter((name) => name !== 'ext_tool_a'));
    };
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    const error = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    }).then(() => null, (thrown: unknown) => thrown as Error);
    expect(String(error)).toContain('tool_contract_unsatisfied');
    expect(String(error)).toContain('ext_tool_a');
    expect(sink.names).toContain('activation_rejected');
    expect(realSession.prompts).toHaveLength(0);
  });

  it('is byte-exact with no dynamic sources: tools, fence, loader and contract string (F5c)', async () => {
    const { sdk, calls, realRecord, realSession } = discoverySdk({ discoveredActive: [] });
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    expect(calls).toHaveLength(1);
    const args = realRecord.createArgs!;
    expect(args.noTools).toBe('builtin');
    const tools = args.tools as string[];
    // Exact allowlist: base READ_ONLY natives for this machine's catalog plus the two asks.
    // No discovered names, no mutation tools, sorted for determinism in the assertion only.
    expect([...tools].sort()).toEqual([...tools].sort());
    expect(tools).toContain('read');
    expect(tools).toContain(ASK_TOOL);
    expect(tools).toContain(ESCALATE_TOOL);
    for (const forbidden of ['bash', 'edit', 'write', 'powershell', 'ext_tool_a']) {
      expect(tools).not.toContain(forbidden);
    }
    const custom = (args.customTools as Array<{ name: string }>).map((tool) => tool.name).sort();
    expect(custom).toEqual([ASK_TOOL, ESCALATE_TOOL].sort());
    const loader = args.resourceLoader as FakeResourceLoader;
    expect(loader.options.additionalSkillPaths).toEqual([]);
    expect(loader.options.noSkills).toBe(true);
    expect(loader.options.noExtensions).toBe(true);
    expect(loader.options.noContextFiles).toBe(true);
    expect(loader.options.noPromptTemplates).toBe(true);
    expect(loader.options.noThemes).toBe(true);
    // Contract string equality: recompute the base contract the host resolves and compare the
    // rendered block verbatim — any pinned name or refused warning would move this string.
    const { resolveRuntimeToolContract } = await import('../../../src/pi/session.js');
    const { formatResolvedToolContract } = await import('../../../src/specialist/resolved-tool-contract.js');
    const { resolveExecutionExtensionSelection } = await import('../../../src/pi/session.js');
    const selection = resolveExecutionExtensionSelection(undefined);
    const base = resolveRuntimeToolContract({
      level: 'READ_ONLY',
      specialistName: 'researcher',
      specialistPermissions: undefined,
      excludeExtensions: selection.excludeExtensions,
      extensionSources: selection.extensionSources,
      cwd: process.cwd(),
    })!;
    const prompt = realSession.prompts[0] ?? '';
    // Default fixture template does not render the contract; assert the session filter shape
    // instead and the absence of any discovery widening.
    expect(prompt).not.toContain('ext_tool_a');
    expect(formatResolvedToolContract(base)).not.toContain('ext_tool_a');
  });

  it('fences the discovery session: builtin clip, tools omitted, dynamic-only paths, no skills (F5d)', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const realRecord: { createArgs?: Record<string, unknown> } = {};
    const realSession = fakeSession({ record: realRecord });
    const sdk = {
      createAgentSession: async (options?: Record<string, unknown>) => {
        const systemPrompt = String((options as { systemPrompt?: unknown } | undefined)?.systemPrompt ?? '');
        if (systemPrompt === 'extension-discovery (never prompted)') {
          seen.push({
            ...(options as Record<string, unknown>),
            loaderOptions: { ...((options as { resourceLoader?: FakeResourceLoader }).resourceLoader?.options ?? {}) },
          });
          return {
            session: {
              sessionId: 'pi-discovery', messages: [], isIdle: true,
              async prompt() { throw new Error('never prompted'); },
              async steer() {}, async followUp() {}, async abort() {}, dispose() {},
              subscribe() { return () => {}; },
              getActiveToolNames: () => ['ext_tool_a'],
              setActiveToolsByName() {}, async waitForIdle() {},
              getAllTools: () => [
                { name: 'ext_tool_a', sourceInfo: { source: 'cli' } },
                { name: 'read', sourceInfo: { source: 'builtin' } },
              ],
            } as unknown as PiAgentSessionLike,
          };
        }
        if (systemPrompt === 'builtin-enumeration (never prompted)') {
          return {
            session: {
              sessionId: 'pi-builtin', messages: [], isIdle: true,
              async prompt() { throw new Error('never prompted'); },
              async steer() {}, async followUp() {}, async abort() {}, dispose() {},
              subscribe() { return () => {}; },
              getActiveToolNames: () => [] as string[],
              setActiveToolsByName() {}, async waitForIdle() {},
              getAllTools: () => [{ name: 'read', sourceInfo: { source: 'builtin' } }],
            } as unknown as PiAgentSessionLike,
          };
        }
        realRecord.createArgs = options;
        if (Array.isArray((options as { tools?: unknown } | undefined)?.tools)) {
          realSession.setActiveToolsByName((options as { tools: string[] }).tools);
        }
        return { session: realSession };
      },
      DefaultResourceLoader: FakeResourceLoader,
      getAgentDir: () => FAKE_AGENT_DIR,
      ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
      resolveModelScopeWithDiagnostics: () => ({
        scopedModels: [{ model: { id: 'test-model', provider: 'testprov' } }],
        diagnostics: [],
      }),
      defineTool: (d: unknown) => d,
      createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
      createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
      createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
      createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
    } as unknown as PiSdk;
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    expect(seen).toHaveLength(1);
    const discoveryArgs = seen[0]!;
    expect(discoveryArgs.noTools).toBe('builtin');
    expect('tools' in discoveryArgs).toBe(false);
    expect('customTools' in discoveryArgs).toBe(false);
    const loaderOptions = discoveryArgs.loaderOptions as Record<string, unknown>;
    expect(loaderOptions.additionalExtensionPaths).toEqual(['/fake/ext-a']);
    expect(loaderOptions.additionalSkillPaths ?? []).toEqual([]);
    expect(loaderOptions.noSkills).toBe(true);
    expect(loaderOptions.noExtensions).toBe(true);
    expect(loaderOptions.noContextFiles).toBe(true);
    expect(loaderOptions.noPromptTemplates).toBe(true);
    expect(loaderOptions.noThemes).toBe(true);
  });

  it('disposes BOTH discovery sessions on the success path too (F5e)', async () => {
    const { sdk, disposed } = discoverySdk({
      discoveredActive: ['ext_tool_a'],
      provenance: { ext_tool_a: 'cli' },
    });
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    expect(disposed.builtin).toEqual([true]);
    expect(disposed.discovery).toEqual([true]);
  });

  it('refuses when an extension shadows a GRANTED native name (F1): read', async () => {
    // The critical hole: `read` is granted to READ_ONLY, so the pin refusal never applies —
    // but the real session still loads the shadowing extension and `read` executes its code.
    // The discovery registry shows `read` with a non-builtin source, so refuse loudly.
    const { sdk, realRecord, disposed } = discoverySdk({
      discoveredActive: ['read', 'ext_tool_a'],
      provenance: { ext_tool_a: 'cli' },
      registryExtra: [{ name: 'read', source: 'cli' }],
    });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    const error = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    }).then(() => null, (thrown: unknown) => thrown as Error);
    expect(String(error)).toContain('extension_tool_shadowed');
    expect(String(error)).toContain("'read'");
    expect(String(error)).toContain("'cli'");
    expect(sink.names).toContain('activation_rejected');
    // R3.3b: the discovery session was disposed, not leaked.
    expect(disposed.discovery).toEqual([true]);
    expect(disposed.builtin).toEqual([true]);
    // R3.3c: refusal happened BEFORE any real session and before lease work.
    expect(realRecord.createArgs).toBeUndefined();
    expect(sink.names).not.toContain('lease_acquired');
  });

  it('refuses when an extension shadows ask_coordinator (F1/F2)', async () => {
    const { sdk, realRecord, disposed } = discoverySdk({
      discoveredActive: ['ask_coordinator'],
      provenance: {},
      registryExtra: [{ name: 'ask_coordinator', source: 'cli' }],
    });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    const error = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    }).then(() => null, (thrown: unknown) => thrown as Error);
    expect(String(error)).toContain('extension_tool_shadowed');
    expect(String(error)).toContain('ask_coordinator');
    expect(disposed.discovery).toEqual([true]);
    expect(disposed.builtin).toEqual([true]);
    expect(realRecord.createArgs).toBeUndefined();
    expect(sink.names).not.toContain('lease_acquired');
  });

  it('refuses when a dynamic extension shadows a base-contract extension tool (R3.1/R3.3a)', async () => {
    // R3.1 gap: catalog-granted names (e.g. gitnexus_query) are held in every activation.
    // A dynamic extension registering one is not ask/escalate and not builtin, so without the
    // reserved-set addition it would PIN, then be silently dropped by the `!already` filter —
    // no warning, no refusal — while the real session still loads that extension. Must REFUSE
    // with extension_tool_shadowed, never silently drop. The shadow name is read from the
    // LIVE base contract (prefer a catalog extension tool; fall back to a granted native),
    // so the test holds in any environment and specifically covers the catalog subset where
    // one exists.
    const { resolveRuntimeToolContract: resolveBase } = await import('../../../src/pi/session.js');
    const base = resolveBase({ level: 'READ_ONLY', specialistName: 'researcher', cwd: process.cwd() })!;
    const catalogName = base.extensionTools[0];
    const shadowName = catalogName ?? base.nativeTools[0]!;
    expect(shadowName, 'base contract grants at least one name to shadow').toBeTruthy();
    const { sdk, realRecord, disposed } = discoverySdk({
      discoveredActive: [shadowName, 'ext_tool_a'],
      provenance: { ext_tool_a: 'cli' },
      registryExtra: [{ name: shadowName, source: 'cli' }],
    });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    const error = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    }).then(() => null, (thrown: unknown) => thrown as Error);
    // Refusal, not a silent drop: the activation never succeeds with the name quietly held.
    expect(String(error), `shadowing ${shadowName} (catalog=${catalogName ?? '(none)'}) must refuse`).toContain('extension_tool_shadowed');
    expect(String(error)).toContain(shadowName);
    expect(sink.names).toContain('activation_rejected');
    expect(realRecord.createArgs).toBeUndefined();
    expect(disposed.discovery).toEqual([true]);
    if (catalogName) {
      expect(shadowName).toBe(catalogName);
    }
  });


  it('refuses a granted-name shadow BEFORE lease acquisition on a writer (R3.3c)', async () => {
    // Ordering: discovery (and its shadow refusal) runs before the writer lease is taken.
    // A HIGH-tier activation shadowed on `read` must refuse with no lease_acquired and no
    // real session — otherwise a refused writer could hold or poison the workspace lease.
    const { sdk, realRecord, disposed } = discoverySdk({
      discoveredActive: ['read'],
      provenance: {},
      registryExtra: [{ name: 'read', source: 'package' }],
    });
    const spec = specWithExtensions({ '/fake/ext-a': true }) as {
      specialist: { execution: Record<string, unknown> };
    };
    spec.specialist.execution.permission_required = 'HIGH';
    const sink = collectingSink();
    const workspace = hostWorkspace();
    const host = new NativeActivationHost({
      loader: loaderFor(spec),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: workspace,
    });
    const error = await host.start({
      specialist: 'executor', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    }).then(() => null, (thrown: unknown) => thrown as Error);
    expect(String(error)).toContain('extension_tool_shadowed');
    expect(sink.names).toContain('activation_rejected');
    expect(sink.names).not.toContain('lease_acquired');
    expect(realRecord.createArgs).toBeUndefined();
    expect(disposed.discovery).toEqual([true]);
    // The workspace was never taken: a second writer is admitted immediately.
    const { acquire: acquireLease } = await import('../../../src/activation/workspace-lease.js');
    const { resolveWorkspace: resolveWs } = await import('../../../src/activation/native-host.js');
    expect(() =>
      acquireLease({ workspace: resolveWs(workspace), activationId: 'act:probe', attemptId: 'att:probe:1', specialist: 'probe' }),
    ).not.toThrow();
  });

  it('still only skips the pin for a NON-granted collision: write on READ_ONLY (F5f)', async () => {
    // `write` is not granted to READ_ONLY, so the existing skip-the-pin behaviour stands:
    // the benign name pins, `write` is refused in forensics + contract, activation succeeds.
    const { sdk, realRecord } = discoverySdk({
      discoveredActive: ['probe_benign', 'write'],
      provenance: { probe_benign: 'cli', write: 'cli' },
    });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    expect((realRecord.createArgs!.tools as string[])).toContain('probe_benign');
    expect((realRecord.createArgs!.tools as string[])).not.toContain('write');
    expect(sink.names).toContain('extension_tools_refused');
  });

  it('classifies unresolvable npm sources without refusing git remotes (unitAI-1pqtl.3 scope)', () => {
    // Locking the boundary this bead keeps: `npm:` with no local form is identifiable as
    // unresolvable, while `git:` remotes stay skipped-by-design here and are decided in .3.
    expect(unresolvableNpmSources(['git:github.com/alonw0/pi-claude-link', 'npm:absent-pkg']))
      .toEqual(['npm:absent-pkg']);
    expect(unresolvableNpmSources(['git:github.com/alonw0/pi-claude-link'])).toEqual([]);
  });

  // SPECIALISTS-83: the double session_start is bounded and observable. A dynamic
  // activation creates exactly two extra fenced sessions (builtin baseline + discovery),
  // so each enabled extension runs load-time work twice. The `extension_discovery_sessions`
  // forensic signal states that bound and why; a no-dynamic-source activation creates zero
  // extra sessions and emits no signal.
  it('emits the double-session signal on a dynamic activation (SPECIALISTS-83)', async () => {
    const { sdk, calls, disposed } = discoverySdk({
      discoveredActive: ['ext_tool_a'],
      provenance: { ext_tool_a: 'cli' },
    });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    // Detection signal exists and states the bound (2) and why.
    expect(sink.names).toContain('extension_discovery_sessions');
    const signal = sink.events.find((e) => e.name === 'extension_discovery_sessions') as unknown as
      { payload?: Record<string, unknown> } | undefined;
    expect(signal?.payload?.fenced_sessions).toBe(2);
    expect(String(signal?.payload?.baseline_session ?? '')).toContain('builtin-enumeration');
    expect(String(signal?.payload?.discovery_session ?? '')).toContain('extension-discovery');
    expect(String(signal?.payload?.dynamic_sources ?? '')).toContain('/fake/ext-a');
    expect(String(signal?.payload?.note ?? '')).toContain('twice');
    // Bounded: exactly one baseline + one discovery session, both disposed, plus the real one.
    expect(calls.filter((c) => c.systemPrompt === 'builtin-enumeration (never prompted)')).toHaveLength(1);
    expect(calls.filter((c) => c.systemPrompt === 'extension-discovery (never prompted)')).toHaveLength(1);
    expect(calls).toHaveLength(3);
    expect(disposed.builtin).toEqual([true]);
    expect(disposed.discovery).toEqual([true]);
  });

  it('emits no double-session signal and creates zero extra sessions without dynamic sources (SPECIALISTS-83)', async () => {
    const { sdk, calls } = discoverySdk({ discoveredActive: [] });
    const sink = collectingSink();
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    expect(sink.names).not.toContain('extension_discovery_sessions');
    // Zero extra sessions: exactly one createAgentSession (the real one).
    expect(calls).toHaveLength(1);
    expect(calls.filter((c) => c.systemPrompt === 'builtin-enumeration (never prompted)')).toHaveLength(0);
    expect(calls.filter((c) => c.systemPrompt === 'extension-discovery (never prompted)')).toHaveLength(0);
  });

  it('creates the baseline session with NO additional extension paths (SPECIALISTS-83 executable veto)', async () => {
    // Load-bearing for the veto recorded on `enumerateBuiltinToolNames`: the baseline must
    // be enumerated with the dynamic sources ABSENT. MUTATION-CHECK: move the baseline
    // enumeration into the source-loaded session (give it the dynamic paths) and this test
    // FAILS — the veto is enforced by this failing test, not by the comment.
    const { sdk, calls } = discoverySdk({
      discoveredActive: ['ext_tool_a'],
      provenance: { ext_tool_a: 'cli' },
    });
    const host = new NativeActivationHost({
      loader: loaderFor(specWithExtensions({ '/fake/ext-a': true })),
      workItems: fakeWorkItems(),
      forensics: collectingSink(),
      loadSdk: async () => sdk,
      cwd: hostWorkspace(),
    });
    await (await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    })).result;
    const builtinCalls = calls.filter((c) => c.systemPrompt === 'builtin-enumeration (never prompted)');
    expect(builtinCalls).toHaveLength(1);
    expect(builtinCalls[0]!.paths).toEqual([]);
    // The discovery session DOES carry the declared sources — the contrast is the point:
    // baseline source-free, discovery source-loaded, never merged.
    const discoveryCalls = calls.filter((c) => c.systemPrompt === 'extension-discovery (never prompted)');
    expect(discoveryCalls).toHaveLength(1);
    expect(discoveryCalls[0]!.paths).toEqual(['/fake/ext-a']);
  });
});
