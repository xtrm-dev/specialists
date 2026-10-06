import type { ZodTypeAny } from 'zod';
/**
 * Convert a zod tool schema to the JSON Schema advertised over MCP
 * `tools/list`.
 *
 * Plain `zodToJsonSchema()` targets draft-07 and emits a root `$schema`
 * plus per-property `default` values (e.g. `action` defaults to `'list'`).
 * Strict OpenAI-compatible gateways validate
 * `tools[].function.parameters` and reject those metadata keywords with a
 * 400, which fails every model call for any client behind such a gateway
 * (SPECIALISTS-4228: the `specialist_lease_reconcile` enums surfaced as
 * `"list" is not of types "boolean", "object"` and friends).
 *
 * The zod schemas stay the parse authority — `schema.parse()` still
 * applies defaults at execution time — so stripping the keywords from the
 * advertisement changes no runtime behavior. The conversion target is
 * deliberately left at the default: every type/enum/validation keyword
 * stays byte-identical to what clients already accept.
 */
export declare function toMcpInputSchema(schema: ZodTypeAny): Record<string, unknown>;
//# sourceMappingURL=tool-schema.d.ts.map