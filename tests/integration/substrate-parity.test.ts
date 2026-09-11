import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openSubstrateDb, openWorkItemBoundary } from '../../src/activation/workitem-store.js';

/**
 * Private-integration parity (xtrm-6qu.7.1.1): exercises the REAL producer
 * services through the public seam. Runs ONLY when XTRM_SUBSTRATE_DIR points
 * at a built @xtrm/substrate checkout — public CI has no such checkout, so
 * this suite skips there and the public gate stays green with zero private
 * code. The private workflow sets the variable, checks out the pinned public
 * Specialists SHA, and runs this file as the parity gate.
 *
 * Expected private command (bun 1.3.14):
 *   XTRM_SUBSTRATE_DIR=<abs path to @xtrm/substrate> \
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
    issues.createProject({ prefix: 'PRB', name: 'substrate parity scratch' });
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
      sessionId: 'sess-parity-1',
      workspace: dir,
    });
    expect(binding.issueRevision).toBe(view.revision);
    expect(binding.contractHash).toBe(view.contractHash);

    // A-claim/B-dispatch bypass: a foreign holder must refuse, not inherit.
    expect(() => boundary.bind({ ref: created.ref, holder: 'parity::intruder', activationId: 'act-evil' }))
      .toThrow(/claimed by/);

    boundary.journal(created.ref, 'note', { activationId: 'act-parity-1' });
  });
});
