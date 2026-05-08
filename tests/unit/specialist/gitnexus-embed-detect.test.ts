import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { gitnexusHasEmbeddings } from '../../../src/specialist/supervisor.js';

describe('gitnexusHasEmbeddings', () => {
  let tmpDir = '';
  afterEach(() => { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); tmpDir = ''; });

  it('returns false when .gitnexus/meta.json is absent', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gnxe-'));
    expect(gitnexusHasEmbeddings(tmpDir)).toBe(false);
  });

  it('returns false when meta.json has no stats.embeddings', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gnxe-'));
    mkdirSync(join(tmpDir, '.gitnexus'));
    writeFileSync(join(tmpDir, '.gitnexus', 'meta.json'), JSON.stringify({ stats: { symbols: 100 } }));
    expect(gitnexusHasEmbeddings(tmpDir)).toBe(false);
  });

  it('returns false when stats.embeddings is 0', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gnxe-'));
    mkdirSync(join(tmpDir, '.gitnexus'));
    writeFileSync(join(tmpDir, '.gitnexus', 'meta.json'), JSON.stringify({ stats: { embeddings: 0 } }));
    expect(gitnexusHasEmbeddings(tmpDir)).toBe(false);
  });

  it('returns true when stats.embeddings is a positive number', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gnxe-'));
    mkdirSync(join(tmpDir, '.gitnexus'));
    writeFileSync(join(tmpDir, '.gitnexus', 'meta.json'), JSON.stringify({ stats: { embeddings: 1234 } }));
    expect(gitnexusHasEmbeddings(tmpDir)).toBe(true);
  });

  it('returns false on malformed meta.json', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gnxe-'));
    mkdirSync(join(tmpDir, '.gitnexus'));
    writeFileSync(join(tmpDir, '.gitnexus', 'meta.json'), '{not json');
    expect(gitnexusHasEmbeddings(tmpDir)).toBe(false);
  });
});
