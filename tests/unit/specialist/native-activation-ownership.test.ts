// XTRM-93 N3 (SPECIALISTS-104): the ownership authority for `sp ps --mine` on
// the native block. Real temp authority store, real read-only reader — no
// mocks, so resolver and schema cannot drift apart silently.
//
// The point of these pins is NOT that ownership resolves in this environment
// (it does not: no session identity exists here). It is that the two facts are
// distinguishable — "you own these activations", "you own none of them", and
// "ownership is unknown" are three DIFFERENT results, and only the first two
// may ever become a candidate set. Collapsing the third into the empty set is
// the defect being fixed.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveNativeActivationOwnership,
  resolveSessionHolder,
} from '../../../src/specialist/native-activation-ownership.js';

describe('native activation ownership (SPECIALISTS-104)', () => {
  let tempRoot = '';
  let dbPath = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'specialists-ownership-'));
    dbPath = join(tempRoot, 'state.db');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /**
   * The claim shape the resolver reads. Deliberately a SUBSET of the real
   * Substrate `issue_claims` table (id/issue_id/holder/activation_id/...), so a
   * schema change that renames or drops `activation_id` fails here.
   */
  const seedClaims = (rows: Array<{ holder: string; activationId: string | null }>) => {
    const db = new Database(dbPath);
    db.run(`
      CREATE TABLE issue_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_id TEXT NOT NULL,
        holder TEXT NOT NULL,
        activation_id TEXT NULL,
        released_at INTEGER NULL,
        generation INTEGER NOT NULL
      )
    `);
    let generation = 0;
    for (const row of rows) {
      generation += 1;
      db.query('INSERT INTO issue_claims (issue_id, holder, activation_id, released_at, generation) VALUES (?, ?, ?, ?, ?)')
        .run(`iss_${generation}`, row.holder, row.activationId, null, generation);
    }
    db.close();
  };

  it('reports ownership as UNAVAILABLE when the session carries no identity', () => {
    seedClaims([{ holder: 'pi::a1k5', activationId: 'act:owned-1' }]);
    const result = resolveNativeActivationOwnership({ env: {}, dbPath });
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.reason).toBe('no_session_identity');
      expect(result.detail).toContain('XTRM_SESSION_NAME');
    }
  });

  it('reports ownership as UNAVAILABLE when the authority store is absent', () => {
    const result = resolveNativeActivationOwnership({
      env: { XTRM_SESSION_NAME: 'session-a' },
      dbPath: join(tempRoot, 'does-not-exist.db'),
    });
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toBe('authority_store_absent');
  });

  it('resolves the activations whose recorded claim holder is this session', () => {
    seedClaims([
      { holder: 'session-a', activationId: 'act:mine-1' },
      { holder: 'session-a', activationId: 'act:mine-2' },
      { holder: 'session-a', activationId: 'act:mine-1' }, // duplicate claim, same activation
      { holder: 'pi::other', activationId: 'act:foreign-1' },
      { holder: 'session-a', activationId: null },          // claim with no activation
    ]);
    const result = resolveNativeActivationOwnership({ env: { XTRM_SESSION_NAME: 'session-a' }, dbPath });
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.holder).toBe('session-a');
      expect([...result.activationIds].sort()).toEqual(['act:mine-1', 'act:mine-2']);
    }
  });

  it('resolves to an EMPTY set — not unavailable — when the holder owns nothing', () => {
    // The distinction that the old Beads path collapsed. A resolved empty
    // pre-image legitimately selects nothing; "unknown" must never become one.
    seedClaims([{ holder: 'pi::other', activationId: 'act:foreign-1' }]);
    const result = resolveNativeActivationOwnership({ env: { XTRM_SESSION_NAME: 'session-a' }, dbPath });
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') expect(result.activationIds).toEqual([]);
  });

  it('matches the holder by EXACT string equality, never by prefix or suffix', () => {
    seedClaims([
      { holder: 'pi::a1k5', activationId: 'act:prefixed' },
      { holder: 'a1k5', activationId: 'act:bare' },
      { holder: 'session-a-suffix', activationId: 'act:suffixed' },
      { holder: 'session-a', activationId: 'act:exact' },
    ]);
    for (const [identity, expected] of [
      ['pi::a1k5', ['act:prefixed']],
      ['a1k5', ['act:bare']],
      ['session-a', ['act:exact']],
    ] as const) {
      const result = resolveNativeActivationOwnership({ env: { XTRM_SESSION_NAME: identity }, dbPath });
      expect(result.kind).toBe('resolved');
      if (result.kind === 'resolved') expect(result.activationIds).toEqual(expected);
    }
  });

  it('never mutates the authority store', () => {
    seedClaims([{ holder: 'session-a', activationId: 'act:mine-1' }]);
    const read = new Database(dbPath, { readonly: true });
    const before = read.query('SELECT * FROM issue_claims ORDER BY id').all();
    read.close();

    resolveNativeActivationOwnership({ env: { XTRM_SESSION_NAME: 'session-a' }, dbPath });
    resolveNativeActivationOwnership({ env: { XTRM_SESSION_NAME: 'nobody' }, dbPath });

    const after = new Database(dbPath, { readonly: true });
    expect(after.query('SELECT * FROM issue_claims ORDER BY id').all()).toEqual(before);
    after.close();
  });

  describe('resolveSessionHolder', () => {
    it('prefers XTRM_SESSION_NAME, falls back to XTRM_SESSION_ID, and ignores blanks', () => {
      expect(resolveSessionHolder({ XTRM_SESSION_NAME: 'n', XTRM_SESSION_ID: 'i' })).toBe('n');
      expect(resolveSessionHolder({ XTRM_SESSION_ID: 'i' })).toBe('i');
      expect(resolveSessionHolder({ XTRM_SESSION_NAME: '   ', XTRM_SESSION_ID: 'i' })).toBe('i');
      expect(resolveSessionHolder({ XTRM_SESSION_NAME: '', XTRM_SESSION_ID: '' })).toBeUndefined();
      expect(resolveSessionHolder({})).toBeUndefined();
    });
  });
});
