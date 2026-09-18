#!/usr/bin/env python3
"""Corpus impact of the proposed flush-endpoint policy. Read-only.
Models:
  PRE  = pre-#388: no run_start close, no post-loop flush
  CUR  = shipped #388: run_start close + flush to last event of ANY type
  PROP = proposed:      run_start close + flush to last JOB-PRODUCED event
                        (reader-written status-load reconciliation rows excluded from the endpoint)
"""
import sqlite3, json, collections

con = sqlite3.connect("file:/home/dawid/dev/specialists/.specialists/db/observability.db?mode=ro", uri=True)
con.execute("PRAGMA query_only=1")
byjob = collections.defaultdict(list)
for job, t, typ, ej in con.execute("SELECT job_id, t, type, event_json FROM specialist_events ORDER BY job_id, seq, id"):
    byjob[job].append((t, typ, ej))

def is_reader(typ, ej):
    if typ != 'meta': return False
    try: d = json.loads(ej)
    except Exception: return False
    data = d.get('data') if isinstance(d.get('data'), dict) else {}
    blob = ' '.join(str(x) for x in (d.get('source'), d.get('backend'), d.get('model'), data.get('component')))
    return 'status-load' in blob or 'status_reconciled' in blob

def calc(evs, close_on_run_start, flush):
    phase = start = None; active = waiting = 0
    def close(t):
        nonlocal active, waiting
        if phase is None or start is None or t < start: return
        if phase == 'running': active += t - start
        else: waiting += t - start
    for t, etype, ej in evs:
        if etype == 'run_start':
            if close_on_run_start: close(t)
            phase, start = 'running', t; continue
        if etype == 'status_change':
            try: s = json.loads(ej).get('status')
            except Exception: s = None
            if s in ('running','waiting'): close(t); phase, start = s, t
            elif s in ('done','error','cancelled'): close(t); phase = start = None
            continue
        if etype == 'run_complete':
            close(t); phase = start = None; continue
    if flush == 'any' and evs: close(evs[-1][0])
    elif flush == 'job':
        for t, etype, ej in reversed(evs):
            if not is_reader(etype, ej): close(t); break
    return active, waiting

store = {r[0]: (r[1], r[2]) for r in con.execute("SELECT job_id, active_runtime_ms, waiting_ms FROM specialist_job_metrics")}
rows = {}
for job, evs in byjob.items():
    rows[job] = (calc(evs, False, 'none'), calc(evs, True, 'any'), calc(evs, True, 'job'))

def report(label, col):
    changed = [(j, r) for j, r in rows.items() if r[0] != r[col]]
    stored = [(j, r) for j, r in changed if j in store]
    tot = sum(r[col][0]-r[0][0] + r[col][1]-r[0][1] for _, r in changed)
    mags = [abs(r[col][0]-r[0][0]) + abs(r[col][1]-r[0][1]) for _, r in stored] or [0]
    z = sum(1 for _, r in stored if store[_].__class__ and store[_] == (0,0))
    nz = len(stored) - z
    print(f"{label}:")
    print(f"  jobs changed vs PRE: {len(changed)}  (total delta {tot:,} ms)")
    print(f"  of those, rows WITH a stored metrics row: {len(stored)}  [stored (0,0): {z}, stored non-zero: {nz}]")
    print(f"  stored-row delta range: {min(mags)} ms .. {max(mags)} ms")
    return changed, stored

c_cur, s_cur = report("CURRENT (#388: flush to last event of ANY type)", 1)
c_prop, s_prop = report("PROPOSED (flush to last JOB-PRODUCED event)", 2)

moved = [(j, r) for j, r in rows.items() if r[1] != r[2]]
removed = sum(r[1][0]-r[2][0] + r[1][1]-r[2][1] for _, r in moved)
stored_moved = [(j, r) for j, r in moved if j in store]
print(f"\nPROPOSED vs CURRENT: jobs whose (active,waiting) pair moves: {len(moved)}")
print(f"  total ms removed from the two buckets: {removed:,} ({removed/3600000:.2f} h)")
print(f"  of those, rows WITH a stored metrics row: {len(stored_moved)}")
for j, r in sorted(moved, key=lambda d: -abs(d[1][1][0]-d[1][2][0])-abs(d[1][1][1]-d[1][2][1]))[:6]:
    print(f"    {j[:30]:30} cur={r[1]} prop={r[2]} stored={store.get(j)}")
print("\nact: jobs affected by the proposed change:")
for j, r in moved:
    if j.startswith('act:'):
        print(f"    {j[:30]:30} cur={r[1]} prop={r[2]}")
con.close()
