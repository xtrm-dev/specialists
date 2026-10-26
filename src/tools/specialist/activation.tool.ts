// src/tools/specialist/activation.tool.ts
//
// The Claude Code MCP frontend over `NativeActivationHost` — PRD Phase 13.
//
// Claude Code could previously obtain a Specialist only by shelling out to `sp run` in a
// terminal or an `xt` session. The native runtime already existed in-process, so the
// coordinator best placed to use it was the one that could not. These tools close that
// gap, and they close it by CALLING the host, never by spawning `sp`: a subprocess
// that runs `sp` would satisfy the letter of "expose the runtime over MCP" and defeat its
// entire purpose. No child process is reachable from here at all: inline-contract
// creation is owned by `host.start()` through the work boundary (validate → create →
// attest → claim), never by a subprocess. The live evidence for acceptance AV
// asserts the absence of `sp` against the process table rather than against intent.
//
// The gates are not re-implemented here, and that is the load-bearing property. Issue
// readiness, the StepContract compilation, the capability contract, the model gate and
// (once Phase 10 lands) the workspace writer lease all live inside `host.start()`. A
// second dispatch path that re-checked them would drift; a second dispatch path that
// skipped them is how gates die. This module's whole job is argument marshalling and
// snapshot projection.
//
// Deliberately NOT here: any message vocabulary of its own. `specialist_reply` carries an
// `InteractionMessage` through `host.answer()` (PRD invariant BH) — MCP is a
// serialisation of that type, never a parallel protocol. Asynchronous push toward Claude
// is Phase 14 and is why `specialist_status` reports pending asks by projection: until
// the push channel exists, a coordinator learns about a question by reading, and a
// reader that cannot see the ask is a Specialist stuck forever.
//
// Phase 14 (unitAI-rrdnt.34) adds the push half WITHOUT removing that read half. The
// coordinator address is a property of the dispatch, not of the runtime — the server
// builds one host for its whole life and learns a coordinator session only per call — so
// the dispatch registers the route and the settled result with `RuntimeEventPusher`, and
// `specialist_status` projects the same recorded results. A coordinator that never
// received the push reads the identical object here; that is what makes the notification
// a projection rather than the authority.

import * as z from 'zod';
import { wakeNotice } from '../../mcp/channel.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NativeActivationHost } from '../../activation/native-host.js';
import { describeBuildIdentity, isBuildStale, readBuildId } from '../../activation/build-identity.js';
import { validateContractText } from '../../activation/contract-sections.js';
import { FIX_BY_REASON, renderRejection } from '../../activation/rejection.js';
import { THINKING_LEVELS } from '../../activation/types.js';
import type { ActivationSnapshot, ActivationTokenUsage } from '../../activation/types.js';
import { DispatchRejectedError } from '../../activation/types.js';
import type { PendingAsk } from '../../activation/interaction.js';
import type { RuntimeEventPusher } from '../../activation/async-events.js';
import type { ActivationResult } from '../../activation/types.js';
import {
  SPECIALIST_DISPATCH_PARAMS,
  SPECIALIST_DISPATCH_RUNTIME_PARAMS,
  SPECIALIST_REPLY_PARAMS,
  SPECIALIST_RETRY_PARAMS,
  SPECIALIST_STEER_PARAMS,
  SPECIALIST_STOP_PARAMS,
  SPECIALIST_FULL_PARAM,
  specialistToolDescription,
} from './descriptions.js';

/**
 * Transport-neutral projection of one activation.
 *
 * Mirrors `ActivationSnapshot` rather than reshaping it, so an MCP reader and a Pi
 * extension reader answer "what is this Specialist doing" the same way. `workspace` is
 * flattened to its worktree path: the full `WorkspaceIdentity` is a runtime structure and
 * the coordinator needs the mutation domain, not the git plumbing.
 */
export interface ActivationView {
  activation_id: string;
  participant_id: string;
  attempt_id: string;
  specialist: string;
  bead_id: string;
  issue_id: string;
  issue_ref: string;
  issue_revision: number;
  contract_hash: string;
  execution_binding_id: string;
  state: string;
  access: 'read' | 'write';
  /** Present only when the activation runs under a lease waiver: a read-tier specialist
   *  holding a lease on its isolated per-Issue worktree. Absent otherwise. */
  lease_waiver?: true;
  worktree_path: string;
  branch?: string;
  pi_session_id?: string;
  /** What was asked for — the override when one was given, the configured model otherwise. */
  requested_model?: string;
  resolved_model: string;
  model_override: boolean;
  thinking_override: boolean;
  /** Seconds since dispatch, from the in-memory snapshot — never an observability.db query. */
  elapsed_s: number;
  /** Cumulative spend counts. Omitted until the first usage event (never zero-filled). */
  token_usage?: ActivationTokenUsage;
  /**
   * Completed child model turns, cumulative for the activation across attempts. Present from
   * dispatch on (the runtime initializes it to 0 accurately) — omitted only by a projection
   * of a hand-built snapshot that never carried one.
   */
  turn_count?: number;
  /** Thinking level from session creation. Omitted when unset (never fabricated). */
  thinking_level?: string;
  /** One-line purpose excerpt captured at dispatch. Omitted when absent (never fabricated). */
  purpose?: string;
  /** Last session-event time. Per-tool "doing X now" inference is out of scope. */
  last_activity_at: number;
  /**
   * Tool-surface notes from dispatch (SPECIALISTS-42): contract warnings and downgrade reasons.
   * Omitted when there were none, so a coordinator can read an empty absence as "nothing was
   * reduced" rather than as missing data. Not every note is a fault: a specialist that disables an
   * extension by design reports a deliberate exclusion here too.
   */
  tool_contract_notes?: string[];
  /** Spec settings this runtime ignores (SPECIALISTS-52), e.g. legacy-CLI-only beads_* fields. */
  config_notes?: string[];
}

export function toActivationView(snapshot: ActivationSnapshot, nowMs: number = Date.now()): ActivationView {
  return {
    activation_id: snapshot.activationId,
    participant_id: snapshot.participantId,
    attempt_id: snapshot.attemptId,
    specialist: snapshot.specialist,
    bead_id: snapshot.issueRef,
    issue_id: snapshot.issueId,
    issue_ref: snapshot.issueRef,
    issue_revision: snapshot.issueRevision,
    contract_hash: snapshot.contractHash,
    execution_binding_id: snapshot.executionBindingId,
    state: snapshot.state,
    access: snapshot.access,
    ...(snapshot.leaseWaiver ? { lease_waiver: true as const } : {}),
    worktree_path: snapshot.workspace.worktreePath,
    ...(snapshot.workspace.branch ? { branch: snapshot.workspace.branch } : {}),
    ...(snapshot.piSessionId ? { pi_session_id: snapshot.piSessionId } : {}),
    ...(snapshot.requestedModel ? { requested_model: snapshot.requestedModel } : {}),
    resolved_model: snapshot.resolvedModel,
    model_override: snapshot.modelOverride,
    thinking_override: snapshot.thinkingOverride,
    elapsed_s: Math.max(0, Math.floor((nowMs - snapshot.startedAt) / 1000)),
    ...(snapshot.turnCount !== undefined ? { turn_count: snapshot.turnCount } : {}),
    ...(snapshot.tokenUsage ? { token_usage: { ...snapshot.tokenUsage } } : {}),
    ...(snapshot.thinkingLevel ? { thinking_level: snapshot.thinkingLevel } : {}),
    ...(snapshot.purpose ? { purpose: snapshot.purpose } : {}),
    ...(snapshot.toolContractNotes?.length ? { tool_contract_notes: [...snapshot.toolContractNotes] } : {}),
    ...(snapshot.configNotes?.length ? { config_notes: [...snapshot.configNotes] } : {}),
    last_activity_at: snapshot.lastActivityAt,
  };
}

/** An outstanding question or escalation, projected for a coordinator that must answer it. */
export interface PendingAskView {
  message_id: string;
  kind: string;
  activation_id: string;
  attempt_id: string;
  from: string;
  to: string;
  body: string;
  delivery: string;
  asked_at: number;
}

/**
 * Compact activation summary — the DEFAULT tool-call rendering (SPECIALISTS-142).
 *
 * Identity, state, cost and intent: the fields a coordinator polling a Fleet
 * scans. Forensic and diagnostic fields (participant_id, attempt_id,
 * issue_id, issue_revision, contract_hash, execution_binding_id,
 * worktree_path, model_override, thinking_override, last_activity_at,
 * tool_contract_notes, config_notes) stay available under `full: true` via
 * `toActivationView`. A settled activation carries only the result STATUS
 * here — the result body is drill-down under `full`.
 */
export interface ActivationCompactView {
  activation_id: string;
  specialist: string;
  bead_id: string;
  issue_ref: string;
  state: string;
  access: 'read' | 'write';
  /** Present only when the activation runs under a lease waiver. Absent otherwise. */
  lease_waiver?: true;
  resolved_model: string;
  thinking_level?: string;
  elapsed_s: number;
  turn_count?: number;
  token_usage?: ActivationTokenUsage;
  purpose?: string;
  result_status?: string;
}

export function toActivationCompactView(snapshot: ActivationSnapshot, nowMs: number = Date.now()): ActivationCompactView {
  return {
    activation_id: snapshot.activationId,
    specialist: snapshot.specialist,
    bead_id: snapshot.issueRef,
    issue_ref: snapshot.issueRef,
    state: snapshot.state,
    access: snapshot.access,
    ...(snapshot.leaseWaiver ? { lease_waiver: true as const } : {}),
    resolved_model: snapshot.resolvedModel,
    ...(snapshot.thinkingLevel ? { thinking_level: snapshot.thinkingLevel } : {}),
    elapsed_s: Math.max(0, Math.floor((nowMs - snapshot.startedAt) / 1000)),
    ...(snapshot.turnCount !== undefined ? { turn_count: snapshot.turnCount } : {}),
    ...(snapshot.tokenUsage ? { token_usage: { ...snapshot.tokenUsage } } : {}),
    ...(snapshot.purpose ? { purpose: snapshot.purpose } : {}),
  };
}

/** Compact ask: the body is load-bearing (the coordinator must answer it), so it
 * stays; delivery plumbing (`attempt_id`, `to`, `delivery`) is `full`-only. */
export interface PendingAskCompactView {
  message_id: string;
  kind: string;
  activation_id: string;
  from: string;
  body: string;
  asked_at: number;
}

export function toPendingAskCompactView(ask: PendingAsk): PendingAskCompactView {
  return {
    message_id: ask.message.messageId,
    kind: ask.message.kind,
    activation_id: ask.message.activationId,
    from: ask.message.from,
    body: ask.message.body,
    asked_at: ask.askedAt,
  };
}

export function toPendingAskView(ask: PendingAsk): PendingAskView {
  return {
    message_id: ask.message.messageId,
    kind: ask.message.kind,
    activation_id: ask.message.activationId,
    attempt_id: ask.message.attemptId,
    from: ask.message.from,
    to: ask.message.to,
    body: ask.message.body,
    delivery: ask.delivery,
    asked_at: ask.askedAt,
  };
}

/**
 * A validated result, projected for a coordinator that reads instead of being pushed.
 *
 * This is the ONE projection of `ActivationResult`, and it carries its own identity so it
 * can stand alone in a list. The Pi extension attaches its result to an `ActivationView`
 * that already names the activation, so the identity fields are redundant there — but
 * redundant is not divergent, and two functions that describe the same settled activation
 * with different field sets is exactly how a Pi coordinator and a Claude coordinator end
 * up disagreeing about one object (`config/pi-extensions/native-specialists/index.mjs`,
 * unitAI-rrdnt.45). Exported from `lib.js` so the extension imports it rather than
 * restating it, the way it already does for `toActivationView`.
 */
export interface ActivationResultView {
  activation_id: string;
  participant_id: string;
  attempt_id: string;
  bead_id: string;
  issue_id: string;
  issue_ref: string;
  issue_revision: number;
  contract_hash: string;
  execution_binding_id: string;
  status: string;
  /** Explicitly `null` rather than absent: a missing key reads as "not projected yet". */
  output: unknown;
  validation: { valid: boolean; schema?: string; errors?: string[] };
  pi_session_id?: string;
  configured_model?: string;
  requested_model?: string;
  resolved_model: string;
  model_override: boolean;
  thinking_level?: string;
  thinking_override: boolean;
  fallback_used: boolean;
  completed_at: number;
}

export function toActivationResultView(result: ActivationResult): ActivationResultView {
  return {
    activation_id: result.activationId,
    participant_id: result.participantId,
    attempt_id: result.attemptId,
    bead_id: result.issueRef,
    issue_id: result.issueId,
    issue_ref: result.issueRef,
    issue_revision: result.issueRevision,
    contract_hash: result.contractHash,
    execution_binding_id: result.executionBindingId,
    status: result.status,
    output: result.output ?? null,
    validation: result.validation,
    ...(result.piSessionId ? { pi_session_id: result.piSessionId } : {}),
    ...(result.configuredModel ? { configured_model: result.configuredModel } : {}),
    ...(result.requestedModel ? { requested_model: result.requestedModel } : {}),
    resolved_model: result.resolvedModel,
    model_override: result.modelOverride,
    ...(result.thinkingLevel ? { thinking_level: result.thinkingLevel } : {}),
    thinking_override: result.thinkingOverride,
    fallback_used: result.fallbackUsed,
    completed_at: result.completedAt,
  };
}

// Build identity (unitAI-t2kol.4): which artifact this process loaded vs what is on
// disk now — the Pi LOADED_BUILD_ID pattern. This module runs in two layouts (src/
// under tsx/vitest, bundled dist/index.js in production), so the on-disk artifact is
// located by candidate, exactly like resolveCanonicalAssetDir. The loaded id is hashed
// once at module load; the on-disk id is re-read per refusal via readBuildId.
const DIST_LIB_PATH = (() => {
  for (const candidate of ['./lib.js', '../../../dist/lib.js']) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(path)) return path;
  }
  return fileURLToPath(new URL('../../../dist/lib.js', import.meta.url));
})();
const LOADED_BUILD_ID = readBuildId(DIST_LIB_PATH);

/**
 * Render a host-thrown `DispatchRejectedError` as an MCP tool result.
 *
 * The build comparison is computed ONCE and used for both jobs it serves: the
 * `build` line attached to the envelope, and the verdict on whether staleness
 * outranks the refusal's own reason (SPECIALISTS-2). A runtime that loaded an
 * older `dist/lib.js` used to answer every dispatch with a work-store refusal
 * that told the operator to install a package already installed — while the
 * same payload carried the correct staleness line. The comparison existed; it
 * just did not outrank the symptom.
 */
function renderDispatchRejection(error: DispatchRejectedError) {
  const onDiskBuildId = readBuildId(DIST_LIB_PATH);
  return renderRejection(
    { reason: error.message, detail: error.detail, missing: error.detail.missing },
    describeBuildIdentity(LOADED_BUILD_ID, onDiskBuildId),
    isBuildStale(LOADED_BUILD_ID, onDiskBuildId),
  );
}

/** Compact-by-default flag (SPECIALISTS-142): every verbose tool takes `full` and
 * returns the compact projection unless it is set. `full: true` restores the
 * pre-142 verbose shape byte-for-shape, so existing consumers opt back in. */
export const fullFlag = {
  full: z.boolean().optional().describe(SPECIALIST_FULL_PARAM),
};

export const specialistDispatchSchema = z.object({
  specialist: z.string().describe(SPECIALIST_DISPATCH_PARAMS.specialist),
  issue_ref: z.string().optional().describe(SPECIALIST_DISPATCH_PARAMS.issue_ref),
  bead_id: z.string().optional().describe(SPECIALIST_DISPATCH_PARAMS.bead_id),
  contract: z.string().optional().describe(SPECIALIST_DISPATCH_PARAMS.contract),
  title: z.string().optional().describe(SPECIALIST_DISPATCH_PARAMS.title),
  parent_ref: z.string().optional().describe(SPECIALIST_DISPATCH_PARAMS.parent_ref),
  kind: z.enum(['task', 'bug', 'research', 'decision', 'followup']).optional().describe(
    SPECIALIST_DISPATCH_PARAMS.kind,
  ),
  // Deliberately a bare number, not min(1).max(2): out-of-range values must reach
  // execute and come back as a structured refusal via the shared renderer, not as a
  // zod throw that surfaces as an opaque MCP error (server.ts parses before execute).
  epic_context_depth: z.number().optional().describe(
    SPECIALIST_DISPATCH_PARAMS.epic_context_depth,
  ),
  model_override: z.string().optional().describe(SPECIALIST_DISPATCH_PARAMS.model_override),
  thinking_override: z.enum(THINKING_LEVELS).optional().describe(
    SPECIALIST_DISPATCH_PARAMS.thinking_override,
  ),
  requested_by: z.string().optional().describe(
    SPECIALIST_DISPATCH_RUNTIME_PARAMS.mcp.requested_by,
  ),
  coordinator_session_id: z.string().optional().describe(
    SPECIALIST_DISPATCH_RUNTIME_PARAMS.mcp.coordinator_session_id,
  ),
  ...fullFlag,
});

/**
 * Dispatch a Specialist onto the in-process runtime.
 *
 * Returns as soon as the activation is admitted and started, NOT when it finishes. The
 * session deliberately outlives the call: a Specialist that reaches `settled` is waiting
 * and resumable, and a tool that blocked until completion would make every clarification
 * a deadlock — the coordinator cannot answer a question it is blocked waiting on.
 */
let wakeNoticeGiven = false;

/** Test seam: the next dispatch states the wake behaviour again. */
export function resetWakeNotice(): void {
  wakeNoticeGiven = false;
}

export function createSpecialistDispatchTool(
  getHost: () => NativeActivationHost,
  getPusher?: () => RuntimeEventPusher | undefined,
) {
  return {
    name: 'specialist_dispatch' as const,
    description: specialistToolDescription('specialist_dispatch', 'mcp'),
    inputSchema: specialistDispatchSchema,
    async execute(input: z.infer<typeof specialistDispatchSchema>) {
      const build = () => describeBuildIdentity(LOADED_BUILD_ID, readBuildId(DIST_LIB_PATH));
      try {
        // EITHER an existing issue ref OR an inline contract — never both, and the
        // readiness gate runs BEFORE anything is created (same gate the host runs at
        // admission, never a second one). Mirrors the Pi extension dispatch.
        //
        // `issue_ref` is the primary name and `bead_id` is a permanent compatibility alias for
        // the SAME value (SPECIALISTS-20). The alias resolves HERE, at the tool boundary: the
        // host keeps taking exactly one thing, `issueRef`, and no second name is pushed down
        // into ActivationRequest.
        const issueRef = (input.issue_ref ?? '').trim();
        const beadIdAlias = (input.bead_id ?? '').trim();
        const issueRefValue = issueRef || beadIdAlias;
        const contract = (input.contract ?? '').trim();
        const parentRef = (input.parent_ref ?? '').trim();
        const kind = (input.kind ?? '').trim();
        const supplied = [
          ...(issueRef ? ['issue_ref'] : []),
          ...(beadIdAlias ? ['bead_id'] : []),
          ...(contract ? ['contract'] : []),
        ];
        if (parentRef && issueRefValue) {
          return renderRejection({
            reason: 'parent_ref and issue_ref/bead_id were both provided — parent_ref only ' +
              'parents an issue created from an inline contract; provide exactly one of ' +
              'issue_ref, bead_id or contract',
            fix: FIX_BY_REASON.parent_ref_and_ref,
          }, build());
        }
        if (kind && issueRefValue) {
          return renderRejection({
            reason: 'kind and issue_ref/bead_id were both provided — kind only flavours an ' +
              'issue created from an inline contract',
            fix: FIX_BY_REASON.kind_and_ref,
          }, build());
        }
        if (parentRef && !contract) {
          return renderRejection({
            reason: 'parent_ref was provided without contract — it only parents the issue ' +
              'created from an inline contract',
            fix: FIX_BY_REASON.parent_ref_without_contract,
          }, build());
        }
        if (kind && !contract) {
          return renderRejection({
            reason: 'kind was provided without contract — it only flavours the issue ' +
              'created from an inline contract',
            fix: FIX_BY_REASON.kind_without_contract,
          }, build());
        }
        if (supplied.length > 1) {
          // Never silently resolved by preference order: a coordinator that passed two is
          // ambiguous, and guessing which one it meant is how work runs against the wrong contract.
          return renderRejection({
            reason: `both ${supplied.join(' and ')} were provided — provide exactly one of ` +
              'issue_ref, bead_id or contract; silently preferring one would dispatch against a ' +
              'contract the coordinator did not mean',
            fix: FIX_BY_REASON.contract_and_ref,
          }, build());
        }
        const epicContextDepth = input.epic_context_depth;
        if (epicContextDepth !== undefined && epicContextDepth !== 1 && epicContextDepth !== 2) {
          return renderRejection({
            reason: 'epic_context_depth must be 1 or 2 — 1 walks to the immediate parent epic, ' +
              '2 also includes the grand-epic',
            fix: 'Re-dispatch with epic_context_depth 1 or 2, or omit it for a single-Issue dispatch.',
          }, build());
        }
        // Lineage needs a parent: an inline contract honours epic_context_depth only
        // when parent_ref parents the created issue under an existing ancestor chain.
        const inline = !issueRefValue && contract ? contract : undefined;
        if (!issueRefValue && !inline) {
          return renderRejection({
            reason: 'neither issue_ref, bead_id nor contract was provided — dispatch requires a ' +
              'READY Issue (7 sections + SCRUTINY) or an inline contract',
            fix: FIX_BY_REASON.no_work_ref,
          }, build());
        }
        if (inline) {
          // The shared contract-text gate, BEFORE anything is created: a refused
          // dispatch leaves the board unchanged. The host re-validates
          // authoritatively inside inlineCreate — same parser, same verdict.
          const gate = validateContractText(inline);
          if (!gate.ok) {
            return renderRejection({ reason: gate.reason, missing: gate.missing, fix: FIX_BY_REASON.issue_not_dispatchable }, build());
          }
        }

        const handle = await getHost().start({
          specialist: input.specialist,
          ...(issueRefValue ? { issueRef: issueRefValue } : {}),
          // The host owns creation: validate → create → attest → claim through
          // the work boundary, claiming WITH this activation's id.
          ...(inline
            ? {
              contract: inline,
              ...(input.title ? { title: input.title } : {}),
              ...(parentRef ? { parentRef } : {}),
              ...(kind ? { kind } : {}),
            }
            : {}),
          // Honoured for an existing issue always; for an inline contract only when
          // parent_ref gives the created issue a lineage to walk.
          ...(epicContextDepth !== undefined && (!inline || parentRef) ? { epicContextDepth } : {}),
          surface: 'mcp',
          ...(input.model_override ? { modelOverride: input.model_override } : {}),
          ...(input.thinking_override ? { thinkingOverride: input.thinking_override } : {}),
          requestedByParticipantId: input.requested_by ?? 'adapter::specialists-mcp',
          ...(input.coordinator_session_id ? { coordinatorSessionId: input.coordinator_session_id } : {}),
        });

        // The handle's `result` promise is deliberately NOT awaited and deliberately not
        // dropped either: an unhandled rejection on a failed activation would take the
        // MCP server down with it. The host has already recorded the failure forensically
        // and in the snapshot, which is where a reader looks for it.
        //
        // It IS observed, though: settling records the validated result so a completion can
        // be projected from it, and only then is the notification pushed. The order is the
        // contract — `pushCompletion` refuses an activation that has not settled, so a push
        // can never describe a result that does not exist.
        const pusher = getPusher?.();
        pusher?.track(handle.activationId, {
          ...(input.coordinator_session_id ? { coordinatorSessionId: input.coordinator_session_id } : {}),
          coordinatorParticipantId: input.requested_by ?? 'adapter::specialists-mcp',
        });
        handle.result.then(
          async (result) => {
            if (!pusher) return;
            pusher.settle(result);
            // A push that cannot be routed is not an error: the durable record is already
            // written and the result is readable through specialist_status either way.
            await pusher.pushCompletion(handle.activationId).catch(() => { /* degraded to polling */ });
          },
          () => { /* observed via specialist_status */ },
        );

        const snapshot = getHost().inspect(handle.activationId);
        const view = snapshot
          ? input.full ? toActivationView(snapshot) : toActivationCompactView(snapshot)
          : { activation_id: handle.activationId };
        // Said once per server process, at the first successful dispatch.
        const notice = wakeNoticeGiven ? {} : { wake_notice: wakeNotice() };
        wakeNoticeGiven = true;
        return {
          status: 'dispatched' as const,
          ...view,
          ...notice,
          // Inline dispatch creates durable Substrate work. Surface the Issue ref
          // explicitly; retain the old created_bead_* names only as compatibility aliases
          // for consumers that predate the semantic cutover.
          ...(inline
            ? {
              created_issue_ref: handle.issueRef,
              created_issue_note:
                'This dispatch CREATED the Substrate Issue above from your inline contract. '
                + 'Track its Journal/result/provenance explicitly. Specialist settlement is '
                + 'evidence, not Issue Closure; use the authorized Substrate lifecycle for Closure.',
              created_bead_id: handle.issueRef,
              created_bead_note:
                'Compatibility alias: created_issue_ref is the authority. Track Journal/result/'
                + 'provenance explicitly; settlement is not Issue Closure.',
            }
            : {}),
          step_contract: {
            root_work_ref: handle.stepContract.rootWorkRef,
            inputs: handle.stepContract.inputs.length,
            outputs: handle.stepContract.outputs.length,
          },
        };
      } catch (error) {
        // A refusal is the gate working, so it stays a returned tool result — throwing
        // would reach Claude as an opaque MCP error string. Shape comes from the shared
        // renderer: `missing` is promoted top-level but never removed from `detail`.
        if (error instanceof DispatchRejectedError) {
          return renderDispatchRejection(error);
        }
        throw error;
      }
    },
  };
}

export const specialistSteerSchema = z.object({
  activation_id: z.string().describe(SPECIALIST_STEER_PARAMS.activation_id),
  message: z.string().describe(SPECIALIST_STEER_PARAMS.message),
  ...fullFlag,
});

/**
 * Steer a running activation mid-run (SPECIALISTS-141).
 *
 * The missing channel: `specialist_reply` answers outstanding asks only, and
 * `specialist_resume` refuses running activations — so a quiet executor could
 * only be stopped, never redirected. This delivers into the LIVE session
 * (`host.steer` → `session.steer`): same session, same attempt, no lease
 * movement. Refusals point at the owning tool (resume/retry/reply/stop).
 */
export function createSpecialistSteerTool(getHost: () => NativeActivationHost) {
  return {
    name: 'specialist_steer' as const,
    description: specialistToolDescription('specialist_steer', 'mcp'),
    inputSchema: specialistSteerSchema,
    async execute(input: z.infer<typeof specialistSteerSchema>) {
      const build = () => describeBuildIdentity(LOADED_BUILD_ID, readBuildId(DIST_LIB_PATH));
      try {
        await getHost().steer(input.activation_id, input.message);
        const snapshot = getHost().inspect(input.activation_id);
        return {
          status: 'steered' as const,
          ...(snapshot
            ? input.full ? toActivationView(snapshot) : toActivationCompactView(snapshot)
            : { activation_id: input.activation_id }),
        };
      } catch (error) {
        if (error instanceof DispatchRejectedError) {
          return renderDispatchRejection(error);
        }
        throw error;
      }
    },
  };
}

export const specialistReplySchema = z.object({
  message_id: z.string().describe(SPECIALIST_REPLY_PARAMS.message_id),
  body: z.string().describe(SPECIALIST_REPLY_PARAMS.body),
});

/**
 * Answer an outstanding question or escalation.
 *
 * The answer resumes the child inside its existing tool call, so the same AgentSession
 * continues with its context intact rather than being restarted with an answer pasted
 * into a fresh prompt.
 */
export function createSpecialistReplyTool(getHost: () => NativeActivationHost) {
  return {
    name: 'specialist_reply' as const,
    description: specialistToolDescription('specialist_reply', 'mcp'),
    inputSchema: specialistReplySchema,
    async execute(input: z.infer<typeof specialistReplySchema>) {
      const message = await getHost().answer(input.message_id, input.body);
      if (!message) {
        return {
          status: 'error' as const,
          error: `No outstanding ask with message_id '${input.message_id}' — it may have been answered already, or its activation may have been disposed.`,
          message_id: input.message_id,
        };
      }
      return {
        status: 'answered' as const,
        message_id: message.messageId,
        in_reply_to: message.inReplyTo,
        activation_id: message.activationId,
        attempt_id: message.attemptId,
      };
    },
  };
}

export const specialistStopSchema = z.object({
  activation_id: z.string().describe(SPECIALIST_STOP_PARAMS.activation_id),
  reason: z.string().optional().describe(SPECIALIST_STOP_PARAMS.reason),
});
/**
 * Stop and dispose a native activation.
 *
 * Distinct from the legacy `stop_specialist`, which SIGTERMs a `sp run` child process by
 * its recorded pid. There is no child process here; disposal is a method call, and it is
 * the only ordinary path to disposal because settling is not one.
 */
export function createSpecialistStopActivationTool(getHost: () => NativeActivationHost) {
  return {
    name: 'specialist_stop_activation' as const,
    description: specialistToolDescription('specialist_stop_activation', 'mcp'),
    inputSchema: specialistStopSchema,
    async execute(input: z.infer<typeof specialistStopSchema>) {
      const before = getHost().inspect(input.activation_id);
      if (!before) {
        return {
          status: 'error' as const,
          error: `Unknown activation: ${input.activation_id}`,
          activation_id: input.activation_id,
        };
      }
      await getHost().stop(input.activation_id, input.reason ?? 'mcp operator request');
      return { status: 'stopped' as const, activation_id: input.activation_id };
    },
  };
}

export const specialistRetrySchema = z.object({
  activation_id: z.string().describe(SPECIALIST_RETRY_PARAMS.activation_id),
  model_override: z.string().optional().describe(SPECIALIST_RETRY_PARAMS.model_override),
  prompt: z.string().optional().describe(SPECIALIST_RETRY_PARAMS.prompt),
  ...fullFlag,
});

/**
 * Re-run a failed native activation in place — the native equivalent of `sp retry`.
 *
 * Same activation id, new attempt. The Issue and (without a model override) the session
 * survive the retry; the workspace lease is released as the attempt ends and REACQUIRED
 * here, so a retry can be refused when another writer holds the workspace. Failed only — a live or waiting activation
 * already has its path (reply for an outstanding question, resume for a settled one,
 * steer/stop for a running one), and retry refuses those states with the right pointer
 * rather than becoming a second dispatch. An escalation or question that CAN wait stays
 * an ask answered with specialist_reply; retry is for runs that already died.
 */
export function createSpecialistRetryTool(
  getHost: () => NativeActivationHost,
  getPusher?: () => RuntimeEventPusher | undefined,
) {
  return {
    name: 'specialist_retry' as const,
    description: specialistToolDescription('specialist_retry', 'mcp'),
    inputSchema: specialistRetrySchema,
    async execute(input: z.infer<typeof specialistRetrySchema>) {
      try {
        const handle = await getHost().retry(input.activation_id, {
          ...(input.model_override ? { modelOverride: input.model_override } : {}),
          ...(input.prompt ? { prompt: input.prompt } : {}),
        });

        // Same observation contract as dispatch, minus the route: the coordinator address
        // is a property of the dispatch, so retry must not re-track and clobber it. The
        // retried result settles the recorded completion and its push, readable through
        // specialist_status either way.
        const pusher = getPusher?.();
        handle.result.then(
          async (result) => {
            if (!pusher) return;
            pusher.settle(result as ActivationResult);
            await pusher.pushCompletion(handle.activationId).catch(() => { /* degraded to polling */ });
          },
          () => { /* observed via specialist_status */ },
        );

        const snapshot = getHost().inspect(handle.activationId);
        const view = snapshot
          ? input.full ? toActivationView(snapshot) : toActivationCompactView(snapshot)
          : { activation_id: handle.activationId };
        return {
          status: 'retried' as const,
          ...view,
        };
      } catch (error) {
        if (error instanceof DispatchRejectedError) {
          return renderDispatchRejection(error);
        }
        throw error;
      }
    },
  };
}
