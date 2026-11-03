import type { DispatchRejectedError } from './types.js';

/**
 * Shared refusal renderer (unitAI-t2kol.4).
 *
 * Three renderers described one gate: the Pi issue-path `{status,reason,detail}`
 * plus build, the Pi inline-path `{status,reason,missing}` plus build, and the
 * MCP local `{status,reason,detail}` with no build and `missing` buried in
 * detail. An MCP operator could not see top-level `missing` and could not tell
 * a stale-build refusal from a broken-contract refusal. This is the single
 * renderer both frontends use; the Pi extension adopts it (SPECIALISTS-4341).
 *
 * Pure given explicit inputs: the caller renders the build string with
 * `describeBuildIdentity(loadedId, readBuildId(path))` and passes it in, so
 * tests never touch the filesystem. `missing` is promoted to the top level by
 * the caller and is never stripped from `detail` where the host put it — the
 * envelope stays byte-identical to what the host threw, with `fix` added.
 */
export interface RejectionInput {
  reason: string;
  detail?: DispatchRejectedError['detail'];
  missing?: string[];
  /** Explicit fix override for adapter-side gates; otherwise derived from the reason. */
  fix?: string;
}

/**
 * Every wire refusal reason present on master 2a450f5b8, by reason name.
 *
 * 30 from `reject()` in `src/activation/native-host.ts`, plus
 * `workspace_isolation_unavailable`, `workspace_held_by_another_writer`,
 * `workspace_lease_uncertain`, `workspace_lease_not_held_by_caller` from
 * `src/activation/workspace-lease.ts`, plus `unknown_activation`,
 * `not_resumable`, `not_steerable` thrown directly as `DispatchRejectedError`
 * in `native-host.ts`. `workspace_lease_unavailable` is an event-only
 * telemetry name, not a wire reason, and is excluded.
 */
export const DISPATCH_REFUSAL_REASONS = [
  'unknown_specialist',
  'work_item_store_unavailable',
  'parent_ref_and_ref',
  'kind_and_ref',
  'parent_ref_without_contract',
  'kind_without_contract',
  'contract_and_ref',
  'unknown_kind',
  'parent_unresolvable',
  'parent_terminal',
  'issue_not_dispatchable',
  'no_work_ref',
  'issue_unresolvable',
  'issue_revision_diverged',
  'empty_tool_contract',
  'required_pre_script_failed',
  'pi_sdk_resource_loader_unavailable',
  'invalid_thinking_override',
  'no_model_configured',
  'model_unavailable',
  'extension_tool_shadowed',
  'extension_discovery_failed',
  'context_unresolvable',
  'mandatory_rules_unavailable',
  'preflight_failed',
  'unguardable_mutating_tools',
  'permission_guard_unavailable',
  'tool_contract_unsatisfied',
  'system_prompt_not_applied',
  'issue_binding_failed',
  'context_changed',
  'workspace_isolation_unavailable',
  'workspace_held_by_another_writer',
  'workspace_lease_uncertain',
  'workspace_lease_not_held_by_caller',
  'unknown_activation',
  'not_resumable',
  'not_steerable',
] as const;

export type DispatchRefusalReason = (typeof DISPATCH_REFUSAL_REASONS)[number];

/**
 * Corrective fix for every wire refusal, in Substrate vocabulary.
 *
 * The compiler forces a fix for every reason (`Record<..., string>`). The four
 * lease reasons are shared with `specialist_lease_reconcile`.
 */
export const FIX_BY_REASON: Record<DispatchRefusalReason, string> = {
  unknown_specialist:
    'Check specialist_list for the exact Specialist name and re-dispatch with a known name.',
  work_item_store_unavailable:
    'The Substrate work boundary could not be opened. Install or upgrade the Substrate package, or set SUBSTRATE_DB (fallback XTRM_STATE_DB) to a writable state file, then re-dispatch.',
  parent_ref_and_ref:
    'Provide exactly one work locator. parent_ref only parents an Issue created from an inline contract: re-dispatch with contract plus parent_ref, or with issue_ref alone.',
  kind_and_ref:
    'Provide exactly one work locator. kind only flavours an Issue created from an inline contract: re-dispatch with contract plus kind, or with issue_ref alone.',
  parent_ref_without_contract:
    'parent_ref only parents an Issue created from an inline contract. Re-dispatch with contract plus parent_ref, or drop parent_ref.',
  kind_without_contract:
    'kind only flavours an Issue created from an inline contract. Re-dispatch with contract plus kind, or drop kind.',
  contract_and_ref:
    'Provide exactly one of issue_ref or contract. Re-dispatch with the Issue locator alone, or with the inline contract alone.',
  unknown_kind:
    'Re-dispatch with a creatable Substrate kind (task, bug, research, decision, followup); epic is never created ad hoc.',
  parent_unresolvable:
    'The parent_ref locator resolves to no Substrate Issue. Verify the parent Issue ref and re-dispatch; the check runs before anything is created.',
  parent_terminal:
    'The parent Issue is terminal (done, cancelled, or archived). Re-dispatch with a non-terminal parent Issue, or create without a parent.',
  issue_not_dispatchable:
    'The Substrate Issue is not dispatchable (draft, unattested, blocked, or incomplete contract). Repair Issue readiness and re-dispatch.',
  no_work_ref:
    'Dispatch requires an existing Issue or an inline contract. Re-dispatch with issue_ref or with contract.',
  issue_unresolvable:
    'The locator is not a Substrate Issue. Create the Issue first (planning skill) and re-dispatch with its ref, or pass the work as an inline contract.',
  issue_revision_diverged:
    'The Issue changed between resolution and the dispatch check. Re-dispatch against the new revision.',
  empty_tool_contract:
    'The resolved tool contract is empty for this tier. Adjust the Specialist definition permissions or tier and re-dispatch.',
  required_pre_script_failed:
    'A required pre-phase script failed. Fix the script or its prerequisites and re-dispatch; no session was created.',
  pi_sdk_resource_loader_unavailable:
    'The loaded Pi SDK cannot declare session skills. Upgrade the Pi SDK to a version exporting DefaultResourceLoader and getAgentDir, then re-dispatch.',
  invalid_thinking_override:
    'The thinking_override value is unknown. Re-dispatch with a supported thinking level.',
  no_model_configured:
    'No model is configured for this Specialist. Set the definition model chain or pass model_override and re-dispatch.',
  model_unavailable:
    'The requested model is unavailable. Re-dispatch with an available model via model_override, or fix the provider configuration.',
  extension_tool_shadowed:
    'An enabled extension shadows a granted tool. Disable or rename the shadowing extension source and re-dispatch.',
  extension_discovery_failed:
    'Extension discovery failed. Fix the extension source configuration and re-dispatch.',
  context_unresolvable:
    'The Issue contextRefs could not be resolved. Run `sp doctor` to diagnose the context store, then re-dispatch.',
  mandatory_rules_unavailable:
    'Mandatory rules could not be resolved. Fix the mandatory-rules configuration and re-dispatch; a session is never launched without its rules.',
  preflight_failed:
    'Preflight admission failed. Address the reported admission note and re-dispatch.',
  unguardable_mutating_tools:
    'Some mutating tools cannot be fenced by the workspace lease on this runtime. Remove them from the contract or run on a runtime that can guard them.',
  permission_guard_unavailable:
    'READ_ONLY bash was granted without the permission guard in the loaded set. Load the guard extension or remove bash from the READ_ONLY contract and re-dispatch.',
  tool_contract_unsatisfied:
    'The live session did not expose every promised tool. Fix the extension and resource-loader setup so the session exposes the full contract, then re-dispatch.',
  system_prompt_not_applied:
    'The live session system prompt did not contain the role prompt. Check the pi SDK resource-loader wiring (systemPrompt / appendSystemPrompt), then re-dispatch.',
  issue_binding_failed:
    'Binding the Issue to this activation failed. Re-read the Issue and re-dispatch.',
  context_changed:
    'contextRefs changed between prompt render and binding. Re-dispatch to render the current contextRefs.',
  workspace_isolation_unavailable:
    'A write-capable activation needs its own git worktree and none could be created. Fix the git worktree setup and re-dispatch.',
  workspace_held_by_another_writer:
    'Exactly one writer holds a workspace at a time. Wait for the holder to stop, dispatch on another Issue, or resolve it with specialist_lease_reconcile.',
  workspace_lease_uncertain:
    'The workspace lease holder liveness could not be established. Resolve it with specialist_lease_reconcile, then re-dispatch.',
  workspace_lease_not_held_by_caller:
    'The lease is not held by this activation. Dispatch or resume under the holding activation, or resolve it with specialist_lease_reconcile if the holder is gone.',
  unknown_activation:
    'No activation exists with that id. Verify the activation_id from specialist_status and retry with the correct id.',
  not_resumable:
    'That activation state cannot be resumed or retried here. Use resume for settled or waiting, retry for failed, steer for running, and reply for outstanding asks.',
  not_steerable:
    'Steer only redirects running activations. Use resume for settled or waiting, retry for failed, and reply for outstanding asks.',
};

/**
 * Fix for a refusal reason string.
 *
 * Matches an exact wire reason, or a `DispatchRejectedError.message` block that
 * wraps the bare reason (`reason:\n  <reason>`), which is what both frontends
 * store in the `reason` field. Returns undefined when no wire reason matches.
 */
export function fixForRefusalReason(reason: string): string | undefined {
  if (!reason) return undefined;
  const direct = (FIX_BY_REASON as Record<string, string>)[reason];
  if (direct) return direct;
  for (const code of DISPATCH_REFUSAL_REASONS) {
    if (reason.includes(code)) return FIX_BY_REASON[code];
  }
  return undefined;
}

/**
 * Reasons that describe the ENVIRONMENT, not the request. When the runtime is
 * stale they are symptoms of the stale build and mislead the reader about a
 * request that is fine — measured in the field as an operator told to install a
 * package that was already installed (SPECIALISTS-2).
 *
 * The list is deliberately narrow: a refusal that names a real defect in the
 * request (a draft contract, a missing section) is not rewritten by staleness.
 */
const STALE_DOWNSTREAM_REASONS = ['work_item_store_unavailable'];

/**
 * Reason text substituted when a stale runtime produced a downstream refusal.
 * Names the cause, names the remedy, and tells the reader not to act on the
 * superseded text underneath it. The ids ride the `build` field.
 */
export const STALE_RUNTIME_REASON =
  'stale_runtime: the runtime serving this session was rebuilt after it loaded, so this ' +
  'refusal came from superseded code. Restart the session, then retry the dispatch — do ' +
  'not act on the refusal text below.';

/** An outcome payload carrying a machine reason and an optional detail envelope. */
export interface RefusalPayload {
  reason?: unknown;
  detail?: unknown;
  [key: string]: unknown;
}

/**
 * Supersede a downstream refusal reason with the staleness that explains it.
 *
 * Returns the payload UNCHANGED — same object shape, same field order — unless
 * `stale` is true AND the reason is one of the environment-symptom reasons. So a
 * matching build renders exactly as it did before this branch existed.
 *
 * The superseded reason is never suppressed: it moves to
 * `detail.refused_by_stale_runtime` so a reader has both the cause and the
 * symptom. `build` is attached by the caller, not here.
 */
export function supersedeStaleRefusal<T extends RefusalPayload>(
  payload: T,
  stale: boolean,
  build?: string,
): T {
  const reason = payload.reason;
  if (!stale || typeof reason !== 'string') return payload;
  // `includes`, not `startsWith`: the MCP frontend renders `DispatchRejectedError.message`,
  // which wraps the bare reason in a multi-line block (`reason:\n  <reason>`).
  if (!STALE_DOWNSTREAM_REASONS.some((downstream) => reason.includes(downstream))) return payload;
  const detail = typeof payload.detail === 'object' && payload.detail !== null
    ? (payload.detail as Record<string, unknown>)
    : {};
  return {
    ...payload,
    reason: build ? `${STALE_RUNTIME_REASON} (${build})` : STALE_RUNTIME_REASON,
    detail: { ...detail, refused_by_stale_runtime: reason },
  };
}

export function renderRejection(input: RejectionInput, build?: string, stale = false) {
  const superseded = supersedeStaleRefusal(
    { reason: input.reason, ...(input.detail ? { detail: input.detail } : {}) },
    stale,
    build,
  ) as { reason: string; detail?: DispatchRejectedError['detail'] };
  const fix = input.fix ?? fixForRefusalReason(input.reason);
  return {
    status: 'rejected' as const,
    reason: superseded.reason,
    ...(fix ? { fix } : {}),
    ...(superseded.detail ? { detail: superseded.detail } : {}),
    ...(input.missing?.length ? { missing: input.missing } : {}),
    ...(build ? { build } : {}),
  };
}
