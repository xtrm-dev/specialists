#!/usr/bin/env python3
"""Read-only Lane D phase-accounting corpus reproduction for the XTRM-93 N3 freeze receipt."""
import sqlite3, json, collections, re, sys, time

DB = "file:/home/dawid/dev/specialists/.specialists/db/observability.db?mode=ro"
EPOCH_MS = int(sys.argv[1]) if len(sys.argv) > 1 else None
con = sqlite3.connect(DB, uri=True)
con.execute("PRAGMA query_only=1")

print("== snapshot markers (measurement epoch: %s) ==" % time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
print("  events MAX(id),MAX(t):", con.execute("SELECT MAX(id),MAX(t) FROM specialist_events").fetchone())
print("  forensic MAX(id),MAX(t):", con.execute("SELECT MAX(id),MAX(t) FROM specialist_forensic_events").fetchone())
for label, sql in [
    ("specialist_jobs", "SELECT COUNT(*) FROM specialist_jobs"),
    ("specialist_jobs act:", "SELECT COUNT(*) FROM specialist_jobs WHERE job_id LIKE 'act:%'"),
    ("specialist_events", "SELECT COUNT(*) FROM specialist_events"),
    ("specialist_events act:", "SELECT COUNT(*) FROM specialist_events WHERE job_id LIKE 'act:%'"),
    ("distinct job_id events", "SELECT COUNT(DISTINCT job_id) FROM specialist_events"),
    ("specialist_forensic_events", "SELECT COUNT(*) FROM specialist_forensic_events"),
    ("distinct job_id forensic", "SELECT COUNT(DISTINCT job_id) FROM specialist_forensic_events"),
    ("metrics rows", "SELECT COUNT(*) FROM specialist_job_metrics"),
    ("metrics act:", "SELECT COUNT(*) FROM specialist_job_metrics WHERE job_id LIKE 'act:%'"),
    ("metrics SERVED nonzero", "SELECT COUNT(*) FROM specialist_job_metrics WHERE active_runtime_ms!=0 OR waiting_ms!=0"),
    ("metrics zero-zero", "SELECT COUNT(*) FROM specialist_job_metrics WHERE active_runtime_ms=0 AND waiting_ms=0"),
    ("metrics zero-zero elapsed>0", "SELECT COUNT(*) FROM specialist_job_metrics WHERE active_runtime_ms=0 AND waiting_ms=0 AND elapsed_ms>0"),
    ("metrics without events", "SELECT COUNT(*) FROM specialist_job_metrics m WHERE NOT EXISTS (SELECT 1 FROM specialist_events e WHERE e.job_id=m.job_id)"),
]:
    print(f"  {label}: {con.execute(sql).fetchone()[0]}")

def phase_calc(events, flush, close_on_run_start):
    phase = start = None; active = waiting = 0
    def close(t):
        nonlocal active, waiting
        if phase is None or start is None or t < start: return
        if phase == 'running': active += t - start
        else: waiting += t - start
    for t, etype, ej in events:
        if etype == 'run_start':
            if close_on_run_start: close(t)
            phase, start = 'running', t; continue
        if etype == 'status_change':
            try: st = json.loads(ej).get('status')
            except Exception: st = None
            if st in ('running', 'waiting'): close(t); phase, start = st, t; continue
            if st in ('done', 'error', 'cancelled'): close(t); phase = start = None
            continue
        if etype == 'run_complete':
            close(t); phase = start = None; continue
    if flush and events: close(events[-1][0])
    return active, waiting

t0 = time.time()
byjob = collections.defaultdict(list)
for row in con.execute("SELECT job_id, t, type, CASE WHEN type='status_change' THEN event_json ELSE NULL END FROM specialist_events ORDER BY job_id, seq, id"):
    byjob[row[0]].append((row[1], row[2], row[3]))
print("  loaded %d jobs / %d events in %.1fs" % (len(byjob), sum(len(v) for v in byjob.values()), time.time()-t0))

if EPOCH_MS is not None:
    byjob = {j: e for j, e in byjob.items() if max(x[0] for x in e) < EPOCH_MS}

store = {r[0]: (r[1], r[2]) for r in con.execute("SELECT job_id, active_runtime_ms, waiting_ms FROM specialist_job_metrics")}

def cls(j):
    if j.startswith('act:'): return 'act'
    if re.fullmatch(r'[0-9a-f]{6}', j) or j.startswith(('job-', 'probe')): return 'test-shaped'
    return 'legacy-other'

changed, openph, postterm, multi = [], collections.Counter(), 0, 0
match_pre = mismatch_pre = 0
for job, evs in byjob.items():
    a0, w0 = phase_calc(evs, False, False)
    a1, w1 = phase_calc(evs, True, True)
    if (a0, w0) != (a1, w1): changed.append((job, a0, w0, a1, w1))
    if sum(1 for _, ty, _ in evs if ty == 'run_start') > 1: multi += 1
    st = store.get(job)
    if st is not None:
        if (a0, w0) == st: match_pre += 1
        else: mismatch_pre += 1
    ph = start = None
    for t, etype, ej in evs:
        if etype == 'run_start': ph, start = 'running', t
        elif etype == 'status_change':
            try: s = json.loads(ej).get('status')
            except Exception: s = None
            if s in ('running', 'waiting'): ph, start = s, t
            elif s in ('done', 'error', 'cancelled'): ph = start = None
        elif etype == 'run_complete': ph = start = None
    if ph is not None: openph[ph] += 1
    term = False
    for t, etype, ej in evs:
        if etype == 'run_complete': term = True; continue
        if etype == 'status_change':
            try: s = json.loads(ej).get('status')
            except Exception: s = None
            if s in ('done', 'error', 'cancelled'): term = True; continue
            if term and s in ('running', 'waiting'): postterm += 1; break

print("\n== population / deltas ==")
print("jobs scanned:", len(byjob))
print("jobs where post-fix (active,waiting) != pre-fix:", len(changed))
print("changed by class:", dict(collections.Counter(cls(j) for j, *_ in changed)))
print("jobs with >1 run_start:", multi)
print("jobs whose phase is OPEN at end-of-stream (post-fix):", sum(openph.values()), dict(openph))
print("jobs with a phase-opening status_change AFTER a terminal event:", postterm)
print(f"stored metrics rows: {len(store)}; sim PREFIX==stored {match_pre} / != {mismatch_pre}")
print("changed AND has stored metrics row:", sum(1 for j, *_ in changed if j in store))
print("TOTAL delta over changed jobs: active %+d ms, waiting %+d ms" % (
    sum(d[3]-d[1] for d in changed), sum(d[4]-d[2] for d in changed)))

served = [d for d in changed if d[0] in store]
if served:
    mags = [abs(d[3]-d[1]) + abs(d[4]-d[2]) for d in served]
    print(f"changed-with-stored-row: count={len(served)} min_delta={min(mags)} ms max_delta={max(mags)} ms")
    storezero = [d for d in served if store[d[0]] == (0, 0)]
    storenonzero = [d for d in served if store[d[0]] != (0, 0)]
    print(f"  of those, stored (0,0): {len(storezero)}; stored non-zero (genuinely SERVED): {len(storenonzero)}")

changed.sort(key=lambda d: -(abs(d[3]-d[1]) + abs(d[4]-d[2])))
print("\ntop 12 changed jobs:")
print("act: changed jobs:"); [print(f"  {job[:30]:30} {a0:>10} {w0:>12} | {a1:>10} {w1:>12} | {a1-a0:+10} {w1-w0:+12} stored={store.get(job)}") for job, a0, w0, a1, w1 in changed if job.startswith("act:")]
print("\nall changed rows WITH a stored metrics row:")
for job, a0, w0, a1, w1 in [d for d in changed if d[0] in store]:
    print(f"  {job[:34]:34} {a0:>10} {w0:>12} | {a1:>10} {w1:>12} | {a1-a0:+10} {w1-w0:+12} stored={store.get(job)}")
