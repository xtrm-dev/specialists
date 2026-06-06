---
title: AgentOps Event Catalog
scope: telemetry-agentops-event-catalog
category: reference
version: 1.0.0
updated: 2026-06-04
source_of_truth_for:
  - "xtrm AgentOps event names"
  - "forensic event family catalog"
  - "forensic-to-metrics projection hints"
domain:
  - telemetry
  - observability
  - agentops
  - substrate
  - specialists
summary: "Catalog of xtrm AgentOps forensic event families and names, mapped to envelope fields, evidence semantics, and Prometheus projection eligibility."
---

# AgentOps Event Catalog

## Design context

This catalog names the AgentOps events that xtrm emitters should use when
writing `xtrm.forensic.v1` records. It complements:

- `docs/telemetry/forensic-event-contract.md` — envelope, identity, redaction,
  correlation, and event-family rules.
- `docs/telemetry/prometheus-projection-contract.md` — low-cardinality metrics
  projected from forensic events and runtime state.
- `/home/dawid/second-mind/1-projects/xtrm/substrate/substrate_design_it.md` —
  broad substrate design and lineage/evidence model.
- `/home/dawid/second-mind/1-projects/xtrm/devops/devops-system.md` — DevOps /
  AgentOps vertical design.

The catalog is implementation-ready but not a mandate to implement every emitter
immediately. New emitters should reuse these names before inventing variants.

## 1. Global rules

All events in this catalog use the canonical envelope:

- `schema_version: "xtrm.forensic.v1"`
- `event_family`: bounded family from this document
- `event_name`: exact dot-delimited name from this document
- `resource`: bounded labels/resource attributes only
- `correlation`: opaque IDs used for lineage joins
- `body`: event-specific payload, already redacted
- `redaction`: redaction status and touched fields

### 1.1 Required identity and correlation fields

Use these fields when available. Missing fields are allowed only when the emitter
cannot know them at emission time.

| Field | Location | Use |
|---|---|---|
| `participant_kind` | `resource` | L1 bounded identity: `specialist`, `orchestrator`, `adapter`, `pulse_emitter`, `node_member`, etc. |
| `participant_role` | `resource` | L2 bounded role: `executor`, `reviewer`, `devops`, `mcp-grafana`, etc. |
| `participant_id` | `correlation` | L3 stable participant identity within scope. Never a metric label. |
| `job_id` | `correlation` | L4 activation/run identity. New per run. Never a metric label. |
| `event_id` / `turn_id` / `tool_call_id` | `correlation` | L5 per-fact ids. Never metric labels. |
| `container_id`, `chain_id`, `issue_id`, `pulse_id` | `correlation` | Opaque lineage handles. Never metric labels. |
| `session_id`, `conversation_id` | `correlation` | Opaque session/thread ids. Never metric labels. |
| `trace_id`, `span_id`, `parent_span_id` | `correlation` / `trace` | Optional causal hierarchy / exemplars. |
| `mcp_session_id`, `jsonrpc_request_id` | `correlation` | MCP/JSON-RPC ids. Never metric labels. |
| `eval_id`, `policy_decision_id`, `identity_request_id` | `correlation` | Evaluation/policy/identity ids. Never metric labels. |

### 1.2 Metric projection key

The `Prometheus` column in the tables below means:

- **yes** — event should normally project to a counter/histogram/gauge family in
  `prometheus-projection-contract.md`.
- **state** — event usually updates durable state; exporter reads the current
  state as a gauge rather than incrementing directly from the event.
- **optional** — useful for diagnostics, but do not add a metric until an alert,
  SLO, or dashboard needs it.
- **no** — forensic-only; keep as log/evidence.

Prometheus labels are limited to bounded fields such as `service_name`, `repo`,
`participant_kind`, `participant_role`, `state`, `result`, `error_type`,
`pulse_kind`, `mcp_server`, and `mcp_method`. Never label by job/container/issue
ids, raw file paths, commands, URLs, prompts, or error text.

## 2. Job lifecycle

`event_family: job` covers one activation/run of a participant.

| Event | Emit when | Body fields | Evidence / lineage | Prometheus |
|---|---|---|---|---|
| `job.created` | Runtime accepts a run request and persists intent. | `requested_by`, `mode`, `worktree_mode`, `model`, `context_depth` | Links request to bead/issue/container before process spawn. | yes (`xtrm_jobs_total` only if terminal; created may feed queue metrics) |
| `job.started` | Process/session begins executing. | `pid`, `cwd`, `command_kind`, `started_reason` | Activation is live; join to participant and container. | state / duration start |
| `job.waiting` | Keep-alive job becomes resumable/idle. | `waiting_reason`, `last_turn_id`, `resume_hint` | Explains why work is paused but not terminal. | yes (`xtrm_job_wait_seconds`, `xtrm_job_state`) |
| `job.resumed` | Waiting job receives a new turn/control input. | `resume_reason`, `source`, `previous_wait_ms` | Connects steer/resume to later output. | yes |
| `job.completed` | Activation ends successfully. | `elapsed_ms`, `active_runtime_ms`, `turns`, `result_ref` | Terminal evidence; may link result/session report. | yes (`result=success`) |
| `job.failed` | Activation ends with error. | `elapsed_ms`, `failure_class`, `error_type`, `message_redacted` | Preserves failure evidence and recovery context. | yes (`result=error`) |
| `job.cancelled` | Operator/runtime cancellation terminates activation. | `cancel_reason`, `signal`, `elapsed_ms` | Records intentional stop vs failure. | yes (`result=cancelled`) |

Recommended result values: `success`, `error`, `cancelled`, `skipped`, `unknown`.

## 3. Chain and epic orchestration

`event_family: chain` and `event_family: epic` describe substrate/specialists
orchestration state, not individual model turns.

| Event | Emit when | Body fields | Evidence / lineage | Prometheus |
|---|---|---|---|---|
| `chain.created` | A chain/container or bridge-era molecule is materialized. | `chain_template`, `root_issue_id`, `opened_reason` | Root of chain lineage. | state |
| `chain.member.started` | A step/advisor/gate member begins. | `member_role`, `member_class`, `step_issue_id`, `position` | Shows resolved chain shape progress. | yes (`xtrm_jobs_total` via job events; optional chain counter) |
| `chain.member.completed` | A member produces terminal evidence. | `member_role`, `verdict`, `evidence_ref` | Step-level completion and evidence link. | optional / gate metrics if verdicted |
| `chain.ready_for_review` | Writer work is done and review gates can run. | `ready_reason`, `changed_paths_count`, `lease_state` | Boundary from execution to verification. | optional |
| `chain.finalized` | Chain is closed/finalized after PASS or terminal decision. | `chain_template`, `finalize_reason`, `terminal_state`, `evidence_refs` | Close-time lineage and memory distillation trigger. | yes (`xtrm_chains_total`, `xtrm_chain_duration_seconds`) |
| `epic.merge_attempted` | Multi-chain/epic merge begins. | `child_count`, `merge_strategy`, `base_ref` | Explains merge operation inputs. | yes |
| `epic.merged` | Epic merge succeeds. | `child_count`, `commit_sha`, `pr_id` | Publication evidence. | yes (`result=success`) |
| `epic.merge_failed` | Epic merge fails/conflicts. | `error_type`, `conflict_paths_count`, `retryable` | Preserves conflict evidence; may spawn follow-up. | yes (`result=error`) |

## 4. Reviewer flow and gates

Use `event_family: review` for human/agent review state and verdicts. Gate-like
metrics project through `xtrm_gate_verdicts_total`.

| Event | Emit when | Body fields | Evidence / lineage | Prometheus |
|---|---|---|---|---|
| `review.started` | Reviewer/gate begins evaluating evidence. | `review_kind`, `scope`, `ddiff_base` | Review boundary; links to issue/chain. | optional |
| `review.verdict.pass` | Reviewer emits PASS. | `gate_kind`, `verdict`, `confidence`, `tested_commands`, `evidence_refs` | Satisfies gate/close readiness. | yes (`gate_kind`, `verdict=PASS`) |
| `review.verdict.partial` | Reviewer emits PARTIAL/FINDINGS. | `gate_kind`, `verdict`, `findings_count`, `blocking_count`, `evidence_refs` | Drives ddiff loop; not terminal success. | yes (`gate_kind`, `verdict=PARTIAL`) |
| `review.verdict.fail` | Reviewer emits FAIL. | `gate_kind`, `verdict`, `failure_class`, `findings_count`, `evidence_refs` | Can trigger semantic recovery/escalation. | yes (`gate_kind`, `verdict=FAIL`) |
| `review.rebuttal_requested` | Executor/operator asks for reviewer reconsideration. | `reason`, `target_finding_ids` | Explains review loop mutation. | optional |
| `review.recheck_started` | Reviewer starts a ddiff-scoped recheck. | `ddiff_base`, `changed_paths_count` | Separates recheck from first review. | optional |

## 5. Tool and command runtime

`tool.*` is for structured tool calls inside an activation. `command.*` is for
subprocess/CLI commands whose output matters operationally.

| Event | Emit when | Body fields | Evidence / lineage | Prometheus |
|---|---|---|---|---|
| `tool.call.started` | Tool invocation begins. | `tool_name`, `args_shape`, `timeout_ms` | Start of L5 tool fact. | duration start |
| `tool.call.completed` | Tool invocation succeeds. | `tool_name`, `duration_ms`, `result_shape` | Success evidence; raw result stays redacted/body. | yes |
| `tool.call.failed` | Tool invocation fails. | `tool_name`, `duration_ms`, `error_type`, `message_redacted` | Failure evidence. | yes |
| `command.started` | CLI/subprocess begins. | `command_kind`, `cwd_scope`, `timeout_ms` | Start of command fact; no raw command label. | duration start |
| `command.completed` | CLI/subprocess exits 0 / expected. | `command_kind`, `duration_ms`, `exit_code` | Validation/deploy evidence where relevant. | yes |
| `command.failed` | CLI/subprocess fails. | `command_kind`, `duration_ms`, `exit_code`, `error_type` | Failure and remediation input. | yes |

`command_kind` should be normalized (`test`, `lint`, `build`, `git`, `docker`,
`terraform_plan`, `health_check`, `other`), not the raw shell string.

## 6. Process and worktree health

Health events describe substrate/specialists operating conditions.

| Event | Emit when | Body fields | Evidence / lineage | Prometheus |
|---|---|---|---|---|
| `process.spawned` | Managed child process starts. | `process_kind`, `pid`, `command_kind` | Runtime/process lineage. | state |
| `process.exited` | Managed child process exits. | `process_kind`, `exit_code`, `signal`, `duration_ms` | Distinguishes clean exit from crash. | yes/state |
| `process.orphan_detected` | Health scan finds orphan/stale process. | `process_kind`, `age_seconds`, `rss_bytes` | Cleanup evidence. | yes |
| `process.reaped` | Orphan cleanup succeeds/fails. | `process_kind`, `signal`, `result` | Proves cleanup action. | yes |
| `process.health.degraded` | Process health crosses warning/refuse threshold. | `reason`, `count`, `threshold` | Alert input. | yes |
| `worktree.created` | Worktree is created/leased for work. | `worktree_mode`, `base_ref` | Work lineage. | state |
| `worktree.dirty_detected` | Health/collision scan sees dirty state. | `dirty_paths_count`, `age_seconds` | Merge/cleanup risk evidence. | yes/state |
| `worktree.merged` | Worktree changes are merged/published. | `commit_sha`, `pr_id`, `merge_strategy` | Publication evidence. | yes |
| `worktree.cleanup_started` | Cleanup begins. | `cleanup_reason`, `preserve_failed` | Cleanup lineage. | optional |
| `worktree.cleanup_failed` | Cleanup cannot complete. | `error_type`, `reason` | Operational debt evidence. | yes |
| `worktree.cleanup_completed` | Cleanup succeeds. | `removed_paths_count`, `duration_ms` | Closeout evidence. | yes |

## 7. MCP observability

MCP has two meanings in xtrm: internal AgentOps/DevOps MCPs that observe/control
xtrm, and client/Mercury MCPs that should integrate cleanly with xtrm
observability. Both use the same event naming and label discipline.

| Event | Emit when | Body fields | Evidence / lineage | Prometheus |
|---|---|---|---|---|
| `mcp.connected` | MCP session/client connects. | `mcp_server`, `transport`, `capabilities_count` | Session start. | state |
| `mcp.disconnected` | MCP session/client disconnects. | `mcp_server`, `reason`, `duration_ms` | Session end. | yes/state |
| `mcp.call.started` | MCP method/tool call begins. | `mcp_server`, `mcp_method`, `tool_name` | Call start. | duration start |
| `mcp.call.completed` | MCP call succeeds. | `mcp_server`, `mcp_method`, `duration_ms` | Call evidence. | yes |
| `mcp.call.failed` | MCP call fails. | `mcp_server`, `mcp_method`, `duration_ms`, `error_type` | Failure evidence. | yes |
| `mcp.auth.failed` | MCP auth/permission fails. | `mcp_server`, `auth_scope`, `error_type` | Security/permission evidence. | yes |
| `mcp.rate_limited` | MCP server/client reports rate limiting. | `mcp_server`, `retry_after_ms`, `limit_scope` | Backoff evidence. | yes |
| `mcp.latency.observed` | Passive latency sample/health check records latency. | `mcp_server`, `mcp_method`, `duration_ms` | Health evidence. | yes |

Never label by MCP session id, JSON-RPC id, raw args, result text, URL, or token.

Shipped bridge status (2026-06-06): specialists now emits live MCP forensic
events from the MCP gateway/integration path, and `src/specialist/forensic-events.ts`
still normalizes `type: "mcp"` timeline events into this catalog. It extracts
`mcp_session_id` and `jsonrpc_request_id` from direct fields or `_meta`, keeps
them in correlation, and adds semconv-style `otel` attributes (`mcp.method.name`,
`mcp.session.id`, `jsonrpc.request.id`, `network.transport`, and GenAI tool
hints). Prometheus projection supports bounded `xtrm_mcp_operations_total`
without forbidden labels.

## 8. Service skills

Use `event_family: service_skills` for service-skill activation, drift, sync, and
librarian outcomes.

| Event | Emit when | Body fields | Evidence / lineage | Prometheus |
|---|---|---|---|---|
| `service_skills.activated` | Service skill/persona is selected for a territory. | `service_id`, `pack_id`, `activation_reason` | Explains expert-persona routing. | optional |
| `service_skills.completed` | Skill/librarian run completes. | `service_id`, `result`, `edited` | Sync/run close evidence. | yes |
| `service_skills.failed` | Skill/librarian run fails. | `service_id`, `error_type`, `triage_state` | Failure evidence. | yes |
| `service_skills.drift_detected` | Drift detector finds candidate drift. | `service_id`, `drift_tier`, `tier_source`, `files_count` | Trigger evidence. | yes |
| `service_skills.updated` | Skill doc/registry is updated or sync-marked. | `service_id`, `update_kind`, `last_sync_ref` | Documentation freshness evidence. | yes |

`service_id` is the registry id and may be a metric label only if bounded by the
service registry. File paths remain body/correlation only.

## 9. Pulse emitters

`event_family: pulse` describes substrate/node/event-bus signaling.

| Event | Emit when | Body fields | Evidence / lineage | Prometheus |
|---|---|---|---|---|
| `pulse.emitted` | Registered emitter emits a trigger/job/message pulse. | `pulse_kind`, `idempotency_key_hash`, `source_kind` | Signal source and dedup input. | yes |
| `pulse.dropped` | Pulse is intentionally dropped before delivery. | `pulse_kind`, `drop_reason`, `deduped` | Explains no-op. | yes |
| `pulse.delayed` | Pulse delivery is delayed/backoffed. | `pulse_kind`, `delay_ms`, `reason` | Queue health evidence. | yes |
| `pulse.backpressure_detected` | Queue/depth/latency exceeds policy. | `pulse_kind`, `queue_depth`, `threshold` | Alert input. | yes |
| `pulse.consumed` | Target participant/container consumes pulse. | `pulse_kind`, `delivery_ms`, `target_kind` | Delivery success. | yes |
| `pulse.failed` | Pulse delivery/handling fails. | `pulse_kind`, `error_type`, `retryable` | Failure evidence. | yes |

The idempotency key should not be stored raw if it contains external object names;
store a hash plus redacted body fields.

## 10. Identity, policy, and evaluations

These families close the AgentCore/AgentOps gap identified by `unitAI-eoqxp.1.1`.
They are forensic-first: most events are audit/evidence records, with only
bounded outcome counters projected to Prometheus.

### 10.1 Identity and credentials

Use `event_family: identity` for credential, token, service-account, workload
identity, and auth-material operations.

| Event | Emit when | Body fields | Evidence / lineage | Prometheus |
|---|---|---|---|---|
| `identity.credential.requested` | Runtime asks for a credential/token/API key. | `credential_kind`, `provider`, `scope_kind` | Start of credential fetch. | optional |
| `identity.credential.issued` | Credential/token fetch succeeds. | `credential_kind`, `provider`, `ttl_seconds`, `scope_kind` | Auth success; secret value never stored. | yes |
| `identity.credential.failed` | Credential/token fetch fails. | `credential_kind`, `provider`, `error_type`, `retryable` | Auth failure evidence. | yes |
| `identity.throttled` | Identity provider throttles. | `provider`, `credential_kind`, `retry_after_ms` | Backoff evidence. | yes |

Never store credential values, raw tokens, API keys, or OAuth grants. Store only
kind/provider/scope metadata and redacted error categories.

### 10.2 Policy and approval decisions

Use `event_family: policy` for deterministic permission checks, approval gates,
tool-policy decisions, and policy mismatches.

| Event | Emit when | Body fields | Evidence / lineage | Prometheus |
|---|---|---|---|---|
| `policy.evaluation.started` | Runtime begins policy/permission check. | `policy_kind`, `action_kind`, `resource_kind` | Start of gate decision. | optional |
| `policy.decision.allowed` | Policy permits action. | `policy_kind`, `action_kind`, `approval_ref` | Approval/audit evidence. | yes |
| `policy.decision.denied` | Policy denies action. | `policy_kind`, `action_kind`, `reason_code` | Safety blocker evidence. | yes |
| `policy.mismatch.detected` | Declared policy and attempted action disagree. | `policy_kind`, `mismatch_kind`, `severity` | Misconfiguration / escalation input. | yes |

`action_kind` and `resource_kind` must be normalized bounded enums such as
`tool_call`, `terraform_apply`, `docker_restart`, `dashboard_write`, `secret_read`,
`repo_write`; never raw command strings or paths.

### 10.3 Evaluations

Use `event_family: eval` for quality/eval outcomes over jobs, sessions, traces,
outputs, trajectories, or datasets.

| Event | Emit when | Body fields | Evidence / lineage | Prometheus |
|---|---|---|---|---|
| `eval.started` | Eval run begins. | `eval_kind`, `target_kind`, `dataset_ref` | Eval scope evidence. | optional |
| `eval.completed` | Eval run completes. | `eval_kind`, `target_kind`, `result`, `score`, `threshold` | Quality evidence and gate input. | yes |
| `eval.failed` | Eval infrastructure fails. | `eval_kind`, `error_type`, `retryable` | Eval failure evidence. | yes |
| `eval.score.recorded` | Score is recorded independently of run lifecycle. | `eval_kind`, `score`, `scale`, `threshold` | Score history. | yes |

Allowed `eval_kind` examples: `correctness`, `goal_success`, `trajectory_exact`,
`trajectory_in_order`, `safety`, `policy_compliance`, `custom`. Dataset ids and
sample ids stay in correlation/body only.

## 11. Token usage and deferred billing

Current specialists/xtrm telemetry must treat token usage as the reliable signal
and USD cost as future-only. The project currently uses subscription plans rather
than directly priced provider API calls, so USD attribution would be misleading.

Use `model.token_usage.recorded` for token counts. Body fields should include the
best available split:

| Field | Meaning |
|---|---|
| `input_tokens` | Prompt/input tokens. |
| `output_tokens` | Completion/output tokens. |
| `cache_read_tokens` | Cache read/hit tokens where exposed. |
| `cache_creation_tokens` | Cache write/creation tokens where exposed. |
| `reasoning_tokens` | Reasoning/thinking tokens where exposed separately. |
| `tool_tokens` | Tool-call/tool-result tokens where measurable separately. |
| `total_tokens` | Provider/runtime total, or derived sum when safe. |
| `usage_source` | `provider_usage`, `runtime_estimate`, `local_estimate`, or `unknown`. |

Prometheus projects these into `xtrm_llm_tokens_total` with bounded `direction`
values: `input`, `output`, `cache_read`, `cache_creation`, `reasoning`, `tool`.
Overall totals should normally be dashboard/recording-rule sums over the split
directions. Use `direction=total` only when an upstream source exposes no split.

A future API-billing phase may add `billing_provenance` and USD metrics after the
runtime has explicit provider usage/pricing provenance. Do not export USD cost as
a current authoritative metric.

## 12. Evidence kinds

Evidence is the semantic payload used for close/merge/review decisions. Evidence
can be written as dedicated forensic events or as `links` / `body.evidence_refs`
on the events above.

Allowed `evidence_kind` values for `xtrm_evidence_refs_total`:

| Kind | Examples |
|---|---|
| `verdict` | reviewer PASS/PARTIAL/FAIL, chain coordinator decision |
| `test` | unit/integration/smoke command result |
| `diff` | changed file summary, per-file +/- counts, ddiff base, linked hunks/artifact |
| `commit` | commit SHA, auto-commit result |
| `pr` | PR id/url/status |
| `report` | session-close report, handoff report |
| `rca` | incident analysis / root cause |
| `dashboard` | Grafana/Gitboard/console drill-down link |
| `deployment` | deploy event, rollback event, health after deploy |
| `memory` | distilled memory/best-practice/failure record |

Evidence refs may contain high-cardinality IDs, file paths, and diff hunks in `correlation`, `body`, `links`, or
`links`. They are never Prometheus labels.

## 13. New-event procedure

Before adding a new event name:

1. Check whether an existing event here covers the semantic use.
2. If the difference is only payload shape, keep the same `event_name` and bump
   `event_version` only if incompatible.
3. If a new event is necessary, add it to this catalog with body fields,
   evidence semantics, and Prometheus projection eligibility.
4. Update `forensic-event-contract.md` family examples if the family is new.
5. Add tests proving redaction, forbidden-label exclusion, and JSON envelope
   shape for the emitter.
6. If it projects to metrics, update `prometheus-projection-contract.md` and
   parser/label validation.

