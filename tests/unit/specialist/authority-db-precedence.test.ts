import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAuthorityDbPath } from '../../../src/activation/authority-store.js';

/**
 * Store-path precedence (unitAI-0whq0).
 *
 * The store belongs to Substrate, which resolves it as explicit override, else
 * SUBSTRATE_DB, else ~/.xtrm/state.db, and shares it with sb and Pi. Specialists read only
 * its own XTRM_STATE_DB, so redirecting the store the documented way moved sb and Pi and
 * left specialists writing to the default path — silently, because nothing compares them.
 */
const DEFAULT = join(homedir(), '.xtrm', 'state.db');

describe('resolveAuthorityDbPath precedence', () => {
  it('prefers SUBSTRATE_DB, the owner-defined variable', () => {
    expect(resolveAuthorityDbPath({ SUBSTRATE_DB: '/a/sub.db' } as NodeJS.ProcessEnv)).toBe('/a/sub.db');
  });

  it('still honours XTRM_STATE_DB alone, so existing setups are unchanged', () => {
    expect(resolveAuthorityDbPath({ XTRM_STATE_DB: '/a/legacy.db' } as NodeJS.ProcessEnv)).toBe('/a/legacy.db');
  });

  it('lets the owner win when both are set', () => {
    // The whole point: an operator redirecting the shared store must not be silently
    // overridden by specialists' own older name for it.
    const env = { SUBSTRATE_DB: '/a/sub.db', XTRM_STATE_DB: '/a/legacy.db' } as NodeJS.ProcessEnv;
    expect(resolveAuthorityDbPath(env)).toBe('/a/sub.db');
  });

  it('treats blank as unset rather than as a path', () => {
    expect(resolveAuthorityDbPath({ SUBSTRATE_DB: '   ', XTRM_STATE_DB: '' } as NodeJS.ProcessEnv)).toBe(DEFAULT);
    expect(resolveAuthorityDbPath({ SUBSTRATE_DB: '  ', XTRM_STATE_DB: '/a/legacy.db' } as NodeJS.ProcessEnv)).toBe('/a/legacy.db');
  });

  it('falls back to the canonical store', () => {
    expect(resolveAuthorityDbPath({} as NodeJS.ProcessEnv)).toBe(DEFAULT);
  });
});

describe('hook scripts resolve identically to the runtime', () => {
  // Each hook re-implements resolution because it runs standalone under bun with no import
  // of the runtime. Drift between them would split the authority silently, which is the
  // same class of bug as the one above.
  const scripts = ['session-start', 'precompact', 'postcompact', 'wake-watch'];
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../../plugins/specialists/scripts');

  it.each(scripts)('%s prefers SUBSTRATE_DB over XTRM_STATE_DB', (name) => {
    const src = execFileSync('cat', [join(dir, `${name}.mjs`)], { encoding: 'utf-8' });
    const sub = src.indexOf('SUBSTRATE_DB');
    const legacy = src.indexOf('XTRM_STATE_DB ??');
    expect(sub, `${name}.mjs must read SUBSTRATE_DB`).toBeGreaterThan(-1);
    expect(legacy, `${name}.mjs must still read XTRM_STATE_DB`).toBeGreaterThan(-1);
    expect(sub, `${name}.mjs must check SUBSTRATE_DB first`).toBeLessThan(legacy);
  });
});
