import { describe, it, expect } from 'vitest';
import {
  createWorkItemBoundary,
  type ActiveClaimView,
  type DispatchRequest,
  type WorkItemPorts,
} from '../../../src/activation/workitem-store.js';

/**
 * Defense-in-depth claim ownership (xtrm-6qu.7.2): the consumer boundary must
 * never inherit a foreign or cross-activation claim, regardless of what the
 * producer gate pins. These tests pin that refusal against stub ports — no
 * Substrate package required.
 */

function stubPorts(active: ActiveClaimView | null): WorkItemPorts {
  return {
    issues: {
      resolveRef: (ref) => ({ id: `iss_${ref}`, humanRef: ref }),
      getActiveClaim: () => active,
      getParent: () => null,
      getRevision: () => ({ contract: {} }),
      resolveProject: () => ({ projectId: 'proj-test' }),
      createIssue: () => ({ id: 'iss_new' }),
      claimReady: () => ({ claim: { id: 7 } }),
    },
    provenance: {},
    store: {
      get: (ref) => ({
        issue: { humanRef: ref, id: `iss_${ref}`, currentRevision: 1, currentContractHash: 'h', title: 'T' },
        contract: {},
        readinessState: 'claimed',
        dispatchable: true,
        reasons: [],
      }),
      addJournal: () => {},
    },
    gate: {
      check: () => ({ issueId: 'iss', revision: 1, contractHash: 'h', report: {} }),
      dispatch: (_issues, _provenance, req: DispatchRequest) => ({
        binding: {
          id: 'exb_1', issueId: 'iss_X', issueRevision: 1, contractHash: 'h',
          claimId: req.claimId ?? null,
        },
      }),
    },
  };
}

const req = (overrides: Partial<DispatchRequest> = {}): DispatchRequest => ({
  ref: 'X', holder: 'holder-a', activationId: 'act-1', ...overrides,
});

describe('createWorkItemBoundary bind claim-ownership refusal', () => {
  it('delegates the caller claimId when no active claim exists', () => {
    const boundary = createWorkItemBoundary(stubPorts(null));
    const binding = boundary.bind(req({ claimId: 42 }));
    expect(binding.claimId).toBe(42);
  });

  it('binds the live claim for the same holder (coordinator-claims-first, activation pins at bind)', () => {
    const boundary = createWorkItemBoundary(stubPorts({ id: 9, holder: 'holder-a', activationId: null }));
    const binding = boundary.bind(req());
    expect(binding.claimId).toBe(9);
  });

  it('binds the live claim when holder and activation both match', () => {
    const boundary = createWorkItemBoundary(stubPorts({ id: 9, holder: 'holder-a', activationId: 'act-1' }));
    const binding = boundary.bind(req());
    expect(binding.claimId).toBe(9);
  });

  it('refuses a different holder inheriting the active claim (A-claim/B-dispatch)', () => {
    const boundary = createWorkItemBoundary(stubPorts({ id: 9, holder: 'holder-a', activationId: null }));
    expect(() => boundary.bind(req({ holder: 'holder-b', activationId: 'act-2' }))).toThrow(/claimed by 'holder-a'/);
  });

  it('refuses a mismatched activation against a bound claim', () => {
    const boundary = createWorkItemBoundary(stubPorts({ id: 9, holder: 'holder-a', activationId: 'act-1' }));
    expect(() => boundary.bind(req({ activationId: 'act-2' }))).toThrow(/another activation/);
  });

  it('refuses omitting activationId when the claim carries one', () => {
    const boundary = createWorkItemBoundary(stubPorts({ id: 9, holder: 'holder-a', activationId: 'act-1' }));
    expect(() => boundary.bind(req({ activationId: null }))).toThrow(/bound to another activation/);
  });
});

describe('createWorkItemBoundary inline validation', () => {
  const boundary = createWorkItemBoundary(stubPorts(null));
  const contract = (extra = 'SCRUTINY\nLOW — routine.') =>
    ['PROBLEM', 'P.', '', 'SUCCESS', 'S.', '', 'SCOPE', 'Sc.', '', 'NON_GOALS', 'N.',
      '', 'CONSTRAINTS', 'C.', '', 'VALIDATION', 'V.', '', 'OUTPUT', 'O.', '', extra].join('\n');

  it('creates through the ports and returns the human ref', () => {
    const out = boundary.inlineCreate(contract(), { holder: 'h', activationId: 'a' });
    expect(out.claimId).toBe(7);
    expect(out.issueId).toBe('iss_new');
  });

  it('refuses contracts with missing sections before anything is created', () => {
    expect(() => boundary.inlineCreate('PROBLEM\nOnly this.')).toThrow(/missing or empty/);
  });

  it('refuses contracts without a SCRUTINY level', () => {
    expect(() => boundary.inlineCreate(contract(''))).toThrow(/SCRUTINY/);
  });
});
