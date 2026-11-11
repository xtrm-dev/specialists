import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
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
import { snapshotIdentityEnv, type IdentityEnvRun } from '../../../src/pi/identity-env.js';

/**
 * CORE-2524.4 on the NATIVE launch path. #525 gave a native activation its agent
 * identity on process.env; this proves the same activation also gets PATH with the
 * gh shim directory first. Without it the activation's `gh` resolves through the
 * host PATH, may be the real binary, and a pr-reviewer review posts under the
 * operator identity. The legacy path is pinned in
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

function fakeSession(onPrompt?: () => void): PiAgentSessionLike {
  const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
  const messages: unknown[] = [];
  const session = {
    sessionId: 'pi-sess-launch-path',
    messages,
    isIdle: true,
    disposed: false,
    activeTools: ['read', 'grep'],
    async prompt() {
      onPrompt?.();
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

function makeSdk(session: PiAgentSessionLike): PiSdk {
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
    createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
    createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
  };
}

const shim = join(process.env.HOME ?? homedir(), '.local', 'bin');

const originalPath = process.env.PATH;
beforeEach(() => { process.env.PATH = originalPath; });
afterEach(() => { process.env.PATH = originalPath; });

async function dispatchOnce(
  options: { identityEnvRun?: IdentityEnvRun; onPrompt?: () => void } = {},
): Promise<void> {
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
      },
    }) } as never,
    loadSdk: async () => makeSdk(fakeSession(options.onPrompt)),
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
}

describe('native launch path — the Specialist PATH starts at the gh shim (CORE-2524.4)', () => {
  it('prepends the shim directory when the host PATH does not contain it', async () => {
    process.env.PATH = `/usr/bin${delimiter}/bin`;
    await dispatchOnce();

    const launched = String(process.env.PATH).split(delimiter);
    expect(launched[0]).toBe(shim);
    expect(launched).toContain('/usr/bin');
    expect(launched).toContain('/bin');
  });

  it('keeps exactly one shim entry when the host PATH already starts with it', async () => {
    process.env.PATH = `${shim}${delimiter}/usr/bin`;
    await dispatchOnce();

    const launched = String(process.env.PATH).split(delimiter);
    expect(launched).toEqual([shim, '/usr/bin']);
    expect(launched.filter((dir) => dir === shim)).toHaveLength(1);
  });
});

/**
 * MEDIUM F2: the identity rides `process.env` because an in-process activation has no
 * child env. Two consequences are pinned here — a smaller answer must not inherit a
 * bigger one's keys, and the host gets its own env back when the activation settles.
 * Concurrent activations still race on `process.env`; that needs a per-session env on
 * the SDK and is not solved in this class.
 */
describe('native launch path — the activation owns process.env only while it runs', () => {
  const gitConfigKeys = (): string[] =>
    Object.keys(snapshotIdentityEnv(process.env)).filter((key) => key.startsWith('GIT_CONFIG_'));

  const answer = (pairs: Array<[string, string]>): IdentityEnvRun => () => ({
    status: 0,
    stdout: JSON.stringify({
      env: Object.fromEntries([
        ['GIT_CONFIG_COUNT', String(pairs.length)],
        ...pairs.flatMap(([key, value], index) => [
          [`GIT_CONFIG_KEY_${index}`, key],
          [`GIT_CONFIG_VALUE_${index}`, value],
        ]),
      ]),
    }),
  });

  it('a second activation with a smaller answer carries none of the first one keys', async () => {
    let firstDuring: string[] = [];
    await dispatchOnce({
      onPrompt: () => { firstDuring = gitConfigKeys(); },
      identityEnvRun: answer([
        ['url.https://github.com/.insteadOf', 'git@github.com:'],
        ['credential.https://github.com.useHttpPath', 'true'],
      ]),
    });
    expect(firstDuring).toContain('GIT_CONFIG_KEY_1');

    // A key left on the env by an earlier run is the shape the clear-before-apply
    // rule exists for: without it the next activation inherits it silently.
    process.env.GIT_CONFIG_KEY_7 = 'stale-key';
    process.env.GIT_CONFIG_VALUE_7 = 'stale-value';
    let secondDuring: string[] = [];
    try {
      await dispatchOnce({
        onPrompt: () => { secondDuring = gitConfigKeys(); },
        identityEnvRun: answer([['url.https://github.com/.insteadOf', 'git@github.com:']]),
      });
    } finally {
      delete process.env.GIT_CONFIG_KEY_7;
      delete process.env.GIT_CONFIG_VALUE_7;
    }

    expect(secondDuring).toContain('GIT_CONFIG_KEY_0');
    // The first answer's second pair is gone, not layered under the smaller count,
    // and the stale key from before this activation is gone too.
    expect(secondDuring).not.toContain('GIT_CONFIG_KEY_1');
    expect(secondDuring).not.toContain('GIT_CONFIG_VALUE_1');
    expect(secondDuring).not.toContain('GIT_CONFIG_KEY_7');
    expect(secondDuring).not.toContain('GIT_CONFIG_VALUE_7');
  });

  it('gives the host its own identity env back when the activation settles', async () => {
    const before = snapshotIdentityEnv(process.env);
    let holderDuringTurn: string | undefined;
    await dispatchOnce({
      onPrompt: () => { holderDuringTurn = process.env.SUBSTRATE_HOLDER; },
    });

    expect(holderDuringTurn).toMatch(/^sp-researcher-/);
    expect(holderDuringTurn).not.toBe(before.SUBSTRATE_HOLDER);
    // Every managed key is back exactly as it was: no author, no transport left behind.
    expect(snapshotIdentityEnv(process.env)).toEqual(before);
  });

  it('re-applies the identity on resume, because settle took it away', async () => {
    const holdersDuringTurns: Array<string | undefined> = [];
    const before = snapshotIdentityEnv(process.env);
    const host = new NativeActivationHost({
      workItems: testWorkItems({ description: BEAD.description }),
      loader: { get: async () => ({
        specialist: {
          metadata: { name: 'researcher', version: '1.0.0', description: 'd', category: 'c' },
          execution: {
            model: 'testprov/test-model', permission_required: 'READ_ONLY', response_format: 'text',
            output_type: 'research', bare: false,
          },
          prompt: { system: 'You are the researcher.', task_template: 'Do: $bead_id' },
        },
      }) } as never,
      loadSdk: async () => makeSdk(fakeSession(() => { holdersDuringTurns.push(process.env.SUBSTRATE_HOLDER); })),
      identityEnvRun: () => ({ status: 0, stdout: JSON.stringify({ env: { XTRM_ROLE: 'researcher' } }) }),
      cwd: process.cwd(),
    });
    const handle = await host.start({ specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator' });
    await handle.result;
    expect(snapshotIdentityEnv(process.env)).toEqual(before);

    const resumed = await host.resume(handle.activationId, 'keep going');
    await resumed.result;

    // Both turns ran under the activation's holder. Without the resume apply the
    // second one would carry the host's (restored) holder and run as the operator.
    expect(holdersDuringTurns).toHaveLength(2);
    for (const holder of holdersDuringTurns) expect(holder).toMatch(/^sp-researcher-/);
    expect(snapshotIdentityEnv(process.env)).toEqual(before);
  });
});
