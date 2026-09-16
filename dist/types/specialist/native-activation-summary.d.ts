import type { ForensicEventRecord } from './observability-sqlite.js';
export interface NativeActivationSummary {
    activation_id: string;
    specialist: string;
    bead_id?: string;
    /** Last-known lifecycle state derived from the latest forensic event. */
    state: string;
    last_event: string;
    last_event_at_ms: number;
    first_event_at_ms: number;
    /** Window-scoped row count: rows for this activation within the selection
     * window, NOT a lifetime total across unselected history. XTRM-93 N3
     * (unitAI-kmbb9): the ps selection is activation-bounded (latest 20
     * activations, all of each one's events), so the window spans each selected
     * activation's full history within --since. Named window_* so consumers
     * cannot mistake it for a table total. */
    window_event_count: number;
    /** Window-scoped turn count (turn.summarized in window), NOT a lifetime total. See below. */
    window_turns: number;
    pi_session_id?: string;
    /** Error / stop reason for failed or disposed activations. */
    detail?: string;
}
/**
 * Group forensic activation rows by job (activation) id and derive one
 * last-known summary per activation, newest first. Pure: takes rows, returns
 * summaries. Rows are expected from the activation-first selection in
 * src/cli/ps.ts (listNativeActivationIds to pick the latest-N act: ids from
 * specialist_jobs, then readForensicEventsForActivations for their events),
 * but any order is tolerated —
 * latest is picked by (t, seq).
 */
export declare function summarizeNativeActivations(rows: readonly ForensicEventRecord[]): NativeActivationSummary[];
export declare function formatActivationAge(nowMs: number, atMs: number): string;
//# sourceMappingURL=native-activation-summary.d.ts.map