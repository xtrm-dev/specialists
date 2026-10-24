import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openSubstrateDb, openWorkItemBoundary } from '../../src/activation/workitem-store.js';

/**
 * Private-integration parity (xtrm-6qu.7.1.1): exercises the REAL producer
 * services through the public seam. Runs ONLY when XTRM_SUBSTRATE_DIR points
 * at a built @jaggerxtrm/substrate checkout — public CI has no such checkout, so
 * this suite skips there and the public gate stays green with zero private
 * code. The private workflow sets the variable, checks out the pinned public
 * Specialists SHA, and runs this file as the parity gate.
 *
 * Expected private command (bun 1.3.14):
 *   XTRM_SUBSTRATE_DIR=<abs path to @jaggerxtrm/substrate> \
 *     bun --bun vitest run tests/integration/substrate-parity.test.ts
 */

const SUBSTRATE_DIR = (process.env.XTRM_SUBSTRATE_DIR ?? '').trim();
const LIVE = SUBSTRATE_DIR.length > 0;

const CONTRACT = [
  'PROBLEM', 'Parity probe needs a dispatchable issue.', '',
  'SUCCESS', 'View, check and bind agree on revision and contract hash.', '',
  'SCOPE', 'Exercise the public seam against real services.', '',
  'NON_GOALS', 'No worker dispatch, no prompt rendering.', '',
  'CONSTRAINTS', 'Isolated temp database, no board mutation outside it.', '',
  'VALIDATION', 'Revision and hash stable across view, check and bind.', '',
  'OUTPUT', 'A passing parity gate.', '',
  'SCRUTINY', 'LOW — integration probe.',
].join('\n');

/**
 * Test-only world setup: a fresh temp DB has zero projects, and the producer
 * correctly refuses to guess (resolveProject fails closed). The test — never
 * the public boundary — therefore creates exactly one deterministic scratch
 * project first, using the REAL producer migration + IssueService dynamically
 * loaded from the reviewed checkout. No static or committed private
 * dependency; production inline dispatch on a project-less store keeps
 * refusing, which is the honest behaviour (run sb project create/link).
 */
async function ensureScratchProject(dbPath: string): Promise<void> {
  const load = (rel: string): Promise<Record<string, any>> =>
    import(pathToFileURL(join(SUBSTRATE_DIR, rel)).href) as Promise<Record<string, any>>;
  const runner = await load('src/store/migrations/runner.ts');
  const issueSvcMod = await load('src/service/issue-service.ts');
  const db = openSubstrateDb(dbPath);
  try {
    runner.migrate(db);
    const issues = new issueSvcMod.IssueService(db);
    const project = issues.createProject({ prefix: 'PRB', name: 'substrate parity scratch' });
    // Current Substrate resolves the project from a repository binding or checkout link and
    // refuses to guess; link the checkout the boundary runs in to the scratch project.
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
    issues.linkCheckout(gitRoot, project.id);
  } finally {
    (db as unknown as { close(): void }).close();
  }
}

describe.skipIf(!LIVE)('substrate parity (private integration)', () => {
  it('migration → inline issue → view/check/bind stable + holder refusal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'substrate-parity-'));
    const dbPath = join(dir, 'state.db');
    await ensureScratchProject(dbPath);
    const boundary = await openWorkItemBoundary({ dbPath, substrateDir: SUBSTRATE_DIR });

    const created = boundary.inlineCreate(CONTRACT, { holder: 'parity::holder', activationId: 'act-parity-1' });
    expect(created.claimId).not.toBeNull();

    const view = boundary.view(created.ref);
    expect(view.revision).toBe(1);

    const check = boundary.check({ ref: created.ref, specialist: 'researcher', holder: 'parity::holder', activationId: 'act-parity-1' });
    expect(check.revision).toBe(view.revision);
    expect(check.contractHash).toBe(view.contractHash);

    const binding = boundary.bind({
      ref: created.ref,
      specialist: 'researcher',
      holder: 'parity::holder',
      activationId: 'act-parity-1',
      sessionId: randomUUID(),
      workspace: dir,
    });
    expect(binding.issueRevision).toBe(view.revision);
    expect(binding.contractHash).toBe(view.contractHash);

    // A-claim/B-dispatch bypass: a foreign holder must refuse, not inherit.
    expect(() => boundary.bind({ ref: created.ref, holder: 'parity::intruder', activationId: 'act-evil' }))
      .toThrow(/claimed by/);

    boundary.journal(created.ref, 'note', { activationId: 'act-parity-1' });
  });

  it('contextRefs: own + inherited reach resolvedContext with provenance, and the bound hash matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'substrate-parity-ctx-'));
    const dbPath = join(dir, 'state.db');
    await ensureScratchProject(dbPath);
    const boundary = await openWorkItemBoundary({ dbPath, substrateDir: SUBSTRATE_DIR });

    const parent = boundary.inlineCreate(CONTRACT, { holder: 'parity::parent', activationId: 'act-parent' });
    const child = boundary.inlineCreate(CONTRACT, { holder: 'parity::holder', activationId: 'act-ctx', parentId: parent.issueId });

    // The `sb issue edit --context-refs` path: a new revision carrying the refs, then re-attest + claim.
    const issueSvcMod = (await import(pathToFileURL(join(SUBSTRATE_DIR, 'src/service/issue-service.ts')).href)) as Record<string, any>;
    const db = openSubstrateDb(dbPath);
    const svc = new issueSvcMod.IssueService(db);
    const contractOf = (id: string) => svc.getRevision(id, svc.getIssue(id).currentRevision).contract;
    svc.updateContract(parent.issueId, contractOf(parent.issueId), 'parity', {
      contextRefs: [{ key: 'venv', value: '/abs/.venv/bin/python', kind: 'evidence' }],
    });
    svc.updateContract(child.issueId, contractOf(child.issueId), 'parity', {
      contextRefs: [{ key: 'explorer-allowlist', value: 'src/a.ts\nsrc/b.ts', kind: 'evidence' }],
    });
    expect(() => svc.updateContract(child.issueId, contractOf(child.issueId), 'parity', {
      contextRefs: [{ key: 'raw', value: 'journal text', kind: 'journal' }],
    })).toThrow(/journal/);
    svc.releaseClaim(child.issueId, 'parity::holder', { activationId: 'act-ctx' });
    svc.claimReady(child.issueId, 'parity::holder', { outcome: 'ready', policy: 'default', attestedBy: 'parity::holder' }, { activationId: 'act-ctx' });
    (db as unknown as { close(): void }).close();

    const context = boundary.resolvedContext!(child.ref);
    expect(context).not.toBeNull();
    expect(context!.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'explorer-allowlist', sourceRef: child.ref, inherited: false }),
      expect.objectContaining({ key: 'venv', sourceRef: parent.ref, inherited: true }),
    ]));

    const binding = boundary.bind({
      ref: child.ref, specialist: 'researcher', holder: 'parity::holder', activationId: 'act-ctx',
      sessionId: randomUUID(), workspace: dir,
    });
    expect(binding.resolvedContextHash).toBe(context!.hash);
  });
});
