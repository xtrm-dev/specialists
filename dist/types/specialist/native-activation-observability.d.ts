import type { PiAgentSessionEvent, PiAgentSessionLike } from '../activation/pi-sdk.js';
import { type TimelineEvent, type TimelineTokenUsage } from './timeline-events.js';
import { type PiSessionStats } from './session-metrics-contract.js';
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
export declare const NATIVE_LIFECYCLE_OBSERVABILITY_GAPS: Readonly<{
    readonly activation_requested: "Dispatch intent precedes the legacy run_start boundary and has no timeline event.";
    readonly step_contract_compiled: "Step-contract compilation has no legacy AgentSession event.";
    readonly activation_starting: "Session construction has no legacy timeline event; run_start follows once construction succeeds.";
    readonly output_validation_started: "Native result validation has no legacy timeline event kind.";
    readonly output_validation_passed: "Native result validation has no legacy timeline event kind.";
    readonly output_validation_failed: "Native result validation has no legacy timeline event kind; terminal failure is run_complete.";
    readonly activation_disposed: "In-memory session disposal after a terminal event has no legacy timeline event.";
    readonly lease_released: "Workspace-lease teardown has no legacy timeline event.";
    readonly lease_reconciled: "Lease reconciliation has no legacy timeline event.";
    readonly clarification_requested: "Peer interaction has no legacy timeline event; interactions persist as files, not timeline rows.";
    readonly clarification_answered: "Peer interaction has no legacy timeline event; interactions persist as files, not timeline rows.";
    readonly escalation_raised: "Peer interaction has no legacy timeline event; interactions persist as files, not timeline rows.";
    readonly escalation_resolved: "Peer interaction has no legacy timeline event; interactions persist as files, not timeline rows.";
    readonly turn_started: "Suppressed compatibility alias; the raw Pi turn_start event is canonical.";
    readonly turn_completed: "Suppressed compatibility alias; the raw Pi turn_end event is canonical.";
    readonly retry_started: "Suppressed compatibility alias; the raw Pi auto_retry_start event is canonical.";
    readonly retry_completed: "Suppressed compatibility alias; the raw Pi auto_retry_end event is canonical.";
    readonly compaction_started: "Suppressed compatibility alias; the raw Pi compaction_start event is canonical.";
    readonly compaction_completed: "Suppressed compatibility alias; the raw Pi compaction_end event is canonical.";
}>;
/** Pi session signals intentionally omitted from the legacy-compatible timeline. */
export declare const NATIVE_SESSION_OBSERVABILITY_GAPS: Readonly<{
    readonly agent_start: "turn_start is the canonical turn boundary.";
    readonly agent_end: "run_complete is emitted by the activation lifecycle; agent_end is not a run boundary.";
    readonly agent_settled: "The lifecycle activation_settled signal projects the waiting status.";
    readonly message_update: "Only thinking deltas are projected; text is persisted once at assistant message_end.";
    readonly message_user: "User and custom-message boundaries are not persisted by the legacy timeline mapper.";
    readonly queue_update: "The legacy runner does not persist Pi prompt-queue state.";
    readonly entry_appended: "Session transcript persistence is not a timeline event.";
    readonly session_info_changed: "Session display-name changes are not a timeline event.";
    readonly thinking_level_changed: "The legacy runner does not persist thinking-level changes.";
    readonly summarization_retry_scheduled: "The legacy runner has no summarization-retry timeline event.";
    readonly summarization_retry_attempt_start: "The legacy runner has no summarization-retry timeline event.";
    readonly summarization_retry_finished: "The legacy runner has no summarization-retry timeline event.";
    readonly bash_execution_update: "The legacy runner does not persist streaming bash deltas.";
}>;
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
export declare const NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED: Readonly<{
    readonly extension_discovery_sessions: "Emit site src/activation/native-host.ts emits per-activation discovery cost (2 fenced sessions); no extension telemetry surface exists (no table/column/writer) and the operator ruled extension resolution out of scope for this migration, so creating one is deferred. Absence is explicit, not silent.";
    readonly extension_tools_discovered: "Emit site src/activation/native-host.ts emits the pinned extension tool list; no extension telemetry surface exists (no table/column/writer) and the operator ruled extension resolution out of scope for this migration, so creating one is deferred. Absence is explicit, not silent.";
    readonly extension_tools_refused: "Emit site src/activation/native-host.ts emits refused extension tools (collisions/provenance); no extension telemetry surface exists (no table/column/writer) and the operator ruled extension resolution out of scope for this migration, so creating one is deferred. The admission verdict persists on the session; the audit trail does not.";
}>;
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
export declare function nativeSessionTokenUsage(event: PiAgentSessionEvent): TimelineTokenUsage | undefined;
/**
 * The events that carry billable Pi usage (SPECIALISTS-120 F1).
 *
 * ONE rule, consulted by {@link nativeEventTokenUsage} and by the host accumulator's gate, so
 * adding an event shape cannot silently update one runtime and not the other.
 */
export declare function isNativeUsageEvent(event: PiAgentSessionEvent): boolean;
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
export declare function nativeEventTokenUsage(event: PiAgentSessionEvent): TimelineTokenUsage | undefined;
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
export declare function captureNativeSessionStats(session: Pick<PiAgentSessionLike, 'getSessionStats'>, timeoutMs?: number): Promise<{
    stats?: PiSessionStats;
    error?: string;
}>;
/**
 * Per-message usage accumulation lives in the neutral session-metrics contract
 * (SPECIALISTS-120): the legacy RPC runtime needs the same dual-shape rule, and importing it
 * from a native-activation module would have created a `pi/session -> native-activation ->
 * pi-sdk -> pi/session` cycle. Re-exported here so existing importers are unchanged.
 */
export { accumulateTokenUsage } from './session-metrics-contract.js';
/** Parse the stable trailing sequence from `att:<activation>:N`. */
export declare function nativeAttemptNo(attemptId: string): number;
/** Advance a runtime-owned attempt ID without replacing its identity namespace. */
export declare function nativeAttemptIdForNo(initialAttemptId: string, attemptNo: number): string;
/** Map native host lifecycle signals onto existing legacy timeline vocabulary. */
export declare function mapNativeLifecycleEvent(event: NativeLifecycleEvent, context: NativeLifecycleProjectionContext, t?: number): TimelineEvent | null;
/**
 * Map a public Pi AgentSession event onto the same timeline events used by legacy `sp run`.
 * One Pi message boundary can produce both the boundary row and the legacy text row.
 */
export declare function mapNativeSessionEvent(event: PiAgentSessionEvent, t?: number, turnIndex?: number): TimelineEvent[];
//# sourceMappingURL=native-activation-observability.d.ts.map