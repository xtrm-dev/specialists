import * as z from 'zod';

const TierSchema = z.enum(['READ_ONLY', 'LOW', 'MEDIUM', 'HIGH']);
const LayerSchema = z.enum(['native', 'gitnexus', 'python-kernel', 'service-knowledge']);

const ToolTierMapSchema = z.record(TierSchema, z.array(z.string()));

export const ToolCatalogSchema = z.object({
  catalog: LayerSchema,
  package: z.string(),
  version: z.string(),
  precedence: z.number().int().nonnegative(),
  source_tiers: ToolTierMapSchema,
}).passthrough();

const ManifestPolicyTierSchema = z.object({
  denied_natives_when_extension: z.array(z.string()).optional(),
  denied_natives_mode: z.enum(['soft', 'hard']).optional(),
}).passthrough();

export const ToolCatalogIndexSchema = z.object({
  precedence_order: z.array(LayerSchema),
  default_overrides: z.record(TierSchema, ManifestPolicyTierSchema).optional(),
  catalogs: z.array(ToolCatalogSchema),
}).passthrough();

export type ToolCatalog = z.infer<typeof ToolCatalogSchema>;
export type ToolCatalogIndex = z.infer<typeof ToolCatalogIndexSchema>;

/**
 * §3.0 conflict resolution:
 * (1) most restrictive wins for tool inclusion
 * (2) exception: runtime health degradation or catalog incompatibility restores native fallbacks
 * (3) hard-deny in specialist override does not override runtime health downgrade
 */
export const SPECIALIST_TOOL_PRECEDENCE = ['native', 'gitnexus', 'python-kernel', 'service-knowledge'] as const;

export function validateToolCatalogIndex(value: unknown): ToolCatalogIndex {
  return ToolCatalogIndexSchema.parse(value);
}

export function loadToolCatalogIndex(jsonText: string): ToolCatalogIndex {
  return validateToolCatalogIndex(JSON.parse(jsonText));
}

/**
 * Catalog compatibility (SPECIALISTS-42).
 *
 * A catalog's `version` is the build its tool surface was verified against — a baseline, not a
 * demand that the installed extension be byte-identical to it. The gate used to compare with
 * `!==`, which meant every patch release of an independently-versioned extension silently erased
 * that catalog's entire tool surface (the gitnexus pin sat at 0.6.1 from May while 0.6.2, 0.6.3
 * and 0.6.4 shipped). An installed version satisfies the pin when it is the baseline or a later
 * build within the same compatibility line — caret-of-baseline:
 *
 *   baseline 1.2.0  ->  same major, installed >= baseline
 *   baseline 0.6.4  ->  same minor, installed >= baseline
 *   baseline 0.0.3  ->  exact match only
 *
 * Prerelease and unparseable versions are NOT compatible and say why. A build we cannot place is
 * one we cannot claim was verified, so the rule fails closed rather than guessing — and it names
 * the reason, because a bare `loaded_unhealthy` is what made the original failure invisible.
 *
 * Deliberate consequence: semver build metadata (`0.6.4+abc123`) does not match the strict pattern
 * either, so it fails closed even though semver says metadata carries no precedence. The reason
 * string names the version, so that shows up as a diagnosable line rather than a silent mismatch.
 */
export interface CatalogVersionVerdict {
  /** True when the installed version is inside the pin's compatibility line. */
  compatible: boolean;
  /** Human-readable verdict, suitable for a warning or a diagnostic line. */
  reason: string;
}

/** Strict `major.minor.patch`. A prerelease or a range is deliberately NOT comparable. */
const CATALOG_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function compareVersionTriples(a: readonly number[], b: readonly number[]): number {
  return (a[0]! - b[0]!) || (a[1]! - b[1]!) || (a[2]! - b[2]!);
}

export function resolveCatalogVersionVerdict(installedVersion: string, baselineVersion: string): CatalogVersionVerdict {
  const installed = CATALOG_VERSION_PATTERN.exec(installedVersion);
  const baseline = CATALOG_VERSION_PATTERN.exec(baselineVersion);
  if (!installed || !baseline) {
    return {
      compatible: false,
      reason: `version not comparable: installed ${installedVersion} vs catalog ${baselineVersion}`,
    };
  }

  const installedTriple = installed.slice(1).map(Number);
  const baselineTriple = baseline.slice(1).map(Number);
  const [installedMajor, installedMinor] = installedTriple;
  const [baselineMajor, baselineMinor] = baselineTriple;

  // Which line the baseline lives on decides what "same line" means. 0.x is the
  // interesting case: npm caret semantics treat 0.6.4 as patch-only, so 0.6.x is the
  // line and 0.7.0 is a break.
  const sameLine = baselineMajor! > 0
    ? installedMajor === baselineMajor
    : baselineMinor! > 0
      ? installedMajor === 0 && installedMinor === baselineMinor
      : installedMajor === 0 && installedMinor === 0 && installedTriple[2] === baselineTriple[2];

  const atLeastBaseline = compareVersionTriples(installedTriple, baselineTriple) >= 0;

  return sameLine && atLeastBaseline
    ? { compatible: true, reason: `installed ${installedVersion} satisfies catalog ${baselineVersion} (caret-of-baseline)` }
    : { compatible: false, reason: `installed ${installedVersion} is outside the compatible range for catalog ${baselineVersion}` };
}
