import type { ForensicEvent } from './forensic-events.js';
/**
 * Canonical default LOG suppression policy.
 *
 * sp log, sp console LOG and the native Pi overlay must all use this
 * predicate so a persisted event has one inclusion rule across operator
 * surfaces. --all-events/verbose bypasses this predicate but never bypasses
 * forensic redaction.
 */
export declare function isForensicAgentInternal(event: ForensicEvent): boolean;
//# sourceMappingURL=forensic-presentation.d.ts.map