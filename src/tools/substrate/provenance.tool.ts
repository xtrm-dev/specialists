// src/tools/substrate/provenance.tool.ts
//
// MCP transport over Substrate's ProvenanceService — answers "what commits,
// receipts and artifacts belong to this issue" without shelling out.
//
// Substrate is authority; this tool is transport. It never recomputes a trace
// locally: WorkItemStore has no trace(), so ProvenanceService.trace is called
// directly (no pass-through). The service is INJECTED as a getter and typed
// structurally — @xtrm/substrate is unpublished (npm 404) and does not resolve
// from this repo, so even a type-only import would break `tsc --noEmit`. The
// structural interface below mirrors the ProvenanceService methods this tool
// calls; a plain `import type` becomes possible once .9 lands resolution.
import * as z from 'zod';
import { resolveSubstrate, substrateUnavailablePayload } from '../../substrate/services.js';

/** Bound for every collection in every payload (unitAI-aiwva.8 lesson). */
export const MAX_PROVENANCE_ENTRIES = 50;

export const substrateProvenanceSchema = z.object({
  op: z
    .enum(['trace', 'bindings', 'receipts', 'find_by_commit', 'find_by_pr', 'artifacts', 'bind_commit', 'bundle'])
    .describe('Which provenance read to run. bind_commit is the only mutating op.'),
  issue_id: z.string().optional().describe('Issue id (trace, bindings, receipts, bundle).'),
  receipt_id: z.string().optional().describe('Receipt id (artifacts, bind_commit).'),
  sha: z.string().optional().describe('Commit SHA (find_by_commit, bind_commit).'),
  pr: z.string().optional().describe('PR ref (find_by_pr).'),
  live_only: z.boolean().optional().describe('Artifacts op: live bindings only (default true).'),
});

export type SubstrateProvenanceInput = z.infer<typeof substrateProvenanceSchema>;

/**
 * Structural mirror of the ProvenanceService methods this tool calls.
 * `unknown` payloads keep this file decoupled from Substrate domain types.
 */
export interface ProvenanceServiceLike {
  trace(issue_id: string): {
    bindings: unknown[];
    receipts: unknown[];
    checkpoints: unknown[];
    commits: unknown[];
    prs: unknown[];
    claims: unknown[];
    externalBindings: unknown[];
    [key: string]: unknown;
  };
  listBindings(issue_id: string): unknown[];
  listReceipts(issue_id: string): unknown[];
  findByCommit(sha: string): unknown[];
  findByPr(ref: string): unknown[];
  listArtifacts(receipt_id: string, opts?: { liveOnly?: boolean }): unknown[];
  bindCommit(receipt_id: string, sha: string): unknown;
  generateBundle(issue_id: string): { path: string };
}

function cap<T>(items: T[]): { items: T[]; total: number; truncated: boolean } {
  return { items: items.slice(0, MAX_PROVENANCE_ENTRIES), total: items.length, truncated: items.length > MAX_PROVENANCE_ENTRIES };
}

function missing(field: string): { status: 'error'; error: string } {
  return { status: 'error', error: `missing required param: ${field}` };
}


export function createSubstrateProvenanceTool(getProvenance: () => ProvenanceServiceLike | null) {
  return {
    name: 'substrate_provenance' as const,
    description:
      'Provenance reads over Substrate: trace an issue to its commits, receipts and artifacts, ' +
      'look up receipts by commit SHA or PR ref, list bindings/receipts/artifacts, or bundle an issue. ' +
      'Collections are capped at 50 entries with totals; bundle returns the bundle PATH only, never contents. ' +
      'bind_commit is the only mutating op (finalizes a receipt against a commit SHA).',
    inputSchema: substrateProvenanceSchema,
    async execute(input: SubstrateProvenanceInput) {
      const svc = getProvenance();
      if (!svc) return { ...substrateUnavailablePayload('substrate_provenance', resolveSubstrate()) };
      try {
        switch (input.op) {
          case 'trace': {
            if (!input.issue_id) return missing('issue_id');
            const t = svc.trace(input.issue_id);
            const bindings = cap(t.bindings);
            const receipts = cap(t.receipts);
            const commits = cap(t.commits);
            const prs = cap(t.prs);
            const checkpoints = cap(t.checkpoints);
            const claims = cap(t.claims);
            const externalBindings = cap(t.externalBindings);
            const { bindings: _b, receipts: _r, checkpoints: _c, commits: _m, prs: _p, claims: _l, externalBindings: _e, ...rest } = t;
            return {
              status: 'ok',
              ...rest,
              bindings: bindings.items, bindingsTotal: bindings.total, bindingsTruncated: bindings.truncated,
              receipts: receipts.items, receiptsTotal: receipts.total, receiptsTruncated: receipts.truncated,
              commits: commits.items, commitsTotal: commits.total,
              prs: prs.items, prsTotal: prs.total,
              checkpoints: checkpoints.items, checkpointsTotal: checkpoints.total,
              claims: claims.items, claimsTotal: claims.total,
              externalBindings: externalBindings.items, externalBindingsTotal: externalBindings.total,
            };
          }
          case 'bindings': {
            if (!input.issue_id) return missing('issue_id');
            const { items, total, truncated } = cap(svc.listBindings(input.issue_id));
            return { status: 'ok', bindings: items, total, truncated };
          }
          case 'receipts': {
            if (!input.issue_id) return missing('issue_id');
            const { items, total, truncated } = cap(svc.listReceipts(input.issue_id));
            return { status: 'ok', receipts: items, total, truncated };
          }
          case 'find_by_commit': {
            if (!input.sha) return missing('sha');
            const { items, total, truncated } = cap(svc.findByCommit(input.sha));
            return { status: 'ok', matches: items, total, truncated };
          }
          case 'find_by_pr': {
            if (!input.pr) return missing('pr');
            const { items, total, truncated } = cap(svc.findByPr(input.pr));
            return { status: 'ok', matches: items, total, truncated };
          }
          case 'artifacts': {
            if (!input.receipt_id) return missing('receipt_id');
            const { items, total, truncated } = cap(svc.listArtifacts(input.receipt_id, { liveOnly: input.live_only ?? true }));
            return { status: 'ok', artifacts: items, total, truncated };
          }
          case 'bind_commit': {
            if (!input.receipt_id) return missing('receipt_id');
            if (!input.sha) return missing('sha');
            return { status: 'ok', receipt: svc.bindCommit(input.receipt_id, input.sha) };
          }
          case 'bundle': {
            if (!input.issue_id) return missing('issue_id');
            // PATH only — never inline bundle contents (unitAI-aiwva.8 lesson).
            return { status: 'ok', path: svc.generateBundle(input.issue_id).path };
          }
        }
      } catch (error) {
        return { status: 'error', error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
