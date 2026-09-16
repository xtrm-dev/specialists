export interface SessionTokenUsage {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_tokens?: number;
    cache_read_tokens?: number;
    reasoning_tokens?: number;
    tool_tokens?: number;
    total_tokens?: number;
    usage_source?: 'provider_usage' | 'runtime_estimate' | 'local_estimate' | 'unknown';
}
export interface SessionRunMetrics {
    token_usage?: SessionTokenUsage;
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
    summary?: string;
    firstKeptEntryId?: string;
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
    type: 'api_error';
    source: 'rpc' | 'stderr';
    errorMessage: string;
};
//# sourceMappingURL=session-metrics-contract.d.ts.map