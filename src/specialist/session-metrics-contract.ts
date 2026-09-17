// src/specialist/session-metrics-contract.ts
// Neutral session metric contract (telemetry shape for runs).
//
// This module owns SessionTokenUsage, SessionRunMetrics and SessionMetricEvent
// so neutral and native modules can depend on the metric shape without depending
// on the legacy pi/session.ts runtime. It must NOT import from pi/session.ts,
// supervisor.ts, or any runtime module — the dependencies below are on other
// dependency-free contract modules only.
//
// src/pi/session.ts imports these types from here and re-exports them, so every
// existing importer of pi/session.js keeps working unchanged.

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
export const SESSION_STATS_TIMEOUT_MS = 5_000;

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

export type SessionMetricEvent =
  | { type: 'token_usage'; token_usage: SessionTokenUsage; source: 'message_done' | 'turn_end' | 'agent_end' }
  | { type: 'finish_reason'; finish_reason: string; source: 'message_done' | 'turn_end' | 'agent_end' }
  | { type: 'turn_summary'; turn_index: number; token_usage?: SessionTokenUsage; finish_reason?: string }
  | {
      type: 'compaction';
      phase: 'start' | 'end';
      tokensBefore?: number;
      estimatedTokensAfter?: number;
      summary?: string;
      firstKeptEntryId?: string;
      /** Usage of the summarization LLM call; contributes to Pi session totals. */
      token_usage?: SessionTokenUsage;
    }
  | { type: 'retry'; phase: 'start' | 'end'; attempt?: number; maxAttempts?: number; delayMs?: number; errorMessage?: string }
  | { type: 'model_change'; action: 'set_model' | 'cycle_model'; model?: string; previousModel?: string }
  | { type: 'extension_error'; extension?: string; errorMessage?: string }
  | { type: 'pi_version'; pi_version: string }
  | { type: 'api_error'; source: 'rpc' | 'stderr'; errorMessage: string }
  | { type: 'session_stats'; session_stats: PiSessionStats; source: 'settlement' }
  | { type: 'session_stats_error'; errorMessage: string; timeoutMs?: number; source: 'settlement' };

const RECONCILED_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const;

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Field-by-field identity comparison; floats need a tolerance, integers are exact. */
function sameNumber(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

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
export function reconcileSessionUsage(
  summed: SessionTokenUsage | undefined,
  stats: PiSessionStats | undefined,
): SessionUsageReconciliation | undefined {
  const statsTokens = stats?.tokens;
  if (!statsTokens) return undefined;

  const summedByField: Record<(typeof RECONCILED_FIELDS)[number], number | undefined> = {
    input: finite(summed?.input_tokens),
    output: finite(summed?.output_tokens),
    cacheRead: finite(summed?.cache_read_tokens),
    cacheWrite: finite(summed?.cache_creation_tokens),
    total: finite(summed?.total_tokens),
  };
  const statsByField: Record<(typeof RECONCILED_FIELDS)[number], number | undefined> = {
    input: finite(statsTokens.input),
    output: finite(statsTokens.output),
    cacheRead: finite(statsTokens.cacheRead),
    cacheWrite: finite(statsTokens.cacheWrite),
    total: finite(statsTokens.total),
  };

  const fields: Record<string, SessionUsageReconciliationField> = {};
  let reconciled = true;
  for (const field of RECONCILED_FIELDS) {
    const summedValue = summedByField[field] ?? 0;
    const statsValue = statsByField[field] ?? 0;
    const delta = summedValue - statsValue;
    fields[field] = { summed: summedValue, session_stats: statsValue, delta };
    if (!sameNumber(summedValue, statsValue)) reconciled = false;
  }

  const summedCost = finite(summed?.cost?.total);
  const statsCost = finite(stats?.cost);
  const costCompared = statsCost !== undefined;
  if (costCompared) {
    const summedValue = summedCost ?? 0;
    const delta = summedValue - statsCost;
    fields.cost = { summed: summedValue, session_stats: statsCost, delta };
    if (!sameNumber(summedValue, statsCost)) reconciled = false;
  }

  return { reconciled, fields, cost_compared: costCompared };
}

function usageNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function pickFirstNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = usageNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readCost(value: unknown): SessionUsageCost | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const cost: SessionUsageCost = {
    input: usageNumber(record.input),
    output: usageNumber(record.output),
    cacheRead: usageNumber(record.cacheRead),
    cacheWrite: usageNumber(record.cacheWrite),
    total: usageNumber(record.total),
  };
  return Object.values(cost).some((entry) => entry !== undefined) ? cost : undefined;
}

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
export function capturePiUsageVerbatim(candidate: unknown): PiUsageVerbatim | undefined {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const source = candidate as Record<string, unknown>;
  const verbatim: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    verbatim[key] = value;
  }
  const numericFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h', 'reasoning', 'totalTokens'];
  if (!numericFields.some((field) => usageNumber(verbatim[field]) !== undefined)) return undefined;
  const cost = readCost(source.cost);
  if (cost) verbatim.cost = cost;
  return verbatim as PiUsageVerbatim;
}

const USAGE_SOURCE_VALUES = ['provider_usage', 'runtime_estimate', 'local_estimate', 'unknown'] as const;

function normalizeUsageSource(value: unknown): SessionTokenUsage['usage_source'] {
  return typeof value === 'string' && (USAGE_SOURCE_VALUES as readonly string[]).includes(value)
    ? (value as SessionTokenUsage['usage_source'])
    : 'unknown';
}

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
export function normalizeSessionTokenUsage(candidate: unknown): SessionTokenUsage | undefined {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const usage = candidate as Record<string, unknown>;

  const normalized: SessionTokenUsage = {
    input_tokens: pickFirstNumber(usage, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens', 'input']),
    output_tokens: pickFirstNumber(usage, ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens', 'output']),
    cache_creation_tokens: pickFirstNumber(usage, ['cache_creation_tokens', 'cacheCreationTokens', 'cache_write_tokens', 'cacheWrite']),
    cache_read_tokens: pickFirstNumber(usage, ['cache_read_tokens', 'cacheReadTokens', 'cache_hit_tokens', 'cacheRead']),
    cache_write_1h_tokens: pickFirstNumber(usage, ['cache_write_1h_tokens', 'cacheWrite1h', 'cache_write_1h']),
    reasoning_tokens: pickFirstNumber(usage, ['reasoning_tokens', 'reasoningTokens', 'thinking_tokens', 'thinkingTokens', 'reasoning']),
    tool_tokens: pickFirstNumber(usage, ['tool_tokens', 'toolTokens', 'tool_use_tokens', 'toolUseTokens']),
    total_tokens: pickFirstNumber(usage, ['total_tokens', 'totalTokens']),
    usage_source: usage.usage_source === undefined ? 'unknown' : normalizeUsageSource(usage.usage_source),
  };

  const cost = readCost(usage.cost);
  if (cost) normalized.cost = cost;
  const piUsage = capturePiUsageVerbatim(usage);
  if (piUsage) normalized.pi_usage = piUsage;

  const hasCounter = [
    normalized.input_tokens,
    normalized.output_tokens,
    normalized.cache_creation_tokens,
    normalized.cache_read_tokens,
    normalized.cache_write_1h_tokens,
    normalized.reasoning_tokens,
    normalized.tool_tokens,
    normalized.total_tokens,
  ].some((value) => value !== undefined);
  const hasCost = normalized.cost !== undefined;
  if (!hasCounter && !hasCost) return undefined;

  if (normalized.total_tokens === undefined) {
    const components = [
      normalized.input_tokens,
      normalized.output_tokens,
      normalized.cache_creation_tokens,
      normalized.cache_read_tokens,
    ].filter((value): value is number => value !== undefined);
    if (components.length > 0) {
      // F3: this total is OUR arithmetic on provider-reported components. Publishing it as
      // plain `provider_usage` would make a measured number and a computed one
      // indistinguishable, so the derivation is named on the record itself.
      normalized.total_tokens = components.reduce((sum, value) => sum + value, 0);
      normalized.total_tokens_source = 'derived';
    }
  } else {
    normalized.total_tokens_source = 'provider';
  }

  return Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined),
  ) as SessionTokenUsage;
}

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
export function asProviderUsage<T extends SessionTokenUsage>(usage: T | undefined, rawPayload: unknown): T | undefined {
  if (!usage) return undefined;
  if (usage.usage_source !== undefined && usage.usage_source !== 'unknown') return usage;
  const payloadNamesSource = rawPayload !== null
    && typeof rawPayload === 'object'
    && typeof (rawPayload as Record<string, unknown>).usage_source === 'string';
  if (payloadNamesSource) return usage;
  usage.usage_source = 'provider_usage';
  return usage;
}

/** Read Pi's `get_session_stats` response into the neutral snapshot shape, verbatim. */
export function normalizePiSessionStats(candidate: unknown): PiSessionStats | undefined {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const source = candidate as Record<string, unknown>;
  const stats: PiSessionStats = {};
  const counters = stats as Record<string, number | undefined>;
  if (typeof source.sessionFile === 'string' && source.sessionFile.length > 0) stats.sessionFile = source.sessionFile;
  if (typeof source.sessionId === 'string' && source.sessionId.length > 0) stats.sessionId = source.sessionId;
  for (const key of ['userMessages', 'assistantMessages', 'toolCalls', 'toolResults', 'totalMessages'] as const) {
    const value = usageNumber(source[key]);
    if (value !== undefined) counters[key] = value;
  }
  const tokens = source.tokens;
  if (tokens !== null && typeof tokens === 'object' && !Array.isArray(tokens)) {
    const tokenRecord = tokens as Record<string, unknown>;
    stats.tokens = {
      input: usageNumber(tokenRecord.input),
      output: usageNumber(tokenRecord.output),
      cacheRead: usageNumber(tokenRecord.cacheRead),
      cacheWrite: usageNumber(tokenRecord.cacheWrite),
      total: usageNumber(tokenRecord.total),
    };
  }
  const cost = usageNumber(source.cost);
  if (cost !== undefined) stats.cost = cost;
  const contextUsage = source.contextUsage;
  if (contextUsage !== null && typeof contextUsage === 'object' && !Array.isArray(contextUsage)) {
    const context = contextUsage as Record<string, unknown>;
    stats.contextUsage = {
      tokens: context.tokens === null ? null : usageNumber(context.tokens),
      contextWindow: usageNumber(context.contextWindow),
      percent: context.percent === null ? null : usageNumber(context.percent),
    };
  }
  return Object.keys(stats).length > 0 ? stats : undefined;
}

/** Per-message usage counter keys. `usage_source` is provenance, never a counter. */
const USAGE_COUNTER_KEYS = [
  'input_tokens',
  'output_tokens',
  'cache_creation_tokens',
  'cache_read_tokens',
  'cache_write_1h_tokens',
  'reasoning_tokens',
  'tool_tokens',
  'total_tokens',
] as const;

const COST_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const;

/**
 * Fold one usage record's cost breakdown into an accumulated cost.
 *
 * Cost follows the same shape rule as the counters (`cumulative` is decided per message, not
 * per key), so a provider reporting cumulative cost cannot inflate the run total.
 */
function accumulateCost(
  existing: unknown,
  incoming: unknown,
  cumulative: boolean,
): SessionUsageCost | undefined {
  if (incoming === null || typeof incoming !== 'object') {
    return existing !== null && typeof existing === 'object' ? existing as SessionUsageCost : undefined;
  }
  const next = incoming as Record<string, unknown>;
  const previous = existing !== null && typeof existing === 'object' ? existing as Record<string, unknown> : {};
  const merged: Record<string, number> = {};
  let hasAny = false;
  for (const key of COST_KEYS) {
    const value = typeof next[key] === 'number' && Number.isFinite(next[key]) ? next[key] as number : undefined;
    const before = typeof previous[key] === 'number' && Number.isFinite(previous[key]) ? previous[key] as number : undefined;
    if (value === undefined && before === undefined) continue;
    // A zero value carries no cost information; keep the accumulated value instead of
    // letting a zero-weighted cost breakdown clear it (mirrors the counter rule).
    if (value === 0 && before !== undefined) continue;
    const delta = before !== undefined && cumulative && value !== undefined ? value - before : (value ?? 0);
    merged[key] = (before ?? 0) + delta;
    hasAny = true;
  }
  if (!hasAny) return existing !== null && typeof existing === 'object' ? existing as SessionUsageCost : undefined;
  return merged as SessionUsageCost;
}

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
export function accumulateTokenUsage<T extends object>(
  prev: T | undefined,
  incoming: { [K in (typeof USAGE_COUNTER_KEYS)[number]]?: number } & { usage_source?: unknown; cost?: unknown },
  lastSeen: Record<string, number>,
): T {
  const merged = { ...(prev ?? {}) } as Record<string, unknown>;
  const carried = USAGE_COUNTER_KEYS.filter((key) => {
    const value = incoming[key];
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  });
  // Vacuously true on a first message; harmless there because no key has history
  // and every carried counter adds whole below.
  const cumulative = carried.every((key) => lastSeen[key] === undefined || (incoming[key] as number) >= (lastSeen[key] as number));
  for (const key of carried) {
    const value = incoming[key] as number;
    const last = lastSeen[key];
    const delta = last !== undefined && cumulative ? value - last : value;
    merged[key] = (typeof merged[key] === 'number' ? merged[key] : 0) + delta;
    lastSeen[key] = value;
  }
  if (merged.usage_source === undefined && typeof incoming.usage_source === 'string') {
    merged.usage_source = incoming.usage_source;
  }
  // A merged total is a SUM of per-message totals, so it is never a single provider report:
  // labelling it `provider` would restore the F3 ambiguity one level up. Components keep
  // their own per-message markers on the timeline and metrics rows.
  if (typeof merged.total_tokens === 'number') merged.total_tokens_source = 'derived';
  const cost = accumulateCost(merged.cost, incoming.cost, cumulative);
  if (cost) merged.cost = cost;
  return merged as T;
}
