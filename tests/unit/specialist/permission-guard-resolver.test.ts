// Resolver gating for the phase-1 permission guard (SPECIALISTS-4285):
// READ_ONLY gains sandboxed bash only when SPECIALISTS_PERMISSION_GUARD=1
// AND the guard artifact resolves; every other combination leaves tool sets
// byte-for-byte identical.

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
  it('flag off: READ_ONLY has no bash (byte-for-byte unchanged)', () => {
    delete process.env[PERMISSION_GUARD_ENV_KEY];
    const contract = buildResolvedToolContract({ tier: 'READ_ONLY', catalogs: CATALOGS });
    expect(contract.toolsList).not.toContain('bash');
    expect(contract.nativeTools).not.toContain('bash');
    expect(contract.toolsFlag.split(',')).not.toContain('bash');
  });

  it('flag on: READ_ONLY gains bash in toolsList, nativeTools and toolsFlag', () => {
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
