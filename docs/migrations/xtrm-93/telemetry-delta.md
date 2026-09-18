# XTRM-93 — Lane C: Telemetry Delta (parity change list)

> **Delta-only view.** The signal inventory, evidence and blocker list live in
> [`03-telemetry-observability.md`](./03-telemetry-observability.md). This file states
> **exactly what must change** for telemetry parity and classifies each change as
> `BYTE_COMPATIBLE_REQUIRED` or `SEMANTIC_EQUIVALENT_OK`.
>
> Classification rule applied throughout:
>
> - **`BYTE_COMPATIBLE_REQUIRED`** — an existing consumer parses the bytes (metric name, label
>   name, JSON key, envelope field, sort order). Changing the representation breaks it even if
>   the meaning is identical. The consumer is named in the justification.
> - **`SEMANTIC_EQUIVALENT_OK`** — every consumer treats the value opaquely or tolerates both
>   shapes; the change is safe if the *meaning, count and lifetime* are preserved. Evidence
>   that no consumer inspects the representation is required and is cited.
>
> File:line citations use the same path aliases as the companion artifact.

---

## 1. Foundations — identity deltas that every other delta inherits

### TEL-D-001 — `job_id` value and format switches from a UUID to the activation id

| | |
|---|---|
| Signals affected | CAP-TEL-001..008, 056, 057, 059, 063–070, 084–097 and every `job_id`-keyed read |
| Legacy | `job_id = crypto.randomUUID()` (`runner:1547`); `script-runner` uses `traceId` (`script-runner:467,754`) |
| Native | the `job_id` column carries the activation id `act:<12 hex>` (`host:508`) via `nat-obs:244` |
| What must change | Nothing in the writer. The delta is a **contract decision**: the column's value alphabet changes. Either (a) accept `act:*` as the durable job identity, or (b) mint a legacy-shaped id and keep the activation id in a separate column. |
| Classification | **`SEMANTIC_EQUIVALENT_OK`** |
| Justification | Every `job_id` consumer treats it opaquely: `sp result <job-id>`, `sp log <job-id>`, `sp feed --job`, `readEvents(jobId)`, `readResult(jobId)`. No consumer parses, lengths, regexes or sorts by format. `obs-sqlite` stores it as `TEXT PRIMARY KEY`. Ordering comes from `t`/`seq`, never from the id (`tl:1061-1066`). |
| Residual risk | `sp db stats` sorts `ORDER BY updated_at_ms DESC, job_id DESC` (`obs-sqlite:3034`, and the same clause at `:2652`) — identical-timestamp ties will order differently between stacks. Cosmetic only. |
| Verdict condition | Must be recorded in the capability matrix §4 gate "any stable identity surface (`job_id` and its persisted shapes) without a defined survival rule". The survival rule is: **`job_id` becomes the activation id; `activation_id == job_id` for all native rows.** |

### TEL-D-002 — `attempt_id` textual format split inside one column

| | |
|---|---|
| Signals affected | CAP-TEL-075, plus every `attempt_id`-filtered forensic query |
| Legacy | `` buildAttemptId → `${jobId}::attempt::${attemptNo}` `` (`obs-sqlite:386-388`); stored at `obs-sqlite:1634-1639` |
| Native | `att:<activationId.slice(4)>:1` (`host:509`), advanced by `nativeAttemptIdForNo` → `att:<hex>:<n>` (`nat-obs:228-233`), on resume by `nextAttemptId` (`host:2260`) |
| What must change | Pick one. Recommended: keep both formats legal and make `attempt_no` the only ordering key. A parser that extracts the attempt number must use `attempt_no`, never a regex on `attempt_id`. |
| Classification | **`SEMANTIC_EQUIVALENT_OK`**, conditional on removing any format parsing |
| Justification | `attempt_id` is used as an opaque partition key: `idx_..._job_attempt` indexes it (`obs-sqlite:743-744`), `readForensicEvents` filters by equality, `ObservabilityIdentityProjection` passes it through (`obs-sqlite:1355-1360`). No code path in `src/` regexes it. |
| Verification required | UNKNOWN U-4 in the companion artifact: confirm no out-of-tree consumer assumes the `::attempt::` form. If one does, this becomes `BYTE_COMPATIBLE_REQUIRED` with a migration shim. |
| Note | The v15 normative contract (`obs-sqlite:685-701`) mandates `attempt_no = 0` / `attempt_id = NULL` for legacy rows and forbids inventing attempt 1. Native writes `attempt_no = 1` from the first event (`sink:265`). That asymmetry is intentional and must be preserved: a native activation never had a legacy pre-attempt era. |

### TEL-D-003 — `participant_id` is already identical; no change

| | |
|---|---|
| Signals affected | CAP-TEL-072 |
| Legacy | `deriveParticipantId(participant_role = status.specialist)` (`obs-sqlite:1490`) |
| Native | `specialist::${request.specialist}` (`host:517`), and `deriveParticipantId` at `sink:110` |
| Delta | **none** — same producer function, same `specialist::<role>` shape, same `<unknown>` sentinel semantics (`obs-sqlite:694-701`) |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** (unchanged, i.e. must remain byte-identical) |
| Justification | `idx_jobs_participant`, `sp ps --mine`, and the v15 rollup queries join on it verbatim; `native-lease-forensics.test.ts` and `forensic-events.test.ts:242,253` pin the exact string. |

### TEL-D-004 — `workspace_id` normalization

| | |
|---|---|
| Signals affected | CAP-TEL-074 |
| Legacy | `normalize(resolve(worktree_path))` (`obs-sqlite:381-384`) |
| Native | `normalizeWorkspacePath(status.worktree_path)` inside `writeStatusRow` (`obs-sqlite:1489`) — same function |
| Delta | **none** |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** |
| Justification | The v15 contract explicitly forbids realpath/repo-root/git-common-dir normalization and names the symlink ceiling (`obs-sqlite:690-693`); `observability-sqlite-v15-identity.test.ts:329` pins it. A native path that realpath'd would silently split one workspace into two ids. |

### TEL-D-005 — `pi_session_id` blank-vs-null

| | |
|---|---|
| Signals affected | CAP-TEL-073 |
| Legacy | written from `status.session_id`, `COALESCE`-preserved when no identity is supplied (`obs-sqlite:1511,1518`) |
| Native | `sink:273-275` refuses to overwrite with a blank (`host` may pass `snapshot.piSessionId ?? ''` before a session exists) |
| Delta | **none** — native explicitly reproduces the legacy non-clearing rule |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** |
| Justification | `native-activation-observability.test.ts:180` pins "never lets a blank session identity clear the projected `pi_session_id`". Treating `''` as a value would null a durable session link. |

---

## 2. Field and schema deltas

### TEL-D-006 — `chain_template` / `startup_payload_json` missing on native rows

| | |
|---|---|
| Signals | CAP-TEL-030, CAP-TEL-091, CAP-TEL-092 |
| What must change | native `statusOf` (`sink:96-127`) must carry the startup payload (or at least `chain_template`) so `prom:295-300` can derive a real label instead of the `'chain'` fallback |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** on the *label value*: the label `chain_template` must keep its name and its normalisation (`prom:308-312`, ≤80 chars, non-matching → `_`); only its value must become the real template |
| Justification | The Prometheus series identity is the label tuple. If native chain members keep emitting `chain_template="chain"`, then legacy and native chain members of the *same* chain land in different series and `xtrm_chains_total` double-counts across the migration window. |
| Owner | CAP-TEL-030 row in the inventory |

### TEL-D-007 — `statusOf` omits every chain/node/epic column

| | |
|---|---|
| Signals | CAP-TEL-077 |
| What must change | if chains/nodes survive in the native model, `statusOf` must populate `chain_kind`, `chain_id`, `chain_root_job_id`, `chain_root_bead_id`, `epic_id`, `node_id`; otherwise these columns must be documented as intentionally NULL for native |
| Classification | **`SEMANTIC_EQUIVALENT_OK`** if NULL is the decision; **`BYTE_COMPATIBLE_REQUIRED`** if chains survive, because `idx_jobs_chain`, `idx_jobs_epic`, `listLiveJobsForBead`, `resolveChainEpicLinkByJobId`, `sp ps` tree grouping and `prom:277-300` all key on the exact column values |
| Justification | Today native rows always read `chain_kind='prep'`, everything else NULL (defaults at `obs-sqlite:1494-1500`), so native activations are invisible to every chain query. That is a behaviour change, not a representation change — it needs an explicit decision either way. |

### TEL-D-008 — `stall_gaps_json` element shape and `reason` filter

| | |
|---|---|
| Signals | CAP-TEL-035, CAP-TEL-066 |
| Legacy | `Array<{t,tool,silence_ms,threshold_ms}>`, collected only for `type==='stale_warning' && reason==='tool_duration'` (`obs-sqlite:2935-2937`) |
| What must change | DONE (SPECIALISTS-102 / PR #387): the native watchdog emits `stale_warning` rows with `reason` spelt exactly `tool_duration` (`native-host.ts:2140-2156`, mapper `nat-obs:473-482`). The literal-spelling requirement stands — a new spelling would still silently empty `stall_gaps_json`. |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** on `event_json.type` and `event_json.reason` |
| Justification | `obs-sqlite:2935` and `:2930` and `:2905` switch on literal `reason`/`status` strings; a new spelling (`tool-duration`, `toolDuration`) silently produces an empty `stall_gaps_json` with no error. |

### TEL-D-009 — `session_id` / `worktree_path` live only inside `status_json`

| | |
|---|---|
| Signals | CAP-TEL-073, CAP-TEL-083 |
| Legacy | `status_json` is the full `SupervisorStatus` blob, and both are duplicated into columns by `writeStatusRow` |
| Native | `statusOf` builds a `SupervisorStatus` with `session_id`, `worktree_path`, `elapsed_s`, `last_event_at_ms`, `metrics` (`sink:103-126`) |
| Delta | **none** for the columnar projection |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** on the `specialist_jobs` column set and on `status_json` top-level key names |
| Justification | `readStatus()` returns `status_json` parsed and typed as `SupervisorStatus` (`obs-sqlite` `readStatus`), and `sp ps --json`, `sp log`, `sp status`, `live-agg` read keys such as `metrics.token_usage`, `context_pct`, `worktree_owner_job_id`, `chain_id`, `epic_id`, `node_id` (`live-agg:125-146,163-177`). A renamed key is a silent `undefined`. |

### TEL-D-010 — `specialist_job_metrics.token_trajectory_json` carries two element shapes

| | |
|---|---|
| Signals | CAP-TEL-024, CAP-TEL-097 |
| Legacy | `[{turn_index,t,token_usage}]` from `turn_summary` **and** `[{t,source,token_usage}]` from `token_usage`, appended into one array (`obs-sqlite:2907-2921`) |
| What must change | nothing at write time (both stacks already behave the same via the shared function); what must change is the **reader contract** — `prom:432-457` (`latestTokenTrajectory`) takes the last element and reads `input_tokens`/`input`/`output_tokens`/… with no awareness of which shape it got |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** on the array encoding; the reader fix is `SEMANTIC_EQUIVALENT_OK` |
| Justification | The column is a durable contract consumed by `sp db stats --with-payload`, `benchmark-export` and `prom`. Adding a discriminator field is additive and safe; changing the `token_usage` nesting is not. |

---

## 3. Timing-semantics deltas

### TEL-D-011 — native `started_at_ms` is the first projected event, not dispatch

| | |
|---|---|
| Signals | CAP-TEL-063, CAP-TEL-089, CAP-TEL-090 |
| Legacy | `startedAtMs = min(event.t)` over the job's events, where the first event is `run_start` written at session start (`obs-sqlite:2884,2887`; `sup:1629`) |
| Native | `state.startedAtMs = Date.now()` at the first projected event in `emit()`/`sessionEvent()` (`sink:185-190,257-262`), and `run_complete.elapsed_s = (t - startedAtMs)/1000` (`nat-obs:252,293`) |
| What must change | accept the shift, or seed `startedAtMs` from the host's dispatch time. Compared with legacy, native omits the dispatch→`activation_started` interval (which includes `activation_requested`, admission, lease acquisition, session construction — `host:524,897,935,1059`) |
| Classification | **`SEMANTIC_EQUIVALENT_OK`** |
| Justification | `elapsed_ms` is a reported measurement, not a key: it feeds a histogram bucket and a display string. No consumer asserts an exact value; `xtrm_job_duration_seconds` is bucketed (`prom:25`) and `sp feed` renders seconds. The semantic claim "duration of the activation" is preserved; only the origin moves. |
| Obligation | Document the origin change, because `max(elapsed_ms)` comparisons between stacks become invalid during the migration window. |

### TEL-D-012 — native `active_runtime_ms` / `waiting_ms` phase machine diverges

| | |
|---|---|
| Signals | CAP-TEL-064, CAP-TEL-065, CAP-TEL-090, CAP-TEL-093 |
| Legacy | `run_start`→running (`obs-sqlite:2894-2897`); `status_change('running'\|'waiting')` toggles the phase (`:2923-2934`); `run_complete`/terminal `status_change` closes it (`:2939-2947`). A resume writes `status_change('running')` (`sup:1978`), closing the waiting phase. |
| Native | `status_change('waiting','running')` from `activation_settled` (`nat-obs:249-250`), and — CLOSED by PR #388 (SPECIALISTS-106, Lane D) — `status_change('running','waiting')` from `activation_resumed` (`nat-obs:320-327`). The machine returns to `running` on resume; the pre-fix sentence claiming no mapping is HISTORICAL. |
| What must change | DONE (PR #388): the running re-entry for `activation_resumed` shipped (`nat-obs:320-327`). Residual decision, unchanged: whether `agent_settled`-derived `waiting` should start a waiting phase at all in a keep-alive model, and whether the first `turn_start` after a settle needs its own re-entry. |
| Classification | **`SEMANTIC_EQUIVALENT_OK`** on the *fields* (same names, same units, same columns); the underlying number is **wrong**, so this is a correctness fix, not a representation fix |
| Justification | `active_runtime_ms` and `waiting_ms` are read only by `prom` (`:167-175,198-210`) and `sp db stats`; no byte contract is broken. But `waiting_ms` for any resumed native activation absorbs the whole post-settle interval, and `active_runtime_ms` under-counts by the same amount — `xtrm_job_wait_seconds` and `xtrm_job_active_runtime_seconds` are therefore not comparable across stacks until fixed. |
| Blocking? | Was **D-4 / TEL-D-C2**; CLOSED by PR #388 for the resume re-entry. The `waiting_ms`-absorbs-post-settle miscount no longer occurs on resumed activations. |

### TEL-D-013 — event ordering for equal timestamps

| | |
|---|---|
| Signals | all `specialist_events` / `specialist_forensic_events` readers |
| Legacy | per-job `seq` assigned at write: `` max(nextSpecialistSeq, nextForensicSeq) ``, with a caller-honoured seq when unused (`obs-sqlite:1605-1620`) |
| Native | same writer, but many native rows are written with `t = Date.now()` captured once per callback batch (`sink:183,255`) — several events in one `sessionEvent` share one `t` (e.g. `text` + `message` + `token_usage` + `finish_reason` + `turn_summary` from one `message_end`, `nat-obs:342-356`) |
| What must change | nothing — ordering is already `(t, seq, id)` everywhere |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** on the tie-break chain |
| Justification | `idx_forensic_events_job_t ON (job_id, t, seq, id)` (`obs-sqlite:347-348`), `idx_specialist_events_job_t ON (job_id, t, seq, id)` (`obs-sqlite:833-834`), `compareTimelineEvents` (`tl:1061-1066`), `mergeTimelineEvents` (`tl:1074-1100`). All three must keep using `seq` as the tie-break; a reader that sorted by `t` alone would reorder native batches. |

---

## 4. Cumulative vs per-turn deltas

### TEL-D-014 — `xtrm_llm_tokens_total` is per-turn for legacy and cumulative for native

| | |
|---|---|
| Signals | CAP-TEL-097, CAP-TEL-023, CAP-TEL-024, CAP-TEL-033 |
| Legacy | `prom:432-457` reads the last `token_trajectory_json` element. For a legacy job that element is a `turn_summary` element carrying that turn's `token_usage` (`sup:2479-2487` → `obs-sqlite:2913-2917`) — i.e. **per-turn** |
| Native | for a native job the last element is a `token_usage` element whose `token_usage` is the **session-cumulative** total built by `accumulateTokenUsage` (`nat-obs:177-201`, accumulated at `sink:284` and `host:1455-1465`) |
| What must change | the reader must know which basis it is reading. Options: (a) sum the whole trajectory, (b) add an `aggregation: 'cumulative'|'per_message'` discriminator to the token payload (additive, safe), (c) make legacy also cumulative. Option (b) is the only one that does not change existing values. |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** on the metric name, type and label set (`xtrm_llm_tokens_total`, counter, labels `service_name`,`participant_kind`,`repo`,`participant_role`,`model`,`model_provider`,`direction`); the **value basis** change is additive-only |
| Justification | `direction` is a closed 7-value set (`prom:436-446`). A scraper summing `rate(xtrm_llm_tokens_total)` across a mixed legacy/native fleet will under- and over-count inconsistently. The counter name and labels must not change; only the basis must be made explicit. |
| Blocking? | Yes — divergence **D-5 / TEL-D-C4** below. |

### TEL-D-015 — `total_turns` is derived from `turn_summary`, whose emission basis differs

| | |
|---|---|
| Signals | CAP-TEL-010, CAP-TEL-033, CAP-TEL-094, CAP-TEL-013 |
| Legacy | one `turn_summary` per **turn**: `sup:2479` is called from the `SessionMetricEvent` `'turn_summary'` branch |
| Native | one `turn_summary` per **assistant message**: `nat-obs:352` is inside the `message_end` / `role==='assistant'` branch |
| Native's *other* turn counter | `sink:269` increments `state.turns` on `sessionEvent` type `turn_start`, and `run_complete.metrics.turns` carries that value (`nat-obs:264`). `activation-telemetry.test.ts:250-320` pins "starts at zero, counts once per completed turn, cumulative across resume and retry". |
| What must change | pick the canonical basis. If `total_turns` must equal the Fleet's `run_complete.metrics.turns`, native must emit exactly one `turn_summary` per `turn_end` (not per assistant message), and the Fleet counter must read the same source. |
| Classification | **`SEMANTIC_EQUIVALENT_OK`** on the row shape, **`BYTE_COMPATIBLE_REQUIRED`** on `specialist_job_metrics.total_turns` (INTEGER) and `xtrm_turns_total` (counter) staying integers with the same meaning |
| Justification | `obs-sqlite:2913-2914` counts `turn_summary` rows; `prom:212-222` sums `total_turns`. A multi-message turn yields 1 legacy turn and N native turns, so a mixed fleet's `xtrm_turns_total` is not a turn count. The metric name claims "completed specialist turns". |
| Blocking? | Yes — divergence **D-3 / TEL-D-C3** below. |

### TEL-D-016 — `auto_retries` / `auto_compactions` are cumulative, and stay so

| | |
|---|---|
| Signals | CAP-TEL-033 |
| Legacy | run metrics counters, session-cumulative |
| Native | `sink:264-270` increments `state.autoRetries`/`state.autoCompactions` monotonically across retries, and the state survives a resume (same map key) |
| Delta | **none** |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** |
| Justification | `activation-telemetry.test.ts:293-320` pins cumulative counting across resume and retry; a per-attempt reset would reduce the count mid-life and is explicitly rejected by that test. |

---

## 5. Missing-vs-zero deltas

### TEL-D-017 — native `context_pct` is absent, not zero

| | |
|---|---|
| Signal | CAP-TEL-028, CAP-TEL-095 |
| Legacy | `sup:2470-2473` writes `context_pct` and `context_health` from `calculateContextUtilization(currentContextTokens, model)`; `turn_summary` carries them (`sup:2479-2487`) |
| Native | `statusOf` omits `context_pct` entirely (`sink:96-127`); `nat-obs:352` passes no `context_pct` to `createTurnSummaryEvent`, so the field is `undefined` and dropped by JSON serialization |
| What must change | compute it natively. `aggregateContextHealth` (`live-agg:148-161`) and `latestContextRatio` (`prom:687-698`) both treat absent as "no data" — which is the correct behaviour and must be preserved: **do not zero-fill.** |
| Classification | **`SEMANTIC_EQUIVALENT_OK`** on the field's optionality; **`BYTE_COMPATIBLE_REQUIRED`** on the rule that absence stays absence |
| Justification | `activation-telemetry.test.ts:67` pins "omits thinking level and token usage when unset **instead of zero-filling**". Zero-filling would make `ctxAvgPct` (`live-agg:155-157`) divide a fabricated 0 into the fleet average, and `xtrm_context_usage_ratio` would report a real-looking 0. |
| Blocking? | Yes, as the *execution* gap blocker **C-5**; the representation rule itself is already satisfied. |

### TEL-D-018 — native `model` column stays NULL until `run_complete`

| | |
|---|---|
| Signal | CAP-TEL-069 |
| Legacy | `model` is read only from `run_complete.model` (`obs-sqlite:2858,2943`) |
| Native | identical, but native `run_complete.model = context.resolvedModel` (`nat-obs:254`) which is populated from `activation_*` payload `resolved_model` (`sink:196`) |
| What must change | nothing; but note that a native activation that fails before any `resolved_model` payload has `model = NULL` whereas legacy would have a model from `run_start`/`meta` |
| Classification | **`SEMANTIC_EQUIVALENT_OK`** |
| Justification | `prom:355` normalises `undefined` → label omitted, i.e. `model` is simply absent from the tuple (`jobParticipantLabels`, `prom:355-362`). Absent is already a legal state for legacy; `sp db stats --model '*'` (`obs-sqlite:2962-2965`) matches `NULL` never, which is the same for both stacks. |

### TEL-D-019 — `specialist_results` presence vs `last_output`

| | |
|---|---|
| Signal | CAP-TEL-059, CAP-TEL-008 |
| Legacy | `upsertStatusWithEventAndResult` writes `specialist_results` **and** `specialist_jobs.last_output` on completion (`sup:2890-2891`, `obs-sqlite:2062-2071,1518`) |
| Native | `sink:219-245` reproduces exactly that path for `activation_completed`, including the deliberate rule that an **empty** final message overwrites rather than preserves (`sink:197-203`) |
| Delta | **none** |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** |
| Justification | `native-activation-observability.test.ts:230` pins "persists settle output to `last_output` and results, surviving dispose". Empty-string-means-empty is semantically load-bearing: `COALESCE(excluded.last_output, …)` preserves only on `NULL`, not on `''`. |

### TEL-D-020 — `run_complete` is emitted exactly once per job, in both stacks

| | |
|---|---|
| Signals | CAP-TEL-002, CAP-TEL-003 |
| Legacy | file-level `run_complete` at `sup:1736`/`2947`; db-level via `upsertStatusWithEventAndResult` (`sup:2890-2891`) — note the "file only" writers, so the DB row count is one |
| Native | `activation_completed` (or `activation_failed`/`activation_rejected`) is the sole terminal emitter; the host states this explicitly ("the sole place that emits the terminal `activation_settled`/`activation_failed` pair", `host:1492-1493`), and `nat-obs:251-270,291-303` maps exactly one timeline event per terminal |
| What must change | nothing |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** |
| Justification | `obs-sqlite:2940-2945` takes the **last** `run_complete` and `hasRunCompleteEvent` (`obs-sqlite:3364-3394`) is a boolean existence check; a second row would silently overwrite `run_complete_json`, `elapsed_ms` and `model`. |

---

## 6. Persistence-lifetime and retention deltas

### TEL-D-021 — retention is asymmetric today and must be decided, not inherited

| | |
|---|---|
| Signals | every row in `specialist_events`, `specialist_forensic_events`, `specialist_job_metrics`, `specialist_results`, `branch_integration_events` |
| Legacy behaviour | `pruneObservabilityData` deletes `specialist_events` older than `eventsRetentionMs` (default **30 days**, `obs-sqlite:3106-3107,3236`), plus terminal `specialist_jobs` and their `specialist_results` older than `beforeMs` (`:3189-3198,3205-3230`), and `epic_runs` when `--include-epics`. `sp db prune` documents exactly this (`src/cli/db.ts:113-116`). |
| Untouched by prune | `specialist_forensic_events` — **never deleted**. `specialist_job_metrics` — **never deleted**. `branch_integration_events` — **never deleted**. |
| What must change | the retention policy must become explicit per table, because the native stack *depends* on `specialist_forensic_events` for its only durable answer surface (`nat-sum:1-9`, `ps.ts:746-751`). A future decision to prune forensic rows would delete native activation history that no other store holds. |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** on the deletion predicates for `specialist_events` (they are the documented `sp db` contract) and on the guarantee that `specialist_forensic_events` is **not** pruned |
| Justification | `docs`/CLI help (`src/cli/db.ts:113-116`) states "prune keeps `specialist_events` last 30 days always" and "prune never touches active-chain jobs". The `extract` step (`obs-sqlite:3197-3213`) materialises metrics into `specialist_job_metrics` **before** deleting events, so metrics are the intended post-prune evidence — meaning metrics retention is deliberately unbounded and must stay so, or the post-prune evidence disappears. |
| Obligation | Native activations must be included in the `extract` pass. `extract` iterates `SELECT DISTINCT stale.job_id FROM specialist_events WHERE stale.t < eventsCutoffMs` (`obs-sqlite:3199-3203`) — an unfiltered query, so native rows are included automatically once their `job_id` is in `specialist_events`. Verified, no change needed. |

### TEL-D-022 — settlement records have no retention rule

| | |
|---|---|
| Signal | CAP-TEL-054 |
| Current | `.specialists/settlements/<activationId>/<attemptId>.json` — default root `createFileSettlementStore(join(this.cwd, '.specialists', 'settlements'))` (`host:494`, deps declared `host:383`) — one file per (activation, attempt), written on every terminal settlement including failures; nothing deletes them (`settle-store:167-208`) |
| What must change | define a retention/compaction rule before native becomes primary. Failed attempts are stored by design ("Failed attempts are stored (queryable) but never published", `settle-store:59-60`), so the store grows one record per attempt forever. |
| Classification | **`SEMANTIC_EQUIVALENT_OK`** on the file format (JSON, opaque to all consumers); a retention rule is additive |
| Justification | The only readers are `SettlementStore.get/listAttempts/listPendingPublication/listRuntimeRefused` (`settle-store:91-112`) and `republishPendingSettlements`. Format changes are safe; unbounded growth is the real risk. |

### TEL-D-023 — WAL, busy-timeout and retry behaviour must not change

| | |
|---|---|
| Signals | every write |
| Legacy | `PRAGMA journal_mode=WAL` enforced and re-verified (`obs-sqlite:171-185,481,606`); `busy_timeout=5000` (`:108,1475`); bounded retry ×5 with exponential backoff + jitter on `SQLITE_BUSY`/`SQLITE_LOCKED`/`database is locked`/`database is busy`/`UNIQUE constraint failed` (`:130-164`) |
| Native | same connection class (`obs-sqlite:3396-3419`) |
| Delta | **none** |
| Classification | **`BYTE_COMPATIBLE_REQUIRED`** |
| Justification | Two processes (MCP server, CLI) write the same file. `tests/unit/specialist/observability-sqlite.test.ts:85-113` pins WAL enabling and verification; `:979-1010` pins the `UNIQUE(job_id,seq)` renumbering that the retry path exists to survive (`unitAI-dd52z`). Enabling the node-sqlite fallback path (`obs-sqlite:33-86`) must preserve the array-parameter and `undefined`→`NULL` normalisations, or native writes silently degrade to a no-op sink (`obs-sqlite:8-19`). |

---

## 7. Counting / aggregation divergence register

Every signal where the two stacks count or aggregate **differently**. Each entry names the
divergence, the arithmetic, and the required resolution.

| ID | Signal(s) | Legacy arithmetic | Native arithmetic | Effect on an aggregate | Resolution |
|---|---|---|---|---|---|
| **TEL-D-C1** | `total_tools`, `tool_call_counts_json`, `xtrm_tool_calls_total` (CAP-TEL-022, CAP-TEL-096) | `totalTools += 1` for **every** `type==='tool'` row, i.e. start **and** update **and** end (`obs-sqlite:2891-2894`) | identical — shared function | A single tool call with one update produces **3** counts; a call with no update produces 2. Legacy and native over-count the same way, so cross-stack comparison is safe but the absolute number is not a call count. | Align `total_tools` with `status.metrics.tool_calls` (`sink:286-288`, end-phase only) **as a separate column** — changing the existing column changes a shipped number. Register as a known defect, not a migration delta. |
| **TEL-D-C2** | `active_runtime_ms`, `waiting_ms`, `xtrm_job_active_runtime_seconds`, `xtrm_job_wait_seconds` (CAP-TEL-064, CAP-TEL-065, CAP-TEL-090, CAP-TEL-093) | phase toggles on every `run_start`/`status_change('running'|'waiting')`, resumes included (`obs-sqlite:2894-2934`) | CLOSED by PR #388: `status_change('waiting')` from `activation_settled` plus running re-entry from `activation_resumed` (`nat-obs:320-327`); post-loop flush closes still-open phases (`obs-sqlite:3090-3109`). Endpoint set by SPECIALISTS-119 to the last JOB-PRODUCED event — reader-produced `status-load` rows are excluded | For resumed native activations the post-settle interval is now split correctly; the pre-fix absorb/under-count description is HISTORICAL. Endpoint policy: a trailing job-produced non-phase event extends the flush, a trailing reader `status-load` row does not; null-phase windows (e.g. run_complete → next status_change) stay unattributed. Evidence: `tests/unit/specialist/phase-accounting-invariant.test.ts` (I1-FLUSH), `coordinator/phase-accounting-corpus-receipt.md`. | DONE for the resume re-entry (PR #388); endpoint DONE for SPECIALISTS-119. See TEL-D-012. |
| **TEL-D-C3** | `total_turns`, `xtrm_turns_total`, `turn_summary` row count, Fleet `run_complete.metrics.turns` (CAP-TEL-010, CAP-TEL-033, CAP-TEL-094) | one `turn_summary` per **turn** (`sup:2479`) | one `turn_summary` per assistant **message** (`nat-obs:352`); a *second* native counter counts `turn_start` (`sink:269`) | Three counts exist: legacy turns, native turn_summary rows (= messages), native `run_complete.metrics.turns` (= turns). `total_turns` reads the first two depending on the row's origin; `activation-telemetry.test.ts:250` pins the third. | Make `run_complete.metrics.turns` and `total_turns` read the same counter; emit `turn_summary` per `turn_end`. See TEL-D-015. |
| **TEL-D-C4** | `xtrm_llm_tokens_total` (CAP-TEL-097) | last trajectory element = last **per-turn** usage (`prom:432-457`, `obs-sqlite:2913-2917`) | last trajectory element = **session-cumulative** total (`nat-obs:177-201`) | `rate(xtrm_llm_tokens_total)` is a per-turn rate for legacy rows and a session-total delta for native rows. A mixed fleet cannot be summed. | Add an `aggregation` discriminator to the token payload; have the reader convert to a common basis. See TEL-D-014. |
| **TEL-D-C5** | `elapsed_ms`, `xtrm_job_duration_seconds`, `xtrm_chain_duration_seconds` (CAP-TEL-063, CAP-TEL-089, CAP-TEL-092) | from `run_start.t` (session start) to `run_complete.t`, or from `run_complete.elapsed_s` written by the supervisor (`obs-sqlite:2900-2948`; `sup:2891`) | from the sink's first observed event to the terminal event (`nat-obs:252,293`; `sink:185-190`). `chainDurationSeconds` takes `max(completed) - min(started)` across members (`prom:319-330`) | Native durations exclude dispatch→first-event; chain span is computed from a mix of both origins during migration. | Accept the shift for `elapsed_ms`; for `xtrm_chain_duration_seconds` either fix `started_at_ms` or document the discontinuity window. See TEL-D-011. |
| **TEL-D-C6** | `auto_retries`, `auto_compactions` (CAP-TEL-033) | session-cumulative | session-cumulative, surviving resume because the state map entry is keyed by activation id (`sink:163,185-190,256-262`) | none | No change; pinned by `activation-telemetry.test.ts:293-320`. Recorded here so the *absence* of a divergence is evidenced, not assumed. |
| **TEL-D-C7** | `attempt_no` (CAP-TEL-075) | legacy rows `0`, new legacy jobs `1` onward (`obs-sqlite:700-701,1502-1505`) | native starts at `1`, increments on `auto_retry_start` (`sink:265-267`) and on resume (`host:2260`) | An aggregate over `attempt_no` mixes "pre-migration unknown (0)" with real attempts. | Keep `0` meaning "unattributable legacy row"; never aggregate `attempt_no = 0` as attempt identity. See TEL-D-002. |
| **TEL-D-C8** | `participant` rollups (`sp ps --mine`, `idx_jobs_participant`) (CAP-TEL-072) | `specialist::<specialist>` | identical | none | No change. Recorded as evidence of a counted-and-equal surface. |
| **TEL-D-C9** | `stall_gaps_json` entry count (CAP-TEL-035, CAP-TEL-066) | ≥0 entries from `reason==='tool_duration'` only | CLOSED by SPECIALISTS-102 / PR #387: native `tool_duration` warnings flow through the same aggregator (`obs-sqlite:2935-2937`); the pre-fix "always 0" is HISTORICAL | Native rows now aggregate like legacy rows. | DONE — native watchdog + exact `reason` spelling (`tool_duration`). See TEL-D-008. |
| **TEL-D-C10** | `xtrm_job_state` / `xtrm_processes` counts (CAP-TEL-084, CAP-TEL-086) | counts legacy `specialist_jobs` rows by `status` | native rows are additional rows in the same table with the same normalised states (`prom:815-817`) | During dual-running the same logical work is counted twice if a native dispatch and a legacy `sp run` target the same bead. `idx_jobs_active_bead_specialist` (`obs-sqlite:942`) enforces uniqueness only for `status IN ('starting','running')` and only on `(bead_id, specialist)`. | Enforce the unique-active index for native rows (native must write `status='starting'` and a matching `bead_id`), or accept double counting for the cutover window and document it. |

---

## 8. Byte-compatibility register (compact)

| Change | Class | Consumer that forces byte compatibility |
|---|---|---|
| forensic envelope field names + `schema_version='xtrm.forensic.v1'` | BYTE_COMPATIBLE_REQUIRED | `sp forensic --json`, `sp feed --json`, `sp log --legacy`, gitboard handoff fixture (`tests/smoke/telemetry-readiness.smoke.test.ts:26`), `fe:242-257` allowlist |
| `correlation.*` key names incl. `trace_id`/`span_id`/`parent_span_id` | BYTE_COMPATIBLE_REQUIRED | `fe:596-608`, `sp forensic --json` |
| `resource.*` key names incl. `model`, `repo` | BYTE_COMPATIBLE_REQUIRED | `prom:597-603`, quarantined smoke fixture |
| `redaction.status` ∈ {`clean`,`redacted`} + `redaction.fields`/`rules` | BYTE_COMPATIBLE_REQUIRED | `forensic-events.test.ts:379`; `console-telemetry-redaction.test.ts:91` |
| timeline `event_json.type` literals and per-type field names | BYTE_COMPATIBLE_REQUIRED | `sp feed`, `sp log`, `sp console`, `tl:541-760` mappers, `obs-sqlite:2846-3023` aggregation switches |
| `specialist_job_metrics` column names + JSON encodings | BYTE_COMPATIBLE_REQUIRED | `prom:389-457,687-698`, `sp db stats --format json`, `sp db benchmark-export` |
| Prometheus metric names, types, label names, exposition grammar | BYTE_COMPATIBLE_REQUIRED | scrapers; `serve.ts:319` content type; `validatePrometheusProjectionText` |
| CLI JSON output keys (`sp ps --json`, `sp db stats --json`, `sp forensic --json`, `sp feed --json`) | BYTE_COMPATIBLE_REQUIRED | `tests/unit/cli/*`; `ps.ts:1112-1157` shape |
| `job_id` / `attempt_id` value format | SEMANTIC_EQUIVALENT_OK | no representation-parsing consumer found (U-4) |
| worker/attempt storage as files vs rows | SEMANTIC_EQUIVALENT_OK | `settle-store` readers only |
| `severity` values | BYTE_COMPATIBLE_REQUIRED | stored in `event_json`; not a filter (U-3) |
| exact `reason` / `status` / `phase` literals consumed by switches | BYTE_COMPATIBLE_REQUIRED | `obs-sqlite:2890-2947`, `fe:886-894` |

---

## 9. Ordered change list (what the migration must actually do)

1. **Decide identity** — record the `job_id` → activation-id survival rule in the capability
   matrix (TEL-D-001) and forbid `attempt_id` parsing (TEL-D-002).
2. **Stop dropping emitted telemetry** — DONE: `model_fallback` maps to `model.changed` with all seven diagnostic keys (CAP-TEL-027 / blocker C-4, `nat-obs:390-405`) and all ten `settlement_*` names have mapper arms (CAP-TEL-053 / blocker C-1, `nat-obs:407-455`). The silent-loss hole is closed; the pre-fix description is HISTORICAL.
3. **Close the phase machine** — DONE (PR #388, SPECIALISTS-106): the running re-entry for `activation_resumed` shipped (`nat-obs:320-327`) and the post-loop flush closes still-open phases (`obs-sqlite:3090-3109`), so `active_runtime_ms`/`waiting_ms` agree on resumed activations (TEL-D-012, TEL-D-C2). Endpoint policy decided by SPECIALISTS-119: the flush closes at the last JOB-PRODUCED event; reader-produced `status-load` rows are excluded (`tests/unit/specialist/phase-accounting-invariant.test.ts`, I1-FLUSH).
4. **Unify the turn counter** — one basis for `turn_summary`, `total_turns` and
   `run_complete.metrics.turns` (TEL-D-015, TEL-D-C3).
5. **Make the token basis explicit** — additive discriminator, then a reader that converts
   (TEL-D-014, TEL-D-C4).
6. **Restore context accounting** — native `context_pct`, absence-stays-absence
   (TEL-D-017, C-5).
7. **Repoint or delete the `activation.*` reader** — `sp ps` native block is a reader with no
   writer (C-13). Either fix `ps.ts:746-751` to the real vocabulary or retire the block and its
   summary module with proof of no consumer.
8. **Add the missing producers** in dependency order: watchdog/stall (C-7), trace/span
   (C-12), reviewer verdicts (C-9), auto-commit (C-10), node/epic/chain (C-11), PR drift and
   `branch_integration_events` ownership (U-5), dead-declaration (C-3).
9. **Decide retention per table** (TEL-D-021, TEL-D-022) and state that
   `specialist_forensic_events` is not pruned.
10. **Add the missing test** — the current suite proves one-store-one-query
    (`native-activation-observability.test.ts:60`) but never proves row-for-row parity. A
    differential telemetry corpus is required before cutover.
