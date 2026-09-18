#!/usr/bin/env python3
"""Classify the post-loop flush endpoint per job. Read-only."""
import sqlite3, json, collections

con = sqlite3.connect("file:/home/dawid/dev/specialists/.specialists/db/observability.db?mode=ro", uri=True)
con.execute("PRAGMA query_only=1")

byjob = collections.defaultdict(list)
last = {}
for job, t, typ, ej in con.execute("SELECT job_id, t, type, event_json FROM specialist_events ORDER BY job_id, seq, id"):
    byjob[job].append((t, typ, ej if typ in ('status_change','meta') else None))
    last[job] = (t, typ, ej)

def open_phase_at_end(evs):
    ph = start = None
    for t, etype, ej in evs:
        if etype == 'run_start': ph, start = 'running', t
        elif etype == 'status_change':
            try: s = json.loads(ej).get('status')
            except Exception: s = None
            if s in ('running', 'waiting'): ph, start = s, t
            elif s in ('done', 'error', 'cancelled'): ph = start = None
        elif etype == 'run_complete': ph = start = None
    return ph, start

def last_phase_relevant_t(evs):
    t_last = None
    for t, etype, ej in evs:
        if etype in ('run_start', 'run_complete'): t_last = t
        elif etype == 'status_change':
            try: s = json.loads(ej).get('status')
            except Exception: s = None
            if s in ('running','waiting','done','error','cancelled'): t_last = t
    return t_last

def is_reader_row(typ, ej):
    if typ != 'meta' or not ej: return False
    try: d = json.loads(ej)
    except Exception: return False
    data = d.get('data') if isinstance(d.get('data'), dict) else {}
    blob = ' '.join(str(x) for x in (d.get('source'), d.get('backend'), d.get('model'), data.get('component'), data.get('event')))
    return 'status-load' in blob or 'status_reconciled' in blob

cats = collections.Counter(); flush_ms = collections.Counter()
readtime = []
openj = 0
for job, evs in byjob.items():
    ph, start = open_phase_at_end(evs)
    if ph is None: continue
    openj += 1
    t_last, typ, ej = last[job]
    contrib = max(0, t_last - start) if start is not None else 0
    reader = is_reader_row(typ, ej)
    key = f"{ph}/{'READER-status-load' if reader else typ}"
    cats[key] += 1; flush_ms[key] += contrib
    if reader:
        pr = last_phase_relevant_t(evs)
        readtime.append((job, ph, contrib, (t_last - pr) if pr else 0))

print(f"jobs with a phase OPEN at end-of-stream: {openj}")
print("\n== by (open phase / flush-endpoint kind) ==")
for k, v in cats.most_common():
    print(f"  {k:30} jobs={v:5}  total_attributed_ms={flush_ms[k]:,}")
tot = sum(c for _,_,c,_ in readtime)
print(f"\n== endpoint is a READER-produced status-load row ==")
print(f"  jobs={len(readtime)}  total_attributed_ms={tot:,}  ({tot/3600000:.2f} h)")
print(f"  pure read-timing (after last phase-relevant event): {sum(r for _,_,_,r in readtime):,} ms")
readtime.sort(key=lambda x: -x[2])
for job, ph, c, tail in readtime[:8]:
    print(f"    {job[:34]:34} phase={ph:8} attributed={c:>12,}  tail_after_last_phase_event={tail:,}")
con.close()
