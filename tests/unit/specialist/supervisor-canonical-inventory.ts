// Expected canonical event inventory for the XTRM-93 supervisor oracle.
// Node N3.0 (bead SPECIALISTS-95), expectation model repaired by SPECIALISTS-103.
//
// WHAT THIS IS: a declarative manifest of which canonical signals MUST exist
// for which scenarios. It is authored from the canonical vocabulary — the T1
// producer taxonomy (docs/migrations/xtrm-93/n3/lanes/T1.md) and the merged
// N3 classification (docs/migrations/xtrm-93/n3/README.md) — NOT harvested
// from either runtime's observed output. That independence is the point: a
// differential harness alone is a bad oracle because legacy-emits-nothing +
// native-emits-nothing reads as PARITY (false green).
//
// HOW IT IS CHECKED (SPECIALISTS-103 repair): every entry declares an explicit
// `expectation` class. The evaluator in supervisor.test.ts (`canonical event
// inventory oracle`) executes the proof for that class against an ISOLATED
// store — it never passes on source-string presence:
//
// - EXPECTED_DURABLE: satisfied ONLY when driving the named canonical event
//   through the real mapper + writer produces a durable forensic row whose
//   event_name equals the emitted name. A registry key, comment, gap-list
//   entry, fixture, or unrelated literal cannot satisfy it by construction:
//   the check never reads source text.
// - EXPECTED_ABSENT_WITH_REASON: satisfied ONLY when (a) the mapper returns
//   null for the name, (b) a non-empty written reason exists in
//   NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED, and (c) emitting the name
//   against an isolated store produces zero forensic rows. An empty or
//   missing reason FAILS: absence must be a decision, not an omission.
// - EXPECTED_RUNTIME_ONLY: the signal is real but is neither a single durable
//   row nor a deliberate absence (e.g. an aggregated reader projection).
//   Satisfied ONLY by executing the runtime path and observing the derived
//   output. Each entry states why it is neither durable nor absent.
//
// The legacy `evidence` needles are retained as documentation (where a human
// looks), but the evaluator MUST NOT use them for pass/fail. M5 proves a
// comment or unrelated string containing the event name does not satisfy a
// durable expectation.
//
// DO NOT "fix" a failing entry by editing data to match the current source.
// If the proof fails, the gap is open: record it, do not redefine the
// contract to fit the implementation.

// COVERAGE BOUNDARY — RESUME LEG (SPECIALISTS-122). The entry
// `resume-reentry-status-change` covers the MACHINE-OBSERVABLE half of
// `waiting -> coordinator resume -> running -> terminal`: the native
// `activation_resumed` mapper arm, its durable `job.status_changed` row, and the
// persisted `running`/`waiting` pair that distinguishes it from
// `activation_settled` (which produces the same forensic NAME and the mirrored
// pair). It does NOT cover the coordinator-REPLY half: `clarification_answered`
// and `escalation_resolved` have no mapper arm and are recorded as DELIBERATELY
// unpersisted with a written reason in NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED
// (src/specialist/native-activation-observability.ts), so an EXPECTED_DURABLE
// expectation for a reply event would be WRONG. This entry is not full coverage
// of `waiting -> reply -> active -> terminal`.
//
// The differential corpus scenarios for this leg, DX-TEL-005 (ordered
// status_change after a settle-then-resume) and DX-CTL-003 (resume), are DEFINED
// BUT NOT EXECUTABLE: `L-ADAPTER`/`N-ADAPTER` have zero implementations in src/
// or tests/, and docs/migrations/xtrm-93/10-differential-acceptance-corpus.md:145
// states the corpus is a design document, not an executable suite. This
// inventory entry is therefore the ONLY DEFAULT-SUITE oracle binding the
// DURABLE resume row. The mapper ARM is separately executed, un-quarantined, by
// tests/unit/specialist/phase-accounting-invariant.test.ts (lines ~471-480) and
// tests/unit/specialist/native-activation-observability.test.ts (lines ~341-343);
// what is unique here is the read-back of the PERSISTED row from
// specialist_forensic_events, which those mapper-level assertions do not bind.
//
// PRODUCER WIRING IS NOT BOUND (SPECIALISTS-122 round 2, finding 7). This entry
// drives the emit NAME through the real mapper and the real writer; it does NOT
// prove that the native host ever emits `activation_resumed`. Commenting out the
// producer emit in src/activation/native-host.ts leaves the canonical oracle
// GREEN — the inventory is not a producer-coverage oracle. Producer wiring is
// covered only by the gated live smoke test
// tests/integration/activation/native-activation.live.test.ts.

export type CanonicalExpectationClass =
  | 'EXPECTED_DURABLE'
  | 'EXPECTED_ABSENT_WITH_REASON'
  | 'EXPECTED_RUNTIME_ONLY';

/**
 * The differential note states ONLY how legacy/native observations compare, and
 * ONLY where a comparison is meaningful. It is DERIVED from the expectation class
 * so it can never contradict it.
 *
 * SPECIALISTS-103 follow-on: the retired `differentialReads: 'parity' | 'divergence'`
 * field was removed. It had exactly one consumer (this failure message), every one of
 * its eight values was the constant 'parity', and that constant made the message assert
 * "both engines satisfy this row" for rows where the assertion is FALSE:
 *   - EXPECTED_ABSENT_WITH_REASON: neither engine persists the row, by decision;
 *   - EXPECTED_RUNTIME_ONLY: durable read-back is outside the row's contract.
 * A constant whose only effect is a misleading sentence is not differential information.
 * The real differential information is execution-backed and lives in `durable.via`
 * ('native-lifecycle' | 'legacy-append') and in the `evidence` sides.
 */
export function differentialNoteFor(expectation: CanonicalExpectationClass): string {
  switch (expectation) {
    case 'EXPECTED_DURABLE':
      // A comparison IS meaningful here: both engines are expected to produce the row.
      return 'both engines are expected to satisfy this row.';
    case 'EXPECTED_ABSENT_WITH_REASON':
      return 'NOT parity: this row is a deliberate absence, so neither engine persists it by decision. An empty row on both sides is NOT both-sides-satisfy.';
    case 'EXPECTED_RUNTIME_ONLY':
      return 'NOT durable parity: this row is a runtime projection, so a durable legacy-vs-native comparison is outside its contract.';
    default: {
      const never: never = expectation;
      return never;
    }
  }
}

export interface CanonicalInventoryEvidence {
  /** Which side of the contract this needle pins (documentation only). */
  side: 'legacy-producer' | 'native-producer' | 'native-mapper' | 'reader';
  /** Repo-relative source path (documentation only; never read for pass/fail). */
  file: string;
  /** Literal substring (documentation only; never matched for pass/fail). */
  needle: string;
}

/** Execution proof for EXPECTED_DURABLE: drive the event, expect the row. */
export interface CanonicalDurableProof {
  /** How the evaluator drives the event. */
  via: 'native-lifecycle' | 'legacy-append';
  /** Native lifecycle name to emit via the forensic sink (via native-lifecycle). */
  emitName?: string;
  /** Representative payload for the emit (covers all producer keys where relevant). */
  emitPayload?: Record<string, unknown>;
  /** Timeline type to construct + append (via legacy-append). */
  legacyTimelineType?: 'stale_warning';
  /** Forensic event_name that must appear in specialist_forensic_events. */
  expectedForensicName: string;
  /** When true, the read-back row must also carry the fallback diagnostics. */
  assertFallbackDiagnostics?: boolean;
  /**
   * SPECIALISTS-122: generic read-back assertions on the PERSISTED row's event
   * JSON. Required whenever the forensic NAME alone does not identify the event
   * (two lifecycle names collapsing onto one carrier produce one name).
   */
  assertPersistedFields?: readonly CanonicalPersistedFieldAssertion[];
}

/**
 * Generic read-back assertion over the PERSISTED forensic row's event JSON
 * (SPECIALISTS-122).
 *
 * WHY A PATH AND NOT A PER-EVENT FLAG: `assertFallbackDiagnostics` above is a
 * hard-coded boolean whose key list and renames belong to model_fallback; a
 * second flag for `status`/`previous_status` would repeat that defect instead of
 * generalising it. A dot path plus an expected value is event-agnostic — a new
 * entry asserts a new shape with no new code — and it is resolved against the
 * row read back from `specialist_forensic_events`, so it binds the WRITER's
 * output rather than the mapper's return value.
 *
 * WHY IT DISCRIMINATES: `activation_resumed` and `activation_settled` both map
 * to the SAME forensic name `job.status_changed`, so an entry asserting only the
 * name passes for either. The pair asserted for the resume leg
 * (`status: running`, `previous_status: waiting`) is the resume direction alone;
 * the settled leg persists the mirror image and FAILS.
 *
 * A missing path resolves to `undefined`, which is never strictly equal to the
 * expected value — a renamed or absent field FAILS rather than passing vacuously.
 */
export interface CanonicalPersistedFieldAssertion {
  /** Dot path into the persisted event JSON, e.g. `body.legacy_timeline_event.status`. */
  path: string;
  /** Value the persisted field must equal (strict `===`). */
  equals: string | number | boolean | null;
}

/** Execution proof for EXPECTED_ABSENT_WITH_REASON: decision, not omission. */
export interface CanonicalAbsentProof {
  /** Key in NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED carrying the reason. */
  unpersistedKey: string;
  /** Native lifecycle name to emit; must yield zero forensic rows. */
  emitName: string;
}

/** Execution proof for EXPECTED_RUNTIME_ONLY: derived output, not a row. */
export interface CanonicalRuntimeProof {
  /** Which runtime check the evaluator executes. */
  check: 'token-metric-projection';
  /** Why this signal is neither a single durable row nor a deliberate absence. */
  reason: string;
}

export interface CanonicalInventoryEntry {
  id: string;
  scenario: string;
  /** Canonical signal the contract expects for the scenario. */
  signal: string;
  /** Ordered so the failure message names the FIRST missing link. */
  evidence: readonly CanonicalInventoryEvidence[];
  /** Null for parity rows both engines satisfy; otherwise the owning gap. */
  gapRef: string | null;
  /** SPECIALISTS-103: explicit class. No entry may leave this implicit. */
  expectation: CanonicalExpectationClass;
  /** Required when expectation is EXPECTED_DURABLE. */
  durable?: CanonicalDurableProof;
  /** Required when expectation is EXPECTED_ABSENT_WITH_REASON. */
  absent?: CanonicalAbsentProof;
  /** Required when expectation is EXPECTED_RUNTIME_ONLY. */
  runtime?: CanonicalRuntimeProof;
}

export const SUPERVISOR_CANONICAL_INVENTORY: readonly CanonicalInventoryEntry[] = [
  {
    id: 'start-boundary',
    scenario: 'job start is observable for a fresh run',
    signal: 'run_start (canonical job.started)',
    evidence: [
      { side: 'legacy-producer', file: 'src/specialist/supervisor.ts', needle: 'createRunStartEvent(' },
      { side: 'native-mapper', file: 'src/specialist/native-activation-observability.ts', needle: "case 'activation_started'" },
    ],
    gapRef: null,
    expectation: 'EXPECTED_DURABLE',
    durable: {
      via: 'native-lifecycle',
      emitName: 'activation_started',
      emitPayload: { pi_session_id: 'pi-oracle-start' },
      expectedForensicName: 'job.started',
    },
  },
  {
    id: 'terminal-complete',
    scenario: 'terminal settlement is observable on success',
    signal: 'run_complete (canonical job.completed)',
    evidence: [
      { side: 'legacy-producer', file: 'src/specialist/supervisor.ts', needle: "createRunCompleteEvent('COMPLETE'" },
      { side: 'native-mapper', file: 'src/specialist/native-activation-observability.ts', needle: "case 'activation_completed'" },
    ],
    gapRef: null,
    expectation: 'EXPECTED_DURABLE',
    durable: {
      via: 'native-lifecycle',
      emitName: 'activation_completed',
      emitPayload: { pi_session_id: 'pi-oracle-terminal', output: 'oracle output' },
      expectedForensicName: 'job.completed',
    },
  },
  {
    id: 'resume-reentry-status-change',
    scenario: 'a coordinator resume re-enters the activation as running (waiting -> resume -> running)',
    signal: 'activation_resumed (canonical job.status_changed, running <- waiting)',
    evidence: [
      { side: 'native-mapper', file: 'src/specialist/native-activation-observability.ts', needle: "case 'activation_resumed'" },
      { side: 'native-producer', file: 'src/activation/native-host.ts', needle: "emit('activation_resumed'" },
      { side: 'native-mapper', file: 'src/specialist/timeline-events.ts', needle: 'createStatusChangeEvent(' },
    ],
    // The NAME is NON-DISCRIMINATING: activation_settled also maps through
    // createStatusChangeEvent — (waiting, running) instead of (running, waiting)
    // — and yields the identical forensic name `job.status_changed`. An entry
    // asserting only that a `job.status_changed` row exists would pass for a
    // settled row and prove nothing about resume. The durable proof below
    // therefore asserts the PERSISTED status pair, not just the row's name.
    // Contract refs: docs/migrations/xtrm-93/n3/lanes/T1.md (canonical
    // job.status_changed; activation_resumed maps to status_change('running',
    // 'waiting')), T4.md ('explicit resume and explicit retry must append
    // status_change(...->running)'), README.md section 3.5 (resume-vs-retry
    // distinguishability).
    gapRef: null,
    expectation: 'EXPECTED_DURABLE',
    durable: {
      via: 'native-lifecycle',
      emitName: 'activation_resumed',
      expectedForensicName: 'job.status_changed',
      assertPersistedFields: [
        { path: 'body.legacy_timeline_event.status', equals: 'running' },
        { path: 'body.legacy_timeline_event.previous_status', equals: 'waiting' },
      ],
    },
  },
  {
    id: 'legacy-stale-warning',
    scenario: 'a stalled legacy job emits a stall signal',
    signal: 'stale_warning (canonical process_health.stale_detected)',
    evidence: [
      { side: 'legacy-producer', file: 'src/specialist/supervisor.ts', needle: 'createStaleWarningEvent(' },
    ],
    gapRef: null,
    expectation: 'EXPECTED_DURABLE',
    durable: {
      via: 'legacy-append',
      legacyTimelineType: 'stale_warning',
      expectedForensicName: 'process_health.stale_detected',
    },
  },
  {
    id: 'native-stale-warning',
    scenario: 'a stalled native activation emits a stall signal',
    signal: 'stale_warning (canonical process_health.stale_detected)',
    evidence: [
      { side: 'native-producer', file: 'src/activation/native-host.ts', needle: "name: 'stale_warning'" },
    ],
    gapRef: 'Fixed by SPECIALISTS-102 / PR #387 (was NATIVE_GAP T4/T0d: no native watchdog). The native producer is the tool-duration checker (checkToolDuration) emitting object-form name: \'stale_warning\' (native-host.ts:2146), and the mapper arm persists it (native-activation-observability.ts:473); stall_gaps_json aggregates tool_duration rows. The pre-fix gap text is HISTORICAL.',
    expectation: 'EXPECTED_DURABLE',
    durable: {
      via: 'native-lifecycle',
      emitName: 'stale_warning',
      emitPayload: { silence_ms: 1000, threshold_ms: 500 },
      expectedForensicName: 'process_health.stale_detected',
    },
  },
  {
    id: 'model-fallback-mapped',
    scenario: 'a model fallback during a native session is observable',
    signal: 'model_fallback',
    evidence: [
      { side: 'native-producer', file: 'src/activation/native-host.ts', needle: "emit('model_fallback'" },
      { side: 'native-mapper', file: 'src/specialist/native-activation-observability.ts', needle: "case 'model_fallback'" },
    ],
    // SPECIALISTS-103: the pre-fix gap text ("5 emit sites, no mapper arm") is
    // HISTORICAL. The mapper arm exists (SPECIALISTS-101) and now preserves the
    // full diagnostic payload (SPECIALISTS-103). The gap is closed; the proof
    // below asserts the durable payload, not merely the carrier.
    gapRef: null,
    expectation: 'EXPECTED_DURABLE',
    durable: {
      via: 'native-lifecycle',
      emitName: 'model_fallback',
      emitPayload: {
        from_model: 'prov/a',
        to_model: 'prov/b',
        error_class: 'rate_limit',
        terminal: false,
        note: 'oracle probe',
        attempt_n: 2,
        resolved_model: 'prov/b-resolved',
      },
      expectedForensicName: 'model.changed',
      assertFallbackDiagnostics: true,
    },
  },
  {
    id: 'settlement-stored-durable',
    scenario: 'a completed settlement publication leaves a durable event row',
    signal: 'settlement_stored',
    evidence: [
      { side: 'native-producer', file: 'src/activation/settlement-publication.ts', needle: "emit('settlement_stored'" },
      { side: 'native-mapper', file: 'src/specialist/native-activation-observability.ts', needle: "'settlement_stored'" },
    ],
    // SPECIALISTS-103: the pre-fix gap text ("default returns null; 0 durable
    // rows") is HISTORICAL. The settlement arms exist (SPECIALISTS-101); the
    // proof below asserts the durable row.
    gapRef: null,
    expectation: 'EXPECTED_DURABLE',
    durable: {
      via: 'native-lifecycle',
      emitName: 'settlement_stored',
      emitPayload: { note: 'oracle probe', ref: 'ref-oracle', receipt: 'wr-oracle', entry: 'jent-oracle' },
      expectedForensicName: 'settlement_stored',
    },
  },
  {
    id: 'token-metric-series',
    scenario: 'per-job token usage projects onto the token metric',
    signal: 'xtrm_llm_tokens_total',
    evidence: [
      { side: 'reader', file: 'src/specialist/prometheus-projection.ts', needle: 'latest.token_usage' },
    ],
    gapRef: 'Fixed by PR #377 (was a shared reader defect: 0 series for BOTH engines, invisible to differential). Reader now reads nested token_usage first with flat fallback.',
    expectation: 'EXPECTED_RUNTIME_ONLY',
    runtime: {
      check: 'token-metric-projection',
      reason: 'The signal is an AGGREGATED reader projection over the token trajectory (writer nests counters under token_usage; reader renders xtrm_llm_tokens_total per direction), not a single durable forensic row — so no one event_name proves it. It is not absent either: the writer and reader both exist and the series must be non-empty. Durable-row and absent-with-reason checks are both the wrong shape; only executing writer -> aggregate -> render proves it.',
    },
  },
  {
    id: 'extension-discovery-evidence',
    scenario: 'an extension admission decision leaves reconstructable evidence',
    signal: 'extension_discovery_sessions',
    evidence: [
      { side: 'native-producer', file: 'src/activation/native-host.ts', needle: "'extension_discovery_sessions'" },
      { side: 'native-mapper', file: 'src/specialist/native-activation-observability.ts', needle: "'extension_discovery_sessions'" },
    ],
    // SPECIALISTS-103: PR #382 made the absence EXPLICIT (operator ruling:
    // extension resolution out of scope; no table/column/writer exists and
    // creating one is deferred). The pre-fix text ("absent from both gap
    // lists — silently discarded") described a silent drop; the current state
    // is a reasoned decision. The durable proof for this name FAILS (no row);
    // this entry asserts the absence is a decision with a written reason.
    gapRef: 'Deliberate absence (PR #382, operator ruling): emit site exists; no extension telemetry surface exists and creating one is deferred. Proven by NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED reason, not by silence.',
    expectation: 'EXPECTED_ABSENT_WITH_REASON',
    absent: {
      unpersistedKey: 'extension_discovery_sessions',
      emitName: 'extension_discovery_sessions',
    },
  },
];
