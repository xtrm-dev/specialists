import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWorkItemBoundary,
  openWorkItemBoundary,
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

  it('binds the live claim when neither side carries an activation', () => {
    const boundary = createWorkItemBoundary(stubPorts({ id: 9, holder: 'holder-a', activationId: null }));
    const binding = boundary.bind(req({ activationId: null }));
    expect(binding.claimId).toBe(9);
  });

  it('refuses a fabricated activation against an unbound claim', () => {
    const boundary = createWorkItemBoundary(stubPorts({ id: 9, holder: 'holder-a', activationId: null }));
    expect(() => boundary.bind(req())).toThrow(/does not match/);
  });

  it('refuses a supplied claimId that is not the live claim', () => {
    const boundary = createWorkItemBoundary(stubPorts({ id: 9, holder: 'holder-a', activationId: null }));
    expect(() => boundary.bind(req({ activationId: null, claimId: 42 }))).toThrow(/not the active claim/);
  });

  it('accepts a supplied claimId that matches the live claim', () => {
    const boundary = createWorkItemBoundary(stubPorts({ id: 9, holder: 'holder-a', activationId: null }));
    const binding = boundary.bind(req({ activationId: null, claimId: 9 }));
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
    expect(() => boundary.bind(req({ activationId: 'act-2' }))).toThrow(/does not match/);
  });

  it('refuses omitting activationId when the claim carries one', () => {
    const boundary = createWorkItemBoundary(stubPorts({ id: 9, holder: 'holder-a', activationId: 'act-1' }));
    expect(() => boundary.bind(req({ activationId: null }))).toThrow(/does not match/);
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

describe('openWorkItemBoundary package identity', () => {
  it('fails closed with no substrate directory configured', async () => {
    await expect(openWorkItemBoundary({ env: { ...process.env, XTRM_SUBSTRATE_DIR: '' } }))
      .rejects.toThrow(/work_item_store_unavailable/);
  });

  it('fails closed on a missing directory', async () => {
    await expect(openWorkItemBoundary({ substrateDir: join(tmpdir(), 'substrate-nope-missing') }))
      .rejects.toThrow(/work_item_store_unavailable/);
  });

  it('fails closed on a spoof directory with the wrong package name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'substrate-spoof-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'totally-legit-substrate' }));
    await expect(openWorkItemBoundary({ substrateDir: dir }))
      .rejects.toThrow(/expected @xtrm\/substrate/);
  });

  it('fails closed on a directory without readable package identity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'substrate-noid-'));
    await expect(openWorkItemBoundary({ substrateDir: dir }))
      .rejects.toThrow(/work_item_store_unavailable/);
  });
});
