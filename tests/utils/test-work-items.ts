import { extractSections } from '../../src/activation/bead-gate.js';
import type { SpecialistWorkItemBoundary, WorkItemView } from '../../src/activation/workitem-store.js';

export function testWorkItems(options: {
  ref?: string;
  title?: string;
  description?: string;
  state?: string;
} = {}): SpecialistWorkItemBoundary {
  const ref = options.ref ?? 'ISSUE-1';
  const sections = extractSections(options.description ?? [
    'PROBLEM', 'The thing is unclear.', '',
    'SUCCESS', 'The thing is clear.', '',
    'SCOPE', 'Investigate the thing.', '',
    'NON_GOALS', 'Does not fix the thing.', '',
    'CONSTRAINTS', 'Read-only.', '',
    'VALIDATION', 'A written finding.', '',
    'OUTPUT', 'A finding.', '',
  ].join('\n'));
  const body = (name: string): string => sections.get(name) ?? '';
  const lines = (name: string): string[] => body(name).split('\n').map((line) => line.trim().replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '')).filter(Boolean);
  const missing = ['PROBLEM', 'SUCCESS', 'SCOPE', 'NON_GOALS', 'CONSTRAINTS', 'VALIDATION', 'OUTPUT'].filter((name) => !body(name));
  const state = options.state ?? (missing.length > 0 ? 'unready' : 'claimed');
  const contract = {
    problem: body('PROBLEM'), success: body('SUCCESS'), scope: lines('SCOPE'),
    nonGoals: lines('NON_GOALS'), constraints: lines('CONSTRAINTS'),
    validation: lines('VALIDATION').map((check) => ({ check })),
    output: lines('OUTPUT').map((artifact) => ({ artifact })),
  };
  const reasons = missing.length > 0 ? [`missing required sections: ${missing.join(', ')}`] : [`issue is ${state}`];
  return {
    view(issueRef: string): WorkItemView {
      return { ref: issueRef, issueId: `iss_${issueRef}`, revision: 1, contractHash: 'hash-test', title: options.title ?? 'A task', contract, readinessState: state, dispatchable: state === 'ready' || state === 'claimed', reasons };
    },
    epicAncestors: () => [],
    check(req) {
      if (state !== 'ready' && state !== 'claimed') throw new Error(`dispatch rejected: ${ref} is ${state}: ${reasons.join('; ')}`);
      return { issueId: `iss_${req.ref}`, revision: 1, contractHash: 'hash-test', report: { state, revision: 1, contractHash: 'hash-test', reasons } as never };
    },
    bind(req) {
      return {
        id: `exb_${req.activationId ?? 'test'}`, issueId: `iss_${req.ref}`, issueRevision: 1,
        contractHash: 'hash-test', resolvedContextHash: 'context-test', claimId: req.claimId ?? 1,
        participantId: req.holder, activationId: req.activationId ?? null, attemptId: req.attemptId ?? null,
        sessionId: req.sessionId ?? null, workspace: req.workspace, baseCommit: req.baseCommit ?? null, createdAt: 1,
      } as never;
    },
    inlineCreate: () => ({ ref, issueId: `iss_${ref}`, claimId: 1 }),
    journal: () => {},
  };
}
