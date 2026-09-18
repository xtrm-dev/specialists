// tests/unit/specialist/supervisor-canonical-oracle.test.ts
// Canonical N3 event-inventory oracle, extracted from the quarantined
// tests/unit/specialist/supervisor.test.ts (SPECIALISTS-118, XTRM-93 N3).
//
// WHY A SEPARATE FILE: the oracle describe-block lived inside supervisor.test.ts,
// which is quarantined in vitest.config.ts (FIFO hang, bead unitAI-9n93) and
// reachable only via SPECIALISTS_TEST_QUARANTINED=1. The oracle is a named N3
// acceptance surface whose freeze invariant requires mandatory CI to turn RED
// when it breaks — so it runs here, in the DEFAULT suite, with no quarantine
// env var. The block was EXTRACTED OUT OF supervisor.test.ts (a SPECIALISTS-118
// follow-up deleted the original there); this file is now the SOLE copy. Do NOT
// weaken any assertion here to fit the source: if the proof fails, the gap is
// open (see supervisor-canonical-inventory.ts).
//
// ISOLATION: this file deliberately does NOT import Supervisor and does NOT
// install the node:child_process mock. Every proof drives REAL mapper/writer
// code against an ISOLATED store (worktree-local scratch under
// tests/unit/.phase7-test-scratch, never the authoritative observability.db).
import { describe, it, expect } from 'vitest';
import { differentialNoteFor, SUPERVISOR_CANONICAL_INVENTORY } from './supervisor-canonical-inventory.js';
import type { CanonicalExpectationClass } from './supervisor-canonical-inventory.js';
import { runAbsentCheck, runDurableEntryCheck, runTokenMetricProjectionCheck } from './supervisor-canonical-proof.js';

describe('canonical event inventory oracle (XTRM-93 N3.0, SPECIALISTS-103 repair)', () => {
  // Execution-backed oracle: each entry declares an explicit `expectation`
  // class and the proof for that class runs REAL code against an ISOLATED
  // store. Source-string presence is NEVER sufficient: the `evidence` needles
  // in the inventory are documentation only and are not read here. Entries
  // with gapRef set are KNOWN-OPEN gaps owned by follow-on nodes — their
  // failure is the oracle working. Do not edit the manifest to fit the source.
  for (const entry of SUPERVISOR_CANONICAL_INVENTORY) {
    it(`${entry.id}: ${entry.scenario}`, () => {
      // The class must be explicit: no entry may leave it implicit.
      expect(
        ['EXPECTED_DURABLE', 'EXPECTED_ABSENT_WITH_REASON', 'EXPECTED_RUNTIME_ONLY'].includes(entry.expectation),
        `[oracle] ${entry.id}: missing explicit expectation class`,
      ).toBe(true);
      try {
        if (entry.expectation === 'EXPECTED_DURABLE') {
          if (!entry.durable) throw new Error(`[oracle] ${entry.id}: EXPECTED_DURABLE without a durable proof`);
          runDurableEntryCheck(entry.durable);
        } else if (entry.expectation === 'EXPECTED_ABSENT_WITH_REASON') {
          if (!entry.absent) throw new Error(`[oracle] ${entry.id}: EXPECTED_ABSENT_WITH_REASON without an absent proof`);
          runAbsentCheck(entry.absent);
        } else {
          if (!entry.runtime) throw new Error(`[oracle] ${entry.id}: EXPECTED_RUNTIME_ONLY without a runtime proof`);
          if (entry.runtime.check !== 'token-metric-projection') {
            throw new Error(`[oracle] ${entry.id}: unknown runtime check "${(entry.runtime as { check: string }).check}"`);
          }
          runTokenMetricProjectionCheck();
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        expect(
          false,
          `[oracle] ${entry.id}: scenario "${entry.scenario}" expects ${entry.expectation} signal ` +
          `"${entry.signal}" but the proof failed: ${detail}` +
          (entry.gapRef ? ` (${entry.gapRef})` : '') +
          ` Differential: ${differentialNoteFor(entry.expectation)}` +
          (entry.gapRef ? ' A parity reading here is a FALSE GREEN.' : ''),
        ).toBe(true);
      }
    });
  }
});

// Manifest-integrity floor (SPECIALISTS-118, XTRM-93 N3 freeze invariant): the
// oracle above iterates the manifest, so deleting entries would silently narrow
// what CI enforces while staying green. This is a LOWER BOUND fixed at the
// SPECIALISTS-103 entry count — adding entries (as a later programme issue
// does) can never fail it; only gutting the manifest turns it RED.
const MIN_CANONICAL_INVENTORY_ENTRIES = 8;

// Exact-manifest pin (SPECIALISTS-122 round 2, probe P1). The floor alone does
// NOT catch removing a single entry once the inventory is larger than the
// floor: at 9 entries, deleting ANY one row still satisfies a floor of 8, so an
// older row (e.g. `start-boundary`) could be narrowed away silently while the
// oracle stayed green. Pin the exact id set AND each id's expectation class.
// Any add/remove/reclassify must now appear as a reviewable diff in this guard.
const CANONICAL_INVENTORY_MANIFEST: readonly { id: string; expectation: CanonicalExpectationClass }[] = [
  { id: 'start-boundary', expectation: 'EXPECTED_DURABLE' },
  { id: 'terminal-complete', expectation: 'EXPECTED_DURABLE' },
  { id: 'resume-reentry-status-change', expectation: 'EXPECTED_DURABLE' },
  { id: 'legacy-stale-warning', expectation: 'EXPECTED_DURABLE' },
  { id: 'native-stale-warning', expectation: 'EXPECTED_DURABLE' },
  { id: 'model-fallback-mapped', expectation: 'EXPECTED_DURABLE' },
  { id: 'settlement-stored-durable', expectation: 'EXPECTED_DURABLE' },
  { id: 'token-metric-series', expectation: 'EXPECTED_RUNTIME_ONLY' },
  { id: 'extension-discovery-evidence', expectation: 'EXPECTED_ABSENT_WITH_REASON' },
];

describe('canonical inventory manifest integrity (SPECIALISTS-118 floor; SPECIALISTS-122 exact pin)', () => {
  it(`pins the exact entry-id set and expectation class per id (floor: ${MIN_CANONICAL_INVENTORY_ENTRIES})`, () => {
    expect(
      SUPERVISOR_CANONICAL_INVENTORY.length,
      `[manifest] inventory holds ${SUPERVISOR_CANONICAL_INVENTORY.length} entries, below the SPECIALISTS-118 floor of ${MIN_CANONICAL_INVENTORY_ENTRIES}: entries were removed, narrowing what the oracle enforces while the oracle itself stays green.`,
    ).toBeGreaterThanOrEqual(MIN_CANONICAL_INVENTORY_ENTRIES);
    const actual = SUPERVISOR_CANONICAL_INVENTORY.map((entry) => `${entry.id}:${entry.expectation}`);
    const pinned = CANONICAL_INVENTORY_MANIFEST.map((entry) => `${entry.id}:${entry.expectation}`);
    expect(
      actual,
      '[manifest] the inventory id:expectation set drifted from the pinned manifest: an entry was added, removed, renamed or reclassified without updating the guard — the oracle would enforce a different surface than CI reviewed.',
    ).toEqual(pinned);
  });

  it('represents every expectation class at least once', () => {
    const required: CanonicalExpectationClass[] = ['EXPECTED_DURABLE', 'EXPECTED_ABSENT_WITH_REASON', 'EXPECTED_RUNTIME_ONLY'];
    for (const cls of required) {
      expect(
        SUPERVISOR_CANONICAL_INVENTORY.some((entry) => entry.expectation === cls),
        `[manifest] no inventory entry declares expectation class "${cls}": the oracle would stop enforcing that class while staying green.`,
      ).toBe(true);
    }
  });
});
