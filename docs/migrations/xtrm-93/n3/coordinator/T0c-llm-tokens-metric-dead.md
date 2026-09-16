# T0c — `xtrm_llm_tokens_total` is emitted with ZERO series (coordinator-verified)

Origin: lane T3 claimed the Prometheus token reader cannot read the shape the writer writes. The coordinator verified it independently, against real data and the real call site. The claim is **confirmed**, and it supersedes the audit's framing of this signal.

Tree: `feature/xtrm-93-n0n2-recon` @ `553b5a23`.
Store: `<git-common-root>/.specialists/db/observability.db`, read-only.

## 1. The writer nests the usage object

`src/specialist/observability-sqlite.ts` — the ONLY writer of `token_trajectory_json`:

```ts
2911:  if (event.token_usage) tokenTrajectory.push({ turn_index: event.turn_index, t: event.t, token_usage: event.token_usage });
2917:  tokenTrajectory.push({ t: event.t, source: event.source, token_usage: event.token_usage });
```

Both push sites nest the counters under a `token_usage` key. A real persisted element:

```json
[{"t":1788916842123,"source":"turn_end",
  "token_usage":{"input_tokens":11140,"output_tokens":170,
                 "cache_creation_tokens":0,"cache_read_tokens":753,
                 "total_tokens":12063,"usage_source":"provider_usage"}},
 {"turn_index":1,"t":1788916842141,"token_usage":{...}}]
```

## 2. The reader looks for FLAT keys on that element

`src/specialist/prometheus-projection.ts`:

```ts
434: function latestTokenTrajectory(record: JobMetricsRecord): Record<string, number> | null {
436:   const latest = trajectory.at(-1);
439:   const split = {
440:     input:           Number(latest.input_tokens ?? latest.input ?? 0),
441:     output:          Number(latest.output_tokens ?? latest.output ?? 0),
442:     cache_read:      Number(latest.cache_read_tokens ?? latest.cache_read ?? 0),
443:     cache_creation:  Number(latest.cache_creation_tokens ?? latest.cache_creation ?? 0),
444:     reasoning:       Number(latest.reasoning_tokens ?? latest.reasoning ?? latest.thinking_tokens ?? 0),
445:     tool:            Number(latest.tool_tokens ?? latest.tool ?? latest.tool_use_tokens ?? 0),
446:   };
448:   const hasSplit = Object.values(split).some((value) => value > 0);
449:   if (hasSplit) return split;
451:   const total = Number(latest.total_tokens ?? latest.total ?? 0);
452:   return total > 0 ? { total } : null;
453: }
```

It reads `input_tokens` … `total_tokens` off the element's **top level**. It never unwraps `latest.token_usage`. The element's top-level keys are `t`, `source` / `turn_index`, and `token_usage`. Every lookup misses, `hasSplit` is false, the total is 0, and the function returns `null`.

## 3. The caller then skips the record

```ts
410: function tokenSamples(records: JobMetricsRecord[], repo: string): NumericSample[] {
412:   for (const record of records) {
413:     const last = latestTokenTrajectory(record);
414:     if (!last) continue;          // <- every record takes this branch
```

So `xtrm_llm_tokens_total` is built from an empty map and is **emitted with zero series**.

## 4. Empirical confirmation (748/748)

| Query | Result |
|---|---|
| rows with a non-empty `token_trajectory_json` | **748** |
| …whose LAST element has a nested `token_usage` | **748** |
| …whose LAST element has flat `input_tokens` | **0** |
| …whose LAST element has flat `total_tokens` | **0** |
| …whose LAST element has flat `input` | **0** |
| rows where a flat key exists at ANY element **and** no nested key exists | **0** |

Control, on the same three rows:

```
nested  json_extract(...,'$[#-1].token_usage.input_tokens') -> 564 | 2097 | 466
flat    json_extract(...,'$[#-1].input_tokens')            -> NULL | NULL | NULL
```

Same rows, same JSON document, nested key populated and flat key absent. The reader is guaranteed to miss.

The reader takes `.at(-1)` — the LAST element — and that is exactly what was tested, so this is not an artifact of testing the wrong end of the array.

## 5. Why this supersedes the audit

The audit recorded this signal as **TEL-D-014 / TEL-D-C4**, "`xtrm_llm_tokens_total` is per-turn for legacy and session-cumulative for native", and proposed an additive `aggregation` discriminator so a reader could convert between bases.

That framing describes a metric which **does not exist**. There is no basis question to resolve, because no series is produced for either engine. The proposed discriminator would not have fixed it either: it would have been added *inside* `token_usage` and the reader would still not look there.

Corrected classification: **NATIVE_GAP and LEGACY_GAP simultaneously** — a shared reader defect, not a cross-engine divergence. It is invisible in differential testing, because comparing legacy against native yields "both empty" and would read as parity.

## 6. Blast radius

- Prometheus scrapers see no `xtrm_llm_tokens_total` series at all. Any dashboard, alert or `rate()` on it is a no-op, not a wrong number.
- `specialist_job_metrics.token_trajectory_json` itself is intact and correct — the data is durably present, only the projection is broken. A reader fix needs no writer change and no migration.
- Anything that sums `total_turns`, `context_trajectory_json` or other `specialist_job_metrics` columns is unaffected; this is specific to the token trajectory reader.
- It applies equally to legacy and native rows, so **this defect predates the native path** and is not a migration regression.

## 7. What is NOT yet established

- How long the metric has been empty. The 748 rows are current-shaped; the defect is a plain key-nesting mismatch with no version condition, so it reads as long-standing, but no commit bisect was performed.
- Whether any out-of-tree consumer depends on the empty series (a dashboard expecting a gap, an alert that would fire on absence). Not observable from this tree.
- Whether `context_trajectory_json` has an equivalent reader mismatch. Lane T3 flagged the same projection region; it was not verified by the coordinator.

## 8. Required regression shape

The regression must **fail against the current reader**, so it cannot be a shape-only unit test of `latestTokenTrajectory`. It must drive the real writer path (`aggregateJobMetrics` → `specialist_job_metrics.token_trajectory_json`) and then assert that `tokenSamples` produces a non-empty sample with the expected `direction` labels. A test that constructs a flat fixture would pass today and prove nothing.
