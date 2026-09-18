#!/usr/bin/env python3
"""Corpus impact of the proposed flush-endpoint policy: endpoint = last JOB-produced event
(reader-produced status-load reconciliation rows excluded). Read-only."""
import sqlite3, json, collections, re

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

def calc(evs, flush_to='none'):
    """flush_to: 'none' = pre-fix; 'any' = current post-fix; 'job' = proposed (skip reader rows)."""
    phase = start = None; active = waiting = 0
    def close(t):
        nonlocal active, waiting
        if phase is None or start is None or t < start: return
        if phase == 'running': active += t - start
        else: waiting += t - start
    for t, etype, ej in evs:
        if etype == 'run_start':
            close(t); phase, start = 'running', t; continue
        if etype == 'status_change':
            try: s = json.loads(ej).get('status')
            except Exception: s = None
            if s in ('running','waiting'): close(t); phase, start = s, t
            elif s in ('done','error','cancelled'): close(t); phase = start = None
            continue
        if etype == 'run_complete':
            close(t); phase = start = None; continue
    if flush_to == 'any' and evs:
        close(evs[-1][0])
    elif flush_to == 'job':
        for t, etype, ej in reversed(evs):
            if not is_reader(etype, ej):
                close(t); break
    return active, waiting

store = {r[0]: (r[1], r[2]) for r in con.execute("SELECT job_id, active_runtime_ms, waiting_ms FROM specialist_job_metrics")}
mx_pre = mx_any = mx_job = 0
chg_any = chg_job = []
for job, evs in byjob.items():
    pre = calc(evs, 'none'); any_ = calc(evs, 'any'); jobp = calc(evs, 'job')
    st = store.get(job)
    if st is not None:
        if pre == st: mx_pre += 1
    if pre != any_: chg_any.append((job, pre, any_, st))
    if pre != jobp: chg_job.append((job, pre, jobp, st))

print("DEBUG len(byjob)=",len(byjob),"len(chg_any)=",len(chg_any),"unique=",len(set(j for j,*_ in chg_any)))
print(f"stored metrics rows: {len(store)}; pre-fix model reproduces {mx_pre} of them")
print(f"jobs changed, CURRENT model (flush to last event of any type): {len(chg_any)}")
print(f"jobs changed, PROPOSED model (flush to last job-produced event): {len(chg_job)}")
sa = [d for d in chg_any if d[3] is not None]; sj = [d for d in chg_job if d[3] is not None]
print(f"  of those, rows WITH a stored metrics row: current={len(sa)} proposed={len(sj)}")
def mag(d): return abs(d[2][0]-d[1][0]) + abs(d[2][1]-d[1][1])
for label, s in (("current", sa), ("proposed", sj)):
    if s:
        m = [mag(d) for d in s]
        zero = [d for d in s if d[3] == (0, 0)]
        print(f"  {label}: n={len(s)} min_delta={min(m)} ms max_delta={max(m)} ms; stored (0,0): {len(zero)}, stored non-zero: {len(s)-len(zero)}")
        print(f"    total delta ms = {sum(d[2][0]-d[1][0] + d[2][1]-d[1][1] for d in s):,}")
print("\nthe 29 rows-with-stored-row set under each model:")
for job, pre, any_, st in sorted(sa, key=lambda d: -mag(d))[:31]:
    jobp = calc(byjob[job], 'job')
    print(f"  {job[:12]:12} stored={st} pre={pre} current={any_} proposed={jobp}")
con.close()
