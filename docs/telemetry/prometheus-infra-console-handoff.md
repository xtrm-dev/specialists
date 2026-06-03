---
title: Prometheus Infra and Console Handoff
scope: telemetry-prometheus-handoff
category: handoff
version: 1.0.0
updated: 2026-06-02
source_of_truth_for:
  - "AgentOps scrape ownership handoff"
  - "first dashboards and alerts for xtrm metrics"
related:
  - docs/telemetry/prometheus-projection-contract.md
  - docs/telemetry/forensic-event-contract.md
  - docs/observability-metrics.md
  - unitAI-60w93.7
  - unitAI-eoqxp.5
  - unitAI-rgu4q
---

# Prometheus Infra and Console Handoff

This handoff turns the xtrm telemetry contracts into ownership boundaries for infra, Grafana, and console work.
It is the shipped bridge from the canonical DevOps design
`/home/dawid/second-mind/1-projects/xtrm/devops/devops-system.md` to the
implemented specialists telemetry surfaces in `docs/telemetry/`.

- Metrics contract: `docs/telemetry/prometheus-projection-contract.md`
- Forensic/log contract: `docs/telemetry/forensic-event-contract.md`
- Current implementation prototype: `sp metrics [--prometheus] [--since <duration|iso>]`
- Source of truth: runtime state, job metrics, and `xtrm.forensic.v1`; Prometheus is only a projection.

## Ownership split

| Area | Owner | Responsibility |
|---|---|---|
| Metric semantics and label policy | xtrm/specialists | Metric names, allowed labels, forbidden high-cardinality labels, exporter output. |
| Scrape/storage/alert plumbing | mercury/infra | Prometheus scrape target, retention, Grafana data source, Alertmanager routing. |
| Dashboards and evidence UX | gitboard/console | Panels, health summaries, drill-down links to forensic evidence. |
| Forensic drill-down | xtrm/substrate/channels | Preserve opaque correlation IDs in logs/traces/events, not metric labels. |

## Scrape target proposal

Initial local validation uses the CLI exporter:

```bash
sp metrics --prometheus --since 24h
```

Infra can use the CLI as a textfile collector or scrape the read-only `GET /metrics` endpoint exposed by `sp serve`. Wrappers and scrape configs must not add labels from opaque IDs.

Recommended scrape metadata:

- job name: `xtrm_specialists_agentops`
- static labels: host/instance labels from Prometheus only; do not inject bead/job/chain IDs
- scrape interval: 30s-60s for local/dev; 15s only if exporter cost remains low
- retention: normal Prometheus retention for aggregates; forensic retention remains separate

## First dashboard panels

Start with low-cardinality operational health before deep cost or per-tool panels:

1. **Job state overview**
   - `xtrm_job_state{service_name="specialists"}` grouped by `state`, `participant_role`
   - Purpose: active/waiting/error distribution.

2. **Terminal job result rate**
   - `rate(xtrm_jobs_total[15m])` grouped by `result`, `participant_role`
   - Purpose: success/error/cancelled trend.

3. **Job duration percentiles**
   - `histogram_quantile(0.95, sum by (le, participant_role) (rate(xtrm_job_duration_seconds_bucket[1h])))`
   - Purpose: slow specialist activations.

4. **Waiting time percentiles**
   - `histogram_quantile(0.95, sum by (le, participant_role) (rate(xtrm_job_wait_seconds_bucket[1h])))`
   - Purpose: queue/backpressure visibility.

5. **Context pressure**
   - `xtrm_context_usage_ratio` grouped by `participant_role`
   - Purpose: compaction and context exhaustion risk.

6. **Tool-call volume**
   - `rate(xtrm_tool_calls_total[15m])` grouped by `tool_name`, `result`
   - Purpose: tool error spikes and unexpected usage mix.

7. **Token usage trend**
   - `rate(xtrm_llm_tokens_total[1h])` grouped by `direction`, `model_provider`, `model`
   - Purpose: budget/cost signals without job-specific labels.

## First alerts

Keep early alerts coarse and actionable:

| Alert | Sketch | Owner |
|---|---|---|
| Specialist job errors elevated | `sum(rate(xtrm_jobs_total{result="error"}[30m])) by (participant_role) > threshold` | infra routes; xtrm investigates. |
| Waiting backlog growing | `sum(xtrm_job_state{state=~"waiting|queued"}) by (participant_role) > threshold` | infra routes; xtrm investigates. |
| Long job duration p95 | `histogram_quantile(0.95, sum by (le, participant_role) (rate(xtrm_job_duration_seconds_bucket[1h]))) > threshold` | infra routes; xtrm investigates. |
| Context pressure high | `max(xtrm_context_usage_ratio) by (participant_role) > 0.85` | console surfaces; xtrm investigates. |
| Exporter missing | `absent(xtrm_prometheus_projection_timestamp_seconds)` | infra owns scrape/runtime. |

Alert annotations should link to the forensic log surface, but not by embedding IDs in labels. Use dashboard variables or evidence drawer inputs instead.

## Console/evidence drawer needs

Console should present aggregate panels first, then offer drill-down using explicit query actions:

- filter by `participant_role`, `state`, `result`, `tool_name`, `model`
- open forensic search with user-selected time range and metric label context
- ask for opaque IDs only after drill-down, via logs/traces/events
- never persist dashboard panels that group by `job_id`, `chain_id`, `participant_id`, `bead_id`, `trace_id`, or raw paths

## Label safety checklist

Before wiring infra or dashboard assets, verify:

- [ ] no metric label contains `job_id`, `bead_id`, `chain_id`, `participant_id`, `trace_id`, `span_id`, `tool_call_id`, raw path, raw command, raw URL, raw error text, prompt text, user id, email, token, or credential
- [ ] `participant_kind` and `participant_role` are the only identity labels
- [ ] `model` and `tool_name` are normalized or bucketed to `other`
- [ ] counters use rates in dashboards unless intentionally showing accumulated process-local totals
- [ ] forensic event/log links preserve correlation IDs outside labels

## Follow-up links

- `unitAI-eoqxp.5`: infra/Grafana scrape and dashboard implementation should consume this handoff.
- `unitAI-rgu4q`: console/evidence UX should use the same label-safe drill-down boundary.
- Future exporter hardening should decide whether CLI textfile, HTTP `/metrics`, or substrate-native exporter is the durable path.
