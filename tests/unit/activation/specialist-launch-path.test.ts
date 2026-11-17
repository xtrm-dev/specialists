import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { setRuntimeDiagnosticsSink, resetRuntimeDiagnosticsSink } from '../../../src/utils/runtime-diagnostics.js';
import { homedir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tempDir } from '../../utils/temp-dir.js';

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

import { NativeActivationHost, uncoveredHostEnvSpawns } from '../../../src/activation/native-host.js';
import { testWorkItems } from '../../utils/test-work-items.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';
import type { PiSdk, PiAgentSessionLike, PiAgentSessionEvent } from '../../../src/activation/pi-sdk.js';
import type { IdentityEnvRun } from '../../../src/pi/identity-env.js';
import type { DispatcherIdentity } from '../../../src/activation/dispatcher-identity.js';

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
    async prompt() {
      // The runtime tells the host the leg started BEFORE any tool runs.
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
  /** The one dispatcher value this dispatch carries to both sinks (SPECIALISTS-4503). */
  dispatcher?: DispatcherIdentity;
  /** `null` omits the legacy requested_by field, so the dispatcher is the only value. */
  requestedBy?: string | null;
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
        },
      }),
    })),
    cwd: process.cwd(),
  });
  const requestedBy = options.requestedBy === undefined ? 'coordinator' : options.requestedBy;
  const handle = await host.start({
    specialist: 'researcher', issueRef: 'ISSUE-1',
    ...(requestedBy ? { requestedByParticipantId: requestedBy } : {}),
    ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
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

});

describe('a contract that grants a host-env-spawning tool says so (SPECIALISTS-4487)', () => {
  it('names the granted tools whose children the activation identity cannot reach', () => {
    // python is granted only at MEDIUM/HIGH (config/catalog/python-kernel.json), and its
    // interpreter is spawned from the host env, so a kernel subprocess runs as the dispatcher.
    // The predicate is the whole rule; the dispatch calls it and warns once.
    expect(uncoveredHostEnvSpawns(['read', 'python', 'bash'])).toEqual(['python']);
    expect(uncoveredHostEnvSpawns(['read', 'grep', 'bash'])).toEqual([]);
    expect(uncoveredHostEnvSpawns([])).toEqual([]);
  });

  it('is what the dispatch warns on, once, before the first turn', () => {
    // The warning itself cannot be driven end to end from this worktree: `python` reaches the
    // contract only when the python-kernel extension package resolves (config/catalog/
    // python-kernel.json grants it at MEDIUM/HIGH), and the package is not installed here, so
    // a MEDIUM dispatch refuses `required_tools: python` at preflight. The rule is the whole
    // condition the dispatch fires on, and the dispatch calls it exactly once, before the
    // session exists (src/activation/native-host.ts, next to createGuardedTools).
    const granted = uncoveredHostEnvSpawns(['read', 'grep', 'python', 'bash']);
    expect(granted).toEqual(['python']);
  });
});

describe('native launch path — a lead-launched Specialist exports its own role (CORE-2722)', () => {
  it('puts its own role and name on the shell env and drops the host dispatcher when none is known', async () => {
    const { bashOptions } = await dispatchOnce({ grantBash: true });
    const [hook] = hooks(bashOptions);

    const applied = hook!.spawnHook({
      command: 'echo',
      cwd: '/w',
      env: {
        XTMUX_AGENT_ROLE: 'lead',
        SUBSTRATE_HOLDER: 'MMD-4418-serving-lead-2',
        XTRM_AGENT_NAME: 'market-data-xt-claude-MMD-4418-serving-lead',
        // The host's own dispatcher — the GRANDPARENT. It must never reach this child.
        XTRM_DISPATCHER_NAME: 'market-data-xt-claude-MMD-4418-serving-lead',
      },
    });

    expect(applied.env.XTMUX_AGENT_ROLE).toBe('researcher');
    expect(applied.env.SUBSTRATE_HOLDER).toMatch(/^sp-researcher-[A-Za-z0-9]+$/);
    // The holder names the activation in attribution; the lead's agent name must not outrank it.
    expect(applied.env.XTRM_AGENT_NAME).toBe(applied.env.SUBSTRATE_HOLDER);
    expect(applied.env).not.toHaveProperty('XTRM_DISPATCHER_NAME');
  });
});

describe('native launch path — one dispatcher value per dispatch (SPECIALISTS-4503)', () => {
  const HOST = {
    XTRM_DISPATCHER_PARTICIPANT: 'sp-grandparent',
    XTRM_DISPATCHER_NAME: 'grandparent',
    XTRM_DISPATCHER_ADDRESS: 'uds:/grandparent.sock',
  };

  it('puts the dispatch’s invoker on the shell env over the host’s own dispatcher', async () => {
    const { bashOptions } = await dispatchOnce({
      grantBash: true,
      dispatcher: { participant: 'sp-lead-1', name: 'serving-lead', address: 'uds:/lead.sock' },
    });
    const [hook] = hooks(bashOptions);

    const applied = hook!.spawnHook({ command: 'echo', cwd: '/w', env: HOST });

    expect(applied.env.XTRM_DISPATCHER_PARTICIPANT).toBe('sp-lead-1');
    expect(applied.env.XTRM_DISPATCHER_NAME).toBe('serving-lead');
    expect(applied.env.XTRM_DISPATCHER_ADDRESS).toBe('uds:/lead.sock');
  });

  it('deletes every inherited dispatcher key when the value is unknown', async () => {
    const { bashOptions } = await dispatchOnce({ grantBash: true, requestedBy: null });
    const [hook] = hooks(bashOptions);

    const applied = hook!.spawnHook({ command: 'echo', cwd: '/w', env: HOST });

    for (const key of Object.keys(HOST)) expect(applied.env).not.toHaveProperty(key);
  });
});

describe('native launch path — a lead-dispatched bridged activation\'s Claude Code child (SPECIALISTS-4498)', () => {
  // pi-claude-bridge spawns the child with `ccChildEnv(options.env)`: the HOST env with the
  // request's provider env laid over it. pi resolves that provider env from the session's
  // ModelRuntime (`prepareRequest` → `getAuth(model).env`), so the runtime the host gave the
  // session is the assertion surface: what it resolves for a claude-bridge request is what the
  // child carries over the lead's process env.
  const LEAD = {
    XTMUX_AGENT_ROLE: 'lead',
    SUBSTRATE_HOLDER: 'MMD-4418-serving-lead-2',
    XTRM_AGENT_NAME: 'market-data-xt-claude-MMD-4418-serving-lead',
  };
  const touched = [...Object.keys(LEAD), 'XDG_CONFIG_HOME', 'SPECIALISTS_CLAUDE_BRIDGE_PATH'];
  let saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved = Object.fromEntries(touched.map((key) => [key, process.env[key]]));
    Object.assign(process.env, LEAD);
    // Both halves of the route: the operator switch and an installed extension entry.
    const dir = tempDir('bridge-child-env-');
    mkdirSync(join(dir, 'specialists'), { recursive: true });
    writeFileSync(join(dir, 'specialists', 'user.json'), JSON.stringify({ claude_bridge: { enabled: true } }));
    writeFileSync(join(dir, 'bridge.js'), 'export default () => {};\n');
    process.env.XDG_CONFIG_HOME = dir;
    process.env.SPECIALISTS_CLAUDE_BRIDGE_PATH = join(dir, 'bridge.js');
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function dispatchBridged(opts: { getAuth?: boolean; identityEnv?: Record<string, string>; onWarn?: (line: string) => void } = {}) {
    const runtime = {
      hasConfiguredAuth: () => true,
      // A stored credential's env, which the activation identity must sit on top of.
      getAuth: async (providerOrModel: string | { provider?: string }) => ({
        auth: { apiKey: 'not-used' },
        env: { ANTHROPIC_BASE_URL: `https://proxy.example.invalid/${typeof providerOrModel === 'string' ? providerOrModel : providerOrModel.provider}` },
      }),
    };
    // A runtime without `getAuth`, as an old test double or an older pi has.
    if (opts.getAuth === false) delete (runtime as { getAuth?: unknown }).getAuth;
    const created: Array<Record<string, unknown> | undefined> = [];
    const base = makeSdk(fakeSession());
    const sdk: PiSdk = {
      ...base,
      createAgentSession: async (options) => { created.push(options); return base.createAgentSession(options); },
      ModelRuntime: { create: async () => runtime },
      resolveModelScopeWithDiagnostics: () => ({
        scopedModels: [{ model: { id: 'claude-opus-5-5', provider: 'claude-bridge', api: 'claude-bridge' } }],
        diagnostics: [],
      }),
    };
    const host = new NativeActivationHost({
      workItems: testWorkItems({ description: BEAD.description }),
      loader: { get: async () => ({
        specialist: {
          metadata: { name: 'researcher', version: '1.0.0', description: 'd', category: 'c' },
          execution: {
            model: 'claude-bridge/claude-opus-5-5',
            claude_bridge: true,
            permission_required: 'READ_ONLY',
            response_format: 'text',
            output_type: 'research',
            bare: false,
          },
          prompt: { system: 'You are the researcher.', task_template: 'Do: $bead_id' },
        },
      }) } as never,
      loadSdk: async () => sdk,
      identityEnvRun: () => ({
        status: 0,
        stdout: JSON.stringify({ env: { XTRM_ROLE: 'researcher', SUBSTRATE_HOLDER: 'from-lookup', ...(opts.identityEnv ?? {}) } }),
      }),
      cwd: process.cwd(),
    });
    // The host installs its own file-backed sink when it is built; capture after that.
    if (opts.onWarn) setRuntimeDiagnosticsSink(opts.onWarn);
    const handle = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    const result = await handle.result;
    return { runtime, created, result };
  }

  it('puts the activation identity on the child env over the lead values, and leaves the host env alone', async () => {
    const before = { ...process.env };
    const { runtime, created, result } = await dispatchBridged();

    expect(result.status).toBe('completed');
    // The session runs on the runtime the host scoped, not on one pi builds for itself.
    expect(created.at(-1)?.modelRuntime).toBe(runtime);
    const resolution = await runtime.getAuth({ provider: 'claude-bridge' }) as { env: Record<string, string> };
    // ccChildEnv: provider env over the host env.
    const child = { ...process.env, ...resolution.env };
    expect(child.XTMUX_AGENT_ROLE).toBe('researcher');
    expect(child.SUBSTRATE_HOLDER).toMatch(/^sp-researcher-[A-Za-z0-9]+$/);
    expect(child.XTRM_AGENT_NAME).toBe(child.SUBSTRATE_HOLDER);
    expect(child.XTRM_ROLE).toBe('researcher');
    // SPECIALISTS-4503: the same dispatcher value reaches the bridged child. The empty
    // name/address are DELETES for ccChildEnv, so the host's inherited values cannot survive.
    expect(resolution.env.XTRM_DISPATCHER_PARTICIPANT).toBe('coordinator');
    expect(resolution.env.XTRM_DISPATCHER_NAME).toBe('');
    expect(resolution.env.XTRM_DISPATCHER_ADDRESS).toBe('');
    // The operator's credential env survives under the identity.
    expect(child.ANTHROPIC_BASE_URL).toBe('https://proxy.example.invalid/claude-bridge');
    // pi-claude-bridge throws on these, so they must never ride the provider env.
    expect(Object.keys(resolution.env).filter((key) => ['HOME', 'USERPROFILE', 'CLAUDE_CONFIG_DIR', 'PATH'].includes(key)))
      .toEqual([]);
    // Byte-identical host env: the lead keeps its own identity.
    expect({ ...process.env }).toEqual(before);
    expect(process.env.XTMUX_AGENT_ROLE).toBe('lead');
  });

  describe('what the dispatch says when the identity cannot reach the child', () => {
    const lines: string[] = [];
    const onWarn = (line: string) => { lines.push(line); };
    beforeEach(() => { lines.length = 0; });
    afterEach(() => { resetRuntimeDiagnosticsSink(); });

    it('warns once when the model runtime has no getAuth to scope', async () => {
      const { result } = await dispatchBridged({ getAuth: false, onWarn });
      expect(result.status).toBe('completed');
      const warned = lines.filter((line) => line.includes('cannot carry a provider env'));
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('SPECIALISTS-4498');
    });

    it('warns when the git credential-helper reset cannot ride the provider env, and still scopes the rest', async () => {
      const { runtime } = await dispatchBridged({
        identityEnv: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '' },
        onWarn,
      });
      const warned = lines.filter((line) => line.includes('git credential-helper reset'));
      expect(warned).toHaveLength(1);
      const resolution = await runtime.getAuth({ provider: 'claude-bridge' }) as { env: Record<string, string> };
      expect(resolution.env.XTMUX_AGENT_ROLE).toBe('researcher');
      expect(Object.keys(resolution.env).filter((key) => key.startsWith('GIT_CONFIG_'))).toEqual([]);
    });

    it('says nothing when the identity travels whole', async () => {
      await dispatchBridged({ onWarn });
      expect(lines.filter((line) => line.includes('SPECIALISTS-4498'))).toEqual([]);
    });
  });

  it('scopes only claude-bridge requests on that runtime', async () => {
    const { runtime } = await dispatchBridged();
    const other = await runtime.getAuth({ provider: 'anthropic' }) as { env: Record<string, string> };
    expect(other.env).toEqual({ ANTHROPIC_BASE_URL: 'https://proxy.example.invalid/anthropic' });
  });
});
