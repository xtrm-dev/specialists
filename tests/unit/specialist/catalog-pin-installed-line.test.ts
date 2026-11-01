import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeCatalogCompatibility } from '../../../src/specialist/tool-catalog.js';

// Installed @jaggerxtrm/pi-extensions line (core packages/pi-extensions/package.json).
const INSTALLED_PI_EXTENSIONS = '0.15.3';

const readJson = (relative: string) => JSON.parse(readFileSync(resolve(process.cwd(), relative), 'utf8'));
const indexEntry = readJson('config/catalog/index.json').catalogs.find(
  (entry: { catalog: string }) => entry.catalog === 'python-kernel',
);
const standaloneEntry = readJson('config/catalog/python-kernel.json');

describe('python-kernel catalog pin vs the installed pi-extensions line', () => {
  for (const [label, entry] of [['index.json', indexEntry], ['python-kernel.json', standaloneEntry]] as const) {
    it(`${label} resolves healthy against installed ${INSTALLED_PI_EXTENSIONS}`, () => {
      const [report] = describeCatalogCompatibility({
        catalogs: [entry],
        resolveInstalledVersion: (name) => (name === '@jaggerxtrm/pi-extensions' ? INSTALLED_PI_EXTENSIONS : undefined),
      });
      expect(report?.level).not.toBe('out_of_range');
      expect(['ok', 'ahead']).toContain(report?.level);
    });
  }
});
