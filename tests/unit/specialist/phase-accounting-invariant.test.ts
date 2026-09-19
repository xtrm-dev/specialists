/**
 * XTRM-93 N3 (SPECIALISTS-106; endpoint policy SPECIALISTS-119): phase-accounting
 * invariant for aggregateJobMetrics.
 *
 * OPERATOR STATEMENT (one sentence): an activation's trailing silence is charged to
 * whatever phase was open only up to the activation's OWN last event — a later
 * operator status read (`sp ps`/`sp status`/`sp chat`/`sp attach`) is not charged —
 * so `waiting_ms` (and its consumer `xtrm_job_wait_seconds`) no longer grows with
 * operator read latency, while a job-produced non-phase trailing event
 * (tool/text/payload_breakdown/…) still extends the endpoint.
 * Consumer consequence: for a parked or abandoned activation whose only later
 * evidence is an operator read, `waiting_ms`/`active_runtime_ms` — and the served
 * `xtrm_job_wait_seconds`/`xtrm_job_active_runtime_seconds` — report the
 * activation-bounded value (trailing silence is zero), not read latency; a job
 * still emitting job-produced non-phase events reports that silence normally.
 *
 * The invariant (contract, not suggestion). The flush reference point is the CHOSEN
 * one — the `t` of the last JOB-PRODUCED event (see I1-FLUSH) — not the contract's
 * original last-PHASE-RELEVANT-event reference point; the divergence is named in
 * I1-FLUSH. Phase-relevant events are run_start,
 * status_change{running,waiting,done,error,cancelled}, run_complete:
 *
 *   (I1) PARTITION (shape-conditional; SPECIALISTS-119 ruling): every millisecond
 *        of an open-phase interval UP TO the flush endpoint — the `t` of the last
 *        JOB-PRODUCED event (I1-FLUSH) — is attributed EXACTLY ONCE: to
 *        active_runtime_ms if the open phase was running, to waiting_ms if it was
 *        waiting. There is NO universal sum equality. Shapes that leave an
 *        unattributed residual between the attributed sum and the wall-clock span,
 *        by design:
 *        (i) null-phase windows — a terminal event clears the phase before the next
 *            phase-opening event, so the window is attributed NOWHERE;
 *        (ii) POLICY UNDERCOUNT (SPECIALISTS-119) — when the only events after the
 *            chosen endpoint are reader-produced, the interval [endpoint,
 *            end-of-stream) is DELIBERATELY left out of BOTH buckets. This is a
 *            visible, intended undercount of wall-clock waiting, not a routing and
 *            not silent; T6c pins the arithmetic (endpoint is the job-produced
 *            sc(waiting) at t=500, so [500, 27,486,949) — 27,486,449 ms — is in
 *            neither bucket);
 *        (iii) I4's backwards-t guard — a span whose end precedes its start.
 *        T13 (stored stream of job 312b6a, shape (i)) in this file: the first
 *        run_complete (t=1782174057770) precedes the next status_change
 *        (t=1782174057928) by 158 ms of null phase, so span 73,615,823 minus
 *        attributed 4,380 + 73,611,285 leaves a residual of exactly 158 ms.
 *        The reference span deliberately does NOT use the stored elapsed_ms:
 *        elapsed_ms is overwritten per run_complete
 *        (`elapsedMs = Math.round(event.elapsed_s * 1000)`) and is incoherent on
 *        multi-round streams (out of scope, SPECIALISTS-94.8/108).
 *   (I1-FLUSH) FLUSH TARGET (DECIDED by SPECIALISTS-119, not inherited): the
 *        post-loop flush closes a still-open phase at the `t` of the LAST
 *        JOB-PRODUCED event. Reader-produced status-load reconciliation evidence
 *        is EXCLUDED from endpoint selection: a `type==='meta'` row carrying
 *        `'status-load'` in `source`, `backend` or `data.component`, or carrying
 *        `model==='status_reconciled'`. Such a row is written by the READER
 *        (`status-load.ts` stamps `t: Date.now()` when a status verb first
 *        observes a terminal run_complete) and its value is the time of the
 *        OPERATOR'S READ, not activation activity; charging it to the open phase
 *        would make `waiting_ms`/`active_runtime_ms` a function of read schedule.
 *        If NO job-produced event exists, the phase is left unflushed rather
 *        than attributed to a reader row; that state is unreachable in practice
 *        because a phase is only opened by run_start / status_change, which are
 *        never reader rows (pinned as a control in T6e).
 *        DIVERGENCE FROM CONTRACT I1: I1 above is stated against the last
 *        PHASE-RELEVANT event; this flush uses the last JOB-PRODUCED event. The
 *        two agree when the last event is phase-relevant and diverge on trailing
 *        non-phase events. The divergence is deliberate: a trailing JOB-PRODUCED
 *        non-phase event (tool, text, payload_breakdown, meta) DOES extend the
 *        endpoint — the phase was genuinely open across that silence — while a
 *        trailing READER row does not.
 *        REJECTED ALTERNATIVE (kept for the record): flush to the last event of
 *        ANY type, as shipped by PR #388. It charges an abandoned activation's
 *        post-last-activity silence up to the next operator status read. Measured
 *        on the authoritative store (`specialist_events MAX(id)`
 *        1,688,620..1,688,904, commit 568170d5): of 271 jobs open at
 *        end-of-stream, 31 carried a reader-row endpoint accounting for
 *        924,277,987 ms (256.74 h) of phase time, 100% of it after the job's last
 *        phase-relevant event, with 0 served metrics rows among them. Worked
 *        example act:00b4a5f9-f6d: the any-type endpoint
 *        t=1788910611599 charges +27,486,449 ms (+7.6351 h) to `waiting_ms`
 *        versus (37417, 1377347) under the chosen endpoint. The rejected
 *        alternative is cheaply reversible (one endpoint predicate) if the
 *        operator disagrees.
 *        Do NOT reverse the flush itself — it is contract-mandated
 *        (T0e-phase-flush.md §5, SPECIALISTS-94 SUCCESS item 2). Only the
 *        endpoint selection is decided here.
 *   (I2) ROUTE: a span opened by run_start / status_change{running} lands in
 *        active_runtime_ms; a span opened by status_change{waiting} lands in
 *        waiting_ms.
 *   (I2-ter) ANTI-NAIVE-FIX (scoped to the chosen endpoint, SPECIALISTS-119): the
 *        flush attributes exactly [phase start, chosen endpoint] (I1-FLUSH), and
 *        that interval lands in the bucket named by the phase that was ACTUALLY
 *        OPEN — never dumped into waiting_ms by default. I2-ter is silent about
 *        [endpoint, end-of-stream): a reader-only tail there is deliberately left
 *        in neither bucket (I1(ii)), not routed.
 *   (I4) CLOCK SANITY: a backwards t hits the closePhase guard
 *        (`endAtMs < phaseStartedAtMs` -> drop) and is PINNED here as a known
 *        wall-clock limitation, not silently fixed.
 *
 * Clocks are EXACT synthetic timestamps injected at event construction (tolerance 0).
 * No sleeps. No Date.now() deltas as oracle.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';
import { mapNativeLifecycleEvent } from '../../../src/specialist/native-activation-observability.js';
import {
  ensureObservabilityDbFile,
  resolveObservabilityDbLocation,
} from '../../../src/specialist/observability-db.js';

type Client = NonNullable<ReturnType<typeof createObservabilitySqliteClientAtPath>>;

let tempRoot: string;
let client: Client | null = null;

beforeEach(() => {
  tempRoot = join(tmpdir(), `test-phase-invariant-${crypto.randomUUID()}`);
  mkdirSync(tempRoot, { recursive: true });
  const location = resolveObservabilityDbLocation(tempRoot);
  ensureObservabilityDbFile(location);
  client = createObservabilitySqliteClientAtPath(location.dbPath);
  expect(client).not.toBeNull();
});

afterEach(() => {
  try { client?.close(); } catch { /* ignore */ }
  client = null;
  rmSync(tempRoot, { recursive: true, force: true });
}

);

function runStart(t: number): Record<string, unknown> {
  return { t, type: 'run_start', specialist: 'executor' };
}

function statusChange(t: number, status: string, previousStatus = 'running'): Record<string, unknown> {
  return { t, type: 'status_change', status, previous_status: previousStatus };
}

function runComplete(t: number, status = 'COMPLETE', elapsed_s = 1): Record<string, unknown> {
  return { t, type: 'run_complete', status, elapsed_s, model: 'test-model' };
}

function toolEvent(t: number): Record<string, unknown> {
  return { t, type: 'tool', tool: 'bash', phase: 'start' };
}

function turnSummary(t: number, turnIndex = 1): Record<string, unknown> {
  return { t, type: 'turn_summary', turn_index: turnIndex };
}

/** The properties `status-load.ts` persists when a status verb first observes a terminal run_complete.
 *  (It also writes job_id, previous_status, next_status, pid, tmux_session and reason.) */
function statusLoadEvent(t: number, eventName: 'status_reconciled' | 'dead_job_detected' = 'status_reconciled'): Record<string, unknown> {
  return {
    t,
    type: 'meta',
    model: eventName,
    backend: 'status-load',
    source: 'status-load',
    data: { component: 'status-load', event: eventName },
  };
}

function payloadBreakdown(t: number): Record<string, unknown> {
  return { t, type: 'payload_breakdown', payload_breakdown: { components: [], totals: { tokens: 0, bytes: 0 } } };
}

function aggregate(jobId: string, events: Array<Record<string, unknown>>): { active: number; waiting: number; elapsed: number | null } {
  const c = client!;
  c.upsertStatus({ id: jobId, specialist: 'executor', status: 'done', started_at_ms: 1, last_event_at_ms: 5 });
  for (const event of events) {
    c.appendEvent(jobId, 'executor', 'bead-1', event as never);
  }
  const metrics = c.aggregateJobMetrics(jobId);
  expect(metrics).not.toBeNull();
  return {
    active: metrics!.active_runtime_ms,
    waiting: metrics!.waiting_ms,
    elapsed: metrics!.elapsed_ms,
  };
}

/** Map one native lifecycle sequence onto timeline events with exact synthetic clocks. */
function mapLifecycle(sequence: Array<{ name: string; t: number }>, startedAtMs: number): Array<Record<string, unknown>> {
  const timeline: Array<Record<string, unknown>> = [];
  for (const { name, t } of sequence) {
    const mapped = mapNativeLifecycleEvent(
      { activationId: 'act:probe', specialist: 'executor', beadId: 'bead-1', name },
      { startedAtMs },
      t,
    );
    if (mapped) timeline.push(mapped as unknown as Record<string, unknown>);
  }
  return timeline;
}

describe('phase-accounting invariant (XTRM-93 N3)', () => {
  it('T1 control — active -> terminal closes by the existing run_complete route', () => {
    const { active, waiting } = aggregate('t1', [runStart(0), runComplete(1000, 'COMPLETE', 1)]);
    expect(active).toBe(1000);
    expect(waiting).toBe(0);
    expect(active + waiting).toBe(1000 - 0);
  });

  it('T2 — active -> waiting -> terminal splits exactly', () => {
    const { active, waiting } = aggregate('t2', [runStart(0), statusChange(400, 'waiting'), runComplete(1000, 'COMPLETE', 1)]);
    expect(active).toBe(400);
    expect(waiting).toBe(600);
    expect(active + waiting).toBe(1000 - 0);
  });

  it('T3 — active -> waiting -> active -> terminal splits exactly', () => {
    const { active, waiting } = aggregate('t3', [
      runStart(0),
      statusChange(200, 'waiting'),
      statusChange(500, 'running', 'waiting'),
      runComplete(1000, 'COMPLETE', 1),
    ]);
    expect(active).toBe(700);
    expect(waiting).toBe(300);
    expect(active + waiting).toBe(1000 - 0);
  });

  it('T5 fail-first (defect 1) — stream ending mid-phase keeps the open waiting interval', () => {
    // run_start(0) opens running; sc(waiting)(500) closes active+=500 and opens waiting;
    // tool/turn_summary events do NOT touch phase; the stream ends with waiting open.
    const { active, waiting, elapsed } = aggregate('t5', [
      runStart(0),
      statusChange(500, 'waiting'),
      toolEvent(700),
      turnSummary(1000),
    ]);
    // B1 false-green demonstration: the OLD acceptance check PASSES on the broken
    // implementation (500 <= 1000) while the I1 equation FAILS (500 != 1000).
    expect(active + waiting).toBeLessThanOrEqual(elapsed ?? 0);
    expect(active).toBe(500);
    expect(waiting).toBe(500);
    expect(active + waiting).toBe(1000 - 0);
  });

  it('T6 fail-first (defect 1 + I2-ter) — stream ending with running open attributes the residual to ACTIVE', () => {
    const { active, waiting } = aggregate('t6', [
      runStart(0),
      statusChange(200, 'waiting'),
      statusChange(400, 'running', 'waiting'),
      toolEvent(1000),
    ]);
    expect(active).toBe(800);
    expect(waiting).toBe(200);
    expect(active + waiting).toBe(1000 - 0);
  });

  it('T6b I2-ter probe — a lone trailing run_start must not be dumped into waiting', () => {
    const { active, waiting } = aggregate('t6b', [runStart(0), toolEvent(500)]);
    expect(active).toBe(500);
    expect(waiting).toBe(0);
    expect(active + waiting).toBe(500 - 0);
  });

  it('T6c fail-first (SPECIALISTS-119) — a trailing READER status-load row does NOT extend the flush', () => {
    // act:00b4a5f9-f6d distilled to synthetic clocks: run_start(0) opens running;
    // sc(waiting)(500) closes active+=500 and opens waiting; the stream's LAST
    // event is the reader's meta/status_reconciled row at t=27,486,949 — the
    // operator's first post-terminal status read, not activation activity.
    // BEFORE the endpoint policy: flush at 27,486,949 -> waiting=27,486,449.
    // AFTER: endpoint is the job-produced sc(waiting)(500) -> waiting=0. The
    // interval [500, 27,486,949) (27,486,449 ms) is deliberately attributed to
    // NEITHER bucket (I1(ii)) — a visible policy undercount of wall-clock waiting.
    const { active, waiting } = aggregate('t6c', [
      runStart(0),
      statusChange(500, 'waiting'),
      statusLoadEvent(27_486_949),
    ]);
    expect(active).toBe(500);
    expect(waiting).toBe(0);
    expect(active + waiting).toBe(500 - 0);
  });

  it('T6d (SPECIALISTS-119) — a trailing JOB-PRODUCED non-phase event STILL extends the flush', () => {
    // A payload_breakdown row is not phase-relevant but IS produced by the
    // activation, so the phase was genuinely open across [500,1000): the endpoint
    // policy must not be misread as "flush to the last phase-relevant event".
    const { active, waiting } = aggregate('t6d', [
      runStart(0),
      statusChange(500, 'waiting'),
      payloadBreakdown(1000),
    ]);
    expect(active).toBe(500);
    expect(waiting).toBe(500);
    expect(active + waiting).toBe(1000 - 0);
  });

  it('T6e (SPECIALISTS-119 edge) — reader rows cannot open or extend a phase; reader-only sub-case is a CONTROL', () => {
    // run_start(0) opens running and is the ONLY job-produced event; every later
    // row is reader-written. The flush endpoint is that run_start, so the phase
    // contributes 0 — it is NOT attributed the reader row's read-time t.
    const onlyReaderAfterOpen = aggregate('t6e-open', [runStart(0), statusLoadEvent(5000)]);
    expect(onlyReaderAfterOpen.active).toBe(0);
    expect(onlyReaderAfterOpen.waiting).toBe(0);
    // CONTROL, not fail-first: the "stream holds no job-produced event at all"
    // state is unreachable because a phase can only be opened by run_start /
    // status_change, which are never reader rows. A whole stream of reader rows
    // therefore opens no phase at all, by construction.
    const readerOnly = aggregate('t6e-reader-only', [statusLoadEvent(1000), statusLoadEvent(2000)]);
    expect(readerOnly.active).toBe(0);
    expect(readerOnly.waiting).toBe(0);
  });

  it('T7 fail-first (defect 3) — a second run_start attributes the prior attempt instead of discarding it', () => {
    // Retry leg: [0,100) active, [100,400) waiting, [400,1000) active. The
    // accumulator is attempt-BLIND (activation-cumulative): it partitions the whole
    // stream exactly once — no double-count, no drop.
    const { active, waiting } = aggregate('t7', [
      runStart(0),
      statusChange(100, 'waiting'),
      runStart(400),
      runComplete(1000, 'COMPLETE', 0.6),
    ]);
    expect(active).toBe(700);
    expect(waiting).toBe(300);
    expect(active + waiting).toBe(1000 - 0);
  });

  it('T7b native-fallback shape — activation_started re-emission maps to run_start (native-host.ts model-fallback path)', () => {
    const mapped = mapNativeLifecycleEvent(
      { activationId: 'act:probe', specialist: 'executor', beadId: 'bead-1', name: 'activation_started', payload: { pi_session_id: 'sess-2' } },
      { startedAtMs: 0 },
      400,
    );
    expect(mapped).not.toBeNull();
    expect(mapped!.type).toBe('run_start');
    const second = { ...(mapped as unknown as Record<string, unknown>), t: 400 };
    const { active, waiting } = aggregate('t7b', [
      runStart(0),
      statusChange(100, 'waiting'),
      second,
      runComplete(1000, 'COMPLETE', 0.6),
    ]);
    expect(active).toBe(700);
    expect(waiting).toBe(300);
  });

  it('T8 — failure (run_complete ERROR) closes phases exactly like COMPLETE', () => {
    const { active, waiting } = aggregate('t8', [
      runStart(0),
      statusChange(300, 'waiting'),
      runComplete(1000, 'ERROR', 1),
    ]);
    expect(active).toBe(300);
    expect(waiting).toBe(700);
    expect(active + waiting).toBe(1000 - 0);
  });

  it('T9 control — stop (status_change cancelled) closes by the existing terminal route', () => {
    const { active, waiting } = aggregate('t9', [runStart(0), statusChange(600, 'cancelled')]);
    expect(active).toBe(600);
    expect(waiting).toBe(0);
    expect(active + waiting).toBe(600 - 0);
  });

  it('T10 (I4) — backwards t drops the open interval: PINNED known wall-clock limitation', () => {
    // sc(waiting) at t=300 while running opened at t=500: the closePhase guard
    // (endAtMs < phaseStartedAtMs) returns before adding anything, so the running
    // interval is discarded — numerically indistinguishable from a missing flush.
    // Pinned, not fixed: no monotonic source exists for timing (performance.now is
    // filename-only; no process.hrtime), and this node must not introduce one.
    const { active, waiting } = aggregate('t10', [
      runStart(500),
      statusChange(300, 'waiting'),
      runComplete(1000, 'ERROR', 0.5),
    ]);
    expect(active).toBe(0);
    expect(waiting).toBe(700);
  });

  it('T11 (I4) — forwards t inflates exactly one phase: PINNED known wall-clock limitation', () => {
    const { active, waiting } = aggregate('t11', [
      runStart(0),
      statusChange(5000, 'waiting'),
      runComplete(6000, 'COMPLETE', 6),
    ]);
    expect(active).toBe(5000);
    expect(waiting).toBe(1000);
  });

  it('T12 negative control — retry, stale_warning and token_usage never move phases; residual is zero by construction', () => {
    const { active, waiting } = aggregate('t12', [
      runStart(0),
      { t: 100, type: 'retry', phase: 'start', attempt: 1 } as unknown as Record<string, unknown>,
      { t: 200, type: 'stale_warning', reason: 'tool_duration', silence_ms: 9000, threshold_ms: 5000, tool: 'read' } as unknown as Record<string, unknown>,
      statusChange(400, 'waiting'),
      { t: 500, type: 'token_usage', token_usage: { input_tokens: 1 }, source: 'turn_end' } as unknown as Record<string, unknown>,
      runComplete(1000, 'COMPLETE', 1),
    ]);
    expect(active).toBe(400);
    expect(waiting).toBe(600);
    expect(active + waiting).toBe(1000 - 0);
  });

  it('T13 empirical cross-check — stored stream of job 312b6a reproduces its stored row exactly', () => {
    // Read-only measurement of the authoritative store: 312b6a holds stored
    // active=4380, waiting=73611285, elapsed=10000 (the elapsed overwrite is the
    // SPECIALISTS-94.8/108 defect: last run_complete elapsed_s=10 — now fixed by
    // accumulation, so this expectation carries the fixed value 20000 = 10s + 10s).
    // Hand-applying the phase algorithm to the stored (seq,t,type) stream must
    // reproduce the stored row. Caveat: one case, not a property test.
    const { active, waiting, elapsed } = aggregate('job-312b6a', [
      runStart(1782174047571),
      { t: 1782174051931, type: 'retry', phase: 'start', attempt: 1 } as unknown as Record<string, unknown>,
      statusChange(1782174051951, 'waiting'),
      runComplete(1782174057770, 'COMPLETE', 10),
      statusChange(1782174057928, 'waiting', 'running'),
      statusChange(1782174059970, 'waiting', 'running'),
      statusChange(1782174069232, 'waiting', 'running'),
      { t: 1782174137967, type: 'stale_warning', reason: 'running_silence', silence_ms: 68726, threshold_ms: 60000 } as unknown as Record<string, unknown>,
      runComplete(1782247663394, 'COMPLETE', 10),
    ]);
    expect(active).toBe(4380);
    expect(waiting).toBe(73611285);
    // SPECIALISTS-108: both rounds' elapsed_s=10 now accumulate (was: last wins).
    expect(elapsed).toBe(20000);
  });

  it('EQ1 — contract worked equation: two phases partition exactly (active 50000, waiting 20000)', () => {
    // run_start(0) -> sc(waiting)(20000) -> sc(running)(40000) -> run_complete(70000).
    // The contract text elides the middle transition ("turn events(20..50)"); this is
    // the fully-explicit stream its expected pair (50000, 20000) describes.
    const { active, waiting } = aggregate('eq1', [
      runStart(0),
      statusChange(20000, 'waiting'),
      statusChange(40000, 'running', 'waiting'),
      runComplete(70000, 'COMPLETE', 70),
    ]);
    expect(active).toBe(50000);
    expect(waiting).toBe(20000);
    expect(active + waiting).toBe(70000 - 0);
  });

  it('EQ2 — contract worked equation: stream ending right after re-entry proves the flush (active 20000, waiting 0)', () => {
    const { active, waiting } = aggregate('eq2', [runStart(0), statusChange(20000, 'running', 'waiting')]);
    expect(active).toBe(20000);
    expect(waiting).toBe(0);
  });

  it('EQ3 — contract worked equation: flush attributed to the open WAITING phase (active 20000, waiting 80000)', () => {
    const { active, waiting } = aggregate('eq3', [
      runStart(0),
      statusChange(20000, 'waiting'),
      { t: 100000, type: 'stale_warning', reason: 'tool_duration', silence_ms: 9000, threshold_ms: 5000, tool: 'read' } as unknown as Record<string, unknown>,
    ]);
    expect(active).toBe(20000);
    expect(waiting).toBe(80000);
    expect(active + waiting).toBe(100000 - 0);
  });

  it('EQ4 — contract worked equation: [0,400) across a retry boundary is attributed, not discarded', () => {
    const { active, waiting } = aggregate('eq4', [
      runStart(0),
      statusChange(100000, 'waiting'),
      runStart(400000),
      runComplete(1000000, 'COMPLETE', 600),
    ]);
    expect(active).toBe(700000);
    expect(waiting).toBe(300000);
    expect(active + waiting).toBe(1000000 - 0);
  });
});

describe('resume re-entry seam (defect 2)', () => {
  it('mapper — activation_resumed re-enters running via the shared status_change vocabulary', () => {
    const mapped = mapNativeLifecycleEvent(
      { activationId: 'act:probe', specialist: 'executor', beadId: 'bead-1', name: 'activation_resumed' },
      { startedAtMs: 0 },
      500,
    );
    expect(mapped).not.toBeNull();
    expect(mapped!.type).toBe('status_change');
    expect((mapped as unknown as { status: string }).status).toBe('running');
  });

  it('mapper controls — settled still opens waiting; started still opens the run; unknown still drops', () => {
    const settled = mapNativeLifecycleEvent(
      { activationId: 'act:probe', specialist: 'executor', name: 'activation_settled' },
      { startedAtMs: 0 },
      400,
    );
    expect(settled!.type).toBe('status_change');
    expect((settled as unknown as { status: string }).status).toBe('waiting');
    const started = mapNativeLifecycleEvent(
      { activationId: 'act:probe', specialist: 'executor', name: 'activation_started' },
      { startedAtMs: 0 },
      0,
    );
    expect(started!.type).toBe('run_start');
    expect(mapNativeLifecycleEvent(
      { activationId: 'act:probe', specialist: 'executor', name: 'no_such_signal' },
      { startedAtMs: 0 },
      0,
    )).toBeNull();
  });

  it('I1 VACUITY — the partition identity HOLDS on the unfixed pipeline for a bracketed resume stream', () => {
    // run_start -> settle -> resume -> settle -> terminal, bracketed by run_start and
    // run_complete: the loop's own call sites close every phase the loop knows about,
    // so active + waiting == t_n - t_0 EVEN WHEN the resumed leg is misclassified.
    // An identity-only test is therefore a false green; I2 below is the clause that fails.
    const timeline = mapLifecycle([
      { name: 'activation_started', t: 0 },
      { name: 'activation_settled', t: 400 },
      { name: 'activation_resumed', t: 500 },
      { name: 'activation_completed', t: 1000 },
    ], 0);
    const { active, waiting } = aggregate('vacuity', timeline);
    expect(active + waiting).toBe(1000 - 0);
  });

  it('I2 catches what I1 cannot — the resumed leg lands in ACTIVE, not waiting', () => {
    const timeline = mapLifecycle([
      { name: 'activation_started', t: 0 },
      { name: 'activation_settled', t: 400 },
      { name: 'activation_resumed', t: 500 },
      { name: 'activation_completed', t: 1000 },
    ], 0);
    const { active, waiting } = aggregate('resume-route', timeline);
    // [0,400) active + [500,1000) resumed-active; [400,500) settled-waiting.
    expect(active).toBe(900);
    expect(waiting).toBe(100);
    expect(active + waiting).toBe(1000 - 0);
  });
});
