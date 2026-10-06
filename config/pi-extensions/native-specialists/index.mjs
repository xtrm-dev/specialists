// config/pi-extensions/native-specialists/index.mjs
//
// The PRIMARY coordinator surface named in the PRD — the Pi extension over
// `NativeActivationHost`. MCP (integrations/claude-code) is the other frontend;
// both serialise the SAME `InteractionMessage` protocol and the SAME
// `ActivationSnapshot` projection, and neither spawns a process. A tool that
// shelled out to `sp run` would satisfy the letter of "dispatch a Specialist"
// and defeat the entire purpose of the native runtime; nothing in this file
// constructs a child process (VALIDATION 2 asserts this on the process table).
//
// What this file does NOT do (and why):
//   - No permission logic. The capability invariant (PRD §112) — extension
//     installed != extension selected != capability granted — is enforced by the
//     host: only the resolved tool contract reaches the child session, plus the
//     two ask/escalate tools, fail-closed. `extension-tool-policy` remains the
//     single selector; nothing here reimplements it (PRD §113).
//   - No scheduler and no workflow engine (PRD non-goals). Dispatch is one
//     activation; the Fleet Registry inside the host is the persistent state.
//   - No second message vocabulary (PRD invariant BH). `specialist_reply`
//     correlates on `message_id` and nothing else; the answer returns as the
//     child's ask-tool result, resuming the same AgentSession.
//
// The host is a process-lifetime singleton created on first tool use: the
// FleetRegistry inside it is the seam that survives a turn boundary (VALIDATION
// 5). A per-turn host would answer `specialist_status` with an empty Fleet while
// children were still running.
//
// POLLING BUDGET (measured, not guessed): a child turn on a typical small model
// takes ~2 minutes (120s observed with deepseek-v4-flash), and the coordinator
// must keep polling specialist_status across the whole window. A loop that ends
// before settlement returns an empty result that looks like a fast failure —
// budget >= 3 minutes of polling before concluding an activation is stuck.

import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import {
  createActivationForensicSink,
  createObservabilitySqliteClient,
  createObservabilitySqliteClientAtPath,
  createSpecialistFeedTool,
  describeBuildIdentity,
  DispatchRejectedError,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  validateContractText,
  NativeActivationHost,
  resolveModelChain,
  resolveObservabilityDbLocation,
  resolveRuntimeToolContract,
  SpecialistLoader,
  THINKING_LEVELS,
  admitCoordinatorToolCall,
  createSpecialistLeaseReconcileTool,
  releaseHolderLease,
  isBuildStale,
  leaseScopeFor,
  readBuildId,
  supersedeStaleRefusal,
  toActivationCompactView,
  toActivationResultView,
  toActivationView,
  toPendingAskCompactView,
  toPendingAskView,
  validateBeforeRun,
} from '../../../dist/lib.js';


/**
 * Advise the COORDINATOR when a Specialist is writing the same workspace (PRD acceptance U,
 * unitAI-rrdnt.61).
 *
 * `pi.on('tool_call')` fires before a tool executes. This handler NEVER blocks: the coordinator
 * is fully waived from the workspace lease (operator decision 2026-10-06), so a coordinator edit
 * alongside a live Specialist is accepted behaviour — the same position the Claude `PreToolUse`
 * lease-warn hook already takes. When a writer tool touches a leased worktree the handler
 * surfaces a non-blocking notice and lets the call through.
 *
 * FAILS OPEN, on purpose and without exception. This runs on the operator's own session: a bug
 * here must never be the reason they cannot edit their own repository.
 *
 * It uses `admitCoordinatorToolCall`, NOT the Specialist-side `admitToolCall`. The latter
 * refuses an UNLEASED workspace, because a Specialist must hold a lease to mutate — applying
 * that to the coordinator would refuse every write whenever no Specialist was running.
 *
 * The boundary this does NOT cover: `pi.exec` and direct `node:fs` inside extension code
 * (H3/H4) are not interposable, so this advises on the coordinator's MODEL-initiated calls only.
 */
export function installCoordinatorFence(pi, deps = {}) {
  const scopeFor = deps.leaseScopeFor ?? leaseScopeFor;
  const admit = deps.admitCoordinatorToolCall ?? admitCoordinatorToolCall;
  const cwd = deps.cwd ?? process.cwd();

  pi.on('tool_call', (event, ctx) => {
    try {
      const verdict = admit({ toolName: event.toolName, workspace: scopeFor(cwd) });
      if (verdict.warning) {
        try {
          ctx?.ui?.notify?.(`native-specialists: ${verdict.warning}`, 'warning');
        } catch {
          // A warning must never fail the call it describes.
        }
      }
      return undefined;
    } catch {
      // Never let this handler be the reason an operator cannot write.
      return undefined;
    }
  });
}

/** Default coordinator ParticipantId: <participant_kind>::<participant_role>, matching MCP. */
export const DEFAULT_REQUESTED_BY = 'adapter::pi-extension';

/**
 * Specialist ENTRIES rendered before the overflow line — entries, not lines.
 *
 * Every entry is a two-line unit now, so the bound was halved deliberately from the
 * one-line era's 8. Eight two-line workers would be 17 rendered lines under a statusline
 * that already costs one and would scroll an ordinary terminal; four keeps the section's
 * ceiling exactly where it was (header + 2x4 + overflow = 10 lines) and buys the second line
 * for every entry instead of paying for two extra entries nobody can see. The header always
 * counts the WHOLE Fleet, so a truncated section stays honest about its size.
 */
export const FLEET_MAX_ROWS = 4;

// Wake cards are unrailed (operator decision): plain lines with a leading white
// big dot on the header, matching the xtrm-ui tool rows and substrate-suggest
// cards. RAIL is retained only for backwards compatibility with older sessions.
export const RAIL = '';

/** Identity — the rail is retired; lines render as-is. */
export function withRail(line) {
  return String(line ?? '');
}

// ── SGR helpers ──────────────────────────────────────────────────────────────
//
// Raw escapes, not pi theme helpers, for two reasons that are both structural: the footer
// section seam hands a renderer `width` and nothing else, so no `theme` object reaches this
// code; and wake-card styling is embedded in literal MESSAGE CONTENT, which is serialised
// as a string and never passes through a themed renderer. The accent is the Core footer's
// XTRM accent (#9a8bff, custom-footer/index.ts) — this file introduces no new palette.
const DIM = (text) => `\x1b[2m${text}\x1b[22m`;
const BOLD = (text) => `\x1b[1m${text}\x1b[22m`;
/** Plain white big dot — matches the xtrm-ui tool rows and substrate-suggest cards. */
const DOT = '●';
// The Jev/suggestion design system, shared with core's substrate-suggest cards: the gold
// band starts at the header TEXT (the dot keeps its own unbanded row) with a dark bold
// foreground, and everything below is italic on the normal background. One look for every
// card the operator sees, whichever extension drew it.
const GOLD_ON = '\x1b[48;2;201;162;39m\x1b[38;2;24;20;16m';
const GOLD_OFF = '\x1b[49m\x1b[39m';
/** Header separator: dim, never white, so it reads as a separator on the gold. */
const SEP_HINT = `\x1b[2m\u00b7\x1b[1m`;
/**
 * Band a header's text; the caller prepends the dot itself.
 *
 * Bold spans the WHOLE band: `\x1b[22m` clears bold AND dim for the rest of the line, so
 * every subordinate segment closes its dim with `\x1b[1m` (dim off, bold back on) rather
 * than `\x1b[22m`. Closing the band with one `\x1b[22m` at the end is what keeps that from
 * cascading - appending a fresh `\x1b[1m` per segment instead would grow without bound.
 */
const stripAnsi = (text) => String(text).replace(/\x1b\[[0-9;]*m/g, '');
/**
 * Dim a facts string that carries its own escapes (`costFacts` builds `43s • 7t • 46k`).
 * Those internal `22m`s would clear bold mid-band, so escapes are dropped and each fact is
 * re-dimmed through `sub`.
 */
const FACT_SEP = ` \x1b[2m\u2022\x1b[1m `;
/**
 * Dim a facts string inside the band. It STRIPS colour first: the band owns its foreground
 * completely, so no token inside it may carry its own colour. An accent-coloured `high` on
 * gold is light purple on yellow - poor contrast, and a break of the dark-foreground rule.
 * Subordinate segments are dimmed, never recoloured.
 */
const dimAll = (text) => stripAnsi(text).split(' \u2022 ').map(sub).join(FACT_SEP);
/** Dim inside the band: closes dim with `1m`, which restores bold rather than clearing it. */
const sub = (text) => `\x1b[2m${text}\x1b[1m`;
/** Dim + italic inside the band; `22m` clears bold, so it is reopened explicitly. */
const italicSub = (text) => `\x1b[2m\x1b[3m${text}\x1b[23m\x1b[1m`;
const bandHeader = (text) => `${GOLD_ON}\x1b[1m${text}\x1b[22m${GOLD_OFF}`;
// Italic is set with `3` and cleared with `23`; `22m` after it clears the dim. Pi theme
// helpers have no italic token, so the raw SGR is the only way to mark the purpose excerpt.
const ITALIC_DIM = (text) => `\x1b[2m\x1b[3m${text}\x1b[23m\x1b[22m`;
/** Full italic, no dim — the specialist's own result text reads as its voice. */
const ITALIC = (text) => `\x1b[3m${text}\x1b[23m`;
const ACCENT = (text) => `\x1b[38;2;154;139;255m${text}\x1b[39m`;
const ACCENT_BOLD = (text) => `\x1b[38;2;154;139;255m\x1b[1m${text}\x1b[22m\x1b[39m`;
const WARNING = (text) => `\x1b[33m${text}\x1b[39m`;
const SUCCESS = (text) => `\x1b[2m\x1b[32m${text}\x1b[39m\x1b[22m`;
const FAILURE = (text) => `\x1b[31m${text}\x1b[39m`;

/**
 * Section label chip: light neutral background, dark bold foreground — the ONLY element on
 * the line that carries a background, and the padding is literal spaces inside the escape
 * run rather than a terminal-dependent pad. No brand colour: the accent is reserved for the
 * thinking level and the live spinner, so a label that also glowed would flatten both.
 */
const SECTION_LABEL_BG = '\x1b[48;2;208;208;214m';
const SECTION_LABEL_FG = '\x1b[38;2;22;22;26m';
export const SECTION_LABEL = 'SPECIALISTS';
/** Tree connector under the XTRM statusline: `╰─`. Dim, never the chip. */
export const SECTION_TREE = '\x1b[2m╰─\x1b[22m';

/** Header counts. `running` is live work, `blocked` is outstanding coordinator asks, and
 * `waiting` is everything else the Fleet is holding for the operator — buckets are
 * mutually exclusive so the three numbers always sum to the entry count. */
export function fleetSummaryOf({ activations, asks }) {
  const act = activations ?? [];
  const pending = asks ?? [];
  const running = act.filter((v) => v.state === 'running' || v.state === 'starting').length;
  const blocked = pending.length;
  return {
    running,
    waiting: Math.max(0, act.length - running - blocked),
    blocked,
    total: act.length,
  };
}

/**
 * The section header — also the collapsed line.
 *
 * No command hints. `/specialists inspect` and `/specialists:reply` were permanent fixtures
 * of a line whose job is to say what the Fleet is doing; they are discoverable through
 * `/specialists` help and its argument completions, and an idle Fleet says `idle` rather
 * than quoting a command at an operator who has nothing to do.
 */
export function renderFleetHeader({ activations, asks }) {
  const { running, waiting, blocked, total } = fleetSummaryOf({ activations, asks });
  const label = `${SECTION_LABEL_BG}${SECTION_LABEL_FG}${BOLD(` ${SECTION_LABEL} `)}\x1b[0m`;
  // One separator space plus the chip's own trailing pad: `╰─ SPECIALISTS  2 running`.
  if (total === 0 && blocked === 0) return `${SECTION_TREE}${label} idle`;
  const parts = [];
  if (running > 0) parts.push(`${running} running`);
  if (waiting > 0) parts.push(`${waiting} waiting`);
  if (blocked > 0) parts.push(`! ${blocked} blocked`);
  return `${SECTION_TREE}${label} ${parts.join(' • ')}`;
}

/**
 * Row-budget duration: seconds under a minute, then `2m14s`, then `1h05m`.
 *
 * Seconds stop being scannable past a minute, and a Specialist turn runs for minutes; the
 * old plain-seconds form rendered `134s`, which a reader has to convert before it means
 * anything.
 */
export function formatElapsedShort(elapsedS) {
  const total = Math.max(0, Math.floor(elapsedS ?? 0));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(total / 3600)}h${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}m`;
}

/** Row-budget purpose excerpt: single line, whitespace-collapsed, bounded. */
export const PURPOSE_ROW_MAX = 60;

export function formatPurposeShort(purpose) {
  const flat = String(purpose ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length <= PURPOSE_ROW_MAX ? flat : `${flat.slice(0, PURPOSE_ROW_MAX - 1)}…`;
}

// Spend counts only. Window-context % is coordinator-owned and out of scope;
// never fabricated here (unitAI-beqby.3).
export function formatSpendShort(tokenUsage) {
  if (!tokenUsage) return '';
  // Snapshot keys are snake_case (input_tokens, output_tokens, ...); the short
  // camel keys below are the legacy test/fixture shape. total_tokens is a rollup,
  // never a summand — adding it would double-count (unitAI-d99hb).
  const total = ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens', 'reasoning_tokens', 'tool_tokens']
    .reduce((n, k) => n + (tokenUsage[k] ?? 0), 0)
    + (tokenUsage.input ?? 0) + (tokenUsage.output ?? 0) + (tokenUsage.cache ?? 0);
  if (total <= 0) return '';
  if (total < 1000) return `${total}`;
  if (total < 10000) return `${(total / 1000).toFixed(1)}k`;
  return `${Math.round(total / 1000)}k`;
}

/**
 * Calm geometric spinner for a running-and-working entry.
 *
 * Replaces the ten-frame braille cycle: four quarter-disc frames at ~220ms read as
 * "persistently busy" instead of demanding attention, and the frame is still selected
 * pure-functionally from the injected clock, so the render path owns no timer and no state.
 */
export const SPINNER_FRAMES = ['◐', '◓', '◑', '◒'];
export const SPINNER_FRAME_MS = 220;

/** Quiet-for-this-long means idle rather than working (unchanged threshold). */
export const IDLE_AFTER_S = 30;

/** States that are live work, as opposed to a terminal or pre-terminal row. */
const ACTIVE_STATES = new Set(['running', 'starting']);

const isActiveState = (state) => ACTIVE_STATES.has(state);

/**
 * Seconds since this activation last produced a session event.
 *
 * Both units here are milliseconds (`snapshot.lastActivityAt`, `PendingAsk.askedAt` are
 * `Date.now()`); the previous row renderer subtracted them from a SECONDS clock and so
 * rendered a 1.7-billion-second idle/waiting figure in production while its fixtures — which
 * passed seconds — looked right.
 */
function idleSeconds(view, nowMs) {
  if (view.last_activity_at == null) return null;
  return Math.max(0, Math.floor((nowMs - view.last_activity_at) / 1000));
}

function waitingSeconds(ask, nowMs) {
  return Math.max(0, Math.floor((nowMs - (ask.asked_at ?? nowMs)) / 1000));
}

/**
 * The one state signal for an entry. Never combined with a word that repeats it.
 *
 * `!` outranks the spinner (a child blocked on the coordinator is not working), then the
 * terminal states, then live work, then the static dot for everything else — including a
 * running child that has gone quiet past the idle threshold.
 */
function stateMarker({ view, blocked, active, nowMs }) {
  if (blocked) return WARNING('!');
  if (view.state === 'settled') return SUCCESS('✓');
  if (view.state === 'failed') return FAILURE('✕');
  if (active) return ACCENT(SPINNER_FRAMES[Math.floor(nowMs / SPINNER_FRAME_MS) % SPINNER_FRAMES.length]);
  return '●';
}

/**
 * The metric slot on an entry's second line: elapsed • turns • tokens for work in flight or
 * finished, and the state REASON (`waiting 19s`, `idle 42s`) when there is one to give.
 *
 * A blocked or idle child's elapsed/turns/spend are not what an operator is looking for at
 * that moment — how long it has been stuck is.
 */
function rowMetrics({ view, ask, nowMs }) {
  if (ask) return `waiting ${formatElapsedShort(waitingSeconds(ask, nowMs))}`;
  const idle = idleSeconds(view, nowMs);
  if (isActiveState(view.state) && idle != null && idle > IDLE_AFTER_S) {
    return `idle ${formatElapsedShort(idle)}`;
  }
  const parts = [formatElapsedShort(view.elapsed_s)];
  // Turns are a real measurement from dispatch on, so a zero is shown as zero rather than
  // suppressed — unlike spend, which has no value until a provider reports one.
  if (view.turn_count != null) parts.push(`${view.turn_count}t`);
  const tokens = formatSpendShort(view.token_usage);
  if (tokens) parts.push(tokens);
  return parts.join(' • ');
}

/**
 * One Specialist as a TWO-LINE unit, returned as an array so no caller can render half of
 * it. Forensic ids never appear in either line.
 *
 * Line 1 is identity and intent (name, tracked work, purpose); line 2 is the machine-ish
 * detail (model, thinking level, metrics). Parentheses around the model are gone: with the
 * second line to itself, the separator carries the grouping and the parens only added
 * noise.
 */
export function renderFleetRowLines(view, asks = [], nowMs = Date.now()) {
  const ask = (asks ?? []).find((a) => a.activation_id === view.activation_id);
  const idle = idleSeconds(view, nowMs);
  const active = isActiveState(view.state) && !ask && !(idle != null && idle > IDLE_AFTER_S);
  const marker = stateMarker({ view, blocked: Boolean(ask), active, nowMs });
  const purpose = formatPurposeShort(view.purpose);
  const primary =
    `    ${marker} ${BOLD(`${view.specialist}:${view.activation_id.slice(4)}`)}  ${DIM(view.bead_id ?? '—')}` +
    (purpose ? `  ${ITALIC_DIM(purpose)}` : '');
  const thinking = view.thinking_level ? ` ${DIM('·')} ${ACCENT_BOLD(view.thinking_level)}` : '';
  const meta =
    `       ${DIM(view.resolved_model ?? '?model')}${thinking}` +
    `  ${DIM('•')} ${DIM(rowMetrics({ view, ask, nowMs }))}`;
  return [primary, meta];
}

/** Footer-section lines: header + bounded two-line entries with overflow.
 * Expanded by default; blocked rows sort first. `detail` selects one activation's
 * result or feed rendered under the rows (SPECIALISTS-4264); the cache carries
 * the last completed read, so the section never awaits. */
export function renderSectionLines({ activations, asks }, { expanded = true, nowMs = Date.now(), detail = null, detailCache = null } = {}) {
  const lines = [renderFleetHeader({ activations, asks })];
  if (!expanded) return lines;
  const askIds = new Set((asks ?? []).map((a) => a.activation_id));
  const ordered = [...(activations ?? [])].sort(
    (a, b) => Number(askIds.has(b.activation_id)) - Number(askIds.has(a.activation_id)),
  );
  // Bounded by ENTRIES: each pushed entry is its whole two-line unit.
  const entries = ordered.slice(0, FLEET_MAX_ROWS);
  for (const view of entries) lines.push(...renderFleetRowLines(view, asks, nowMs));
  const overflow = ordered.length - entries.length;
  if (overflow > 0) lines.push(`    +${overflow} more`);
  if (detail) lines.push(...renderDetailLines(detail, detailCache));
  return lines;
}

/**
 * The selected activation's result or feed under the fleet rows — the Pi twin
 * of the Claude pane's r/f detail. Pure projection over the last completed
 * read: a live feed shows its newest lines with a follow cursor, a settled one
 * its tail once, and a selection with no completed read yet shows `loading…`.
 */
export function renderDetailLines(detail, cache) {
  if (!detail) return [];
  const head = `    ${DIM('▾')} ${BOLD(detail.kind)} ${DIM(detail.id)}`;
  if (!cache || cache.id !== detail.id || cache.kind !== detail.kind) return [head, `      ${DIM('loading…')}`];
  const shown = (cache.lines ?? []).slice(-FEED_SECTION_LINES_EXPORTED);
  const out = [head, ...shown.map((l) => `      ${l}`)];
  if ((cache.lines ?? []).length > shown.length) out.push(`      ${DIM(`… +${cache.lines.length - shown.length} more`)}`);
  if (!cache.settled && detail.kind === 'feed') out.push(`      ${DIM(`live · last_seq ${cache.lastSeq ?? '?'} — /specialists feed ${detail.id} follows`)}`);
  return out;
}

/** Detail lines drawn in the fleet section; the commands print more. */
export const FEED_SECTION_LINES_EXPORTED = 12;

// ── Forensic wiring (unitAI-rrdnt.37.1) ──────────────────────────────────────
//
// Native activations must be answerable from the SAME observability.db the legacy
// runner and the MCP frontend write — no second telemetry store (PRD §73/AP). The
// MCP server wires `createActivationForensicSink(createObservabilitySqliteClient())`
// at construction; this extension does the equivalent through the lib seam. The
// canonical file is created when absent (exactly what `sp run` does), then opened
// by the same client the CLI reads, so resolution parity holds by construction.
// Null-safe: if the client cannot open (e.g. `bun:sqlite` unavailable under the
// node-based pi runtime), the host falls back to its no-op sink exactly as MCP
// does when its client is null.

export function createCoordinatorHost({ createClient, wrapSink, Host } = {}) {
  const client = createClient
    ? createClient()
    : createObservabilitySqliteClientAtPath(resolveObservabilityDbLocation(process.cwd()).dbPath);
  const HostCtor = Host ?? NativeActivationHost;
  // A null client means forensics could not open, not that nothing is listening: the
  // wake rides this sink, so the wrapper must still run over a no-op base. Returning
  // `new HostCtor()` here would make a coordinator whose observability.db failed to
  // open silently lose every escalation notification — the exact silence this bead
  // exists to remove, reappearing only in the degraded case nobody runs (rrdnt.45).
  const sink = client ? createActivationForensicSink(client) : { emit: () => {} };
  // unitAI-rrdnt.45 seam: the wake lane wraps the sink so the extension can
  // observe host emits (escalation_raised / clarification_requested) without
  // touching NativeActivationHost or this constructor's internals.
  return new HostCtor({ forensics: wrapSink ? wrapSink(sink) : sink });
}

// ── Ask observation (unitAI-rrdnt.45) ────────────────────────────────────────
//
// The coordinator's wake-up rides a seam that already exists rather than adding
// one. `native-host.ts` already emits `clarification_requested` and
// `escalation_raised` through the forensic sink on every ask, and this extension
// is what constructs that sink — so observing asks costs a wrapper here and no
// change to the host, to `InteractionTransport`, or to `NativeActivationHostDeps`.
//
// The property that matters is what this DOES NOT touch. `DeliveryState` lives in
// the transport and the wake never reaches it, so an ask stays `pending` and stays
// readable through `specialist_status` whether the wake fires, is disabled, or
// throws. Push cannot become authoritative because it has no way to say otherwise
// (PRD SS30) — that is a consequence of where the seam is, not of care at the call
// site.
//
// Timing note, measured rather than assumed: `ask-tool.ts` calls `onAsk` BEFORE
// `transport.request()`, so at notification time the ask is not yet in
// `pendingAsks()` and no `message_id` exists to carry. The wake therefore carries
// the activation identity and the question, and the coordinator reads
// `specialist_status` for the id. That keeps the durable projection as the single
// correlation authority; a message_id sourced from anywhere else would be a second
// one for the exact thing that must have only one.

/** Forensic event names that mean a child is now blocked on the coordinator. */
const ASK_EVENTS = {
  clarification_requested: 'question',
  escalation_raised: 'escalation',
};

/**
 * Forensic event names that mean a child is DONE and the coordinator was never told.
 *
 * unitAI-rrdnt.64. Only asks woke the coordinator, so a session that dispatched and waited
 * had to poll `specialist_status` to learn anything had finished — which is the operator's
 * original complaint, still live after the ask wake shipped. The `.46` Fleet widget does not
 * close it: the widget repaints for an operator watching a TUI and never wakes the model.
 *
 * `activation_settled` is deliberately ABSENT. It precedes output validation, and
 * `activation_completed` follows it on the success path — waking on both would fire twice
 * for one activation. These two are terminal and mutually exclusive.
 *
 * Admission REFUSAL is also absent, and that is correct rather than an omission: a refusal is
 * the synchronous return value of the `specialist_dispatch` call the coordinator is already
 * blocked on, so there is no asynchronous window for silence to hide in. The hole is bounded
 * to post-admission events, which is why runtime failure IS here — `activation_failed` fires
 * on a running child whose turn ended with stopReason 'error' or 'aborted', and an unattended
 * coordinator is as blind to that as to success.
 */
const TERMINAL_EVENTS = {
  activation_completed: 'completed',
  activation_failed: 'failed',
};

/**
 * Wrap a forensic sink so asks are also reported to `onAsk`, forwarding everything
 * else untouched.
 *
 * `onAsk` throwing must never reach the sink's caller: forensics are on the
 * activation's path, and a failed notification is a diagnostic loss while a failed
 * activation is a functional one. The optional members are forwarded conditionally
 * because the host tests for their presence — defining them unconditionally over a
 * sink that lacks them would silently change which forensic paths the host takes.
 */
export function createAskObserverSink(base, onAsk, onTerminal) {
  const report = (fn, payload) => {
    if (!fn) return;
    try {
      fn(payload);
    } catch {
      // A wake that throws leaves the activation exactly as it was: the ask still pending,
      // the result still readable through specialist_status. That is the degraded path, and
      // it is the same path taken when no coordinator is listening at all.
    }
  };

  const wrapped = {
    emit(event) {
      try {
        base.emit(event);
      } finally {
        const identity = {
          activationId: event.activationId,
          attemptId: event.attemptId,
          specialist: event.specialist,
          beadId: event.beadId,
        };
        const kind = ASK_EVENTS[event.name];
        if (kind) {
          report(onAsk, {
            ...identity,
            kind,
            body: typeof event.payload?.body === 'string' ? event.payload.body : '',
          });
        }
        const outcome = TERMINAL_EVENTS[event.name];
        if (outcome) {
          report(onTerminal, {
            ...identity,
            outcome,
            error: typeof event.payload?.error === 'string' ? event.payload.error : undefined,
            output: typeof event.payload?.output === 'string' ? event.payload.output : undefined,
          });
        }
      }
    },
  };
  if (base.sessionEvent) wrapped.sessionEvent = (input) => base.sessionEvent(input);
  if (base.peerTransportEvent) wrapped.peerTransportEvent = (event) => base.peerTransportEvent(event);
  return wrapped;
}

/**
 * ── Wake/event cards ────────────────────────────────────────────────────────
 *
 * A wake is an EVENT, not a panel. It is the smallest thing that carries the event, the
 * context, whatever the Specialist wrote and the one instruction the coordinator must act
 * on — with the rail running down every line, no background, and no blank lines:
 *
 *   │ ! researcher · waiting · XTRM-241 · inspect native wake transport
 *   │ Does the bracket look right?
 *   │ Call specialist_status to obtain the pending message_id, then reply with specialist_reply. · activation act:b38da383-b44
 *
 *   │ ✓ executor · XTRM-241 · 42s • 3t • 43k
 *   │ Call specialist_result to read the complete result. · activation act:b38da383-b44
 *
 * No `[customType]` label and no background: pi's DEFAULT custom-message component paints a
 * `customMessageBg` box and a bold `[specialist_ask]` header, which is where the card look
 * came from. Registering a message renderer (see `installEventCardRenderer`) replaces that
 * component entirely, so the message renders as the lines this module produces and nothing
 * else.
 *
 * Hierarchy is typography plus colour: glyph for state, bold Specialist name, dim work id,
 * dim+italic purpose and instruction, plain foreground for anything a Specialist wrote.
 * Purple stays scarce — the rail and the live spinner only.
 */

/**
 * The coordinator instruction, verbatim.
 *
 * Literal DELIVERY CONTENT, not decoration: the coordinator model reads this string and acts
 * on it, and `details` is display-only. Styled dim + italic so it reads as secondary to a
 * human without being hidden from the model.
 */
const ASK_INSTRUCTION =
  'Call specialist_status to obtain the pending message_id, then reply with specialist_reply.';
const ESCALATION_INSTRUCTION =
  'Call specialist_status to inspect the escalation and respond through specialist_reply.';
const RESULT_INSTRUCTION = 'Call specialist_result to read the complete result.';
const FAIL_INSTRUCTION =
  'Call specialist_result for the full failure detail, then use specialist_retry if appropriate.';

/** Run cost for a settled event: elapsed • turns • tokens (each part omitted when absent). */
function costFacts(view) {
  return [
    view ? DIM(formatElapsedShort(view.elapsed_s)) : null,
    view?.turn_count != null ? DIM(`${view.turn_count}t`) : null,
    ...(view ? [formatSpendShort(view.token_usage)].filter(Boolean).map(DIM) : []),
  ].filter(Boolean).join(` ${DIM('•')} `);
}

/** Attribution for a failed event: the model that produced the failure, and its effort. */
function modelFacts(view) {
  return [
    view?.resolved_model ? DIM(view.resolved_model) : null,
    view?.thinking_level ? ACCENT_BOLD(view.thinking_level) : null,
  ].filter(Boolean).join(` ${DIM('·')} `);
}

/** The instruction line, railed, with the activation id that specialist_* tools take. */
function instructionLine(instruction, activationId) {
  return withRail(`${ITALIC_DIM(instruction)} ${DIM('·')} ${DIM(`activation ${activationId}`)}`);
}

/**
 * The wake message a blocked child produces. Exported so its shape is testable.
 *
 * `view` is the SAME `ActivationView` the tools serialise — the purpose excerpt and the work
 * id are read from it, never re-derived here. It is optional because a wake is worth
 * delivering even when the snapshot is already gone.
 */
export function formatAskWake(ask, view) {
  const escalated = ask.kind === 'escalation';
  const purpose = formatPurposeShort(view?.purpose);
  const beadId = ask.beadId ?? view?.bead_id ?? '—';
  // `!` covers both blocked states, so the one word the glyph cannot carry stays.
  const header = `${DOT} ${bandHeader([
    ask.specialist,
    sub(escalated ? 'escalated' : 'waiting'),
    sub(beadId),
    purpose ? italicSub(purpose) : null,
  ].filter(Boolean).join(` ${SEP_HINT} `))}`;
  return [
    withRail(header),
    // Blank body lines are dropped: the rail used to render paragraph breaks
    // as a bare gutter; unrailed, they would become blank lines, which event
    // cards never carry.
    // Design system: the body below a header is italic, on the normal background.
    ...String(ask.body || '(no body)').split('\n').filter((line) => line.trim() !== '').map((line) => ITALIC(withRail(line))),
    instructionLine(escalated ? ESCALATION_INSTRUCTION : ASK_INSTRUCTION, ask.activationId),
  ].join('\n');
}

/**
 * The wake message a finished child produces. Exported so its shape is testable.
 *
 * Same compact object as {@link formatAskWake}: the header names the event, its work and its
 * context (run cost when completed, the failing model when failed); the error string, when
 * there is one, is the only body line. `view` supplies elapsed/turns/spend and the failure
 * model — all existing snapshot telemetry, projected by `toActivationView`, never
 * recomputed here.
 */
export function formatSettlementWake(done, view, opts = {}) {
  const failed = done.outcome === 'failed';
  const beadId = done.beadId ?? view?.bead_id ?? '—';
  const facts = failed ? modelFacts(view) : costFacts(view);
  const header = `${DOT} ${bandHeader([
    done.specialist,
    sub(failed ? 'failed' : 'done'),
    sub(beadId),
    facts ? dimAll(facts) : null,
  ].filter(Boolean).join(` ${SEP_HINT} `))}`;
  return [
    withRail(header),
    ...resultLines(opts.resultText ?? done.output, opts),
    ...(failed && done.error ? [withRail(done.error)] : []),
    instructionLine(failed ? FAIL_INSTRUCTION : RESULT_INSTRUCTION, done.activationId),
  ].join('\n');
}

/**
 * The specialist's result text, as bounded italic lines under the header.
 *
 * Collapsed shows at most RESULT_EXCERPT_LINES lines plus a dim remainder hint
 * (ctrl+o expands); expanded (`full`) shows every line of the capped text. A
 * failed card usually has no output at all, in which case this is empty.
 */
export const RESULT_EXCERPT_LINES = 3;
const RESULT_TEXT_CAP = 4000;

function resultLines(output, opts = {}) {
  const text = typeof output === 'string' ? output.slice(0, RESULT_TEXT_CAP) : '';
  if (!text.trim()) return [];
  const lines = text.replace(/\n+$/, '').split('\n').filter((line) => line.trim() !== '');
  const shown = (opts.full ? lines : lines.slice(0, RESULT_EXCERPT_LINES)).map((line) => ITALIC(line));
  const out = [...shown];
  if (!opts.full && lines.length > RESULT_EXCERPT_LINES) {
    out.push(DIM(`… +${lines.length - RESULT_EXCERPT_LINES} lines · ctrl+o expands`));
  }
  return out;
}

/**
 * Wrap one already-railed line so the rail repeats on every VISUAL line.
 *
 * Without wrapping a long instruction overflows the terminal width. pi-tui's
 * ANSI-aware wrapper does the work; when it is unavailable (unit tests, a
 * non-TUI runtime) the line is emitted as-is.
 */
export function wrapRailedLine(line, width, wrap = null) {
  const text = String(line ?? '');
  const budget = Math.floor(width) - 2;
  if (!wrap || !Number.isFinite(budget) || budget < 8) return [text];
  const pieces = wrap(text, budget);
  return Array.isArray(pieces) && pieces.length > 0 ? pieces : [text];
}

/**
 * A message renderer that renders ONLY this module's lines — no `[customType]` label and no
 * `customMessageBg` box. Returning a component makes pi skip its default card entirely.
 */
export function makeEventCardRenderer(getWrap) {
  return (message, renderCtx = {}) => {
    // ctrl+o toggles _expanded on the CustomMessageComponent, which re-invokes
    // this renderer with the flag. A settlement card embeds its full variant in
    // details.expandedContent at wake time; cards without one render unchanged.
    const expanded = renderCtx?.expanded === true && typeof message?.details?.expandedContent === 'string';
    const content = expanded ? message.details.expandedContent : (typeof message?.content === 'string' ? message.content : '');
    return {
      dispose: () => {},
      invalidate: () => {},
      render: (width) => String(content)
        .split('\n')
        .flatMap((line) => wrapRailedLine(line, Number(width) || 80, getWrap())),
    };
  };
}

/**
 * ANSI-aware wrapper for {@link makeEventCardRenderer}, resolved once at runtime.
 *
 * pi-tui is not a dependency of this extension (it ships with pi), so the import is
 * optional and its failure is silent: an unwrapped card is still a correct card.
 */
let wrapTextWithAnsi = null;
export function installEventCardRenderer(pi, customType) {
  if (typeof pi.registerMessageRenderer !== 'function') return;
  if (!wrapTextWithAnsi) {
    import('@earendil-works/pi-tui')
      .then((mod) => { if (typeof mod.wrapTextWithAnsi === 'function') wrapTextWithAnsi = mod.wrapTextWithAnsi; })
      .catch(() => { /* unwrapped fallback */ });
  }
  pi.registerMessageRenderer(customType, makeEventCardRenderer(() => wrapTextWithAnsi));
}

// ── Result projection ────────────────────────────────────────────────────────
//
// There is no Pi-surface result projection any more. This file used to carry its
// own `toResultView`, and it drifted from the shared one on `configured_model`,
// `requested_model` and the `output ?? null` fallback — so a Pi coordinator and a
// Claude coordinator described the same settled activation differently. Two
// functions describing one thing is one description too many; `toActivationResultView`
// is imported from the shared frontend module for the same reason `toActivationView`
// and `toPendingAskView` already were (unitAI-kv8ac).

/**
 * Attach a settled result to a shared view when one is available.
 * Additive-only over the MCP vocabulary: never mutates the shared projection.
 * Compact rows carry only the result STATUS (drill-down under `full`); full
 * rows carry the whole validated result, as before.
 */
function withResult(view, result, full = false) {
  if (!result) return view;
  if (full) return { ...view, result: toActivationResultView(result) };
  return { ...view, result_status: result.status ?? 'settled' };
}

/** Permission tiers that mutate the workspace (mirrors native-host.ts line 57). */
const WRITE_TIERS = new Set(['MEDIUM', 'HIGH']);

/**
 * The SAME admission checks the host runs (unitAI-rrdnt.49): model chain,
 * resolved tool contract, and preflight. A specialist whose checks pass is
 * dispatchable on the native runtime; `reason` explains the rest.
 */
export async function dispatchability(spec) {
  const execution = spec.specialist.execution;
  const tier = execution.permission_required ?? 'READ_ONLY';
  const modelChain = resolveModelChain(execution);
  if (modelChain.length === 0) {
    return { dispatchable: false, reason: 'no configured model — pass model_override at dispatch' };
  }
  const toolContract = resolveRuntimeToolContract({
    level: tier,
    specialistName: spec.specialist.metadata.name,
    specialistPermissions: spec.specialist.permissions,
    cwd: process.cwd(),
  });
  if (!toolContract || toolContract.toolsList.length === 0) {
    return { dispatchable: false, reason: 'empty tool contract for tier' };
  }
  try {
    validateBeforeRun(spec, tier, toolContract);
  } catch (error) {
    return { dispatchable: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { dispatchable: true };
}

/** Scope/layer provenance of a resolved specialist (repo + user overrides). */
/**
 * First sentence or 120 characters of a refusal reason, whichever is shorter.
 *
 * Compact mode is for scanning. A reader deciding WHICH specialist to use needs to know that
 * one is unavailable and roughly why; the full text is one `name=` call away.
 */
function shortReason(reason) {
  const text = String(reason ?? '').trim();
  if (!text) return text;
  const firstSentence = text.split(/(?<=[.!?])\s/)[0];
  const chosen = firstSentence.length > 0 && firstSentence.length <= 120 ? firstSentence : text;
  return chosen.length <= 120 ? chosen : `${chosen.slice(0, 117)}...`;
}

/**
 * Every listing answer ends with this.
 *
 * A coordinator that reads a registry listing is deciding how to delegate, and that is the
 * exact moment it might reach for the CLI. It must not: the `sp` CLI is deferred while this
 * extension is what runs Specialists, and a shelled run has no Fleet entry, no ask channel,
 * no workspace lease and no native forensics (unitAI-rrdnt.63).
 */
const NATIVE_ONLY_NOTE = 'Dispatch through specialist_dispatch. Do not shell out to the specialists CLI.';

function specialistSummaryView(summary) {
  return {
    name: summary.name,
    category: summary.category,
    description: summary.description,
    scope: summary.scope,
    source: summary.source,
    version: summary.version,
    permission_required: summary.permission_required,
  };
}

// Build identity (unitAI-rrdnt.55): which dist artifact this session loaded vs what
// is on disk now. The static dist import below is what keeps one session on one
// gate, so staleness is structural — the only fix is making it visible. The loaded
// id is hashed once at extension load; the on-disk id is re-read on every outcome
// (a sub-millisecond hash of one file, never a re-import).
const DIST_LIB_PATH = fileURLToPath(new URL('../../../dist/lib.js', import.meta.url));
const LOADED_BUILD_ID = readBuildId(DIST_LIB_PATH);

/**
 * Attach the loaded-vs-on-disk build identity to an outcome payload. Exported
 * (pure given explicit ids) for tests; the live path always uses the load-time
 * id and a fresh on-disk read.
 */
export function annexBuildIdentity(
  payload,
  loadedId = LOADED_BUILD_ID,
  onDiskId = readBuildId(DIST_LIB_PATH),
) {
  // SPECIALISTS-2: the same comparison that renders the build line decides whether
  // staleness outranks the refusal's own reason. A stale runtime used to answer every
  // dispatch with a work-store refusal telling the operator to install a package that
  // was already installed, while this very payload carried the staleness line.
  return {
    ...supersedeStaleRefusal(payload, isBuildStale(loadedId, onDiskId), describeBuildIdentity(loadedId, onDiskId)),
    build: describeBuildIdentity(loadedId, onDiskId),
  };
}

/** Render an inline-contract gate refusal as a structured tool result. */
function inlineRejectionResult(reason, missing, note) {
  return annexBuildIdentity({
    status: 'rejected',
    reason,
    ...(missing?.length ? { missing } : {}),
    ...(note ? { note } : {}),
  });
}

/** Render a host-thrown `DispatchRejectedError` as a structured tool result. */
function rejectionResult(error) {
  return annexBuildIdentity({
    status: 'rejected',
    reason: error.message,
    detail: error.detail,
  });
}

// ── Result shapes (pi 0.99 tool exposure) ─────────────────────────────────────
//
// Every specialist_* result is built by ONE helper so its two channels cannot
// drift: `content[].text` is the model-facing JSON the coordinator JSON.parses,
// and `structuredContent` is the object a codemode script receives. pi resolves a
// call to `structuredContent` when the tool declares `outputSchema` — error
// results included — and to the text when it does not (docs/extensions.md, "Tool
// exposure"). Before 0.99 the eight tools returned text only, so a script
// calling `specialist_status({full:true})` received a JSON STRING.
//
// The schemas MIRROR the shared projections in src/tools/specialist/
// activation.tool.ts — the exact shapes `toActivationView`,
// `toActivationCompactView`, `toPendingAskView`, `toPendingAskCompactView` and
// `toActivationResultView` emit — plus the envelope each tool wraps them in. They
// are metadata for the tool listing: pi reads `structuredContent` and never
// validates it against the schema, so a stale schema misleads a script author
// rather than failing a call. What must not drift is the DATA, and that is
// enforced by test (structuredContent deep-equals JSON.parse(content[0].text)),
// not by this file.

const TokenUsage = Type.Object({
  input_tokens: Type.Optional(Type.Number()),
  output_tokens: Type.Optional(Type.Number()),
  cache_creation_tokens: Type.Optional(Type.Number()),
  cache_read_tokens: Type.Optional(Type.Number()),
  cache_write_1h_tokens: Type.Optional(Type.Number()),
  reasoning_tokens: Type.Optional(Type.Number()),
  tool_tokens: Type.Optional(Type.Number()),
  total_tokens: Type.Optional(Type.Number()),
  usage_source: Type.Optional(Type.String()),
  total_tokens_source: Type.Optional(Type.String()),
  // Provider-reported cost and the verbatim provider usage block. Declared open:
  // their inner shape is pi's, not this file's, and nothing here reads them.
  cost: Type.Optional(Type.Unknown()),
  pi_usage: Type.Optional(Type.Unknown()),
});

/** `ActivationResultView` — the settled result a `full:true` Fleet row carries. */
const ActivationResult = Type.Object({
  activation_id: Type.String(),
  participant_id: Type.String(),
  attempt_id: Type.String(),
  bead_id: Type.String(),
  issue_id: Type.String(),
  issue_ref: Type.String(),
  issue_revision: Type.Number(),
  contract_hash: Type.String(),
  execution_binding_id: Type.String(),
  status: Type.String(),
  output: Type.Unknown(),
  validation: Type.Object({
    valid: Type.Boolean(),
    schema: Type.Optional(Type.String()),
    errors: Type.Optional(Type.Array(Type.String())),
  }),
  pi_session_id: Type.Optional(Type.String()),
  configured_model: Type.Optional(Type.String()),
  requested_model: Type.Optional(Type.String()),
  resolved_model: Type.String(),
  model_override: Type.Boolean(),
  thinking_level: Type.Optional(Type.String()),
  thinking_override: Type.Boolean(),
  fallback_used: Type.Boolean(),
  completed_at: Type.Number(),
});

/** `ActivationView` — what `full:true` projects. */
const ActivationFull = Type.Object({
  activation_id: Type.String(),
  participant_id: Type.String(),
  attempt_id: Type.String(),
  specialist: Type.String(),
  bead_id: Type.String(),
  issue_id: Type.String(),
  issue_ref: Type.String(),
  issue_revision: Type.Number(),
  contract_hash: Type.String(),
  execution_binding_id: Type.String(),
  state: Type.String(),
  access: Type.String(),
  worktree_path: Type.String(),
  branch: Type.Optional(Type.String()),
  pi_session_id: Type.Optional(Type.String()),
  requested_model: Type.Optional(Type.String()),
  resolved_model: Type.String(),
  model_override: Type.Boolean(),
  thinking_override: Type.Boolean(),
  elapsed_s: Type.Number(),
  token_usage: Type.Optional(TokenUsage),
  turn_count: Type.Optional(Type.Number()),
  thinking_level: Type.Optional(Type.String()),
  purpose: Type.Optional(Type.String()),
  last_activity_at: Type.Number(),
  tool_contract_notes: Type.Optional(Type.Array(Type.String())),
  config_notes: Type.Optional(Type.Array(Type.String())),
  // Attached by `withResult` on a `full:true` Fleet row, never by the view itself.
  result: Type.Optional(ActivationResult),
});

/** `ActivationCompactView` — the default projection. */
const ActivationCompact = Type.Object({
  activation_id: Type.String(),
  specialist: Type.String(),
  bead_id: Type.String(),
  state: Type.String(),
  access: Type.String(),
  resolved_model: Type.String(),
  thinking_level: Type.Optional(Type.String()),
  elapsed_s: Type.Number(),
  turn_count: Type.Optional(Type.Number()),
  token_usage: Type.Optional(TokenUsage),
  purpose: Type.Optional(Type.String()),
  result_status: Type.Optional(Type.String()),
});

/**
 * One Fleet row. Which projection it is depends on the `full` argument, so the
 * row is a union of the two and a script must read the fields both carry
 * (activation_id, specialist, state) rather than assume either.
 */
const ActivationRow = Type.Union([ActivationFull, ActivationCompact]);

const PendingAskFull = Type.Object({
  message_id: Type.String(),
  kind: Type.String(),
  activation_id: Type.String(),
  attempt_id: Type.String(),
  from: Type.String(),
  to: Type.String(),
  body: Type.String(),
  delivery: Type.String(),
  asked_at: Type.Number(),
});

const PendingAskCompact = Type.Object({
  message_id: Type.String(),
  kind: Type.String(),
  activation_id: Type.String(),
  from: Type.String(),
  body: Type.String(),
  asked_at: Type.Number(),
});

const PendingAskRow = Type.Union([PendingAskFull, PendingAskCompact]);

/**
 * The envelope dispatch/resume/retry/steer wrap a projection in.
 *
 * Every field is optional but `status` because the projection itself is
 * conditional: the one field a caller may rely on unconditionally is `status`.
 * `previous_attempt_id` is resume/retry/steer; the `created_*` and
 * `step_contract` fields appear only when an inline contract created the Issue.
 */
const Envelope = Type.Object({
  status: Type.String(),
  activation_id: Type.Optional(Type.String()),
  specialist: Type.Optional(Type.String()),
  state: Type.Optional(Type.String()),
  access: Type.Optional(Type.String()),
  resolved_model: Type.Optional(Type.String()),
  elapsed_s: Type.Optional(Type.Number()),
  turn_count: Type.Optional(Type.Number()),
  thinking_level: Type.Optional(Type.String()),
  purpose: Type.Optional(Type.String()),
  token_usage: Type.Optional(TokenUsage),
  result_status: Type.Optional(Type.String()),
  message_id: Type.Optional(Type.String()),
  in_reply_to: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  attempt_id: Type.Optional(Type.String()),
  previous_attempt_id: Type.Optional(Type.String()),
  issue_ref: Type.Optional(Type.String()),
  created_issue_ref: Type.Optional(Type.String()),
  created_bead_id: Type.Optional(Type.String()),
  created_issue_note: Type.Optional(Type.String()),
  created_bead_note: Type.Optional(Type.String()),
  step_contract: Type.Optional(Type.Object({
    root_work_ref: Type.String(),
    inputs: Type.Number(),
    outputs: Type.Number(),
  })),
  // Refusal fields. `rejected` is a gate refusal (a refused contract, an
  // unreclaimable lease); `error` is "no such activation / no such message_id".
  reason: Type.Optional(Type.String()),
  detail: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.String()),
  missing: Type.Optional(Type.Array(Type.String())),
  note: Type.Optional(Type.String()),
  build: Type.Optional(Type.String()),
});

const Fleet = Type.Object({
  activations: Type.Array(ActivationRow),
  pending_asks: Type.Array(PendingAskRow),
  build: Type.Optional(Type.String()),
});

const SpecialistRow = Type.Object({
  name: Type.String(),
  tier: Type.Optional(Type.String()),
  access: Type.Optional(Type.String()),
  permission_required: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
  // ALWAYS present, even when true: absence would read as "dispatchable", which
  // is indistinguishable from the field going missing through a bug.
  dispatchable: Type.Optional(Type.Boolean()),
  reason: Type.Optional(Type.String()),
});

const Registry = Type.Object({
  // `specialists` is the list, the `detail:"full"` array, or a single row when
  // `name=` matched; `specialist` carries that single row. `count`/`undispatchable`
  // come with the compact list only.
  specialists: Type.Optional(Type.Array(SpecialistRow)),
  specialist: Type.Optional(SpecialistRow),
  count: Type.Optional(Type.Number()),
  undispatchable: Type.Optional(Type.Number()),
  detail: Type.Optional(Type.String()),
  known: Type.Optional(Type.Array(Type.String())),
  error: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
});

/** One activated specialist's complete settled result, or its not-settled guidance. */
const Result = Type.Object({
  activation_id: Type.Optional(Type.String()),
  specialist: Type.Optional(Type.String()),
  issue_ref: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  output: Type.Optional(Type.Unknown()),
  validation: Type.Optional(Type.Object({
    valid: Type.Optional(Type.Boolean()),
    schema: Type.Optional(Type.String()),
    errors: Type.Optional(Type.Array(Type.String())),
  })),
  resolved_model: Type.Optional(Type.String()),
  completed_at: Type.Optional(Type.Number()),
  source: Type.Optional(Type.String()),
  // Not-settled guidance and structured errors share this schema object.
  state: Type.Optional(Type.String()),
  next: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  candidates: Type.Optional(Type.Array(Type.String())),
});

/** `specialist_feed` — the event lines for one activation, or a structured refusal. */
const Feed = Type.Object({
  activation_id: Type.Optional(Type.String()),
  view: Type.Optional(Type.String()),
  events: Type.Optional(Type.Array(Type.String())),
  last_seq: Type.Optional(Type.Number()),
  total: Type.Optional(Type.Number()),
  truncated: Type.Optional(Type.Boolean()),
  // Structured errors share this schema object.
  status: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  candidates: Type.Optional(Type.Array(Type.String())),
});

/**
 * `outputSchema` per registered tool, by tool name. One map, referenced by every
 * `pi.registerTool` call below: a tool cannot declare a schema this map lacks,
 * and the test asserts the two sets are equal.
 */
export const TOOL_OUTPUT_SCHEMAS = {
  specialist_dispatch: Envelope,
  specialist_status: Fleet,
  specialist_result: Result,
  specialist_feed: Feed,
  specialist_reply: Envelope,
  specialist_resume: Envelope,
  specialist_retry: Envelope,
  specialist_steer: Envelope,
  specialist_stop_activation: Envelope,
  specialist_list: Registry,
  // SPECIALISTS-4275: list/reconcile returns the reconcile payload verbatim.
  specialist_lease_reconcile: Type.Object({
    uncertain_workspaces: Type.Optional(Type.Array(Type.Unknown(), {
      description: 'action=list: uncertain leases with the outcomes permitted for each.',
    })),
    applied: Type.Optional(Type.Boolean({ description: 'action=reconcile: whether the decision was applied.' })),
    outcome: Type.Optional(Type.String({ description: 'action=reconcile: the recorded outcome.' })),
    refusal_reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    status: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
  }),
};

/** The namespace every tool belongs to, so codemode lists them under one heading. */
const TOOL_NAMESPACE = { name: 'specialists', description: 'Dispatch and supervise XTRM Specialists on the in-process native activation host.' };

/**
 * A payload that reports a failure rather than an outcome.
 *
 * One predicate, not eight decisions: a refused dispatch, an unknown activation,
 * a message_id nobody is waiting on, and a lease the host can no longer reacquire
 * are all failures, and all of them used to reach the model as SUCCESSFUL tool
 * results carrying a `status` field — so a coordinator model reading only the
 * tool's success saw a refusal as an outcome. `specialist_list` names its
 * failures with an `error` key and no `status`, which is why both are checked.
 */
const isFailurePayload = (payload) =>
  payload?.status === 'error'
  || payload?.status === 'rejected'
  || typeof payload?.error === 'string';

/**
 * Wrap a payload into the pi AgentToolResult shape.
 *
 * `structuredContent` is the SAME object `JSON.stringify` renders, which is what
 * keeps the model-facing text and the script-facing value from drifting. A
 * failure carries `isError: true` rather than throwing, so the model sees an error
 * AND a script still receives the refusal data — the pattern pi's own MCP adapter
 * uses (docs/extensions.md: "return the result with `isError: true` instead of
 * throwing"). Throwing would lose the structured refusal, which is the payload
 * that tells the coordinator what to fix.
 */
function resultOf(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    ...(isFailurePayload(payload) ? { isError: true } : {}),
    details: {},
  };
}

// ── Human-readable tool-result views (unitAI-55yjs) ──────────────────────────
//
// Every specialist_* tool result carries byte-identical machine JSON in
// content[].text (the coordinator JSON.parses it) and the same object again in
// structuredContent (a codemode script reads it); renderResult only changes what
// the operator SEES. Each summary below reads ONLY fields the tools already emit
// — never forensic internals. Unknown shapes fall back to the raw JSON lines, and
// the expanded view always appends the full JSON underneath.
function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.activations)) {
    const lines = [`Fleet: ${payload.activations.length} activation(s), ${(payload.pending_asks ?? []).length} pending ask(s)`];
    for (const a of payload.activations) {
      lines.push(`- ${a.specialist ?? '?'} on ${a.bead_id ?? '?'} — ${a.state ?? '?'} (${a.activation_id ?? '?'})${a.resolved_model ? ` [${a.resolved_model}]` : ''}${a.result ? ` → ${a.result.status ?? 'settled'}` : ''}`);
    }
    for (const ask of payload.pending_asks ?? []) {
      lines.push(`? ${ask.kind ?? 'ask'} from ${ask.activation_id ?? '?'} (${ask.message_id ?? '?'}): ${(ask.body ?? '').split('\n')[0]}`);
    }
    return lines;
  }
  if (Array.isArray(payload.specialists)) {
    const rows = payload.specialists;
    const und = rows.filter((r) => r.dispatchable === false).length;
    const lines = [`Registry: ${payload.count ?? rows.length} specialist(s)${und ? `, ${und} undispatchable` : ''}`];
    for (const r of rows) {
      lines.push(`- ${r.name ?? '?'} [${r.tier ?? r.permission_required ?? '?'}]${r.category ? ` (${r.category})` : ''}${r.dispatchable === false ? ` — not dispatchable: ${r.reason ?? 'unknown reason'}` : ''}`);
    }
    return lines;
  }
  if (payload.specialist && typeof payload.specialist === 'object') {
    const s = payload.specialist;
    return [`${s.name ?? '?'} [${s.permission_required ?? s.tier ?? '?'}]${s.category ? ` (${s.category})` : ''}${s.dispatchable === false ? ` — not dispatchable: ${s.reason ?? 'unknown reason'}` : ''}`];
  }
  // specialist_result: a settled result (has `source`) or not-settled guidance (has `next`).
  if (typeof payload.activation_id === 'string' && typeof payload.source === 'string') {
    const text = typeof payload.output === 'string' ? payload.output : '';
    const lines = [`Result · ${payload.specialist ?? '?'} · ${payload.issue_ref ?? payload.activation_id} · ${payload.status ?? '?'} (${payload.source})${payload.resolved_model ? ` [${payload.resolved_model}]` : ''}`];
    if (text.trim()) {
      lines.push(...text.trim().split('\n').slice(0, RESULT_EXCERPT_LINES).map((l) => `  ${l.trim()}`));
    }
    return lines;
  }
  if (typeof payload.activation_id === 'string' && typeof payload.state === 'string' && typeof payload.next === 'string') {
    return [`${payload.activation_id} not settled — ${payload.state} → ${payload.next}`];
  }
  // specialist_feed: the event lines for one activation (machine JSON identical
  // to the MCP tool; `events` are the output lines the constraint covers).
  // Claude row shape: 'N of M events · last #seq' — the truncation count and the
  // follow cursor travel in the header, not in a trailing hint line.
  if (typeof payload.activation_id === 'string' && Array.isArray(payload.events)) {
    const head = payload.truncated === true
      ? `${payload.events.length} of ${payload.total ?? '?'} events · last #${payload.last_seq ?? '?'}`
      : `${payload.events.length} line(s)`;
    const lines = [`Feed · ${payload.activation_id} · ${payload.view ?? 'terminal'} · ${head}`];
    for (const event of payload.events) lines.push(`  ${String(event).trim()}`);
    return lines;
  }
  switch (payload.status) {
    case 'dispatched':
      return [
        `Dispatched ${payload.specialist ?? '?'} on ${payload.issue_ref ?? payload.bead_id ?? '?'} — ${payload.state ?? 'started'} as ${payload.activation_id ?? '?'}` +
        `${payload.resolved_model ? ` [${payload.resolved_model}]` : ''}` +
        `${payload.created_issue_ref ? ` (created Issue ${payload.created_issue_ref})` : payload.created_bead_id ? ` (created Issue ${payload.created_bead_id})` : ''}`,
      ];
    case 'answered':
      return [`Answered ${payload.message_id ?? '?'} for ${payload.activation_id ?? '?'}`];
    case 'resumed':
      return [`Resumed ${payload.activation_id ?? '?'} (${payload.specialist ?? '?'}) — attempt ${payload.previous_attempt_id ?? '?'} → ${payload.attempt_id ?? '?'}`];
    case 'retried':
      return [`Retried ${payload.activation_id ?? '?'} (${payload.specialist ?? '?'}) — attempt ${payload.previous_attempt_id ?? '?'} → ${payload.attempt_id ?? '?'}`];
    case 'stopped':
      return [`Stopped ${payload.activation_id ?? '?'}`];
    case 'rejected':
      return [`Rejected: ${payload.reason ?? 'no reason given'}${payload.missing?.length ? ` (missing: ${payload.missing.join(', ')})` : ''}`];
    case 'error':
      return [`Error: ${payload.error ?? 'unknown error'}`];
    default:
      return null;
  }
}

/** Build a renderResult that shows the human summary, with full JSON on expand. */
function humanResultOf() {
  return (result, { expanded } = {}) => {
    // Recomputed per render call: pi re-invokes render() as its own state
    // changes, so closing over first-call lines could go stale.
    const render = () => {
      const raw = (result?.content ?? []).find((c) => c?.type === 'text')?.text ?? '';
      let payload = null;
      try { payload = JSON.parse(raw); } catch { /* fall through to raw lines */ }
      const summary = payload ? summarizePayload(payload) : null;
      const lines = summary ?? (raw ? raw.split('\n') : ['(empty result)']);
      const body = summary && expanded ? [...summary, '', ...raw.split('\n')] : lines;
      return body;
    };
    // pi wraps every tool renderer in a MouseRegion and walks invalidate()
    // on theme/resume; a missing method kills the session (unitAI-q02sz).
    // Every custom renderer object in this file must expose it.
    return { dispose: () => {}, invalidate: () => {}, render };
  };
}

/** Build a renderCall one-liner naming the tool and its key argument. */
function humanCallOf(describe) {
  return (args) => {
    const line = describe(args ?? {});
    // invalidate() required: see humanResultOf (unitAI-q02sz).
    return { dispose: () => {}, invalidate: () => {}, render: () => [line] };
  };
}

// ── Extension factory ────────────────────────────────────────────────────────

/**
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 * @param {{ createHost?: () => NativeActivationHost, openObservability?: () => import('../../../dist/lib.js').ObservabilitySqliteClient | null }} [options] — test seams;
 *   when omitted, one process-lifetime host is created on first tool use.
 */
export default function nativeSpecialistsExtension(pi, options = {}) {
  // Detail-refresh refs, assigned where the fleet state lives below. The wake
  // lane is defined before the fleet state in this file; the refs let the wakes
  // refresh the selected detail without reordering either block.
  // NOTE (SPECIALISTS-4264 review): this file currently declares `const wake` /
  // `const wakeSettled` BEFORE this point while the fleet state (incl. these
  // refs) is declared AFTER — reading the refs at wake time is safe (they are
  // assigned by the time any child can settle), but a future reorder should
  // keep the refs above both lanes.
  const fleetDetailRef = { current: null };
  const refreshFleetDetailRef = { current: async () => {} };
  // PRD acceptance U: advise the coordinator when a Specialist holds the workspace it is
  // writing. Never blocks (the coordinator is fully waived); see installCoordinatorFence.
  installCoordinatorFence(pi, options);

  // Wake messages render as this module's lines and nothing else: pi's default custom-message
  // component paints a `customMessageBg` box and a bold `[specialist_ask]` header, which is
  // exactly the card/panel look the event surface must not have. Guarded — an older pi without
  // registerMessageRenderer keeps the default rendering and every semantic below.
  installEventCardRenderer(pi, 'specialist_ask');
  installEventCardRenderer(pi, 'specialist_settled');

  // The wake exists so that an operator who does nothing still learns a child is
  // blocked. The flag turns it off so the DEGRADED path is reproducible on demand:
  // the case worth regression-testing is not that a notification fires, it is that
  // an ask with no notification is still readable and still not marked delivered.
  pi.registerFlag('no-specialist-wake', {
    type: 'boolean',
    default: false,
    description:
      'Do not wake this coordinator when a Specialist asks, escalates, finishes or fails. ' +
      'Everything stays readable through specialist_status; only the notification is ' +
      'suppressed. With this set you must poll to learn any of it.',
  });

  /**
   * Wake the coordinator for one blocked child.
   *
   * `followUp` rather than `steer`: a question delivered between a tool call and
   * its result splits a turn the coordinator is in the middle of, and the child is
   * blocked either way — waiting for the current turn's tool calls to finish costs
   * the child nothing and costs the coordinator its train of thought otherwise.
   * `triggerTurn` is what makes an IDLE coordinator act, which is the whole bug:
   * without it a dispatched-then-waiting coordinator sees the message only when the
   * operator next types, which is the polling they were already doing.
   */
  /**
   * Wake the coordinator when a child FINISHES (unitAI-rrdnt.64).
   *
   * Always, rather than batched or only-when-idle. Each activation terminates exactly once,
   * so the volume is bounded by dispatches the coordinator itself made — and a coordinator
   * that dispatched something is the one participant that wants to know it is done. Batching
   * would trade the defect being fixed for a smaller version of itself.
   */
  const wakeSettled = (done) => {
    if (pi.getFlag('no-specialist-wake') === true) return;
    // The selected fleet detail follows settlement even when the wake is
    // suppressed or unroutable: the section paints the last completed read.
    if (fleetDetailRef.current?.id === done.activationId) void refreshFleetDetailRef.current();

    const summary = `Specialist ${done.specialist} ${done.outcome === 'failed' ? 'FAILED' : 'finished'}`;
    const ctx = liveContext({ requireUI: true });
    if (ctx) {
      try {
        ctx.ui.notify(summary, done.outcome === 'failed' ? 'warning' : 'info');
      } catch {
        // The UI can disappear while async work settles; the message below is the
        // load-bearing half and does not depend on it.
      }
    }

    const view = viewFor(done.activationId);
    pi.sendMessage(
      {
        customType: 'specialist_settled',
        content: formatSettlementWake(done, view, { resultText: done.output }),
        display: true,
        details: {
          ...done,
          expandedContent: formatSettlementWake(done, view, { resultText: done.output, full: true }),
        },
      },
      { deliverAs: 'followUp', triggerTurn: true },
    );
  };

  const wake = (ask) => {
    if (pi.getFlag('no-specialist-wake') === true) return;
    // An ask changes what the selected feed shows (status line, control row).
    if (fleetDetailRef.current?.id === ask.activationId) void refreshFleetDetailRef.current();

    const summary = `Specialist ${ask.specialist} ${ask.kind === 'escalation' ? 'escalated' : 'asked a question'}`;
    const ctx = liveContext({ requireUI: true });
    if (ctx) {
      try {
        ctx.ui.notify(summary, ask.kind === 'escalation' ? 'warning' : 'info');
      } catch {
        // The UI can disappear while async work settles; the message below is the
        // load-bearing half and does not depend on it.
      }
    }

    pi.sendMessage(
      {
        customType: 'specialist_ask',
        content: formatAskWake(ask, viewFor(ask.activationId)),
        display: true,
        details: ask,
      },
      { deliverAs: 'followUp', triggerTurn: true },
    );
  };

  /**
   * State the wake behaviour once, when the operator first dispatches a child.
   *
   * Not at session start: an extension that announces itself on every session is
   * noise, and before a dispatch there is nothing the wake could do. This fires at
   * the moment it becomes true that a child could start a turn on its own — which
   * is the behaviour a reader needs to have been told about, and the suppressed
   * case is the one a silent session would otherwise be unexplainable without.
   */
  let announced = false;
  const announceWake = () => {
    if (announced) return;
    announced = true;
    const ctx = liveContext({ requireUI: true });
    if (!ctx) return;
    const off = pi.getFlag('no-specialist-wake') === true;
    try {
      ctx.ui.notify(
        off
          ? 'Specialist wake is OFF (--no-specialist-wake): a child that blocks, finishes or fails will not notify you. Poll specialist_status.'
          : 'Specialist wake is on: a child that blocks, finishes or fails will start a turn here on its own. Disable with --no-specialist-wake.',
        off ? 'warning' : 'info',
      );
    } catch {
      // Announcing is courtesy, never a precondition for dispatching.
    }
  };

  /** One host for the life of the pi process — never per-turn (VALIDATION 5). */
  let host = null;

  /**
   * The shared activation projection for a wake, or undefined.
   *
   * Read through `host` directly rather than `getHost()`: a wake is emitted BY a live host,
   * so a wake with no host is impossible, and `getHost()` here would construct one from a
   * notification path. Absent view is survivable — the card keeps its header and body and
   * simply loses its telemetry line.
   */
  const viewFor = (activationId) => {
    try {
      const snapshot = host?.inspect(activationId);
      return snapshot ? toActivationView(snapshot) : undefined;
    } catch {
      return undefined;
    }
  };

  const getHost = () => {
    if (!host) {
      // The wrapper is handed to the test seam as well as to the real constructor,
      // so a test with an injected host still exercises the wake rather than
      // routing around the only path that matters here.
      const wrapSink = (sink) => createAskObserverSink(sink, wake, wakeSettled);
      host = options.createHost
        ? options.createHost({ wrapSink })
        : createCoordinatorHost({ wrapSink });
      announceWake();
    }
    return host;
  };

  /** Settled ActivationResults by activation id, collected without blocking a turn. */
  const results = new Map();

  /**
   * The shared MCP feed factory, never a second formatter (SPECIALISTS-4264).
   * Input/output lines are identical to the MCP `specialist_feed` by construction:
   * the factory IS the contract. One instance per extension (the factory is
   * stateless — it opens the timeline per call), shared by the specialist_feed
   * tool and the specialist_result earlier-session probe below. The observability
   * opener is an options seam so tests can inject a fake timeline without
   * touching the filesystem.
   */
  const feedTool = createSpecialistFeedTool(
    () => { try { return getHost(); } catch { return undefined; } },
    options.openObservability ?? (() => createObservabilitySqliteClient()),
  );

  const disposeActivation = async (activationId, reason) => {
    await getHost().stop(activationId, reason);
    results.delete(activationId);
  };

  // Per-activation detail selection (SPECIALISTS-4264): the id `/specialists
  // result|feed` opened, rendered under the fleet rows. A feed selection
  // refreshes on every fleet repaint while its activation runs (the Claude pane
  // refreshes on each status change, not on a timer); a settled activation or
  // a result selection is read once. Selection is projection state only — it
  // names an id, never caches lines, so a stale pick cannot outlive the fleet.
  let fleetDetail = null; // { kind: 'result'|'feed', id: string } | null
  let fleetDetailCache = null; // { id, kind, lines, lastSeq, settled } | null
  const FEED_COMMAND_LINES = 30;
  const isActiveStateFor = (state) => state === 'running' || state === 'starting';
  const feedCommandLines = (payload) => {
    const events = Array.isArray(payload?.events) ? payload.events.filter((e) => typeof e === 'string') : [];
    if (events.length === 0) return ['no events yet'];
    return payload.truncated === true ? [`… ${Number(payload.total ?? 0) - events.length} earlier events`, ...events] : events;
  };
  const resultCommandLines = (payload) => {
    if (typeof payload?.output === 'string') {
      const head = [payload.status, payload.resolved_model].filter((v) => typeof v === 'string' && v).join(' · ');
      const body = payload.output.trim() ? payload.output.replace(/\n+$/, '').split('\n') : ['(empty output)'];
      return head ? [head, ...body] : body;
    }
    if (typeof payload?.next === 'string') return [`${String(payload.state ?? 'not settled')} · use ${payload.next}`];
    return ['no result'];
  };

  const FEED_SECTION_LINES = FEED_SECTION_LINES_EXPORTED;

  // Async state advances through `refreshFleetDetail`: the commands refresh the
  // selection they just opened, the two settlement/ask wakes refresh it when a
  // child settles or asks, and the fleet-change follow loop below refreshes it
  // on every Fleet change while the selection is live (the Claude pane
  // refreshes on status change, not on a timer). The footer seam calls
  // renderBelow as a plain function on its own cycle, so the section always
  // paints the last completed read, never a pending promise. No timers, no
  // polling, no execute-body wrapping.
  const refreshFleetDetail = async (followCursor = null) => {
    const sel = fleetDetail;
    if (!sel) return;
    try {
      if (sel.kind === 'result') {
        const out = await resultToolDef('section', { activation_id: sel.id });
        const payload = out?.structuredContent ?? {};
        fleetDetailCache = { id: sel.id, kind: sel.kind, lines: resultCommandLines(payload), lastSeq: null, settled: true };
        return;
      }
      // A live feed follows from its cursor: only events newer than the last
      // completed read are appended, so each refresh is bounded and lines
      // never duplicate across refreshes.
      const since = followCursor ?? fleetDetailCache?.lastSeq ?? null;
      const input = { activation_id: sel.id, limit: FEED_SECTION_LINES };
      if (since != null && fleetDetailCache?.id === sel.id && fleetDetailCache?.kind === sel.kind) input.since_seq = since;
      const out = await feedToolDef('section', input);
      const payload = out?.structuredContent ?? {};
      if (payload.status === 'error') {
        fleetDetailCache = { id: sel.id, kind: sel.kind, lines: [`feed unavailable · ${payload.error ?? 'unknown error'}`], lastSeq: null, settled: true };
        return;
      }
      const fresh = (Array.isArray(payload.events) ? payload.events : []).filter((e) => typeof e === 'string');
      const prior = fleetDetailCache?.id === (payload.activation_id ?? sel.id) && fleetDetailCache?.kind === sel.kind && since != null
        ? (fleetDetailCache.lines ?? [])
        : [];
      const fleet = readFleet();
      const live = fleet.activations.some((a) => a.activation_id === (payload.activation_id ?? sel.id) && isActiveStateFor(a.state));
      fleetDetailCache = {
        id: payload.activation_id ?? sel.id,
        kind: sel.kind,
        lines: [...prior, ...fresh].slice(-FEED_SECTION_LINES),
        lastSeq: payload.last_seq ?? fleetDetailCache?.lastSeq ?? null,
        settled: !live,
      };
    } catch {
      // A failed refresh keeps the previous cache: the section degrades to
      // stale lines rather than dropping the view.
    }
  };
  // Every settlement, ask, or Fleet change may have advanced the feed, so the
  // selected detail follows those events — the Claude pane's
  // refresh-on-status-change, without a timer and without wrapping every
  // tool's execute body. Wakes refresh through `refreshFleetDetailRef` above;
  // live feeds follow through the fleet-change loop further below, kicked by
  // the feed command and reseeded on session_start.
  fleetDetailRef.current = null; // reassigned below by selection; kept in sync
  const syncDetailRef = () => { fleetDetailRef.current = fleetDetail; };
  refreshFleetDetailRef.current = refreshFleetDetail;

  const renderBelow = () => {
    if (!fleetVisible) return [];
    const fleet = readFleet();
    if (fleet.activations.length === 0 && fleet.asks.length === 0) return [];
    // One clock per paint so every row in the frame shares the spinner frame.
    return renderFleetSection(fleet, {
      expanded: fleetExpanded,
      nowMs: Date.now(),
      detail: fleetDetail,
      detailCache: fleetDetailCache,
    });
  };

  pi.registerTool({
    name: 'specialist_dispatch',
    label: 'Specialist dispatch',
    description:
      'Dispatch a Specialist on the native in-process runtime. No CLI process is ' +
      'spawned. Provide EITHER issue_ref (primary: an existing READY pinned Substrate ' +
      'Issue revision), bead_id (legacy compatibility alias for the same Issue locator), ' +
      'OR contract (an inline 7-section contract: the same readiness gate runs first, ' +
      'then a Substrate Issue is created, attested, claimed and dispatched). Provide ' +
      'exactly one work locator/contract. Returns once the activation is ADMITTED and ' +
      'started, not when it completes; use specialist_status and the event/ask channel ' +
      'for continuation, and specialist_reply for questions. A draft or incomplete ' +
      'contract is refused before a model turn is spent guessing at scope — repair the ' +
      'Issue through planning, not dispatch prose. Write-capable Specialists (MEDIUM/HIGH ' +
      'tiers) activate only when they can acquire the workspace lease. Settlement/result ' +
      'is evidence and does not perform Issue Closure. Each dispatch creates a persistent ' +
      'activation YOU own: stop it with specialist_stop_activation when you are done with it.',
    promptSnippet: 'Dispatch an XTRM Specialist (specialist_dispatch: specialist, issue_ref)',
    renderCall: humanCallOf((args) => `Dispatch ${args.specialist ?? '?'} on ${args.issue_ref || args.bead_id || 'inline contract'}`),
    renderResult: humanResultOf(),
    outputSchema: TOOL_OUTPUT_SCHEMAS.specialist_dispatch,
    namespace: TOOL_NAMESPACE,
    parameters: Type.Object({
      specialist: Type.String({ description: 'Specialist name, e.g. codebase-explorer' }),
      issue_ref: Type.Optional(
        Type.String({
          description:
            'Primary work locator: an EXISTING READY Substrate Issue ref. Mutually exclusive ' +
            'with bead_id and contract: provide exactly one locator/contract.',
        }),
      ),
      bead_id: Type.Optional(
        Type.String({
          description:
            'Legacy compatibility alias for issue_ref. It resolves through the same Substrate ' +
            'work boundary and does NOT make Beads the durable authority. Prefer issue_ref in ' +
            'new calls. Mutually exclusive with issue_ref and contract.',
        }),
      ),
      contract: Type.Optional(
        Type.String({
          description:
            'An INLINE task contract, used instead of issue_ref/bead_id: the SAME readiness gate ' +
            'runs first, then a Substrate Issue is created, attested, claimed and dispatched. The contract ' +
            'must contain all seven sections — PROBLEM, SUCCESS, SCOPE, NON_GOALS, ' +
            'CONSTRAINTS, VALIDATION, OUTPUT — plus a SCRUTINY level, which must be exactly ' +
            'one of LOW, MEDIUM, HIGH or CRITICAL. Note that this is EIGHT required parts, ' +
            'not seven; SCRUTINY is the one most often left out. Write each section as a ' +
            'heading: either the section name on its own line with its body beneath, or ' +
            '`PROBLEM: the body` on one line. Both forms are accepted. ' +
            'THIS IS THE PATH FOR ALL DELEGATED WORK, including small and quick questions. ' +
            'A short contract is a fine contract — a one-line body per section is enough for a ' +
            'bounded question, and dispatching here is what gives you the Fleet view, the ' +
            'ask/answer channel, the workspace lease and forensics. Do NOT shell out to the ' +
            '`sp` CLI to avoid writing a contract; a native activation is cheaper, not dearer. ' +
            'Use the planning skill (/planning) for genuinely complex work; a contract missing ' +
            'any section is refused and nothing is created.',
        }),
      ),
      title: Type.Optional(
        Type.String({
          description: 'Optional title for the Substrate Issue created from `contract` (default: derived from PROBLEM).',
        }),
      ),
      model_override: Type.Optional(
        Type.String({
          description:
            'Override the configured model for THIS activation only. An unavailable ' +
            'model is refused before the session is created, never silently replaced.',
        }),
      ),
      thinking_override: Type.Optional(
        Type.String({
          description:
            'Override the thinking level for THIS activation only ' +
            `(${THINKING_LEVELS.join('|')}). An unknown level is refused before the ` +
            'session is created, never silently replaced.',
        }),
      ),
      requested_by: Type.Optional(
        Type.String({
          description:
            'ParticipantId of the requesting coordinator. Defaults to the Pi extension ' +
            'adapter participant.',
        }),
      ),
      coordinator_session_id: Type.Optional(
        Type.String({ description: 'Pi session id, for lineage.' }),
      ),
      epic_context_depth: Type.Optional(
        Type.Integer({
          description:
            'Walk the Substrate Issue parent relation UP this many hops (1 = immediate parent, ' +
            "2 = parent + grandparent) and render each ancestor contract into the turn-1 " +
            "'## Epic lineage' section. Omit when no lineage is requested.",
          minimum: 1,
          maximum: 2,
        }),
      ),
      full: Type.Optional(Type.Boolean({
        description: 'Return the full verbose view (pre-SPECIALISTS-142 shape). Default compact.',
      })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const h = getHost();
      try {
        // Native authority is a Substrate Issue. issue_ref is primary; bead_id is
        // a compatibility alias for the same locator. Never accept two locator spellings
        // or a locator plus inline contract: ambiguity must fail loud before durable work changes.
        const issueRef = (params.issue_ref ?? '').trim();
        const beadAlias = (params.bead_id ?? '').trim();
        const contract = (params.contract ?? '').trim();
        if (issueRef && beadAlias) {
          return resultOf(inlineRejectionResult(
            'both issue_ref and bead_id were provided — bead_id is only an alias; provide one locator spelling',
          ));
        }
        const workRef = issueRef || beadAlias;
        if (workRef && contract) {
          return resultOf(inlineRejectionResult(
            'a work locator and contract were both provided — provide exactly one; silently preferring one would dispatch against work the coordinator did not mean',
          ));
        }
        const epicContextDepth = params.epic_context_depth;
        if (epicContextDepth !== undefined && epicContextDepth !== 1 && epicContextDepth !== 2) {
          return resultOf(inlineRejectionResult(
            'epic_context_depth must be 1 or 2 — 1 walks to the immediate parent epic, 2 also includes the grand-epic',
          ));
        }
        // Inline-contract dispatch creates a fresh issue with no parent: no lineage.
        const inline = !workRef && contract ? contract : undefined;
        if (!workRef && !inline) {
          return resultOf(inlineRejectionResult(
            'neither issue_ref/bead_id nor contract was provided — dispatch requires a READY Substrate Issue or an inline contract',
          ));
        }
        if (inline) {
          // The shared contract-text gate, BEFORE anything is created: a refused
          // dispatch leaves the board unchanged. The host re-validates
          // authoritatively inside inlineCreate — same parser, same verdict.
          const gate = validateContractText(inline);
          if (!gate.ok) {
            return resultOf(inlineRejectionResult(gate.reason, gate.missing));
          }
        }

        const handle = await h.start({
          specialist: params.specialist,
          ...(workRef ? { issueRef: workRef } : {}),
          // The host owns creation: validate → create → attest → claim through
          // the work boundary, claiming WITH this activation's id.
          ...(inline
            ? { contract: inline, ...(params.title ? { title: params.title } : {}) }
            : {}),
          ...(epicContextDepth !== undefined && !inline ? { epicContextDepth } : {}),
          ...(params.model_override ? { modelOverride: params.model_override } : {}),
          ...(params.thinking_override ? { thinkingOverride: params.thinking_override } : {}),
          requestedByParticipantId: params.requested_by ?? DEFAULT_REQUESTED_BY,
          ...(params.coordinator_session_id ? { coordinatorSessionId: params.coordinator_session_id } : {}),
        });

        // Deliberately NOT awaited (a tool that blocked until completion would make
        // every clarification a deadlock) and deliberately not dropped either: an
        // unhandled rejection on a failed activation would crash the pi process. The
        // host has already recorded the failure forensically and in the snapshot; the
        // settled result is projected through specialist_status.
        handle.result
          .then((result) => { results.set(handle.activationId, result); })
          .catch(() => { /* observed via specialist_status */ });

        const snapshot = h.inspect(handle.activationId);
        const full = params.full === true;
        const view = snapshot
          ? full ? toActivationView(snapshot) : toActivationCompactView(snapshot)
          : { activation_id: handle.activationId };
        return resultOf(annexBuildIdentity({
              status: 'dispatched',
              ...view,
              // Inline dispatch creates durable Substrate work. Surface the primary Issue ref
              // and retain created_bead_id only as a compatibility alias for old consumers.
              ...(inline
                ? {
                  created_issue_ref: handle.issueRef,
                  created_bead_id: handle.issueRef,
                  created_issue_note:
                    'This dispatch CREATED the Substrate Issue above from your inline contract. '
                    + 'Track its Journal/result/provenance explicitly. Specialist settlement is '
                    + 'evidence, not Issue Closure; use the authorized Substrate lifecycle for Closure.',
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
            }))
      } catch (error) {
        if (error instanceof DispatchRejectedError) {
          return resultOf(rejectionResult(error))
        }
        throw error;
      }
    },
  });

  pi.registerTool({
    name: 'specialist_status',
    label: 'Specialist fleet status',
    description:
      'The Fleet: every native activation this process hosts, with its state, and ' +
      'every outstanding question or escalation it is waiting on (answer those with ' +
      'specialist_reply). Compact by default — identity, state, cost, intent per row, ' +
      'settled rows carrying only the result status. Pass full:true for the verbose ' +
      'shape (full ActivationView rows, whole validated results, health sections). ' +
      'Activations stay listed until stopped: a settled entry is either waiting for ' +
      'a follow-up or waiting to be stopped. Stop with specialist_stop_activation ' +
      'every activation you will not resume. No CLI background jobs are shown — ' +
      'this surface only hosts in-process activations.',
    promptSnippet: 'Show the Specialist Fleet (specialist_status)',
    renderResult: humanResultOf(),
    outputSchema: TOOL_OUTPUT_SCHEMAS.specialist_status,
    namespace: TOOL_NAMESPACE,
    parameters: Type.Object({
      full: Type.Optional(Type.Boolean({
        description: 'Return the full verbose payload (pre-SPECIALISTS-142 shape). Default compact.',
      })),
    }),
    async execute(toolCallId, params = {}) {
      const h = getHost();
      const full = params.full === true;
      if (full) {
        return resultOf(annexBuildIdentity({
              activations: h.list().map((snapshot) =>
                withResult(toActivationView(snapshot), results.get(snapshot.activationId), true)),
              pending_asks: h.pendingAsks().map(toPendingAskView),
            }))
      }
      return resultOf(annexBuildIdentity({
            activations: h.list().map((snapshot) => ({
              ...toActivationCompactView(snapshot),
              ...(results.has(snapshot.activationId)
                ? { result_status: results.get(snapshot.activationId).status ?? 'settled' }
                : {}),
            })),
            pending_asks: h.pendingAsks().map(toPendingAskCompactView),
          }))
    },
  });

  // Identifiers are correlation keys, not display text. `act:` is a prefix, never part of
  // the identity, so short ids resolve against the id minus that prefix.
  const normId = (id) => String(id ?? '').replace(/^act:/, '');

  /**
   * Resolve an activation_id (full id or a unique short prefix, with or without the
   * `act:` lead) against the activations this process knows: its in-memory settled
   * results and its live host snapshots.
   */
  function resolveActivationId(input, knownIds) {
    const needle = normId(input);
    const full = knownIds.filter((k) => normId(k) === needle);
    if (full.length === 1) return { id: full[0] };
    const prefix = knownIds.filter((k) => normId(k).startsWith(needle));
    if (prefix.length === 1) return { id: prefix[0] };
    if (prefix.length > 1) return { ambiguous: prefix };
    return { unknown: true, candidates: [...knownIds] };
  }

  /** The owning tool for a live-but-unsettled state: steer while running, reply when
   * blocked on the coordinator, retry after a failure, resume a settled activation. */
  function nextToolFor(state) {
    switch (state) {
      case 'running':
      case 'starting':
        return 'specialist_steer';
      case 'needs_reply':
      case 'escalated':
      case 'waiting':
        return 'specialist_reply';
      case 'failed':
        return 'specialist_retry';
      case 'settled':
        return 'specialist_resume';
      default:
        return 'specialist_status';
    }
  }

  /** Every activation id the live host knows, tolerating a host whose listing throws. */
  function hostInspectIds(h) {
    try {
      return (h.list() ?? []).map((s) => s?.activationId).filter(Boolean);
    } catch {
      return [];
    }
  }

  /** One host snapshot by id, or undefined when absent/unreadable. */
  function hostSnapshotOf(h, id) {
    try {
      return h.inspect(id) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** The settled-result shape shared with the MCP frontend. Output is untruncated. */
  function settledResultView(result, h, id) {
    const snapshot = hostSnapshotOf(h, id);
    return {
      activation_id: result.activationId,
      specialist: snapshot?.specialist ?? String(result.participantId ?? '').replace(/^specialist::/, ''),
      issue_ref: result.issueRef,
      status: result.status,
      output: result.output ?? null,
      validation: result.validation,
      resolved_model: result.resolvedModel,
      completed_at: result.completedAt,
      source: 'memory',
    };
  }

  // ── specialist_result / specialist_feed bodies (local consts, not registry) ─
  //
  // The command handlers below call these directly. Looking the def up through
  // `pi.tools`/`pi.commands` would break on real Pi, whose ExtensionAPI exposes
  // only register/getters — the registry lives on the internal record, never on
  // the api (SPECIALISTS-4264 review blocker 1). The `pi.registerTool` calls
  // further down reference the same consts, so tool and command cannot drift.
  async function resultExecute(toolCallId, params = {}) {
    const input = String(params.activation_id ?? '').trim();
    const h = getHost();
    const knownIds = [...new Set([
      ...results.keys(),
      ...hostInspectIds(h),
    ])];
    const resolved = resolveActivationId(input, knownIds);
    if (resolved.ambiguous) {
      return resultOf({
        status: 'error',
        error: `ambiguous activation prefix '${input}' matches ${resolved.ambiguous.length} activations`,
        candidates: resolved.ambiguous,
      });
    }
    // Memory and live host cover this session; earlier sessions persist only in
    // observability.db, which the shared feed factory already reads
    // (SPECIALISTS-4264: the feed must answer for settled and earlier-session
    // activations alike, so a result miss there is worth one probe, not a guess).
    if (resolved.unknown) {
      const prior = await feedTool.execute({ activation_id: input, limit: 1 });
      if (!prior.status) {
        return resultOf({
          status: 'error',
          error: `unknown activation '${input}' on this coordinator — no settled result yet; try specialist_feed '${input}' for its event history`,
          candidates: resolved.candidates,
        });
      }
      return resultOf({
        status: 'error',
        error: `unknown activation '${input}' — no matching activation on this coordinator`,
        candidates: resolved.candidates,
      });
    }

    const id = resolved.id;
    const memory = results.get(id);
    if (memory) {
      return resultOf(settledResultView(memory, h, id));
    }

    const snapshot = hostSnapshotOf(h, id);
    if (snapshot) {
      return resultOf({
        activation_id: id,
        state: snapshot.state,
        next: nextToolFor(snapshot.state),
      });
    }

    return resultOf({
      status: 'error',
      error: `no result for activation '${id}' and it is no longer on this coordinator`,
      activation_id: id,
    });
  }

  async function feedExecute(toolCallId, params = {}) {
    // One shared formatter, never a second one: the factory IS the MCP tool's
    // input/output contract (SPECIALISTS-4264 constraint 1 — identical lines for
    // the same activation). `feedLine` correctness is covered by the shared
    // suite (tests/unit/tools/specialist-feed.test.ts); the Pi surface only
    // proves the wiring.
    const input = { activation_id: String(params.activation_id ?? '').trim() };
    if (params.view !== undefined) input.view = params.view;
    if (params.since_seq !== undefined) input.since_seq = params.since_seq;
    if (params.limit !== undefined) input.limit = params.limit;
    return resultOf(await feedTool.execute(input));
  }

  pi.registerTool({
    name: 'specialist_result',
    label: 'Specialist result',
    description:
      'Read ONE settled activation\'s complete result as a single object — the drill-down ' +
      'specialist_status deliberately withholds from its compact rows and projects whole ' +
      'only under full:true amidst every other result. Accepts a full activation_id or a ' +
      'unique short prefix (with or without the act: lead). Lookup reads the in-memory results ' +
      'of this process (the same result specialist_status projects); a result from before ' +
      'a restart is not available here. An activation that exists but has no result yet is answered with its ' +
      'state and the tool that owns it (steer while running, reply while blocked, retry ' +
      'after failure). An unknown or ambiguous id is a structured error naming the candidates.',
    promptSnippet: 'Read one Specialist result (specialist_result: activation_id)',
    renderResult: humanResultOf(),
    outputSchema: TOOL_OUTPUT_SCHEMAS.specialist_result,
    namespace: TOOL_NAMESPACE,
    parameters: Type.Object({
      activation_id: Type.String({
        description:
          'The activation to read. Either the full activation id (act:...) or a unique ' +
          'short prefix — the leading hex of the id with or without the act: lead, e.g. ' +
          '`a2924153` or `act:a2924153`. Ambiguous prefixes are refused with the candidates named.',
      }),
    }),
    execute: resultExecute,
  });

  pi.registerTool({
    name: 'specialist_feed',
    label: 'Specialist feed',
    description:
      "Read one activation's event feed: tool calls, text, turns, status changes and completion " +
      "(view 'terminal', default), or every lifecycle event (view 'forensic'). Works on running, settled and " +
      'earlier-session activations. Pass since_seq (the last call\'s last_seq) to follow a running one.',
    promptSnippet: 'Read one activation\'s event feed (specialist_feed: activation_id)',
    renderCall: humanCallOf((args) => `Feed ${args.activation_id ?? '?'}${args.view ? ` (${args.view})` : ''}`),
    renderResult: humanResultOf(),
    outputSchema: TOOL_OUTPUT_SCHEMAS.specialist_feed,
    namespace: TOOL_NAMESPACE,
    parameters: Type.Object({
      activation_id: Type.String({
        description:
          "Activation id: the full id or a unique short prefix, e.g. 'act:a2924153' or 'a2924153'.",
      }),
      view: Type.Optional(Type.Union([Type.Literal('terminal'), Type.Literal('forensic')], {
        description:
          "'terminal' (default): what the specialist did — tool calls, text, turns, status, completion — " +
          "one line each. 'forensic': every recorded lifecycle event name.",
      })),
      since_seq: Type.Optional(Type.Integer({
        minimum: 0,
        description:
          'Only events with a sequence number above this. Pass the previous call\'s last_seq to follow a running activation.',
      })),
      limit: Type.Optional(Type.Integer({
        minimum: 1,
        maximum: FEED_MAX_LIMIT,
        description:
          `Newest events to return (default ${FEED_DEFAULT_LIMIT}, max ${FEED_MAX_LIMIT}).`,
      })),
    }),
    execute: feedExecute,
  });

  pi.registerTool({
    name: 'specialist_reply',
    label: 'Specialist reply',
    description:
      'Answer an outstanding Specialist question or escalation by its message_id (read ' +
      'them from specialist_status.pending_asks). The answer returns as that tool call\'s ' +
      'result, so the Specialist continues with its context intact rather than being ' +
      'restarted with an answer pasted into a fresh prompt. An unknown or already ' +
      'answered message_id is reported, not silently accepted.',
    promptSnippet: 'Answer a Specialist question (specialist_reply: message_id, body)',
    renderCall: humanCallOf((args) => `Reply to ${args.message_id ?? '?'}`),
    renderResult: humanResultOf(),
    outputSchema: TOOL_OUTPUT_SCHEMAS.specialist_reply,
    namespace: TOOL_NAMESPACE,
    parameters: Type.Object({
      message_id: Type.String({
        description:
          'The message_id of the outstanding ask, from specialist_status.pending_asks. ' +
          'Correlation is by message id and nothing else — there is no "answer the ' +
          'latest ask", because with two asks outstanding that is a coin flip.',
      }),
      body: Type.String({ description: 'The answer. Returned to the Specialist as its tool result.' }),
    }),
    async execute(toolCallId, params) {
      const message = await getHost().answer(params.message_id, params.body);
      if (!message) {
        return resultOf({
              status: 'error',
              error: `No outstanding ask with message_id '${params.message_id}' — it may have been answered already, or its activation may have been disposed.`,
              message_id: params.message_id,
            })
      }
      return resultOf({
            status: 'answered',
            message_id: message.messageId,
            in_reply_to: message.inReplyTo ?? null,
            activation_id: message.activationId,
            attempt_id: message.attemptId,
          })
    },
  });

  // unitAI-rrdnt.33.1. `NativeActivationHost.resume()` existed, was unit-tested, and was
  // called by nothing — no MCP tool, no CLI, no extension command. A settled Specialist is
  // documented as "waiting and resumable" and the lease reacquisition path exists solely for
  // resume, so the whole resume half of the runtime was unreachable from any operator surface.
  // That is the epic's recurring shape: a module complete, tested, closed on the board, and
  // reachable by nobody.
  pi.registerTool({
    name: 'specialist_resume',
    label: 'Specialist resume',
    description:
      'Resume a settled or waiting Specialist with a new prompt, in the SAME session. ' +
      'This is not a second dispatch: the activation_id is kept and the attempt_id advances, ' +
      'so the child keeps its context and its workspace lease rather than starting over. ' +
      'Use this after answering a question, or to give a settled Specialist more work. ' +
      'A disposed activation cannot be resumed — that is what makes specialist_stop_activation ' +
      'the irreversible one.',
    promptSnippet: 'Resume a settled Specialist (specialist_resume: activation_id, prompt)',
    renderCall: humanCallOf((args) => `Resume ${args.activation_id ?? '?'}`),
    renderResult: humanResultOf(),
    outputSchema: TOOL_OUTPUT_SCHEMAS.specialist_resume,
    namespace: TOOL_NAMESPACE,
    parameters: Type.Object({
      activation_id: Type.String({ description: 'The settled or waiting activation to resume.' }),
      prompt: Type.String({ description: 'The new instruction for the resumed Specialist.' }),
      full: Type.Optional(Type.Boolean({
        description: 'Return the full verbose view (pre-SPECIALISTS-142 shape). Default compact.',
      })),
    }),
    async execute(toolCallId, params) {
      const h = getHost();
      const before = h.inspect(params.activation_id);
      // Capture the VALUE now. `inspect` hands back the host's live snapshot object, not a
      // copy, and `resume` mutates it in place — so reading `before.attemptId` when the
      // response is built returns the NEW attempt and previous_attempt_id always equals
      // attempt_id. Found live (act:25bc5ad5-cc3 reported att:...:2 for both); the unit test
      // missed it because the fake host returns a fresh object per call and so does not
      // alias the way the real one does.
      const previousAttemptId = before?.attemptId;
      if (!before) {
        return resultOf({
              status: 'error',
              error: `Unknown activation: ${params.activation_id}`,
              activation_id: params.activation_id,
            })
      }

      let handle;
      try {
        handle = await h.resume(params.activation_id, params.prompt);
      } catch (error) {
        // A refused resume is evidence, not a malfunction — the host refuses a disposed or
        // running activation, and a lease it can no longer reacquire.
        return resultOf({
              status: 'rejected',
              activation_id: params.activation_id,
              reason: error instanceof Error ? error.message : String(error),
            })
      }

      handle.result
        .then((result) => { results.set(handle.activationId, result); })
        .catch(() => { /* observed via specialist_status */ });

      const snapshot = h.inspect(handle.activationId);
      const full = params.full === true;
      const view = snapshot
        ? full ? toActivationView(snapshot) : toActivationCompactView(snapshot)
        : { activation_id: handle.activationId };
      return resultOf({
            status: 'resumed',
            previous_attempt_id: previousAttemptId,
            ...view,
          })
    },
  });

  // unitAI-3emr7: a failed activation is not dead — it is retryable in place. Resume
  // keeps a LIVE session going; retry re-runs a FAILED one (same activation, new attempt,
  // same lease). Without model_override the same session is re-prompted with its context
  // intact; with one a new session is built for the new model. An escalation or question
  // that CAN wait stays an ask answered with specialist_reply — retry is for runs that
  // already died, never a way to skip answering.
  pi.registerTool({
    name: 'specialist_retry',
    label: 'Specialist retry',
    description:
      'Re-run a FAILED Specialist in place, optionally on a named model. ' +
      'This is not a second dispatch: the activation_id is kept and the attempt_id advances, ' +
      'so the bead and the workspace lease survive the retry. Without model_override the ' +
      'SAME session is re-prompted and its context survives. Failed only — answer an ' +
      'outstanding question with specialist_reply and resume a settled Specialist with ' +
      'specialist_resume instead.',
    promptSnippet: 'Re-run a failed Specialist (specialist_retry: activation_id, model_override?)',
    renderCall: humanCallOf((args) => `Retry ${args.activation_id ?? '?'}`),
    renderResult: humanResultOf(),
    outputSchema: TOOL_OUTPUT_SCHEMAS.specialist_retry,
    namespace: TOOL_NAMESPACE,
    parameters: Type.Object({
      activation_id: Type.String({ description: 'The failed activation to re-run.' }),
      model_override: Type.Optional(Type.String({ description: 'Re-run on this model instead of the one that failed.' })),
      prompt: Type.Optional(Type.String({ description: 'Replacement turn prompt. Defaults to the dispatch-time render of the same bead.' })),
      full: Type.Optional(Type.Boolean({
        description: 'Return the full verbose view (pre-SPECIALISTS-142 shape). Default compact.',
      })),
    }),
    async execute(toolCallId, params) {
      const h = getHost();
      const before = h.inspect(params.activation_id);
      // Same aliasing trap as specialist_resume: `inspect` returns the live snapshot, so
      // the previous attempt id is captured before `retry` mutates it in place.
      const previousAttemptId = before?.attemptId;
      if (!before) {
        return resultOf({
              status: 'error',
              error: `Unknown activation: ${params.activation_id}`,
              activation_id: params.activation_id,
            })
      }

      let handle;
      try {
        handle = await h.retry(params.activation_id, {
          ...(params.model_override ? { modelOverride: params.model_override } : {}),
          ...(params.prompt ? { prompt: params.prompt } : {}),
        });
      } catch (error) {
        // A refused retry is evidence, not a malfunction — the host refuses a live
        // activation, an unavailable override, and a lease it can no longer reacquire.
        return resultOf({
              status: 'rejected',
              activation_id: params.activation_id,
              reason: error instanceof Error ? error.message : String(error),
            })
      }

      handle.result
        .then((result) => { results.set(handle.activationId, result); })
        .catch(() => { /* observed via specialist_status */ });

      const snapshot = h.inspect(handle.activationId);
      const full = params.full === true;
      const view = snapshot
        ? full ? toActivationView(snapshot) : toActivationCompactView(snapshot)
        : { activation_id: handle.activationId };
      return resultOf({
            status: 'retried',
            previous_attempt_id: previousAttemptId,
            ...view,
          })
    },
  });

  // SPECIALISTS-141: the channel a quiet executor was missing. `specialist_reply`
  // answers outstanding asks only and `specialist_resume` refuses running
  // activations — this delivers into the LIVE session (same session, same
  // attempt, no lease movement), so running work is redirectable, not just
  // stoppable.
  pi.registerTool({
    name: 'specialist_steer',
    label: 'Specialist steer',
    description:
      'Redirect a RUNNING Specialist mid-run with a new instruction, keeping its ' +
      'session and context intact. Use for a quiet executor that never raised a ' +
      'question; answer an outstanding ask with specialist_reply, resume a settled ' +
      'activation with specialist_resume, re-run a failed one with ' +
      'specialist_retry. Refused on any non-running state with a pointer to the ' +
      'owning tool.',
    promptSnippet: 'Steer a running Specialist (specialist_steer: activation_id, message)',
    renderCall: humanCallOf((args) => `Steer ${args.activation_id ?? '?'}`),
    renderResult: humanResultOf(),
    outputSchema: TOOL_OUTPUT_SCHEMAS.specialist_steer,
    namespace: TOOL_NAMESPACE,
    parameters: Type.Object({
      activation_id: Type.String({ description: 'The running activation to redirect mid-run.' }),
      message: Type.String({
        description:
          'Steering instruction delivered into the live session — the child receives ' +
          'it after its current tool calls finish, before the next model call, with ' +
          'context intact.',
      }),
      full: Type.Optional(Type.Boolean({
        description: 'Return the full verbose view (pre-SPECIALISTS-142 shape). Default compact.',
      })),
    }),
    async execute(toolCallId, params) {
      const h = getHost();
      const before = h.inspect(params.activation_id);
      if (!before) {
        return resultOf({
              status: 'error',
              error: `Unknown activation: ${params.activation_id}`,
              activation_id: params.activation_id,
            })
      }
      try {
        await h.steer(params.activation_id, params.message);
      } catch (error) {
        return resultOf({
              status: 'rejected',
              activation_id: params.activation_id,
              reason: error instanceof Error ? error.message : String(error),
            })
      }
      const snapshot = h.inspect(params.activation_id);
      const full = params.full === true;
      const view = snapshot
        ? full ? toActivationView(snapshot) : toActivationCompactView(snapshot)
        : { activation_id: params.activation_id };
      return resultOf({ status: 'steered', ...view })
    },
  });

  pi.registerTool({
    name: 'specialist_stop_activation',
    label: 'Specialist stop',
    description:
      'Stop and dispose a native activation. This is the only ordinary path to ' +
      'disposal — a settled Specialist is waiting and resumable, not finished. ' +
      'There is no child process to signal; disposal is a method call on the ' +
      'in-process AgentSession. You MUST stop every activation you are unlikely ' +
      'to use again: a settled or waiting activation keeps its session and Fleet ' +
      'entry until YOU stop it — nothing expires it for you.',
    promptSnippet: 'Stop a Specialist (specialist_stop_activation: activation_id)',
    renderCall: humanCallOf((args) => `Stop ${args.activation_id ?? '?'}`),
    renderResult: humanResultOf(),
    outputSchema: TOOL_OUTPUT_SCHEMAS.specialist_stop_activation,
    namespace: TOOL_NAMESPACE,
    parameters: Type.Object({
      activation_id: Type.String({ description: 'Activation to stop and dispose.' }),
      reason: Type.Optional(Type.String({ description: 'Recorded forensically with the disposal.' })),
    }),
    async execute(toolCallId, params) {
      if (!getHost().inspect(params.activation_id)) {
        return resultOf({
              status: 'error',
              error: `Unknown activation: ${params.activation_id}`,
              activation_id: params.activation_id,
            })
      }
      await disposeActivation(params.activation_id, params.reason ?? 'pi operator request');
      // SPECIALISTS-4275: stopping must END the write claim. Otherwise the coordinator is
      // fenced by a worker that no longer exists, which is exactly what happened live.
      let lease_release;
      try {
        const view = getHost().inspect(params.activation_id);
        const scope = leaseScopeFor(view);
        if (scope?.worktreePath) {
          lease_release = releaseHolderLease(
            { worktreePath: scope.worktreePath, repositoryRoot: scope.worktreePath },
            { activationId: params.activation_id, actor: 'coordinator-stop' },
          );
        }
      } catch {
        lease_release = undefined; // never fail a stop because a lease could not be read
      }
      return resultOf({
            status: 'stopped',
            activation_id: params.activation_id,
            ...(lease_release ? { lease_release } : {}),
          })
    },
  });

  // SPECIALISTS-4275: the coordinator's lease affordances, native. This WRAPS the same tool
  // the MCP surface exposes rather than reimplementing recovery, so the two cannot disagree.
  const leaseReconcileTool = createSpecialistLeaseReconcileTool();
  pi.registerTool({
    name: 'specialist_lease_reconcile',
    label: 'Workspace lease reconcile',
    description:
      'List uncertain writer leases, or resolve one, from inside the session. The coordinator ' +
      'needs this because a held or uncertain lease fences its own writes and a dead holder ' +
      'is only recoverable by an operator out of band. The caller states the outcome; it is ' +
      'never inferred, and a refusal returns its refusal_reason. Normally unnecessary: a lease ' +
      'whose holder is verifiably gone now heals on its own.',
    promptSnippet: 'Inspect or resolve a workspace writer lease (specialist_lease_reconcile)',
    outputSchema: TOOL_OUTPUT_SCHEMAS.specialist_lease_reconcile,
    namespace: TOOL_NAMESPACE,
    // TypeBox mirror of the MCP tool's zod schema: the two surfaces take different schema
    // dialects, so a parity test pins the field names rather than trusting a copy by eye.
    parameters: {
      type: 'object',
      properties: {
        action: Type.Optional(Type.Union([Type.Literal('list'), Type.Literal('reconcile')])),
        worktree: Type.Optional(Type.String({ description: "reconcile: the worktree whose lease is uncertain." })),
        outcome: Type.Optional(Type.Union([Type.Literal('safe_free'), Type.Literal('superseded'), Type.Literal('manual_attention_required')])),
        basis: Type.Optional(Type.Array(Type.String(), {
          description: 'reconcile: the durable evidence consulted, one entry per source. Empty is refused.',
        })),
        superseded_by: Type.Optional(Type.String({
          description: "reconcile: required for 'superseded'; the activation that now owns the workspace.",
        })),
        note: Type.Optional(Type.String({ description: 'reconcile: free-form note carried into the durable record.' })),
      },
    },
    async execute(toolCallId, params) {
      return resultOf(await leaseReconcileTool.execute(params));
    },
  });

  // unitAI-rrdnt.49: an sp-list equivalent inside the extension — awareness, not
  // surface area. One listing tool over the RESOLVED registry (repo + user layer
  // overrides merged by SpecialistLoader), marking what the native runtime can
  // actually dispatch. This extension is the dispatch surface; this tool is not a
  // replacement for it and deliberately does not reproduce run/feed/steer.
  pi.registerTool({
    name: 'specialist_list',
    label: 'Specialist registry',
    description:
      'List the resolved Specialist registry after repo and user layer overrides. ' +
      'Returns a COMPACT line per specialist by default — name, permission tier, ' +
      'category, and a reason only where the native runtime cannot dispatch it. ' +
      'Pass `name` for one specialist\'s full record including its description, or ' +
      'detail:"full" for every field of every specialist (large — prefer `name`). ' +
      'Write-capable tiers (MEDIUM/HIGH) still need the workspace lease at dispatch ' +
      'time. This extension is the dispatch surface: do not shell out to the specialists ' +
      'CLI to run a Specialist.',
    promptSnippet: 'List configured Specialists (specialist_list; name= for detail)',
    renderResult: humanResultOf(),
    outputSchema: TOOL_OUTPUT_SCHEMAS.specialist_list,
    namespace: TOOL_NAMESPACE,
    parameters: Type.Object({
      name: Type.Optional(Type.String({
        description: 'Return the full record for this one specialist instead of the compact list.',
      })),
      detail: Type.Optional(Type.String({
        description: '"compact" (default) is one line each; "full" returns every field for every specialist.',
      })),
      full: Type.Optional(Type.Boolean({
        description: 'Alias for detail:"full" (SPECIALISTS-142 one-flag vocabulary). Default compact.',
      })),
    }),
    // Progressive disclosure (operator report 2026-09-08). The unconditional form returned
    // 32 specialists x 9 fields = 16,161 bytes across 357 lines, and 44% of that was
    // `description` prose — a field a coordinator needs when choosing ONE specialist and
    // never when scanning all of them. The compact form is 1,204 bytes, a 13x reduction.
    // Undispatchable rows keep their reason in every mode: that is the part with signal,
    // and it is what tells a reader why `bare` and `changelog-keeper` are excluded.
    async execute(_toolCallId, params = {}) {
      const loader = new SpecialistLoader({ projectDir: process.cwd() });
      const summaries = await loader.list();
      const rows = [];
      for (const summary of summaries) {
        const row = {
          ...specialistSummaryView(summary),
          access: WRITE_TIERS.has(summary.permission_required ?? 'READ_ONLY') ? 'write' : 'read',
        };
        // loader.get throws for specialists with no configured model — that IS the
        // undispatchable signal (the host rejects them with no_model_configured),
        // not a listing failure.
        let spec = null;
        try {
          spec = await loader.get(summary.name);
        } catch (error) {
          row.dispatchable = false;
          row.reason = error instanceof Error ? error.message : String(error);
        }
        if (spec) {
          const capability = await dispatchability(spec);
          row.dispatchable = capability.dispatchable;
          if (capability.reason) row.reason = capability.reason;
        }
        rows.push(row);
      }
      const wanted = params.name;
      if (wanted) {
        const one = rows.find((r) => r.name === wanted);
        return resultOf(one
          ? { specialist: one, note: NATIVE_ONLY_NOTE }
          : {
            error: `Unknown specialist: ${wanted}`,
            known: rows.map((r) => r.name),
            note: NATIVE_ONLY_NOTE,
          });
      }

      if (params.detail === 'full' || params.full === true) {
        return resultOf({ specialists: rows, detail: 'full', note: NATIVE_ONLY_NOTE });
      }

      const compact = rows.map((r) => ({
        name: r.name,
        tier: r.permission_required ?? 'READ_ONLY',
        access: r.access,
        ...(r.category ? { category: r.category } : {}),
        // ALWAYS present, even when true. Omitting it to save bytes would make absence mean
        // "dispatchable", which is indistinguishable from the field going missing through a
        // bug — and dispatchability is the one thing this tool exists to report. Only the
        // `reason` is conditional, because there is no reason when nothing is wrong.
        dispatchable: r.dispatchable !== false,
        // The reason is TRUNCATED here and complete under `name=`. In an environment where
        // most specialists are undispatchable — CI, or a checkout with no model config —
        // untruncated reasons dominate the compact payload and undo the disclosure: measured
        // at 7,561 bytes compact against 16,283 full, versus 1,204 against 16,161 locally.
        // The first clause is what a scanner needs; the rest is drill-down like everything
        // else this tool now defers.
        ...(r.dispatchable === false ? { reason: shortReason(r.reason) } : {}),
      }));
      const undispatchable = compact.filter((r) => r.dispatchable === false).length;
      return resultOf({
        specialists: compact,
        count: compact.length,
        undispatchable,
        detail: 'compact',
        note: 'Pass name=<specialist> for one full record, or detail="full" for everything. '
          + NATIVE_ONLY_NOTE,
      });
    },
  });


  // ── Operator surface (unitAI-rrdnt.46) ─────────────────────────────────────
  //
  // Everything above this line is a MODEL surface: it exists only when the
  // coordinator decides to call a tool. An operator in an interactive TUI saw
  // nothing at all — no Fleet, no pending ask, no way to answer one. The PRD
  // says this extension owns a child viewport; it owned none.
  //
  // Measured against pi 0.85.1 before any of this was written (the SDK types at
  // dist/core/extensions/types.d.ts and @aliou/pi-processes as the worked
  // example), then proved in a live TUI: `pi.registerCommand` produces a real
  // slash command with argument completion, and `ctx.ui.setWidget` paints a
  // persistent panel above or below the editor. Neither needed a host change.
  //
  // The view is a PROJECTION and never a second source of state. Every repaint
  // reads `host.list()` and `host.pendingAsks()` afresh; nothing is cached
  // between ticks, because a cache would drift exactly when something
  // interesting happens. `toActivationView`/`toPendingAskView` are the same
  // projections the tools serialise, so the operator and the model are looking
  // at one vocabulary rather than two.
  //
  // Refresh is a poll, deliberately. `NativeActivationHost` is pull-only
  // (`list`, `pendingAsks`, `inspect`) and giving it an emitter whose only
  // subscriber is a widget would couple the host to a UI consumer for no
  // measured gain. A tick is a read of an in-memory Map. If the latency ever
  // shows in use, that is the evidence that justifies an emitter.

  // One capture of the live ExtensionContext, shared by every consumer in this
  // file (unitAI-rrdnt.45 wake-ups, unitAI-rrdnt.46 Fleet UI). Two independent
  // holders is how a stale ctx survives a session restart, so there is one.
  let capture = null;          // { ctx, generation, sessionId }
  let generation = 0;

  pi.on('session_start', (_event, ctx) => {
    capture = {
      ctx,
      generation: ++generation,
      sessionId: ctx.sessionManager.getSessionId(),
    };
  });
  pi.on('session_shutdown', () => { capture = null; });

  /**
   * The live context, or null. Null means "no UI right now", never an error:
   * every consumer must degrade rather than throw, because a context can go
   * stale mid-flight during a session switch or reload.
   */
  function liveContext({ requireUI = false } = {}) {
    const held = capture;
    if (!held || held.generation !== generation) return null;
    try {
      // A context that outlived its session reports a different id; one that is
      // torn down throws on property access. Both mean "not live".
      if (held.sessionId && held.ctx.sessionManager.getSessionId() !== held.sessionId) return null;
      if (requireUI && !held.ctx.hasUI) return null;
      return held.ctx;
    } catch {
      return null;
    }
  }

  const FLEET_WIDGET_KEY = 'specialist-fleet';

  /** Operator-facing toggle. The widget is shown by default; `/specialists hide` opts out. */
  let fleetVisible = true;

  /** Snapshot state and pending asks together — every caller needs both. */
  const readFleet = () => {
    // `host` stays null until the first tool use, and a null host is an empty
    // Fleet, not an error: creating one here would open the observability
    // database for a session that has not dispatched anything.
    if (!host) return { activations: [], asks: [] };
    return {
      // Arrow form, never bare `.map(toActivationView)`: Array.map passes the
      // element INDEX as nowMs, freezing every row at elapsed 0s (unitAI-d99hb).
      activations: host.list().map((s) => toActivationView(s)),
      asks: host.pendingAsks().map(toPendingAskView),
    };
  };

  /** Fleet view-model helper (projection-only; no cached state). */
  const renderFleetSection = (fleet, opts) => renderSectionLines(fleet, opts);

  // Operational fleet: the footer section below the statusline repaints on its
  // own cycle. Rows render expanded one row per specialist by default;
  // /specialists collapse opts out to the single line. No inspector: /specialists inspect
  // prints the same expanded text report (the ui.custom path hard-locked the
  // TUI in this pi version, unitAI-nmxhg — the interactive inspector stays
  // deferred with UI-4 and the footer repaints on its own cycle). The section
  // render is a projection: readFleet() afresh on every render, nothing cached.
  let fleetExpanded = true;
  let fleetUnregister = null;



  // Seam lookup order: explicit test seam, then the core footer's global hook,
  // then absent. The core module is not importable from this tree, so the
  // runtime shares it via globalThis (set by custom-footer when loaded).
  const findFooterSeam = () => {
    if (typeof options.registerFooterSection === 'function') return options.registerFooterSection;
    try {
      const hook = globalThis.__registerFooterSection;
      if (typeof hook === 'function') return hook;
    } catch { /* no global — fallback decides */ }
    return null;
  };

  // Hide-until-seam (unitAI-beqby.9, operator decision): the footer-section seam
  // is the only fleet surface. When the seam is absent the fleet stays hidden —
  // no setWidget fallback, so no aboveEditor/belowEditor widget competes with
  // the footer. Slash commands still report the fleet as text. The section
  // renders on the footer's own cycle, so repaints are no-ops everywhere else.
  const paintFleet = () => {};

  // Inspector deferred with UI-4 (unitAI-nmxhg): /specialists inspect prints the
  // expanded text report instead of mounting a ui.custom pane.
  const openFleetInspector = async (ctx) => {
    report(ctx ?? { hasUI: false }, renderFleetSection(readFleet(), { expanded: true }).join('\n'));
    return false;
  };

  // ── Per-activation result/feed (SPECIALISTS-4264) ─────────────────────────
  //
  // The Claude /specialists pane opens a selected activation's result (r) or live
  // feed (f); the Pi twin is these two commands — which also select the
  // activation in the fleet section — plus the section detail itself.
  // specialist_result covers this session; the feed answers running, settled
  // AND earlier-session activations through observability.db, so the feed is
  // the fallback when the result names no id. Refresh is event-driven (ask and
  // settlement wakes, plus the fleet-change follow loop while a feed is live),
  // never a timer or background loop.
  const activationCommandCompletions = (prefix) => {
    const normalized = String(prefix ?? '').trim();
    if (normalized.includes(' ')) return null;
    const items = readFleet().activations
      .filter((view) => view.activation_id.startsWith(normalized))
      .map((view) => ({
        value: view.activation_id,
        label: view.activation_id,
        description: `${view.specialist} · ${view.state}`,
      }));
    return items.length > 0 ? items : null;
  };
  const resolveCommandActivation = (ref) => {
    const trimmed = String(ref ?? '').trim();
    if (!trimmed) return { error: 'missing activation id' };
    const fleet = readFleet();
    const needle = trimmed.startsWith('act:') ? trimmed : `act:${trimmed}`;
    // A live row wins when exactly one matches; an earlier-session id goes to
    // the tools as given — the feed resolves it through observability.db.
    const hits = fleet.activations.filter((a) => a.activation_id === trimmed || a.activation_id.startsWith(needle));
    if (hits.length > 1) return { error: `Ambiguous activation: ${trimmed}` };
    return { id: hits.length === 1 ? hits[0].activation_id : trimmed, fleet };
  };
  const resultFeedHandler = async (kind, args, ctx) => {
    const ref = String(args ?? '').trim().split(/\s+/, 1)[0] ?? '';
    if (!ref) {
      report(ctx, `Usage: /specialists:${kind} <activation_id>`, 'warning');
      return;
    }
    const resolved = resolveCommandActivation(ref);
    if (resolved.error) {
      report(ctx, resolved.error, 'warning');
      return;
    }
    const { id, fleet } = resolved;
    // Selecting through a command opens the fleet-section detail too: the
    // section then follows the same activation the command just read.
    fleetDetail = { kind, id };
    syncDetailRef();
    if (kind === 'result') {
      const out = await resultToolDef('cmd', { activation_id: id });
      const payload = out?.structuredContent ?? {};
      if (payload.status === 'error') {
        fleetDetailCache = { id, kind, lines: [`result unavailable · ${payload.error ?? 'unknown error'}`], lastSeq: null, settled: true };
        report(ctx, `specialist_result refused: ${payload.error ?? 'unknown error'}`, 'warning');
        return;
      }
      fleetDetailCache = { id, kind, lines: resultCommandLines(payload), lastSeq: null, settled: true };
      report(ctx, resultCommandLines(payload).join('\n'));
      return;
    }
    // kind === 'feed': the newest lines; `truncated` says how many came before.
    const rest = String(args ?? '').trim().split(/\s+/).slice(1);
    const lines = Math.min(200, Math.max(1, Number(rest[0]) || FEED_COMMAND_LINES));
    const out = await feedToolDef('cmd', { activation_id: id, limit: lines });
    const payload = out?.structuredContent ?? {};
    if (payload.status === 'error') {
      fleetDetailCache = { id, kind, lines: [`feed unavailable · ${payload.error ?? 'unknown error'}`], lastSeq: null, settled: true };
      report(ctx, `specialist_feed refused: ${payload.error ?? 'unknown error'}`, 'warning');
      return;
    }
    const running = fleet.activations.some((a) => a.activation_id === (payload.activation_id ?? id) && isActiveStateFor(a.state));
    fleetDetailCache = { id: payload.activation_id ?? id, kind, lines: feedCommandLines(payload), lastSeq: payload.last_seq ?? null, settled: !running };
    // A freshly opened live feed starts the follow loop; the loop parks in
    // waitForFleetChange and refreshes on every Fleet change until the
    // activation settles (or the selection moves on).
    if (running) kickFollowLoop();
    const rendered = feedCommandLines(payload);
    report(ctx, [...rendered, ...(running ? [`… still ${fleet.activations.find((a) => a.activation_id === (payload.activation_id ?? id))?.state ?? 'running'} — re-run with last_seq ${payload.last_seq ?? '?'} as since_seq to follow`] : [])].join('\n'));
  };
  // Local defs, never the registry: the real Pi ExtensionAPI exposes only
  // registerTool/registerCommand/getAllTools()/getCommands() — `pi.tools` and
  // `pi.commands` exist on the internal record, never on the api (SPECIALISTS-4264
  // review). The commands below call these defs and handlers directly.
  const resultToolDef = resultExecute;
  const feedToolDef = feedExecute;

  // Fleet-change follow loop (SPECIALISTS-4264 review round 2): while a feed
  // selection is live, park in the SAME host.waitForFleetChange the
  // specialist_status blocking wait uses and refresh the selection on every
  // Fleet change — the Claude pane's refresh-on-status-change, without a timer
  // and without polling. Level-triggered, so a change landing between the
  // liveness check and the park resolves immediately (no lost wakeup, no spin).
  // One loop per process, idempotent across session restarts (followRunning
  // guard); session_shutdown sets followStopped, which unblocks the loop at
  // its next park or refresh boundary (extension lifecycle: no background work
  // survives the session).
  const FOLLOW_WAIT_MS = 25_000;
  let followRunning = false;
  let followStopped = false;
  const followLoop = async () => {
    if (followRunning) return;
    followRunning = true;
    try {
      for (;;) {
        if (followStopped) return;
        const sel = fleetDetail;
        const live = sel?.kind === 'feed'
          && readFleet().activations.some((a) => a.activation_id === sel.id && isActiveStateFor(a.state));
        if (!live) return;
        let h;
        try { h = getHost(); } catch { return; }
        if (typeof h?.waitForFleetChange !== 'function' || typeof h?.fleetChangeEpoch !== 'function') return;
        const epoch = h.fleetChangeEpoch();
        const outcome = await h.waitForFleetChange(FOLLOW_WAIT_MS, epoch);
        if (followStopped) return;
        // Re-check liveness after the park: the selection may have settled or
        // changed while parked, and a settled feed must not re-read.
        const now = fleetDetail;
        if (!now || now.kind !== 'feed' || now.id !== sel.id) continue;
        if (!readFleet().activations.some((a) => a.activation_id === now.id && isActiveStateFor(a.state))) {
          await refreshFleetDetail();
          return;
        }
        if (outcome === 'change') await refreshFleetDetail(fleetDetailCache?.lastSeq ?? null);
      }
    } finally {
      followRunning = false;
    }
  };
  const kickFollowLoop = () => { void followLoop(); };

  pi.on('session_start', (_event, ctx) => {
    // A restart must not leave a stale stop behind: a new session may select a
    // live feed again, and the loop is idempotent while one already runs.
    followStopped = false;
    if (!ctx.hasUI) return;
    const seam = findFooterSeam();
    if (seam && !fleetUnregister) {
      try { fleetUnregister = seam(FLEET_WIDGET_KEY, renderBelow) ?? null; }
      catch { fleetUnregister = null; }
    }
    if (fleetUnregister) return; // section renders on the footer's own cycle
    // No seam: the fleet stays hidden (hide-until-seam, unitAI-beqby.9).
  });

  /** Report to the operator on whichever surface the current mode actually has. */
  const report = (ctx, message, level = 'info') => {
    if (ctx.hasUI) ctx.ui.notify(message, level);
    else console.log(message);
  };

  const specialistsHandler = async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const action = parts[0] ?? '';
      if (action === 'hide') fleetVisible = false;
      else if (action === 'show') fleetVisible = true;
      else if (action === 'expand') fleetExpanded = true;
      else if (action === 'collapse') fleetExpanded = false;
      else if (action === 'inspect') { await openFleetInspector(ctx); return; }
      else if (action === 'result') { await resultFeedHandler('result', parts.slice(1).join(' '), ctx); return; }
      else if (action === 'feed') { await resultFeedHandler('feed', parts.slice(1).join(' '), ctx); return; }
      else if (action === 'status') {
        const ref = parts[1] ?? '';
        if (!ref) {
          report(ctx, renderFleetSection(readFleet(), { expanded: fleetExpanded }).join('\n'));
          paintFleet();
          return;
        }
        const resolved = resolveCommandActivation(ref);
        if (resolved.error) {
          report(ctx, resolved.error, 'warning');
          return;
        }
        const row = resolved.fleet.activations.find((a) => a.activation_id === resolved.id);
        if (!row) {
          report(ctx, `Unknown activation: ${ref} — try /specialists:feed ${ref} for earlier-session history`, 'warning');
          return;
        }
        const ask = resolved.fleet.asks.find((a) => a.activation_id === row.activation_id);
        report(ctx, [
          `${row.specialist} ${row.activation_id} · ${row.state ?? 'unknown'}`,
          `  issue ${row.bead_id ?? '—'} · ${row.resolved_model ?? '?model'}${row.thinking_level ? ` · ${row.thinking_level}` : ''}`,
          ...(row.purpose ? [`  purpose: ${row.purpose}`] : []),
          ...(ask ? [`  ${ask.kind ?? 'ask'} ${ask.message_id}: ${ask.body ?? ''}`] : []),
        ].join('\n'));
        return;
      }
      else if (action !== '') {
        report(ctx, 'Usage: /specialists [show|hide|inspect|expand|collapse|status <activation>|result <activation>|feed <activation> [lines]]', 'warning');
        return;
      }
      // The panel is only half the answer: in json/print mode there is no
      // widget at all, so the command always reports the Fleet in text too.
      report(ctx, renderFleetSection(readFleet(), { expanded: fleetExpanded }).join('\n'));
      paintFleet();
    };
  const specialistsCompletions = (prefix) => {
      const normalized = prefix.trim().toLowerCase();
      const items = ['show', 'hide', 'inspect', 'expand', 'collapse', 'status', 'result', 'feed']
        .filter((value) => value.startsWith(normalized))
        .map((value) => ({
          value,
          label: value,
          description: value === 'show' ? 'Show the Fleet panel.' : value === 'hide' ? 'Hide the Fleet panel.' : value === 'inspect' ? 'Print the expanded Fleet report.' : value === 'expand' ? 'Expand rows in the footer section.' : value === 'collapse' ? 'Collapse to one line.' : value === 'status' ? 'Show one activation.' : value === 'result' ? 'Read one activation\'s result.' : 'Read one activation\'s event feed.',
        }));
      return items.length > 0 ? items : null;
  };
  pi.registerCommand('specialists', {
    description: 'Show the Specialist Fleet and any pending asks. Usage: /specialists [show|hide|inspect|expand|collapse|status|result|feed <activation>]',
    getArgumentCompletions: specialistsCompletions,
    handler: specialistsHandler,
  });
  pi.registerCommand('fleet', {
    description: 'Compat alias for /specialists. Usage: /specialists [show|hide|inspect|expand|collapse|status|result|feed <activation>]',
    getArgumentCompletions: specialistsCompletions,
    handler: specialistsHandler,
  });

  // Local handler/completions consts, shared by the command and its /fleet
  // alias: on real Pi `pi.commands` does not exist, so an alias that looks the
  // command up through the registry throws (pre-existing fleet:reply bug,
  // fixed here along with the new result/feed aliases — SPECIALISTS-4264).
  const replyCompletions = (prefix) => {
      // Completing the message id is the whole point — an operator cannot be
      // expected to retype one off the panel.
      const normalized = prefix.trim();
      if (normalized.includes(' ')) return null;
      const items = readFleet().asks
        .filter((ask) => ask.message_id.startsWith(normalized))
        .map((ask) => ({
          value: ask.message_id,
          label: ask.message_id,
          description: `${ask.kind} from ${ask.from}`,
        }));
      return items.length > 0 ? items : null;
  };
  const replyHandler = async (args, ctx) => {
      const trimmed = args.trim();
      const split = trimmed.indexOf(' ');
      if (split === -1) {
        report(ctx, 'Usage: /specialists:reply <message_id> <answer>', 'warning');
        return;
      }
      const messageId = trimmed.slice(0, split);
      const body = trimmed.slice(split + 1).trim();
      if (!body) {
        report(ctx, 'Usage: /specialists:reply <message_id> <answer>', 'warning');
        return;
      }
      const message = await getHost().answer(messageId, body);
      if (!message) {
        report(
          ctx,
          `No outstanding ask with message_id '${messageId}' — it may have been ` +
          'answered already, or its activation may have been disposed.',
          'warning',
        );
        return;
      }
      report(ctx, `Answered ${message.messageId} on activation ${message.activationId}.`);
  };
  pi.registerCommand('specialists:reply', {
    description:
      'Answer an outstanding Specialist question or escalation. ' +
      'Usage: /specialists:reply <message_id> <answer>',
    getArgumentCompletions: replyCompletions,
    handler: replyHandler,
  });
  pi.registerCommand('fleet:reply', {
    description:
      'Compat alias for /specialists:reply. ' +
      'Usage: /specialists:reply <message_id> <answer>',
    getArgumentCompletions: replyCompletions,
    handler: replyHandler,
  });

  const activationCompletions = (prefix) => {
    const normalized = prefix.trim();
    if (normalized.includes(' ')) return null;
    const items = readFleet().activations
      .filter((view) => view.activation_id.startsWith(normalized))
      .map((view) => ({
        value: view.activation_id,
        label: view.activation_id,
        description: `${view.specialist} · ${view.state}`,
      }));
    return items.length > 0 ? items : null;
  };
  const stopHandler = async (args, ctx) => {
      const trimmed = args.trim();
      if (!trimmed) {
        report(ctx, 'Usage: /specialists:stop <activation_id> [reason]', 'warning');
        return;
      }
      const split = trimmed.indexOf(' ');
      const activationId = split === -1 ? trimmed : trimmed.slice(0, split);
      const reason = split === -1 ? '' : trimmed.slice(split + 1).trim();
      if (!getHost().inspect(activationId)) {
        report(ctx, `Unknown activation: ${activationId}`, 'warning');
        return;
      }
      await disposeActivation(activationId, reason || 'pi operator request');
      report(ctx, `Stopped ${activationId}.`);
  };
  const resumeHandler = async (args, ctx) => {
    const trimmed = args.trim();
    const split = trimmed.indexOf(' ');
    if (split === -1) {
      report(ctx, 'Usage: /specialists:resume <activation_id> <prompt>', 'warning');
      return;
    }
    const activationId = trimmed.slice(0, split);
    const prompt = trimmed.slice(split + 1).trim();
    if (!prompt) {
      report(ctx, 'Usage: /specialists:resume <activation_id> <prompt>', 'warning');
      return;
    }
    if (!getHost().inspect(activationId)) {
      report(ctx, `Unknown activation: ${activationId}`, 'warning');
      return;
    }
    try {
      await getHost().resume(activationId, prompt);
    } catch (err) {
      report(ctx, `Resume refused for ${activationId}: ${err?.message ?? err}`, 'warning');
      return;
    }
    report(ctx, `Resumed ${activationId}.`);
  };
  pi.registerCommand('specialists:stop', {
    description: 'Stop and dispose a native activation. Usage: /specialists:stop <activation_id> [reason]',
    getArgumentCompletions: activationCompletions,
    handler: stopHandler,
  });
  pi.registerCommand('fleet:stop', {
    description: 'Compat alias for /specialists:stop. Usage: /specialists:stop <activation_id> [reason]',
    getArgumentCompletions: activationCompletions,
    handler: stopHandler,
  });
  pi.registerCommand('specialists:resume', {
    description: 'Resume a settled or waiting activation with a new prompt. Usage: /specialists:resume <activation_id> <prompt>',
    getArgumentCompletions: activationCompletions,
    handler: resumeHandler,
  });
  pi.registerCommand('fleet:resume', {
    description: 'Compat alias for /specialists:resume. Usage: /specialists:resume <activation_id> <prompt>',
    getArgumentCompletions: activationCompletions,
    handler: resumeHandler,
  });
  // Per-activation result/feed (SPECIALISTS-4264): the command twins of the
  // model tools above, reading an earlier-session id through observability.db
  // exactly as the Claude /specialists result|feed verbs do.
  pi.registerCommand('specialists:result', {
    description: "Read one activation's complete result. Usage: /specialists:result <activation_id>",
    getArgumentCompletions: activationCommandCompletions,
    handler: (args, ctx) => resultFeedHandler('result', args, ctx),
  });
  pi.registerCommand('fleet:result', {
    description: "Compat alias for /specialists:result. Usage: /specialists:result <activation_id>",
    getArgumentCompletions: activationCommandCompletions,
    handler: (args, ctx) => resultFeedHandler('result', args, ctx),
  });
  pi.registerCommand('specialists:feed', {
    description: "Read one activation's event feed. Usage: /specialists:feed <activation_id> [lines]",
    getArgumentCompletions: activationCommandCompletions,
    handler: (args, ctx) => resultFeedHandler('feed', args, ctx),
  });
  pi.registerCommand('fleet:feed', {
    description: "Compat alias for /specialists:feed. Usage: /specialists:feed <activation_id> [lines]",
    getArgumentCompletions: activationCommandCompletions,
    handler: (args, ctx) => resultFeedHandler('feed', args, ctx),
  });


  // A child must never outlive the coordinator process. Best-effort: stop and
  // dispose every live activation when the pi session shuts down.
  pi.on('session_shutdown', async () => {
    // Stop the follow loop first: no parked waiter or in-flight refresh may
    // touch the host while its activations are being disposed below.
    followStopped = true;
    try { fleetUnregister?.(); } catch {}
    fleetUnregister = null;
    if (!host) return;
    if (!host) return;
    for (const snapshot of host.list()) {
      try {
        await disposeActivation(snapshot.activationId, 'session shutdown');
      } catch {
        // Disposal during shutdown is best-effort.
      }
    }
  });
}