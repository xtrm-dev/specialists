---
name: using-kpi
description: >-
  Analyze specialist KPI data in observability SQLite. Use for runtime, payload,
  waiting, tool-call, and outlier analysis. Token estimates use cl100k_base-style
  approximation with ~±5% accuracy.
gemini-command: using-kpi
version: 3.1.0
---

# using-kpi

KPI analysis skill for `sp db stats` / `sp db extract` data.

## Quick rule

`active_runtime_ms` = real paid runtime. Rank by that first. `elapsed_ms` is total wall time. `waiting_ms` catches forgotten keep-alives.

Token counts are approximate, cl100k_base-style, about ±5%. Bytes are exact UTF-8 size.

## Recipe 1 — specialist × model leaderboard by active cost

```bash
sp db stats --format json \
  | jq -r '
      .rows
      | group_by([.specialist, .model])
      | map({
          specialist: .[0].specialist,
          model: .[0].model,
          jobs: length,
          active_ms: (map((.active_runtime_ms // 0)) | add),
          total_ms: (map((.total_runtime_ms // .elapsed_ms // 0)) | add),
          turns: (map((.total_turns // 0)) | add),
          tools: (map((.total_tools // 0)) | add),
          payload_kb: (map((.payload_kb // 0)) | add)
        })
      | sort_by(-.active_ms, -.jobs)
      | .[]
      | [ .specialist, .model, .jobs, .active_ms, .total_ms, .turns, .tools, .payload_kb ]
      | @tsv'
```

## Recipe 2 — outliers above p95

```bash
sp db stats --format json \
  | jq '
      .rows as $rows
      | {
          active: ($rows | map(.active_runtime_ms // 0) | sort),
          tools: ($rows | map(.total_tools // 0) | sort),
          turns: ($rows | map(.total_turns // 0) | sort),
          payload: ($rows | map(.payload_kb // 0) | sort)
        } as $s
      | {
          active_p95: $s.active[(($s.active|length)*95/100|floor)],
          tools_p95: $s.tools[(($s.tools|length)*95/100|floor)],
          turns_p95: $s.turns[(($s.turns|length)*95/100|floor)],
          payload_p95: $s.payload[(($s.payload|length)*95/100|floor)]
        } as $p
      | $rows
      | map(select(
          ((.active_runtime_ms // 0) >= $p.active_p95) or
          ((.total_tools // 0) >= $p.tools_p95) or
          ((.total_turns // 0) >= $p.turns_p95) or
          ((.payload_kb // 0) >= $p.payload_p95)
        ))
      | .[]
      | [ .job_id, .specialist, .model, .active_runtime_ms, .total_tools, .total_turns, .payload_kb ]
      | @tsv'
```

## Recipe 3 — payload bloat ranking

```bash
sp db stats --with-payload --format json \
  | jq -r '
      .rows
      | group_by(.specialist)
      | map({
          specialist: .[0].specialist,
          jobs: length,
          avg_payload_kb: ((map((.payload_kb // 0)) | add) / length),
          max_payload_kb: (map((.payload_kb // 0)) | max)
        })
      | sort_by(-.avg_payload_kb)
      | .[:10]
      | .[]
      | [ .specialist, .jobs, (.avg_payload_kb|tostring), (.max_payload_kb|tostring) ]
      | @tsv'
```

## Recipe 4 — waiting-state hygiene

```bash
sp db stats --format json \
  | jq -r '
      .rows
      | map(select((.waiting_s? // 0) != 0))
      | map(. + {waiting_ratio: ((.waiting_ms // 0) / ((.total_runtime_ms // .elapsed_ms // 1) + 0.0))})
      | sort_by(-.waiting_ratio, -.waiting_ms)
      | .[]
      | [ .job_id, .specialist, .model, (.waiting_ms|tostring), (.total_runtime_ms // .elapsed_ms|tostring), (.waiting_ratio|tostring) ]
      | @tsv'
```

## Recipe 5 — tool-call distribution per specialist

```bash
sp db stats --format json \
  | jq -r '
      .rows
      | group_by(.specialist)
      | map({
          specialist: .[0].specialist,
          counts: (map(.tool_call_counts_json? // "{}")
            | map(fromjson)
            | add)
        })
      | .[]
      | .counts
      | to_entries
      | sort_by(-.value)
      | .[]
      | [ .key, .value ]
      | @tsv'
```

## Recipe 6 — payload vs active runtime correlation

```bash
sp db stats --with-payload --format json \
  | jq -r '
      .rows
      | map(select((.payload_kb? // 0) > 0 and ((.active_runtime_ms? // 0) > 0)))
      | map([(.payload_kb|tonumber), (.active_runtime_ms|tonumber)])
      | if length < 2 then empty else
          (map(.[0]) | add / length) as $mx |
          (map(.[1]) | add / length) as $my |
          (map((.[0]-$mx)*(.[1]-$my)) | add) /
          ((map((.[0]-$mx)^2) | add) * (map((.[1]-$my)^2) | add)) ^ 0.5
        end'
```

## References

- `docs/observability-metrics.md`
- `src/cli/db.ts`
- `src/specialist/observability-sqlite.ts`
