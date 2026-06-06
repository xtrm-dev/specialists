import { randomUUID } from 'node:crypto';

import type { SupervisorStatus } from './supervisor.js';

export const CHAIN_KINDS = ['chain', 'prep'] as const;

export type ChainKind = (typeof CHAIN_KINDS)[number];

export interface PersistedChainIdentity {
  chain_kind: ChainKind;
  chain_id?: string;
  chain_root_job_id?: string;
  chain_root_bead_id?: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
}

export interface ChainIdentityResolverInput extends Pick<SupervisorStatus, 'id' | 'bead_id' | 'worktree_path' | 'worktree_owner_job_id' | 'chain_id' | 'chain_root_job_id' | 'chain_root_bead_id' | 'trace_id' | 'span_id' | 'parent_span_id'> {}

export interface ChainRootSnapshot {
  bead_id?: string;
  chain_root_bead_id?: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
}

export function isChainKind(value: string | undefined): value is ChainKind {
  return value === 'chain' || value === 'prep';
}

export function derivePersistedChainIdentity(
  status: ChainIdentityResolverInput,
  chainRootSnapshot?: ChainRootSnapshot,
): PersistedChainIdentity {
  // Deterministic fallback for historical rows:
  // - missing chain markers + no worktree lineage => prep
  // - any lineage marker/worktree => chain rooted at owner/id
  const isChainJob = Boolean(status.worktree_path || status.worktree_owner_job_id || status.chain_id || status.chain_root_job_id);

  if (!isChainJob) {
    return { chain_kind: 'prep' };
  }

  const chainRootJobId = status.chain_root_job_id ?? status.worktree_owner_job_id ?? status.id;
  const chainId = status.chain_id ?? chainRootJobId;
  const chainRootBeadId = status.chain_root_bead_id
    ?? (chainRootJobId === status.id ? status.bead_id : undefined)
    ?? chainRootSnapshot?.chain_root_bead_id
    ?? chainRootSnapshot?.bead_id;

  return {
    chain_kind: 'chain',
    chain_id: chainId,
    chain_root_job_id: chainRootJobId,
    chain_root_bead_id: chainRootBeadId,
    trace_id: status.trace_id ?? chainRootSnapshot?.trace_id ?? randomUUID(),
    span_id: status.span_id ?? chainRootSnapshot?.span_id,
    parent_span_id: status.parent_span_id ?? chainRootSnapshot?.parent_span_id,
  };
}
