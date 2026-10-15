// Resolver gating for the phase-1 permission guard (SPECIALISTS-4285):
// READ_ONLY gains sandboxed bash unless SPECIALISTS_PERMISSION_GUARD is 0/false
// (SPECIALISTS-4290 default-on) AND the guard artifact resolves; otherwise
// tool sets are identical to the pre-guard ones.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { buildResolvedToolContract } from '../../../src/specialist/resolved-tool-contract.js';
import {
  __resetPermissionGuardExtensionPathCacheForTest,
  PERMISSION_GUARD_ENV_KEY,
} from '../../../src/pi/permission-guard-extension.js';
import type { ToolCatalog } from '../../../src/specialist/manifest-resolver.js';

const CATALOGS: ToolCatalog[] = [
  { catalog: 'native', precedence: 0, source_tiers: { READ_ONLY: ['read', 'grep', 'find', 'ls', 'codemode'], LOW: ['read', 'grep', 'find', 'ls', 'bash', 'codemode'], MEDIUM: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'codemode'], HIGH: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write', 'codemode'] } },
  { catalog: 'gitnexus', precedence: 1, source_tiers: { READ_ONLY: [], LOW: [], MEDIUM: [], HIGH: [] } },
  { catalog: 'python-kernel', precedence: 2, source_tiers: { READ_ONLY: [], LOW: [], MEDIUM: [], HIGH: [] } },
  { catalog: 'service-knowledge', precedence: 3, source_tiers: { READ_ONLY: [], LOW: [], MEDIUM: [], HIGH: [] } },
];

let previous: string | undefined;

beforeEach(() => {
  previous = process.env[PERMISSION_GUARD_ENV_KEY];
  __resetPermissionGuardExtensionPathCacheForTest();
});

afterEach(() => {
  if (previous === undefined) delete process.env[PERMISSION_GUARD_ENV_KEY];
  else process.env[PERMISSION_GUARD_ENV_KEY] = previous;
  __resetPermissionGuardExtensionPathCacheForTest();
});

describe('permission-guard resolver gating', () => {
  it('opted out: READ_ONLY has no bash (byte-for-byte unchanged)', () => {
    process.env[PERMISSION_GUARD_ENV_KEY] = '0';
    const contract = buildResolvedToolContract({ tier: 'READ_ONLY', catalogs: CATALOGS });
    expect(contract.toolsList).not.toContain('bash');
    expect(contract.nativeTools).not.toContain('bash');
    expect(contract.toolsFlag.split(',')).not.toContain('bash');
  });

  it('guard on: READ_ONLY gains bash in toolsList, nativeTools and toolsFlag', () => {
    process.env[PERMISSION_GUARD_ENV_KEY] = '1';
    const contract = buildResolvedToolContract({
      tier: 'READ_ONLY',
      catalogs: CATALOGS,
      grantGuardedBash: true,
    });
    expect(contract.toolsList).toContain('bash');
    expect(contract.nativeTools).toContain('bash');
    expect(contract.toolsFlag.split(',')).toContain('bash');
  });

  it('grant flag is READ_ONLY-only: LOW ignores grantGuardedBash', () => {
    process.env[PERMISSION_GUARD_ENV_KEY] = '1';
    const withGrant = buildResolvedToolContract({ tier: 'LOW', catalogs: CATALOGS, grantGuardedBash: true });
    const without = buildResolvedToolContract({ tier: 'LOW', catalogs: CATALOGS });
    expect(withGrant.toolsList).toEqual(without.toolsList);
    expect(withGrant.toolsFlag).toBe(without.toolsFlag);
  });

  it('grant without catalog bash adds exactly one entry, no duplicates', () => {
    const contract = buildResolvedToolContract({
      tier: 'READ_ONLY',
      catalogs: CATALOGS,
      grantGuardedBash: true,
    });
    expect(contract.toolsList.filter((t) => t === 'bash')).toHaveLength(1);
    expect(contract.toolsFlag.split(',').filter((t) => t === 'bash')).toHaveLength(1);
  });

  it('MEDIUM/HIGH tool sets are untouched by the grant', () => {
    for (const tier of ['MEDIUM', 'HIGH'] as const) {
      const withGrant = buildResolvedToolContract({ tier, catalogs: CATALOGS, grantGuardedBash: true });
      const without = buildResolvedToolContract({ tier, catalogs: CATALOGS });
      expect(withGrant.toolsFlag).toBe(without.toolsFlag);
    }
  });
});

// SPECIALISTS-4290: the guard is default-on; only an explicit '0'/'false' opts out.
describe('isPermissionGuardEnabled default (SPECIALISTS-4290)', () => {
  it.each([
    [undefined, true],
    ['', true],
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false],
    [' FALSE ', false],
  ])('%j -> %s', async (value, expected) => {
    const { isPermissionGuardEnabled } = await import('../../../src/pi/permission-guard-extension.js');
    const env: NodeJS.ProcessEnv = value === undefined ? {} : { [PERMISSION_GUARD_ENV_KEY]: value };
    expect(isPermissionGuardEnabled(env)).toBe(expected);
  });

  it('grants READ_ONLY sandboxed bash with no env set', async () => {
    const { shouldGrantGuardedBash } = await import('../../../src/pi/permission-guard-extension.js');
    expect(shouldGrantGuardedBash('READ_ONLY', {})).toBe(true);
    expect(shouldGrantGuardedBash('READ_ONLY', { [PERMISSION_GUARD_ENV_KEY]: '0' })).toBe(false);
  });
});
