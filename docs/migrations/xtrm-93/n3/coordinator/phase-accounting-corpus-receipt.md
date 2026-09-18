# Lane D — phase-accounting corpus provenance receipt

Status: coordinator receipt for the SPECIALISTS-119 phase-accounting policy decision.
Owner: coordinator `xt-pi-osz3`. Tracker: Substrate epic `SPECIALISTS-94`.

This receipt states what the phase-accounting numbers are, where they come from, what they can
support, and what they cannot. Read it before quoting any phase-accounting figure as evidence.

## 1. Purpose and scope

SPECIALISTS-119 (rev 2) sets the flush-endpoint policy for phase accounting:

> The flush endpoint is the last job-produced event. Reader-produced `status-load`
> reconciliation rows do not close a phase.

The measurements below establish the corpus facts behind that policy. They do not establish that
the stored timings describe real wall-clock work. Section 5 states that limit.

Scope of this receipt: the N3 phase-accounting decision only. It is not a general audit of the
observability store.

## 2. Corpus identity and measurement boundary

All measurements read the live authoritative store:

```
/home/dawid/dev/specialists/.specialists/db/observability.db
```

Identity recorded at read time (2026-09-18T00:12Z):

| Field | Value |
|---|---|
| `sha256(observability.db)` | `cbf5801d3c507485c7f142e3311b1053973560676816517209c5373480741a4b` |
| main file size | 1,688,100,864 bytes |
| WAL size (`-wal`) | 39,490,232 bytes |
| `specialist_events` rows | 1,700,512 → 1,701,160 → `MAX(id)` 1,705,791 across three reads in one session |
| `specialist_jobs` rows | 4,479 |
| `specialist_job_metrics` rows | 2,827 (one per job that has metrics): 2,707 non-zero — the served population — and 120 stored `(0, 0)` |
| `specialist_forensic_events` rows | 807,242 |
| epoch | `specialist_events MAX(id)` 1,705,791 at the last read |

Record the epoch with any figure quoted from here. The earlier revision-2 contract measurements were taken at
`MAX(id)` 1,688,620..1,688,904 on commit `568170d5`; this receipt is roughly 17,000 events later on the same
store, so the two are not interchangeable.

The hash covers the main database file only. It does not cover the 39 MB write-ahead log, and it
does not cover the metrics rows a future reader will see. Two reads minutes apart already differ
(section 4). Treat the hash as a fingerprint of one read, not as a frozen corpus version.

The store is live during this programme. A reader therefore observes a snapshot that moves under
it. Every number in this receipt is point-in-time.

## 3. Method

Scripts (coordinator-owned, read-only), committed beside this receipt for durability:

```
docs/migrations/xtrm-93/n3/coordinator/laned/laned.py    # per-job phase accounting, pre-fix / current / proposed
docs/migrations/xtrm-93/n3/coordinator/laned/laned3.py   # endpoint-kind breakdown for jobs whose endpoint is a reader row
docs/migrations/xtrm-93/n3/coordinator/laned/laned4.py   # job-by-job comparison, stored-metrics join
docs/migrations/xtrm-93/n3/coordinator/laned/policy.py   # policy comparison: PRE vs CURRENT vs PROPOSED
```

They were originally run from `/tmp/n3freeze/`; that copy is not durable, these are. `laned2.py` (event-shape
inventory) was an intermediate probe and is not committed.

Every script opens the store with `file:...?mode=ro`, sets `PRAGMA query_only=1`, and never calls
a mutating statement. The executor specialists were denied store access entirely (sandbox
prohibition); the coordinator performed all reads.

Reader-row classification: a `meta` event is a reader row when its JSON exposes `status-load` or
`status_reconciled` in `source`, `backend`, `model`, or `data.component`.

Storage join: a job's stored metrics are `specialist_job_metrics(job_id, active_runtime_ms, waiting_ms)`.
That table holds 2,827 rows for 4,479 jobs, so most jobs have no stored metrics row.

## 4. Measurements

### 4.1 Policy comparison (`policy.py`)

| Comparison | Jobs changed | Total delta | Jobs with a stored metrics row | Stored-row delta range |
|---|---|---|---|---|
| CURRENT (#388: flush to last event of any type) vs PRE | 214 | 1,038,583,621 ms (~288.5 h) | 29 — all stored `(0, 0)`, none non-zero | 1,460 ms .. 539,983 ms |
| PROPOSED (flush to last job-produced event) vs PRE | 185 | 114,305,634 ms (~31.75 h) | 29 — all stored `(0, 0)`, none non-zero | 1,460 ms .. 539,983 ms |
| PROPOSED vs CURRENT | 31 | **924,277,987 ms (256.74 h) removed** | **0** | — |

The decisive line is the last one: the proposed policy removes 924,277,987 ms from the two phase
buckets, and **not one millisecond of that lands on a job that has a stored metrics row**. The
stored-metrics delta range is identical (1,460 ms .. 539,983 ms) under both policies, which is what
"stored rows do not move" means as executed evidence rather than as assertion.

The served population is 2,707 non-zero `specialist_job_metrics` rows. It moves zero rows under
the proposed policy. All 29 affected jobs that have any stored row are inside the 120 stored
`(0, 0)` rows, so the exclusion cannot move a served number.

### 4.2 Endpoint-kind breakdown (`laned3.py`)

| Open phase / endpoint kind | Jobs | Attributed |
|---|---|---|
| running / READER-status-load | 19 | 446,168,379 ms |
| waiting / READER-status-load | 12 | 478,115,868 ms |
| running / payload_breakdown | 137 | 212,334 ms |
| running / tool | 13 | 608,369 ms |
| running / thinking | 8 | 422,902 ms |
| running / text | 5 | 590,396 ms |
| running / meta | 5 | 956,558 ms |
| running / run_start | 57 | 0 ms |
| waiting / stale_warning | 2 | 605,165 ms |
| waiting / status_change | 1 | 0 ms |
| running / turn | 12 | 405,008 ms |

Total for the 31 reader-endpoint jobs: 924,284,247 ms (256.75 h). Each job's entire attributed
tail equals its post-last-phase-event tail, and the SPECIALISTS-119 decision excludes that tail,
so the policy treats the whole figure as reader-triggered trailing silence rather than observed
activation work. That framing is a POLICY choice, not a corpus finding: the corpus cannot prove no
work happened during the interval (§5.1), only that the interval is bounded by the operator's read
rather than by the activation's own activity.

**Policy limit (SPECIALISTS-119).** By decision, the trailing silence of a parked or abandoned
activation — the interval after its last job-produced event and before end-of-stream — is EXCLUDED
from `waiting_ms`. `waiting_ms` and its Prometheus consumer `xtrm_job_wait_seconds` therefore
measure **activation-bounded waiting, not wall-clock waiting**: a genuinely parked activation whose
only later evidence is an operator read reports its trailing silence as zero. That is intended and
visible in the transformed buckets, not an artifact of the measurement. The measured figures above
are retained unchanged.

### 4.3 Reproducibility and drift

`policy.py` returned 924,277,987 ms for the same comparison on two runs on different days, and
`laned3.py` returned 924,284,247 ms on the same corpus. The 6,260 ms gap (0.0007 %) is consistent
with live-store ingestion between reads and with the two scripts' slightly different endpoint
definitions. The two figures are recorded as measured; they are not reconciled into one number.

The single largest affected activation is `act:00b4a5f9-f6d`: current `(active, waiting) =
(37,417, 28,863,796)` → proposed `(37,417, 1,377,347)` — 27,486,449 ms of the total comes from one
activation's waiting bucket.

## 5. Limits — what this corpus cannot support

1. **Stored timestamps are not verified wall-clock work.** The corpus records what the sink wrote.
   It cannot independently prove that a reported 44,756,499 ms phase lasted that long in reality,
   nor that no work happened during it.
2. **Reader-row attribution is heuristic.** Reader rows are identified by string matching in event
   JSON. A reader row that omits `status-load`/`status_reconciled` from those fields is classified
   as job-produced, and would close a phase under the proposed policy.
3. **No stored metrics row is a weak control.** 2,827 of 4,479 jobs have stored metrics: 2,707 carry
   real values and 120 store `(0, 0)`. All 29 affected jobs that have a stored row are inside the
   120. "Stored rows do not move" is therefore exact for the 29 and untouched-by-construction for
   the 2,707, but it is not a general guarantee about every consumer of phase timing.
4. **The corpus drifts.** Numbers here are point-in-time on a live store (section 2).
5. **No upstream provenance for the reader events.** The receipt cannot show which reader process
   wrote a given `status-load` row or when, beyond the row's own fields.
6. **One store, one machine.** Nothing here establishes the same distribution on another deployment.

## 6. Provenance chain

| Consumer | Use of these numbers |
|---|---|
| SPECIALISTS-119 rev 2 | The policy "flush = last job-produced event; reader rows excluded" rests on §4.1 and §4.2. |
| SPECIALISTS-94 (epic) journal | Batch A integration gate; this receipt is the corpus authority for the phase-accounting claim. |
| N3 freeze audit | The phase-accounting claim is quoted with §5 limits attached. |

## 7. Reproduction

```bash
cd docs/migrations/xtrm-93/n3/coordinator/laned
python3 policy.py      # §4.1
python3 laned3.py      # §4.2
python3 laned4.py      # stored-metrics join, job by job
```

The scripts read the store at an absolute path and never write. Running them copies a live corpus, so a
later run legitimately differs from §4; re-record §2 in that case.

Expected results on the corpus as of section 2: 31 jobs move, 0 with stored metrics, ~9.24e8 ms
removed, stored-metrics delta range identical under both policies. A materially different result
means the corpus moved; re-record section 2 before quoting these figures.
