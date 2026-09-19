/**
 * Native-activation adapter for the canonical Specialists observability pipeline.
 *
 * Native and legacy activations write one `observability.db`. Native events are projected
 * onto the existing timeline vocabulary, written through the same append-event writer
 * (which mirrors every timeline row into `specialist_forensic_events`), and carry the
 * full v15 identity lineage. There is deliberately NO native-subagent telemetry database
 * and no second forensic model: a native activation and a legacy one are answerable by
 * one query against one store.
 *
 * Producer rule: raw Pi events enter through `sessionEvent` and are the sole producers of
 * turn, message, tool, retry, and compaction timeline rows. The host's legacy translated
 * `emit` aliases remain status-only to avoid duplicate rows. `activation_settled` stays on
 * `emit` and is the sole producer of the waiting status-change row.
 */

import type { ActivationForensicSink, NativeActivationSessionEventInput } from './native-host.js';
import {
  accumulateTokenUsage,
  mapNativeLifecycleEvent,
  mapNativeSessionEvent,
  nativeAttemptNo,
  nativeEventTokenUsage,
} from '../specialist/native-activation-observability.js';
import type {
  ObservabilityIdentityProjection,
  ObservabilitySqliteClient,
} from '../specialist/observability-sqlite.js';
import {
  TIMELINE_EVENT_TYPES,
  type TimelineEvent,
  type TimelineTokenUsage,
} from '../specialist/timeline-events.js';
import { normalizePiSessionStats, reconcileSessionUsage, type PiSessionStats } from '../specialist/session-metrics-contract.js';
import type { SupervisorJobStatus, SupervisorStatus } from '../specialist/status-contract.js';

interface ActivationProjectionState {
  attemptId: string;
  attemptNo: number;
  specialist: string;
  beadId?: string;
  startedAtMs: number;
  lastEventAtMs: number;
  status: SupervisorJobStatus;
  workspacePath?: string;
  piSessionId?: string;
  resolvedModel?: string;
  latestOutput?: string;
  tokenUsage?: TimelineTokenUsage;
  /** Pi's terminal session snapshot, captured at settlement. Absent means it was not captured. */
  sessionStats?: PiSessionStats;
  /** Pi version recorded for this run. */
  piVersion?: string;
  /** Last per-message usage values; see accumulateTokenUsage — same dual-shape rule as the host. */
  lastUsageSeen: Record<string, number>;
  finishReason?: string;
  toolCalls: string[];
  turns: number;
  autoRetries: number;
  autoCompactions: number;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function statusForLifecycle(name: string, current: SupervisorJobStatus): SupervisorJobStatus {
  switch (name) {
    case 'activation_requested':
    case 'activation_admitted':
    case 'activation_starting':
      return 'starting';
    case 'activation_started':
    case 'activation_resumed':
    case 'turn_started':
      return 'running';
    case 'activation_settled':
      return 'waiting';
    case 'activation_completed':
      return 'done';
    case 'activation_failed':
    case 'activation_rejected':
    case 'output_validation_failed':
      return 'error';
    default:
      return current;
  }
}

function statusForSessionEvent(type: string, current: SupervisorJobStatus): SupervisorJobStatus {
  if (type === 'agent_start' || type === 'turn_start') return 'running';
  if (type === 'agent_settled') return 'waiting';
  return current;
}

/**
 * Lifecycle events whose payload `reason` is genuine error text.
 *
 * Exactly the events that move the activation to error status (see
 * statusForLifecycle): a rejection/failure reason IS the error, while a warning
 * or lifecycle reason (stale_warning, compaction_*, lease_denied, lease_released,
 * activation_disposed) is not. Those keep their detail in their forensic rows;
 * the status row stays error-free until something actually fails.
 */
const ERROR_STATUS_LIFECYCLE = new Set([
  'activation_failed',
  'activation_rejected',
  'output_validation_failed',
]);

function identityOf(state: ActivationProjectionState): ObservabilityIdentityProjection {
  return { attemptId: state.attemptId, attemptNo: state.attemptNo };
}

function statusOf(
  activationId: string,
  state: ActivationProjectionState,
  currentEvent: string | undefined,
  error?: string,
): SupervisorStatus {
  const elapsedMs = Math.max(0, state.lastEventAtMs - state.startedAtMs);
  // SPECIALISTS-120 criterion 2 (F4): native status rows publish the same two-value provenance
  // vocabulary the legacy path uses. Pi's own reading is `pi_session_stats`; with no snapshot
  // the fields stay ABSENT rather than guessed, because the host never sees the model's context
  // window and therefore cannot compute the legacy `specialists_fallback` estimate. A `null`
  // percent (Pi's post-compaction state) is not a reading either and stays absent.
  // `context_health` is deliberately not published: its threshold table lives with the legacy
  // supervisor, and every consumer derives health from `context_pct`.
  const contextPct = typeof state.sessionStats?.contextUsage?.percent === 'number'
    ? Number(state.sessionStats.contextUsage.percent.toFixed(2))
    : undefined;
  // SPECIALISTS-120 criterion 5: the run-level reconciliation is exposed on every status
  // projection, so a reader sees the difference between Specialists' summed usage and Pi's
  // session snapshot without re-deriving it.
  const reconciliation = reconcileSessionUsage(state.tokenUsage, state.sessionStats);
  return {
    id: activationId,
    specialist: state.specialist,
    status: state.status,
    current_event: currentEvent,
    model: state.resolvedModel,
    backend: state.resolvedModel?.split('/')[0],
    started_at_ms: state.startedAtMs,
    elapsed_s: elapsedMs / 1_000,
    last_event_at_ms: state.lastEventAtMs,
    bead_id: state.beadId,
    session_id: state.piSessionId,
    worktree_path: state.workspacePath,
    metrics: {
      token_usage: state.tokenUsage,
      ...(state.tokenUsage?.cost ? { cost: state.tokenUsage.cost } : {}),
      ...(state.sessionStats ? { session_stats: state.sessionStats } : {}),
      ...(reconciliation ? { reconciliation } : {}),
      ...(state.piVersion ? { pi_version: state.piVersion } : {}),
      finish_reason: state.finishReason,
      turns: state.turns,
      tool_calls: state.toolCalls.length,
      tool_call_names: state.toolCalls,
      auto_compactions: state.autoCompactions,
      auto_retries: state.autoRetries,
    },
    ...(contextPct !== undefined ? { context_pct: contextPct, context_pct_source: 'pi_session_stats' as const } : {}),
    error,
  };
}

function newProjectionState(input: {
  attemptId: string;
  specialist: string;
  beadId?: string;
  startedAtMs: number;
}): ActivationProjectionState {
  return {
    attemptId: input.attemptId,
    attemptNo: nativeAttemptNo(input.attemptId),
    specialist: input.specialist,
    beadId: input.beadId,
    startedAtMs: input.startedAtMs,
    lastEventAtMs: input.startedAtMs,
    status: 'starting',
    lastUsageSeen: {},
    toolCalls: [],
    turns: 0,
    autoRetries: 0,
    autoCompactions: 0,
  };
}

/**
 * Build a failure-isolated sink backed by the shared timeline/forensic writer.
 *
 * `null` remains a true no-op. A database failure is diagnostic loss and must never change
 * native activation behavior.
 */
export function createActivationForensicSink(
  observability: ObservabilitySqliteClient | null,
): ActivationForensicSink {
  if (!observability) return { emit: () => {}, sessionEvent: () => {} };

  const states = new Map<string, ActivationProjectionState>();

  const writeProjection = (
    activationId: string,
    state: ActivationProjectionState,
    currentEvent: string | undefined,
    timelineEvents: readonly TimelineEvent[],
    error?: string,
  ): void => {
    const status = statusOf(activationId, state, currentEvent, error);
    if (timelineEvents.length > 0) {
      observability.upsertStatusWithEvents(status, timelineEvents, identityOf(state));
    } else {
      observability.upsertStatus(status, identityOf(state));
    }
  };

  /**
   * Aggregate this activation's metrics row exactly once, at its terminal event
   * (SPECIALISTS-107).
   *
   * The accumulator is a pure function of the durable event stream (`specialist_events`
   * joined to `specialist_jobs`), so re-running it on the same stream is idempotent —
   * the writer is `INSERT ... ON CONFLICT(job_id) DO UPDATE` over the full record.
   * The once-per-activation guard below is therefore delivery control, not correctness:
   * it keeps a retried/resumed activation from re-scanning its whole stream on every
   * intermediate terminal leg when nothing changed. Rollback safety: the flag is set
   * only when the call returns without throwing, so a transient write failure retries
   * on the next terminal event instead of silently skipping the row forever.
   *
   * Failure-isolated like every other sink write: best-effort, never throws, so a
   * metrics-write failure is diagnostic loss, not activation failure.
   *
   * Cost: one bounded `SELECT ... WHERE job_id = ?` stream scan (index-backed on
   * `idx_specialist_events_job_seq`) plus one upsert — the same cost legacy pays per
   * completion via `aggregateJobMetricsBestEffort`. No forensic-table scan, no new index.
   */
  // Keyed by activation + attempt: a resumed/retried activation is a NEW stream leg whose
  // later terminal event must re-aggregate (its row must reflect the resumed work), while a
  // repeated terminal emit for the SAME attempt (e.g. fallback intermediate failures landing
  // on publishTerminalSettlement) must not re-scan. The underlying writer is idempotent
  // regardless — same stream in, same record out — so this is delivery control, not
  // correctness.
  const aggregatedAtTerminal = new Set<string>();
  const aggregateTerminalMetrics = (activationId: string, attemptId: string): void => {
    const key = `${activationId}/${attemptId}`;
    if (aggregatedAtTerminal.has(key)) return;
    try {
      observability.aggregateJobMetrics(activationId);
      aggregatedAtTerminal.add(key);
    } catch {
      // Best-effort: a later terminal event retries. Never throws into the activation.
    }
  };

  return {
    emit(event) {
      try {
        const now = Date.now();
        const existing = states.get(event.activationId);
        const state: ActivationProjectionState = existing ?? newProjectionState({
          attemptId: event.attemptId,
          specialist: event.specialist,
          beadId: event.beadId,
          startedAtMs: now,
        });

        state.attemptId = event.attemptId;
        state.attemptNo = nativeAttemptNo(event.attemptId);
        state.lastEventAtMs = now;
        state.status = statusForLifecycle(event.name, state.status);
        state.workspacePath = stringValue(event.payload?.workspace) ?? state.workspacePath;
        state.piSessionId = stringValue(event.payload?.pi_session_id) ?? state.piSessionId;
        state.resolvedModel = stringValue(event.payload?.resolved_model) ?? state.resolvedModel;
        // The host's activation_completed payload carries the authoritative settle output
        // (textOf the last assistant message). It overwrites latestOutput even when empty:
        // an empty final message means empty output, not the previous turn's text.
        const completedOutput = event.name === 'activation_completed' && typeof event.payload?.output === 'string'
          ? event.payload.output as string
          : undefined;
        if (completedOutput !== undefined) state.latestOutput = completedOutput;
        // SPECIALISTS-120: the settlement capture arrives as its own lifecycle event, BEFORE
        // the terminal activation event, so run_complete can carry the snapshot and its
        // reconciliation. Both outcomes are stashed; a failed capture records the reason
        // rather than leaving a silently absent snapshot.
        if (event.name === 'session_stats_captured' || event.name === 'session_stats_failed') {
          const captured = normalizePiSessionStats(event.payload?.session_stats);
          if (captured) state.sessionStats = captured;
          state.piVersion = stringValue(event.payload?.pi_version) ?? state.piVersion;
        }
        states.set(event.activationId, state);

        // `reason` is a diagnostic discriminator, not an error: legacy only writes
        // status.error on genuinely failed runs (appendTimelineEvent never calls
        // setStatus). Project it as error text ONLY when the event itself moves the
        // activation to error status — otherwise a healthy running activation would
        // carry error:"tool_duration" (stale_warning, SPECIALISTS-102) or
        // error:"<compaction reason>" while still running, which operators read as
        // failure (status.ts prints job.error on ANY status). Keep in sync with the
        // 'error' arm of statusForLifecycle above.
        const error = stringValue(event.payload?.error)
          ?? (ERROR_STATUS_LIFECYCLE.has(event.name) ? stringValue(event.payload?.reason) : undefined);
        const timelineEvent = mapNativeLifecycleEvent(event, {
          startedAtMs: state.startedAtMs,
          workspacePath: state.workspacePath,
          resolvedModel: state.resolvedModel,
          output: state.latestOutput,
          tokenUsage: state.tokenUsage,
          finishReason: state.finishReason,
          toolCalls: state.toolCalls,
          turns: state.turns,
          autoRetries: state.autoRetries,
          autoCompactions: state.autoCompactions,
          ...(state.sessionStats ? { sessionStats: state.sessionStats } : {}),
          ...(state.piVersion ? { piVersion: state.piVersion } : {}),
        }, now);
        if (event.name === 'activation_completed' && timelineEvent && state.latestOutput !== undefined) {
          // Forensic durability, not display: persist the settle output to
          // specialist_jobs.last_output + specialist_results, mirroring the legacy
          // supervisor's upsertStatusWithEventAndResult:complete path. The forensic
          // row still goes through the redacting writer, so event_json redaction is unchanged.
          const status = statusOf(event.activationId, state, timelineEvent.type, error);
          const withResult = (observability as Partial<Pick<ObservabilitySqliteClient, 'upsertStatusWithEventAndResult' | 'upsertResult'>>).upsertStatusWithEventAndResult;
          if (typeof withResult === 'function') {
            withResult.call(observability, status, timelineEvent, state.latestOutput, identityOf(state));
          } else {
            writeProjection(
              event.activationId,
              state,
              timelineEvent?.type,
              timelineEvent ? [timelineEvent] : [],
              error,
            );
          }
        } else {
          writeProjection(
            event.activationId,
            state,
            timelineEvent?.type,
            timelineEvent ? [timelineEvent] : [],
            error,
          );
        }

        // SPECIALISTS-107 reachability: the row this activation's metrics readers need is
        // materialised at the terminal event, AFTER the projection write above (the job row
        // must exist for the accumulator's SELECT to find it). The neutral row shape is the
        // existing `specialist_job_metrics` writer — same table, same columns, same
        // `ON CONFLICT(job_id) DO UPDATE` — so a native row is indistinguishable from a
        // legacy one to every downstream reader (Prometheus, `sp db stats`). No
        // Supervisor-isms are baked in: the accumulator reads only the shared timeline
        // vocabulary (`run_start` / `status_change` / `run_complete` / `tool` /
        // `turn_summary` / `stale_warning`), which the mapper already projects natively.
        // `output_validation_failed` is terminal too (mapped to run_complete ERROR), while
        // `activation_disposed` (stop path) carries no timeline event by design — see below.
        if (
          event.name === 'activation_completed'
          || event.name === 'activation_failed'
          || event.name === 'activation_rejected'
          || event.name === 'output_validation_failed'
        ) {
          aggregateTerminalMetrics(event.activationId, event.attemptId);
        }

        if (event.name === 'activation_disposed') {
          // A stopped activation never emits a terminal lifecycle event (stop() writes the
          // status row directly and ends with `activation_disposed`, which the mapper drops
          // by design). Without this, a stopped activation would leave no metrics row — the
          // same absence 107 exists to remove. The stream still ends in a terminal status
          // (`stopped` via the status row), so aggregation reads a coherent, if short, stream.
          aggregateTerminalMetrics(event.activationId, event.attemptId);
          states.delete(event.activationId);
          for (const key of [...aggregatedAtTerminal]) {
            if (key.startsWith(`${event.activationId}/`)) aggregatedAtTerminal.delete(key);
          }
        }
      } catch {
        // Never let an observability write failure abort an activation.
      }
    },

    sessionEvent(input: NativeActivationSessionEventInput) {
      try {
        const now = Date.now();
        const existing = states.get(input.activationId);
        const state: ActivationProjectionState = existing ?? newProjectionState({
          attemptId: input.attemptId,
          specialist: input.specialist,
          beadId: input.beadId,
          startedAtMs: now,
        });

        state.attemptId = input.attemptId;
        state.attemptNo = nativeAttemptNo(input.attemptId);
        if (input.event.type === 'auto_retry_start') state.autoRetries += 1;
        if (input.event.type === 'turn_start') state.turns += 1;
        if (input.event.type === 'compaction_start') state.autoCompactions += 1;
        state.lastEventAtMs = now;
        state.status = statusForSessionEvent(input.event.type, state.status);
        // The host passes `snapshot.piSessionId ?? ''` before a session exists; a blank
        // must never clear an identity the status row already carries.
        if (stringValue(input.piSessionId)) state.piSessionId = input.piSessionId;
        state.workspacePath = input.workspacePath;
        states.set(input.activationId, state);

        const timelineEvents = mapNativeSessionEvent(input.event, now, state.turns);
        // SPECIALISTS-120 F1: fold through the SAME rule the host's live accumulator uses, so a
        // compacted run's summarization usage reaches the projection as well. Reading only the
        // mapped TOKEN_USAGE rows missed it — that usage rides on the COMPACTION row — which left
        // this accumulator disagreeing with the host and with Pi's own session totals, and turned
        // every compacted activation into `reconciled=false` with a delta of exactly the
        // summarization call.
        const eventUsage = nativeEventTokenUsage(input.event);
        if (eventUsage) state.tokenUsage = accumulateTokenUsage(state.tokenUsage, eventUsage, state.lastUsageSeen);
        for (const timelineEvent of timelineEvents) {
          if (timelineEvent.type === TIMELINE_EVENT_TYPES.TEXT && typeof timelineEvent.content === 'string') {
            state.latestOutput = timelineEvent.content;
          }
          if (timelineEvent.type === TIMELINE_EVENT_TYPES.FINISH_REASON) state.finishReason = timelineEvent.finish_reason;
          if (timelineEvent.type === TIMELINE_EVENT_TYPES.TOOL && timelineEvent.phase === 'end') {
            state.toolCalls.push(timelineEvent.tool);
          }
        }
        writeProjection(input.activationId, state, timelineEvents.at(-1)?.type, timelineEvents);
      } catch {
        // Never let an observability write failure abort an activation.
      }
    },
  };
}
