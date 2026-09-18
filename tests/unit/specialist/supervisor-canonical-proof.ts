// Execution-backed verification for the XTRM-93 N3 canonical oracle (SPECIALISTS-103).
//
// Every check here drives REAL code against an ISOLATED store (worktree-local
// scratch, never the authoritative DB) and asserts on DURABLE rows or DERIVED
// output. No check reads source text: a registry key, comment, gap-list entry,
// fixture, or unrelated literal cannot satisfy a durable expectation by
// construction — the mechanism is visible below (mapper call + forensic row
// query), not asserted in a comment.
//
// M6 injection: runDurableNativeCheck accepts { dropWrites } to simulate "an
// event that IS mapped but never reaches a durable forensic row". The mapper
// returns non-null, the writer is stubbed to drop, and the check MUST fail on
// the missing row. That is the proof the row — not the mapper return — is the
// bar. M5 uses the same path: a comment containing the event name changes
// nothing because no source file is ever opened here.

import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createActivationForensicSink } from '../../../src/activation/forensic-sink.js';
import {
  mapNativeLifecycleEvent,
  NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED,
} from '../../../src/specialist/native-activation-observability.js';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';
import { renderPrometheusProjection } from '../../../src/specialist/prometheus-projection.js';
import { createStaleWarningEvent } from '../../../src/specialist/timeline-events.js';
import type {
  CanonicalAbsentProof,
  CanonicalDurableProof,
  CanonicalPersistedFieldAssertion,
} from './supervisor-canonical-inventory.js';

const SCRATCH_ROOT = join(import.meta.dirname, '..', '..', '.phase7-test-scratch');

export function newIsolatedStore(tag: string): { dbPath: string; root: string } {
  const root = join(SCRATCH_ROOT, `${tag}-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return { dbPath: join(root, 'observability.db'), root };
}

export function dropIsolatedStore(root: string): void {
  rmSync(root, { recursive: true, force: true });
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

// Keys that would traverse Object.prototype / Function.prototype. The path
// strings are authored in this inventory (static, not user-controlled), but the
// walk is guarded anyway: a segment like `__proto__` or `constructor` would
// otherwise resolve an INHERITED value instead of returning undefined, and a
// future caller passing external data must not be able to traverse the
// prototype chain. Mirrors src/specialist/loader.ts readDottedPath (same
// deny-list + hasOwnProperty shape). The deny-list and the own-property check
// also silence Semgrep rule
// javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop,
// whose AST-shape match fires regardless of data provenance (see the identical
// rationale above loader.ts:592 and its inline waiver).
const PROTOTYPE_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Resolve a dot path against a parsed forensic event JSON. Returns `undefined`
 * as soon as a segment is missing, matches the prototype-pollution deny-list, is
 * not an OWN property, or an intermediate value is not an object — so a renamed
 * or absent persisted field FAILS its assertion instead of passing vacuously
 * (SPECIALISTS-122). Exported so the hardening can be pinned directly by the
 * focused regression tests.
 */
export function resolveJsonPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    if (PROTOTYPE_POLLUTION_KEYS.has(segment)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment]; // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
  }
  return current;
}

/**
 * Reject a present-but-EMPTY `assertPersistedFields` (SPECIALISTS-122 round 2,
 * F3). Without this, `undefined` (omit) and `[]` (present) are both skipped by
 * the `length > 0` guard, so an entry can advertise field coverage while
 * asserting nothing. An empty array is not coverage; it is a lie by omission.
 */
function assertFieldAssertionsPresent(
  assertions: readonly CanonicalPersistedFieldAssertion[] | undefined,
  context: string,
): void {
  if (assertions === undefined) return;
  if (assertions.length === 0) {
    throw new Error(
      `[oracle] ${context}: assertPersistedFields is present but EMPTY — an entry ` +
      `advertising field coverage that asserts nothing is indistinguishable from omitting ` +
      `the field. Remove it or supply at least one assertion.`,
    );
  }
}

/**
 * Durable proof via the native lifecycle path: mapper arm + writer must BOTH
 * hold. Fails naming the mapper link when mapNativeLifecycleEvent returns
 * null; fails naming the writer link when no forensic row appears. The
 * `dropWrites` flag forces the M6 state (mapped but never persisted) by
 * stubbing the writer to a no-op AFTER the mapper has run.
 *
 * SPECIALISTS-122: `assertPersistedFields` adds generic field assertions on the
 * PERSISTED row (read back from `specialist_forensic_events`, never from the
 * mapper's return value). The row it binds is the first one named
 * `expectedForensicName`, so a payload assertion is only meaningful when the
 * entry's emit cannot also produce a second row with that name.
 */
export function runDurableNativeCheck(opts: {
  emitName: string;
  emitPayload?: Record<string, unknown>;
  expectedForensicName: string;
  assertFallbackDiagnostics?: boolean;
  assertPersistedFields?: readonly CanonicalPersistedFieldAssertion[];
  activationId?: string;
  dropWrites?: boolean;
}): { rows: ForensicRow[] } {
  const {
    emitName,
    emitPayload,
    expectedForensicName,
    assertFallbackDiagnostics,
    assertPersistedFields,
    dropWrites,
  } = opts;
  assertFieldAssertionsPresent(assertPersistedFields, `durable proof for "${emitName}"`);
  const activationId = opts.activationId ?? `act:oracle-${emitName.replace(/[^a-z]/g, '')}-${crypto.randomUUID().slice(0, 8)}`;

  // Link 1 (mapper) is checked FIRST so the failure names it precisely. This
  // call is the same function the sink uses below — not a string match.
  const preview = mapNativeLifecycleEvent(
    { activationId, specialist: 'researcher', beadId: 'bd-oracle', name: emitName, payload: emitPayload },
    { startedAtMs: Date.now() },
    1000,
  );
  if (preview === null) {
    throw new Error(
      `[oracle] durable proof for "${emitName}": mapper link MISSING — ` +
      `mapNativeLifecycleEvent returned null (no case arm; a registry key or ` +
      `comment cannot substitute). Expected a "${expectedForensicName}" row.`,
    );
  }

  const { dbPath, root } = newIsolatedStore('oracle-durable');
  try {
    const realClient = createObservabilitySqliteClientAtPath(dbPath);
    if (!realClient) throw new Error('[oracle] isolated store unavailable');
    // M6 injection point: keep the mapper above intact, drop the write below.
    const client = dropWrites
      ? ({ ...realClient, upsertStatusWithEvents: () => {}, upsertStatus: () => {} } as typeof realClient)
      : realClient;
    const sink = createActivationForensicSink(client);
    const attemptId = 'att:oracle:1';
    sink.emit({
      activationId,
      attemptId,
      participantId: 'specialist::researcher',
      specialist: 'researcher',
      beadId: 'bd-oracle',
      name: emitName,
      payload: emitPayload,
    });
    realClient.close();

    const rows = readForensicRows(dbPath, activationId);
    const names = rows.map((row) => row.event_name);
    if (!names.includes(expectedForensicName)) {
      throw new Error(
        `[oracle] durable proof for "${emitName}": writer link MISSING — ` +
        `mapper returned a timeline event but no durable forensic row named ` +
        `"${expectedForensicName}" exists (found: [${names.join(', ')}]). ` +
        (dropWrites
          ? 'Writes were deliberately dropped (M6): the mapper alone is insufficient.'
          : 'The event is mapped but never reaches a durable row.'),
      );
    }

    if (assertPersistedFields) {
      const row = rows.find((candidate) => candidate.event_name === expectedForensicName);
      if (!row) throw new Error('[oracle]unreachable: row asserted above');
      const persisted = JSON.parse(row.event_json) as Record<string, unknown>;
      for (const assertion of assertPersistedFields) {
        const actual = resolveJsonPath(persisted, assertion.path);
        if (actual !== assertion.equals) {
          throw new Error(
            `[oracle] durable payload for "${emitName}": persisted field ` +
            `"${assertion.path}" is ${JSON.stringify(actual)}, expected ` +
            `${JSON.stringify(assertion.equals)} (read back from ` +
            `specialist_forensic_events.event_json — a mapper-level assertion ` +
            `would not have bound the writer).`,
          );
        }
      }
    }

    if (assertFallbackDiagnostics) {
      const row = rows.find((candidate) => candidate.event_name === expectedForensicName);
      if (!row) throw new Error('[oracle]unreachable: row asserted above');
      const parsed = JSON.parse(row.event_json) as {
        body?: { legacy_timeline_event?: Record<string, unknown> };
      };
      const timeline = parsed.body?.legacy_timeline_event ?? {};
      const payload = emitPayload ?? {};
      for (const key of ['model', 'previous_model', 'error_class', 'terminal', 'note', 'attempt_n', 'resolved_model'] as const) {
        const produced = key === 'model'
          ? payload['to_model']
          : key === 'previous_model'
            ? payload['from_model']
            : payload[key];
        if (produced === undefined || produced === null) continue;
        const persisted = timeline[key];
        if (persisted !== produced) {
          throw new Error(
            `[oracle] durable payload for "${emitName}": field "${key}" ` +
            `produced as ${JSON.stringify(produced)} but persisted as ` +
            `${JSON.stringify(persisted)} (event_json.body.legacy_timeline_event).`,
          );
        }
      }
      // Attempt attribution: the durable row carries the emit's attempt.
      if (row.attempt_id !== attemptId) {
        throw new Error(
          `[oracle] attempt attribution for "${emitName}": row attempt_id is ` +
          `${JSON.stringify(row.attempt_id)}, expected ${JSON.stringify(attemptId)}.`,
        );
      }
    }

    return { rows };
  } finally {
    dropIsolatedStore(root);
  }
}

/** Durable proof via the legacy writer path (no native mapper involved). */
export function runDurableLegacyStaleCheck(): { rows: ForensicRow[] } {
  const jobId = `act:oracle-legacy-stale-${crypto.randomUUID().slice(0, 8)}`;
  const { dbPath, root } = newIsolatedStore('oracle-legacy');
  try {
    const client = createObservabilitySqliteClientAtPath(dbPath);
    if (!client) throw new Error('[oracle] isolated store unavailable');
    client.upsertStatus({
      id: jobId, specialist: 'researcher', status: 'running', bead_id: 'bd-oracle',
      started_at_ms: Date.now(),
    } as never);
    client.appendEvent(jobId, 'researcher', 'bd-oracle', createStaleWarningEvent('waiting_stale', {
      silence_ms: 1000,
      threshold_ms: 500,
    }) as never);
    client.close();

    const rows = readForensicRows(dbPath, jobId);
    if (!rows.map((row) => row.event_name).includes('process_health.stale_detected')) {
      throw new Error(
        '[oracle] durable proof for legacy stale_warning: writer link MISSING — ' +
        `createStaleWarningEvent + appendEvent produced no "process_health.stale_detected" row.`,
      );
    }
    return { rows };
  } finally {
    dropIsolatedStore(root);
  }
}

/**
 * Absent-with-reason proof: the absence must be a DECISION. Passes only when
 * all three hold: mapper returns null (no arm), the registry carries a
 * non-empty written reason, and emitting the name yields zero forensic rows.
 * An empty or missing reason FAILS even when no row exists.
 */
export function runAbsentCheck(proof: CanonicalAbsentProof): { reason: string } {
  const preview = mapNativeLifecycleEvent(
    { activationId: 'act:oracle-absent', specialist: 'researcher', name: proof.emitName, payload: {} },
    { startedAtMs: Date.now() },
    1000,
  );
  if (preview !== null) {
    throw new Error(
      `[oracle] absent proof for "${proof.emitName}": mapper arm EXISTS — ` +
      `the event is persisted, so EXPECTED_ABSENT_WITH_REASON no longer holds. Reclassify to EXPECTED_DURABLE.`,
    );
  }

  const reason = (NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED as unknown as Record<string, unknown>)[proof.unpersistedKey];
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new Error(
      `[oracle] absent proof for "${proof.emitName}": written reason MISSING or EMPTY — ` +
      `absence without a non-empty reason in NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED is an omission, not a decision.`,
    );
  }

  const activationId = `act:oracle-absent-${crypto.randomUUID().slice(0, 8)}`;
  const { dbPath, root } = newIsolatedStore('oracle-absent');
  try {
    const client = createObservabilitySqliteClientAtPath(dbPath);
    if (!client) throw new Error('[oracle] isolated store unavailable');
    const sink = createActivationForensicSink(client);
    sink.emit({
      activationId,
      attemptId: 'att:oracle:1',
      participantId: 'specialist::researcher',
      specialist: 'researcher',
      beadId: 'bd-oracle',
      name: proof.emitName,
      payload: { pinned: 'oracle-probe' },
    });
    client.close();
    const rows = readForensicRows(dbPath, activationId);
    if (rows.length !== 0) {
      throw new Error(
        `[oracle] absent proof for "${proof.emitName}": expected zero forensic rows, ` +
        `found [${rows.map((row) => row.event_name).join(', ')}] — a persistence surface exists. Reclassify.`,
      );
    }
  } finally {
    dropIsolatedStore(root);
  }
  return { reason };
}

/**
 * Runtime-only proof for the token metric: executes writer -> aggregate ->
 * render and requires a non-empty xtrm_llm_tokens_total projection. This is
 * neither a single-row check (the metric aggregates the trajectory) nor an
 * absence check (the series must exist).
 */
export function runTokenMetricProjectionCheck(): { sampleCount: number } {
  const jobId = `job-oracle-tokens-${crypto.randomUUID().slice(0, 8)}`;
  const { dbPath, root } = newIsolatedStore('oracle-runtime');
  try {
    const client = createObservabilitySqliteClientAtPath(dbPath);
    if (!client) throw new Error('[oracle] isolated store unavailable');
    client.upsertStatus({
      id: jobId, specialist: 'executor', status: 'done',
      started_at_ms: 1, last_event_at_ms: 5,
    } as never);
    client.appendEvent(jobId, 'executor', 'bd-oracle', {
      t: 70, type: 'turn_summary', turn_index: 1,
      token_usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 },
    } as never);
    client.appendEvent(jobId, 'executor', 'bd-oracle', {
      t: 80, type: 'token_usage', source: 'turn_end',
      token_usage: { input_tokens: 2097, output_tokens: 150, total_tokens: 2247 },
    } as never);
    client.appendEvent(jobId, 'executor', 'bd-oracle', {
      t: 100, type: 'run_complete', status: 'COMPLETE', elapsed_s: 0.1,
    } as never);
    const metrics = client.aggregateJobMetrics(jobId);
    const statuses = client.listStatuses();
    const jobMetrics = client.listJobMetrics({});
    client.close();
    if (!metrics) throw new Error('[oracle] runtime proof: aggregateJobMetrics returned null');
    const text = renderPrometheusProjection({
      statuses, jobMetrics, repo: 'oracle', nowMs: Date.now(),
    });
    const series = text.split('\n').filter((line) => line.startsWith('xtrm_llm_tokens_total'));
    if (series.length === 0) {
      throw new Error('[oracle] runtime proof for token-metric-series: no xtrm_llm_tokens_total series projected');
    }
    return { sampleCount: series.length };
  } finally {
    dropIsolatedStore(root);
  }
}

/** Dispatch a durable entry's proof (native vs legacy path). */
export function runDurableEntryCheck(proof: CanonicalDurableProof): void {
  if (proof.via === 'native-lifecycle') {
    if (!proof.emitName) throw new Error('[oracle] durable proof missing emitName');
    runDurableNativeCheck({
      emitName: proof.emitName,
      emitPayload: proof.emitPayload,
      expectedForensicName: proof.expectedForensicName,
      assertFallbackDiagnostics: proof.assertFallbackDiagnostics,
      assertPersistedFields: proof.assertPersistedFields,
    });
    return;
  }
  // F2 (SPECIALISTS-122 round 2): the field lives on the SHARED
  // CanonicalDurableProof type, but runDurableLegacyStaleCheck never applies it.
  // A legacy proof declaring it would pass NAME-ONLY while advertising field
  // coverage. Fail loudly instead of silently ignoring the declaration.
  if (proof.assertPersistedFields !== undefined) {
    throw new Error(
      `[oracle] durable proof via legacy-append declares assertPersistedFields, but ` +
      `runDurableLegacyStaleCheck NEVER applies it: the entry would pass name-only while ` +
      `advertising field coverage. Remove the field from the legacy proof or reclassify ` +
      `it to native-lifecycle.`,
    );
  }
  runDurableLegacyStaleCheck();
}
