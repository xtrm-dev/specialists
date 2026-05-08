import type { EpicRunRecord, EpicState } from './epic-lifecycle.js';
import type { ObservabilitySqliteClient } from './observability-sqlite.js';
import type { SupervisorStatus } from './supervisor.js';
import { isProcessAlive } from './process-liveness.js';

const ACTIVE_JOB_STATUSES = new Set<SupervisorStatus['status']>(['starting', 'running', 'waiting']);
const TERMINAL_JOB_STATUSES = new Set<SupervisorStatus['status']>(['done', 'error']);
const REVIEWER_VERDICT_REGEX = /Verdict:\s*\**\s*(PASS|PARTIAL|FAIL)\s*\**/i;

export type ReviewerVerdict = 'pass' | 'partial' | 'fail' | 'missing';
export type ChainReadinessState = 'pending' | 'blocked' | 'pass' | 'failed';
export type EpicReadinessState = 'unresolved' | 'resolving' | 'blocked' | 'failed' | 'merge_ready' | 'merged' | 'abandoned';

interface EvaluatorJob {
  id: string;
  specialist: string;
  status: SupervisorStatus['status'];
  pid?: number;
  started_at_ms: number;
  result_text?: string;
}

export interface ChainReadinessSummary {
  chain_id: string;
  chain_root_bead_id?: string;
  state: ChainReadinessState;
  reviewer_verdict: ReviewerVerdict;
  blocking_reason?: string;
  has_active_jobs: boolean;
  job_ids: string[];
}

export interface PrepReadinessSummary {
  total: number;
  done: number;
  running: number;
  failed: number;
  blocker_job_ids: string[];
}

export interface EpicReadinessSummary {
  epic_id: string;
  persisted_state: EpicState;
  readiness_state: EpicReadinessState;
  next_state: EpicState;
  can_transition: boolean;
  prep: PrepReadinessSummary;
  chains: ChainReadinessSummary[];
  blockers: string[];
  summary: string;
}

function parseReviewerVerdict(output: string | undefined): ReviewerVerdict {
  if (!output) return 'missing';
  const match = output.match(REVIEWER_VERDICT_REGEX);
  if (!match?.[1]) return 'missing';
  const normalized = match[1].toUpperCase();
  if (normalized === 'PASS') return 'pass';
  if (normalized === 'PARTIAL') return 'partial';
  if (normalized === 'FAIL') return 'fail';
  return 'missing';
}

function evaluateChainReadiness(chainId: string, jobs: readonly EvaluatorJob[], chainRootBeadId?: string): ChainReadinessSummary {
  if (jobs.length === 0) {
    return {
      chain_id: chainId,
      chain_root_bead_id: chainRootBeadId,
      state: 'blocked',
      reviewer_verdict: 'missing',
      blocking_reason: 'No persisted chain jobs found (migration or orphaned row).',
      has_active_jobs: false,
      job_ids: [],
    };
  }

  const orderedJobs = [...jobs].sort((a, b) => a.started_at_ms - b.started_at_ms);
  const activeJobs = orderedJobs.filter((job) => ACTIVE_JOB_STATUSES.has(job.status));
  const deadActiveJobs = activeJobs.filter((job) => job.pid !== undefined && !isProcessAlive(job.pid, job.started_at_ms));
  const hasActiveJobs = activeJobs.length > 0;

  if (deadActiveJobs.length > 0) {
    return {
      chain_id: chainId,
      chain_root_bead_id: chainRootBeadId,
      state: 'failed',
      reviewer_verdict: 'missing',
      blocking_reason: `Active chain jobs appear dead: ${deadActiveJobs.map((job) => job.id).join(', ')}`,
      has_active_jobs: false,
      job_ids: orderedJobs.map((job) => job.id),
    };
  }

  if (hasActiveJobs) {
    return {
      chain_id: chainId,
      chain_root_bead_id: chainRootBeadId,
      state: 'pending',
      reviewer_verdict: 'missing',
      blocking_reason: `Active chain jobs: ${activeJobs.map((job) => job.id).join(', ')}`,
      has_active_jobs: true,
      job_ids: orderedJobs.map((job) => job.id),
    };
  }

  const reviewerJobs = orderedJobs
    .filter((job) => job.specialist === 'reviewer' && job.status === 'done')
    .map((job) => ({ ...job, verdict: parseReviewerVerdict(job.result_text) }))
    .filter((job) => job.verdict !== 'missing');

  if (reviewerJobs.length === 0) {
    return {
      chain_id: chainId,
      chain_root_bead_id: chainRootBeadId,
      state: 'blocked',
      reviewer_verdict: 'missing',
      blocking_reason: 'No terminal reviewer verdict found (PASS/PARTIAL/FAIL).',
      has_active_jobs: false,
      job_ids: orderedJobs.map((job) => job.id),
    };
  }

  const latestReviewer = reviewerJobs[reviewerJobs.length - 1]!;

  if (latestReviewer.verdict === 'pass') {
    return {
      chain_id: chainId,
      chain_root_bead_id: chainRootBeadId,
      state: 'pass',
      reviewer_verdict: 'pass',
      has_active_jobs: false,
      job_ids: orderedJobs.map((job) => job.id),
    };
  }

  const postReviewJobs = orderedJobs.filter((job) => job.started_at_ms > latestReviewer.started_at_ms);
  const hasPostReviewWork = postReviewJobs.some((job) => TERMINAL_JOB_STATUSES.has(job.status));

  if (hasPostReviewWork) {
    return {
      chain_id: chainId,
      chain_root_bead_id: chainRootBeadId,
      state: 'blocked',
      reviewer_verdict: latestReviewer.verdict,
      blocking_reason: 'Fix-loop work completed after non-PASS review; rerun reviewer to reach PASS.',
      has_active_jobs: false,
      job_ids: orderedJobs.map((job) => job.id),
    };
  }

  return {
    chain_id: chainId,
    chain_root_bead_id: chainRootBeadId,
    state: 'failed',
    reviewer_verdict: latestReviewer.verdict,
    blocking_reason: `Latest reviewer verdict is ${latestReviewer.verdict.toUpperCase()}.`,
    has_active_jobs: false,
    job_ids: orderedJobs.map((job) => job.id),
  };
}

function evaluatePrepReadiness(prepJobs: readonly SupervisorStatus[]): PrepReadinessSummary {
  const running = prepJobs.filter((job) => ACTIVE_JOB_STATUSES.has(job.status));
  const failed = prepJobs.filter((job) => job.status === 'error');
  const done = prepJobs.filter((job) => job.status === 'done');

  return {
    total: prepJobs.length,
    done: done.length,
    running: running.length,
    failed: failed.length,
    blocker_job_ids: [...running, ...failed].map((job) => job.id),
  };
}

function deriveEpicReadinessState(prep: PrepReadinessSummary, chains: readonly ChainReadinessSummary[]): EpicReadinessState {
  const hasActivePrep = prep.running > 0;
  const hasPendingChain = chains.some((chain) => chain.state === 'pending');
  const hasBlockedChain = chains.some((chain) => chain.state === 'blocked');
  const hasFailedPrep = prep.failed > 0;
  const hasFailedChain = chains.some((chain) => chain.state === 'failed');
  const allChainsPass = chains.length === 0 || chains.every((chain) => chain.state === 'pass');

  if (hasActivePrep || hasPendingChain) return 'resolving';
  if (hasFailedPrep || hasFailedChain) return 'failed';
  if (hasBlockedChain) return 'blocked';
  if (allChainsPass) return 'merge_ready';
  return 'blocked';
}

function deriveEpicNextState(persistedState: EpicState, readinessState: EpicReadinessState): EpicState {
  if (persistedState === 'merged' || persistedState === 'abandoned') return persistedState;
  if (readinessState === 'merge_ready') return 'merge_ready';
  if (readinessState === 'failed') return 'failed';
  return 'resolving';
}

function buildSummaryLine(epicId: string, persistedState: EpicState, readinessState: EpicReadinessState, prep: PrepReadinessSummary, chains: readonly ChainReadinessSummary[]): string {
  const chainPass = chains.filter((chain) => chain.state === 'pass').length;
  const chainTotal = chains.length;
  const blockedChains = chains.filter((chain) => chain.state === 'blocked' || chain.state === 'pending' || chain.state === 'failed').map((chain) => chain.chain_id);
  const failedChains = chains.filter((chain) => chain.state === 'failed').map((chain) => chain.chain_id);

  const prepSegment = `prep done=${prep.done}/${prep.total} running=${prep.running} failed=${prep.failed}`;
  const chainSegment = `chains pass=${chainPass}/${chainTotal}`;
  const stateSegment = persistedState === readinessState ? readinessState : `${readinessState} (stored=${persistedState})`;

  const segments = [prepSegment, chainSegment];
  if (blockedChains.length > 0) segments.push(`blocked=${blockedChains.join(', ')}`);
  if (failedChains.length > 0) segments.push(`failed=${failedChains.join(', ')}`);

  return `Epic ${epicId}: ${stateSegment} (${segments.join('; ')})`;
}

export function evaluateEpicReadinessSummary(input: {
  epicId: string;
  persistedState: EpicState;
  prepJobs: readonly SupervisorStatus[];
  chainInputs: ReadonlyArray<{ chain_id: string; chain_root_bead_id?: string; jobs: readonly EvaluatorJob[] }>;
}): EpicReadinessSummary {
  const prep = evaluatePrepReadiness(input.prepJobs);
  const chains = input.chainInputs.map((chain) => evaluateChainReadiness(chain.chain_id, chain.jobs, chain.chain_root_bead_id));
  const readinessState = deriveEpicReadinessState(prep, chains);
  const nextState = deriveEpicNextState(input.persistedState, readinessState);
  const blockers = [
    ...prep.blocker_job_ids.map((jobId) => `prep:${jobId}`),
    ...chains
      .filter((chain) => chain.state === 'pending' || chain.state === 'blocked' || chain.state === 'failed')
      .map((chain) => `chain:${chain.chain_id}`),
  ];

  return {
    epic_id: input.epicId,
    persisted_state: input.persistedState,
    readiness_state: readinessState,
    next_state: nextState,
    can_transition: nextState !== input.persistedState,
    prep,
    chains,
    blockers,
    summary: buildSummaryLine(input.epicId, input.persistedState, readinessState, prep, chains),
  };
}

export function loadEpicReadinessSummary(sqlite: ObservabilitySqliteClient, epicId: string): EpicReadinessSummary {
  const statuses = sqlite.listStatuses().filter((status) => status.epic_id === epicId);
  const persistedEpic = sqlite.readEpicRun(epicId);
  const persistedState: EpicState = persistedEpic?.status ?? 'open';

  const prepJobs = statuses.filter((status) => status.chain_kind !== 'chain');
  const chainRecords = sqlite.listEpicChains(epicId);

  const chainIds = new Set(chainRecords.map((record) => record.chain_id));
  for (const status of statuses) {
    if (status.chain_kind === 'chain' && status.chain_id) chainIds.add(status.chain_id);
  }

  const chainInputs = [...chainIds].map((chainId) => {
    const chainRecord = chainRecords.find((record) => record.chain_id === chainId);
    const chainJobs = statuses
      .filter((status) => status.chain_kind === 'chain' && status.chain_id === chainId)
      .sort((a, b) => a.started_at_ms - b.started_at_ms)
      .map((status) => ({
        id: status.id,
        specialist: status.specialist,
        status: status.status,
        pid: status.pid,
        started_at_ms: status.started_at_ms,
        result_text: sqlite.readResult(status.id) ?? undefined,
      }));

    return {
      chain_id: chainId,
      chain_root_bead_id: chainRecord?.chain_root_bead_id,
      jobs: chainJobs,
    };
  });

  return evaluateEpicReadinessSummary({
    epicId,
    persistedState,
    prepJobs,
    chainInputs,
  });
}

export function syncEpicStateFromReadiness(sqlite: ObservabilitySqliteClient, summary: EpicReadinessSummary): EpicRunRecord {
  const now = Date.now();
  const existing = sqlite.readEpicRun(summary.epic_id);
  const recoveredFromLegacyFailure = summary.persisted_state === 'failed' && summary.readiness_state === 'merge_ready';
  const nextRecord: EpicRunRecord = {
    epic_id: summary.epic_id,
    status: summary.next_state,
    updated_at_ms: now,
    status_json: JSON.stringify({
      epic_id: summary.epic_id,
      status: summary.next_state,
      persisted_state: summary.persisted_state,
      readiness_state: summary.readiness_state,
      blockers: summary.blockers,
      prep: summary.prep,
      chains: summary.chains,
      summary: summary.summary,
      evaluated_at_ms: now,
      note: recoveredFromLegacyFailure ? 'derived readiness healed legacy failed row after live chains turned pass' : undefined,
    }),
  };

  if (summary.can_transition || recoveredFromLegacyFailure || !existing) {
    sqlite.upsertEpicRun(nextRecord);
  }

  return nextRecord;
}
