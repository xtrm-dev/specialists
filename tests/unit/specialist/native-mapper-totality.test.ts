import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActivationForensicSink } from '../../../src/activation/forensic-sink.js';
import {
  mapNativeLifecycleEvent,
  NATIVE_LIFECYCLE_OBSERVABILITY_GAPS,
  NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED,
  NATIVE_SESSION_OBSERVABILITY_GAPS,
} from '../../../src/specialist/native-activation-observability.js';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';

/**
 * SPECIALISTS-101 totality guard.
 *
 * Every event name the native host can emit must have an EXPLICIT disposition:
 * either (a) handled by an explicit mapper arm (mapNativeLifecycleEvent returns non-null),
 * or (b) listed in an explicit registry of deliberately-unpersisted names with a non-empty
 * written reason. A name in neither FAILS the test.
 *
 * The inventory below is an independent enumeration of emit sites (grep over
 * src/activation/native-host.ts, src/activation/settlement-publication.ts and
 * src/activation/workspace-reconcile.ts for `emit('...')`, `name: '...'` and the two
 * dynamic ternary names). The `inventory matches emit sites` test pins it to the sources
 * so a newly emitted name cannot slip in without updating this file — and the totality
 * test then forces an explicit disposition for it.
 *
 * Runtime safety is unchanged: the mapper's `default: return null` still drops unknown
 * names without crashing the writer. This guard is a TEST-time obligation, not a runtime throw.
 */

// Independent enumeration of every name that can reach ActivationForensicSink.emit.
// Sources: native-host.ts emit('...') (30) + direct forensics.emit names (3 new:
// activation_disposed, lease_uncertain, tool_blocked) + workspace-reconcile
// lease_reconciled/lease_uncertain + settlement-publication.ts (10) + the dynamic
// ternary pair (escalation_raised/clarification_requested + resolved pair).
// Hooks emits (pre_render/post_render/pre_execute/post_execute) are a different vocabulary
// (src/specialist/hooks.ts) and never reach the forensic sink — excluded by design.
export const NATIVE_EMIT_INVENTORY = Object.freeze([
  'activation_admitted',
  'activation_completed',
  'activation_disposed',
  'activation_failed',
  'activation_rejected',
  'activation_requested',
  'activation_resumed',
  'activation_retried',
  'activation_settled',
  'activation_started',
  'activation_starting',
  'clarification_answered',
  'clarification_requested',
  'compaction_completed',
  'compaction_started',
  'escalation_raised',
  'escalation_resolved',
  'extension_discovery_sessions',
  'extension_tools_discovered',
  'extension_tools_refused',
  'lease_acquired',
  'lease_denied',
  'lease_reconciled',
  'lease_release_failed',
  'lease_released',
  'lease_uncertain',
  'mandatory_rules_injection',
  'model_fallback',
  'output_validation_failed',
  'output_validation_passed',
  'output_validation_started',
  'retry_completed',
  'retry_started',
  'settlement_artifact_attached',
  'settlement_degraded',
  'settlement_receipt_allocated',
  'settlement_republish_deferred',
  'settlement_republish_error',
  'settlement_republish_reconciled',
  'settlement_republish_refused',
  'settlement_result_published',
  'settlement_store_failed',
  'settlement_stored',
  'step_contract_compiled',
  'tool_blocked',
  'tool_contract_unsatisfied_on_fallback',
  'turn_completed',
  'turn_started',
] as const);

export const SETTLEMENT_NAMES = Object.freeze([
  'settlement_stored',
  'settlement_receipt_allocated',
  'settlement_artifact_attached',
  'settlement_result_published',
  'settlement_republish_deferred',
  'settlement_republish_error',
  'settlement_republish_reconciled',
  'settlement_republish_refused',
  'settlement_degraded',
  'settlement_store_failed',
] as const);

const CONTEXT = { startedAtMs: Date.now() };
const base = (name: string, payload?: Record<string, unknown>) => ({
  activationId: 'act:totality',
  specialist: 'researcher',
  beadId: 'bd-totality',
  name,
  payload,
});

function isMapped(name: string): boolean {
  return mapNativeLifecycleEvent(base(name), CONTEXT, 1000) !== null;
}

function deliberatelyUnpersistedReason(name: string): string | undefined {
  const lifecycle = (NATIVE_LIFECYCLE_OBSERVABILITY_GAPS as unknown as Record<string, string> | undefined)?.[name];
  if (typeof lifecycle === 'string' && lifecycle.trim().length > 0) return lifecycle;
  // Undefined on pre-fix trees (fail-first run): treated as absent, so the totality test
  // names the missing events instead of crashing on the import.
  const deliberate = (NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED as unknown as Record<string, string> | undefined)?.[name];
  if (typeof deliberate === 'string' && deliberate.trim().length > 0) return deliberate;
  const session = (NATIVE_SESSION_OBSERVABILITY_GAPS as unknown as Record<string, string> | undefined)?.[name];
  if (typeof session === 'string' && session.trim().length > 0) return session;
  return undefined;
}

describe('native mapper totality (SPECIALISTS-101)', () => {
  it('inventory matches the emit sites (a new emit without an inventory update fails here)', () => {
    const host = readFileSync(new URL('../../../src/activation/native-host.ts', import.meta.url), 'utf-8');
    const publication = readFileSync(
      new URL('../../../src/activation/settlement-publication.ts', import.meta.url),
      'utf-8',
    );
    const reconcile = readFileSync(
      new URL('../../../src/activation/workspace-reconcile.ts', import.meta.url),
      'utf-8',
    );
    const found = new Set<string>();
    for (const text of [host, publication, reconcile]) {
      for (const match of text.matchAll(/emit\('([^']+)'/g)) found.add(match[1]!);
      for (const match of text.matchAll(/name:\s*'([^']+)'/g)) {
        const name = match[1]!;
        // Workspace-reconcile and host direct emits use the lifecycle vocabulary;
        // ignore non-lifecycle string literals that share the `name:` shape.
        if ((NATIVE_EMIT_INVENTORY as readonly string[]).includes(name)) found.add(name);
      }
    }
    // Dynamic ternary emits have no `emit('literal')` shape; they are still emit sites.
    for (const dynamic of [
      'escalation_raised',
      'escalation_resolved',
      'clarification_requested',
      'clarification_answered',
    ]) {
      if (host.includes(`'${dynamic}'`)) found.add(dynamic);
    }
    // lease_reconciled is emitted via workspace-reconcile (name: 'lease_reconciled').
    if (reconcile.includes(`'lease_reconciled'`)) found.add('lease_reconciled');

    const inventory = new Set<string>(NATIVE_EMIT_INVENTORY as readonly string[]);
    const missing = [...found].filter((name) => !inventory.has(name)).sort();
    const stale = [...inventory].filter((name) => !found.has(name)).sort();
    expect(
      missing,
      `emit sites without inventory entry (add each with an explicit disposition): ${missing.join(', ')}`,
    ).toEqual([]);
    expect(
      stale,
      `inventory entries with no emit site (remove or justify): ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('every emitted name has an explicit disposition: a mapper arm or a reasoned registry entry', () => {
    const failures: string[] = [];
    for (const name of NATIVE_EMIT_INVENTORY) {
      if (isMapped(name)) continue;
      const reason = deliberatelyUnpersistedReason(name);
      if (reason !== undefined) continue;
      failures.push(name);
    }
    expect(
      failures,
      `emitted names with NO disposition (neither a mapper arm nor a deliberately-unpersisted reason): ${failures.join(', ')}. ` +
        `Add a case arm in mapNativeLifecycleEvent or a reasoned entry in NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED.`,
    ).toEqual([]);
  });

  it('every deliberately-unpersisted entry carries a non-empty written reason', () => {
    const registry = (NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED as unknown as Record<string, string> | undefined) ?? {};
    expect(Object.keys(registry).length > 0, 'deliberately-unpersisted registry is missing').toBe(true);
    for (const [name, reason] of Object.entries(registry)) {
      expect(typeof reason === 'string' && reason.trim().length > 0, `${name} has an empty reason`).toBe(true);
    }
  });

  it('no previously-mapped name loses its arm', () => {
    // Arms that existed before SPECIALISTS-101 (lifecycle mapper only).
    for (const name of [
      'activation_started',
      'activation_settled',
      'activation_completed',
      'lease_acquired',
      'lease_denied',
      'lease_uncertain',
      'tool_blocked',
      'activation_failed',
      'activation_rejected',
    ]) {
      expect(isMapped(name), `previously-mapped ${name} lost its arm`).toBe(true);
    }
  });

  it('extension signals stay deliberately unpersisted and acquire no new surface', () => {
    for (const name of [
      'extension_discovery_sessions',
      'extension_tools_discovered',
      'extension_tools_refused',
    ]) {
      expect(isMapped(name), `${name} must NOT acquire a mapper arm`).toBe(false);
      const reason = (NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED as unknown as Record<string, string> | undefined)?.[name];
      expect(typeof reason === 'string' && reason.trim().length > 0, `${name} needs a written reason`).toBe(true);
      expect(reason, `${name} reason must state the emit site exists`).toMatch(/emit site/i);
      expect(reason, `${name} reason must state no surface exists`).toMatch(/no .* surface exists/i);
      expect(reason, `${name} reason must state deferral`).toMatch(/defer/i);
    }
  });

  it('model_fallback maps onto the existing shared model_change event (no invented fallback_step)', () => {
    const mapped = mapNativeLifecycleEvent(
      base('model_fallback', { from_model: 'prov/a', to_model: 'prov/b' }),
      CONTEXT,
      1000,
    );
    expect(mapped).not.toBeNull();
    expect(mapped).toMatchObject({ type: 'model_change', action: 'cycle_model', model: 'prov/b', previous_model: 'prov/a' });
  });
});

describe('settlement and fallback durability (SPECIALISTS-101)', () => {
  let tempRoot: string;
  let dbPath: string;
  let client: ReturnType<typeof createObservabilitySqliteClientAtPath> | null;
  let raw: Database | null;
  const scratchRoot = join(import.meta.dirname, '..', '..', '.phase7-test-scratch');

  beforeEach(() => {
    tempRoot = join(scratchRoot, `mapper-totality-${crypto.randomUUID()}`);
    mkdirSync(tempRoot, { recursive: true });
    dbPath = join(tempRoot, 'observability.db');
    client = null;
    raw = null;
  });

  afterEach(() => {
    try { client?.close(); } catch { /* ignore */ }
    try { raw?.close(); } catch { /* ignore */ }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it.each(SETTLEMENT_NAMES as unknown as string[])(
    'emitting %s produces a durable forensic row whose event_name equals the emitted name',
    (name) => {
      client = createObservabilitySqliteClientAtPath(dbPath);
      const sink = createActivationForensicSink(client!);
      const activationId = `act:settle-${name.replace(/[^a-z]/g, '')}`;
      sink.emit({
        activationId,
        attemptId: 'att:settle:1',
        participantId: 'specialist::researcher',
        specialist: 'researcher',
        beadId: 'bd-settle',
        name,
        payload: { note: 'totality probe', ref: 'ref-1', receipt: 'wr-1', entry: 'jent-1' },
      });
      client!.close();
      client = null;
      raw = new Database(dbPath);
      const rows = raw.query(
        'SELECT event_name FROM specialist_forensic_events WHERE job_id = ? ORDER BY seq',
      ).all(activationId) as Array<{ event_name: string }>;
      expect(
        rows.map((row) => row.event_name),
        `no durable row for ${name} (mapper returned null or writer dropped it)`,
      ).toContain(name);
    },
  );

  it('model_fallback produces a durable row via the shared model_change carrier', () => {
    client = createObservabilitySqliteClientAtPath(dbPath);
    const sink = createActivationForensicSink(client!);
    const activationId = 'act:fallback-probe';
    sink.emit({
      activationId,
      attemptId: 'att:fallback:1',
      participantId: 'specialist::researcher',
      specialist: 'researcher',
      beadId: 'bd-fallback',
      name: 'model_fallback',
      payload: { from_model: 'prov/a', to_model: 'prov/b', error_class: 'rate_limit', terminal: false },
    });
    client!.close();
    client = null;
    raw = new Database(dbPath);
    const rows = raw.query(
      'SELECT event_name FROM specialist_forensic_events WHERE job_id = ? ORDER BY seq',
    ).all(activationId) as Array<{ event_name: string }>;
    // Carrier decision: the existing shared `model_change` event, whose forensic name is model.changed.
    expect(rows.map((row) => row.event_name)).toContain('model.changed');
  });

  it('extension signals produce no forensic row (deliberately unpersisted, no new surface)', () => {
    client = createObservabilitySqliteClientAtPath(dbPath);
    const sink = createActivationForensicSink(client!);
    const activationId = 'act:extension-probe';
    for (const name of [
      'extension_discovery_sessions',
      'extension_tools_discovered',
      'extension_tools_refused',
    ]) {
      sink.emit({
        activationId,
        attemptId: 'att:ext:1',
        participantId: 'specialist::researcher',
        specialist: 'researcher',
        beadId: 'bd-ext',
        name,
        payload: { pinned: 'tool-a' },
      });
    }
    client!.close();
    client = null;
    raw = new Database(dbPath);
    const rows = raw.query(
      'SELECT event_name FROM specialist_forensic_events WHERE job_id = ?',
    ).all(activationId) as Array<{ event_name: string }>;
    expect(rows, 'extension signals must not create a persistence surface').toEqual([]);
  });
});
