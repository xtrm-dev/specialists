import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PI_SDK_PACKAGE, piSdkCandidates } from '../../../src/activation/pi-sdk.js';

const FIRST_ROOT = '/fake/bun/lib/node_modules';
const NVM_ROOT = '/fake/nvm/lib/node_modules';
const entryIn = (root: string) => join(root, PI_SDK_PACKAGE, 'dist', 'index.js');

// PI_NPM_GLOBAL_DIR outranks the nvm prefix, so FIRST_ROOT is the first existing root.
const deps = (installedAt: string[]) => ({
  env: { PI_NPM_GLOBAL_DIR: FIRST_ROOT, NPM_CONFIG_PREFIX: '/fake/nvm' },
  home: '/fake/home',
  execPath: '/fake/bun/bin/bun',
  readDir: () => [],
  exists: (path: string) => [FIRST_ROOT, NVM_ROOT, ...installedAt].includes(path),
});

describe('piSdkCandidates', () => {
  it('finds the SDK in a later root when the first existing root does not hold it (SPECIALISTS-4308)', () => {
    expect(piSdkCandidates(deps([entryIn(NVM_ROOT)]))).toEqual([
      PI_SDK_PACKAGE,
      pathToFileURL(entryIn(NVM_ROOT)).href,
    ]);
  });

  it('lists every root that holds the SDK in precedence order', () => {
    const candidates = piSdkCandidates(deps([entryIn(FIRST_ROOT), entryIn(NVM_ROOT)]));
    expect(candidates).toEqual([
      PI_SDK_PACKAGE,
      pathToFileURL(entryIn(FIRST_ROOT)).href,
      pathToFileURL(entryIn(NVM_ROOT)).href,
    ]);
  });
});
