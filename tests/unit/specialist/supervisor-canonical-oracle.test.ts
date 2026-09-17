// tests/unit/specialist/supervisor-canonical-oracle.test.ts
// Canonical N3 event-inventory oracle, extracted from the quarantined
// tests/unit/specialist/supervisor.test.ts (SPECIALISTS-118, XTRM-93 N3).
//
// WHY A SEPARATE FILE: the oracle describe-block lived inside supervisor.test.ts,
// which is quarantined in vitest.config.ts (FIFO hang, bead unitAI-9n93) and
// reachable only via SPECIALISTS_TEST_QUARANTINED=1. The oracle is a named N3
// acceptance surface whose freeze invariant requires mandatory CI to turn RED
// when it breaks — so it runs here, in the DEFAULT suite, with no quarantine
// env var. The original block is left untouched in supervisor.test.ts; this file
// is the enforced copy. Do NOT weaken any assertion here to fit the source: if
// the proof fails, the gap is open (see supervisor-canonical-inventory.ts).
//
// ISOLATION: this file deliberately does NOT import Supervisor and does NOT
// install the node:child_process mock. Every proof drives REAL mapper/writer
// code against an ISOLATED store (worktree-local scratch under
// tests/unit/.phase7-test-scratch, never the authoritative observability.db).
import { describe, it, expect } from 'vitest';
import { differentialNoteFor, SUPERVISOR_CANONICAL_INVENTORY } from './supervisor-canonical-inventory.js';
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
