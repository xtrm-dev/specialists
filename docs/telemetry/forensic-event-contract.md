---
title: Forensic Telemetry Event Contract
scope: telemetry-forensics
category: reference
version: 1.0.0
updated: 2026-06-01
source_of_truth_for:
  - "xtrm forensic telemetry envelope"
  - "specialists runtime JSON events"
  - "future Loki log shipping"
  - "future Prometheus metrics projection boundaries"
domain:
  - telemetry
  - observability
  - agentops
  - substrate
  - specialists
summary: "Defines the shared xtrm forensic event envelope, event families, label discipline, correlation model, redaction rules, examples, and validation checklist for specialists and future xtrm emitters."
---

# Forensic Telemetry Event Contract

## 1. Purpose and non-goals

This document is the source of truth for **forensic telemetry events** emitted by the xtrm ecosystem.
It applies first to the specialists runtime, then to `xt`, substrate (`sb`), service-skills drift tooling,
pulse emitters, and any future xtrm participant that writes structured operational events.

The core rule is signal separation:

- **Forensic events/logs** are high-cardinality, correlation-rich, and suitable for Loki/log storage, trace reconstruction, incident review, and operator questions.
- **Metrics** are curated projections from those events or runtime state. They use low-cardinality labels, base units, and Prometheus-friendly names.
- **Traces/spans** carry causal hierarchy where available. Until full OpenTelemetry emission exists, trace fields remain part of the shared envelope and are populated opportunistically.

This contract prevents each emitter from inventing its own JSON shape. Event families may be module-specific, but the envelope, resource attributes, correlation rules, redaction policy, timestamp semantics, and label discipline are shared.

### Non-goals

- Do not require a Prometheus exporter in the same change that adopts this contract.
- Do not require immediate full OpenTelemetry SDK instrumentation.
- Do not make Loki labels out of high-cardinality identifiers.
- Do not replace `.specialists/db/observability.db`; it remains the canonical local runtime store for specialists.
- Do not define gitboard panel UX beyond the fields available to consumers.

## 2. Source-of-truth surfaces today

Specialists currently emits or exposes telemetry through these surfaces:

| Surface | Role today | Contract implication |
|---|---|---|
| `.specialists/db/observability.db` | Canonical SQLite runtime store for jobs, events, results, node events, and derived metrics. | Future forensic events should be stored as JSON rows in `specialist_events.event_json` or equivalent module-specific event tables. |
| `specialist_events` table | Per-job ordered event stream with `job_id`, `seq`, `specialist`, `bead_id`, `t`, `type`, `event_json`. | Maps directly to the forensic envelope. Existing records are legacy-compatible but not fully enveloped. |
| `specialist_jobs` table | Job status, bead, node, chain, epic, status JSON, startup payload, last output. | Supplies resource/correlation fields for events that do not carry them directly. |
| `specialist_job_metrics` table | Derived job metrics: turns, tools, token/context trajectories, stall gaps, elapsed/waiting time. | Metrics projection source; not a label-free-for-all. |
| `src/specialist/timeline-events.ts` | Current TypeScript event union for specialists timeline events. | Current event names map to event families in §12. |
| `sp log --json` | Normalized runtime log rows with job/worktree/chain metadata and event body. | Should converge on this envelope for machine consumers. |
| `sp feed --json` | NDJSON chronological feed. Adds job metadata and metrics to timeline events. | Good operator stream; future fields must remain backward-compatible. |
| `sp ps --json` | Snapshot of job state and metrics. | Snapshot surface, not an event stream. |
| `sp result --json` | Durable result output and metrics footer/source. | Result persistence events should link to this surface. |
| `docs/observability-metrics.md` | Existing metrics contract. | Remains the metrics-side sibling of this forensic contract. |

Legacy `events.jsonl` file mirrors may exist when job-file output is enabled, but SQLite is canonical.

## 3. Canonical forensic event envelope

Every new xtrm forensic event MUST be emitted through a shared envelope writer. Call sites must not hand-build final JSON events.

Required top-level shape:

```json
{
  "schema_version": "xtrm.forensic.v1",
  "timestamp": "2026-06-01T18:40:00.000Z",
  "t_unix_ms": 1780339200000,
  "severity": "info",
  "event_family": "job",
  "event_name": "job.started",
  "event_version": 1,
  "resource": {},
  "correlation": {},
  "body": {},
  "redaction": { "status": "clean" }
}
```

### Required envelope fields

| Field | Type | Required | Meaning |
|---|---:|---:|---|
| `schema_version` | string | yes | Contract version. Current value: `xtrm.forensic.v1`. |
| `timestamp` | RFC3339 string | yes | Wall-clock UTC timestamp for humans and log backends. |
| `t_unix_ms` | integer | yes | Unix milliseconds for ordering and SQLite compatibility. |
| `seq` | integer | per ordered stream | Monotonic per-stream sequence when available. For specialists, per `job_id`. |
| `severity` | enum | yes | `debug`, `info`, `warn`, `error`, or `critical`. |
| `event_family` | string | yes | Bounded family from §6. |
| `event_name` | string | yes | Dot-delimited event name: `<family>.<action>` or `<family>.<object>.<action>`. |
| `event_version` | integer | yes | Event-body schema version for this event name. Start at `1`. |
| `resource` | object | yes | Bounded resource identity attrs from §4. |
| `correlation` | object | yes | IDs and causal links from §5. High-cardinality by design. |
| `body` | object | yes | Event-specific structured payload. |
| `redaction` | object | yes | Redaction status and optional redacted field names. |

Optional top-level fields:

| Field | Type | Meaning |
|---|---:|---|
| `trace` | object | Trace/span fields if the emitter already has them. Mirrors `correlation.trace_id` etc. for OTEL export convenience. |
| `otel` | object | Semantic-convention attributes prepared for future OTEL export. |
| `links` | object | Stable human/machine links: bead URL, dashboard URL, docs path, PR, commit. |
| `diagnostics` | object | Non-essential debugging metadata. Must not contain secrets. |

### Naming rules

- `schema_version` changes only for breaking envelope changes.
- `event_version` changes when a specific `event_name` body changes incompatibly.
- `event_name` uses lowercase dot-separated names, e.g. `tool.call.failed`, `control.stop.requested`.
- `event_family` uses snake_case when needed, e.g. `service_skills`.
- Unknown fields are allowed in `body` but forbidden at top level unless added to this contract.

## 4. Required resource attributes

Resource attributes describe the emitter, not the individual job/tool call. They should be bounded and stable enough to become Loki labels.

Required for all xtrm emitters:

| Field | Example | Notes |
|---|---|---|
| `service_namespace` | `xtrm` | Ecosystem namespace. |
| `service_name` | `specialists` | Emitter/service name: `specialists`, `xt`, `substrate`, `service-skills`. |
| `service_component` | `supervisor` | Component/module: `supervisor`, `runner`, `cli`, `drift_detector`. |
| `service_version` | `3.14.1` | Package/runtime version when available. |
| `deployment_environment` | `local` | `local`, `staging`, `production`, or explicit operator env. |
| `repo` | `specialists` | Repository/project slug, not absolute path. |
| `runtime` | `bun` | Runtime when relevant. |

Specialists-specific resource attributes:

| Field | Example | Notes |
|---|---|---|
| `participant_kind` | `specialist` | **5-layer L1** (canonical). Bounded enum: `specialist`, `orchestrator`, `pulse_emitter`, `adapter`, `node_member`, future. Per kj651 Opp 18. |
| `participant_role` | `executor` | **5-layer L2** (canonical). Bounded by participant catalog (specialist names, orchestrator role labels, etc.). Per kj651 Opp 18. |
| `specialist` | `executor` | **DEPRECATED ALIAS** for `participant_role` when `participant_kind=specialist`. Accepted on read for ~1 release with deprecation warning; not emitted on new events post-Opp-18. |
| `model_provider` | `anthropic` | Bounded provider slug. |
| `model` | `claude-sonnet-4-6` | Usually bounded enough for logs; metric labels need explicit allowlist. |
| `worktree_mode` | `isolated` | `none`, `isolated`, `reused`, `unknown`. |
| `chain_kind` | `chain` | `prep`, `chain`, `node`, or future substrate kind. |

### Identity layers (canonical — pinned by kj651 Opp 18)

The envelope adopts a **5-layer identity model** because substrate §2.1 does not declare a separate Run/Activation entity, leaving per-execution identity under-specified. The bridge pins it:

| Layer | Field(s) | Type | Label-safe | Lifetime |
|---|---|---|---|---|
| 1 | `participant_kind` (resource) | bounded enum | ✅ yes | constant |
| 2 | `participant_role` (resource) | bounded enum | ✅ yes | constant |
| 3 | `participant_id` (correlation) | opaque, stable for `(scope, role)` | ❌ no | member's membership |
| 4 | `job_id` (correlation, = activation) | opaque, **new each run** | ❌ no | one pi-session / execution |
| 5 | `turn_id`, `tool_call_id`, `event_id` (correlation) | opaque, per-fact | ❌ no | one event |

**Invariant.** Two activations of the same `participant_role` in the same scope ⇒ identical `participant_id`, distinct `job_id`. `participant_kind × participant_role` alone is NOT a participant identifier — Layer 3+4 required.

**Tool vs participant.** A *tool* (e.g. MCP grafana query) is invoked synchronously and has no lifecycle of its own — events live inside the calling participant's `job_id` with a `tool_call_id`. A *participant* (e.g. `service-skills` drift detector, an external webhook adapter) has its own runs/state and is identified by its own Layer 3+4 pair.

OpenTelemetry alignment:

- `service_namespace` maps to OTEL `service.namespace`.
- `service_name` maps to `service.name`.
- `service_version` maps to `service.version`.
- `deployment_environment` maps to `deployment.environment.name`.
- Unique process/host/container fields may be added later as resource fields, but must not leak raw secrets or unstable paths.

## 5. Correlation model

Correlation fields are for joining logs/traces/results. They are intentionally high-cardinality and MUST NOT be used as Prometheus labels or default Loki labels.

### Available today

| Field | Source today | Notes |
|---|---|---|
| `job_id` | specialists job id | Opaque. Primary specialists runtime run id. |
| `bead_id` | beads tracking issue | Opaque issue id. |
| `turn_id` | derived per job turn | Use stable turn index/id when available. |
| `tool_call_id` | Pi/tool event id | Opaque per tool invocation. |
| `chain_id` | current specialists chain identity | Opaque. Today worktree-lineage/root-derived; bridge-era may be bd molecule id. |
| `chain_root_job_id` | specialists status | Opaque root job id today. |
| `chain_root_bead_id` | specialists status | Opaque root bead id today. |
| `epic_id` | specialists status / epic membership | Opaque bd/sp epic id. |
| `node_id` | node supervisor | Opaque node run/member id when present. |
| `reused_from_job_id` | startup snapshot | Opaque parent/reuse link. |
| `worktree_owner_job_id` | startup snapshot | Opaque worktree owner link. |
| `commit_sha` | git/autocommit events | Full SHA in body/correlation, never metric label. |
| `participant_id` | derived bridge-side per Opp 18 L3 rule | **5-layer L3** (canonical). Stable across multiple activations of the same `participant_role` in the same scope. Derivation: `${chain_id}::${participant_role}` for specialists; `orch::${session_uuid}` for orchestrator; `${container_id}::emitter::${role}` for in-container pulse emitters; opaque UUID for external pulse emitters / adapters; `node::${node_id}::${role}::${member_index}` for node members. |

### Reserved for substrate / full tracing

| Field | Intended future source | Notes |
|---|---|---|
| `container_id` | substrate state.db container | Future chain/container identity. Opaque. |
| `trace_id` | OTEL/substrate trace context | Opaque W3C-style trace id when available. |
| `span_id` | OTEL/substrate span context | Opaque span id. |
| `parent_span_id` | OTEL/substrate span context | Opaque causal parent. |
| `pulse_id` | substrate pulse emitter | Opaque pulse/event-bus id. |

### Chain identity discipline

`chain_id` is an opaque correlation field. Do not parse prefixes, assume UUID length, assume job-id shape, or infer semantics from its current value.

Current and planned meanings:

- Today: chain identity is available from specialists status/worktree lineage (`chain_id`, `chain_root_job_id`, `chain_root_bead_id`, `epic_id`).
- Bridge era: `chain_id` may become the bd molecule id used by `--chain <molecule-id>`.
- Substrate era: `chain_id` may point at a container id or be accompanied by `container_id`.

Dashboards, LogQL queries, gitboard panels, and alerts must treat these as opaque strings.

## 6. Event family taxonomy

Event families are bounded categories. New families require updating this section and adding examples/tests.

| Family | Purpose | Example event names |
|---|---|---|
| `job` | Specialist or xtrm job lifecycle. | `job.started`, `job.status_changed`, `job.completed`, `job.failed`, `job.cancelled`, `job.waiting` |
| `turn` | Agent turn lifecycle and summaries. | `turn.started`, `turn.completed`, `turn.summarized` |
| `model` | LLM/provider metadata and changes. | `model.selected`, `model.changed`, `model.finish_reason`, `model.token_usage` |
| `tool` | Local tool call lifecycle. | `tool.call.started`, `tool.call.completed`, `tool.call.failed` |
| `mcp` | MCP client/server/session/tool-call telemetry. | `mcp.session.started`, `mcp.tool.called`, `mcp.tool.failed`, `mcp.operation.completed` |
| `control` | Operator/runtime control actions. | `control.stop.requested`, `control.steer.sent`, `control.resume.sent`, `control.finalize.requested` |
| `retry` | Retry lifecycle. | `retry.started`, `retry.completed`, `retry.exhausted` |
| `compaction` | Context compaction lifecycle. | `compaction.started`, `compaction.completed` |
| `error` | RPC, extension, unexpected process, or generic errors. | `error.rpc`, `error.extension`, `error.process`, `error.schema_validation` |
| `result` | Durable output/result persistence. | `result.persisted`, `result.appended_to_bead`, `result.read_failed` |
| `git` | Git, auto-commit, merge, GitNexus analysis. | `git.auto_commit.succeeded`, `git.auto_commit.skipped`, `gitnexus.analysis.completed` |
| `process_health` | Process liveness, stale jobs, orphan cleanup. | `process_health.stale_detected`, `process_health.orphan_reaped` |
| `service_skills` | Reserved for service-skill drift/sync machinery. | `service_skills.drift_detected`, `service_skills.drift_tiered`, `service_skills.synced`, `service_skills.verdict` |
| `pulse` | Reserved generic participant/pulse emission for substrate/xtrm scripts. | `pulse.emitted`, `pulse.consumed`, `pulse.failed` |
| `node` | NodeSupervisor/node-coordinator lifecycle. | `node.run_started`, `node.member_status_changed`, `node.memory_recorded` |

### OTel GenAI/MCP alignment

Where spans are available, model agent/tool activity as nested operations:

- agent/job span: `invoke_agent` or xtrm equivalent
- model span: GenAI chat/inference operation
- tool span: `execute_tool`
- MCP span: `tools/call` with `mcp.method.name`, `mcp.session.id`, `jsonrpc.request.id`, and transport attributes

The forensic event body may include an `otel` sub-object with prepared attributes, but implementation may remain log-first until OTEL export exists.

## 7. Loki-friendly logging guidance

Loki indexes labels, not arbitrary JSON bodies. Keep labels bounded, then put rich data in the JSON body.

### Recommended Loki labels

These labels are safe by default if present:

- `service_namespace`
- `service_name`
- `service_component`
- `deployment_environment`
- `repo`
- `specialist`
- `event_family`
- `severity`
- `status`
- `result`
- `model_provider`
- `chain_kind`

Use `model` as a Loki label only if the deployment has a bounded allowlist and cardinality monitoring.

### Labels that must never be used

Never use these as Loki labels or Prometheus labels:

- `job_id`
- `bead_id`
- `chain_id`
- `chain_root_job_id`
- `chain_root_bead_id`
- `epic_id`
- `node_id`
- `trace_id`
- `span_id`
- `parent_span_id`
- `tool_call_id`
- `mcp.session.id`
- `jsonrpc.request.id`
- raw file path
- raw command
- raw error text
- raw model output
- prompt text, tool args, tool result payloads
- user id, email, token, credential, or personal data

### Structured body fields

Put high-cardinality forensic fields in `correlation` or `body`, not labels. Example:

```json
{
  "event_family": "tool",
  "event_name": "tool.call.failed",
  "resource": { "service_name": "specialists", "specialist": "executor" },
  "correlation": { "job_id": "8f2a1c", "tool_call_id": "toolu_01", "bead_id": "unitAI-abc12" },
  "body": { "tool": "bash", "duration_ms": 2401, "exit_code": 2, "result_summary": "tsc failed with 3 diagnostics" }
}
```

### Example LogQL queries

Use narrow selectors first, then JSON parsing/body filters.

```logql
{service_namespace="xtrm", service_name="specialists", event_family="job", severity=~"warn|error|critical"} | json
```

```logql
{service_name="specialists", specialist="executor", event_family="tool"} | json | body_tool="bash" | body_is_error=true
```

```logql
{service_name="specialists", event_family="mcp", severity="error"} | json | line_format "{{.timestamp}} {{.body_tool_name}} {{.body_error_type}} {{.correlation_job_id}}"
```

```logql
{service_name="specialists", event_family="job"} | json | correlation_bead_id="unitAI-60w93.1"
```

```logql
{service_namespace="xtrm", event_family="service_skills"} | json | body_drift_tier=~"high|critical"
```

```logql
sum by (specialist) (rate({service_name="specialists", event_family="tool", severity="error"} | json [5m]))
```

## 8. Prometheus boundary

Prometheus metrics are projections, not a copy of the forensic body.

### Good projections

| Metric | Type | Labels | Source events/state |
|---|---|---|---|
| `xtrm_specialist_jobs_total` | counter | `repo`, `specialist`, `status`, `result` | `job.completed`, `job.failed`, `job.cancelled` |
| `xtrm_specialist_job_duration_seconds` | histogram | `repo`, `specialist`, `result` | job lifecycle elapsed time |
| `xtrm_specialist_job_wait_seconds` | histogram | `repo`, `specialist` | queued/waiting state durations |
| `xtrm_specialist_job_state` | gauge | `repo`, `specialist`, `state` | current `specialist_jobs.status` snapshot |
| `xtrm_specialist_tool_calls_total` | counter | `repo`, `specialist`, `tool`, `result` | `tool.call.completed/failed` |
| `xtrm_specialist_tool_duration_seconds` | histogram | `repo`, `specialist`, `tool`, `result` | tool call duration |
| `xtrm_specialist_mcp_operations_total` | counter | `repo`, `specialist`, `method`, `result` | `mcp.*` events |
| `xtrm_specialist_mcp_operation_duration_seconds` | histogram | `repo`, `specialist`, `method`, `result` | MCP events/spans |
| `xtrm_specialist_tokens_total` | counter | `repo`, `specialist`, `model_provider`, `model`, `direction` | `model.token_usage` with model allowlist |
| `xtrm_service_skills_drift_total` | counter | `repo`, `service_name`, `drift_tier`, `result` | `service_skills.*` events |
| `xtrm_pulses_total` | counter | `repo`, `service_name`, `event_family`, `result` | `pulse.*` events |

### Forbidden metric labels

All correlation identifiers in §5 are forbidden as Prometheus labels. Use exemplars, trace links, or log links instead.

### Exemplars/correlation strategy

When an implementation supports exemplars, attach one opaque correlation value such as `trace_id` to a histogram sample. Otherwise dashboards should link from aggregate metrics to LogQL queries by bounded labels and time window, then filter by IDs in JSON body.

## 9. Redaction and secrets policy

Every event must include `redaction.status`:

| Status | Meaning |
|---|---|
| `clean` | Event contains no known sensitive fields. |
| `redacted` | One or more fields were removed or replaced. Include `redaction.fields`. |
| `unknown` | Emitter could not inspect content safely. Avoid shipping raw payloads. |

Required redaction rules:

- Never emit API keys, OAuth tokens, bearer tokens, SSH keys, cookies, passwords, private certificates, or full environment blocks.
- Never emit raw prompt text or full model output unless the event is an explicitly local-only debug artifact and is not shipped to shared logs.
- Tool args/results default to summaries. Raw args/results require explicit allowlist and must pass secret scanning/redaction.
- Raw commands are high-risk. Prefer command family plus short summary; if needed, keep full command in `body.command_preview` after redaction, never in labels.
- Raw paths should be repository-relative where possible. Home directories and temp paths should be normalized.
- Error text may contain secrets; store `error_type`, `error_code`, and redacted `message_preview`.

Example redaction marker:

```json
{
  "redaction": {
    "status": "redacted",
    "fields": ["body.command_preview", "body.env"],
    "rules": ["secret-pattern", "env-block"]
  }
}
```

## 10. Timestamp and ordering semantics

- `timestamp` and `t_unix_ms` are set by the shared emitter at write time unless preserving a trusted upstream timestamp.
- For specialists events, `seq` is monotonic per `job_id` and is the tie-breaker after `t_unix_ms`.
- Cross-job ordering is best-effort by timestamp. Do not assume total ordering across jobs or repositories.
- Replayed/imported events must set `body.replayed=true` and preserve original timestamp in `body.original_timestamp` if different.
- Consumers should sort by `(t_unix_ms, seq, event_name)` inside one stream and by `(t_unix_ms, repo, job_id, seq)` across streams.
- Duplicate events should be idempotent by `(event_name, correlation.job_id, seq)` when `seq` exists.

## 11. Backward compatibility and schema versioning

Current `TimelineEvent` records remain valid legacy inputs. Consumers must tolerate:

- missing `schema_version`
- `t` instead of `t_unix_ms`
- top-level `type` instead of `event_name`
- missing `resource` or `correlation`
- legacy completion events `done` / `agent_end`

Migration rule:

1. New emitters write the envelope through the shared writer.
2. Readers normalize legacy events to the envelope at display/export boundaries.
3. SQLite migration is additive. Existing rows are not rewritten unless a dedicated migration is approved.
4. Breaking envelope changes require `schema_version=xtrm.forensic.v2`; breaking event-body changes increment `event_version` for that event name.
5. For one minor release window, readers must accept both the old and new shape.

## 12. Mapping from current runtime events

| Current `TimelineEvent.type` | New family | New event name | Notes |
|---|---|---|---|
| `run_start` | `job` | `job.started` | Move `startup_snapshot` into `body.startup_snapshot`; promote IDs into `correlation`. |
| `payload_breakdown` | `job` | `job.payload_breakdown.recorded` | Body contains component token/byte breakdown. |
| `meta` | `model` | `model.selected` or `job.metadata.recorded` | If model/backend metadata, use `model.selected`; mandatory-rule/memory injection may use `job.metadata.recorded`. |
| `thinking` | `turn` | `turn.thinking.detected` | Keep char count only. |
| `tool` phase `start` | `tool` | `tool.call.started` | Put tool name and args summary in body. |
| `tool` phase `update` | `tool` | `tool.call.updated` | Optional/noisy; may remain human-feed-only. |
| `tool` phase `end` success | `tool` | `tool.call.completed` | Include duration when known. |
| `tool` phase `end` error | `tool` | `tool.call.failed` | Severity `error`; include redacted result summary. |
| `text` | `turn` | `turn.text.detected` | Do not persist raw text unless local-only. |
| `message` | `turn` | `turn.message.started` / `turn.message.completed` | Role in body. |
| `turn` | `turn` | `turn.started` / `turn.completed` | Phase in event name/body. |
| `status_change` | `job` | `job.status_changed` | Status/result label may use bounded `status`. |
| `run_complete` COMPLETE | `job` + `result` | `job.completed` and/or `result.persisted` | Prefer one job completion event plus separate result persistence event when output is stored. |
| `run_complete` ERROR | `job` | `job.failed` | Error summary redacted. |
| `run_complete` CANCELLED | `job` | `job.cancelled` | Include control source if known. |
| `stale_warning` | `process_health` | `process_health.stale_detected` | `reason`, thresholds, silence duration in body. |
| `token_usage` | `model` | `model.token_usage.recorded` | Source in body; metrics projection source. |
| `finish_reason` | `model` | `model.finish_reason.recorded` | Finish reason in body; bounded. |
| `turn_summary` | `turn` | `turn.summarized` | Token/context/finish summary. |
| `compaction` | `compaction` | `compaction.started` / `compaction.completed` | Phase decides event name. |
| `retry` | `retry` | `retry.started` / `retry.completed` | Add `retry.exhausted` when max attempts fail. |
| `model_change` | `model` | `model.changed` | Action and previous/current model in body. |
| `extension_error` | `error` | `error.extension` | Extension name bounded enough for body/label only if allowlisted. |
| `error` | `error` | `error.rpc` or `error.process` | Source decides event name. |
| `auto_commit_success` | `git` | `git.auto_commit.succeeded` | Commit SHA in correlation/body only. |
| `auto_commit_skipped` | `git` | `git.auto_commit.skipped` | Reason in body. |
| `auto_commit_failed` | `git` | `git.auto_commit.failed` | Severity `warn` or `error`. |
| `control_signal` | `control` | `control.<action>.requested` or `control.<action>.completed` | Source, status transition, previews in body. |
| `done` / `agent_end` | `job` | `job.completed` | Legacy only. Normalize on read. |

## 13. Canonical JSON examples

### 13.1 Job started

```json
{
  "schema_version": "xtrm.forensic.v1",
  "timestamp": "2026-06-01T18:40:00.000Z",
  "t_unix_ms": 1780339200000,
  "seq": 1,
  "severity": "info",
  "event_family": "job",
  "event_name": "job.started",
  "event_version": 1,
  "resource": {
    "service_namespace": "xtrm",
    "service_name": "specialists",
    "service_component": "supervisor",
    "service_version": "3.14.1",
    "deployment_environment": "local",
    "repo": "specialists",
    "specialist": "executor",
    "chain_kind": "chain"
  },
  "correlation": {
    "job_id": "8f2a1c",
    "bead_id": "unitAI-60w93.1",
    "chain_id": "unitAI-molecule1",
    "chain_root_bead_id": "unitAI-60w93"
  },
  "body": {
    "status": "running",
    "worktree_mode": "isolated",
    "startup_snapshot": {
      "bead_context_present": true,
      "skills": { "count": 3, "activated": ["using-specialists-v3"] }
    }
  },
  "redaction": { "status": "clean" }
}
```

### 13.2 Turn summarized

```json
{
  "schema_version": "xtrm.forensic.v1",
  "timestamp": "2026-06-01T18:41:12.100Z",
  "t_unix_ms": 1780339272100,
  "seq": 12,
  "severity": "info",
  "event_family": "turn",
  "event_name": "turn.summarized",
  "event_version": 1,
  "resource": {
    "service_namespace": "xtrm",
    "service_name": "specialists",
    "service_component": "pi-session",
    "deployment_environment": "local",
    "repo": "specialists",
    "specialist": "executor",
    "model_provider": "anthropic",
    "model": "claude-sonnet-4-6"
  },
  "correlation": { "job_id": "8f2a1c", "bead_id": "unitAI-60w93.1", "turn_id": "turn-1" },
  "body": {
    "turn_index": 1,
    "finish_reason": "tool_use",
    "context_pct": 41.2,
    "context_health": "OK",
    "text_summary": "Drafted telemetry contract outline"
  },
  "redaction": { "status": "clean" }
}
```

### 13.3 Tool call failed

```json
{
  "schema_version": "xtrm.forensic.v1",
  "timestamp": "2026-06-01T18:42:03.500Z",
  "t_unix_ms": 1780339323500,
  "seq": 18,
  "severity": "error",
  "event_family": "tool",
  "event_name": "tool.call.failed",
  "event_version": 1,
  "resource": {
    "service_namespace": "xtrm",
    "service_name": "specialists",
    "service_component": "pi-tool-runner",
    "deployment_environment": "local",
    "repo": "specialists",
    "specialist": "executor"
  },
  "correlation": { "job_id": "8f2a1c", "bead_id": "unitAI-60w93.1", "tool_call_id": "toolu_01" },
  "body": {
    "tool": "bash",
    "duration_ms": 2401,
    "exit_code": 2,
    "is_error": true,
    "args_summary": "run TypeScript compiler",
    "result_summary": "tsc failed with 3 diagnostics"
  },
  "redaction": { "status": "redacted", "fields": ["body.args"] }
}
```

### 13.4 MCP tool error

```json
{
  "schema_version": "xtrm.forensic.v1",
  "timestamp": "2026-06-01T18:42:50.000Z",
  "t_unix_ms": 1780339370000,
  "severity": "error",
  "event_family": "mcp",
  "event_name": "mcp.tool.failed",
  "event_version": 1,
  "resource": {
    "service_namespace": "xtrm",
    "service_name": "specialists",
    "service_component": "mcp-client",
    "deployment_environment": "local",
    "repo": "specialists",
    "specialist": "researcher"
  },
  "correlation": {
    "job_id": "f13d9b",
    "tool_call_id": "mcp-call-17",
    "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
    "span_id": "00f067aa0ba902b7"
  },
  "body": {
    "mcp_server": "grafana",
    "mcp_method_name": "tools/call",
    "tool_name": "query_loki",
    "network_transport": "pipe",
    "duration_ms": 1200,
    "error_type": "tool_error",
    "status_code": "ERROR"
  },
  "otel": {
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": "query_loki",
    "mcp.method.name": "tools/call",
    "network.transport": "pipe"
  },
  "redaction": { "status": "clean" }
}
```

### 13.5 Token usage recorded

```json
{
  "schema_version": "xtrm.forensic.v1",
  "timestamp": "2026-06-01T18:43:00.000Z",
  "t_unix_ms": 1780339380000,
  "seq": 21,
  "severity": "info",
  "event_family": "model",
  "event_name": "model.token_usage.recorded",
  "event_version": 1,
  "resource": {
    "service_namespace": "xtrm",
    "service_name": "specialists",
    "service_component": "pi-session",
    "deployment_environment": "local",
    "repo": "specialists",
    "specialist": "executor",
    "model_provider": "anthropic",
    "model": "claude-sonnet-4-6"
  },
  "correlation": { "job_id": "8f2a1c", "bead_id": "unitAI-60w93.1", "turn_id": "turn-1" },
  "body": {
    "source": "turn_end",
    "input_tokens": 25000,
    "output_tokens": 1800,
    "cache_creation_tokens": 1200,
    "cache_read_tokens": 6000,
    "total_tokens": 34000,
    "cost_usd": 0.42
  },
  "redaction": { "status": "clean" }
}
```

### 13.6 Control stop requested

```json
{
  "schema_version": "xtrm.forensic.v1",
  "timestamp": "2026-06-01T18:45:00.000Z",
  "t_unix_ms": 1780339500000,
  "seq": 30,
  "severity": "warn",
  "event_family": "control",
  "event_name": "control.stop.requested",
  "event_version": 1,
  "resource": {
    "service_namespace": "xtrm",
    "service_name": "specialists",
    "service_component": "cli",
    "deployment_environment": "local",
    "repo": "specialists",
    "specialist": "executor"
  },
  "correlation": { "job_id": "8f2a1c", "bead_id": "unitAI-60w93.1" },
  "body": {
    "action": "stop",
    "source": "cli",
    "previous_status": "running",
    "next_status": "cancelled",
    "signal": "SIGTERM",
    "force": false,
    "reason": "operator requested cancellation"
  },
  "redaction": { "status": "clean" }
}
```

### 13.7 Auto-commit succeeded

```json
{
  "schema_version": "xtrm.forensic.v1",
  "timestamp": "2026-06-01T18:46:00.000Z",
  "t_unix_ms": 1780339560000,
  "seq": 38,
  "severity": "info",
  "event_family": "git",
  "event_name": "git.auto_commit.succeeded",
  "event_version": 1,
  "resource": {
    "service_namespace": "xtrm",
    "service_name": "specialists",
    "service_component": "supervisor",
    "deployment_environment": "local",
    "repo": "specialists",
    "specialist": "executor"
  },
  "correlation": {
    "job_id": "8f2a1c",
    "bead_id": "unitAI-60w93.1",
    "commit_sha": "abc123def456"
  },
  "body": {
    "reason": "checkpoint_on_waiting",
    "committed_files": ["docs/telemetry/forensic-event-contract.md"],
    "files_count": 1
  },
  "redaction": { "status": "clean" }
}
```

### 13.8 Result persisted

```json
{
  "schema_version": "xtrm.forensic.v1",
  "timestamp": "2026-06-01T18:47:00.000Z",
  "t_unix_ms": 1780339620000,
  "seq": 45,
  "severity": "info",
  "event_family": "result",
  "event_name": "result.persisted",
  "event_version": 1,
  "resource": {
    "service_namespace": "xtrm",
    "service_name": "specialists",
    "service_component": "supervisor",
    "deployment_environment": "local",
    "repo": "specialists",
    "specialist": "reviewer"
  },
  "correlation": { "job_id": "9c77aa", "bead_id": "unitAI-review1", "chain_id": "unitAI-molecule1" },
  "body": {
    "target": "sqlite",
    "output_bytes": 18400,
    "notes_appended_to_bead": true,
    "status": "done"
  },
  "redaction": { "status": "clean" }
}
```

### 13.9 Service-skills drift detected

```json
{
  "schema_version": "xtrm.forensic.v1",
  "timestamp": "2026-06-01T18:48:00.000Z",
  "t_unix_ms": 1780339680000,
  "severity": "warn",
  "event_family": "service_skills",
  "event_name": "service_skills.drift_detected",
  "event_version": 1,
  "resource": {
    "service_namespace": "xtrm",
    "service_name": "service-skills",
    "service_component": "drift_detector",
    "deployment_environment": "local",
    "repo": "specialists"
  },
  "correlation": { "bead_id": "unitAI-service1" },
  "body": {
    "service": "specialists-runtime",
    "drift_tier": "high",
    "changed_files_count": 7,
    "skill_path": "config/skills/using-specialists-v3/SKILL.md",
    "verdict": "sync_required"
  },
  "redaction": { "status": "clean" }
}
```

### 13.10 Generic pulse emitted

```json
{
  "schema_version": "xtrm.forensic.v1",
  "timestamp": "2026-06-01T18:49:00.000Z",
  "t_unix_ms": 1780339740000,
  "severity": "info",
  "event_family": "pulse",
  "event_name": "pulse.emitted",
  "event_version": 1,
  "resource": {
    "service_namespace": "xtrm",
    "service_name": "substrate",
    "service_component": "participant-runtime",
    "deployment_environment": "local",
    "repo": "specialists"
  },
  "correlation": {
    "container_id": "chain:7f3a",
    "pulse_id": "pulse:01HZX",
    "participant_id": "participant:devops-advisor"
  },
  "body": {
    "pulse_type": "proposal",
    "target_class": "followup",
    "summary": "DevOps advisor proposed a non-blocking telemetry dashboard follow-up"
  },
  "redaction": { "status": "clean" }
}
```

## 14. Test and validation requirements

Implementation beads that emit, normalize, export, or project these events must include the relevant checks below.

### Schema and snapshot tests

- Validate every emitted event against `schema_version=xtrm.forensic.v1` required fields.
- Snapshot at least one event from each implemented family.
- Ensure legacy `TimelineEvent` records normalize to the envelope without data loss for existing fields.
- Verify `event_version` is present for every new event name.
- Verify unknown top-level fields are rejected or stripped by the shared writer.

### Cardinality tests

- Assert forbidden labels from §7 never appear in Loki label config or Prometheus label sets.
- Assert metric labels are drawn from allowlisted bounded fields.
- Include regression tests for `job_id`, `bead_id`, `chain_id`, `trace_id`, `span_id`, and `tool_call_id` not becoming labels.

### Redaction tests

- Feed representative secrets through tool args, command previews, error messages, and env-like payloads.
- Assert secret values are removed and `redaction.status="redacted"` with field names populated.
- Assert raw model output and prompt text are not shipped by default.

### Ordering tests

- For one job, assert `seq` is monotonic.
- For mixed jobs, assert readers sort by timestamp then job/seq and do not assume global sequence.
- Test replayed/imported events preserve original timestamp metadata.

### CLI/surface tests

- `sp log --json` returns normalized envelope fields for new events.
- `sp feed --json` remains backward-compatible NDJSON and includes resource/correlation fields.
- `sp ps --json` does not pretend to be the event stream; it may link to latest event/correlation IDs.
- `sp result --json` links persisted result events by job id and bead id.

### Metrics projection tests

- Counter/histogram/gauge names use base units and Prometheus suffix rules.
- High-cardinality identifiers appear only as exemplars or log links, not labels.
- Projection handles missing legacy fields as unknown, not zero, unless the state semantics guarantee zero.

### Validation checklist to paste into future beads

```text
VALIDATION — forensic telemetry contract
- [ ] New events are emitted through the shared envelope writer, not hand-built JSON.
- [ ] Every event has schema_version, timestamp, t_unix_ms, severity, event_family, event_name, event_version, resource, correlation, body, redaction.
- [ ] job_id/bead_id/chain_id/trace_id/span_id/tool_call_id are body/correlation fields only, never labels.
- [ ] Resource labels are bounded and match docs/telemetry/forensic-event-contract.md §4/§7.
- [ ] Redaction tests cover secrets in tool args, command previews, env-like payloads, and error text.
- [ ] Legacy TimelineEvent records still parse and display.
- [ ] At least one JSON fixture/snapshot exists for each new event family touched.
- [ ] Metrics projections use low-cardinality labels and base-unit names.
```

## 15. Shared emitter requirement

The contract is only effective if all writers use one helper. The implementation target should be a small shared module with these responsibilities:

- accept `resource`, `correlation`, `event_family`, `event_name`, `severity`, and event-specific `body`
- stamp `schema_version`, `timestamp`, `t_unix_ms`, `event_version`, and `seq` where applicable
- normalize resource and correlation keys
- apply redaction before persistence/shipping
- reject forbidden top-level fields
- provide adapters for specialists SQLite events, NDJSON file mirrors, future Loki shipping, and future OTEL export
- expose tests/fixtures used by all emitters

No caller should assemble final forensic JSON directly with ad-hoc object literals once the shared writer exists.

## 16. Implementation follow-up candidates

The documentation contract intentionally stops before code changes. Likely follow-up beads:

1. Implement `xtrm.forensic.v1` shared envelope writer for specialists.
2. Normalize `sp log --json` and `sp feed --json` output to the envelope while preserving legacy compatibility.
3. Add schema/cardinality/redaction fixtures and tests.
4. Add metrics projection/exporter using only allowlisted labels.
5. Add service-skills and pulse family emitters when those runtimes need telemetry.
