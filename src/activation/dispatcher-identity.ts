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
 *   spawn-hook overlay, the legacy `sp run` child env and the bridged child provider env.
 *   `ADDRESS` is known only on the MCP path, where core's `xt identity dispatcher` supplies
 *   it. The Pi extension and the legacy runner read their own env, which holds no own reply
 *   address, so there it is DELETED rather than inherited: on those paths the child carries a
 *   participant and a name but no reply address;
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

import { spawnSync } from 'node:child_process';
import { runtimeWarn } from '../utils/runtime-diagnostics.js';

/** The env keys that describe who dispatched the current process. */
export const DISPATCHER_ENV_KEYS = [
  'XTRM_DISPATCHER_PARTICIPANT',
  'XTRM_DISPATCHER_NAME',
  'XTRM_DISPATCHER_ADDRESS',
] as const;

/** Bound on the one CLI lookup per dispatch. */
export const DISPATCHER_LOOKUP_TIMEOUT_MS = 3000;

/**
 * Substrate's dispatcher label grammar (XTRM-839): a shell-safe identifier of at most
 * 128 characters, mirroring its `IDENTITY_LABEL_PATTERN` / `IDENTITY_LABEL_MAX_LENGTH`.
 * Mirrored here so the host drops a value sb would refuse instead of letting a malformed
 * label fail the whole dispatch — sb writes NO binding on a bad value.
 */
export const DISPATCHER_LABEL_MAX_LENGTH = 128;
const DISPATCHER_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$/;

/**
 * Substrate's session grammar (execution-context.ts SESSION_ID_PATTERN): a canonical UUID or a
 * tmux session id (`$3`). sb lowercases a UUID before it validates, so either case is accepted
 * there; this host accepts exactly what sb accepts, so a value sb would record is never dropped
 * here (found by the seconder on #586: a stricter local grammar turned known values into absence).
 */
const DISPATCHER_SESSION_PATTERN = /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\$[0-9]+)$/;

/** True when `value` is a label sb will accept as a dispatcher participant. */
export function isDispatcherLabel(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const label = value.trim();
  return label.length > 0 && label.length <= DISPATCHER_LABEL_MAX_LENGTH && DISPATCHER_LABEL_PATTERN.test(label);
}

/** True when `value` is a UUID or tmux session id sb will accept as a dispatcher session. */
export function isDispatcherSessionId(value: unknown): value is string {
  return typeof value === 'string' && DISPATCHER_SESSION_PATTERN.test(value.trim());
}

/**
 * After a failed lookup (missing or old xt, timeout, junk) the next lookups are skipped for
 * this long, so a wedged install costs one bounded stall instead of one per dispatch. A
 * success clears it. Found by the seconder on #584: the warning is process-wide-once, so the
 * repeated stall would otherwise be invisible.
 */
export const LOOKUP_FAILURE_COOLDOWN_MS = 60_000;
let lookupFailedAt: number | undefined;

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
export type DispatcherRun = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => { status: number | null; stdout: string; stderr?: string; error?: unknown };

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
  /** Clock for the failure cool-down. Injected in tests. */
  now?: () => number;
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

const clean = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const DEFAULT_RUN: DispatcherRun = (cmd, args, opts) => {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: opts.env,
    timeout: opts.timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    error: result.error,
  };
};

/** The launcher's warning channel: one prefixed stderr line, never a value. */
export function warnDispatcherIdentity(message: string): void {
  runtimeWarn('dispatcher-identity', `[specialists] dispatcher-identity: ${message}`);
}

let warningGiven = false;
const warnedBindingReasons = new Set<string>();

/** Test seam: the next lookup may warn again and is no longer in the failure cool-down. */
export function resetDispatcherWarning(): void {
  warningGiven = false;
  lookupFailedAt = undefined;
  warnedBindingReasons.clear();
}

/** A spawn error's class and code, e.g. `Error ENOENT`; never a value. */
function describeErrorClass(error: unknown): string {
  if (!(error instanceof Error)) return 'non-Error';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code ? `${error.name} ${code}` : error.name || 'Error';
}

function failureReason(result: { status: number | null; stderr?: string; error?: unknown }): string {
  if (result.error) return `lookup did not run (${describeErrorClass(result.error)})`;
  if (result.status === null) return 'xt exited on a signal';
  const stderr = result.stderr ?? '';
  if (/unknown command ['"]?dispatcher/i.test(stderr)) return 'the installed xt predates this command';
  return `xt exited ${result.status}`;
}

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
export function resolveProcessDispatcher(input: DispatcherLookupInput = {}): DispatcherIdentity {
  const env = input.env ?? process.env;
  const identity: DispatcherIdentity = {
    ...(clean(env.SUBSTRATE_HOLDER) ? { participant: clean(env.SUBSTRATE_HOLDER) as string } : {}),
    ...(clean(env.XTRM_AGENT_NAME) ? { name: clean(env.XTRM_AGENT_NAME) as string } : {}),
  };
  const warn = input.warn ?? warnDispatcherIdentity;
  const run = input.run ?? DEFAULT_RUN;
  const pid = input.pid ?? process.ppid;
  const now = (input.now ?? Date.now)();
  // In the cool-down after a failed lookup: do not spawn xt again, say nothing more.
  if (lookupFailedAt !== undefined && now - lookupFailedAt < LOOKUP_FAILURE_COOLDOWN_MS) return identity;
  const failed = (reason: string): DispatcherIdentity => {
    lookupFailedAt = now;
    warnOnce(warn, reason);
    return identity;
  };

  let result: ReturnType<DispatcherRun>;
  try {
    result = run(
      'xt',
      ['identity', 'dispatcher', '--pid', String(pid), '--no-inherit', '--json'],
      { cwd: input.cwd, env, timeoutMs: input.timeoutMs ?? DISPATCHER_LOOKUP_TIMEOUT_MS },
    );
  } catch (error) {
    return failed(`lookup threw ${describeErrorClass(error)}`);
  }
  if (result.error || result.status !== 0) return failed(failureReason(result));

  let answer: unknown;
  try {
    answer = JSON.parse(result.stdout);
  } catch {
    return failed('returned unparseable JSON');
  }
  lookupFailedAt = undefined;
  const parsed = (answer ?? {}) as { name?: unknown; address?: unknown; sessionId?: unknown };
  return {
    ...identity,
    ...(clean(parsed.name) ? { name: clean(parsed.name) as string } : {}),
    ...(clean(parsed.address) ? { address: clean(parsed.address) as string } : {}),
    ...(clean(parsed.sessionId) ? { sessionId: clean(parsed.sessionId) as string } : {}),
  };
}

function warnOnce(warn: (message: string) => void, reason: string): void {
  if (warningGiven) return;
  warningGiven = true;
  warn(`${reason}; the dispatch records only the identity it can read, never a made-up one`);
}

/**
 * Resolve the dispatcher from the host env — the Pi extension path.
 *
 * The extension runs inside the lead process, so `SUBSTRATE_HOLDER` IS the dispatcher
 * participant and `XTRM_AGENT_NAME` is its display name. No CLI call is needed, and none is
 * made: the Pi path must not spawn `xt` to learn something its own env already states.
 */
export function dispatcherFromHostEnv(
  env: NodeJS.ProcessEnv = process.env,
  sessionId?: string | null,
): DispatcherIdentity {
  const participant = clean(env.SUBSTRATE_HOLDER);
  const name = clean(env.XTRM_AGENT_NAME);
  const session = clean(sessionId);
  return {
    ...(participant ? { participant } : {}),
    ...(name ? { name } : {}),
    ...(session ? { sessionId: session } : {}),
  };
}

/**
 * The one value both sinks read, from one request.
 *
 * The dispatcher object is authoritative: its `participant` is the Substrate `requested_by` AND
 * the env `XTRM_DISPATCHER_PARTICIPANT`. A host caller that passes only the legacy
 * `requestedByParticipantId` gets that value in both places. Returning both from one function is
 * what keeps the two sinks from disagreeing when a request carries both fields (found in review of
 * #584: the env and Substrate halves used opposite precedence).
 */
export function resolveRequestDispatcher(request: {
  dispatcher?: DispatcherIdentity;
  requestedByParticipantId?: string;
  coordinatorSessionId?: string;
}): { dispatcher: DispatcherIdentity; requestedByParticipantId?: string; coordinatorSessionId?: string } {
  const participant = clean(request.dispatcher?.participant) ?? clean(request.requestedByParticipantId);
  const dispatcher: DispatcherIdentity = {
    ...request.dispatcher,
    ...(participant ? { participant } : {}),
  };
  const coordinatorSessionId = clean(request.coordinatorSessionId) ?? clean(dispatcher.sessionId);
  return {
    dispatcher,
    ...(participant ? { requestedByParticipantId: participant } : {}),
    ...(coordinatorSessionId ? { coordinatorSessionId } : {}),
  };
}

/** The ExecutionBinding half of one dispatcher value (XTRM-839). */
export interface DispatcherBindingFields {
  dispatcherParticipantId?: string;
  dispatcherSessionId?: string;
}

/**
 * The binding half of the one dispatcher value: what `sb provenance dispatch` can record
 * without refusing the dispatch. sb validates both at its write seam and writes NO binding
 * on a malformed value, so an invalid half is DROPPED here (one warning per reason) and the
 * dispatch proceeds. Absent stays absent — never a placeholder, never an env default.
 */
export function dispatcherBindingFields(
  identity: { participant?: string; sessionId?: string } | undefined,
  warn: (message: string) => void = warnDispatcherIdentity,
): DispatcherBindingFields {
  const fields: DispatcherBindingFields = {};
  const participant = clean(identity?.participant);
  if (participant !== undefined) {
    if (isDispatcherLabel(participant)) fields.dispatcherParticipantId = participant;
    else warnBindingOnce(warn, 'the dispatcher participant is not a Substrate-safe label (at most 128 shell-safe characters)');
  }
  const sessionId = clean(identity?.sessionId);
  if (sessionId !== undefined) {
    if (isDispatcherSessionId(sessionId)) fields.dispatcherSessionId = sessionId;
    else warnBindingOnce(warn, 'the dispatcher session is not a UUID or a tmux session id');
  }
  return fields;
}

function warnBindingOnce(warn: (message: string) => void, reason: string): void {
  if (warnedBindingReasons.has(reason)) return;
  warnedBindingReasons.add(reason);
  warn(`${reason}; the binding records only the dispatcher value Substrate accepts`);
}

/**
 * The env overlay for one dispatcher value.
 *
 * A key the dispatcher does not know is UNSET rather than inherited: the child's env
 * describes exactly one hop, and leaving the host's value in place is how the grandparent
 * appeared as the dispatcher.
 */
export function dispatcherEnvOverlay(identity: DispatcherIdentity | undefined): DispatcherEnvOverlay {
  const known: Array<[typeof DISPATCHER_ENV_KEYS[number], string | undefined]> = [
    ['XTRM_DISPATCHER_PARTICIPANT', clean(identity?.participant)],
    ['XTRM_DISPATCHER_NAME', clean(identity?.name)],
    ['XTRM_DISPATCHER_ADDRESS', clean(identity?.address)],
  ];
  const env: Record<string, string> = {};
  const unset: string[] = [];
  for (const [key, value] of known) {
    if (value === undefined) unset.push(key);
    else env[key] = value;
  }
  return { env, unset };
}

/**
 * The same overlay for the Claude Code bridge's provider env, where an empty value means
 * DELETE (`ccChildEnv`). Unknown keys must still clear the host's inherited value.
 */
export function bridgedDispatcherEnv(overlay: DispatcherEnvOverlay): Record<string, string> {
  return {
    ...overlay.env,
    ...Object.fromEntries(overlay.unset.map((key) => [key, ''])),
  };
}
