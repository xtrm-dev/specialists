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

export const specialistLeaseReconcileSchema = z.object({
  action: z.enum(['list', 'reconcile']).default('list').describe(
    "'list' returns uncertain workspaces with the outcomes permitted for each; 'reconcile' records a decision for one worktree.",
  ),
  worktree: z.string().min(1).optional().describe("reconcile: the worktree whose lease is uncertain."),
  outcome: z.enum(['safe_free', 'superseded', 'manual_attention_required']).optional().describe(
    'reconcile: the outcome the operator asserts. Never inferred.',
  ),
  basis: z.array(z.string()).optional().describe(
    'reconcile: the durable evidence consulted, one entry per source. Empty is refused.',
  ),
  superseded_by: z.string().optional().describe("reconcile: required for 'superseded'; the activation that now owns the workspace."),
  note: z.string().optional().describe('reconcile: free-form note carried into the durable record.'),
});

/**
 * List and reconcile uncertain writer leases. The caller states the outcome and basis;
 * reconcile() validates and records it, and a refusal is returned as a result.
 */
export function createSpecialistLeaseReconcileTool(probe?: LeaseProcessProbe) {
  return {
    name: 'specialist_lease_reconcile' as const,
    description: "List uncertain writer leases (action 'list', default) or resolve one (action 'reconcile' with worktree, outcome and basis). The caller states the outcome; it is never inferred, and a refusal returns its refusal_reason.",
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
