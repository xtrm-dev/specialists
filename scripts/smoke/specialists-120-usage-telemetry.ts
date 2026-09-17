/**
 * SPECIALISTS-120 live smoke: Pi usage telemetry end to end.
 *
 * Runs a REAL `pi --mode rpc` child through the production `PiAgentSession` — the same class
 * `sp run` uses — for two turns plus one forced compaction, then captures Pi's terminal
 * `get_session_stats` through the production settlement method and prints the reconciliation.
 *
 * This is a smoke, not a unit test: it needs a working model credential and the network, so it
 * is deliberately NOT part of the vitest suite. Run it explicitly:
 *
 *   bun --bun scripts/smoke/specialists-120-usage-telemetry.ts zai/glm-5.3-flash
 *
 * Exit code 0 = the run recorded per-message usage, a terminal snapshot, and reconciled with
 * zero deltas. Exit code 1 = it did not, and the numbers are printed so the delta can be read.
 *
 * `sendCommand` is private on the session; the smoke reaches into it deliberately for the ONE
 * thing the production surface has no verb for (forcing a compaction). That is a property of
 * this script, not of the runtime: nothing in src/ uses it.
 */
import { PiAgentSession } from '../../src/pi/session.js';

const model = process.argv[2] ?? 'zai/glm-5.3-flash';
const session = await PiAgentSession.create({
  model,
  cwd: process.cwd(),
  offline: true,
  permissionLevel: 'READ_ONLY',
  sessionStatsTimeoutMs: 15_000,
  onEvent: () => {},
});

type Internals = { sendCommand: (command: Record<string, unknown>, timeoutMs?: number) => Promise<any> };

try {
  await session.start();
  console.log(`[smoke] pi version: ${session.getMetrics().pi_version ?? 'unresolved'}`);

  // Pi refuses `compact` below its keepRecentTokens threshold (default 20000), and a session
  // too small to compact is not a compaction test at all. The first prompt therefore carries
  // padding text: real context, generated locally, so the forced compaction below is a genuine
  // summarization call whose usage must appear in Pi's session totals.
  const padding = Array.from({ length: 900 }, (_, i) =>
    `line ${i}: the quick brown fox jumps over the lazy dog and records the token counts it sees.`).join('\n');
  await session.prompt(`Reply with exactly one word: alpha\n\nReference material follows; do not act on it.\n${padding}`);
  await session.waitForDone(300_000);
  console.log('[smoke] turn 1 done');
  console.log('[smoke] assistant:', (await session.getLastOutput()).trim().slice(0, 80));

  // Second turn on the SAME session — Pi keeps the conversation, so this is a genuine
  // multi-turn run rather than two independent sessions.
  await session.resume('Reply with exactly one word: beta', 180_000);
  console.log('[smoke] turn 2 done');
  console.log('[smoke] assistant:', (await session.getLastOutput()).trim().slice(0, 80));

  // Forced compaction: the production surface has no verb for this, and forcing it is the
  // point of the smoke. Pi emits compaction_end with `result.usage`, which the settlement sum
  // must include or reconciliation can never reach zero on a compacted run.
  const compact = await (session as unknown as Internals).sendCommand({ type: 'compact' }, 180_000);
  console.log('[smoke] compaction result:', JSON.stringify(compact?.data ?? compact).slice(0, 200));

  // Third turn after compaction, so the post-compaction session is exercised too.
  await session.prompt('Reply with exactly one word: gamma');
  await session.waitForDone(180_000);
  console.log('[smoke] turn 3 (post-compaction) done');

  await session.captureSessionStats();
  const metrics = session.getMetrics();

  console.log('\n[smoke] ── Pi session snapshot (get_session_stats) ──');
  console.log(JSON.stringify(metrics.session_stats ?? { error: metrics.session_stats_error }, null, 2));
  console.log('\n[smoke] ── run metrics ──');
  console.log(JSON.stringify({
    pi_version: metrics.pi_version,
    turns: metrics.turns,
    auto_compactions: metrics.auto_compactions,
    summed_cost: metrics.cost,
    token_usage: metrics.token_usage,
  }, null, 2));
  console.log('\n[smoke] ── reconciliation (summed per-message vs Pi session stats) ──');
  console.log(JSON.stringify(metrics.reconciliation ?? { error: 'no reconciliation produced' }, null, 2));

  const reconciliation = metrics.reconciliation;
  if (!reconciliation) {
    console.error('\n[smoke] FAIL: no reconciliation — Specialists recorded no summed usage or Pi reported no session totals.');
  } else if (!reconciliation.reconciled) {
    const deltas = Object.entries(reconciliation.fields)
      .filter(([, entry]) => entry.delta !== 0)
      .map(([field, entry]) => `${field}: summed=${entry.summed} session_stats=${entry.session_stats} delta=${entry.delta}`);
    console.error(`\n[smoke] FAIL: reconciled=false. Non-zero deltas: ${deltas.join('; ')}`);
  } else {
    console.log('\n[smoke] PASS: reconciled=true, every field delta 0.');
  }
} finally {
  try { await session.close(); } catch { /* smoke teardown is best-effort */ }
}

const finalMetrics = session.getMetrics();
process.exit(finalMetrics.reconciliation?.reconciled === true ? 0 : 1);
