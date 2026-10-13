# Specialists observability architecture

**Status:** XTRM-96 implementation contract, reconciled against `master` at `70473578` after the XTRM-93 N3 freeze/hardening work.  
**Scope:** `sp log`, `sp feed`, `sp console`, native Pi Fleet/overlay, persisted telemetry.

## Authority model

Four layers remain deliberately separate:

| Layer | Purpose | Authority |
| --- | --- | --- |
| Forensics | high-cardinality causality, lifecycle, attempts, audit, lineage | persisted `xtrm.forensic.v1` rows in `observability.db` |
| Feed | compact human activity/progress | `TimelineEvent` / `sp feed` semantics |
| Metrics | low-cardinality aggregate health/performance | persisted metrics + Prometheus projection |
| Operator UI | navigation, filtering, correlation, drill-down | derived read models only |

No TUI owns activation truth. Native and legacy execution share the same observability database.

## N3 reconciliation

XTRM-93 N3 materially strengthened the data underneath XTRM-96:

- exact event-carried `attempt_id` is durable; the job-row attempt is only the latest pointer;
- resume re-entry durably records waiting -> running phase transitions;
- native `tool_duration` warnings persist as `process_health.stale_detected` while the activation remains running and error-free;
- provider/Pi usage, cost, terminal session stats, reconciliation and Pi version are durable;
- `control.activation_admitted.recorded` persists configured/requested/resolved model identity and override state;
- fallback/model-change evidence is durable;
- the observability schema is V16;
- the canonical N3 oracle and telemetry-contract gates are CI-enforced.

These additions extend the read model; they do not create a new UI authority.

## Shared read model

`src/specialist/observability-read-model.ts` is the UI-neutral projection boundary.

```text
observability.db
  ├─ specialist_jobs
  ├─ xtrm.forensic.v1
  ├─ TimelineEvent
  └─ persisted results / metrics
          ↓
ObservabilityReadModel
  ├─ FleetSnapshot
  ├─ ForensicWindow
  ├─ ActivationInspect
  ├─ ResultProjection
  └─ RuntimeAttachment
          ↓
sp console      Pi /specialists      other first-party readers
```

It owns no timers and no live registry.

## Bounded Fleet reads

Refreshable Fleet surfaces must not call unbounded `listStatuses()` and then slice in memory.

XTRM-96 adds `listStatusesWindow()`, which applies:

- status/since predicates in SQL;
- a hard row limit before `status_json` parsing;
- deterministic `updated_at_ms DESC, job_id DESC` ordering.

Lineage remains reconstructed from bounded persisted `job.started` evidence through `reconstructLineage()`.

## LOG continuation

Per-job forensic `seq` is the continuation identity. `idx_forensic_events_job_seq` is unique on `(job_id, seq)`.

The operator cursor is therefore:

```text
{ seq }
```

and follow reads use:

```sql
WHERE job_id = ? AND seq > ?
ORDER BY seq ASC
LIMIT ?
```

Timestamps remain display/time-filter metadata, not continuation identity. This avoids same-millisecond starvation under dense tool traffic.

Normal LOG inclusion is shared by `isForensicAgentInternal()`; `sp log`, console LOG and the Pi overlay must not independently redefine the default firehose suppression policy. All normal rows still render through `forensicEventToRow()`.

## Attempts and RESULT

An activation may have several durable attempts. `specialist_jobs.attempt_id` is not the history authority.

If RESULT is requested for an exact attempt, the read model first proves that exact `attempt_id` exists in forensic history. Missing/unverifiable attempts fail closed. The stored result remains activation-level, matching current `sp result` behavior after attempt validation.

LOG may also be scoped to one exact attempt through the same persisted identity.

## Fleet attention

Persisted native `running`/`starting` means last-known mid-flight state, so the restart-safe Fleet projection labels it `active` rather than claiming a host is currently live.

Attention is separate from state:

```text
blocked > failed > warning > active > settled > idle
```

A durable/current `stale_warning` is **warning**, not failed. N3 explicitly proves that a native tool-duration warning leaves the job running and without an error.

## DETAIL

DETAIL is a typed, explicit safe projection. It may include:

- activation/job and exact attempt identities;
- Specialist/work item;
- state/current event/current tool;
- configured/requested/resolved model and override state;
- Pi session/workspace/trace correlation;
- persisted metrics, provider/Pi usage, cost, session stats and reconciliation;
- context percentage and provenance;
- worktree/branch;
- parent lineage and real runtime attachment.

DETAIL may select explicit fields from already-redacted persisted events. It must not expose arbitrary forensic bodies or weaken the normal-row allowlist.

## Native live annotation

The Pi extension has a stronger answer than ambient identity for “my current children”: its process-lifetime `NativeActivationHost` already owns the current activation snapshots and pending asks.

The intended presentation composition is:

```text
persisted Fleet / lineage / history
             +
current host snapshots + pending asks
             ↓
operator presentation
```

Live host state can annotate current state, exact current attempt, pending asks, turns/spend and coordinator-local membership. It must not overwrite persisted forensic history or become the restart authority.

Do not use `sp ps --mine` as the Pi overlay scoping mechanism. XTRM-93 correctly fails that filter closed when no explicit Substrate holder identity can be resolved.

## sp console

`sp console` remains the standalone/full-screen workspace.

XTRM-96 routes its forensic source to persisted `xtrm.forensic.v1` through the shared read model. `sp_feed` remains the existing compact TimelineEvent projection.

## Native Pi overlay

`config/pi-extensions/specialist-subagents/fleet-overlay.mjs` is the pure state/layout model for:

- persisted hierarchy;
- ancestor-preserving filtering;
- selection;
- LOG / FEED / RESULT / DETAIL;
- follow/pause/scroll;
- warning/blocked/failed attention;
- responsive/narrow rendering.

It intentionally does not call `ctx.ui.custom()`. A prior real Pi hard-lock was recorded on that mount path, so the final adapter must be tested against the installed Pi/TUI in a real TTY.

## Refresh rule

Runtime events are refresh hints only:

```text
runtime hint
  -> coalesce dirty signal
  -> reread persisted delta/window
  -> update projection
  -> request render
```

The UI remains usable with polling only.

## Remaining local proof

Source-side reconciliation does not prove the Pi graphical lifecycle. Before enabling the overlay by default:

1. run the canonical reproducible build and commit generated tracked `dist/`;
2. mount the pure overlay through current `ctx.ui.custom()`;
3. prove focus, Escape/close, keyboard input, resize and disposal in a real TTY;
4. prove runtime hints re-read persisted evidence;
5. run mixed Fleet E2E: Pi parent -> nested Specialist plus `sp run`/tmux Specialist;
6. rerun the full package/telemetry/N3 gate set.

## Non-goals

XTRM-96 does not create another telemetry database, forensic schema, Fleet registry, fake tmux identity, mandatory daemon, Pi TUI fork, or Prometheus reconstruction of per-job causality.
