import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import { toMcpInputSchema } from '../../../src/mcp/tool-schema.js';
import { specialistLeaseReconcileSchema } from '../../../src/tools/specialist/specialist_lease_reconcile.tool.js';

/** Collect every key present anywhere in a JSON value. */
function allKeys(node: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) allKeys(item, acc);
    return acc;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      acc.add(key);
      allKeys(value, acc);
    }
  }
  return acc;
}

describe('toMcpInputSchema (SPECIALISTS-4228)', () => {
  it('strips $schema and default from the lease-reconcile advertisement', () => {
    const schema = toMcpInputSchema(specialistLeaseReconcileSchema);
    const keys = allKeys(schema);
    expect(keys.has('$schema')).toBe(false);
    expect(keys.has('default')).toBe(false);
  });

  it('keeps the lease-reconcile enums and object shape intact', () => {
    const schema = toMcpInputSchema(specialistLeaseReconcileSchema) as {
      type: string;
      properties: Record<string, { enum?: string[] }>;
      additionalProperties: boolean;
    };
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.action.enum).toEqual(['list', 'reconcile']);
    expect(schema.properties.outcome.enum).toEqual([
      'safe_free',
      'superseded',
      'manual_attention_required',
    ]);
  });

  it('strips nested defaults on synthetic schemas without touching validation keywords', () => {
    const synthetic = z.object({
      mode: z.enum(['a', 'b']).default('a'),
      name: z.string().min(1).describe('required name'),
    });
    const schema = toMcpInputSchema(synthetic) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(allKeys(schema).has('default')).toBe(false);
    expect(schema.properties.mode.enum).toEqual(['a', 'b']);
    expect(schema.properties.name.minLength).toBe(1);
  });

  it('leaves the zod parse authority untouched: action still defaults to list', () => {
    expect(specialistLeaseReconcileSchema.parse({}).action).toBe('list');
  });
});
