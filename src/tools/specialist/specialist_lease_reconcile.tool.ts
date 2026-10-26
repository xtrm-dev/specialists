// src/tools/specialist/specialist_lease_reconcile.tool.ts
import { resolve } from 'node:path';
import * as z from 'zod';
import {
  leaseScopeFor,
  operatorIdentity,
  projectUncertainWorkspaces,
  reconcile,
} from '../../activation/workspace-reconcile.js';
import type { LeaseProcessProbe } from '../../activation/workspace-lease.js';
import {
  SPECIALIST_LEASE_PARAMS,
  specialistToolDescription,
} from './descriptions.js';

export const specialistLeaseReconcileSchema = z.object({
  action: z.enum(['list', 'reconcile']).default('list').describe(SPECIALIST_LEASE_PARAMS.action),
  worktree: z.string().min(1).optional().describe(SPECIALIST_LEASE_PARAMS.worktree),
  outcome: z.enum(['safe_free', 'superseded', 'manual_attention_required']).optional().describe(
    SPECIALIST_LEASE_PARAMS.outcome,
  ),
  basis: z.array(z.string()).optional().describe(SPECIALIST_LEASE_PARAMS.basis),
  superseded_by: z.string().optional().describe(SPECIALIST_LEASE_PARAMS.superseded_by),
  note: z.string().optional().describe(SPECIALIST_LEASE_PARAMS.note),
});

/**
 * List and reconcile uncertain writer leases. The caller states the outcome and basis;
 * reconcile() validates and records it, and a refusal is returned as a result.
 */
export function createSpecialistLeaseReconcileTool(probe?: LeaseProcessProbe) {
  return {
    name: 'specialist_lease_reconcile' as const,
    description: specialistToolDescription('specialist_lease_reconcile', 'mcp'),
    inputSchema: specialistLeaseReconcileSchema,
    async execute(input: z.infer<typeof specialistLeaseReconcileSchema>) {
      if (input.action !== 'reconcile') {
        return { uncertain_workspaces: projectUncertainWorkspaces(leaseScopeFor(process.cwd()), probe) };
      }
      if (!input.worktree || !input.outcome) {
        return { status: 'error' as const, error: "reconcile requires 'worktree' and 'outcome'" };
      }
      const record = reconcile(leaseScopeFor(resolve(input.worktree)), {
        outcome: input.outcome,
        decidedBy: operatorIdentity('mcp'),
        basis: (input.basis ?? []).map(entry => entry.trim()).filter(entry => entry.length > 0),
        ...(input.superseded_by ? { supersededBy: input.superseded_by } : {}),
        ...(input.note ? { note: input.note } : {}),
      }, { probe });
      return {
        applied: record.applied,
        outcome: record.outcome,
        refusal_reason: record.refusalReason ?? null,
        record,
      };
    },
  };
}
