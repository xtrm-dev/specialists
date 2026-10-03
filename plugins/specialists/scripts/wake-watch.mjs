#!/usr/bin/env node
// specialists plugin idle-wake watcher (asyncRewake, operator spec §Z/§AA/§AF).
//
// RECOVERY PATH, NOT THE PRIMARY WAKE. Since unitAI-aiwva.21 the primary wake is a
// Claude Code Channel push (`src/mcp/channel.ts`): the MCP server sends
// `notifications/claude/channel` the instant the host emits a transition, which reaches
// an idle session with no polling and no model wakeup until a real event exists.
//
// This watcher stays because that push is gated EIGHT ways on the client — capability,
// protocol era, provider, feature flag, org policy, `--channels` membership, marketplace
// match, plugin allowlist — and every failing gate is a SILENT no-op. It is also
// interactive-only: Claude Code registers the channel listener in the TUI, so any session
// where a gate is closed has no push path at all and this hook is the only thing that
// reaches it. Delivery is unacknowledged, so a push that vanishes leaves no trace either.
//
// Cadence is therefore relaxed rather than tuned: this is the slow safety net behind a
// fast path, and paying a 5s poll for an event the channel usually already delivered is
// the exact cost the channel work removed.
//
// Claude Code's own schema: "If true, hook runs in background and wakes the model on exit
// code 2 (blocking error). Implies async." So this process blocks in the background and the
// ONLY way it wakes the session is exiting 2.
//
// What it watches: activations in the Substrate store crossing into a state the coordinator
// must act on — `settled` (a result is readable) or `needs_reply` (a question is waiting).
// A baseline is taken at start so a session is woken for NEW events, never for the backlog
// that was already there when it began.
//
// What it emits: a REFERENCE, never authority — activation_id, state, reason. No result
// bodies, no prompt bodies, no forensic IDs, no instructions. The woken session reads
// authoritative state through specialist_status, exactly as a polling coordinator does.
// A wake that is missed degrades to polling: the coordinator reads the same object late,
// never a different object.
//
// Discipline: exit 0 on every failure path. Exit 2 ONLY on a real observed transition —
// a spurious 2 wakes a session for nothing, which trains the operator to ignore wakes.

import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// 30s, not 5s: recovery latency behind the channel push, not primary wake latency.
const POLL_MS = Number(process.env.SUBSTRATE_WAKE_POLL_MS ?? 30000);
// Must finish INSIDE the hook's `timeout` (900000ms in hooks.json — timeout IS enforced for
// asyncRewake). Exiting cleanly beforehand beats being killed: a killed watcher stops
// watching silently, which is the failure this whole hook exists to avoid.
const MAX_MS = Number(process.env.SUBSTRATE_WAKE_MAX_MS ?? 870000);
const ACTIONABLE = new Set(['settled', 'needs_reply']);
// The primary Channel push arrives well inside this window; a fresh row with an ack marker
// here was already delivered and must not be woken again by this slow recovery net.
const WAKE_ACK_GRACE_MS = Number(process.env.SUBSTRATE_WAKE_GRACE_MS ?? 5000);
// Ack markers are a dedupe hint, never durable: sweep the old ones so the dir cannot grow.
const WAKE_ACK_MAX_AGE_MS = Number(process.env.SUBSTRATE_WAKE_ACK_MAX_AGE_MS ?? 86400000);
// The companion specialists-ui plugin writes these markers next to HOME; an override lets a
// coordinator relocate them (e.g. to a shared volume) as long as both sides agree.
const ACK_DIR = (process.env.SPECIALISTS_WAKE_ACK_DIR ?? '').trim() || join(homedir(), '.xtrm', 'wake-acks');

/** Marker class for a state: mirrors ackClassFor in plugins/specialists-ui. */
function ackClass(state) {
  return state === 'needs_reply' ? 'needs_reply' : 'settled';
}

/** Whether the coordinator already acknowledged this activation in this state. */
function acked(activation_id, state) {
  return existsSync(join(ACK_DIR, `${activation_id}.${ackClass(state)}`));
}

function resolveStorePath() {
  // SUBSTRATE_DB first: the store belongs to Substrate, which defines that variable and
  // shares the file with sb and Pi. XTRM_STATE_DB is specialists' own older name for the
  // same path — still honoured so existing setups are unchanged, but it no longer
  // overrides the owner's variable (unitAI-0whq0). Must stay identical to
  // resolveAuthorityDbPath in src/activation/authority-store.ts; these resolve separately.
  const substrate = (process.env.SUBSTRATE_DB ?? '').trim();
  if (substrate) return substrate;
  const override = (process.env.XTRM_STATE_DB ?? '').trim();
  if (override) return override;
  return join(homedir(), '.xtrm', 'state.db');
}

async function openStore(storePath) {
  try {
    const { Database } = await import('bun:sqlite');
    return new Database(storePath, { readonly: true });
  } catch {
    // Not under bun: node:sqlite serves the same prepare/close surface.
  }
  // Computed on purpose: bun resolves a literal (or const-folded) dynamic import specifier
  // when it LOADS the file, and a bun without node:sqlite (1.3.5) then aborts the whole
  // script before the bun:sqlite branch above can run (SPECIALISTS-4229).
  const { DatabaseSync } = await import(['node', 'sqlite'].join(':'));
  return new DatabaseSync(storePath, { readOnly: true });
}

/** activation_id -> state, for rows in a state the coordinator must act on. */
async function readActionable(storePath) {
  const db = await openStore(storePath);
  try {
    const rows = db
      .prepare(
        `SELECT activation_id, state, bead_id FROM activations WHERE state IN ('settled', 'needs_reply')`,
      )
      .all();
    const map = new Map();
    for (const row of rows) {
      if (row && typeof row.activation_id === 'string' && ACTIONABLE.has(row.state)) {
        map.set(row.activation_id, { state: row.state, bead_id: row.bead_id ?? null });
      }
    }
    return map;
  } finally {
    db.close();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rows in `current` whose state `seen` does not already hold for that activation. */
function freshRows(seen, current) {
  const fresh = [];
  for (const [id, row] of current) {
    // §AA: the payload carries retrieval references — the Issue ref rides along with the
    // activation id so the woken session can reach the durable contract, not just the run.
    if (seen.get(id)?.state !== row.state) {
      fresh.push({ activation_id: id, state: row.state, bead_id: row.bead_id });
    }
  }
  return fresh;
}

// Interactive sessions only. Under `claude -p` the entrypoint is `sdk-cli`, and a hook that
// blocks there does not merely fail to wake anything (spec §AB says headless may kill
// background hooks) — it breaks the run outright: every `claude -p` against this plugin
// returned "No messages returned from query" until this guard existed. A plugin must never
// cost a user their scripted invocations to serve an interactive feature.
if ((process.env.CLAUDE_CODE_ENTRYPOINT ?? '') !== 'cli') process.exit(0);

try {
  const storePath = resolveStorePath();
  if (!existsSync(storePath)) process.exit(0);

  // Baseline: everything already actionable when this session started is NOT news.
  //
  // Retried, because the loop below already tolerates a locked or mid-write store and the
  // baseline must tolerate it for the same reason: `~/.xtrm/state.db` is the SHARED
  // authority, written by sb and Pi concurrently. Letting a first-read failure escape to
  // the outer catch meant a session that happened to start during someone else's write got
  // no watcher at all, silently — the exact failure this hook exists to prevent, and the
  // one a caller can never observe because the hook is supposed to exit 0 when idle.
  let seen;
  for (let attempt = 0; ; attempt += 1) {
    try {
      seen = await readActionable(storePath);
      break;
    } catch (error) {
      if (attempt >= 5) throw error; // Persistently unreadable is a real failure; exit 0.
      await sleep(200);
    }
  }
  const deadline = Date.now() + MAX_MS;

  // Sweep stale ack markers opportunistically at start. Best effort, never fatal: a
  // stuck lock or missing dir is silent, and an uncleaned marker only delays one wake.
  try {
    const now = Date.now();
    for (const name of readdirSync(ACK_DIR)) {
      const path = join(ACK_DIR, name);
      try {
        if (now - statSync(path).mtimeMs > WAKE_ACK_MAX_AGE_MS) unlinkSync(path);
      } catch {
        /* the file vanished under us; not a wake */
      }
    }
  } catch {
    /* no ack dir yet */
  }

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    let current;
    try {
      current = await readActionable(storePath);
    } catch {
      continue; // A transient read (locked db, mid-write) is not a reason to stop watching.
    }

    let fresh = freshRows(seen, current);
    if (fresh.length > 0) {
      // Grace: the primary Channel push usually delivered the wake by now. Drop rows the
      // coordinator already acknowledged so a delivered event is not woken again by this
      // slow net; re-read after the grace in case more transitions arrived meanwhile.
      await sleep(WAKE_ACK_GRACE_MS);
      let check;
      try {
        check = await readActionable(storePath);
      } catch {
        check = current; // A transient lock mid-grace; judge against what we already had.
      }
      fresh = freshRows(seen, check).filter((f) => !acked(f.activation_id, f.state));
      seen = check;
      if (fresh.length === 0) continue; // All acknowledged by the push; keep watching.
    } else {
      seen = current;
      continue;
    }

    const settled = fresh.filter((f) => f.state === 'settled').length;
    const asking = fresh.filter((f) => f.state === 'needs_reply').length;
    const reason =
      asking > 0 && settled > 0
        ? `${asking} awaiting reply, ${settled} settled`
        : asking > 0
          ? `${asking} awaiting reply`
          : `${settled} settled`;
    const payload = JSON.stringify({
      source: 'specialists',
      reason,
      activations: fresh.slice(0, 10),
      // A result is readable only for a settled activation; a waiting ask is read via status.
      read_with: asking === 0 ? 'specialist_result' : 'specialist_status',
    });
    // Sources disagree on which stream becomes the system reminder: the E6 staging
    // fragment says stderr, Claude Code's own rewakeMessage schema says "hook output".
    // Writing both costs one line and removes the question.
    console.error(payload);
    console.log(payload);
    process.exit(2); // The wake. Nothing else in this file may exit 2.
  }
} catch {
  // Silent on every failure path: a watcher must never wake a session by accident.
}
process.exit(0);
