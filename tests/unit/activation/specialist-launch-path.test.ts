import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { setRuntimeDiagnosticsSink, resetRuntimeDiagnosticsSink } from '../../../src/utils/runtime-diagnostics.js';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/** The same guard the other activation suites use: the native path must never spawn. */
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => {
      throw new Error(`native activation must not spawn a subprocess; got spawn(${String(args[0])})`);
    },
  };
});

import { NativeActivationHost } from '../../../src/activation/native-host.js';
import { testWorkItems } from '../../utils/test-work-items.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';
import type { PiSdk, PiAgentSessionLike, PiAgentSessionEvent } from '../../../src/activation/pi-sdk.js';
import type { IdentityEnvRun } from '../../../src/pi/identity-env.js';

/**
 * CORE-2524.4 and SPECIALISTS-4456 on the NATIVE launch path.
 *
 * #525 gave a native activation its agent identity by writing it to `process.env`, and this
 * file used to pin that channel in detail (F2 stack, N1 re-assert, N3 shutdown, N5 takeover
 * warning, N6 orphan settle). SPECIALISTS-4456 removed the channel: the host process is
 * shared with whoever dispatched the activation, so a Pi worker that dispatched a read-tier
 * Specialist inherited its role and tier and could no longer `git push` ("the reviewer role
 * does not push; no credential is offered"). Two workers lost hours to it.
 *
 * The identity now reaches the activation's OWN shells through the bash tool's `spawnHook`
 * (src/activation/activation-bash-env.ts, wired in createGuardedTools), so the properties
 * this file exists to protect are unchanged: every leg of an activation runs with its own
 * holder and role, `gh` resolves through the shim, and nothing about the activation leaks
 * into the environment of the process that dispatched it — which is now asserted directly,
 * for every leg, instead of being inferred from stack bookkeeping.
 *
 * The legacy CLI-spawn path still hands the child a process-level env; it is pinned in
 * tests/unit/specialist/runner.test.ts ("gives the child a PATH ...").
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

function fakeSession(
  onPrompt?: () => void,
  options: { wait?: Promise<void>; onResume?: () => void; stopReason?: string } = {},
): PiAgentSessionLike {
  const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
  const messages: unknown[] = [];
  const session = {
    sessionId: 'pi-sess-launch-path',
    messages,
    isIdle: true,
    disposed: false,
    activeTools: ['read', 'grep'],
    /** Emit one leg start, as a new leg (fallback/retry/wake) would. */
    emitLegStart() { listeners.forEach(l => l({ type: 'agent_start' })); },
    async prompt() {
      // The runtime tells the host the leg started BEFORE any tool runs, and that is
      // where the host re-asserts identity; captures therefore come after it.
      listeners.forEach(l => l({ type: 'agent_start' }));
      onPrompt?.();
      if (options.wait) {
        // Hold the turn open so two activations can overlap, and let the caller look
        // at process.env from inside the surviving turn after the other one settles.
        await options.wait;
        options.onResume?.();
      }
      messages.push({ role: 'assistant', content: 'done', ...(options.stopReason ? { stopReason: options.stopReason } : {}) });
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

function makeSdk(session: PiAgentSessionLike, bashOptions: unknown[] = []): PiSdk {
  return {
    createAgentSession: async (options?: Record<string, unknown>) => {
      // Model pi's HARD FILTER: the session exposes exactly the tools it was named.
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
    // The host reconstructs bash as a lease-guarded custom tool, and that is the only
    // place the activation's identity can be attached without touching process.env. The
    // recorded options are therefore the assertion surface for this whole file.
    createBashTool: (...factoryArgs: unknown[]) => {
      // Models pi: the factory applies the spawn hook, so the tool object carries it here and
      // a test can ask a SESSION which hook its shell would use.
      const options = factoryArgs[1] as { spawnHook?: unknown } | undefined;
      bashOptions.push(options);
      return { name: 'bash', execute: async () => 'ran', spawnHook: options?.spawnHook };
    },
    createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
  };
}

const shim = join(process.env.HOME ?? homedir(), '.local', 'bin');

const originalPath = process.env.PATH;
beforeEach(() => { process.env.PATH = originalPath; });
afterEach(() => { process.env.PATH = originalPath; });

interface DispatchOptions {
  identityEnvRun?: IdentityEnvRun;
  onPrompt?: () => void;
  /** Grants bash to the contract; without it there is no shell to carry an identity. */
  grantBash?: boolean;
}

async function dispatchOnce(options: DispatchOptions = {}): Promise<{ bashOptions: unknown[] }> {
  const bashOptions: unknown[] = [];
  const host = new NativeActivationHost({
    workItems: testWorkItems({ description: BEAD.description }),
    loader: { get: async () => ({
      specialist: {
        metadata: { name: 'researcher', version: '1.0.0', description: 'd', category: 'c' },
        execution: {
          model: 'testprov/test-model',
          permission_required: 'READ_ONLY',
          response_format: 'text',
          output_type: 'research',
          bare: false,
        },
        prompt: { system: 'You are the researcher.', task_template: 'Do: $bead_id' },
        ...(options.grantBash ? { capabilities: { required_tools: ['bash'] } } : {}),
      },
    }) } as never,
    loadSdk: async () => makeSdk(fakeSession(options.onPrompt), bashOptions),
    identityEnvRun: options.identityEnvRun ?? ((_cmd, _args, opts) => ({
      status: 0,
      stdout: JSON.stringify({
        env: {
          XTRM_ROLE: 'researcher',
          GIT_AUTHOR_NAME: 'sp-researcher',
          GIT_AUTHOR_EMAIL: 'researcher@example.invalid',
          SUBSTRATE_HOLDER: 'from-lookup',
          ...(opts.env?.PROBE_LOOKUP_ENV ? {} : {}),
        },
      }),
    })),
    cwd: process.cwd(),
  });
  const handle = await host.start({
    specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
  });
  await handle.result;
  return { bashOptions };
}

/**
 * The guard is what makes READ_ONLY+bash admissible at all (src/activation/native-host.ts
 * refuses the combination without it), and these tests need a real bash tool in the
 * contract to reach the spawn hook.
 */
const GUARD_KEY = 'SPECIALISTS_PERMISSION_GUARD';
let previousGuard: string | undefined;
beforeAll(() => {
  previousGuard = process.env[GUARD_KEY];
  process.env[GUARD_KEY] = '1';
});
afterAll(() => {
  if (previousGuard === undefined) delete process.env[GUARD_KEY];
  else process.env[GUARD_KEY] = previousGuard;
});

interface SpawnHook {
  spawnHook: (context: {
    command: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
  }) => { command: string; cwd: string; env: NodeJS.ProcessEnv };
}

/** The hooks the host attached to the activation's bash tool, in creation order. */
function hooks(bashOptions: unknown[]): SpawnHook[] {
  return bashOptions.filter(
    (options): options is SpawnHook =>
      Boolean(options) && typeof (options as SpawnHook).spawnHook === 'function',
  );
}

describe('native launch path — the activation identity reaches the shells, not the host (SPECIALISTS-4456)', () => {
  it('gives the activation PATH with the gh shim first, and leaves the host PATH alone', async () => {
    // CORE-2524.4: without the shim first, the activation's `gh` is the real binary and a
    // review posts under the operator identity. SPECIALISTS-4456: that PATH belongs to the
    // activation's shells, not to the dispatcher's process.
    const hostPath = `/usr/bin${delimiter}/bin`;
    process.env.PATH = hostPath;
    const { bashOptions } = await dispatchOnce({ grantBash: true });

    const [hook] = hooks(bashOptions);
    expect(hook).toBeDefined();
    // The inherited PATH is what pi resolved for THIS spawn, which is not the host's: pi
    // prepends its own managed bin directory. Asserting with a context PATH identical to the
    // host's is what let a hook that never touched PATH stay green (review finding 4d).
    const spawnPath = ['/pi/agent/bin', '/usr/bin'].join(delimiter);
    const launched = String(hook!.spawnHook({ command: 'gh pr view 1', cwd: '/w', env: { PATH: spawnPath } }).env.PATH)
      .split(delimiter);
    expect(launched[0]).toBe(shim);
    expect(launched).toContain('/pi/agent/bin');
    expect(launched).toContain('/usr/bin');
    expect(process.env.PATH).toBe(hostPath);
  });

  it('keeps exactly one shim entry when the inherited PATH already starts with it', async () => {
    const hostPath = `${shim}${delimiter}/usr/bin`;
    process.env.PATH = hostPath;
    const { bashOptions } = await dispatchOnce({ grantBash: true });

    const inherited = [shim, '/pi/agent/bin', '/usr/bin'].join(delimiter);
    const launched = String(
      hooks(bashOptions)[0]!.spawnHook({ command: 'true', cwd: '/w', env: { PATH: inherited } }).env.PATH,
    ).split(delimiter);
    expect(launched).toEqual([shim, '/pi/agent/bin', '/usr/bin']);
    expect(process.env.PATH).toBe(hostPath);
  });

  it('carries the activation holder and role in the shell env', async () => {
    const { bashOptions } = await dispatchOnce({ grantBash: true });
    const [hook] = hooks(bashOptions);

    const applied = hook!.spawnHook({
      command: 'gh pr review 1 --approve',
      cwd: '/w',
      env: { SUBSTRATE_HOLDER: 'the-dispatcher', XTRM_ROLE: 'worker' },
    });

    // Derived per activation (`sp-<name>-<activation>`), so a review posts as the App this
    // Specialist's role names — not as whoever dispatched it.
    expect(applied.env.SUBSTRATE_HOLDER).toMatch(/^sp-researcher-[A-Za-z0-9]+$/);
    expect(applied.env.XTRM_ROLE).toBe('researcher');
    expect(applied.command).toBe('gh pr review 1 --approve');
  });

  it('leaves the host process environment byte-identical across a dispatch', async () => {
    const before = { ...process.env };
    const { bashOptions } = await dispatchOnce({ grantBash: true });

    expect(hooks(bashOptions).length).toBeGreaterThan(0);
    expect({ ...process.env }).toEqual(before);
  });
});

describe('native launch path — the host env survives every leg shape (SPECIALISTS-4456)', () => {
  const BEAD_SPEC = {
    specialist: {
      metadata: { name: 'researcher', version: '1.0.0', description: 'd', category: 'c' },
      execution: {
        model: 'testprov/test-model',
        permission_required: 'READ_ONLY',
        response_format: 'text',
        output_type: 'research',
        bare: false,
      },
      prompt: { system: 'You are the researcher.', task_template: 'Do: $bead_id' },
    },
  };

  function hostWith(plan: {
    stopReason?: string;
    wait?: Promise<void>;
    /** One hold per created session, in creation order (the overlap cases). */
    waits?: Array<Promise<void>>;
    throwOnCreate?: boolean;
  } = {}) {
    const created: PiAgentSessionLike[] = [];
    const createdOptions: Array<Record<string, unknown>> = [];
    let sessionIndex = 0;
    const bashOptions: unknown[] = [];
    const sdk = {
      ...makeSdk(fakeSession(), bashOptions),
      createAgentSession: async (options?: Record<string, unknown>) => {
        if (plan.throwOnCreate) throw new Error('sdk refused');
        const wait = plan.waits?.[sessionIndex] ?? plan.wait;
        sessionIndex += 1;
        const session = fakeSession(undefined, { wait, stopReason: plan.stopReason });
        if (Array.isArray(options?.tools)) session.getActiveToolNames = () => options!.tools as string[];
        created.push(session);
        createdOptions.push(options ?? {});
        return { session };
      },
    } as PiSdk;
    const host = new NativeActivationHost({
      workItems: testWorkItems({ description: BEAD.description }),
      loader: { get: async () => BEAD_SPEC } as never,
      loadSdk: async () => sdk,
      identityEnvRun: () => ({
        status: 0,
        stdout: JSON.stringify({ env: { XTRM_ROLE: 'researcher', GIT_AUTHOR_NAME: 'sp-researcher' } }),
      }),
      cwd: process.cwd(),
    });
    return { host, created, createdOptions, bashOptions };
  }

  const dispatch = (host: NativeActivationHost) =>
    host.start({ specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator' });

  /**
   * One host, two Specialists, one hold per created session. The loader answers by name, so
   * each activation resolves its own role — which is what makes the isolation assertion
   * meaningful rather than a comparison of two equal strings.
   */
  function hostWithTwoSpecialists(waits: Array<Promise<void>>) {
    const bashOptions: unknown[] = [];
    let sessionIndex = 0;
    const sdk = {
      ...makeSdk(fakeSession(), bashOptions),
      createAgentSession: async (options?: Record<string, unknown>) => {
        const session = fakeSession(undefined, { wait: waits[sessionIndex] });
        sessionIndex += 1;
        if (Array.isArray(options?.tools)) session.getActiveToolNames = () => options!.tools as string[];
        return { session };
      },
    } as PiSdk;
    const host = new NativeActivationHost({
      workItems: testWorkItems({ description: BEAD.description }),
      loader: {
        get: async (name: string) => ({
          ...BEAD_SPEC,
          specialist: { ...BEAD_SPEC.specialist, metadata: { ...BEAD_SPEC.specialist.metadata, name } },
        }),
      } as never,
      loadSdk: async () => sdk,
      identityEnvRun: () => ({
        status: 0,
        stdout: JSON.stringify({ env: { GIT_AUTHOR_NAME: 'sp-agent' } }),
      }),
      cwd: process.cwd(),
    });
    return { host, bashOptions };
  }

  it('a failed session creation leaves the host env untouched', async () => {
    const before = { ...process.env };
    const { host } = hostWith({ throwOnCreate: true });
    await dispatch(host).catch(() => undefined);
    expect({ ...process.env }).toEqual(before);
  });

  /** The bash custom tool this session was built with, if any. */
  const sessionBashHook = (options: Record<string, unknown>): SpawnHook | undefined => {
    const customTools = (options.customTools ?? []) as Array<{ name?: string; spawnHook?: SpawnHook['spawnHook'] }>;
    const bash = customTools.find((tool) => tool?.name === 'bash');
    if (!bash?.spawnHook) return undefined;
    return { spawnHook: bash.spawnHook };
  };

  it('gives every attempt the same hooked bash tool, so no leg can lose the identity', async () => {
    // The structural property the deleted N1 test existed for: the tools are built ONCE per
    // dispatch and every session — first, fallback/retry, wake, resume — is created from that
    // same array. Asserting the hook on one session would pass even if a later attempt built
    // its own tools without it (review finding 4a).
    const before = { ...process.env };
    const { host, createdOptions, bashOptions } = hostWith({ stopReason: 'error' });
    const a = await dispatch(host);
    await a.result;
    const retried = await host.retry(a.activationId, { modelOverride: 'testprov/other-model' });
    await retried.result;

    expect(createdOptions.length).toBeGreaterThanOrEqual(2);
    const hookObjects = createdOptions.map((options) => sessionBashHook(options));
    expect(hookObjects.every((hook) => hook !== undefined)).toBe(true);
    // Same tool, same overlay: identities cannot differ between attempts of one activation.
    const holders = new Set(hookObjects.map((hook) =>
      hook!.spawnHook({ command: 'true', cwd: '/w', env: {} }).env.SUBSTRATE_HOLDER));
    expect(holders.size).toBe(1);
    expect([...holders][0]).toMatch(/^sp-researcher-/);
    // Built once, not once per attempt.
    expect(hooks(bashOptions)).toHaveLength(1);
    expect({ ...process.env }).toEqual(before);
  });

  it('keeps the hooked bash tool across a background wake turn', async () => {
    const before = { ...process.env };
    const { host, created, createdOptions } = hostWith();
    const a = await dispatch(host);
    await a.result;
    const sessionsBeforeWake = createdOptions.length;

    await created[0].prompt();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    // A wake turn runs on the settled session, so the identity must still be on its tools.
    expect(createdOptions.length).toBe(sessionsBeforeWake);
    const hook = sessionBashHook(createdOptions[0]!)!;
    expect(hook.spawnHook({ command: 'true', cwd: '/w', env: {} }).env.SUBSTRATE_HOLDER).toMatch(/^sp-researcher-/);
    expect({ ...process.env }).toEqual(before);
  });

  it('keeps the hooked bash tool after a resume, which returns the live session', async () => {
    const before = { ...process.env };
    const { host, created, createdOptions } = hostWith();
    const a = await dispatch(host);
    await a.result;

    const resumed = await host.resume(a.activationId, 'keep going');
    await resumed.result;

    expect(createdOptions.length).toBe(1);
    const hook = sessionBashHook(createdOptions[0]!)!;
    expect(hook.spawnHook({ command: 'true', cwd: '/w', env: {} }).env.XTRM_ROLE).toBe('researcher');
    expect({ ...process.env }).toEqual(before);
  });

  it('two overlapping activations leave the host env untouched, whichever settles first', async () => {
    // The old channel gave the process env to the activation that most recently started a
    // leg, so an overlapping pair swapped identities mid-run and warned about it. Now each
    // activation's shells carry their own env, and the process env is nobody's.
    const before = { ...process.env };
    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    const gateB = new Promise<void>((resolve) => { releaseB = resolve; });
    // Two DIFFERENT specialists, so the identities differ by role as well as by holder: a
    // fallback to process.env would give both hooks the last applied role, and this is the
    // assertion that turns red (SPECIALISTS-4427 SUCCESS 4).
    const { host, bashOptions } = hostWithTwoSpecialists([gateA, gateB]);

    const a = await dispatch(host);
    const b = await host.start({ specialist: 'advisor', issueRef: 'ISSUE-2', requestedByParticipantId: 'coordinator' });

    const applied = hooks(bashOptions).map((hook) =>
      hook.spawnHook({ command: 'gh pr view 1', cwd: '/w', env: {} }).env);
    expect(applied.map((env) => env.XTRM_ROLE).sort()).toEqual(['advisor', 'researcher']);
    expect(applied.map((env) => env.SUBSTRATE_HOLDER).filter((holder, index, all) => all.indexOf(holder) === index)).toHaveLength(2);

    releaseB();
    await b.result;
    expect({ ...process.env }).toEqual(before);
    releaseA();
    await a.result;
    expect({ ...process.env }).toEqual(before);
  });

  it('stop() leaves the host env untouched even though abort() settles nothing', async () => {
    const before = { ...process.env };
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const { host } = hostWith({ wait });

    const a = await dispatch(host);
    await host.stop(a.activationId, 'test');
    expect({ ...process.env }).toEqual(before);
    release();
    await a.result.catch(() => undefined);
    expect({ ...process.env }).toEqual(before);
  });

  it('emits no identity takeover warning, because nothing takes the env over', async () => {
    // The N5 warning existed because two live activations shared one process env. That is
    // gone; a warning here would mean the old channel came back.
    const lines: string[] = [];
    setRuntimeDiagnosticsSink((line) => { lines.push(line); });
    try {
      const { host } = hostWith();
      const a = await dispatch(host);
      await a.result;
    } finally {
      resetRuntimeDiagnosticsSink();
    }
    expect(lines.filter((line) => line.includes('identity-env'))).toEqual([]);
  });
});
