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
export declare const DISPLAY_SPINNER_FRAMES: string[];
export declare const DISPLAY_SPINNER_FRAME_MS = 220;
/** Quiet-for-this-long means idle rather than working. */
export declare const DISPLAY_IDLE_AFTER_S = 30;
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
/** Row-budget duration: `42s`, `2m14s`, `1h05m`. */
export declare function formatDisplayElapsed(elapsedS: number | undefined): string;
/**
 * Canonical spend: input + output + cache_creation + cache_read.
 *
 * Accepts snapshot snake_case keys plus the legacy camel test/fixture keys
 * (`input`, `output`, `cache`). `reasoning_tokens`, `tool_tokens` and
 * `total_tokens` are never summands.
 */
export declare function formatDisplaySpend(tokenUsage: Record<string, unknown> | undefined): string;
/** Turn count, spelled out: `1 turn` / `3 turns`. Nullish renders nothing. */
export declare function formatDisplayTurns(turnCount: number | undefined): string;
/**
 * Canonical marker (plain): `!` outranks the spinner (blocked is not working),
 * then the terminal states, then live work, then the static dot — including a
 * running activation gone quiet past the idle threshold.
 */
export declare function activationDisplayMarker(view: DisplayActivationInput, ask: DisplayAskInput | undefined, nowMs?: number): string;
/**
 * Canonical metrics (plain): the state REASON (`asked 19s`, `idle 42s`) when
 * there is one to give, else space-separated `elapsed turns spend`.
 *
 * A blocked or idle activation's elapsed/turns/spend are not what an operator
 * is looking for at that moment — how long it has been stuck is.
 */
export declare function activationDisplayMetrics(view: DisplayActivationInput, ask: DisplayAskInput | undefined, nowMs?: number): string;
/**
 * Canonical fleet header (plain): `idle` for an empty fleet, else the exclusive
 * buckets space-joined. `blocked` counts ACTIVATIONS with an ask (not asks),
 * and `running` counts live work NOT blocked, so the three numbers sum to the
 * entry count.
 */
export declare function fleetDisplayHeader(activations: DisplayActivationInput[], asks: DisplayAskInput[]): string;
/** One activation's display entry. */
export declare function activationDisplayEntry(view: DisplayActivationInput, ask: DisplayAskInput | undefined, nowMs?: number): ActivationDisplayEntry;
/**
 * The `display` block `specialist_status` carries (compact and full): a
 * fleet-level header plus one entry per activation, computed once here so the
 * Pi extension and the Claude mod style the SAME strings instead of each
 * re-deriving them.
 */
export declare function buildFleetDisplay(activations: DisplayActivationInput[], asks: DisplayAskInput[], nowMs?: number): FleetDisplayBlock;
//# sourceMappingURL=specialist-display.d.ts.map