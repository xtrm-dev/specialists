import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * S1 settlement publication (XTRM-252.8 / ADR §§37–40, §94, §97).
 *
 * Every test drives a live `NativeActivationHost.start()` and awaits the
 * activation result WITHOUT calling any publication API: publication is
 * automatic and host-driven (ADR §38), so a test that had to publish
 * explicitly could not prove the contract. The fake boundary below records
 * what the host published through the existing Substrate seam; the memory
 * settlement store records the runtime leg.
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
import type { PiSdk, PiAgentSessionLike, PiAgentSessionEvent } from '../../../src/activation/pi-sdk.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';
import type {
  SettlementResultInput,
  SpecialistWorkItemBoundary,
  WorkItemView,
  WorkReceiptView,
} from '../../../src/activation/workitem-store.js';
import { createMemorySettlementStore } from '../../../src/activation/settlement-store.js';
import {
  buildBoundedResult,
  buildSettlementExecutionContext,
  SUMMARY_MAX,
} from '../../../src/activation/settlement-publication.js';

/** Closed Journal result field set — mirrors RESULT_FIELDS (substrate@a77d094). */
const CLOSED_RESULT_FIELDS = new Set([
  'summary', 'resultVersion', 'attempted', 'outcome', 'completed', 'validation',
  'findings', 'artifactRefs', 'receiptRefs', 'provenanceRefs',
]);

const BASE_COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

interface ScriptedTurn {
  /** First prompt settles the turn as failed; later prompts succeed. */
  failFirst?: boolean;
  text?: string;
}

/** Fake Pi session. `prompt()` settles the turn synchronously per script. */
function fakeSession(
  record: { createArgs?: Record<string, unknown> },
  script: ScriptedTurn & { oversized?: number } = {},
): PiAgentSessionLike & { prompts: string[] } {
  const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
  const messages: unknown[] = [];
  let prompts = 0;
  const session = {
    sessionId: 'pi-sess-s1',
    messages,
    isIdle: true,
    activeTools: ['read', 'grep'],
    async prompt(text: string) {
      (session as { prompts: string[] }).prompts.push(text);
      prompts += 1;
      listeners.forEach((l) => l({ type: 'agent_start' }));
      if (script.failFirst && prompts === 1) {
        messages.push({ role: 'assistant', content: '', stopReason: 'error', errorMessage: 'provider 429 rate_limited' });
      } else {
        const body = script.oversized ? 'X'.repeat(script.oversized) : (script.text ?? 'finding: the cache key omits the tenant');
        messages.push({ role: 'assistant', content: body });
      }
      listeners.forEach((l) => l({ type: 'agent_end', willRetry: false }));
      listeners.forEach((l) => l({ type: 'agent_settled' }));
    },
    async steer() {}, async followUp() {}, async abort() {},
    dispose() {},
    subscribe(l: (e: PiAgentSessionEvent) => void) {
      listeners.push(l);
      return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
    },
    getActiveToolNames: () => session.activeTools,
    setActiveToolsByName(names: string[]) { session.activeTools = names; },
    async waitForIdle() {},
    prompts: [] as string[],
  };
  return session as unknown as PiAgentSessionLike & { prompts: string[] };
}

function makeSdk(record: { createArgs?: Record<string, unknown> }, session: PiAgentSessionLike): PiSdk {
  return {
    createAgentSession: async (options?: Record<string, unknown>) => {
      record.createArgs = options;
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
}

interface JournalCall {
  ref: string;
  input: SettlementResultInput;
  entryId: string;
  sequence: number;
}
interface ReceiptCall extends WorkReceiptView {
  attached: Array<{ kind: string; value: string }>;
}

/** In-memory Substrate seam: records every settlement write the host makes. */
function fakeWorkItems() {
  const journal: JournalCall[] = [];
  const receipts: ReceiptCall[] = [];
  let receiptCounter = 0;
  const boundary: SpecialistWorkItemBoundary = {
    view(ref: string): WorkItemView {
      return {
        ref,
        issueId: `iss_${ref}`,
        revision: 1,
        contractHash: 'hash-test',
        title: 'Investigate the cache key',
        contract: {
          problem: 'The cache key omits the tenant.',
          success: 'A written finding names the fix.',
          scope: ['Investigate the cache key.'],
          nonGoals: ['Does not fix the cache.'],
          constraints: ['Read-only.'],
          validation: [{ check: 'A written finding.' }],
          output: [{ artifact: 'A finding.' }],
        },
        readinessState: 'claimed',
        dispatchable: true,
        reasons: [],
      };
    },
    epicAncestors: () => [],
    completedBlockers: () => [],
    check() {
      return { issueId: 'iss_XTRM-1', revision: 1, contractHash: 'hash-test', report: {} as never };
    },
    bind() {
      return {
        id: 'exb_s1', issueId: 'iss_XTRM-1', issueRevision: 1, contractHash: 'hash-test',
        claimId: 1, participantId: 'specialist::researcher',
        activationId: 'act-x', attemptId: 'att-x:1', sessionId: 'pi-sess-s1',
        workspace: '/tmp/s1', baseCommit: BASE_COMMIT, createdAt: Date.now(),
      } as never;
    },
    inlineCreate: () => ({ ref: 'ISSUE-INLINE', issueId: 'iss_inline', claimId: 1 }),
    journal: () => {},
    appendResult(ref: string, input: SettlementResultInput) {
      const entry = { ref, input, entryId: `jent_${journal.length + 1}`, sequence: journal.length + 1 };
      journal.push(entry);
      return { entryId: entry.entryId, sequence: entry.sequence };
    },
    allocateReceipt(bindingId: string): WorkReceiptView {
      receiptCounter += 1;
      const receipt: ReceiptCall = {
        id: `wr_s1_${receiptCounter}`,
        executionBindingId: bindingId,
        issueId: 'iss_XTRM-1',
        issueRevision: 1,
        contractHash: 'hash-test',
        attached: [],
      };
      receipts.push(receipt);
      return receipt;
    },
    attachArtifact(receiptId: string, kind: string, value: string) {
      // Parity with the real provenance service: commits go through bindCommit
      // only, so a settlement path attaching one is a contract violation.
      if (kind === 'commit') throw new Error('use bindCommit for commit SHAs (SHA-validated finalization)');
      const receipt = receipts.find((r) => r.id === receiptId);
      if (!receipt) throw new Error(`unknown receipt: ${receiptId}`);
      receipt.attached.push({ kind, value });
      return { receiptId, kind, value };
    },
  };
  return { boundary, journal, receipts };
}

function readOnlySpec() {
  return {
    specialist: {
      metadata: { name: 'researcher', version: '1.0.0', description: 'd', category: 'c' },
      execution: {
        model: 'testprov/test-model',
        permission_required: 'READ_ONLY',
        response_format: 'text',
        output_type: 'research',
        bare: false,
      },
      prompt: { system: 'You are the researcher.', task_template: 'Do: {{bead_id}}' },
    },
  };
}

const hostWorkspaces: string[] = [];
function hostWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 's1-pub-ws-'));
  hostWorkspaces.push(root);
  return root;
}
afterEach(() => {
  while (hostWorkspaces.length > 0) rmSync(hostWorkspaces.pop() as string, { recursive: true, force: true });
});

function collectingSink(): ActivationForensicSink & { names: string[] } {
  const names: string[] = [];
  return { names, emit: (e) => { names.push(e.name); } };
}

interface HostFixture {
  host: NativeActivationHost;
  workItems: ReturnType<typeof fakeWorkItems>;
  store: ReturnType<typeof createMemorySettlementStore>;
  sink: ReturnType<typeof collectingSink>;
}

function hostWith(script: ScriptedTurn & { oversized?: number } = {}): HostFixture {
  const record: { createArgs?: Record<string, unknown> } = {};
  const session = fakeSession(record, script);
  const workItems = fakeWorkItems();
  const store = createMemorySettlementStore();
  const sink = collectingSink();
  const host = new NativeActivationHost({
    loader: { get: async () => readOnlySpec() } as never,
    workItems: workItems.boundary,
    settlements: store,
    forensics: sink,
    loadSdk: async () => makeSdk(record, session),
    cwd: hostWorkspace(),
    env: { XTRM_SESSION_ID: 'xtrm-sess-1', XTRM_SESSION_NAME: 's1-probe' },
    now: () => 1700000000000,
  });
  return { host, workItems, store, sink };
}

async function startResearch(host: NativeActivationHost) {
  return host.start({
    specialist: 'researcher',
    issueRef: 'XTRM-1',
    requestedByParticipantId: 'coordinator::main',
    coordinatorSessionId: 'coord-sess-9',
  });
}

describe('S1 §94 live chain — a completed settlement publishes automatically', () => {
  it('stores the runtime result, allocates a WorkReceipt, and appends a bounded Journal result with the full lineage bound', async () => {
    const { host, workItems, store, sink } = hostWith();
    // No publication API is called: start + await result is the whole driver.
    const handle = await startResearch(host);
    const result = await handle.result;
    expect(result.status).toBe('completed');

    // Runtime leg: the full settlement is stored under (activation, attempt).
    const attempts = store.listAttempts(handle.activationId);
    expect(attempts).toHaveLength(1);
    const stored = store.get(handle.activationId, handle.attemptId);
    expect(stored?.output).toBe('finding: the cache key omits the tenant');
    expect(stored?.status).toBe('completed');
    expect(stored?.issueRevision).toBe(1);
    expect(stored?.contractHash).toBe('hash-test');
    expect(stored?.executionBindingId).toBe('exb_s1');

    // Receipt leg: one receipt over the live binding, revision/hash copied host-side.
    expect(workItems.receipts).toHaveLength(1);
    const receipt = workItems.receipts[0];
    expect(receipt.executionBindingId).toBe('exb_s1');
    expect(receipt.issueRevision).toBe(1);
    expect(receipt.contractHash).toBe('hash-test');
    expect(receipt.attached).toHaveLength(1);
    expect(receipt.attached[0].kind).toBe('artifact');

    // Journal leg: one bounded result entry, closed field set, linked refs.
    expect(workItems.journal).toHaveLength(1);
    const [call] = workItems.journal;
    expect(call.ref).toBe('XTRM-1');
    const payload = call.input.result;
    for (const key of Object.keys(payload)) {
      expect(CLOSED_RESULT_FIELDS.has(key)).toBe(true);
    }
    expect(payload.summary).toContain('cache key');
    expect(payload.outcome).toBe('completed');
    expect(payload.receiptRefs).toEqual([receipt.id]);
    expect(payload.provenanceRefs).toContain('exb_s1');
    expect(payload.provenanceRefs).toContain(receipt.id);
    expect(payload.artifactRefs).toEqual([receipt.attached[0].value]);

    // Lineage leg (§37): the X1 envelope binds every required identity.
    const ctx = call.input.executionContext as Record<string, unknown>;
    expect(ctx['version']).toBe(1);
    expect(ctx['actor']).toMatchObject({ type: 'specialist' });
    expect(ctx['participantId']).toBe('specialist::researcher');
    const specialist = ctx['specialist'] as Record<string, unknown>;
    expect(specialist).toMatchObject({
      name: 'researcher',
      activationId: handle.activationId,
      attemptId: handle.attemptId,
      agentSessionId: 'pi-sess-s1',
    });
    expect(ctx['coordinator']).toMatchObject({
      participantId: 'coordinator::main',
      sessionId: 'coord-sess-9',
    });
    const workspace = ctx['workspace'] as Record<string, unknown>;
    expect(workspace['worktree']).toBeTruthy();
    expect(workspace['repoPath']).toBeTruthy();
    expect(workspace['baseCommit']).toBe(BASE_COMMIT);
    expect(ctx['xtrmSessionId']).toBe('xtrm-sess-1');
    expect(call.input.participantId).toBe('specialist::researcher');
    expect(call.input.activationId).toBe(handle.activationId);

    // The stored record resolves the published links: the full chain is queryable.
    expect(stored?.receiptId).toBe(receipt.id);
    expect(stored?.journalEntryId).toBe(call.entryId);
    expect(stored?.artifactRef).toBe(receipt.attached[0].value);

    // Automaticity evidence: the host emitted the publication forensics itself.
    for (const name of [
      'settlement_stored',
      'settlement_receipt_allocated',
      'settlement_artifact_attached',
      'settlement_result_published',
    ]) {
      expect(sink.names).toContain(name);
    }
  });
});

describe('S1 §97 retry leg — one activation, distinguishable attempts', () => {
  it('stores the failed attempt without publishing, then publishes the retry under a new attempt id', async () => {
    const { host, workItems, store } = hostWith({ failFirst: true });
    const handle = await startResearch(host);
    const first = await handle.result;
    expect(first.status).toBe('failed');
    const firstAttempt = first.attemptId;

    // Failed attempt: runtime-queryable, durably unpublished.
    expect(store.listAttempts(handle.activationId)).toHaveLength(1);
    expect(store.get(handle.activationId, firstAttempt)?.status).toBe('failed');
    expect(workItems.journal).toHaveLength(0);
    expect(workItems.receipts).toHaveLength(0);

    const retried = await host.retry(handle.activationId);
    expect(retried.activationId).toBe(handle.activationId);
    expect(retried.attemptId).not.toBe(firstAttempt);
    const second = await retried.result;
    expect(second.status).toBe('completed');

    // Both attempts queryable under the one activation, distinguishable by attempt id.
    const attempts = store.listAttempts(handle.activationId);
    expect(attempts).toHaveLength(2);
    const ids = attempts.map((a) => a.attemptId);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(firstAttempt);
    expect(ids).toContain(retried.attemptId);
    expect(store.get(handle.activationId, firstAttempt)?.status).toBe('failed');
    expect(store.get(handle.activationId, retried.attemptId)?.status).toBe('completed');

    // Exactly one publication, bound to the retry attempt — same binding, same activation.
    expect(workItems.journal).toHaveLength(1);
    expect(workItems.receipts).toHaveLength(1);
    const ctx = workItems.journal[0].input.executionContext as Record<string, unknown>;
    expect((ctx['specialist'] as Record<string, unknown>)['attemptId']).toBe(retried.attemptId);
    expect((ctx['specialist'] as Record<string, unknown>)['activationId']).toBe(handle.activationId);
    expect(workItems.receipts[0].executionBindingId).toBe('exb_s1');
  });
});

describe('S1 §39 bounded publication — raw output never reaches the Journal body', () => {
  it('truncates the summary and keeps the full text in runtime storage behind an artifact ref', async () => {
    const RAW = 100_000;
    const { host, workItems, store } = hostWith({ oversized: RAW });
    const handle = await startResearch(host);
    const result = await handle.result;
    expect(result.status).toBe('completed');

    expect(workItems.journal).toHaveLength(1);
    const payload = workItems.journal[0].input.result;
    expect(payload.summary.length).toBeLessThanOrEqual(SUMMARY_MAX);
    const body = JSON.stringify(workItems.journal[0]);
    // A 5000-char run of raw output anywhere in the entry fails this.
    expect(body).not.toContain('X'.repeat(5000));
    expect(body.length).toBeLessThan(RAW);

    // The full text survives, resolvable through the published artifact ref.
    const [ref] = payload.artifactRefs ?? [];
    expect(ref).toBeTruthy();
    const stored = store.get(handle.activationId, handle.attemptId);
    expect(typeof stored?.output === 'string' && (stored?.output as string).length).toBe(RAW);
    expect(stored?.artifactRef).toBe(ref);
  });
});

describe('S1 degraded publication — evidence never fails the activation', () => {
  // The runtime loads a producer without the result surface until the Substrate
  // cutover, so these are the paths every live activation takes in the meantime.
  it('stores only and emits settlement_degraded when the boundary carries no settlement surface', async () => {
    const { host, workItems, store, sink } = hostWith();
    const boundary = workItems.boundary as { appendResult?: unknown; allocateReceipt?: unknown };
    delete boundary.appendResult;
    delete boundary.allocateReceipt;
    const handle = await startResearch(host);
    const result = await handle.result;

    expect(result.status).toBe('completed');
    expect(sink.names).toContain('settlement_degraded');
    expect(workItems.journal).toHaveLength(0);
    const stored = store.get(handle.activationId, handle.attemptId);
    expect(stored?.status).toBe('completed');
    expect(stored?.journalEntryId).toBeUndefined();
  });

  it('keeps the completed result and the stored record when the Journal append throws', async () => {
    const { host, workItems, store, sink } = hostWith();
    workItems.boundary.appendResult = () => { throw new Error('database is locked'); };
    const handle = await startResearch(host);
    const result = await handle.result;

    expect(result.status).toBe('completed');
    expect(result.output).toContain('the cache key omits the tenant');
    expect(sink.names).toContain('settlement_degraded');
    expect(sink.names).not.toContain('settlement_result_published');
    expect(store.get(handle.activationId, handle.attemptId)?.journalEntryId).toBeUndefined();
  });

  it('keeps the completed result when runtime result storage itself throws', async () => {
    const { host, workItems, store, sink } = hostWith();
    store.save = () => { throw new Error('EROFS: read-only file system'); };
    const handle = await startResearch(host);
    const result = await handle.result;

    expect(result.status).toBe('completed');
    expect(sink.names).toContain('settlement_store_failed');
    expect(workItems.journal).toHaveLength(0);
    expect(workItems.receipts).toHaveLength(0);
  });
});

describe('S1 §40 zero-commit result — no code change still publishes', () => {
  it('produces a durable result and provenance with no commit artifact and no subprocess', async () => {
    const { host, workItems, store } = hostWith();
    const handle = await startResearch(host);
    const result = await handle.result;
    expect(result.status).toBe('completed');

    // Durable result + provenance exist; the commit path was never touched —
    // the fake rejects kind 'commit' exactly like the real service, so any
    // attempt would have failed the activation instead of degrading silently.
    expect(workItems.journal).toHaveLength(1);
    expect(workItems.receipts).toHaveLength(1);
    for (const receipt of workItems.receipts) {
      expect(receipt.attached.some((a) => a.kind === 'commit')).toBe(false);
    }
    expect(workItems.journal[0].input.result.outcome).toBe('completed');
    expect(store.get(handle.activationId, handle.attemptId)?.receiptId).toBe(workItems.receipts[0].id);
  });
});

describe('S1 publication builders — closed shape, no invented identity', () => {
  it('bounds every field and keeps the closed result set', () => {
    const payload = buildBoundedResult({
      output: 'Y'.repeat(9000),
      valid: false,
      errors: ['boom ' + 'z'.repeat(2000)],
      artifactRefs: ['a'],
      receiptRefs: ['r'],
      provenanceRefs: ['p'],
    });
    expect(payload.summary.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(payload.validation?.[0].length).toBeLessThanOrEqual(1000);
    for (const key of Object.keys(payload)) {
      expect(CLOSED_RESULT_FIELDS.has(key)).toBe(true);
    }
  });

  it('omits the coordinator participant leg when the dispatcher is the specialist itself, and omits unknown legs', () => {
    const self = buildSettlementExecutionContext({
      participantId: 'specialist::researcher',
      specialistName: 'researcher',
      activationId: 'act:1',
      attemptId: 'att:1:1',
      coordinatorParticipantId: 'specialist::researcher',
      repoPath: '/tmp/r',
      worktree: '/tmp/r',
    });
    expect(self.coordinator).toBeUndefined();
    expect(self.branch).toBeUndefined();
    expect(self.baseCommit).toBeUndefined();
    expect(self.xtrmSessionId).toBeUndefined();
    expect(self.host).toBeUndefined();

    const full = buildSettlementExecutionContext({
      participantId: 'specialist::researcher',
      specialistName: 'researcher',
      activationId: 'act:1',
      attemptId: 'att:1:1',
      agentSessionId: 'pi-sess-9',
      coordinatorParticipantId: 'coordinator::main',
      coordinatorSessionId: 'coord-sess-9',
      repoPath: '/tmp/r',
      worktree: '/tmp/r',
      baseCommit: BASE_COMMIT,
      env: { XTRM_SESSION_ID: 'xs', XTRM_SESSION_NAME: '' },
    });
    expect(full.host).toMatchObject({ type: 'pi', sessionId: 'pi-sess-9' });
    expect(full.coordinator).toMatchObject({ participantId: 'coordinator::main', sessionId: 'coord-sess-9' });
    // Blank env is unknown, never stored.
    expect(full.xtrmSessionName).toBeUndefined();
    expect(full.xtrmSessionId).toBe('xs');
  });
});
