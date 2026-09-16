// Expected canonical event inventory for the XTRM-93 supervisor oracle.
// Node N3.0 (bead SPECIALISTS-95).
//
// WHAT THIS IS: a declarative manifest of which canonical signals MUST exist
// for which scenarios. It is authored from the canonical vocabulary — the T1
// producer taxonomy (docs/migrations/xtrm-93/n3/lanes/T1.md) and the merged
// N3 classification (docs/migrations/xtrm-93/n3/README.md) — NOT harvested
// from either runtime's observed output. That independence is the point: a
// differential harness alone is a bad oracle because legacy-emits-nothing +
// native-emits-nothing reads as PARITY (false green). This inventory fails
// when a producer or a mapper arm is missing, regardless of what either
// runtime happens to emit.
//
// HOW IT IS CHECKED: tests in supervisor.test.ts (describe
// 'canonical event inventory oracle') read the cited SOURCE files as text and
// assert the cited evidence needles exist. No runtime is executed, no event
// stream is observed, and nothing here regenerates itself from observed
// events — this file has no imports and no code path that touches runtime
// output. Entries whose evidence is missing because the gap is still open
// (gapRef set) FAIL until a follow-on node closes the gap; that failure is
// the oracle working, not the oracle being wrong.
//
// DO NOT "fix" a failing entry by editing the needle to match the current
// source. If the evidence is missing, the gap is open: record it, do not
// redefine the contract to fit the implementation.

export interface CanonicalInventoryEvidence {
  /** Which side of the contract this needle pins. */
  side: 'legacy-producer' | 'native-producer' | 'native-mapper' | 'reader';
  /** Repo-relative source path inspected as text (never executed). */
  file: string;
  /** Literal substring that must be present in that file. */
  needle: string;
}

export interface CanonicalInventoryEntry {
  id: string;
  scenario: string;
  /** Canonical signal the contract expects for the scenario. */
  signal: string;
  /** Ordered so the failure message names the FIRST missing link. */
  evidence: readonly CanonicalInventoryEvidence[];
  /** How a pure differential (legacy-vs-native output) comparison reads today. */
  differentialReads: 'parity' | 'divergence';
  /** Null for parity rows both engines satisfy; otherwise the owning gap. */
  gapRef: string | null;
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
    differentialReads: 'parity',
    gapRef: null,
  },
  {
    id: 'terminal-complete',
    scenario: 'terminal settlement is observable on success',
    signal: 'run_complete (canonical job.completed)',
    evidence: [
      { side: 'legacy-producer', file: 'src/specialist/supervisor.ts', needle: "createRunCompleteEvent('COMPLETE'" },
      { side: 'native-mapper', file: 'src/specialist/native-activation-observability.ts', needle: "case 'activation_completed'" },
    ],
    differentialReads: 'parity',
    gapRef: null,
  },
  {
    id: 'legacy-stale-warning',
    scenario: 'a stalled legacy job emits a stall signal',
    signal: 'stale_warning (canonical process_health.stale_detected)',
    evidence: [
      { side: 'legacy-producer', file: 'src/specialist/supervisor.ts', needle: 'createStaleWarningEvent(' },
    ],
    differentialReads: 'parity',
    gapRef: null,
  },
  {
    id: 'native-stale-warning',
    scenario: 'a stalled native activation emits a stall signal',
    signal: 'stale_warning (canonical process_health.stale_detected)',
    evidence: [
      { side: 'native-producer', file: 'src/activation/native-host.ts', needle: "emit('stale_warning'" },
    ],
    differentialReads: 'parity',
    gapRef: 'NATIVE_GAP (T4/T0d): createStaleWarningEvent has no call site outside supervisor.ts; native stall_gaps_json is unconditionally empty.',
  },
  {
    id: 'model-fallback-mapped',
    scenario: 'a model fallback during a native session is observable',
    signal: 'model_fallback',
    evidence: [
      { side: 'native-producer', file: 'src/activation/native-host.ts', needle: "emit('model_fallback'" },
      { side: 'native-mapper', file: 'src/specialist/native-activation-observability.ts', needle: "case 'model_fallback'" },
    ],
    differentialReads: 'parity',
    gapRef: 'Unlisted drop (T5/T0f): 5 emit sites, no mapper arm, absent from both gap lists — silently discarded by BOTH engines, so differential reads parity.',
  },
  {
    id: 'settlement-stored-durable',
    scenario: 'a completed settlement publication leaves a durable event row',
    signal: 'settlement_stored',
    evidence: [
      { side: 'native-producer', file: 'src/activation/settlement-publication.ts', needle: "emit('settlement_stored'" },
      { side: 'native-mapper', file: 'src/specialist/native-activation-observability.ts', needle: "'settlement_stored'" },
    ],
    differentialReads: 'parity',
    gapRef: 'NATIVE_GAP via default-null (T9): mapNativeLifecycleEvent default returns null; 0 durable rows, degradation was stderr-only.',
  },
  {
    id: 'token-metric-series',
    scenario: 'per-job token usage projects onto the token metric',
    signal: 'xtrm_llm_tokens_total',
    evidence: [
      { side: 'reader', file: 'src/specialist/prometheus-projection.ts', needle: 'latest.token_usage' },
    ],
    differentialReads: 'parity',
    gapRef: 'Fixed by PR #377 (was a shared reader defect: 0 series for BOTH engines, invisible to differential). Reader now reads nested token_usage first with flat fallback.',
  },
  {
    id: 'extension-discovery-evidence',
    scenario: 'an extension admission decision leaves reconstructable evidence',
    signal: 'extension_discovery_sessions',
    evidence: [
      { side: 'native-producer', file: 'src/activation/native-host.ts', needle: "'extension_discovery_sessions'" },
      { side: 'native-mapper', file: 'src/specialist/native-activation-observability.ts', needle: "'extension_discovery_sessions'" },
    ],
    differentialReads: 'parity',
    gapRef: 'Undocumented drop (T0f): 1 of the 18 emitted-but-unmapped names absent from both gap lists. The refusal verdict persists; the audit trail does not.',
  },
];
