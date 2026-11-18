/**
 * One dispatcher value per dispatch (SPECIALISTS-4503).
 *
 * "Who dispatched this Specialist" is a fact the dispatcher already holds: its own
 * `SUBSTRATE_HOLDER`, the name it is known by, and the address it can be replied to. Until
 * this module existed each frontend made something up instead — the MCP tool and the Pi
 * extension wrote the adapter literals `adapter::specialists-mcp` / `adapter::pi-extension`
 * into Substrate, and the activation's shells inherited the HOST's own
 * `XTRM_DISPATCHER_*`, i.e. the lead's dispatcher (the grandparent), not the lead.
 *
 * The value is resolved ONCE per dispatch, where the information actually exists, and both
 * sinks read that same value:
 *
 * - env: `XTRM_DISPATCHER_PARTICIPANT` (the dispatcher's own holder — a NEW key; `NAME`
 *   stays display-only and `ADDRESS` stays the reply address), written to the activation's
 *   spawn-hook overlay, the legacy `sp run` child env and the bridged child provider env;
 * - Substrate: `requested_by` and `coordinatorSessionId`.
 *
 * Env is ONE HOP by design: a nested dispatch replaces the inherited value with the
 * dispatching process's own holder and DELETES any inherited dispatcher key it cannot
 * replace. The full chain is read from Substrate.
 *
 * The Claude Code MCP server is a child of the lead, so it asks core's CLI where it came
 * from (`xt identity dispatcher --pid <parent> --no-inherit --json`). The Pi extension runs
 * INSIDE the lead process, so its own env already says who it is.
 *
 * Fail-open for the dispatch, fail-closed for the record: a missing or old `xt`, a timeout
 * or junk only drops the display name/address/session (with one warning); the dispatch
 * proceeds and Substrate records what was actually known rather than an adapter literal.
 */
/** The env keys that describe who dispatched the current process. */
export declare const DISPATCHER_ENV_KEYS: readonly ["XTRM_DISPATCHER_PARTICIPANT", "XTRM_DISPATCHER_NAME", "XTRM_DISPATCHER_ADDRESS"];
/** Bound on the one CLI lookup per dispatch. */
export declare const DISPATCHER_LOOKUP_TIMEOUT_MS = 3000;
/**
 * The dispatcher of one dispatch.
 *
 * `participant` is the value Substrate records as `requested_by` and the dispatcher's own
 * `SUBSTRATE_HOLDER` — never a role, an adapter name or a display name.
 */
export interface DispatcherIdentity {
    participant?: string;
    /** Display-only (`XTRM_DISPATCHER_NAME`). */
    name?: string;
    /** Reply address (`XTRM_DISPATCHER_ADDRESS`): `uds:<socket>` or `activation:<id>`. */
    address?: string;
    /** Coordinator session for the settlement leg, when the caller has one. */
    sessionId?: string;
}
/** One `xt identity dispatcher --json` invocation. `error` mirrors spawnSync's field. */
export type DispatcherRun = (cmd: string, args: string[], opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
}) => {
    status: number | null;
    stdout: string;
    stderr?: string;
    error?: unknown;
};
export interface DispatcherLookupInput {
    /** The caller's own env. Its `SUBSTRATE_HOLDER` is the dispatcher participant. */
    env?: NodeJS.ProcessEnv;
    /** Pid the ancestor walk starts at (inclusive). Default: this process's parent. */
    pid?: number;
    /** Directory the lookup runs in. Default: the process cwd. */
    cwd?: string;
    /** Injected for tests; defaults to a real `xt identity dispatcher --json`. */
    run?: DispatcherRun;
    /** Lookup timeout. Default {@link DISPATCHER_LOOKUP_TIMEOUT_MS}. */
    timeoutMs?: number;
    /** Warning sink, one reason line. Injected in tests. */
    warn?: (message: string) => void;
}
/** The part of an activation env the dispatcher overlays, plus the inherited keys it deletes. */
export interface DispatcherEnvOverlay {
    /** Dispatcher keys with a known value. */
    env: Record<string, string>;
    /** Dispatcher keys to delete from whatever env the child would otherwise inherit. */
    unset: readonly string[];
}
/** The launcher's warning channel: one prefixed stderr line, never a value. */
export declare function warnDispatcherIdentity(message: string): void;
/** Test seam: the next lookup may warn again. */
export declare function resetDispatcherWarning(): void;
/**
 * Resolve the dispatcher of the Claude Code MCP server process.
 *
 * The participant is this process's own `SUBSTRATE_HOLDER`: the MCP server inherits the
 * lead's env, and that holder is the value Substrate joins on. `xt` supplies what the env
 * cannot: the leading process's display name, reply address and session id.
 *
 * Never throws. On any lookup failure the participant/name already held in `env` survive
 * and one warning names the failure class.
 */
export declare function resolveProcessDispatcher(input?: DispatcherLookupInput): DispatcherIdentity;
/**
 * Resolve the dispatcher from the host env — the Pi extension path.
 *
 * The extension runs inside the lead process, so `SUBSTRATE_HOLDER` IS the dispatcher
 * participant and `XTRM_AGENT_NAME` is its display name. No CLI call is needed, and none is
 * made: the Pi path must not spawn `xt` to learn something its own env already states.
 */
export declare function dispatcherFromHostEnv(env?: NodeJS.ProcessEnv, sessionId?: string | null): DispatcherIdentity;
/**
 * The one value both sinks read, from one request.
 *
 * The dispatcher object is authoritative: its `participant` is the Substrate `requested_by` AND
 * the env `XTRM_DISPATCHER_PARTICIPANT`. A host caller that passes only the legacy
 * `requestedByParticipantId` gets that value in both places. Returning both from one function is
 * what keeps the two sinks from disagreeing when a request carries both fields (found in review of
 * #584: the env and Substrate halves used opposite precedence).
 */
export declare function resolveRequestDispatcher(request: {
    dispatcher?: DispatcherIdentity;
    requestedByParticipantId?: string;
    coordinatorSessionId?: string;
}): {
    dispatcher: DispatcherIdentity;
    requestedByParticipantId?: string;
    coordinatorSessionId?: string;
};
/**
 * The env overlay for one dispatcher value.
 *
 * A key the dispatcher does not know is UNSET rather than inherited: the child's env
 * describes exactly one hop, and leaving the host's value in place is how the grandparent
 * appeared as the dispatcher.
 */
export declare function dispatcherEnvOverlay(identity: DispatcherIdentity | undefined): DispatcherEnvOverlay;
/**
 * The same overlay for the Claude Code bridge's provider env, where an empty value means
 * DELETE (`ccChildEnv`). Unknown keys must still clear the host's inherited value.
 */
export declare function bridgedDispatcherEnv(overlay: DispatcherEnvOverlay): Record<string, string>;
//# sourceMappingURL=dispatcher-identity.d.ts.map