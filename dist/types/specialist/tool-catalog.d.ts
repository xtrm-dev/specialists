import * as z from 'zod';
export declare const ToolCatalogSchema: z.ZodObject<{
    catalog: z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>;
    package: z.ZodString;
    version: z.ZodString;
    precedence: z.ZodNumber;
    source_tiers: z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodArray<z.ZodString, "many">>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    catalog: z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>;
    package: z.ZodString;
    version: z.ZodString;
    precedence: z.ZodNumber;
    source_tiers: z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    catalog: z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>;
    package: z.ZodString;
    version: z.ZodString;
    precedence: z.ZodNumber;
    source_tiers: z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">>;
export declare const ToolCatalogIndexSchema: z.ZodObject<{
    precedence_order: z.ZodArray<z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>, "many">;
    default_overrides: z.ZodOptional<z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodObject<{
        denied_natives_when_extension: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        denied_natives_mode: z.ZodOptional<z.ZodEnum<["soft", "hard"]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        denied_natives_when_extension: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        denied_natives_mode: z.ZodOptional<z.ZodEnum<["soft", "hard"]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        denied_natives_when_extension: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        denied_natives_mode: z.ZodOptional<z.ZodEnum<["soft", "hard"]>>;
    }, z.ZodTypeAny, "passthrough">>>>;
    catalogs: z.ZodArray<z.ZodObject<{
        catalog: z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>;
        package: z.ZodString;
        version: z.ZodString;
        precedence: z.ZodNumber;
        source_tiers: z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodArray<z.ZodString, "many">>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        catalog: z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>;
        package: z.ZodString;
        version: z.ZodString;
        precedence: z.ZodNumber;
        source_tiers: z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        catalog: z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>;
        package: z.ZodString;
        version: z.ZodString;
        precedence: z.ZodNumber;
        source_tiers: z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    precedence_order: z.ZodArray<z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>, "many">;
    default_overrides: z.ZodOptional<z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodObject<{
        denied_natives_when_extension: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        denied_natives_mode: z.ZodOptional<z.ZodEnum<["soft", "hard"]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        denied_natives_when_extension: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        denied_natives_mode: z.ZodOptional<z.ZodEnum<["soft", "hard"]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        denied_natives_when_extension: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        denied_natives_mode: z.ZodOptional<z.ZodEnum<["soft", "hard"]>>;
    }, z.ZodTypeAny, "passthrough">>>>;
    catalogs: z.ZodArray<z.ZodObject<{
        catalog: z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>;
        package: z.ZodString;
        version: z.ZodString;
        precedence: z.ZodNumber;
        source_tiers: z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodArray<z.ZodString, "many">>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        catalog: z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>;
        package: z.ZodString;
        version: z.ZodString;
        precedence: z.ZodNumber;
        source_tiers: z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        catalog: z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>;
        package: z.ZodString;
        version: z.ZodString;
        precedence: z.ZodNumber;
        source_tiers: z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    precedence_order: z.ZodArray<z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>, "many">;
    default_overrides: z.ZodOptional<z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodObject<{
        denied_natives_when_extension: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        denied_natives_mode: z.ZodOptional<z.ZodEnum<["soft", "hard"]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        denied_natives_when_extension: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        denied_natives_mode: z.ZodOptional<z.ZodEnum<["soft", "hard"]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        denied_natives_when_extension: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        denied_natives_mode: z.ZodOptional<z.ZodEnum<["soft", "hard"]>>;
    }, z.ZodTypeAny, "passthrough">>>>;
    catalogs: z.ZodArray<z.ZodObject<{
        catalog: z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>;
        package: z.ZodString;
        version: z.ZodString;
        precedence: z.ZodNumber;
        source_tiers: z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodArray<z.ZodString, "many">>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        catalog: z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>;
        package: z.ZodString;
        version: z.ZodString;
        precedence: z.ZodNumber;
        source_tiers: z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        catalog: z.ZodEnum<["native", "gitnexus", "python-kernel", "service-knowledge"]>;
        package: z.ZodString;
        version: z.ZodString;
        precedence: z.ZodNumber;
        source_tiers: z.ZodRecord<z.ZodEnum<["READ_ONLY", "LOW", "MEDIUM", "HIGH"]>, z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, z.ZodTypeAny, "passthrough">>;
export type ToolCatalog = z.infer<typeof ToolCatalogSchema>;
export type ToolCatalogIndex = z.infer<typeof ToolCatalogIndexSchema>;
/**
 * §3.0 conflict resolution:
 * (1) most restrictive wins for tool inclusion
 * (2) exception: runtime health degradation or catalog incompatibility restores native fallbacks
 * (3) hard-deny in specialist override does not override runtime health downgrade
 */
export declare const SPECIALIST_TOOL_PRECEDENCE: readonly ["native", "gitnexus", "python-kernel", "service-knowledge"];
export declare function validateToolCatalogIndex(value: unknown): ToolCatalogIndex;
export declare function loadToolCatalogIndex(jsonText: string): ToolCatalogIndex;
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
export declare function resolveCatalogVersionVerdict(installedVersion: string, baselineVersion: string): CatalogVersionVerdict;
//# sourceMappingURL=tool-catalog.d.ts.map