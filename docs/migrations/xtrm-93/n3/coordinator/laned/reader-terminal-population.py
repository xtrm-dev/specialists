#!/usr/bin/env python3
"""Reader-terminal population: jobs whose last event is a reader-produced status-load row.

Backs the figure cited in SPECIALISTS-119 (the policy truncates the flush endpoint at the last
job-produced event, so this population's tail lies beyond the endpoint) and the divergence note in
src/specialist/observability-sqlite.ts. Read-only: opens the store with mode=ro and query_only=1.

Usage: python3 reader-terminal-population.py
"""
import collections
import json
import sqlite3

DB = "/home/dawid/dev/specialists/.specialists/db/observability.db"

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
con.execute("PRAGMA query_only=1")

epoch = list(con.execute("SELECT MAX(id) FROM specialist_events"))[0][0]
print(f"epoch specialist_events MAX(id) = {epoch}")

reader_rows = list(
    con.execute(
        """SELECT json_extract(event_json,'$.model')
             FROM specialist_events
            WHERE type='meta'
              AND (json_extract(event_json,'$.source')='status-load'
                OR json_extract(event_json,'$.backend')='status-load'
                OR json_extract(event_json,'$.model')='status_reconciled'
                OR json_extract(event_json,'$.data.component')='status-load')"""
    )
)
kinds = collections.Counter(r[0] for r in reader_rows)
print(f"reader rows matching the predicate: {len(reader_rows)} {dict(kinds)}")

metrics = {
    r[0]: r
    for r in con.execute(
        "SELECT job_id, completed_at_ms, elapsed_ms, active_runtime_ms, waiting_ms FROM specialist_job_metrics"
    )
}


def is_reader(event_type, event_json):
    if event_type != "meta":
        return False
    try:
        d = json.loads(event_json)
    except Exception:
        return False
    if not isinstance(d, dict):
        return False
    data = d.get("data") if isinstance(d.get("data"), dict) else {}
    return (
        d.get("source") == "status-load"
        or d.get("backend") == "status-load"
        or d.get("model") == "status_reconciled"
        or data.get("component") == "status-load"
    )


by_job = collections.defaultdict(list)
for job, t, typ, ej in con.execute(
    "SELECT job_id, t, type, event_json FROM specialist_events ORDER BY job_id, seq, id"
):
    by_job[job].append((t, typ, ej))

affected = []
for job, events in by_job.items():
    if not events:
        continue
    last_any_t = events[-1][0]
    last_job_t = None
    for t, typ, ej in reversed(events):
        if not is_reader(typ, ej):
            last_job_t = t
            break
    if last_job_t is None or last_job_t == last_any_t:
        continue
    affected.append((job, last_job_t, last_any_t, last_any_t - last_job_t, metrics.get(job)))

tail = sum(a[3] for a in affected)
print(f"jobs whose trailing event is reader-produced: {len(affected)}")
print(f"truncated tail beyond the endpoint: {tail:,} ms ({tail / 3_600_000:.2f} h)")

absorbed = [a for a in affected if a[4] and a[4][1] is not None and a[4][1] >= a[2]]
print(
    "jobs whose stored completed_at_ms is at or after the trailing reader row "
    f"(elapsed_ms still absorbing read latency): {len(absorbed)}"
)
