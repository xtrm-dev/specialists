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
    /** Window-scoped row count: rows in the queried window, NOT a lifetime total.
     * The ps query is row-capped (limit 1000), so one large activation can
     * consume the window and truncate others (row-cap starvation unitAI-kmbb9).
     * Named window_* so consumers cannot mistake it for a total. */
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
 * summaries. Rows are expected from readForensicEvents({jobIdPrefix: 'act:',
 * order: 'desc'}) over the shared families, but any order is tolerated —
 * latest is picked by (t, seq).
 */
export declare function summarizeNativeActivations(rows: readonly ForensicEventRecord[]): NativeActivationSummary[];
export declare function formatActivationAge(nowMs: number, atMs: number): string;
//# sourceMappingURL=native-activation-summary.d.ts.map