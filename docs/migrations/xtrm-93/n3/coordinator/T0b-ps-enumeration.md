# T0b — `sp ps` activation enumeration (unitAI-kmbb9), measured by the coordinator

Tree: `feature/xtrm-93-n0n2-recon` @ `553b5a23`.
Store: `<git-common-root>/.specialists/db/observability.db`, **1.62 GB**, opened read-only in place (too large to copy into `/tmp`; `/tmp` is a 2 GB tmpfs and was previously observed full).
All queries: `sqlite3 -readonly`, `PRAGMA busy_timeout=5000`. Read-only measurement — no mutation.

## 1. The defect, quantified

The reader on this branch is `src/cli/ps.ts:746-751`:

```ts
sqliteClient.readForensicEvents({
  jobIdPrefix: 'act:',
  sinceMs: args.sinceMs,
  limit: 1000,
  order: 'desc',
});
```

`limit: 1000` bounds raw event **rows**, not activations.

| Measure | Value |
|---|---|
| `act:` forensic rows | **89,936** |
| distinct `act:` activations | **259** |
| distinct activations inside the newest-1000-row window | **3** |
| rows held by the single noisiest activation (`act:00b4a5f9-f6d`) | **7,804** |

The noisiest activation alone is **7.8× the entire window**. So `sp ps` renders 3 of 259 activations, and *which* 3 is decided by row density rather than by what the system has been doing. This reproduces the brief's observation exactly ("the same command returned 3 activations earlier and 1 now").

Top 10 activations by row count:

| activation | rows | first | last |
|---|---|---|---|
| `act:00b4a5f9-f6d` | 7,804 | 1788881330671 | 1788910611599 |
| `act:a945900d-670` | 6,831 | 1789052554432 | 1789055183839 |
| `act:c863ab6a-b7c` | 5,116 | 1789163733057 | 1789163800545 |
| `act:69bfec03-4f8` | 2,710 | 1789525297500 | 1789527788672 |
| `act:d621257d-469` | 2,557 | 1789151499506 | 1789151526406 |
| `act:51b14a21-af0` | 2,006 | 1789548796789 | 1789552510195 |
| `act:57438e6f-8e1` | 1,602 | 1788957603024 | 1788958568707 |
| `act:9aeabf76-262` | 1,591 | 1789553269102 | 1789554021027 |
| `act:99086b4f-121` | 1,574 | 1788959772190 | 1788961157375 |
| `act:a3a52fe8-385` | 1,300 | 1789163733000 | 1789163771100 |

## 2. The fix direction is available, but it is NOT simply "use `specialist_jobs`"

`specialist_jobs` does hold exactly one row per native activation:

```
act: rows in specialist_jobs  = 220
distinct job_id              = 220
```

So an activation-oriented selection — pick activation ids first, then fetch their events — is constructible and indexed (`idx_forensic_events_job_seq`, `idx_forensic_events_job_t` on `job_id`; the `jobIdPrefix` range is already index-backed per the N2B note).

**But a naive `specialist_jobs`-only selection hides 40 activations**, because 259 − 220 = 39…40 `act:` job_ids own forensic rows and no job row. An intermediate reading of that gap suggested a projection defect. It is not one. The set difference was resolved by identity:

## 3. Correction: the 40 forensic-only activations are a RETIRED family, not a gap

All 214 rows of those 40 activations are `event_family = 'activation'`:

| event_name | rows |
|---|---|
| `activation.activation_requested` | 40 |
| `activation.activation_rejected` | 24 |
| `activation.activation_turn_started` / `turn_completed` / `step_contract_compiled` / `activation_starting` / `activation_started` / `activation_settled` / `activation_admitted` | 16 each |
| `activation.activation_disposed` | 14 |
| `activation.activation_failed` | 12 |
| `activation.output_validation_started` / `passed` | 4 each |
| `activation.activation_completed` | 4 |

and:

- **0 of 214** rows carry an `attempt_id` (pre-attempt era, like legacy rows);
- **0** of their job_ids have a `specialist_jobs` row;
- each holds only **2–12** rows.

Family recency for `act:` rows settles it:

| family | rows | first (UTC) | last (UTC) |
|---|---|---|---|
| turn | 61,089 | 2026-09-08 11:41:16 | **2026-09-16 15:25:20** |
| tool | 16,215 | 2026-09-08 11:41:18 | **2026-09-16 15:25:20** |
| model | 11,802 | 2026-09-08 11:41:17 | **2026-09-16 15:25:20** |
| job | 603 | 2026-09-08 11:41:15 | **2026-09-16 15:23:45** |
| **activation** | **214** | 2026-09-07 17:51:34 | **2026-09-08 11:11:09** |
| control | 91 | 2026-09-08 11:56:10 | **2026-09-16 15:23:45** |
| retry | 30 | 2026-09-09 12:45:18 | **2026-09-16 10:35:36** |

The `activation` family is **frozen at 2026-09-08 11:11:09** while every live family is current to 2026-09-16 15:25. This independently reproduces the N2B diagnosis (writer retired by `febef0ad`) by a *set difference on identity* rather than by a time series — two different methods, same conclusion.

**So the enumeration gap is not evidence of missing native telemetry.** It is the pre-retirement era, and it is already excluded from the current vocabulary by design.

## 4. Consequence for the N3 node

The activation-oriented selection must make an explicit, tested decision about the retired family rather than silently inheriting it:

1. Select activation ids from `specialist_jobs` (one row per activation, `job_id >= 'act:' AND job_id < 'act;'`, index-backed), bounded to the latest N by `updated_at_ms`.
2. Decide explicitly whether `event_family='activation'` is in scope. It must either be excluded as `OBSOLETE_AFTER_CUTOVER` or surfaced as a separate, labelled historical group. It must never be blended into "current native activations", because those rows have no attempt identity and no job row — blending them makes a 2026-09-08 artifact look like today's activity.
3. Do not raise the raw row cap. A larger global cap only defers starvation: at 89,936 rows and a noisiest activation of 7,804, a 10× cap still shows single-digit activation counts.
4. The regression must assert presence of the quiet activations **while a noisy one dominates**, not merely that the command returns something.

## 5. Not yet established

- Whether `specialist_jobs` is populated early enough that a *currently starting* activation appears; a job row is written at admission, but this was not measured here.
- The exact N for "latest N activations" — a product decision, not a measurement.
- Whether the console/other readers share the same global-cap pattern; that is lane T7's scope.

## 6. Addendum — the identity arithmetic closes exactly, and exposes one authority disagreement

```
specialist_jobs  act: rows                = 220
forensic-only act: job_ids (EXCEPT)       =  40
job rows with NO forensic rows            =   1
220 - 1 + 40                              = 259  (= distinct act: forensic job_ids)  ✓
```

The single job row with no forensic rows:

| job_id | specialist | status | updated (UTC) | attempt_no | attempt_id | pi_session_id |
|---|---|---|---|---|---|---|
| `act:16106c00-f54` | `smoke-echo` | `error` | 2026-09-14 00:48:49 | 1 | `att:16106c00-f54:1` | *(empty)* |

A smoke-test activation that errored before emitting any forensic event.

**This is a genuine, small authority disagreement between the two attempt stores, and it matters for `sp result att:`.** The N2A fix chose to validate attempt existence against the **forensic `attempt_id` set** rather than `specialist_jobs`, for a reason that was verified correct: `specialist_jobs.attempt_no/attempt_id` holds only the *latest pointer*, so a real mid-life attempt (observed: `attempt_no=3` with attempts 1 and 2 existing only in forensics) would be wrongly rejected if the job row were the authority.

Here the inverse case appears: an attempt is named in `specialist_jobs` and absent from forensics. `att:16106c00-f54:1` therefore resolves to **refusal** (`No such attempt`), even though the job row names it.

Disposition: **not a defect.** The N2A rule fails closed on every unverifiable path, and a job row naming an attempt that produced no telemetry is exactly a case where refusing is safer than guessing. But it is a real 1-in-220 divergence between the two stores, it must be stated rather than discovered later, and any N3 identity/attempt work must not "fix" it by relaxing the forensic check — that would silently re-open the fabricated-attempt hole N2A closed (review finding HIGH, fixed in `9766b5b7`).

## 7. Addendum — the two-stage fix measured, and it works

Lane T2 reported that a bounded two-stage query is constructible but that "fully index-ordered selection needs
a new index". Verified directly.

**Stage-1 plan** (`SELECT job_id FROM specialist_jobs WHERE job_id >= 'act:' AND job_id < 'act;' ORDER BY updated_at_ms DESC LIMIT 10`):

```
|--SEARCH specialist_jobs USING INDEX sqlite_autoindex_specialist_jobs_1 (job_id>? AND job_id<?)
`--USE TEMP B-TREE FOR ORDER BY
```

So the range filter **is** index-backed (via the primary-key autoindex on `job_id`), and the `ORDER BY` is
**not** index-ordered — SQLite sorts the bounded activation set in a temporary B-tree. `specialist_jobs`
carries 12 indexes; only `idx_jobs_status_updated` mentions `updated_at_ms`, and as a composite led by
`status` it cannot serve a `job_id` range with an `updated_at_ms` order.

That residual sort is immaterial here, because it sorts **221 rows, not 91,398**. The win is in what each
query has to examine at all:

| | current query | two-stage fix |
|---|---|---|
| rows examined for the selection | **91,398** event rows | **221** activation rows |
| activations returned | **3** | **10** (exactly what was asked for) |
| quietest activation included | never — starved | `act:ed2b80f7-a71`, **12 rows** |
| result depends on row density | **yes** | no |

Measured result of the two-stage query, newest 10 by `updated_at_ms`:

| activation | updated (UTC) | specialist | status | forensic rows |
|---|---|---|---|---|
| `act:4c387f0d-40a` | 2026-09-16 15:41:05 | executor | running | 642 |
| `act:b3415ac1-d6a` | 2026-09-16 15:30:34 | debugger | done | 943 |
| `act:7c6175e8-a9a` | 2026-09-16 13:47:46 | explorer | done | 360 |
| `act:73e76a1e-fe0` | 2026-09-16 13:06:25 | executor | done | 844 |
| `act:73cb31f6-65c` | 2026-09-16 11:58:13 | executor | done | 393 |
| `act:4f3b7495-1b0` | 2026-09-16 11:58:13 | executor | done | 430 |
| `act:09c2f47e-98c` | 2026-09-16 10:45:08 | explorer | done | **29** |
| `act:ed2b80f7-a71` | 2026-09-16 10:44:38 | explorer | done | **12** |
| `act:841fbe3a-c97` | 2026-09-16 10:37:38 | executor | done | 709 |
| `act:9aeabf76-262` | 2026-09-16 10:29:52 | executor | done | 1591 |

**This is precisely the starvation regression the brief asks for.** `act:09c2f47e-98c` (29 rows) and
`act:ed2b80f7-a71` (12 rows) sit below five activations holding 393–1591 rows each; under the current global
`LIMIT 1000` they can never appear, because the noisier activations above them consume the entire window
before the scan reaches them. The fix returns them on the first request.

Point-in-time reading: **221** activations, **91,398** `act:` event rows, noisiest activation **7,804** rows.

**Index recommendation, stated with its threshold rather than as a guess.** No new index is warranted at 221
activations. If the activation set grows large enough that the temporary B-tree becomes the dominant cost, the
right index is on `updated_at_ms` (or `(updated_at_ms, job_id)`) rather than any composite led by `job_id`,
because a range on the leading column cannot also provide the order — scanning an `updated_at_ms` index in
descending order and filtering on the `job_id` prefix would let the `LIMIT` terminate early. Introduce it on
measurement, not pre-emptively.
