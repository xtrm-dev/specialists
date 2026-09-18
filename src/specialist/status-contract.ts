// src/specialist/status-contract.ts
// Neutral status contract for Supervisor jobs.
//
// This module owns the persisted status shape (status.json / specialist_jobs.status_json)
// so the native activation path can depend on it without depending on the legacy
// Supervisor runtime. It must NOT import from supervisor.ts, not even as `import type`.

import type { SessionRunMetrics } from './session-metrics-contract.js';
import type { RuntimeOriginV1, SpecialistSpawnOriginV1 } from './runtime-origin.js';

export interface MandatoryRulesInjectionProjection {
  sets_loaded: string[];
  rules_count: number;
  inline_rules_count: number;
  globals_disabled: boolean;
  token_estimate: number;
  budget_limit: number;
  candidate_tokens: number;
  injected_tokens: number;
  injected_section_ids: string[];
  evicted_section_ids: string[];
  payload_digest: string;
  outcome: 'full' | 'degraded' | 'impossible';
}

export type SupervisorJobStatus = 'starting' | 'running' | 'waiting' | 'done' | 'error' | 'cancelled';

export type ContextHealth = 'OK' | 'MONITOR' | 'WARN' | 'CRITICAL';

export interface SupervisorStatus {
  id: string;
  specialist: string;
  status: SupervisorJobStatus;
  current_event?: string;
  current_tool?: string;
  model?: string;
  backend?: string;
  output_type?: string;
  pid?: number;
  started_at_ms: number;
  elapsed_s?: number;
  last_event_at_ms?: number;
  bead_id?: string;
  node_id?: string;
  session_id?: string;
  conversation_id?: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  session_file?: string;
  fifo_path?: string;
  tmux_session?: string;
  worktree_path?: string;
  reused_from_job_id?: string;
  worktree_owner_job_id?: string;
  chain_kind?: 'chain' | 'prep';
  chain_id?: string;
  chain_root_job_id?: string;
  chain_root_bead_id?: string;
  epic_id?: string;
  branch?: string;
  startup_payload_json?: string;
  startup_context?: {
    job_id?: string;
    specialist_name?: string;
    bead_id?: string;
    reused_from_job_id?: string;
    worktree_owner_job_id?: string;
    chain_id?: string;
    chain_root_job_id?: string;
    chain_root_bead_id?: string;
    worktree_path?: string;
    branch?: string;
    variables_keys?: string[];
    reviewed_job_id_present?: boolean;
    reused_worktree_awareness_present?: boolean;
    bead_context_present?: boolean;
    memory_injection?: {
      static_tokens: number;
      memory_tokens: number;
      gitnexus_tokens: number;
      total_tokens: number;
    };
    mandatory_rules_injection?: MandatoryRulesInjectionProjection;
    skills?: {
      count: number;
      activated: string[];
    };
    // Compact origin projection for run_start / status inspection.
    // Full origin lives in SupervisorStatus.spawn_origin / .root_runtime_origin.
    spawn_origin_kind?: 'xtmux.agent_instance' | 'specialist.job' | 'unknown';
    parent_job_id?: string;
    root_pane_id?: string;
    root_agent_instance_id?: string;
  };
  metrics?: SessionRunMetrics;
  context_pct?: number;
  context_health?: ContextHealth;
  /**
   * Provenance of `context_pct` (SPECIALISTS-120 criterion 2): `pi_session_stats` is Pi's own
   * native context reading; `specialists_fallback` is a local MODEL_CONTEXT_WINDOWS estimate
   * that covers only the model families it knows.
   */
  context_pct_source?: 'pi_session_stats' | 'specialists_fallback';
  error?: string;
  auto_commit_count?: number;
  last_auto_commit_sha?: string;
  last_auto_commit_at_ms?: number;
  // PR/base drift state (specialists-05q.1). Optional + nullable for back-compat with rows
  // written before schema V13. Mirrored to specialist_jobs columns for queryability via
  // ObservabilitySqliteClient.updatePrDriftState / readPrDriftState. Refresh logic lives in
  // specialists-05q.2 (refresh/attention) — this bead only carries the durable shape.
  // Bridge → substrate: each field renames 1:1 onto containers.* per specialists-roadmap §B.3.
  pr_url?: string;
  pr_head_sha?: string;
  pr_state?: string;
  pr_merge_state?: string;
  pr_classification?: string;
  pr_base_ref?: string;
  pr_base_sha?: string;
  pr_drift_checked_at_ms?: number;
  base_sha_pinned?: string;
  base_sha_pinned_at_ms?: number;
  // xtmux runtime origin binding (spec docs/xtmux-gaps.md §13.3).
  // Recorded once at initial status construction via resolveSpawnOrigin.
  spawn_origin?: SpecialistSpawnOriginV1;
  parent_job_id?: string;
  root_runtime_origin?: RuntimeOriginV1;
}

export type SupervisorStatusView = SupervisorStatus & { is_dead: boolean };
