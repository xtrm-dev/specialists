import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { resolveCanonicalAssetDir } from './canonical-asset-resolver.js';

export type DriftScope = 'default' | 'user';
export type DriftStatus =
  | 'redundant-safe-to-prune'
  | 'diverged-consider-migrating-to-user'
  | 'useless-override-safe-to-remove'
  | 'diverged-consider-removing-or-refactoring';

export interface DriftAssetKind {
  kind: 'specialists' | 'mandatory-rules' | 'catalog' | 'nodes';
  managedDir: string;
  canonicalDir: string | null;
  packageLabel: string;
}

export interface DriftFinding {
  repo_root: string;
  kind: DriftAssetKind['kind'];
  scope: DriftScope;
  path: string;
  canonical_path: string | null;
  status: DriftStatus;
  bytes_equal: boolean | null;
  suggested_action: string;
  suggestion_command: string;
}

export interface DriftReport {
  root: string;
  repos: Array<{ root: string; findings: DriftFinding[] }>;
  summary: {
    repos: number;
    findings: number;
    redundant_defaults: number;
    diverged_defaults: number;
    useless_overrides: number;
    diverged_overrides: number;
  };
}

const ASSETS: readonly Omit<DriftAssetKind, 'canonicalDir'>[] = [
  { kind: 'specialists', managedDir: '.specialists/default', packageLabel: 'package config/specialists' },
  { kind: 'mandatory-rules', managedDir: '.specialists/default/mandatory-rules', packageLabel: 'package config/mandatory-rules' },
  { kind: 'catalog', managedDir: '.specialists/catalog', packageLabel: 'package config/catalog' },
  { kind: 'nodes', managedDir: '.specialists/default/nodes', packageLabel: 'package config/nodes' },
];

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (entry.isFile()) out.push(full);
    }
  };
  visit(root);
  return out;
}

function relPath(path: string, base: string): string {
  return relative(base, path) || '.';
}

function makeFinding(repoRoot: string, kind: DriftAssetKind['kind'], scope: DriftScope, path: string, canonicalPath: string | null, bytesEqual: boolean | null): DriftFinding {
  const rel = relPath(path, repoRoot);
  if (scope === 'default') {
    return bytesEqual
      ? { repo_root: repoRoot, kind, scope, path, canonical_path: canonicalPath, status: 'redundant-safe-to-prune', bytes_equal: true, suggested_action: `safe prune`, suggestion_command: `sp prune-stale-defaults --root ${repoRoot}` }
      : { repo_root: repoRoot, kind, scope, path, canonical_path: canonicalPath, status: 'diverged-consider-migrating-to-user', bytes_equal: false, suggested_action: `consider migrate to .specialists/user/`, suggestion_command: `cp ${rel} .specialists/user/` };
  }
  return bytesEqual
    ? { repo_root: repoRoot, kind, scope, path, canonical_path: canonicalPath, status: 'useless-override-safe-to-remove', bytes_equal: true, suggested_action: `safe remove`, suggestion_command: `rm ${rel}` }
    : { repo_root: repoRoot, kind, scope, path, canonical_path: canonicalPath, status: 'diverged-consider-removing-or-refactoring', bytes_equal: false, suggested_action: `keep if intentional override`, suggestion_command: `rm ${rel}` };
}

export function resolveDriftAssets(): DriftAssetKind[] {
  return ASSETS.map((asset) => ({ ...asset, canonicalDir: resolveCanonicalAssetDir(asset.kind) }));
}

export function detectDriftForRepo(repoRoot: string): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const asset of resolveDriftAssets()) {
    if (!asset.canonicalDir) continue;
    const scopes: Array<{ scope: DriftScope; dir: string }> = [
      { scope: 'default', dir: resolve(repoRoot, asset.managedDir) },
      { scope: 'user', dir: resolve(repoRoot, '.specialists/user') },
    ];
    for (const { scope, dir } of scopes) {
      if (!existsSync(dir)) continue;
      for (const file of listFiles(dir)) {
        const rel = relPath(file, dir);
        const canonicalPath = join(asset.canonicalDir, rel);
        if (!existsSync(canonicalPath)) continue;
        const bytesEqual = readFileSync(file).equals(readFileSync(canonicalPath));
        findings.push(makeFinding(repoRoot, asset.kind, scope, file, canonicalPath, bytesEqual));
      }
    }
  }
  return findings;
}

export function detectDriftUnderRoot(root: string): DriftReport {
  const repos: Array<{ root: string; findings: DriftFinding[] }> = [];
  const seen = new Set<string>();
  const visit = (dir: string): void => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const findings = detectDriftForRepo(dir);
    if (findings.length > 0) {
      repos.push({ root: dir, findings });
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      visit(join(dir, entry.name));
    }
  };
  visit(resolve(root));
  const summary = repos.flatMap(r => r.findings);
  return {
    root: resolve(root),
    repos,
    summary: {
      repos: repos.length,
      findings: summary.length,
      redundant_defaults: summary.filter(f => f.status === 'redundant-safe-to-prune').length,
      diverged_defaults: summary.filter(f => f.status === 'diverged-consider-migrating-to-user').length,
      useless_overrides: summary.filter(f => f.status === 'useless-override-safe-to-remove').length,
      diverged_overrides: summary.filter(f => f.status === 'diverged-consider-removing-or-refactoring').length,
    },
  };
}

export function pruneStaleDefaults(repoRoot: string, dryRun: boolean): string[] {
  const targets = detectDriftForRepo(repoRoot)
    .filter(f => f.scope === 'default' && f.bytes_equal === true)
    .map(f => f.path);
  if (!dryRun) {
    for (const target of targets) rmSync(target, { recursive: true, force: true });
  }
  return targets;
}
