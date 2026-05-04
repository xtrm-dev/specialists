import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectDriftForRepo, detectDriftUnderRoot, pruneStaleDefaults } from '../../../src/specialist/drift-detector.js';

const repoRoot = join(import.meta.dirname, '../../..');

function seedRepo(root: string): void {
  mkdirSync(join(root, '.specialists', 'default'), { recursive: true });
  mkdirSync(join(root, '.specialists', 'default', 'mandatory-rules'), { recursive: true });
  mkdirSync(join(root, '.specialists', 'default', 'nodes'), { recursive: true });
  mkdirSync(join(root, '.specialists', 'user'), { recursive: true });
  mkdirSync(join(root, '.specialists', 'catalog'), { recursive: true });
  mkdirSync(join(root, 'config', 'specialists'), { recursive: true });
  mkdirSync(join(root, 'config', 'mandatory-rules'), { recursive: true });
  mkdirSync(join(root, 'config', 'nodes'), { recursive: true });
}

function copyCanonical(pathFrom: string, pathTo: string): void {
  copyFileSync(join(repoRoot, pathFrom), pathTo);
}

describe('doctor drift detection', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('classifies redundant, diverged, and useless overrides by byte compare', () => {
    const root = join(tmpdir(), `doctor-drift-${crypto.randomUUID()}`);
    roots.push(root);
    seedRepo(root);

    copyCanonical('config/specialists/executor.specialist.json', join(root, 'config', 'specialists', 'executor.specialist.json'));
    copyCanonical('config/mandatory-rules/index.json', join(root, 'config', 'mandatory-rules', 'index.json'));
    copyCanonical('config/nodes/research.node.json', join(root, 'config', 'nodes', 'research.node.json'));

    copyCanonical('config/specialists/executor.specialist.json', join(root, '.specialists', 'default', 'executor.specialist.json'));
    copyCanonical('config/mandatory-rules/index.json', join(root, '.specialists', 'default', 'mandatory-rules', 'index.json'));
    copyCanonical('config/nodes/research.node.json', join(root, '.specialists', 'default', 'nodes', 'research.node.json'));
    copyCanonical('config/specialists/explorer.specialist.json', join(root, '.specialists', 'user', 'explorer.specialist.json'));
    copyCanonical('config/specialists/executor.specialist.json', join(root, '.specialists', 'user', 'executor.specialist.json'));

    writeFileSync(join(root, '.specialists', 'default', 'executor.specialist.json'), '{"drift":true}\n', 'utf8');

    const findings = detectDriftForRepo(root);
    expect(findings.some(f => f.status === 'redundant-safe-to-prune')).toBe(true);
    expect(findings.some(f => f.status === 'diverged-consider-migrating-to-user')).toBe(true);
    expect(findings.some(f => f.status === 'useless-override-safe-to-remove')).toBe(true);
  });

  it('aggregates multi-repo drift under root', () => {
    const root = join(tmpdir(), `doctor-drift-root-${crypto.randomUUID()}`);
    roots.push(root);
    for (const name of ['repo-a', 'repo-b', 'repo-c']) {
      const repo = join(root, name);
      mkdirSync(repo, { recursive: true });
      seedRepo(repo);
      copyCanonical('config/specialists/executor.specialist.json', join(repo, 'config', 'specialists', 'executor.specialist.json'));
      copyCanonical('config/specialists/executor.specialist.json', join(repo, '.specialists', 'default', 'executor.specialist.json'));
    }
    const report = detectDriftUnderRoot(root);
    expect(report.summary.repos).toBe(3);
    expect(report.summary.redundant_defaults).toBe(3);
  });

  it('pruneStaleDefaults dry-run lists targets without writing', () => {
    const root = join(tmpdir(), `doctor-prune-${crypto.randomUUID()}`);
    roots.push(root);
    seedRepo(root);
    const src = join(repoRoot, 'config', 'specialists', 'executor.specialist.json');
    const dst = join(root, '.specialists', 'default', 'executor.specialist.json');
    copyFileSync(src, dst);
    const before = readFileSync(dst, 'utf8');
    const targets = pruneStaleDefaults(root, true);
    expect(targets).toContain(dst);
    expect(readFileSync(dst, 'utf8')).toBe(before);
  });
});
