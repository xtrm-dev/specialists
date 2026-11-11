import * as z from 'zod';
interface ResolvedGlobalPath {
    specialistName: string;
    fieldSegments: string[];
    schema: z.ZodTypeAny;
}
/**
 * Resolve a global dot-path of the form <specialist>.<field.path> against the
 * override schema. The first segment is the specialist name (dynamic key);
 * remaining segments navigate GlobalSpecialistOverrideSchema.
 */
export declare function resolveGlobalPath(rawPath: string): ResolvedGlobalPath;
/**
 * Coerce a raw string value to the leaf type of a global override field.
 * The literal string "null" clears a field back to inherit.
 */
export declare function coerceGlobalValue(schema: z.ZodTypeAny, rawValue: string): unknown;
export declare function run(): Promise<void>;
export {};
//# sourceMappingURL=edit.d.ts.map