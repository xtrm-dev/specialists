/**
 * Cost breakdown Pi attaches to one usage record (`calculateCost` output).
 * Every component is optional: a provider or an older Pi build may omit it, and an
 * absent component is "Pi did not report this", never zero.
 */
export interface SessionUsageCost {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
}
/**
 * Pi's provider-reported `Usage`, preserved exactly as received (SPECIALISTS-120).
 *
 * The normalized `*_tokens` fields on {@link SessionTokenUsage} exist for compatibility with
 * older readers; they are a lossy projection. This object is the lossless one: every field Pi
 * sent survives, including provider-specific ones such as Anthropic's `cacheWrite1h`, and
 * including fields a future Pi version adds that Specialists does not know about yet.
 *
 * `reasoning` is a SUBSET of `output` in Pi's contract. It is carried for reporting only and
 * must never be added to `output` or to `totalTokens` when computing a total.
 */
export interface PiUsageVerbatim {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    /** Anthropic 1-hour cache writes, a subset of `cacheWrite`. */
    cacheWrite1h?: number;
    /** Reasoning tokens, a subset of `output`. Never additive. */
    reasoning?: number;
    /** Pi's precomputed sum: input + output + cacheRead + cacheWrite. */
    totalTokens?: number;
    cost?: SessionUsageCost;
    [key: string]: unknown;
}
export interface SessionTokenUsage {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_tokens?: number;
    cache_read_tokens?: number;
    /** `cacheWrite1h` — Anthropic 1-hour cache writes, a subset of cache_creation_tokens. */
    cache_write_1h_tokens?: number;
    reasoning_tokens?: number;
    tool_tokens?: number;
    total_tokens?: number;
    /**
     * Provenance of `total_tokens` (SPECIALISTS-120, criterion 4). `provider` means Pi reported
     * the total itself; `derived` means Specialists computed it from the provider's components
     * because Pi omitted it. The object-level `usage_source` stays `provider_usage` in both
     * cases (the components ARE provider-reported), so without this field a reader cannot tell
     * a measured total from our arithmetic.
     *
     * Absent means no total is present at all.
     */
    total_tokens_source?: 'provider' | 'derived';
    usage_source?: 'provider_usage' | 'runtime_estimate' | 'local_estimate' | 'unknown';
    /** Cost for this usage record, as reported by Pi. Never estimated by Specialists. */
    cost?: SessionUsageCost;
    /** Pi's provider-reported usage, verbatim. Present only when Pi reported it. */
    pi_usage?: PiUsageVerbatim;
}
/**
 * Bound on the settlement `get_session_stats` call (SPECIALISTS-120 criterion 3).
 *
 * ONE constant for both settlement sinks — the legacy RPC runtime (`src/pi/session.ts`) and
 * the native in-process host — so the two runtimes cannot drift on the same bound. Each
 * remains free to override it per run through its own option.
 */
export declare const SESSION_STATS_TIMEOUT_MS = 5000;
/**
 * Pi's `get_session_stats` response, verbatim (SPECIALISTS-120).
 *
 * Totals cover every assistant message, tool-reported usage and compaction/branch-summary
 * generation across the whole session, including history that was compacted away.
 * `sessionFile` is absent in `--no-session` (in-memory) mode — measured, not assumed.
 */
export interface PiSessionStats {
    sessionFile?: string;
    sessionId?: string;
    userMessages?: number;
    assistantMessages?: number;
    toolCalls?: number;
    toolResults?: number;
    totalMessages?: number;
    tokens?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        total?: number;
    };
    cost?: number;
    contextUsage?: {
        /** `null` immediately after compaction, until a post-compaction response supplies usage. */
        tokens?: number | null;
        contextWindow?: number;
        percent?: number | null;
    };
}
/** One reconciled field: Specialists' summed usage, Pi's session total, and their difference. */
export interface SessionUsageReconciliationField {
    summed: number;
    session_stats: number;
    delta: number;
}
/**
 * Per-field comparison of Specialists' summed per-message usage against Pi's
 * `get_session_stats` snapshot for the same run (SPECIALISTS-120).
 *
 * `reconciled` is true only when EVERY field matched exactly. A non-zero delta is a finding,
 * not an error: tool-reported usage and compaction summaries contribute to Pi's session
 * totals, and a run that compacts mid-flight legitimately disagrees with a sum of assistant
 * messages alone.
 */
export interface SessionUsageReconciliation {
    reconciled: boolean;
    /** Compared fields, keyed by name (`input`, `output`, `cacheRead`, `cacheWrite`, `total`, `cost`). */
    fields: Record<string, SessionUsageReconciliationField>;
    /** True when Pi reported a session-stats cost total, i.e. the `cost` field was compared. */
    cost_compared: boolean;
}
export interface SessionRunMetrics {
    token_usage?: SessionTokenUsage;
    /** Summed cost across every usage record Specialists observed for this run. */
    cost?: SessionUsageCost;
    /** Pi's terminal `get_session_stats` snapshot for this run. */
    session_stats?: PiSessionStats;
    /** Failure detail when the settlement `get_session_stats` call failed or timed out. */
    session_stats_error?: string;
    /** Summed-per-message usage vs Pi session stats. Present only when both sides exist. */
    reconciliation?: SessionUsageReconciliation;
    /** Pi version recorded for this run (binary on PATH, or the native SDK package). */
    pi_version?: string;
    finish_reason?: string;
    exit_reason?: string;
    turns?: number;
    tool_calls?: number;
    tool_call_names?: string[];
    auto_compactions?: number;
    auto_retries?: number;
    api_error?: string;
}
export type SessionMetricEvent = {
    type: 'token_usage';
    token_usage: SessionTokenUsage;
    source: 'message_done' | 'turn_end' | 'agent_end';
} | {
    type: 'finish_reason';
    finish_reason: string;
    source: 'message_done' | 'turn_end' | 'agent_end';
} | {
    type: 'turn_summary';
    turn_index: number;
    token_usage?: SessionTokenUsage;
    finish_reason?: string;
} | {
    type: 'compaction';
    phase: 'start' | 'end';
    tokensBefore?: number;
    estimatedTokensAfter?: number;
    summary?: string;
    firstKeptEntryId?: string;
    /** Usage of the summarization LLM call; contributes to Pi session totals. */
    token_usage?: SessionTokenUsage;
} | {
    type: 'retry';
    phase: 'start' | 'end';
    attempt?: number;
    maxAttempts?: number;
    delayMs?: number;
    errorMessage?: string;
} | {
    type: 'model_change';
    action: 'set_model' | 'cycle_model';
    model?: string;
    previousModel?: string;
} | {
    type: 'extension_error';
    extension?: string;
    errorMessage?: string;
} | {
    type: 'pi_version';
    pi_version: string;
} | {
    type: 'api_error';
    source: 'rpc' | 'stderr';
    errorMessage: string;
} | {
    type: 'session_stats';
    session_stats: PiSessionStats;
    source: 'settlement';
} | {
    type: 'session_stats_error';
    errorMessage: string;
    timeoutMs?: number;
    source: 'settlement';
};
/**
 * Compare summed per-message usage against Pi's session-stats snapshot (SPECIALISTS-120).
 *
 * Six fields are compared: the four token counters Pi reports separately, Pi's `tokens.total`,
 * and the cost total. `reasoning` is deliberately NOT a compared field — it is a subset of
 * `output`, so comparing it would double-count the same tokens.
 *
 * Returns `undefined` when Pi reported no session-stats token totals at all: a comparison
 * against nothing would report `reconciled: false` for a run that merely had no stats.
 */
export declare function reconcileSessionUsage(summed: SessionTokenUsage | undefined, stats: PiSessionStats | undefined): SessionUsageReconciliation | undefined;
/**
 * Preserve a Pi `Usage` object exactly as received.
 *
 * Returns `undefined` when no numeric field survived: a usage-shaped object carrying no
 * numbers is not usage, and persisting it would claim Pi reported something it did not.
 *
 * Scope of the copy (do not overstate it): top-level keys are copied and `cost` is re-read
 * into a fresh object, so a later mutation of the caller's payload cannot rewrite either.
 * Any other nested provider object (a provider extension field holding an object) stays
 * SHARED with the caller's payload. This is a shallow copy, and callers must not mutate
 * nested payload objects after capture.
 */
export declare function capturePiUsageVerbatim(candidate: unknown): PiUsageVerbatim | undefined;
/**
 * Project a candidate usage object onto {@link SessionTokenUsage} (SPECIALISTS-120).
 *
 * Two things changed relative to the pre-120 normalizer:
 *  - provenance is TRUTHFUL. The default is `unknown`, not `provider_usage`; only an explicit
 *    provider-reported marker earns `provider_usage`. Labelling an unattributed number as
 *    provider usage is how a research reader ends up trusting an estimate as a measurement.
 *  - nothing Pi reported is dropped. `cacheWrite1h` and the cost breakdown are carried, and
 *    the whole input object is retained verbatim under `pi_usage`.
 *
 * `reasoning_tokens` is a subset of `output_tokens` and is never added to `total_tokens`.
 */
export declare function normalizeSessionTokenUsage(candidate: unknown): SessionTokenUsage | undefined;
/**
 * Apply the provenance POLICY in one place (SPECIALISTS-120 criterion 4).
 *
 * A usage object read out of a `usage`-shaped field that Pi itself reported IS
 * `provider_usage` — but only the caller knows that, so the claim can never be inherited
 * from the normalizer's schema default. Two runtimes used to re-implement this override
 * (the legacy RPC parser and the native canonical reader); one implementation is what stops
 * them from drifting. An explicit `usage_source` on the payload always wins, including an
 * unrecognised one, which stays `unknown` rather than being promoted.
 *
 * Only `usage_source` is ever rewritten: `total_tokens_source`'s `derived` label from
 * {@link normalizeSessionTokenUsage} survives untouched.
 */
export declare function asProviderUsage<T extends SessionTokenUsage>(usage: T | undefined, rawPayload: unknown): T | undefined;
/** Read Pi's `get_session_stats` response into the neutral snapshot shape, verbatim. */
export declare function normalizePiSessionStats(candidate: unknown): PiSessionStats | undefined;
/** Per-message usage counter keys. `usage_source` is provenance, never a counter. */
declare const USAGE_COUNTER_KEYS: readonly ["input_tokens", "output_tokens", "cache_creation_tokens", "cache_read_tokens", "cache_write_1h_tokens", "reasoning_tokens", "tool_tokens", "total_tokens"];
/**
 * Merge one message's usage into a running session total (unitAI-beqby.15).
 *
 * Providers disagree on the shape: most emit per-message deltas (sum them), but at
 * least one route emits cumulative-per-message counters (summing those explodes the
 * total, replacing it flaps the row down). Decide per MESSAGE, not per key: the
 * message is cumulative only when every carried counter with history grew — one
 * reset counter proves fresh per-message counts and the whole message adds whole.
 * Zero/absent values carry no information and touch neither the total nor lastSeen,
 * so a zero-usage message can neither clear a total nor corrupt the next delta.
 *
 * The result is monotonic non-decreasing per key on both shapes. Known ceiling: a
 * delta-shape message whose every counter happens to grow reads as cumulative and
 * adds only the growth — undercounts slightly, never flaps or explodes.
 */
export declare function accumulateTokenUsage<T extends object>(prev: T | undefined, incoming: {
    [K in (typeof USAGE_COUNTER_KEYS)[number]]?: number;
} & {
    usage_source?: unknown;
    cost?: unknown;
}, lastSeen: Record<string, number>): T;
export {};
//# sourceMappingURL=session-metrics-contract.d.ts.map