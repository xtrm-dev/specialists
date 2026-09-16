# Specialists observability architecture

**Status:** canonical ownership note for XTRM-96.  
**Scope:** `sp log`, `sp feed`, `sp console`, native Pi Fleet/overlay, metrics.  
**Current implementation base:** `xtrm.forensic.v1` + shared `observability.db`.

## 1. Authority model

Specialists has four different observability products. They are related, but they are not interchangeable:

| Layer | Purpose | Authority |
| --- | --- | --- |
| **Forensics** | high-cardinality causality, lifecycle, audit, lineage | persisted `xtrm.forensic.v1` rows in `observability.db` |
| **Feed** | compact human progress/activity | `TimelineEvent` / `sp feed` projection |
| **Metrics** | low-cardinality aggregate health and performance | metrics/Prometheus projections |
| **Operator UI** | navigation, correlation, filtering, drill-down | derived read models only |

The operator UI does not own activation state. A Fleet row, console row, or Pi overlay row is a projection of persisted/runtime evidence; it must never become a second job registry, forensic schema, or telemetry database.

`sp log` is the canonical CLI rendering of Forensics. `sp feed` is the canonical compact activity projection. They intentionally answer different questions.

## 2. Shared store

Native Pi/MCP activation and CLI/legacy execution write the same `.specialists/db/observability.db`. There is no native-subagent telemetry database and there must not be a TUI-only telemetry store.

```text
                         observability.db
                               │
               ┌───────────────┴────────────────┐
               │                                │
        xtrm.forensic.v1                 TimelineEvent
        causality / audit                activity / progress
               │                                │
               └───────────────┬────────────────┘
                               ▼
                    ObservabilityReadModel
                    ├─ forensic chronology
                    ├─ fleet snapshot
                    ├─ persisted lineage
                    ├─ runtime attachment
                    └─ result projection
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
          sp log/feed       sp console      Pi /specialists
```

`src/specialist/observability-read-model.ts` is the UI-neutral projection layer introduced by XTRM-96. It owns no timers and caches no runtime truth.

## 3. LOG semantics

Normal LOG rows must be rendered through `forensicEventToRow()` so the existing allowlist/redaction contract remains load-bearing.

The default operator LOG suppresses high-frequency agent-internal noise:

- turn-family rows;
- tool-family rows;
- model token/finish/meta rows;
- MCP call/latency internals.

Lifecycle, control, error, command, review, git, chain, worktree and related runtime events remain visible. A deliberate `all events`/verbose mode may expose the full forensic firehose, but it must still obey forensic redaction.

`sp console` now routes its forensic source through persisted `xtrm.forensic.v1` rows instead of rebuilding forensic rows from legacy timeline events when an observability database is present. Its `sp_feed` source remains unchanged.

## 4. Fleet and lineage

Fleet topology is reconstructed from durable forensic lineage:

```text
job.started
  correlation.parent_job_id
  links.spawned_by
        │
        ▼
reconstructLineage()
        │
        ▼
FleetSnapshot
```

A Specialist child is nested under a Specialist parent only when persisted lineage says so. Names, paths, tmux session names, and process-tree heuristics are not authoritative.

`links.spawned_by.kind = xtmux.agent_instance` provides a direct runtime attachment for CLI/tmux work. `root_runtime_origin` provides a root pane attachment when only the root origin is known. Native Pi/MCP activations with no tmux attachment remain first-class Fleet nodes.

The current Pi coordinator may later be shown as a UI-only presentation root. It is not persisted workflow authority.

## 5. Liveness language

Persisted events describe **last-known state**. They do not prove a host is currently alive after a crash or restart. Operator surfaces must not render an activation as live merely because the latest persisted event was mid-flight.

Native activation summaries therefore use last-known vocabulary (`active`, `waiting`, `settled`, `failed`, etc.) and must keep the crashed-host caveat explicit. True live-host controls remain runtime-owned.

## 6. Console and native Pi surfaces

### `sp console`

`sp console` remains the standalone/full-screen operator workspace. Its existing multi-repo, history, result, bead, diff and config features remain valid. XTRM-96 changes its forensic data source, not its ownership boundary.

### Native Pi `/specialists`

The existing compact Fleet footer remains the glance surface. The intended interactive overlay is a contextual fleet inspector with:

- nested Fleet topology;
- attention-first selection;
- `LOG` as the default chronology;
- `FEED`, `RESULT`, and `DETAIL` projections;
- `/` filtering;
- follow/pause semantics;
- bounded history;
- runtime attachment only when a real attachment exists.

The repository currently records a prior Pi `ui.custom` hard-lock (`unitAI-nmxhg`). For that reason XTRM-96 does **not** silently replace the safe text inspector remotely. The overlay mount must be validated against the current installed Pi/TUI locally before it becomes the default `/specialists inspect` path. The read model is deliberately independent of that decision.

## 7. Refresh model

Persisted evidence is truth. Runtime events, socket hints, or Pi host events may only be refresh hints:

```text
runtime hint
   ↓
mark source dirty
   ↓
coalesce refresh
   ↓
read persisted delta/window
   ↓
update projection
   ↓
request render
```

The UI must remain usable with polling only. A daemon/materializer may optimize refresh latency later but is not a required authority.

The first XTRM-96 read-model slice resumes forensic reads from a tuple cursor `(t, seq, id)` while using the storage API's current `sinceMs` filter. A future storage-level tuple-cursor query may replace that query internally without changing the consumer contract.

## 8. Metrics boundary

Prometheus/aggregate metrics are deliberately low cardinality. Forensic identifiers such as job, bead, participant, session, trace/span, tmux pane, prompt, raw command, raw diff, and model output must not be promoted into metric labels.

Missing metrics mean **unknown**, never zero.

`docs/observability-metrics.md` is retained as historical/RPC metric source mapping. This document owns the current cross-surface authority model.

## 9. Shipped vs targeted

Shipped by the first XTRM-96 implementation slice:

- UI-neutral persisted observability read model;
- bounded forensic chronology with shared redaction renderer;
- mixed Fleet projection from persisted status/forensic evidence;
- persisted parent/child lineage and tmux attachment projection;
- native last-known activation summaries;
- result projection;
- `sp console` forensic source bound to persisted `xtrm.forensic.v1` when the database is present;
- legacy `sp_feed` console source preserved.

Still targeted/local validation:

- mount the interactive Pi overlay on the current Pi version and prove focus/close/input lifecycle;
- wire overlay follow/pause/filter/detail interaction to the read model;
- optionally promote `(t, seq, id)` filtering into the SQLite query itself after measuring burst behavior;
- unify the duplicate default-noise predicate in `sp log` with the read-model predicate after XTRM-93 telemetry PRs settle;
- E2E mixed-fleet proof: Pi parent -> nested Specialist plus `sp run`/tmux Specialist in one operator surface.

## 10. Non-goals

XTRM-96 does not authorize:

- another forensic schema or database;
- Pi-specific activation truth;
- a second Fleet registry;
- fake tmux sessions for native activations;
- Prometheus reconstruction of per-job causality;
- xtmux process/session heuristics as Specialists authority;
- a mandatory observability daemon;
- a Pi TUI fork;
- a metric-heavy "Grafana in the terminal" dashboard before the fleet/chronology loop is correct.
