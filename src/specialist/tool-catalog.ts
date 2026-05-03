import * as z from 'zod';

const TierSchema = z.enum(['READ_ONLY', 'LOW', 'MEDIUM', 'HIGH']);
const LayerSchema = z.enum(['native', 'gitnexus', 'serena']);

const ToolTierMapSchema = z.record(TierSchema, z.array(z.string()));

export const ToolCatalogSchema = z.object({
  catalog: LayerSchema,
  package: z.string(),
  version: z.string(),
  precedence: z.number().int().nonnegative(),
  source_tiers: ToolTierMapSchema,
}).passthrough();

export const ToolCatalogIndexSchema = z.object({
  precedence_order: z.array(LayerSchema),
  catalogs: z.array(ToolCatalogSchema),
}).passthrough();

export type ToolCatalog = z.infer<typeof ToolCatalogSchema>;
export type ToolCatalogIndex = z.infer<typeof ToolCatalogIndexSchema>;

/**
 * §3.0 conflict resolution:
 * (1) most restrictive wins for tool inclusion
 * (2) exception: runtime health degradation restores native fallbacks
 * (3) hard-deny in specialist override does not override runtime health downgrade
 */
export const SPECIALIST_TOOL_PRECEDENCE = ['native', 'gitnexus', 'serena'] as const;

export function validateToolCatalogIndex(value: unknown): ToolCatalogIndex {
  return ToolCatalogIndexSchema.parse(value);
}

export function loadToolCatalogIndex(jsonText: string): ToolCatalogIndex {
  return validateToolCatalogIndex(JSON.parse(jsonText));
}
