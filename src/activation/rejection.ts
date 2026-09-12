import type { DispatchRejectedError } from './types.js';

/**
 * Shared refusal renderer (unitAI-t2kol.4).
 *
 * Three renderers described one gate: the Pi bead-path `{status,reason,detail}`
 * plus build, the Pi inline-path `{status,reason,missing}` plus build, and the
 * MCP local `{status,reason,detail}` with no build and `missing` buried in
 * detail. An MCP operator could not see top-level `missing` and could not tell
 * a stale-build refusal from a broken-contract refusal. This is the single
 * renderer both frontends use; the Pi extension adopts it as a follow-up.
 *
 * Pure given explicit inputs: the caller renders the build string with
 * `describeBuildIdentity(loadedId, readBuildId(path))` and passes it in, so
 * tests never touch the filesystem. `missing` is promoted to the top level by
 * the caller and is never stripped from `detail` where the host put it — the
 * envelope stays byte-identical to what the host threw.
 */
export interface RejectionInput {
  reason: string;
  detail?: DispatchRejectedError['detail'];
  missing?: string[];
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
  return {
    status: 'rejected' as const,
    reason: superseded.reason,
    ...(superseded.detail ? { detail: superseded.detail } : {}),
    ...(input.missing?.length ? { missing: input.missing } : {}),
    ...(build ? { build } : {}),
  };
}
