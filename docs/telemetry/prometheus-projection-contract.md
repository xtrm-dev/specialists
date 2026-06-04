---
title: Prometheus Projection Contract
scope: telemetry-prometheus-projection
category: reference
version: 1.0.0
updated: 2026-06-04
source_of_truth_for:
  - "xtrm Prometheus metric projection"
  - "specialists AgentOps metrics"
  - "forensic-to-metrics boundary"
  - "sp serve /metrics exporter implementation"
domain:
  - telemetry
  - observability
  - metrics
  - agentops
  - prometheus
summary: "Defines low-cardinality Prometheus projections from xtrm.forensic.v1 events and runtime state. Complements docs/telemetry/forensic-event-contract.md; does not replace forensic logs/traces."
---

# Prometheus Projection Contract

## Design context

This is the shipped specialists-side metrics projection for the canonical DevOps
design in `/home/dawid/second-mind/1-projects/xtrm/devops/devops-system.md`. It
turns AgentOps forensic/runtime state into low-cardinality Prometheus metrics for
infra dashboards and alerts. For exact event evidence and journal/recommendation
drill-down, link back to `docs/telemetry/forensic-event-contract.md`.

### Shipped bridge status — 2026-06-04

Specialists currently ships `sp metrics --prometheus` and `sp serve` `GET
/metrics`. The projection is table-derived and replay-safe for the current local
runtime: it reads `specialist_jobs`, `specialist_job_metrics`, and selected
forensic event families rather than maintaining a long-running event cursor.

Currently shipped projections include:

- job state, queue depth, process/worktree gauges;
- terminal job counters and job duration/wait/active-runtime histograms;
- turn/context/tool/token metrics, including split token directions and fallback-only `direction="total"`;
- identity, policy, eval, and MCP operation counters from supplied forensic events;
- parser/cardinality tests that reject forbidden labels such as `job_id`, `trace_id`, `mcp_session_id`, `jsonrpc_request_id`, `eval_id`, `policy_decision_id`, and `identity_request_id`.

Boundary: MCP metrics are projection-ready but not live from a real MCP runtime
until an MCP emitter is added. The current implementation can project
`mcp.*` forensic events when they are supplied.

## 1. Purpose

`docs/telemetry/forensic-event-contract.md` defines the forensic event/log layer: rich JSON, opaque correlation IDs, evidence links, redaction state, trace/span fields, and high-cardinality body data.

This document defines the **other side** of the telemetry system: a curated, low-cardinality Prometheus projection suitable for dashboards, SLOs, and alerts.

The split is mandatory:

- forensic events answer **what exactly happened?**
- Prometheus metrics answer **is the system healthy, trending badly, or breaching an SLO?**
- trace/log links bridge from aggregate symptoms to forensic detail.

This contract is intentionally projection-first. It does not require an implementation to ship all metrics at once, but any exported metric must follow these names, types, labels, and cardinality rules.

For scrape, alert, and dashboard ownership boundaries, see `docs/telemetry/prometheus-infra-console-handoff.md`.

## 2. Inputs and source of truth

Prometheus is not the source of truth. The source of truth remains runtime state and forensic events.

| Source | Role in projection |
|---|---|
| `xtrm.forensic.v1` events | Counter/histogram increments for job, turn, tool, MCP, pulse, result, service-skills, error, git, process-health families. |
| `.specialists/db/observability.db` / future `~/.xtrm/state.db` | Snapshot source for gauges: active jobs, waiting jobs, worktrees, orphan processes, dirty worktrees, queue depth. |
| `specialist_job_metrics` | Backfill source for turns, token trajectories, context trajectories, waiting/runtime durations. |
| `specialist_jobs` / future `jobs` domain table | Current job state and participant identity fields. |
| `service_skills` / drift detector output | Drift counters/gauges once emitted via `service_skills.*` forensic events. |
| substrate `pulse_queue` / `containers` | Pulse queue depth, pulse consumption latency, container state gauges when substrate lands. |

The exporter may read legacy timeline events while the migration is in progress, but it must normalize through the forensic envelope semantics before projecting metrics.

## 3. Label policy

### 3.1 Allowed common labels

Allowed by default when present:

| Label | Why allowed |
|---|---|
| `service_namespace` | Usually `xtrm`; bounded. |
| `service_name` | `specialists`, `substrate`, `channels`, `core`, `service-skills`; bounded. |
| `service_component` | Component/module; bounded by code package. |
| `deployment_environment` | `local`, `staging`, `production`; bounded. |
| `repo` | Project/repo slug; bounded enough for per-host xtrm use. |
| `participant_kind` | 5-layer L1; bounded. |
| `participant_role` | 5-layer L2; bounded by participant catalog. |
| `state` | Bounded runtime state enum. |
| `result` | `success`, `error`, `cancelled`, `skipped`, `unknown`; bounded. |
| `status` | Bounded status enum when distinct from result. |
| `model_provider` | Bounded provider slug. |
| `model` | Allowed only through a configured allowlist / normalization table. |
| `tool_name` | Allowed only for native/catalog tools after normalization; use `other` fallback. |
| `mcp_server` | Configured MCP server id; bounded. |
| `mcp_method` | Bounded MCP method such as `tools/call`, `resources/read`. |
| `error_type` | Normalized enum/category, not raw message text. |
| `drift_tier` | `none`, `low`, `medium`, `high`, `critical`; bounded. |
| `pulse_kind` | `trigger`, `job`, `message`; bounded. |
| `direction` | Token direction: `input`, `output`, `cache_read`, `cache_creation`, `reasoning`, `tool`, or fallback `total`; bounded. |
| `policy_kind` | Normalized policy/check category; bounded. |
| `action_kind` | Normalized action category; bounded. |
| `credential_kind` | Normalized credential/token kind; bounded. |
| `eval_kind` | Normalized eval category; bounded. |
| `chain_template` | Normalized chain/workflow template such as `executor-review`; bounded and never a chain id. |
| `gate_kind` | Normalized gate category such as `reviewer`, `code_sanity`, `security`, `obligations`; bounded. |

### 3.2 Forbidden labels

Never export these as labels:

- `participant_id`
- `job_id`
- `bead_id`
- `issue_id`
- `container_id`
- `chain_id`
- `chain_root_job_id`
- `chain_root_bead_id`
- `epic_id`
- `node_id`
- `pulse_id`
- `turn_id`
- `tool_call_id`
- `trace_id`
- `span_id`
- `session_id`
- `conversation_id`
- `mcp_session_id`
- `jsonrpc_request_id`
- `eval_id`
- `policy_decision_id`
- `identity_request_id`
- `parent_span_id`
- `commit_sha`
- PR number / ticket id / external object id
- raw file path
- raw command
- raw URL
- raw error text
- raw diff text
- prompt/model/tool payloads
- user id, email, credential, token, or secret material

### 3.3 Legacy aliases

`specialist` is a bridge-era alias for `participant_role` when `participant_kind="specialist"`. New metrics should not use `specialist` as a label. If old dashboards need it, expose it through a recording rule or compatibility layer, not as the primary exporter schema.

## 4. Metric naming rules

- Prefix all xtrm-owned metrics with `xtrm_`.
- Use Prometheus base units and suffixes: `_seconds`, `_bytes`, `_total`, `_ratio`. Reserve `_usd_total` for future direct API billing/pricing provenance only.
- Use counters for monotonically increasing counts.
- Use gauges for current state, freshness, queue depth, and budget remaining.
- Use histograms for durations and sizes where percentiles are needed.
- Do not use summaries for cross-instance SLOs.
- Do not encode dimensions in metric names when labels can carry bounded dimensions.
- Missing data means unknown, not zero, unless the source state is explicitly a current snapshot gauge.

## 5. Metric catalog

### 5.1 Job lifecycle

| Metric | Type | Labels | Source | Notes |
|---|---|---|---|---|
| `xtrm_jobs_total` | counter | `service_name`, `repo`, `participant_kind`, `participant_role`, `result` | `job.completed`, `job.failed`, `job.cancelled` | One increment per terminal activation. |
| `xtrm_job_duration_seconds` | histogram | `service_name`, `repo`, `participant_kind`, `participant_role`, `result` | terminal job event / `elapsed_ms` | End-to-end activation duration. |
| `xtrm_job_wait_seconds` | histogram | `service_name`, `repo`, `participant_kind`, `participant_role` | queued/waiting state transitions | Time before running/resume. |
| `xtrm_job_active_runtime_seconds` | histogram | `service_name`, `repo`, `participant_kind`, `participant_role`, `result` | `specialist_job_metrics.active_runtime_ms` | Excludes waiting where measurable. |
| `xtrm_job_state` | gauge | `service_name`, `repo`, `participant_kind`, `participant_role`, `state` | current jobs table | Current count by state. |
| `xtrm_job_queue_depth` | gauge | `service_name`, `repo`, `participant_kind`, `participant_role` | jobs/pulse queue | Current queued or waiting-to-start jobs. |
| `xtrm_job_stale_total` | counter | `service_name`, `repo`, `participant_kind`, `participant_role`, `reason` | `process_health.stale_detected` | `reason` must be bounded. |
| `xtrm_chains_total` | counter | `service_name`, `repo`, `chain_template`, `result` | terminal chain state / `chain.finalized` | One increment per terminal chain instance; no `chain_id` label. |
| `xtrm_chain_duration_seconds` | histogram | `service_name`, `repo`, `chain_template`, `result` | terminal chain state / job metric rollup | End-to-end chain duration using bounded template/result labels only. |

Recommended buckets:

```text
xtrm_job_duration_seconds: 1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200, 14400, +Inf
xtrm_job_wait_seconds:     1, 5, 30, 60, 300, 900, 1800, 3600, 7200, 21600, +Inf
xtrm_chain_duration_seconds: 1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 7200, 14400, +Inf
```

### 5.2 Turn, context, and model usage

| Metric | Type | Labels | Source | Notes |
|---|---|---|---|---|
| `xtrm_turns_total` | counter | `service_name`, `repo`, `participant_kind`, `participant_role`, `result` | `turn.completed` / `turn.summarized` | One per completed turn. |
| `xtrm_context_usage_ratio` | gauge | `service_name`, `repo`, `participant_kind`, `participant_role` | latest `turn.summarized` | Current/latest context percentage as ratio 0..1. |
| `xtrm_context_compactions_total` | counter | `service_name`, `repo`, `participant_kind`, `participant_role`, `result` | `compaction.completed` | Result bounded. |
| `xtrm_retries_total` | counter | `service_name`, `repo`, `participant_kind`, `participant_role`, `result` | `retry.completed` / `retry.exhausted` | Retry attempts. |
| `xtrm_llm_tokens_total` | counter | `service_name`, `repo`, `participant_kind`, `participant_role`, `model_provider`, `model`, `direction` | `model.token_usage.recorded` | `direction=input|output|cache_read|cache_creation|reasoning|tool`; use fallback `direction=total` only when no split exists; model allowlisted. |

Do not label token metrics by `job_id`, `bead_id`, or `participant_id`. Drill down via exemplars/log links.

Total-token mapping:

- Preferred total: `sum without(direction)(xtrm_llm_tokens_total{direction!="total"})` over split directions.
- Fallback total: `xtrm_llm_tokens_total{direction="total"}` only when the source exposes no split.
- Never add split directions and `direction="total"` together in the same panel/alert.
- USD cost metrics are deferred until direct API billing or another explicit, versioned pricing source exists. Subscription-plan usage should be represented with token counts and plan-level notes, not authoritative `*_usd_total` counters.

### 5.3 Tool calls

| Metric | Type | Labels | Source | Notes |
|---|---|---|---|---|
| `xtrm_tool_calls_total` | counter | `service_name`, `repo`, `participant_kind`, `participant_role`, `tool_name`, `result` | `tool.call.completed/failed` | `tool_name` normalized to catalog id or `other`. |
| `xtrm_tool_call_duration_seconds` | histogram | `service_name`, `repo`, `participant_kind`, `participant_role`, `tool_name`, `result` | tool start/end events | No raw command/path labels. |
| `xtrm_tool_errors_total` | counter | `service_name`, `repo`, `participant_kind`, `participant_role`, `tool_name`, `error_type` | failed tool events | `error_type` normalized. |

Recommended buckets:

```text
xtrm_tool_call_duration_seconds: 0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 300, +Inf
```

### 5.4 MCP operations

| Metric | Type | Labels | Source | Notes |
|---|---|---|---|---|
| `xtrm_mcp_operations_total` | counter | `service_name`, `repo`, `mcp_server`, `mcp_method`, `result` | `mcp.connected/disconnected/call.completed/call.failed/auth.failed/rate_limited/latency.observed` forensic events | **Shipped for supplied forensic events.** Current code normalizes future `type:"mcp"` timeline events and projects this counter. |
| `xtrm_mcp_operation_duration_seconds` | histogram | `service_name`, `repo`, `participant_kind`, `participant_role`, `mcp_server`, `mcp_method`, `result` | MCP events/spans | Future: requires real MCP lifecycle durations. |
| `xtrm_mcp_sessions` | gauge | `service_name`, `repo`, `mcp_server`, `state` | MCP session lifecycle | Future: requires real MCP session emitter. |
| `xtrm_mcp_session_duration_seconds` | histogram | `service_name`, `repo`, `mcp_server`, `result` | session end event | Future: requires real MCP session emitter. |

Forbidden labels include `mcp.session.id`, `jsonrpc.request.id`, `mcp_session_id`, `jsonrpc_request_id`, `trace_id`, `tool_call_id`, and raw tool args/result.

Recommended buckets:

```text
xtrm_mcp_operation_duration_seconds: 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, +Inf
```

### 5.5 Result, evidence, and git

| Metric | Type | Labels | Source | Notes |
|---|---|---|---|---|
| `xtrm_results_persisted_total` | counter | `service_name`, `repo`, `participant_kind`, `participant_role`, `target`, `result` | `result.persisted` | `target=sqlite|bead|file|state_db`. |
| `xtrm_evidence_refs_total` | counter | `service_name`, `repo`, `evidence_kind`, `result` | evidence write events | `evidence_kind=verdict|test|diff|commit|pr|report|rca|dashboard`. |
| `xtrm_git_auto_commits_total` | counter | `service_name`, `repo`, `participant_kind`, `participant_role`, `result` | `git.auto_commit.*` | Commit SHA is exemplar/body only. |
| `xtrm_gitnexus_analyses_total` | counter | `service_name`, `repo`, `result`, `highest_risk` | `gitnexus.analysis.completed` | `highest_risk` bounded. |

### 5.6 Worktree and process health

| Metric | Type | Labels | Source | Notes |
|---|---|---|---|---|
| `xtrm_worktrees` | gauge | `service_name`, `repo`, `state` | worktree registry/process health | `state=active|dirty|stale|missing|preserved_failed`. |
| `xtrm_worktree_age_seconds` | gauge | `service_name`, `repo`, `state` | worktree registry | Max/individual export must not label by path. Prefer aggregate by state. |
| `xtrm_processes` | gauge | `service_name`, `repo`, `process_kind`, `state` | process health scan | `process_kind=specialist|dolt|gitnexus|lsp|pi`; state bounded. |
| `xtrm_process_orphans_total` | counter | `service_name`, `repo`, `process_kind`, `result` | orphan cleanup events | Increment on detection/reap outcome. |
| `xtrm_process_restarts_total` | counter | `service_name`, `repo`, `process_kind`, `reason` | process lifecycle events | Reason bounded. |

### 5.7 Service-skills drift

| Metric | Type | Labels | Source | Notes |
|---|---|---|---|---|
| `xtrm_service_skills_drift_total` | counter | `repo`, `service_name`, `drift_tier`, `result` | `service_skills.drift_detected` / verdict | `service_name` is service registry id, not arbitrary path. |
| `xtrm_service_skills_sync_total` | counter | `repo`, `service_name`, `result` | `service_skills.synced` | Sync attempts/results. |
| `xtrm_service_skills_drift` | gauge | `repo`, `service_name`, `drift_tier` | latest drift state | Current drift count/state. |

### 5.8 Pulses, substrate, and channels

| Metric | Type | Labels | Source | Notes |
|---|---|---|---|---|
| `xtrm_pulses_total` | counter | `service_name`, `repo`, `pulse_kind`, `result` | `pulse.emitted/consumed/failed` | No `pulse_id` or idempotency key label. |
| `xtrm_pulse_queue_depth` | gauge | `service_name`, `repo`, `pulse_kind` | substrate `pulse_queue` | Current queued pulses. |
| `xtrm_pulse_delivery_seconds` | histogram | `service_name`, `repo`, `pulse_kind`, `result` | enqueue→delivered | Delivery latency. |
| `xtrm_channel_messages_total` | counter | `service_name`, `repo`, `kind`, `result` | channel message writes | `kind` bounded message kind. |
| `xtrm_channel_unread_messages` | gauge | `service_name`, `repo`, `participant_kind`, `participant_role` | channel subscriptions | No participant_id label. |

### 5.9 Eval and gate outcomes

| Metric | Type | Labels | Source | Notes |
|---|---|---|---|---|
| `xtrm_gate_verdicts_total` | counter | `service_name`, `repo`, `participant_role`, `gate_kind`, `verdict` | evidence/verdict events | `verdict=PASS|PARTIAL|FAIL|WAIVED`. |
| `xtrm_eval_runs_total` | counter | `service_name`, `repo`, `eval_kind`, `result` | future eval events | Keeps AgentCore evaluator/diagnostic split visible. |
| `xtrm_eval_score` | gauge | `service_name`, `repo`, `eval_kind` | eval result | Latest score where meaningful. |

### 5.10 Identity, policy, and approval outcomes

| Metric | Type | Labels | Source | Notes |
|---|---|---|---|---|
| `xtrm_identity_operations_total` | counter | `service_name`, `repo`, `credential_kind`, `result` | `identity.credential.issued/failed/throttled` | Secret values never exported. |
| `xtrm_policy_decisions_total` | counter | `service_name`, `repo`, `policy_kind`, `action_kind`, `result` | `policy.decision.allowed/denied`, `policy.mismatch.detected` | `result=allowed|denied|mismatch|error`. |
| `xtrm_policy_mismatches_total` | counter | `service_name`, `repo`, `policy_kind`, `severity` | `policy.mismatch.detected` | Severity bounded. |

Identity/policy metrics are audit signals, not an authorization source of truth.
Drill down through forensic events for decision ids, approver refs, and redacted
provider errors.

## 6. Exporter architecture

### 6.1 Projection engine

The exporter should be a projection engine, not a second event source.

Recommended shape:

1. Read normalized forensic events ordered by `(stream, seq)` or `(t_unix_ms, job_id, seq)`.
2. Maintain a durable projection cursor/watermark.
3. Increment counters/histograms exactly once per source event.
4. Compute gauges from current state tables at scrape time or on a short polling interval.
5. Expose Prometheus text/OpenMetrics format. The pre-substrate bridge ships both `sp metrics --prometheus` and read-only HTTP `GET /metrics` on `sp serve`.
6. Validate exposition syntax in CI with the telemetry-contract test path.

### 6.2 Durable counters

Counters must survive exporter restarts. Options:

- replay from full retained event history on startup;
- store projection accumulators + event cursor in a `metrics_projection_state` table;
- or run exporter as part of the daemon with process-lifetime counters and accept reset semantics only if Prometheus handles restart resets.

Preferred for xtrm: **persistent cursor + replayable event history**. This keeps local CLI/debug use deterministic and avoids silent undercounting after exporter restarts.

Current pre-substrate bridge status: `sp metrics --prometheus` uses table-derived counters from durable `specialist_job_metrics` / current-state snapshots rather than incrementing a process-local event stream. Chain metrics are derived by grouping terminal chain jobs internally by opaque chain id, but only export bounded `chain_template` and `result` labels. Repeated renders over the same table state are deterministic; event-cursor projection remains the target for a long-running HTTP exporter.

### 6.3 Gauges

Gauges should be read from current state, not accumulated from possibly-missed events, when a current state table exists. Examples: active jobs, queue depth, worktree count, process count, pulse queue depth.

### 6.4 Exemplars and log links

Histograms and selected counters may attach exemplars with `trace_id` when available. If no trace exists, do not use `job_id` or `participant_id` as labels. Instead expose links in dashboards from aggregate series to LogQL/query templates using bounded labels plus time range.

Example exemplar shape in OpenMetrics style:

```text
xtrm_job_duration_seconds_bucket{repo="specialists",participant_kind="specialist",participant_role="executor",result="success",le="300"} 42 # {trace_id="4bf92f3577b34da6a3ce929d0e0e4736"} 183.2
```

If trace ids are unavailable, omit exemplar rather than using `job_id`.

## 7. SLO and alert candidates

Initial alerting should page on symptoms, not root causes.

| Signal | Candidate rule | Severity |
|---|---|---|
| Job queue not draining | `xtrm_job_queue_depth` above threshold for N minutes | warn/critical by repo |
| Old waiting jobs | p95 or max `xtrm_job_wait_seconds` exceeds SLO | warn |
| Job failure spike | rate of `xtrm_jobs_total{result="error"}` exceeds baseline | warn/critical |
| Tool/MCP error spike | rate of tool/MCP errors above threshold | warn |
| No worker heartbeat | `xtrm_job_state{state="running"}` unexpectedly zero while queue depth > 0 | critical |
| Orphan process growth | orphan detection/reap failures increase | warn |
| Dirty/stale worktrees | stale dirty worktrees > threshold | warn |
| Token budget burn | token rate above policy or subscription-plan quota proxy | warn |
| Pulse backlog | pulse queue depth or delivery latency exceeds threshold | warn |
| Gate failure pattern | gate verdict FAIL/PARTIAL spike | info/warn |

Do not page on CPU/memory alone unless tied to user-visible symptoms, queue drain failure, or data-loss risk.

## 8. Ownership split

| Repo/system | Owns |
|---|---|
| `~/dev/specialists` | Forensic event emission for specialists, metric projection code for specialists-owned data, local `/metrics` or CLI export, schema/cardinality tests. |
| `~/dev/xtrm-tools` / future core/substrate packages | Core/substrate/channel/service-skills forensic events and their metric projections. |
| `~/projects/mercury/infra` | Prometheus/Grafana/Loki/Alertmanager deployment, scrape config, retention, alert routing, infra dashboards. |
| `~/dev/gitboard` / future console | Operator UX, evidence drawer, lineage view, datasource-backed panels, links from metrics to forensic evidence. |

Infra may scrape the exporter, but infra does not define xtrm metric semantics. Xtrm defines semantics; infra stores/routes/renders.

## 9. Validation requirements

Future implementation beads must validate:

- every metric name follows this contract or explicitly updates it;
- all labels are allowlisted;
- forbidden identifiers never appear in label sets;
- `participant_kind` and `participant_role` replace `specialist` as primary identity labels;
- `participant_id` and `job_id` are available only as exemplars/log links/body fields;
- histograms use seconds and configured buckets;
- counters are monotonic across projection restarts or replayed deterministically;
- gauges reflect current state, not stale event-derived counts;
- legacy events normalize before projection;
- `/metrics` output includes `HELP` and `TYPE` lines;
- token totals are derived from split directions, with `direction="total"` used only for unsplit upstream totals;
- no USD cost metric is exported until direct API billing/pricing provenance exists;
- redaction is applied before any label/value leaves the process.

### Pasteable validation checklist

```text
VALIDATION — Prometheus projection
- [ ] Metric names use xtrm_ prefix and base-unit suffixes.
- [ ] Labels are only from the allowlist in docs/telemetry/prometheus-projection-contract.md §3.
- [ ] participant_kind + participant_role are used; specialist is not a primary label.
- [x] participant_id/job_id/bead_id/container_id/chain_id/session_id/conversation_id/trace_id/span_id/tool_call_id/mcp_session_id/jsonrpc_request_id/eval_id/policy_decision_id/identity_request_id are not labels in current projection tests.
- [ ] Histograms use seconds and documented buckets.
- [x] CLI counters are replay-safe table-derived projections; long-running event-stream exporters still need a durable projection cursor.
- [x] Current shipped gauges are current-state snapshots.
- [ ] Exemplars use trace_id only when available; otherwise dashboards link to logs by bounded labels + time range.
- [x] `sp metrics --prometheus` and `sp serve` `GET /metrics` include HELP/TYPE; CLI output passes the repository Prometheus text parser validation.
- [x] `xtrm_chains_total`, `xtrm_chain_duration_seconds`, `xtrm_gate_verdicts_total`, and `xtrm_evidence_refs_total` are covered by projection tests without forbidden labels.
- [x] MCP operation counter projection uses only bounded `mcp_server`, `mcp_method`, and `result` labels when MCP forensic events are supplied.
```

## 10. Implementation sequence

Recommended order:

1. Finish the shared forensic writer (`unitAI-60w93.2`) and schema/cardinality tests (`unitAI-60w93.3`).
2. Normalize `sp log/feed --json` (`unitAI-60w93.4`) so projection inputs are stable.
3. Implement a read-only projection prototype over current `.specialists/db/observability.db` for job/tool/token/process gauges.
4. Add `/metrics` or `sp metrics export` with parser tests.
5. Add infra scrape config in `mercury/infra`.
6. Add console/Grafana panels and alert candidates.
7. Extend to service-skills, pulses, channels, and substrate once those emit `xtrm.forensic.v1` events.
