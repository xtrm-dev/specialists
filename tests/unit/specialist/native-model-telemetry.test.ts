import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The native path must never reach for a subprocess; the host's tool-catalog / prompt
// defaults use execSync, so only spawn is stubbed (same shape as native-tool-duration.test.ts).
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

import { createActivationForensicSink } from '../../../src/activation/forensic-sink.js';
import { NativeActivationHost } from '../../../src/activation/native-host.js';
import type { PiAgentSessionEvent, PiAgentSessionLike, PiSdk } from '../../../src/activation/pi-sdk.js';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';
import type { SpecialistWorkItemBoundary, WorkItemView } from '../../../src/activation/workitem-store.js';

/**
 * SPECIALISTS-123 end-to-end model telemetry.
 *
 * Two claims are bound here that were previously only inferred:
 *
 *  1. `activation_admitted` gains a mapper arm, so `configured_model`, `requested_model`,
 *     `resolved_model` and `model_override` are DURABLE per activation (job.* era). Driven
 *     through the REAL host + REAL `createActivationForensicSink` + an ISOLATED store, and
 *     read back from `specialist_forensic_events` — not from a fake sink's captured payload.
 *  2. The fallback chain is proven END TO END from the host: a REAL retryable provider
 *     failure walks the REAL fallback sites through the REAL sink, and the durable
 *     `model.changed` row(s) carry the model_fallback diagnostic keys.
 *
 * LIMIT ON THE SEVEN-KEY CLAIM (stated, not buried): the seven model_fallback diagnostic
 * keys are the UNION across the five native-host emit sites — NO single real emit site
 * carries all seven. Site `retryable failure + next entry validated` (native-host.ts:2493)
 * carries attempt_n but no note; sites `next entry unavailable` (:2483), `lease re-acquire
 * throws` (:2531) and `createSession throws` (:2557) carry note but no attempt_n; site
 * `admission-time skip` (:1310) carries neither attempt_n nor resolved_model. The fixture
 * below drives :2493 then :2483 and therefore asserts the exact seven-key UNION across the
 * two persisted rows, together with each row's exact diagnostic key set (absence pinned,
 * not just presence), and union set equality in both directions (no key missing, no key
 * invented). Answerability holds via a query ACROSS rows, not from any single row.
 *
 * F1 DISCRIMINATION: the override fixture resolves the requested pattern
 * (`aliasprov/alias-model`) to a DIFFERENT canonical id (`canonprov/canon-model`), so
 * requested_model, resolved_model and the executed model are three distinct durable values.
 * A producer that sourced `requested_model` from the resolved value therefore FAILS.
 *
 * The injection seam is `loadSdk` (NativeActivationHostDeps), the same seam the existing
 * activation-native-host.test.ts fallback tests use. NO new production seam is added.
 *
 * ISOLATION: every store is a fresh temp-dir sqlite file. The authoritative observability
 * DB is never touched.
 */

const scratchDirs: string[] = [];
afterEach(() => {
  while (scratchDirs.length > 0) rmSync(scratchDirs.pop() as string, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function isolatedStore() {
  const root = mkdtempSync(join(tmpdir(), 'model-telemetry-'));
  scratchDirs.push(root);
  const dbPath = join(root, 'observability.db');
  const client = createObservabilitySqliteClientAtPath(dbPath);
  if (!client) throw new Error('isolated store unavailable');
  return { dbPath, client, sink: createActivationForensicSink(client) };
}

function hostWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'model-telemetry-ws-'));
  scratchDirs.push(root);
  return root;
}

interface ForensicRow {
  event_name: string;
  attempt_id: string | null;
  event_json: string;
}

function readForensicRows(dbPath: string, jobId: string): ForensicRow[] {
  const raw = new Database(dbPath);
  try {
    return raw.query(
      'SELECT event_name, attempt_id, event_json FROM specialist_forensic_events WHERE job_id = ? ORDER BY seq',
    ).all(jobId) as ForensicRow[];
  } finally {
    raw.close();
  }
}

/** The PERSISTED timeline event JSON — the writer's output, never the mapper's return value. */
function timelineOf(row: ForensicRow): Record<string, unknown> {
  return (JSON.parse(row.event_json) as { body?: { legacy_timeline_event?: Record<string, unknown> } })
    .body?.legacy_timeline_event ?? {};
}

function readStatus(dbPath: string, jobId: string): { status: string; body: Record<string, unknown> } {
  const raw = new Database(dbPath);
  try {
    const row = raw.query('SELECT status, status_json FROM specialist_jobs WHERE job_id = ?')
      .get(jobId) as { status: string; status_json: string };
    return { status: row.status, body: JSON.parse(row.status_json) as Record<string, unknown> };
  } finally {
    raw.close();
  }
}

/** Opt-in raw store dump (SPECIALISTS_ATTEMPT_EVIDENCE pattern), so ordinary runs stay quiet. */
function dumpEvidence(label: string, rows: readonly ForensicRow[]): void {
  if (!process.env.SPECIALISTS_MODEL_TELEMETRY_EVIDENCE) return;
  process.stdout.write(`${label}\n${JSON.stringify(rows, null, 2)}\n`);
}

function fakeWorkItems(): SpecialistWorkItemBoundary {
  const contract = {
    problem: 'The thing is unclear.',
    success: 'The thing is clear.',
    scope: ['Investigate the thing.'],
    nonGoals: ['Does not fix the thing.'],
    constraints: ['Read-only.'],
    validation: [{ check: 'A written finding.' }],
    output: [{ artifact: 'A finding.' }],
  };
  return {
    view(ref: string): WorkItemView {
      return {
        ref,
        issueId: `iss_${ref}`,
        revision: 1,
        contractHash: 'hash-test',
        title: 'Investigate the thing',
        contract,
        readinessState: 'claimed',
        dispatchable: true,
        reasons: [],
      };
    },
    readContractState: () => undefined,
    epicAncestors: () => [],
    completedBlockers: () => [],
    check: () => ({ issueId: 'iss_test', revision: 1, contractHash: 'hash-test', report: {} }) as never,
    bind: () => ({}) as never,
    inlineCreate: () => ({ ref: 'ISSUE-INLINE', issueId: 'iss_inline', claimId: 1 }),
    releaseInlineClaim: () => true,
    journal: () => {},
  } as unknown as SpecialistWorkItemBoundary;
}

function loaderFor(spec: Record<string, unknown>) {
  return { get: async () => spec } as never;
}

function readOnlySpec(executionExtra: Record<string, unknown> = {}) {
  return {
    specialist: {
      metadata: { name: 'researcher', version: '1.0.0', description: 'd', category: 'c' },
      execution: {
        model: 'primaryprov/primary-model',
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

let sessionCounter = 0;

/** One session per script: each prompt consumes the next step (last step repeats). */
function scriptSession(
  script: Array<{ text?: string; stopReason?: string; errorMessage?: string; throw?: unknown }>,
): PiAgentSessionLike & { sessionId: string } {
  const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
  const messages: unknown[] = [];
  let n = 0;
  let activeTools: string[] = [];
  const session = {
    sessionId: `pi-sess-${(sessionCounter += 1)}`,
    messages,
    isIdle: true,
    disposed: false,
    prompts: [] as string[],
    async prompt(text: string) {
      session.prompts.push(text);
      listeners.forEach((l) => l({ type: 'agent_start' }));
      const step = script[Math.min(n, script.length - 1)];
      n += 1;
      if (step?.throw) throw step.throw;
      messages.push({
        role: 'assistant',
        content: step?.text ?? 'done',
        ...(step?.stopReason ? { stopReason: step.stopReason } : {}),
        ...(step?.errorMessage ? { errorMessage: step.errorMessage } : {}),
      });
      listeners.forEach((l) => l({ type: 'agent_end', willRetry: false }));
      listeners.forEach((l) => l({ type: 'agent_settled' }));
    },
    async steer() {},
    async followUp() {},
    async abort() {},
    dispose() {},
    subscribe(l: (e: PiAgentSessionEvent) => void) {
      listeners.push(l);
      return () => {
        const i = listeners.indexOf(l);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    getActiveToolNames: () => activeTools,
    setActiveToolsByName(names: string[]) {
      activeTools = names;
    },
    async waitForIdle() {},
  };
  return session as unknown as PiAgentSessionLike & { sessionId: string };
}

/**
 * Serves one session per created model. By default each requested pattern resolves to
 * itself; `aliases` maps a requested pattern to a DIFFERENT canonical provider/id so a
 * fixture can pin `requested_model` and `resolved_model` as distinct values (F1).
 */
function chainSdk(
  created: unknown[],
  sessions: PiAgentSessionLike[],
  unavailable: string[] = [],
  aliases: Record<string, string> = {},
): PiSdk {
  return {
    createAgentSession: async (options?: Record<string, unknown>) => {
      created.push((options as { model?: unknown } | undefined)?.model);
      const session = sessions[created.length - 1];
      if (!session) throw new Error(`chainSdk: no session scripted for model attempt ${created.length}`);
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
          diagnostics: [{
            type: 'warning',
            code: 'no-match',
            message: `No models match pattern "${patterns[0]}"`,
            pattern: patterns[0],
          }],
        };
      }
      const canonical = aliases[patterns[0]] ?? patterns[0];
      const [provider, ...rest] = canonical.split('/');
      return { scopedModels: [{ model: { id: rest.join('/') || canonical, provider } }], diagnostics: [] };
    },
    defineTool: (d: unknown) => d,
    createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
    createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
    createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
    createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
  } as unknown as PiSdk;
}

const ADMITTED_EVENT_NAME = 'control.activation_admitted.recorded';
// The model_fallback diagnostic key list (union of the five native-host emit sites).
const DIAGNOSTIC_KEYS = [
  'model', 'previous_model', 'error_class', 'terminal', 'note', 'attempt_n', 'resolved_model',
] as const;

describe('SPECIALISTS-123: activation_admitted persists configured/requested model', () => {
  it('records the configured and requested model when they are EQUAL (no override)', async () => {
    const { dbPath, client, sink } = isolatedStore();
    const session = scriptSession([{ text: 'done' }]);
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => chainSdk([], [session]),
      cwd: hostWorkspace(),
    });
    const handle = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    await handle.result;
    await host.stop(handle.activationId);
    client.close();

    const admitted = readForensicRows(dbPath, handle.activationId)
      .filter((row) => row.event_name === ADMITTED_EVENT_NAME);
    dumpEvidence('RAW control.activation_admitted.recorded rows (equal case)', admitted);
    expect(admitted, 'no durable activation_admitted row was written').toHaveLength(1);
    const timeline = timelineOf(admitted[0]!);
    expect(timeline).toMatchObject({ type: 'control_signal', action: 'activation_admitted' });
    expect(timeline['configured_model']).toBe('primaryprov/primary-model');
    expect(timeline['requested_model']).toBe('primaryprov/primary-model');
    expect(timeline['resolved_model']).toBe('primaryprov/primary-model');
    expect(timeline['model_override']).toBe(false);
  });

  it('records the override so configured/requested/resolved are THREE distinct values', async () => {
    const { dbPath, client, sink } = isolatedStore();
    const session = scriptSession([{ text: 'done' }]);
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec()),
      workItems: fakeWorkItems(),
      forensics: sink,
      // The requested pattern resolves to a DIFFERENT canonical id, so requested_model and
      // resolved_model are distinct values. Without this, a producer that sourced
      // requested_model from the resolved value would pass unnoticed (F1, SPECIALISTS-151).
      loadSdk: async () => chainSdk([], [session], [], {
        'aliasprov/alias-model': 'canonprov/canon-model',
      }),
      cwd: hostWorkspace(),
    });
    const handle = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
      modelOverride: 'aliasprov/alias-model',
    });
    await handle.result;
    await host.stop(handle.activationId);
    client.close();

    const admitted = readForensicRows(dbPath, handle.activationId)
      .filter((row) => row.event_name === ADMITTED_EVENT_NAME);
    dumpEvidence('RAW control.activation_admitted.recorded rows (override case)', admitted);
    expect(admitted).toHaveLength(1);
    const timeline = timelineOf(admitted[0]!);
    // The exact gap this issue closes: configured and requested differ, and only the
    // override tells the reader which model was asked for.
    expect(timeline['configured_model']).toBe('primaryprov/primary-model');
    expect(timeline['requested_model']).toBe('aliasprov/alias-model');
    expect(timeline['resolved_model']).toBe('canonprov/canon-model');
    expect(timeline['model_override']).toBe(true);
    // Discrimination, asserted explicitly: requested_model is NOT the resolved value. A
    // producer that wrote the resolved value into requested_model fails on this line even
    // though model_override is still true.
    expect(timeline['requested_model']).not.toBe(timeline['resolved_model']);

    // Question 2, same activation: what actually EXECUTED is on the status row (canonical
    // id), which is deliberately NOT the requested pattern.
    const status = readStatus(dbPath, handle.activationId);
    expect(status.body['model']).toBe('canonprov/canon-model');
    expect(status.body['model']).not.toBe(timeline['requested_model']);
  });
});

describe('SPECIALISTS-123: host-driven fallback reaches a durable model.changed row', () => {
  it('drives the real fallback walk and reads the diagnostic keys back from the store', async () => {
    const { dbPath, client, sink } = isolatedStore();
    const created: unknown[] = [];
    const quota = () => {
      const error = new Error('Free usage limit exceeded for this model');
      error.name = 'FreeUsageLimitError';
      return error;
    };
    // Chain: primary -> fallback -> last. The primary AND the fallback both fail with a
    // retryable error; `last` is unavailable, so the walk first proposes the switch (M2)
    // and then degrades terminally (M3).
    const primary = scriptSession([{ throw: quota() }]);
    const fallback = scriptSession([{ throw: quota() }]);
    const host = new NativeActivationHost({
      loader: loaderFor(readOnlySpec({
        fallback_models: ['fallbackprov/fallback-model', 'lastprov/last-model'],
      })),
      workItems: fakeWorkItems(),
      forensics: sink,
      loadSdk: async () => chainSdk(created, [primary, fallback], ['lastprov/last-model']),
      cwd: hostWorkspace(),
    });
    const handle = await host.start({
      specialist: 'researcher', issueRef: 'ISSUE-1', requestedByParticipantId: 'coordinator',
    });
    const result = await handle.result;
    await host.stop(handle.activationId);
    client.close();

    expect(result.status).toBe('failed');
    expect(result.fallbackUsed).toBe(true);
    expect(created).toHaveLength(2);

    const changed = readForensicRows(dbPath, handle.activationId)
      .filter((row) => row.event_name === 'model.changed');
    dumpEvidence('RAW model.changed rows (host-driven fallback)', changed);
    expect(changed, 'no durable model.changed row was written').toHaveLength(2);
    const timelines = changed.map(timelineOf);
    expect(timelines.every((event) => event['type'] === 'model_change')).toBe(true);
    expect(timelines.every((event) => event['action'] === 'cycle_model')).toBe(true);

    // Emit site 1 of 2 reached: native-host.ts `retryable failure and next entry validated`
    // (the M2 switch proposed), terminal:false with attempt_n.
    expect(timelines[0]).toMatchObject({
      model: 'fallbackprov/fallback-model',
      previous_model: 'primaryprov/primary-model',
      error_class: 'rate_limit',
      terminal: false,
      attempt_n: 2,
      resolved_model: 'fallbackprov/fallback-model',
    });
    // Emit site 2 of 2 reached: native-host.ts `retryable failure and next chain entry
    // unavailable` (the M3 terminal degradation), terminal:true with a note.
    expect(timelines[1]).toMatchObject({
      model: 'lastprov/last-model',
      previous_model: 'fallbackprov/fallback-model',
      error_class: 'rate_limit',
      terminal: true,
      resolved_model: 'fallbackprov/fallback-model',
    });
    expect(String(timelines[1]!['note'])).toMatch(/fallback unavailable/);

    // Exact DIAGNOSTIC key set on EACH row: a subset matcher would let an absent key go
    // unnoticed (F2). Emit site 1 of 2 (native-host.ts:2493, `retryable failure and next
    // entry validated`) carries attempt_n but NOT note; emit site 2 of 2 (native-host.ts:2483,
    // `next chain entry unavailable`) carries note but NOT attempt_n. The diagnostic keys are
    // asserted exactly (as a set), so absence is pinned, not merely non-presence.
    const diagnosticKeysOf = (event: Record<string, unknown>): string[] =>
      Object.keys(event).filter((key) => (DIAGNOSTIC_KEYS as readonly string[]).includes(key)).sort();
    expect(diagnosticKeysOf(timelines[0]!)).toEqual([
      'attempt_n', 'error_class', 'model', 'previous_model', 'resolved_model', 'terminal',
    ]);
    expect(diagnosticKeysOf(timelines[1]!)).toEqual([
      'error_class', 'model', 'note', 'previous_model', 'resolved_model', 'terminal',
    ]);

    // The seven diagnostic keys are the UNION across the five emit sites; no single site
    // emits all seven. Union set equality is asserted in BOTH directions (F3): every
    // diagnostic key is present, and NO eighth diagnostic key is invented. The writer's own
    // envelope keys (t/type/action/seq) are excluded from the diagnostic set.
    const ENVELOPE_KEYS = ['t', 'type', 'action', 'seq'];
    const union = new Set<string>();
    for (const event of timelines) for (const key of Object.keys(event)) union.add(key);
    const allKeys = [...union].sort();
    expect(allKeys.filter((key) => !ENVELOPE_KEYS.includes(key))).toEqual([...DIAGNOSTIC_KEYS].sort());
    expect(allKeys).toEqual([...ENVELOPE_KEYS, ...DIAGNOSTIC_KEYS].sort());

    // The three operator questions, answered by exact SQL against the SAME activation's
    // durable rows (read-only through the isolated store). Epoch printed with the evidence.
    const raw = new Database(dbPath, { readonly: true });
    try {
      const admitted = raw.query(`
        SELECT json_extract(event_json, '$.body.legacy_timeline_event.configured_model') AS configured_model,
               json_extract(event_json, '$.body.legacy_timeline_event.requested_model')  AS requested_model,
               json_extract(event_json, '$.body.legacy_timeline_event.model_override')   AS model_override
        FROM specialist_forensic_events
        WHERE event_name = 'control.activation_admitted.recorded' AND job_id = ?`).get(handle.activationId);
      const executed = raw.query(`
        SELECT json_extract(status_json, '$.model') AS model
        FROM specialist_jobs WHERE job_id = ?`).get(handle.activationId);
      const fallbackRows = raw.query(`
        SELECT json_extract(event_json, '$.body.legacy_timeline_event.model')          AS model,
               json_extract(event_json, '$.body.legacy_timeline_event.previous_model') AS previous_model,
               json_extract(event_json, '$.body.legacy_timeline_event.error_class')    AS error_class,
               json_extract(event_json, '$.body.legacy_timeline_event.terminal')       AS terminal,
               json_extract(event_json, '$.body.legacy_timeline_event.note')           AS note,
               json_extract(event_json, '$.body.legacy_timeline_event.attempt_n')      AS attempt_n,
               json_extract(event_json, '$.body.legacy_timeline_event.resolved_model') AS resolved_model
        FROM specialist_forensic_events
        WHERE event_name = 'model.changed' AND job_id = ? ORDER BY seq`).all(handle.activationId);
      if (process.env.SPECIALISTS_MODEL_TELEMETRY_EVIDENCE) {
        process.stdout.write(`THREE-QUESTION SQL @ ${new Date().toISOString()}\n` + JSON.stringify({ admitted, executed, fallbackRows }, null, 2) + '\n');
      }
      expect(admitted).toEqual({
        configured_model: 'primaryprov/primary-model',
        requested_model: 'primaryprov/primary-model',
        model_override: 0,
      });
      expect(executed).toEqual({ model: 'fallbackprov/fallback-model' });
      expect(fallbackRows).toHaveLength(2);
      expect(fallbackRows[0]).toMatchObject({ attempt_n: 2, error_class: 'rate_limit', terminal: 0 });
      expect(fallbackRows[1]).toMatchObject({ terminal: 1 });
      expect(String((fallbackRows[1] as { note: string }).note)).toMatch(/fallback unavailable/);
    } finally {
      raw.close();
    }
  });
});
