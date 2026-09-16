// Mutation matrix M1-M6 + model_fallback preservation matrix (SPECIALISTS-103).
//
// Each test names the mechanism visibly: no test passes on a source string,
// a registry key, or a comment. Durable expectations require a durable
// forensic row in an ISOLATED store; absent expectations require a non-empty
// written reason AND zero rows; the preservation matrix reads every producer
// field back from the durable row by value.
//
// Scope note: M1/M2 also have a manual source-mutation leg (arm removed /
// name moved into DELIBERATELY_UNPERSISTED) reported with raw output. The
// tests below pin the same semantics with injection (dropWrites) so the
// property is regressed permanently without editing shipped source.

import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createActivationForensicSink } from '../../../src/activation/forensic-sink.js';
import {
  mapNativeLifecycleEvent,
  NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED,
} from '../../../src/specialist/native-activation-observability.js';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';
import {
  differentialNoteFor,
  SUPERVISOR_CANONICAL_INVENTORY,
} from './supervisor-canonical-inventory.js';
import {
  runAbsentCheck,
  runDurableNativeCheck,
} from './supervisor-canonical-proof.js';

const SCRATCH_ROOT = join(import.meta.dirname, '..', '..', '.phase7-test-scratch');

function isolatedDb(tag: string): { dbPath: string; root: string } {
  const root = join(SCRATCH_ROOT, `${tag}-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return { dbPath: join(root, 'observability.db'), root };
}

function forensicNames(dbPath: string, jobId: string): string[] {
  const raw = new Database(dbPath);
  try {
    return (raw.query(
      'SELECT event_name FROM specialist_forensic_events WHERE job_id = ? ORDER BY seq',
    ).all(jobId) as Array<{ event_name: string }>).map((row) => row.event_name);
  } finally {
    raw.close();
  }
}

const FALLBACK_PAYLOAD = {
  from_model: 'prov/a',
  to_model: 'prov/b',
  error_class: 'rate_limit',
  terminal: false,
  note: 'matrix probe',
  attempt_n: 2,
  resolved_model: 'prov/b-resolved',
};

describe('oracle mutation matrix (SPECIALISTS-103)', () => {
  it('M1: without the mapper arm the durable expectation FAILS (and passes again with it)', () => {
    // The production arm exists: the positive leg passes.
    expect(mapNativeLifecycleEvent(
      { activationId: 'act:m1', specialist: 'researcher', name: 'model_fallback', payload: FALLBACK_PAYLOAD },
      { startedAtMs: Date.now() },
      1000,
    )).not.toBeNull();
    expect(() => runDurableNativeCheck({
      emitName: 'model_fallback',
      emitPayload: { ...FALLBACK_PAYLOAD },
      expectedForensicName: 'model.changed',
      assertFallbackDiagnostics: true,
    })).not.toThrow();

    // The negative leg uses a name with no arm (same state as a removed arm):
    // the mapper returns null and the durable check names the mapper link.
    expect(mapNativeLifecycleEvent(
      { activationId: 'act:m1', specialist: 'researcher', name: 'stale_warning', payload: {} },
      { startedAtMs: Date.now() },
      1000,
    )).toBeNull();
    expect(() => runDurableNativeCheck({
      emitName: 'stale_warning',
      emitPayload: {},
      expectedForensicName: 'process_health.stale_detected',
    })).toThrow(/mapper link MISSING/);
  });

  it('M2: an event name living ONLY in DELIBERATELY_UNPERSISTED does NOT satisfy a durable expectation', () => {
    // extension_discovery_sessions is the live instance: registry key present…
    const reason = (NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED as unknown as Record<string, string>)['extension_discovery_sessions'];
    expect(typeof reason === 'string' && reason.trim().length > 0).toBe(true);
    // …mapper returns null…
    expect(mapNativeLifecycleEvent(
      { activationId: 'act:m2', specialist: 'researcher', name: 'extension_discovery_sessions', payload: {} },
      { startedAtMs: Date.now() },
      1000,
    )).toBeNull();
    // …and the durable check FAILS naming the mapper link. The registry key
    // cannot substitute for the missing arm.
    expect(() => runDurableNativeCheck({
      emitName: 'extension_discovery_sessions',
      emitPayload: {},
      expectedForensicName: 'extension_discovery_sessions',
    })).toThrow(/mapper link MISSING/);
  });

  it('M3: deliberately-unpersisted event WITH a non-empty reason PASSES absent-with-reason', () => {
    expect(() => runAbsentCheck({
      unpersistedKey: 'extension_discovery_sessions',
      emitName: 'extension_discovery_sessions',
    })).not.toThrow();
  });

  it('M4: same event with an EMPTY or missing reason FAILS absent-with-reason', () => {
    // Missing key: the mapper is still null and zero rows still hold, but the
    // absence is an omission without a decision — must fail.
    expect(() => runAbsentCheck({
      unpersistedKey: 'no_such_key_oracle_probe',
      emitName: 'extension_discovery_sessions',
    })).toThrow(/reason MISSING or EMPTY/);
  });

  it('M5: a comment or unrelated string containing the event name does NOT satisfy a durable expectation', () => {
    // Plant the event name in a comment in an isolated scratch file. The
    // durable check never opens source files, so this changes nothing: with
    // writes dropped the check still fails on the missing row.
    const { root } = isolatedDb('oracle-m5-decoy');
    try {
      writeFileSync(
        join(root, 'decoy.ts'),
        `// model_fallback 'model.changed' — a comment mentioning the event\nconst decoy = 'model_fallback';\n`,
      );
      expect(() => runDurableNativeCheck({
        emitName: 'model_fallback',
        emitPayload: { ...FALLBACK_PAYLOAD },
        expectedForensicName: 'model.changed',
        dropWrites: true,
      })).toThrow(/writer link MISSING/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    // And positively: with writes enabled the row — not the comment — satisfies it.
    expect(() => runDurableNativeCheck({
      emitName: 'model_fallback',
      emitPayload: { ...FALLBACK_PAYLOAD },
      expectedForensicName: 'model.changed',
      assertFallbackDiagnostics: true,
    })).not.toThrow();
  });

  it('M6: mapped but never reaching a durable row does NOT satisfy a durable expectation', () => {
    // The mapper arm EXISTS (non-null)…
    expect(mapNativeLifecycleEvent(
      { activationId: 'act:m6', specialist: 'researcher', name: 'model_fallback', payload: FALLBACK_PAYLOAD },
      { startedAtMs: Date.now() },
      1000,
    )).not.toBeNull();
    // …but the writer is stubbed to drop (forced via dropWrites: the sink runs
    // the real mapper, the rows never land). The check must fail on the row.
    // Forced state: dropWrites stubs upsertStatusWithEvents to a no-op after
    // the mapper has already returned non-null (see supervisor-canonical-proof.ts).
    expect(() => runDurableNativeCheck({
      emitName: 'model_fallback',
      emitPayload: { ...FALLBACK_PAYLOAD },
      expectedForensicName: 'model.changed',
      dropWrites: true,
    })).toThrow(/writer link MISSING/);
  });
});

describe('model_fallback preservation matrix (SPECIALISTS-103)', () => {
  it('reads every producer field back from the durable row by value', () => {
    const { dbPath, root } = isolatedDb('oracle-preserve');
    try {
      const client = createObservabilitySqliteClientAtPath(dbPath);
      if (!client) throw new Error('isolated store unavailable');
      const sink = createActivationForensicSink(client);
      const activationId = `act:preserve-${crypto.randomUUID().slice(0, 8)}`;
      const attemptId = 'att:preserve:1';
      sink.emit({
        activationId,
        attemptId,
        participantId: 'specialist::researcher',
        specialist: 'researcher',
        beadId: 'bd-preserve',
        name: 'model_fallback',
        // Full producer payload: from_model, to_model, error_class, terminal,
        // note, attempt_n, resolved_model (union of the 5 native-host sites).
        payload: { ...FALLBACK_PAYLOAD },
      });
      client.close();

      const raw = new Database(dbPath);
      try {
        const rows = raw.query(
          'SELECT event_name, attempt_id, event_json FROM specialist_forensic_events WHERE job_id = ? ORDER BY seq',
        ).all(activationId) as Array<{ event_name: string; attempt_id: string | null; event_json: string }>;
        expect(rows.map((row) => row.event_name)).toContain('model.changed');
        const row = rows.find((candidate) => candidate.event_name === 'model.changed');
        if (!row) throw new Error('unreachable');
        // Attempt attribution stage: the row carries the emit's attempt.
        expect(row.attempt_id).toBe(attemptId);
        const parsed = JSON.parse(row.event_json) as {
          body?: { legacy_timeline_event?: Record<string, unknown> };
        };
        const timeline = parsed.body?.legacy_timeline_event ?? {};
        // Carrier assertion: the shared model_change carrier, cycle_model action.
        expect(timeline['type']).toBe('model_change');
        expect(timeline['action']).toBe('cycle_model');
        // Field-level read-back by value (every producer field PRESERVED):
        expect(timeline['previous_model']).toBe(FALLBACK_PAYLOAD.from_model);
        expect(timeline['model']).toBe(FALLBACK_PAYLOAD.to_model);
        expect(timeline['error_class']).toBe(FALLBACK_PAYLOAD.error_class);
        expect(timeline['terminal']).toBe(FALLBACK_PAYLOAD.terminal);
        expect(timeline['note']).toBe(FALLBACK_PAYLOAD.note);
        expect(timeline['attempt_n']).toBe(FALLBACK_PAYLOAD.attempt_n);
        expect(timeline['resolved_model']).toBe(FALLBACK_PAYLOAD.resolved_model);
      } finally {
        raw.close();
      }
      expect(forensicNames(dbPath, activationId)).toContain('model.changed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves terminal:true as well as terminal:false (boolean, not truthiness)', () => {
    const { dbPath, root } = isolatedDb('oracle-terminal');
    try {
      const client = createObservabilitySqliteClientAtPath(dbPath);
      if (!client) throw new Error('isolated store unavailable');
      const sink = createActivationForensicSink(client);
      const activationId = `act:terminal-${crypto.randomUUID().slice(0, 8)}`;
      sink.emit({
        activationId,
        attemptId: 'att:terminal:1',
        participantId: 'specialist::researcher',
        specialist: 'researcher',
        beadId: 'bd-terminal',
        name: 'model_fallback',
        payload: {
          from_model: 'prov/a',
          to_model: 'prov/b',
          error_class: 'auth',
          terminal: true,
          note: 'fallback unavailable: unresolvable',
          resolved_model: 'prov/a',
        },
      });
      client.close();
      const raw = new Database(dbPath);
      try {
        const rows = raw.query(
          'SELECT event_json FROM specialist_forensic_events WHERE job_id = ?',
        ).all(activationId) as Array<{ event_json: string }>;
        const timelines = rows.map((row) => (JSON.parse(row.event_json) as {
          body?: { legacy_timeline_event?: Record<string, unknown> };
        }).body?.legacy_timeline_event ?? {});
        const fallback = timelines.find((event) => event['type'] === 'model_change');
        expect(fallback?.['terminal']).toBe(true);
        expect(fallback?.['error_class']).toBe('auth');
      } finally {
        raw.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('canonical classification metadata cannot contradict the expectation class (SPECIALISTS-103 follow-on)', () => {
  // The retired field `differentialReads: 'parity' | 'divergence'` had exactly one
  // consumer: the oracle's failure message. Every one of its eight values was the
  // constant 'parity', and that constant made the message assert
  // "both engines satisfy this row" for rows where that is FALSE. The reconciliation
  // derives the wording from `expectation` (load-bearing) instead of from a redundant
  // constant, so the message can no longer contradict the class.

  it('the retired differentialReads field is GONE from the inventory (it cannot be reintroduced as a contradictory label)', () => {
    const withField = SUPERVISOR_CANONICAL_INVENTORY.filter(
      (entry) => Object.prototype.hasOwnProperty.call(entry, 'differentialReads'),
    );
    expect(withField.map((entry) => entry.id)).toEqual([]);
  });

  it('the evaluator no longer reads the retired field at all (the constant is out of the rendering path)', () => {
    const evaluator = readFileSync(join(__dirname, 'supervisor.test.ts'), 'utf8');
    expect(evaluator).not.toContain('differentialReads');
  });

  it('a DURABLE row RETAINS its intended differential information', () => {
    const note = differentialNoteFor('EXPECTED_DURABLE');
    // A legacy-vs-native comparison IS meaningful for a durable row.
    expect(note).toContain('both engines');
    expect(note).toMatch(/expected to satisfy/);
  });

  it('EXPECTED_ABSENT_WITH_REASON is NEVER rendered as feature parity', () => {
    const note = differentialNoteFor('EXPECTED_ABSENT_WITH_REASON');
    // Must not claim both sides satisfy the feature merely because both are empty.
    expect(note).not.toMatch(/both engines are expected to satisfy/);
    expect(note).toMatch(/\bNOT parity\b/);
    const absent = SUPERVISOR_CANONICAL_INVENTORY.filter(
      (entry) => entry.expectation === 'EXPECTED_ABSENT_WITH_REASON',
    );
    expect(absent.length).toBeGreaterThan(0);
    // Every absent row renders the same honest note, whatever its id.
    for (const entry of absent) {
      expect(differentialNoteFor(entry.expectation)).toMatch(/\bNOT parity\b/);
    }
  });

  it('EXPECTED_RUNTIME_ONLY never claims durable parity', () => {
    const note = differentialNoteFor('EXPECTED_RUNTIME_ONLY');
    expect(note).not.toMatch(/both engines are expected to satisfy/);
    expect(note).toMatch(/NOT durable parity/);
    const runtimeOnly = SUPERVISOR_CANONICAL_INVENTORY.filter(
      (entry) => entry.expectation === 'EXPECTED_RUNTIME_ONLY',
    );
    expect(runtimeOnly.length).toBeGreaterThan(0);
  });

  it('no entry of ANY class renders a parity-satisfaction claim it cannot support', () => {
    for (const entry of SUPERVISOR_CANONICAL_INVENTORY) {
      const note = differentialNoteFor(entry.expectation);
      const claimsSatisfaction = /both engines are expected to satisfy/.test(note);
      // Only a durable expectation may claim a meaningful two-engine comparison.
      expect(claimsSatisfaction).toBe(entry.expectation === 'EXPECTED_DURABLE');
    }
  });
});
