/**
 * The global override layer must be able to set every execution field the allowlist advertises.
 * `claude_bridge` was in `OVERRIDE_ALLOWED_EXECUTION_FIELDS` but missing from
 * `OverrideExecutionSchema`, so `sp edit --global --set <name>.execution.claude_bridge true` failed
 * with "Unknown segment" and the route could only be enabled by editing a spec layer by hand.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSpecialistOverrideTemplate,
  GlobalSpecialistOverrideSchema,
  GlobalUserConfigSchema,
  OverrideExecutionSchema,
} from '../../../src/specialist/global-config.js';
import {
  OVERRIDE_ALLOWED_EXECUTION_FIELDS,
  OVERRIDE_ALLOWED_NESTED_EXECUTION_PATHS,
} from '../../../src/specialist/schema.js';
import { coerceGlobalValue, resolveGlobalPath } from '../../../src/cli/edit.js';

describe('claude_bridge in the global override layer (SPECIALISTS-4422 finding)', () => {
  it('accepts the field, so the operator layer can select the route', () => {
    const base = buildSpecialistOverrideTemplate();
    const parsed = GlobalSpecialistOverrideSchema.parse({ ...base, execution: { ...base.execution, claude_bridge: true } });
    expect(parsed.execution.claude_bridge).toBe(true);

    // `null` clears it back to inherit, like every other nullable field in the layer.
    const cleared = GlobalSpecialistOverrideSchema.parse({ ...base, execution: { ...base.execution, claude_bridge: null } });
    expect(cleared.execution.claude_bridge).toBeNull();
  });

  it('is a boolean at a path the CLI can resolve and coerce', () => {
    const resolved = resolveGlobalPath('explorer.execution.claude_bridge');
    expect(resolved.specialistName).toBe('explorer');
    expect(resolved.fieldSegments).toEqual(['execution', 'claude_bridge']);
    // zod v4 exposes no class to instanceof; ask the schema itself.
    expect(resolved.schema.safeParse(true).success).toBe(true);
    expect(resolved.schema.safeParse('true').success).toBe(false);
    expect(coerceGlobalValue(resolved.schema, 'true')).toBe(true);
    expect(coerceGlobalValue(resolved.schema, 'false')).toBe(false);
  });

  it('cannot drift from the allowlist: the two field sets are the same', () => {
    // Derived, not duplicated: if someone adds a field to one list and not the other, this fails.
    const schemaFields = Object.keys(OverrideExecutionSchema.shape).filter(
      key => !(OVERRIDE_ALLOWED_NESTED_EXECUTION_PATHS as readonly string[]).includes(key),
    );
    expect(new Set(schemaFields)).toEqual(new Set(OVERRIDE_ALLOWED_EXECUTION_FIELDS));
  });

  it('reaches the on-disk document the CLI writes', () => {
    const base = buildSpecialistOverrideTemplate();
    const parsed = GlobalUserConfigSchema.parse({ explorer: { ...base, execution: { ...base.execution, claude_bridge: true } } });
    expect((parsed as Record<string, { execution?: { claude_bridge?: boolean } }>).explorer?.execution?.claude_bridge).toBe(true);
  });
});
