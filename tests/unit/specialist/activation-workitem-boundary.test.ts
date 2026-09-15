import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  createWorkItemBoundary,
  openSubstrateDb,
  openWorkItemBoundary,
  resolveSubstrateFromGlobalPrefix,
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

function stubPorts(active: ActiveClaimView | null, released: Array<{ issueId: string; holder: string }> = []): WorkItemPorts {
  return {
    issues: {
      resolveRef: (ref) => ({ id: `iss_${ref}`, humanRef: ref }),
      getActiveClaim: () => active,
      releaseClaim: (issueId: string, holder: string) => { released.push({ issueId, holder }); return { id: 1 }; },
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

describe('releaseInlineClaim ownership guard (SPECIALISTS-53)', () => {
  it('releases a claim this activation took, as its recorded holder', () => {
    const released: Array<{ issueId: string; holder: string }> = [];
    const boundary = createWorkItemBoundary(stubPorts({ id: 9, holder: 'holder-a', activationId: 'act-1' }, released));
    expect(boundary.releaseInlineClaim?.('X', { activationId: 'act-1' })).toBe(true);
    // As the RECORDED holder, read from the claim, not from the caller.
    expect(released).toEqual([{ issueId: 'iss_X', holder: 'holder-a' }]);
  });

  it('refuses to release a claim another activation now holds', () => {
    // The reason this guard exists: releasing "as the recorded holder" would otherwise release
    // whatever is live. If anything re-claimed between creation and refusal - a TTL edge, a
    // coordinator racing on created_ref - that holder is someone else, and releasing as them
    // destroys a claim that is not ours.
    const released: Array<{ issueId: string; holder: string }> = [];
    const boundary = createWorkItemBoundary(stubPorts({ id: 9, holder: 'holder-b', activationId: 'act-OTHER' }, released));
    expect(boundary.releaseInlineClaim?.('X', { activationId: 'act-1' })).toBe(false);
    expect(released).toEqual([]);
  });

  it('reports false when there is no live claim', () => {
    const released: Array<{ issueId: string; holder: string }> = [];
    const boundary = createWorkItemBoundary(stubPorts(null, released));
    expect(boundary.releaseInlineClaim?.('X', { activationId: 'act-1' })).toBe(false);
    expect(released).toEqual([]);
  });
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

// unitAI-7co1i. "Nothing is installed" is now stated, not assumed. These cases used to pass
// only because the machine happened to lack @jaggerxtrm/substrate — true on CI, false the
// moment anyone installs it, which publishing the package made normal.
const NONE = () => null;

describe('openWorkItemBoundary package identity', () => {
  it('fails closed with no substrate directory configured', async () => {
    await expect(openWorkItemBoundary({ env: { ...process.env, XTRM_SUBSTRATE_DIR: '' }, resolveInstalled: NONE }))
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
      .rejects.toThrow(/expected @jaggerxtrm\/substrate/);
  });

  it('fails closed on a directory without readable package identity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'substrate-noid-'));
    await expect(openWorkItemBoundary({ substrateDir: dir }))
      .rejects.toThrow(/work_item_store_unavailable/);
  });

  // unitAI-ocnfk: XTRM_SUBSTRATE_DIR became an override rather than the only way in.
  // The identity check is what makes that safe to widen, so it is asserted on the
  // explicit path here and must never be skipped on the module-resolved one.
  it('names both remedies when nothing is configured and nothing is installed', async () => {
    await expect(openWorkItemBoundary({ env: { ...process.env, XTRM_SUBSTRATE_DIR: '' }, resolveInstalled: NONE }))
      .rejects.toThrow(/install @jaggerxtrm\/substrate.*XTRM_SUBSTRATE_DIR/s);
  });

  it('prefers an explicit checkout over module resolution', async () => {
    // A developer pointing at a working tree means it. If an installed copy could
    // shadow that, local Substrate changes would be untestable from here — which is
    // the confusion the variable exists to prevent. Proven by the error naming the
    // spoof directory: resolution stopped at the explicit path.
    const dir = mkdtempSync(join(tmpdir(), 'substrate-explicit-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'not-substrate' }));
    await expect(openWorkItemBoundary({ env: { ...process.env, XTRM_SUBSTRATE_DIR: dir } }))
      .rejects.toThrow(new RegExp(`found "not-substrate"`));
  });

  it('uses an installed Substrate when no override is set', async () => {
    // The positive case the absent-only tests could never assert: with nothing in the
    // environment, resolution falls through to the installed package. Proven by the
    // identity check rejecting THIS directory by name.
    const dir = mkdtempSync(join(tmpdir(), 'substrate-installed-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pretend-installed' }));
    await expect(openWorkItemBoundary({
      env: { ...process.env, XTRM_SUBSTRATE_DIR: '' },
      resolveInstalled: () => dir,
    })).rejects.toThrow(/found "pretend-installed"/);
  });

  it('treats a whitespace-only override as unset rather than as a path', async () => {
    await expect(openWorkItemBoundary({ env: { ...process.env, XTRM_SUBSTRATE_DIR: '   ' }, resolveInstalled: NONE }))
      .rejects.toThrow(/no Substrate package configured/);
  });

  it('still fails closed on the untouched resolver when nothing is installed', async () => {
    // The seam must not be the thing under test: with it absent, the REAL lookup runs. On a
    // machine where Substrate resolves the opener succeeds; where it does not, it refuses.
    // Either way the failure mode is fail-closed, never a silent second authority.
    const outcome = await openWorkItemBoundary({ env: { ...process.env, XTRM_SUBSTRATE_DIR: '' } })
      .then(() => 'opened' as const, (error: unknown) => String(error));
    expect(['opened', 'Error: work_item_store_unavailable: no Substrate package configured (install @jaggerxtrm/substrate, or set XTRM_SUBSTRATE_DIR to a checkout of it)'])
      .toContain(outcome);
  });
});

// SPECIALISTS-59. The lookup has three failure points and only two of them were normalized.
// `openSubstrateDb` required `node:sqlite` OUTSIDE a try, and under bun that built-in does not
// exist — so whenever the bun driver failed to open the file, the caller got
// `ResolveMessage: No such built-in module: node:sqlite` instead of
// `work_item_store_unavailable`. The string names neither the store nor a remedy.
//
// The trigger is a store whose parent directory does not exist, which is what a bare HOME
// produces (`$HOME/.xtrm/state.db`). Reachable on containers, service accounts, systemd units,
// sudo with a different HOME — and invisible in CI, whose runner has a real HOME.
function stubSubstratePackage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'substrate-stub-'));
  const write = (rel: string, body: string): void => {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@jaggerxtrm/substrate', version: '0.0.0' }));
  write('src/store/migrations/runner.ts', 'export function migrate(): void {}\n');
  write('src/service/issue-service.ts', [
    'export class IssueService {',
    '  constructor(_db: unknown) {}',
    '  listActiveEdges() { return []; }',
    '  getIssue(id: string) { return { id, humanRef: id, title: \'t\', currentRevision: 1, lifecycleState: \'open\' }; }',
    '}',
  ].join('\n'));
  write('src/service/journal-service.ts', 'export class JournalService { constructor(_db: unknown, _issues: unknown) {} }\n');
  write('src/service/provenance-service.ts', 'export class ProvenanceService { constructor(_db: unknown, _issues: unknown, _journal: unknown) {} }\n');
  write('src/workitems/substrate-store.ts', 'export class SubstrateIssueStore { constructor(_issues: unknown, _journal: unknown) {} }\n');
  write('src/workitems/dispatch-gate.ts', [
    'export function checkDispatch(): never { throw new Error(\'not used\'); }',
    'export function dispatchToSpecialist(): never { throw new Error(\'not used\'); }',
  ].join('\n'));
  return dir;
}

describe('store-open refusal normalization (SPECIALISTS-59)', () => {
  it('reports an unopenable store by path and driver, never as a raw module-resolution error', () => {
    // The unit-level regression: the previous head threw `ResolveMessage: No such built-in
    // module: node:sqlite` here, naming neither the file nor a remedy.
    const missingParent = join(tmpdir(), `substrate-absent-${Date.now()}`, 'state.db');
    let thrown: unknown;
    try {
      openSubstrateDb(missingParent);
    } catch (error) {
      thrown = error;
    }
    expect(thrown, 'openSubstrateDb must throw on an unopenable path').toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain(missingParent);
    expect(message).toContain('bun:sqlite');
    expect((thrown as Error).name).not.toBe('ResolveMessage');
    // The bun driver's message is kept, so the real cause survives the fallback.
    expect(message).toMatch(/unable to open|no such file|ENOENT/i);
  });

  it('normalizes the same failure into work_item_store_unavailable, with both remedies', async () => {
    // The end-to-end requirement: a store whose parent directory does not exist — what a bare
    // HOME produces — must produce the documented refusal, not a raw driver error. The path is
    // passed explicitly rather than by mutating process.env.HOME, because `resolveWorkItemDbPath`
    // derives the DEFAULT from `os.homedir()` (the real environment) and a test that rewrote HOME
    // for the whole worker would leak into every other suite in the process.
    const bareHome = mkdtempSync(join(tmpdir(), 'bare-home-'));
    const storePath = join(bareHome, '.xtrm', 'state.db');
    let thrown: unknown;
    try {
      await openWorkItemBoundary({ substrateDir: stubSubstratePackage(), dbPath: storePath });
    } catch (error) {
      thrown = error;
    }
    expect(thrown, 'a bare HOME has no store to open').toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(/^work_item_store_unavailable: /);
    expect((thrown as Error).name).not.toBe('ResolveMessage');
    // Both remedies, as the issue requires, and the store path, so the operator can act.
    expect(message).toContain(storePath);
    expect(message).toMatch(/SUBSTRATE_DB|XTRM_STATE_DB/);
    expect(message).toContain('install @jaggerxtrm/substrate');
  });

  it('still opens the store it can open', () => {
    // The normalization must not turn a working store into a refusal.
    const dir = mkdtempSync(join(tmpdir(), 'substrate-open-'));
    const db = openSubstrateDb(join(dir, 'state.db'));
    expect(db).toBeTruthy();
    (db as unknown as { close(): void }).close();
  });
});

// §3 install contract, measured. The XTRM-managed layout Core's `xt init` produces is a
// SYMLINKED global install, and default resolution dereferences the symlink and walks the
// checkout's ancestors — never the npm prefix. These tests pin the fallback against that exact
// layout, because the machine that found the bug could not reproduce it (its repo-local
// node_modules/@jaggerxtrm/substrate symlink made plain resolution succeed).
describe('Substrate global-prefix resolution (§3)', () => {
  function syntheticPrefix(): { lib: string; substrate: string } {
    const root = mkdtempSync(join(tmpdir(), 'sb-prefix-'));
    const lib = join(root, 'lib');
    const substrate = join(root, 'checkout', 'substrate');
    mkdirSync(join(lib, 'node_modules', '@jaggerxtrm'), { recursive: true });
    mkdirSync(substrate, { recursive: true });
    writeFileSync(join(substrate, 'package.json'), JSON.stringify({ name: '@jaggerxtrm/substrate', version: '0.1.2' }));
    // npm 7+ `install --global <folder>` symlinks; the resolver must see through this.
    symlinkSync(substrate, join(lib, 'node_modules', '@jaggerxtrm', 'substrate'), 'dir');
    return { lib, substrate };
  }

  it('finds Substrate behind a symlinked global install, where plain resolution cannot', async () => {
    const { lib, substrate } = syntheticPrefix();
    expect(resolveSubstrateFromGlobalPrefix([lib])).toBe(substrate);
  });

  it('returns null for a prefix that does not hold the package', () => {
    const empty = mkdtempSync(join(tmpdir(), 'sb-empty-'));
    expect(resolveSubstrateFromGlobalPrefix([join(empty, 'lib')])).toBeNull();
  });

  it('resolves nothing when the candidate has a package.json under a different name', () => {
    // The name check happens in openWorkItemBoundary, which must be reached so the refusal can
    // name the wrong package. Resolution finding the file is what makes that possible.
    const root = mkdtempSync(join(tmpdir(), 'sb-wrongname-'));
    const lib = join(root, 'lib');
    const impostor = join(root, 'impostor');
    mkdirSync(join(lib, 'node_modules', '@jaggerxtrm'), { recursive: true });
    mkdirSync(impostor, { recursive: true });
    writeFileSync(join(impostor, 'package.json'), JSON.stringify({ name: 'not-substrate' }));
    symlinkSync(impostor, join(lib, 'node_modules', '@jaggerxtrm', 'substrate'), 'dir');
    // Resolution returns it; `openWorkItemBoundary` then refuses it BY NAME, which is the
    // behaviour that must not be short-circuited here.
    expect(resolveSubstrateFromGlobalPrefix([lib])).toBe(impostor);
  });
});

// SPECIALISTS-54 reconciliation, against the PRODUCER's real entry shape. The previous version of
// this read matched a flat `entry.attemptId`, which `issue_journal` does not have (substrate
// src/domain/journal.ts:193-211) — so it evaluated `null === 'att:…'` and could never succeed, and
// a republish whose Journal append HAD landed appended a second result entry. Stubbing the read in
// the publication tests could not see that, which is why this test builds the real boundary.
describe('settlement reconciliation reads (SPECIALISTS-54)', () => {
  interface FakeJournalEntry {
    id: string;
    activationId: string | null;
    attemptId?: string | null;
    executionContext?: { specialist?: { attemptId?: string | null } | null } | null;
  }

  function boundaryWith(entries: FakeJournalEntry[], receipts: Array<{ id: string; executionBindingId: string }> = []) {
    return createWorkItemBoundary({
      issues: {
        resolveRef: (ref: string) => ({ id: `iss_${ref}`, humanRef: ref }),
        getActiveClaim: () => null,
        getParent: () => null,
        getRevision: () => ({ contract: {} }),
        resolveProject: () => ({ projectId: 'proj-test' }),
        createIssue: () => ({ id: 'iss_new' }),
        claimReady: () => ({ claim: { id: 7 } }),
      } as unknown as WorkItemPorts['issues'],
      provenance: {},
      store: {
        get: (ref: string) => ({
          issue: { humanRef: ref, id: `iss_${ref}`, currentRevision: 1, currentContractHash: 'h', title: 'T' },
          contract: {},
          readinessState: 'claimed',
          dispatchable: true,
          reasons: [],
        }),
        addJournal: () => {},
      } as unknown as WorkItemPorts['store'],
      gate: {
        check: () => ({ issueId: 'iss', revision: 1, contractHash: 'h', report: {} }),
        dispatch: () => ({ binding: { id: 'exb_1', issueId: 'iss', issueRevision: 1, contractHash: 'h', claimId: null } }),
      } as unknown as WorkItemPorts['gate'],
      journalService: {
        appendEntry: () => ({ id: 'jrn_new', sequence: 1 }),
        listEntries: (_issueId: string, opts?: { kind?: string }) => entries.filter(() => opts?.kind === undefined || true),
      } as never,
      provenanceService: {
        allocateReceipt: () => ({ id: 'rcp_new', executionBindingId: 'exb_1', issueId: 'iss', issueRevision: 1, contractHash: 'h' }),
        attachArtifact: () => ({ receiptId: 'rcp_new', kind: 'artifact', value: 'v' }),
        listReceipts: () => receipts,
      } as never,
    });
  }

  it('finds an existing result through the ENVELOPE attempt id, which is where the producer keeps it', () => {
    const boundary = boundaryWith([
      { id: 'jrn_1', activationId: 'act-1', executionContext: { specialist: { attemptId: 'att-1:1' } } },
    ]);
    expect(boundary.findResultEntry!('X', { activationId: 'act-1', attemptId: 'att-1:1' }))
      .toEqual({ status: 'found', value: { entryId: 'jrn_1' } });
  });

  it('distinguishes attempts of one activation', () => {
    const boundary = boundaryWith([
      { id: 'jrn_1', activationId: 'act-1', executionContext: { specialist: { attemptId: 'att-1:1' } } },
    ]);
    expect(boundary.findResultEntry!('X', { activationId: 'act-1', attemptId: 'att-1:2' }))
      .toEqual({ status: 'absent' });
  });

  it('answers UNAVAILABLE rather than absent when an entry cannot be attributed to an attempt', () => {
    // The exact producer shape that broke the old matcher: a result entry with no attempt column.
    // "Absent" here would license a second append for an activation that already has a result.
    const boundary = boundaryWith([{ id: 'jrn_1', activationId: 'act-1' }]);
    const lookup = boundary.findResultEntry!('X', { activationId: 'act-1', attemptId: 'att-1:1' });
    expect(lookup.status).toBe('unavailable');
  });

  it('answers absent only when nothing exists for the activation at all', () => {
    const boundary = boundaryWith([{ id: 'jrn_1', activationId: 'other-activation' }]);
    expect(boundary.findResultEntry!('X', { activationId: 'act-1', attemptId: 'att-1:1' }))
      .toEqual({ status: 'absent' });
  });

  it('answers unavailable when the journal service cannot list at all', () => {
    const boundary = createWorkItemBoundary({
      issues: {
        resolveRef: (ref: string) => ({ id: `iss_${ref}`, humanRef: ref }),
        getActiveClaim: () => null,
        getParent: () => null,
        getRevision: () => ({ contract: {} }),
        resolveProject: () => ({ projectId: 'proj-test' }),
        createIssue: () => ({ id: 'iss_new' }),
        claimReady: () => ({ claim: { id: 7 } }),
      } as unknown as WorkItemPorts['issues'],
      provenance: {},
      store: {
        get: (ref: string) => ({
          issue: { humanRef: ref, id: `iss_${ref}`, currentRevision: 1, currentContractHash: 'h', title: 'T' },
          contract: {}, readinessState: 'claimed', dispatchable: true, reasons: [],
        }),
        addJournal: () => {},
      } as unknown as WorkItemPorts['store'],
      gate: {
        check: () => ({ issueId: 'iss', revision: 1, contractHash: 'h', report: {} }),
        dispatch: () => ({ binding: { id: 'exb_1', issueId: 'iss', issueRevision: 1, contractHash: 'h', claimId: null } }),
      } as unknown as WorkItemPorts['gate'],
      // An older Substrate build: allocation exists, listing does not.
      journalService: { appendEntry: () => ({ id: 'jrn_new', sequence: 1 }) } as never,
      provenanceService: {
        allocateReceipt: () => ({ id: 'rcp_new', executionBindingId: 'exb_1', issueId: 'iss', issueRevision: 1, contractHash: 'h' }),
        attachArtifact: () => ({ receiptId: 'rcp_new', kind: 'artifact', value: 'v' }),
      } as never,
    });
    expect(boundary.findResultEntry!('X', { activationId: 'act-1', attemptId: 'att-1:1' }).status).toBe('unavailable');
    expect(boundary.findReceiptForBinding!('X', 'exb_1').status).toBe('unavailable');
  });

  it('finds a receipt already allocated over the binding', () => {
    const boundary = boundaryWith([], [{ id: 'rcp_1', executionBindingId: 'exb_1' }]);
    expect(boundary.findReceiptForBinding!('X', 'exb_1')).toEqual({ status: 'found', value: { receiptId: 'rcp_1' } });
    expect(boundary.findReceiptForBinding!('X', 'exb_other')).toEqual({ status: 'absent' });
  });
});
