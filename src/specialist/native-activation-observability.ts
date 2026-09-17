import type { PiAgentSessionEvent, PiAgentSessionLike } from '../activation/pi-sdk.js';
import {
  createFinishReasonEvent,
  createMetaEvent,
  createRunCompleteEvent,
  createRunStartEvent,
  createControlSignalEvent,
  createSettlementEvent,
  createStaleWarningEvent,
  createStatusChangeEvent,
  createTokenUsageEvent,
  createSessionStatsEvent,
  createSessionStatsErrorEvent,
  createTurnSummaryEvent,
  mapCallbackEventToTimelineEvent,
  TIMELINE_EVENT_TYPES,
  type SettlementTimelineType,
  type TimelineEvent,
  type TimelineEventStaleWarning,
  type TimelineTokenUsage,
} from './timeline-events.js';
import {
  asProviderUsage,
  normalizePiSessionStats,
  normalizeSessionTokenUsage,
  reconcileSessionUsage,
  SESSION_STATS_TIMEOUT_MS,
  type PiSessionStats,
  type SessionUsageReconciliation,
} from './session-metrics-contract.js';

export interface NativeLifecycleEvent {
  activationId: string;
  specialist: string;
  beadId?: string;
  name: string;
  payload?: Record<string, unknown>;
}

export interface NativeLifecycleProjectionContext {
  startedAtMs: number;
  workspacePath?: string;
  resolvedModel?: string;
  output?: string;
  tokenUsage?: TimelineTokenUsage;
  finishReason?: string;
  toolCalls?: string[];
  turns?: number;
  autoRetries?: number;
  autoCompactions?: number;
  /** Pi's terminal session snapshot, when the settlement capture succeeded. */
  sessionStats?: PiSessionStats;
  /** Pi version recorded for this run (binary on PATH or resolved SDK package). */
  piVersion?: string;
}

/**
 * Native host lifecycle signals with no legacy timeline counterpart.
 *
 * They remain represented by the job status projection where applicable. They are not
 * persisted as `activation.*` forensic names because that would retain the parallel event
 * vocabulary which Phase 7 removes.
 *
 * Two different debts live here — see the bead notes for the per-name accounting:
 * native-only concepts with no legacy equivalent (lease, interaction, validation
 * — out of scope by NON_GOALS, "does not add event kinds beyond parity") and
 * translated aliases whose canonical producer is the raw Pi event stream.
 */
export const NATIVE_LIFECYCLE_OBSERVABILITY_GAPS = Object.freeze({
  activation_requested: 'Dispatch intent precedes the legacy run_start boundary and has no timeline event.',
  step_contract_compiled: 'Step-contract compilation has no legacy AgentSession event.',
  activation_admitted: 'Admission metadata has no legacy timeline event; identity is projected on specialist_jobs.',
  activation_starting: 'Session construction has no legacy timeline event; run_start follows once construction succeeds.',
  output_validation_started: 'Native result validation has no legacy timeline event kind.',
  output_validation_passed: 'Native result validation has no legacy timeline event kind.',
  output_validation_failed: 'Native result validation has no legacy timeline event kind; terminal failure is run_complete.',
  activation_disposed: 'In-memory session disposal after a terminal event has no legacy timeline event.',
  lease_released: 'Workspace-lease teardown has no legacy timeline event.',
  lease_reconciled: 'Lease reconciliation has no legacy timeline event.',
  clarification_requested: 'Peer interaction has no legacy timeline event; interactions persist as files, not timeline rows.',
  clarification_answered: 'Peer interaction has no legacy timeline event; interactions persist as files, not timeline rows.',
  escalation_raised: 'Peer interaction has no legacy timeline event; interactions persist as files, not timeline rows.',
  escalation_resolved: 'Peer interaction has no legacy timeline event; interactions persist as files, not timeline rows.',
  turn_started: 'Suppressed compatibility alias; the raw Pi turn_start event is canonical.',
  turn_completed: 'Suppressed compatibility alias; the raw Pi turn_end event is canonical.',
  retry_started: 'Suppressed compatibility alias; the raw Pi auto_retry_start event is canonical.',
  retry_completed: 'Suppressed compatibility alias; the raw Pi auto_retry_end event is canonical.',
  compaction_started: 'Suppressed compatibility alias; the raw Pi compaction_start event is canonical.',
  compaction_completed: 'Suppressed compatibility alias; the raw Pi compaction_end event is canonical.',
} as const);

/** Pi session signals intentionally omitted from the legacy-compatible timeline. */
export const NATIVE_SESSION_OBSERVABILITY_GAPS = Object.freeze({
  agent_start: 'turn_start is the canonical turn boundary.',
  agent_end: 'run_complete is emitted by the activation lifecycle; agent_end is not a run boundary.',
  agent_settled: 'The lifecycle activation_settled signal projects the waiting status.',
  message_update: 'Only thinking deltas are projected; text is persisted once at assistant message_end.',
  message_user: 'User and custom-message boundaries are not persisted by the legacy timeline mapper.',
  queue_update: 'The legacy runner does not persist Pi prompt-queue state.',
  entry_appended: 'Session transcript persistence is not a timeline event.',
  session_info_changed: 'Session display-name changes are not a timeline event.',
  thinking_level_changed: 'The legacy runner does not persist thinking-level changes.',
  summarization_retry_scheduled: 'The legacy runner has no summarization-retry timeline event.',
  summarization_retry_attempt_start: 'The legacy runner has no summarization-retry timeline event.',
  summarization_retry_finished: 'The legacy runner has no summarization-retry timeline event.',
  bash_execution_update: 'The legacy runner does not persist streaming bash deltas.',
} as const);

/**
 * Native lifecycle signals that are DELIBERATELY unpersisted (SPECIALISTS-101).
 *
 * Each entry carries a non-empty written reason. The totality test enforces that every
 * emitted name is either handled by an explicit mapper arm below or listed here — a name
 * in neither fails the test. Runtime safety is unchanged: the mapper's `default: return
 * null` still drops unknown names without crashing the writer; the obligation is test-time.
 *
 * Extension resolution is out of scope for this migration (operator ruling): these three
 * emit sites exist, no extension telemetry surface exists (no table, no column, no writer),
 * and creating one is deferred. Making the absence EXPLICIT is the deliverable.
 */
export const NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED = Object.freeze({
  'extension_discovery_sessions': 'Emit site src/activation/native-host.ts emits per-activation discovery cost (2 fenced sessions); no extension telemetry surface exists (no table/column/writer) and the operator ruled extension resolution out of scope for this migration, so creating one is deferred. Absence is explicit, not silent.',
  'extension_tools_discovered': 'Emit site src/activation/native-host.ts emits the pinned extension tool list; no extension telemetry surface exists (no table/column/writer) and the operator ruled extension resolution out of scope for this migration, so creating one is deferred. Absence is explicit, not silent.',
  'extension_tools_refused': 'Emit site src/activation/native-host.ts emits refused extension tools (collisions/provenance); no extension telemetry surface exists (no table/column/writer) and the operator ruled extension resolution out of scope for this migration, so creating one is deferred. The admission verdict persists on the session; the audit trail does not.',
} as const);

function at<T extends TimelineEvent>(event: T, t: number): T {
  return { ...event, t };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Project a settlement emit payload onto the settlement timeline shape (SPECIALISTS-101).
 *
 * Only the known settlement payload keys are carried; unknown keys are dropped rather than
 * widening the timeline type. Every emit-site key observed in
 * src/activation/settlement-publication.ts is covered (ref, status, receipt, kind, entry,
 * note, republish, activationId, attemptId, partial_receipt, contended).
 */
function settlementDetail(payload: Record<string, unknown> | undefined): Omit<TimelineEventSettlementLike, 't' | 'type'> {
  if (!payload) return {};
  const detail: Record<string, unknown> = {};
  const str = (key: string): void => {
    const value = stringField(payload[key]);
    if (value !== undefined) detail[key] = value;
  };
  str('ref');
  str('status');
  str('receipt');
  str('kind');
  str('entry');
  str('note');
  str('activationId');
  str('attemptId');
  str('partial_receipt');
  const republish = booleanField(payload.republish);
  if (republish !== undefined) detail.republish = republish;
  const contended = booleanField(payload.contended);
  if (contended !== undefined) detail.contended = contended;
  return detail as Omit<TimelineEventSettlementLike, 't' | 'type'>;
}

type TimelineEventSettlementLike = {
  t: number;
  type: SettlementTimelineType;
  bead_id?: string;
  ref?: string;
  status?: string;
  receipt?: string;
  kind?: string;
  entry?: string;
  note?: string;
  republish?: boolean;
  activationId?: string;
  attemptId?: string;
  partial_receipt?: string;
  contended?: boolean;
};

function messageRole(event: PiAgentSessionEvent): string | undefined {
  return stringField(record(event.message)?.role);
}

function assistantMessage(event: PiAgentSessionEvent): Record<string, unknown> | undefined {
  const message = record(event.message);
  return message?.role === 'assistant' ? message : undefined;
}

function assistantText(event: PiAgentSessionEvent): string | undefined {
  const message = assistantMessage(event);
  if (!message) return undefined;
  const content = message.content;
  if (typeof content === 'string') return content.trim().length > 0 ? content : undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((item) => {
      const part = record(item);
      return part?.type === 'text' ? stringField(part.text) ?? '' : '';
    })
    .join('');
  return text.trim().length > 0 ? text : undefined;
}

/**
 * Canonical reader for the nested message.usage short-key shape Pi session events carry.
 *
 * SPECIALISTS-120: every provider-reported field survives — including Anthropic's
 * `cacheWrite1h` and Pi's whole cost breakdown — and the raw object is kept verbatim under
 * `pi_usage` alongside the normalized projection. Provenance is `provider_usage` because an
 * `AgentMessage.usage` IS the provider's report; a message event with no `usage` field yields
 * `undefined` rather than a zero-filled object that would read as a measurement.
 *
 * Reads assistant AND toolResult messages: Pi's session totals include tool-reported usage, so
 * a sum that skipped toolResult usage could never reconcile with Pi's session snapshot.
 */
export function nativeSessionTokenUsage(event: PiAgentSessionEvent): TimelineTokenUsage | undefined {
  const message = record(event.message);
  const role = stringField(message?.role);
  if (role !== 'assistant' && role !== 'toolResult') return undefined;
  const usage = record(message?.usage);
  if (!usage) return undefined;

  const normalized = normalizeSessionTokenUsage(usage);
  if (!normalized) return undefined;
  // Provenance policy, in one place shared with the legacy RPC parser: an explicit
  // `usage_source` on the payload wins; otherwise this IS Pi's provider report.
  return asProviderUsage(normalized, usage) as TimelineTokenUsage;
}

/**
 * The events that carry billable Pi usage (SPECIALISTS-120 F1).
 *
 * ONE rule, consulted by {@link nativeEventTokenUsage} and by the host accumulator's gate, so
 * adding an event shape cannot silently update one runtime and not the other.
 */
export function isNativeUsageEvent(event: PiAgentSessionEvent): boolean {
  return event.type === 'message_end' || event.type === 'compaction_end';
}

/**
 * Read the billable usage off a native Pi session event (SPECIALISTS-120 F1).
 *
 * Two accumulators consume this reader — the host's live activation snapshot and the forensic
 * sink's durable projection — and they own their state separately by design: the host holds
 * the in-memory activation, the sink holds the persisted projection, and the sink must stay
 * usable when fed raw events with no host (its tests and any offline replay do exactly that).
 * What they must NEVER do is own different RULES, which is what made them disagree:
 *
 * - `message_end` carries an assistant or toolResult usage report.
 * - `compaction_end` carries the summarization call's usage under `result.usage`. Pi bills and
 *   counts that call in its session totals, and it never arrives as a message, so a rule that
 *   only read `message_end` under-reported every compacted run and produced a `reconciled=false`
 *   reconciliation whose delta was exactly the summarization call.
 *
 * Both shapes are read through the same canonical reader, so a provider field that survives on
 * a message survives on a compaction summary too.
 */
export function nativeEventTokenUsage(event: PiAgentSessionEvent): TimelineTokenUsage | undefined {
  if (!isNativeUsageEvent(event)) return undefined;
  if (event.type === 'message_end') return nativeSessionTokenUsage(event);
  const result = record(event.result);
  if (!result) return undefined;
  return nativeSessionTokenUsage({
    type: 'message_end',
    message: { role: 'assistant', usage: result.usage },
  } as PiAgentSessionEvent);
}

/**
 * Capture Pi's terminal session stats at settlement (SPECIALISTS-120 criterion 3).
 *
 * The native host holds the `AgentSession` in-process, so there is no separate Pi process to
 * outlive — the equivalent boundary is "before the terminal activation event is emitted".
 *
 * Bounded by `timeoutMs`: Pi answering slowly must cost the activation that wait and nothing
 * more. A failure is RETURNED, never thrown, so the caller records it as an explicit event and
 * still settles the activation. A session double without `getSessionStats` reports that fact
 * rather than reporting zeros as if Pi had measured them.
 */
export async function captureNativeSessionStats(
  session: Pick<PiAgentSessionLike, 'getSessionStats'>,
  timeoutMs = SESSION_STATS_TIMEOUT_MS,
): Promise<{ stats?: PiSessionStats; error?: string }> {
  if (typeof session.getSessionStats !== 'function') {
    return { error: 'pi session does not expose getSessionStats' };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      Promise.resolve().then(() => session.getSessionStats!()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`get_session_stats did not answer within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    const stats = normalizePiSessionStats(raw);
    return stats ? { stats } : { error: 'getSessionStats returned no usable session totals' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Per-message usage accumulation lives in the neutral session-metrics contract
 * (SPECIALISTS-120): the legacy RPC runtime needs the same dual-shape rule, and importing it
 * from a native-activation module would have created a `pi/session -> native-activation ->
 * pi-sdk -> pi/session` cycle. Re-exported here so existing importers are unchanged.
 */
export { accumulateTokenUsage } from './session-metrics-contract.js';

function resultContent(result: unknown): string | undefined {
  if (typeof result === 'string') return result;
  const resultRecord = record(result);
  const content = resultRecord?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((item) => {
      if (typeof item === 'string') return item;
      const part = record(item);
      return part?.type === 'text' ? stringField(part.text) ?? '' : '';
    })
    .join('\n');
  return text.trim().length > 0 ? text : undefined;
}

/** Parse the stable trailing sequence from `att:<activation>:N`. */
export function nativeAttemptNo(attemptId: string): number {
  const match = /:(\d+)$/.exec(attemptId);
  if (!match) return 1;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

/** Advance a runtime-owned attempt ID without replacing its identity namespace. */
export function nativeAttemptIdForNo(initialAttemptId: string, attemptNo: number): string {
  const safeAttemptNo = Number.isSafeInteger(attemptNo) && attemptNo > 0 ? attemptNo : 1;
  return /:\d+$/.test(initialAttemptId)
    ? initialAttemptId.replace(/:\d+$/, `:${safeAttemptNo}`)
    : `${initialAttemptId}:${safeAttemptNo}`;
}

/** Map native host lifecycle signals onto existing legacy timeline vocabulary. */
export function mapNativeLifecycleEvent(
  event: NativeLifecycleEvent,
  context: NativeLifecycleProjectionContext,
  t = Date.now(),
): TimelineEvent | null {
  switch (event.name) {
    case 'activation_started':
      return at(createRunStartEvent(event.specialist, event.beadId, {
        job_id: event.activationId,
        specialist_name: event.specialist,
        bead_id: event.beadId,
        worktree_path: context.workspacePath,
      }), t);
    case 'activation_settled':
      return at(createStatusChangeEvent('waiting', 'running'), t);
    case 'activation_resumed':
      // Resume re-enters RUNNING (XTRM-93 N3 defect 2): parity with the legacy
      // handleResumeTurn, which emits status_change('running', previousStatus).
      // The resumed leg is active time, not waiting time. turn_start does NOT do
      // this — the accumulator's turn branch continues without touching phase —
      // which is why the former GAPS rationale ("re-enters at turn_start") was
      // wrong for phase accounting. Shared status_change vocabulary; no new kind.
      return at(createStatusChangeEvent('running', 'waiting'), t);
    case 'activation_completed': {
      const reconciliation = reconcileSessionUsage(context.tokenUsage, context.sessionStats);
      return at(createRunCompleteEvent('COMPLETE', Math.max(0, t - context.startedAtMs) / 1_000, {
        model: context.resolvedModel,
        backend: context.resolvedModel?.split('/')[0],
        bead_id: event.beadId,
        output: context.output,
        token_usage: context.tokenUsage,
        finish_reason: context.finishReason,
        tool_calls: context.toolCalls,
        final: true,
        pi_version: context.piVersion,
        metrics: {
          token_usage: context.tokenUsage,
          ...(context.tokenUsage?.cost ? { cost: context.tokenUsage.cost } : {}),
          ...(context.sessionStats ? { session_stats: context.sessionStats } : {}),
          ...(reconciliation ? { reconciliation } : {}),
          ...(context.piVersion ? { pi_version: context.piVersion } : {}),
          finish_reason: context.finishReason,
          turns: context.turns,
          tool_calls: context.toolCalls?.length,
          tool_call_names: context.toolCalls,
          auto_retries: context.autoRetries,
          auto_compactions: context.autoCompactions,
        },
      }), t);
    }
    // Admission control, persisted as `control_signal` -> family `control`, severity `warn`
    // (unitAI-rrdnt.58). Phase 7 originally dropped these on the grounds that lease contention
    // has no legacy runner concept. True, and it does not follow: there is no legacy event to
    // COMPARE against, which makes them uncomparable, not unimportant. Parity means a native
    // activation answers the same queries a legacy one does — not that it may only emit events
    // legacy also emits.
    //
    // Without them a write refused for lease contention left NO durable trace, which is both
    // PRD acceptance V unsatisfiable and the exact situation an operator reconstructs from
    // forensics hours later. `control_signal` is a shared timeline type the legacy runner uses
    // too, so this restores the rows without reopening a native-only vocabulary. It is
    // deliberately not `job`: these are admission decisions, not run lifecycle.
    case 'lease_acquired':
    case 'lease_denied':
    case 'lease_uncertain':
    case 'tool_blocked':
      return at(createControlSignalEvent(event.name, {
        bead_id: event.beadId,
        ...(event.payload ?? {}),
      } as never), t);
    // SPECIALISTS-101: operational lifecycle signals that were silently dropped by
    // `default: return null`. They share the `control_signal` carrier (same rationale as
    // the lease group above): admission/operational decisions with no legacy equivalent are
    // uncomparable, not unimportant. Each keeps its own action (= emitted name) so the
    // forensic event_name stays distinct (`control.<name>.recorded`).
    case 'activation_retried':
    case 'lease_release_failed':
    case 'mandatory_rules_injection':
    case 'tool_contract_unsatisfied_on_fallback':
      return at(createControlSignalEvent(event.name, {
        bead_id: event.beadId,
        ...(event.payload ?? {}),
      } as never), t);
    // SPECIALISTS-103 model_fallback carrier (coordinator decision): use the EXISTING shared
    // `model_change` event. There is no `fallback_step` event and none is invented.
    // Action is `cycle_model` (not `set_model`): a fallback walks the configured chain
    // automatically; an explicit operator override would be `set_model`. The closed union
    // `model_change.action` is NOT widened. All seven producer keys are preserved onto
    // the timeline row (from/to_model as model/previous_model, plus error_class,
    // terminal, note, attempt_n, resolved_model verbatim): the reason a fallback happened
    // and whether it terminated the activation must survive to the durable forensic row.
    // `terminal: false` is preserved explicitly (boolean, not truthiness-filtered).
    case 'model_fallback':
      return at({
        t,
        type: TIMELINE_EVENT_TYPES.MODEL_CHANGE,
        action: 'cycle_model',
        ...(stringField(event.payload?.to_model) ? { model: stringField(event.payload?.to_model) as string } : {}),
        ...(stringField(event.payload?.from_model) ? { previous_model: stringField(event.payload?.from_model) as string } : {}),
        ...(stringField(event.payload?.error_class) ? { error_class: stringField(event.payload?.error_class) as string } : {}),
        ...(booleanField(event.payload?.terminal) !== undefined ? { terminal: booleanField(event.payload?.terminal) as boolean } : {}),
        ...(stringField(event.payload?.note) ? { note: stringField(event.payload?.note) as string } : {}),
        ...(numberField(event.payload?.attempt_n) !== undefined ? { attempt_n: numberField(event.payload?.attempt_n) as number } : {}),
        ...(stringField(event.payload?.resolved_model) ? { resolved_model: stringField(event.payload?.resolved_model) as string } : {}),
      }, t);
    // SPECIALISTS-120 settlement capture. The native host captures Pi's own session totals
    // before the terminal activation event and emits the outcome under these two names. The
    // snapshot gets its own timeline type so a reader can tell Pi's session total apart from
    // the summed per-message `token_usage` rows; the failure gets its own type so a missing
    // snapshot is a durable finding, not a silent absence.
    case 'session_stats_captured': {
      const stats = normalizePiSessionStats(event.payload?.session_stats);
      // A "captured" signal with no usable snapshot is itself a failure and must still be
      // persisted: the mapper never returns null here, so no session-stats outcome can vanish.
      return stats
        ? at(createSessionStatsEvent(stats), t)
        : at(createSessionStatsErrorEvent('session_stats_captured carried no usable snapshot'), t);
    }
    case 'session_stats_failed':
      return at(createSessionStatsErrorEvent(
        stringField(event.payload?.error) ?? 'session stats capture failed',
        numberField(event.payload?.timeout_ms),
      ), t);
    // SPECIALISTS-101 settlement carrier (coordinator decision): each settlement_* name keeps
    // its own event_name and gets its own arm. They are 10 distinct signals; collapsing them
    // into one generic arm would trade one silent loss for nine. Each returns its own
    // settlement timeline type so the forensic event_name equals the emitted name.
    case 'settlement_stored':
      return at(createSettlementEvent('settlement_stored', {
        bead_id: event.beadId,
        ...settlementDetail(record(event.payload)),
      }), t);
    case 'settlement_receipt_allocated':
      return at(createSettlementEvent('settlement_receipt_allocated', {
        bead_id: event.beadId,
        ...settlementDetail(record(event.payload)),
      }), t);
    case 'settlement_artifact_attached':
      return at(createSettlementEvent('settlement_artifact_attached', {
        bead_id: event.beadId,
        ...settlementDetail(record(event.payload)),
      }), t);
    case 'settlement_result_published':
      return at(createSettlementEvent('settlement_result_published', {
        bead_id: event.beadId,
        ...settlementDetail(record(event.payload)),
      }), t);
    case 'settlement_republish_deferred':
      return at(createSettlementEvent('settlement_republish_deferred', {
        bead_id: event.beadId,
        ...settlementDetail(record(event.payload)),
      }), t);
    case 'settlement_republish_error':
      return at(createSettlementEvent('settlement_republish_error', {
        bead_id: event.beadId,
        ...settlementDetail(record(event.payload)),
      }), t);
    case 'settlement_republish_reconciled':
      return at(createSettlementEvent('settlement_republish_reconciled', {
        bead_id: event.beadId,
        ...settlementDetail(record(event.payload)),
      }), t);
    case 'settlement_republish_refused':
      return at(createSettlementEvent('settlement_republish_refused', {
        bead_id: event.beadId,
        ...settlementDetail(record(event.payload)),
      }), t);
    case 'settlement_degraded':
      return at(createSettlementEvent('settlement_degraded', {
        bead_id: event.beadId,
        ...settlementDetail(record(event.payload)),
      }), t);
    case 'settlement_store_failed':
      return at(createSettlementEvent('settlement_store_failed', {
        bead_id: event.beadId,
        ...settlementDetail(record(event.payload)),
      }), t);
    case 'activation_failed':
    case 'activation_rejected':
      return at(createRunCompleteEvent('ERROR', Math.max(0, t - context.startedAtMs) / 1_000, {
        model: context.resolvedModel,
        backend: context.resolvedModel?.split('/')[0],
        bead_id: event.beadId,
        error: stringField(event.payload?.error) ?? stringField(event.payload?.reason),
        output: context.output,
        token_usage: context.tokenUsage,
        finish_reason: context.finishReason,
        tool_calls: context.toolCalls,
        final: true,
      }), t);
    // SPECIALISTS-102: the native tool_duration producer (NativeActivationHost
    // duration checker) reaches the durable store through this arm. The oracle's
    // emitPayload carries no `reason`, so it defaults to 'tool_duration' here.
    case 'stale_warning': {
      const payload = record(event.payload);
      const reason = stringField(payload?.reason) as TimelineEventStaleWarning['reason'] | undefined;
      const tool = stringField(payload?.tool);
      return at(createStaleWarningEvent(reason ?? 'tool_duration', {
        silence_ms: numberField(payload?.silence_ms) ?? 0,
        threshold_ms: numberField(payload?.threshold_ms) ?? 0,
        ...(tool !== undefined ? { tool } : {}),
      }), t);
    }
    default:
      // Runtime safety is unchanged: an unknown name still drops without crashing the writer.
      // Totality is a TEST-time obligation enforced by native-mapper-totality.test.ts.
      return null;
  }
}

/**
 * Map a public Pi AgentSession event onto the same timeline events used by legacy `sp run`.
 * One Pi message boundary can produce both the boundary row and the legacy text row.
 */
export function mapNativeSessionEvent(
  event: PiAgentSessionEvent,
  t = Date.now(),
  turnIndex = 0,
): TimelineEvent[] {
  const mapped: TimelineEvent[] = [];
  const add = (timeline: TimelineEvent | null): void => {
    if (timeline) mapped.push(at(timeline, t));
  };

  switch (event.type) {
    case 'turn_start':
      add(mapCallbackEventToTimelineEvent('turn_start', {}));
      break;
    case 'turn_end':
      add(mapCallbackEventToTimelineEvent('turn_end', {}));
      break;
    case 'message_start': {
      const role = messageRole(event);
      if (role === 'assistant') {
        const message = assistantMessage(event);
        const model = stringField(message?.model);
        const provider = stringField(message?.provider);
        if (model || provider) mapped.push(at(createMetaEvent(model ?? 'unknown', provider ?? 'unknown'), t));
        add(mapCallbackEventToTimelineEvent('message_start_assistant', {}));
      }
      if (role === 'toolResult') add(mapCallbackEventToTimelineEvent('message_start_tool_result', {}));
      break;
    }
    case 'message_end': {
      const role = messageRole(event);
      if (role === 'assistant') {
        const text = assistantText(event);
        const usage = nativeSessionTokenUsage(event);
        const finishReason = stringField(assistantMessage(event)?.stopReason);
        if (text) mapped.push({ t, type: TIMELINE_EVENT_TYPES.TEXT, char_count: text.length, content: text });
        add(mapCallbackEventToTimelineEvent('message_end_assistant', {}));
        if (usage) mapped.push(at(createTokenUsageEvent(usage, 'message_done'), t));
        if (finishReason) mapped.push(at(createFinishReasonEvent(finishReason, 'message_done'), t));
        mapped.push(at(createTurnSummaryEvent(turnIndex, usage, finishReason, text), t));
      }
      if (role === 'toolResult') add(mapCallbackEventToTimelineEvent('message_end_tool_result', {}));
      break;
    }
    case 'message_update': {
      const update = record(event.assistantMessageEvent);
      if (update?.type === 'thinking_delta') {
        add(mapCallbackEventToTimelineEvent('thinking', { charCount: stringField(update.delta)?.length }));
      }
      break;
    }
    case 'tool_execution_start':
      add(mapCallbackEventToTimelineEvent('tool_execution_start', {
        tool: stringField(event.toolName),
        toolCallId: stringField(event.toolCallId),
        args: record(event.args),
      }));
      break;
    case 'tool_execution_update':
      add(mapCallbackEventToTimelineEvent('tool_execution_update', {
        tool: stringField(event.toolName),
        toolCallId: stringField(event.toolCallId),
      }));
      break;
    case 'tool_execution_end':
      add(mapCallbackEventToTimelineEvent('tool_execution_end', {
        tool: stringField(event.toolName),
        toolCallId: stringField(event.toolCallId),
        isError: booleanField(event.isError),
        resultContent: resultContent(event.result),
      }));
      break;
    case 'compaction_start':
      add(mapCallbackEventToTimelineEvent('auto_compaction_start', {}));
      break;
    case 'compaction_end': {
      const result = record(event.result);
      // SPECIALISTS-120 criterion 2: Pi reports `estimatedTokensAfter` (the post-compaction
      // context estimate) and the summarization call's own usage. Both are dropped today, so a
      // compacted run's timeline cannot say what compaction cost or left behind. The
      // summarization usage is NOT an assistant message; it is read through the same usage
      // reader so it lands in one shape.
      const summaryUsage = nativeSessionTokenUsage({ type: 'message_end', message: { role: 'assistant', usage: result?.usage } } as PiAgentSessionEvent);
      add(mapCallbackEventToTimelineEvent('auto_compaction_end', {
        compaction: {
          tokensBefore: numberField(result?.tokensBefore),
          estimatedTokensAfter: numberField(result?.estimatedTokensAfter),
          summary: stringField(result?.summary),
          firstKeptEntryId: stringField(result?.firstKeptEntryId),
          ...(summaryUsage ? { token_usage: summaryUsage } : {}),
        },
      }));
      break;
    }
    case 'auto_retry_start':
      add(mapCallbackEventToTimelineEvent('auto_retry_start', {
        retry: {
          attempt: numberField(event.attempt),
          maxAttempts: numberField(event.maxAttempts),
          delayMs: numberField(event.delayMs),
          errorMessage: stringField(event.errorMessage),
        },
      }));
      break;
    case 'auto_retry_end':
      add(mapCallbackEventToTimelineEvent('auto_retry_end', {
        retry: {
          attempt: numberField(event.attempt),
          errorMessage: stringField(event.finalError),
        },
      }));
      break;
    default:
      break;
  }

  return mapped;
}
