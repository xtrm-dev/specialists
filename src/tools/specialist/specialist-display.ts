// src/tools/specialist/specialist-display.ts
//
// Canonical fleet display fields for `specialist_status` (SPECIALISTS-4365).
//
// SPECIALISTS-4345 option A decided that the runtime emits ready-made display
// fields once, instead of the Pi extension and the Claude mod each implementing
// `headerOf` / `metricsOf` / `markerOf` / `elapsedShort` / `spendShort` locally.
// The local implementations had already diverged semantically, so this module is
// the single authority and both frontends prefer it when present, falling back
// to their local formatters when it is absent.
//
// Canonical rules (4345 decision, restated by the 4365 contract):
//   - spend = input + output + cache_creation + cache_read. `reasoning_tokens`
//     is a SUBSET of output and `tool_tokens` is outside Pi's precomputed total
//     (session-metrics-contract.ts); both are display-only splits, never
//     summands. `total_tokens` is a rollup, never a summand.
//   - the ask metric uses one wording: `asked ${elapsed}`.
//   - an active activation silent past 30s reports the reason (`idle ${elapsed}`)
//     INSTEAD of its stats, the same way a blocked one reports `asked …`.
//   - work identity is the Substrate issue ref (never the legacy bead id).
//   - plain text only: no ANSI, no markup. Frontends style locally.
//
// Raw snapshot/view fields are never modified here; this module only reads them.

/** One activation's ready-made display strings (plain text, no styling). */
export interface ActivationDisplayEntry {
  activation_id: string;
  /** Single state signal: `!` blocked, `✓` settled, `✕` failed, spinner frame while working, else `●`. */
  marker: string;
  /** `asked 19s` / `idle 42s`, else space-joined `elapsed turns spend`. */
  metrics: string;
  /** The Substrate issue ref, or `—` when unknown. */
  work: string;
}

/** Fleet-level ready-made display strings (plain text, no styling). */
export interface FleetDisplayBlock {
  /** `idle`, else space-joined e.g. `2 running 1 waiting 1 blocked`. */
  header: string;
  activations: ActivationDisplayEntry[];
}

/** Calm geometric spinner frames; Pi cadence (220ms) is the canonical one. */
export const DISPLAY_SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];
export const DISPLAY_SPINNER_FRAME_MS = 220;

/** Quiet-for-this-long means idle rather than working. */
export const DISPLAY_IDLE_AFTER_S = 30;

const DISPLAY_ACTIVE_STATES = new Set(['running', 'starting']);

import type { ActivationTokenUsage } from '../../activation/types.js';

/** Minimal activation shape; accepts host snapshots (camelCase) and wire views (snake_case). */
export interface DisplayActivationInput {
  activationId?: string;
  activation_id?: string;
  state?: string;
  issueRef?: string;
  issue_ref?: string;
  bead_id?: string;
  issue_id?: string;
  startedAt?: number;
  elapsed_s?: number;
  turnCount?: number;
  turn_count?: number;
  // Wide on purpose: ActivationTokenUsage carries provenance strings and a cost
  // object alongside the counters; only numeric counters are ever summed.
  tokenUsage?: ActivationTokenUsage | Record<string, unknown>;
  token_usage?: ActivationTokenUsage | Record<string, unknown>;
  lastActivityAt?: number;
  last_activity_at?: number;
}

/** Minimal ask shape; accepts host PendingAsk and wire views. */
export interface DisplayAskInput {
  activationId?: string;
  activation_id?: string;
  askedAt?: number;
  asked_at?: number;
  message?: {
    activationId?: string;
    activation_id?: string;
  };
}

function displayActivationId(view: DisplayActivationInput): string {
  return view.activationId ?? view.activation_id ?? '';
}

function displayWorkRef(view: DisplayActivationInput): string {
  return view.issueRef ?? view.issue_ref ?? view.bead_id ?? view.issue_id ?? '—';
}

function displayElapsedS(view: DisplayActivationInput, nowMs: number): number {
  if (typeof view.elapsed_s === 'number' && Number.isFinite(view.elapsed_s)) {
    return Math.max(0, Math.floor(view.elapsed_s));
  }
  if (typeof view.startedAt === 'number' && Number.isFinite(view.startedAt)) {
    return Math.max(0, Math.floor((nowMs - view.startedAt) / 1000));
  }
  return 0;
}

function displayTurnCount(view: DisplayActivationInput): number | undefined {
  const turns = view.turnCount ?? view.turn_count;
  return typeof turns === 'number' && Number.isFinite(turns) ? turns : undefined;
}

function displayTokenUsage(view: DisplayActivationInput): Record<string, unknown> | undefined {
  const usage = view.tokenUsage ?? view.token_usage;
  return usage === undefined ? undefined : (usage as Record<string, unknown>);
}

function displayCounter(usage: Record<string, unknown>, key: string): number {
  const value = usage[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function displayLastActivityAt(view: DisplayActivationInput): number | undefined {
  const at = view.lastActivityAt ?? view.last_activity_at;
  return typeof at === 'number' && Number.isFinite(at) ? at : undefined;
}

function displayAskActivationId(ask: DisplayAskInput): string {
  return ask.message?.activationId ?? ask.message?.activation_id ?? ask.activationId ?? ask.activation_id ?? '';
}

function displayAskedAt(ask: DisplayAskInput, nowMs: number): number {
  const at = ask.askedAt ?? ask.asked_at;
  return typeof at === 'number' && Number.isFinite(at) ? at : nowMs;
}

/** Row-budget duration: `42s`, `2m14s`, `1h05m`. */
export function formatDisplayElapsed(elapsedS: number | undefined): string {
  const total = Math.max(0, Math.floor(elapsedS ?? 0));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(total / 3600)}h${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}m`;
}

/**
 * Canonical spend: input + output + cache_creation + cache_read.
 *
 * Accepts snapshot snake_case keys plus the legacy camel test/fixture keys
 * (`input`, `output`, `cache`). `reasoning_tokens`, `tool_tokens` and
 * `total_tokens` are never summands.
 */
export function formatDisplaySpend(tokenUsage: Record<string, unknown> | undefined): string {
  if (!tokenUsage) return '';
  const total =
    ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens'].reduce(
      (n, k) => n + displayCounter(tokenUsage, k),
      0,
    ) +
    displayCounter(tokenUsage, 'input') +
    displayCounter(tokenUsage, 'output') +
    displayCounter(tokenUsage, 'cache');
  if (total <= 0) return '';
  if (total < 1000) return `${total}`;
  if (total < 10000) return `${(total / 1000).toFixed(1)}k`;
  return `${Math.round(total / 1000)}k`;
}

/** Turn count, spelled out: `1 turn` / `3 turns`. Nullish renders nothing. */
export function formatDisplayTurns(turnCount: number | undefined): string {
  if (turnCount === null || turnCount === undefined) return '';
  return `${turnCount} turn${turnCount === 1 ? '' : 's'}`;
}

function displayIdleS(view: DisplayActivationInput, nowMs: number): number | null {
  const at = displayLastActivityAt(view);
  if (at == null) return null;
  return Math.max(0, Math.floor((nowMs - at) / 1000));
}

function isDisplayActiveState(state: string | undefined): boolean {
  return state === 'running' || state === 'starting';
}

/**
 * Canonical marker (plain): `!` outranks the spinner (blocked is not working),
 * then the terminal states, then live work, then the static dot — including a
 * running activation gone quiet past the idle threshold.
 */
export function activationDisplayMarker(
  view: DisplayActivationInput,
  ask: DisplayAskInput | undefined,
  nowMs: number = Date.now(),
): string {
  if (ask) return '!';
  if (view.state === 'settled') return '✓';
  if (view.state === 'failed') return '✕';
  const idle = displayIdleS(view, nowMs);
  const active =
    isDisplayActiveState(view.state) && !(idle != null && idle > DISPLAY_IDLE_AFTER_S);
  if (active) return DISPLAY_SPINNER_FRAMES[Math.floor(nowMs / DISPLAY_SPINNER_FRAME_MS) % DISPLAY_SPINNER_FRAMES.length]!;
  return '●';
}

/**
 * Canonical metrics (plain): the state REASON (`asked 19s`, `idle 42s`) when
 * there is one to give, else space-separated `elapsed turns spend`.
 *
 * A blocked or idle activation's elapsed/turns/spend are not what an operator
 * is looking for at that moment — how long it has been stuck is.
 */
export function activationDisplayMetrics(
  view: DisplayActivationInput,
  ask: DisplayAskInput | undefined,
  nowMs: number = Date.now(),
): string {
  if (ask) {
    return `asked ${formatDisplayElapsed(Math.max(0, Math.floor((nowMs - displayAskedAt(ask, nowMs)) / 1000)))}`;
  }
  const idle = displayIdleS(view, nowMs);
  if (isDisplayActiveState(view.state) && idle != null && idle > DISPLAY_IDLE_AFTER_S) {
    return `idle ${formatDisplayElapsed(idle)}`;
  }
  const parts = [formatDisplayElapsed(displayElapsedS(view, nowMs))];
  const turns = formatDisplayTurns(displayTurnCount(view));
  if (turns) parts.push(turns);
  const spend = formatDisplaySpend(displayTokenUsage(view));
  if (spend) parts.push(spend);
  return parts.filter(Boolean).join(' ');
}

/**
 * Canonical fleet header (plain): `idle` for an empty fleet, else the exclusive
 * buckets space-joined. `blocked` counts ACTIVATIONS with an ask (not asks),
 * and `running` counts live work NOT blocked, so the three numbers sum to the
 * entry count.
 */
export function fleetDisplayHeader(
  activations: DisplayActivationInput[],
  asks: DisplayAskInput[],
): string {
  const total = activations.length;
  if (total === 0) return 'idle';
  const askById = new Map<string, DisplayAskInput>();
  for (const ask of asks ?? []) {
    const id = displayAskActivationId(ask);
    if (id && !askById.has(id)) askById.set(id, ask);
  }
  const blocked = activations.filter((v) => askById.has(displayActivationId(v))).length;
  const running = activations.filter(
    (v) => isDisplayActiveState(v.state) && !askById.has(displayActivationId(v)),
  ).length;
  const waiting = Math.max(0, total - running - blocked);
  const parts: string[] = [];
  if (running > 0) parts.push(`${running} running`);
  if (waiting > 0) parts.push(`${waiting} waiting`);
  if (blocked > 0) parts.push(`${blocked} blocked`);
  return parts.join(' ');
}

/** One activation's display entry. */
export function activationDisplayEntry(
  view: DisplayActivationInput,
  ask: DisplayAskInput | undefined,
  nowMs: number = Date.now(),
): ActivationDisplayEntry {
  return {
    activation_id: displayActivationId(view),
    marker: activationDisplayMarker(view, ask, nowMs),
    metrics: activationDisplayMetrics(view, ask, nowMs),
    work: displayWorkRef(view),
  };
}

/**
 * The `display` block `specialist_status` carries (compact and full): a
 * fleet-level header plus one entry per activation, computed once here so the
 * Pi extension and the Claude mod style the SAME strings instead of each
 * re-deriving them.
 */
export function buildFleetDisplay(
  activations: DisplayActivationInput[],
  asks: DisplayAskInput[],
  nowMs: number = Date.now(),
): FleetDisplayBlock {
  const askById = new Map<string, DisplayAskInput>();
  for (const ask of asks ?? []) {
    const id = displayAskActivationId(ask);
    if (id && !askById.has(id)) askById.set(id, ask);
  }
  return {
    header: fleetDisplayHeader(activations ?? [], asks ?? []),
    activations: (activations ?? []).map((view) =>
      activationDisplayEntry(view, askById.get(displayActivationId(view)), nowMs),
    ),
  };
}
