import { describe, expect, it } from 'vitest';
import { describeCatalogCompatibility } from '../../../src/specialist/tool-catalog.js';

/**
 * The doctor's catalog report (SPECIALISTS-42 (d)).
 *
 * Pure and injected: the caller supplies installed versions, so this describes a machine's state
 * without being tied to one, and can be tested with no extension installed at all. That is the
 * deliberate alternative to a test that resolves against the host's install, which is the
 * SPECIALISTS-24 defect class.
 */
const CATALOGS = [
  { catalog: 'native', version: '3.11.0' },
  { catalog: 'gitnexus', package: 'pi-gitnexus', version: '0.6.4' },
  { catalog: 'python-kernel', package: '@jaggerxtrm/pi-extensions', version: '0.12.0' },
];

const report = (installed: Record<string, string>) =>
  describeCatalogCompatibility({
    catalogs: CATALOGS,
    resolveInstalledVersion: (name) => installed[name],
  });

describe('catalog compatibility report', () => {
  it('skips the native catalog, which has no installed extension to verify', () => {
    expect(report({}).map((entry) => entry.catalog)).toEqual(['gitnexus', 'python-kernel']);
  });

  it('reports an exact match as ok', () => {
    const [gitnexus] = report({ 'pi-gitnexus': '0.6.4' });
    expect(gitnexus).toMatchObject({ level: 'ok', installed: '0.6.4', baseline: '0.6.4' });
  });

  it('reports an install ahead of the baseline as ahead, not as a fault', () => {
    // The case the runtime gate accepts and therefore never mentions. It is the only signal that
    // the baseline is no longer the build the tool surface was verified against, and it is what
    // lets the pin be bumped BEFORE a minor release closes the gate.
    const [gitnexus] = report({ 'pi-gitnexus': '0.6.9' });
    expect(gitnexus).toMatchObject({ level: 'ahead', installed: '0.6.9', baseline: '0.6.4' });
    expect(gitnexus?.detail).toContain('ahead of baseline');
    expect(gitnexus?.detail).toContain('before the next minor release');
  });

  it('reports a version outside the line as out_of_range, with the comparator reason', () => {
    const [gitnexus] = report({ 'pi-gitnexus': '0.7.0' });
    expect(gitnexus).toMatchObject({ level: 'out_of_range', installed: '0.7.0', baseline: '0.6.4' });
    expect(gitnexus?.detail).toContain('outside the compatible range');
  });

  it('reports a downgrade below the baseline as out_of_range', () => {
    expect(report({ 'pi-gitnexus': '0.6.3' })[0]).toMatchObject({ level: 'out_of_range' });
  });

  it('reports an absent package as absent rather than as a failure', () => {
    const [gitnexus, pythonKernel] = report({ 'pi-gitnexus': '0.6.4' });
    expect(gitnexus).toMatchObject({ level: 'ok' });
    expect(pythonKernel).toMatchObject({ level: 'absent', package: '@jaggerxtrm/pi-extensions' });
    expect(pythonKernel?.detail).toContain('not installed');
  });

  it('falls back to the catalog name when a package is not declared', () => {
    const entries = describeCatalogCompatibility({
      catalogs: [{ catalog: 'gitnexus', version: '0.6.4' }],
      resolveInstalledVersion: (name) => (name === 'gitnexus' ? '0.6.4' : undefined),
    });
    expect(entries[0]).toMatchObject({ package: 'gitnexus', level: 'ok' });
  });
});
