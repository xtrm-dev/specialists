import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { loadToolCatalogIndex } from './tool-catalog.js';
import { resolveManifestTools, type ExtensionState, type ResolverInput, type ResolverResult, type ToolCatalogName } from './manifest-resolver.js';

const require = createRequire(import.meta.url);

export interface ExtensionProbe {
  name: ToolCatalogName;
  package: string;
  version: string;
  health: ExtensionState['health'];
  drift: 'none' | 'degraded' | 'catalog_mismatch';
  reason: string;
}

type CatalogRecord = {
  catalog: ToolCatalogName;
  package: string;
  version: string;
  precedence: number;
  source_tiers: Record<string, readonly string[]>;
};

export interface ResolvedConfigReport {
  specialist: string;
  manifest: unknown;
  catalogs: readonly CatalogRecord[];
  extensionAvailability: readonly ExtensionProbe[];
  resolver: ResolverResult;
  catalogCompatibility: readonly string[];
}

function readJsonFile(path: string): unknown {
  return JSON.parse(require('node:fs').readFileSync(path, 'utf-8')) as unknown;
}

function resolvePackageVersion(packageName: string): string | undefined {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const pkg = readJsonFile(packageJsonPath) as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

export function classifyExtensionProbe(catalog: CatalogRecord, input: { installedVersion?: string; entrypointExists?: boolean }): ExtensionProbe {
  if (!input.installedVersion) {
    return {
      name: catalog.catalog,
      package: catalog.package,
      version: catalog.version,
      health: 'not_installed',
      drift: 'none',
      reason: 'package missing',
    };
  }

  if (input.installedVersion !== catalog.version) {
    return {
      name: catalog.catalog,
      package: catalog.package,
      version: catalog.version,
      health: 'loaded_unhealthy',
      drift: 'catalog_mismatch',
      reason: `version mismatch: installed ${input.installedVersion} != catalog ${catalog.version}`,
    };
  }

  if (!input.entrypointExists) {
    return {
      name: catalog.catalog,
      package: catalog.package,
      version: catalog.version,
      health: 'loaded_unhealthy',
      drift: 'degraded',
      reason: 'entrypoint missing',
    };
  }

  return {
    name: catalog.catalog,
    package: catalog.package,
    version: catalog.version,
    health: 'loaded_healthy',
    drift: 'none',
    reason: 'loaded',
  };
}

function probeHealth(catalog: CatalogRecord): ExtensionProbe {
  const installedVersion = resolvePackageVersion(catalog.package);
  const entrypointExists = installedVersion ? existsSync(require.resolve(catalog.package)) : false;
  return classifyExtensionProbe(catalog, { installedVersion, entrypointExists });
}

export async function loadResolvedConfigReport(args: {
  specialistName: string;
  projectDir: string;
  catalogsPath: string;
}): Promise<ResolvedConfigReport> {
  const manifest = readJsonFile(join(args.projectDir, 'config', 'specialists', `${args.specialistName}.specialist.json`));
  const index = loadToolCatalogIndex(await readFile(args.catalogsPath, 'utf-8'));
  const catalogs = index.catalogs as readonly CatalogRecord[];
  const probes = catalogs.map(probeHealth);
  const extensionState: Partial<Record<ToolCatalogName, ExtensionState>> = Object.fromEntries(
    probes.map(probe => [probe.name, { health: probe.health }]),
  ) as Partial<Record<ToolCatalogName, ExtensionState>>;
  const resolverInput: ResolverInput = {
    tier: 'HIGH',
    catalogs,
    extensionState,
  };
  const resolver = resolveManifestTools(resolverInput);
  const catalogCompatibility = probes
    .filter(probe => probe.drift !== 'none')
    .map(probe => `${probe.name}: ${probe.reason}`);

  return {
    specialist: args.specialistName,
    manifest,
    catalogs,
    extensionAvailability: probes,
    resolver,
    catalogCompatibility,
  };
}

export function formatResolvedConfigReport(report: ResolvedConfigReport): string {
  const lines: string[] = [];
  lines.push(`specialist: ${report.specialist}`);
  lines.push('effective manifest:');
  lines.push(JSON.stringify(report.manifest, null, 2));
  lines.push('layer attribution:');
  for (const item of report.resolver.attribution) {
    lines.push(`  - ${item.layer}${item.source ? ` (${item.source})` : ''}: ${item.tools.join(',') || '(none)'}`);
  }
  lines.push('extension availability:');
  for (const item of report.extensionAvailability) {
    lines.push(`  - ${item.name}: ${item.health} [${item.drift}] ${item.reason}`);
  }
  lines.push('catalog compatibility:');
  if (report.catalogCompatibility.length === 0) {
    lines.push('  - ok');
  } else {
    for (const item of report.catalogCompatibility) lines.push(`  - ${item}`);
  }
  lines.push(`denied natives: ${report.resolver.deniedNatives.join(',') || '(none)'}`);
  lines.push(`--tools: ${report.resolver.tools}`);
  if (report.resolver.warnings.length > 0) {
    lines.push('warnings:');
    for (const warning of report.resolver.warnings) lines.push(`  - ${warning}`);
  }
  return lines.join('\n');
}
