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

import { spawn } from 'node:child_process';
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
 * Hard ceiling on any single dispatcher value (SPECIALISTS-4510).
 *
 * Every one of them ends up in an env key the activation's shells inherit, and an argv+env
 * total above the kernel's limit makes the WHOLE spawn fail with E2BIG: one oversized
 * `requested_by` would make every shell of that activation fail (a self-DoS of the caller's
 * own dispatch). They also end up in one durable evidence line. 512 leaves room for a `uds:`
 * socket address and stays far under every exec limit.
 */
export const DISPATCHER_VALUE_MAX_LENGTH = 512;

/** C0, DEL and C1: a newline here forges extra lines in the durable evidence note. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * One dispatcher value, or nothing: control characters are STRIPPED (never rendered) and an
 * over-long value is DROPPED rather than truncated into a different identity. A value nobody
 * can write down in full is not an identity, so truncating it would invent one.
 */
export function sanitizeDispatcherValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const stripped = value.replace(CONTROL_CHARACTERS, '').trim();
  return stripped.length > 0 && stripped.length <= DISPATCHER_VALUE_MAX_LENGTH ? stripped : undefined;
}

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

const LABEL_DROP_REASON =
  'the dispatcher participant is not a Substrate-safe label (at most 128 shell-safe characters)';
const SESSION_DROP_REASON = 'the dispatcher session is not a UUID or a tmux session id';

/**
 * Keep a bounded value that passes `isValid`, drop it with one warning otherwise.
 *
 * `raw` is inspected, not `value`: an over-long or control-character value is exactly what
 * must be dropped LOUDLY, and sanitizing it first would erase the evidence that it arrived.
 */
function keepBoundValue(
  raw: unknown,
  isValid: (value: unknown) => boolean,
  reason: string,
  warn: (message: string) => void,
): string | undefined {
  const value = sanitizeDispatcherValue(raw);
  if (value !== undefined && isValid(value)) return value;
  // Absent is absence and never warns; a value that cannot be one is dropped once.
  if (value !== undefined || (typeof raw === 'string' && raw.trim() !== '')) warnBindingOnce(warn, reason);
  return undefined;
}

/**
 * One dispatcher value, made safe for EVERY sink this host writes: the activation env keys, the
 * durable evidence line and the Substrate binding (SPECIALISTS-4510).
 *
 * Control characters are stripped (a newline in `requested_by` forged extra lines in the
 * evidence note) and every value is bounded (an oversized `requested_by` reached
 * `XTRM_DISPATCHER_PARTICIPANT` and made every shell of that activation fail with E2BIG). The
 * participant is additionally held to the label grammar sb records, so a value sb would refuse
 * is never written as if it were one. An unusable value is DROPPED with one warning and the
 * dispatch proceeds: fail-open for the dispatch, fail-closed for the record.
 *
 * The session id is sanitized but not grammar-checked: it is also the in-process key a
 * completion wake is routed by, and a live session id sb will not bind still routes correctly.
 * {@link dispatcherBindingFields} is where the sb grammar decides.
 */
export function normalizeDispatcherIdentity(
  identity: { participant?: unknown; name?: unknown; address?: unknown; sessionId?: unknown } | undefined,
  warn: (message: string) => void = warnDispatcherIdentity,
): DispatcherIdentity {
  const participant = keepBoundValue(identity?.participant, isDispatcherLabel, LABEL_DROP_REASON, warn);
  const name = sanitizeDispatcherValue(identity?.name);
  const address = sanitizeDispatcherValue(identity?.address);
  const sessionId = sanitizeDispatcherValue(identity?.sessionId);
  return {
    ...(participant ? { participant } : {}),
    ...(name ? { name } : {}),
    ...(address ? { address } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
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

/** The outcome of one `xt identity dispatcher --json` invocation; `error` mirrors spawn's field. */
export interface DispatcherRunResult {
  status: number | null;
  stdout: string;
  stderr?: string;
  error?: unknown;
}

/**
 * One `xt identity dispatcher --json` invocation.
 *
 * ASYNC on purpose (SPECIALISTS-4510): the MCP server's event loop also hosts every running
 * activation, and a synchronous spawn here froze them for up to the whole lookup bound. The
 * seam is the same shape as identityEnvRun's, so a test injects a plain value run.
 */
export type DispatcherRun = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => DispatcherRunResult | Promise<DispatcherRunResult>;

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

const clean = sanitizeDispatcherValue;

/**
 * The real lookup: one async child, settled on `exit` (or on the bound), never on `close` — a
 * grandchild that inherits the pipes must not hold the dispatch past its bound.
 *
 * The bound kills with SIGKILL: an `xt` that ignores SIGTERM would otherwise outlive every
 * timeout it is given. The promise is settled locally, so the caller is never waiting on a
 * process it already stopped.
 */
export const defaultDispatcherRun: DispatcherRun = (cmd, args, opts) =>
  new Promise<DispatcherRunResult>((resolve) => {
    const timeoutMs = opts.timeoutMs ?? DISPATCHER_LOOKUP_TIMEOUT_MS;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (result: DispatcherRunResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle({ status: null, stdout, stderr, error: new Error(`timed out after ${timeoutMs} ms`) });
    }, timeoutMs);
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error) => settle({ status: null, stdout, stderr, error }));
    child.on('exit', (code) => settle({ status: code, stdout, stderr }));
  });

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
 * and one warning names the failure class. It AWAITS: this runs on the MCP server's event
 * loop, which also hosts every running activation (SPECIALISTS-4510).
 */
export async function resolveProcessDispatcher(input: DispatcherLookupInput = {}): Promise<DispatcherIdentity> {
  const env = input.env ?? process.env;
  const warn = input.warn ?? warnDispatcherIdentity;
  const run = input.run ?? defaultDispatcherRun;
  const pid = input.pid ?? process.ppid;
  const clock = input.now ?? Date.now;
  /** What the env alone proves, plus whatever a successful answer added. */
  const known = (answer: { name?: unknown; address?: unknown; sessionId?: unknown } = {}): DispatcherIdentity =>
    normalizeDispatcherIdentity({
      participant: env.SUBSTRATE_HOLDER,
      // An unusable answer falls back to the env instead of erasing what the env states.
      name: clean(answer.name) ?? env.XTRM_AGENT_NAME,
      address: answer.address,
      sessionId: answer.sessionId,
    }, warn);
  // In the cool-down after a failed lookup: do not spawn xt again, say nothing more.
  if (lookupFailedAt !== undefined && clock() - lookupFailedAt < LOOKUP_FAILURE_COOLDOWN_MS) return known();
  const failed = (reason: string): DispatcherIdentity => {
    lookupFailedAt = clock();
    warnOnce(warn, reason);
    return known();
  };

  let result: DispatcherRunResult;
  try {
    result = await run(
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
  return known((answer ?? {}) as { name?: unknown; address?: unknown; sessionId?: unknown });
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
  return normalizeDispatcherIdentity({
    participant: env.SUBSTRATE_HOLDER,
    name: env.XTRM_AGENT_NAME,
    sessionId,
  });
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
  // Normalizing HERE is what keeps a caller-asserted value (a host call carries the fields
  // straight through) from reaching the env, the evidence line or the binding unbounded.
  const dispatcher = normalizeDispatcherIdentity({
    ...request.dispatcher,
    participant: clean(request.dispatcher?.participant) ?? request.requestedByParticipantId,
  });
  const coordinatorSessionId = clean(request.coordinatorSessionId) ?? dispatcher.sessionId;
  return {
    dispatcher,
    ...(dispatcher.participant ? { requestedByParticipantId: dispatcher.participant } : {}),
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
 *
 * One validator for both halves of a dispatch (SPECIALISTS-4506, SPECIALISTS-4510): the env,
 * the evidence line and this binding share {@link normalizeDispatcherIdentity}, so sb and the
 * host cannot disagree about what a dispatcher value is.
 */
export function dispatcherBindingFields(
  identity: { participant?: string; sessionId?: string } | undefined,
  warn: (message: string) => void = warnDispatcherIdentity,
): DispatcherBindingFields {
  const safe = normalizeDispatcherIdentity(identity, warn);
  const fields: DispatcherBindingFields = {};
  if (safe.participant !== undefined) fields.dispatcherParticipantId = safe.participant;
  const sessionId = keepBoundValue(
    identity?.sessionId,
    isDispatcherSessionId,
    SESSION_DROP_REASON,
    warn,
  );
  if (sessionId !== undefined) fields.dispatcherSessionId = sessionId;
  return fields;
}

function warnBindingOnce(warn: (message: string) => void, reason: string): void {
  if (warnedBindingReasons.has(reason)) return;
  warnedBindingReasons.add(reason);
  warn(`${reason}; the invalid value is dropped and the dispatch proceeds (a Substrate that cannot record a dispatcher records none)`);
}

/**
 * The env overlay for one dispatcher value.
 *
 * A key the dispatcher does not know is UNSET rather than inherited: the child's env
 * describes exactly one hop, and leaving the host's value in place is how the grandparent
 * appeared as the dispatcher.
 *
 * Every value is normalized first, so this seam cannot be the one that lets an oversized or
 * multi-line value into an activation's shells whatever the caller built the identity from.
 */
export function dispatcherEnvOverlay(
  identity: DispatcherIdentity | undefined,
  warn: (message: string) => void = warnDispatcherIdentity,
): DispatcherEnvOverlay {
  const safe = normalizeDispatcherIdentity(identity, warn);
  const known: Array<[typeof DISPATCHER_ENV_KEYS[number], string | undefined]> = [
    ['XTRM_DISPATCHER_PARTICIPANT', safe.participant],
    ['XTRM_DISPATCHER_NAME', safe.name],
    ['XTRM_DISPATCHER_ADDRESS', safe.address],
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
