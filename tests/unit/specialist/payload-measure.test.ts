import { describe, expect, it } from 'vitest';
import {
  measurePayloadComponent,
  summarizePayloadBreakdown,
} from '../../../src/specialist/payload-measure.js';

describe('payload-measure', () => {
  it('measures payload breakdown components and totals', () => {
    const components = [
      measurePayloadComponent('system_prompt', 'system_prompt', 'system prompt text'),
      measurePayloadComponent('task_template', 'task_template', 'task template text'),
      measurePayloadComponent('mandatory_rule', 'rule-a', 'rule a text'),
      measurePayloadComponent('mandatory_rule', 'rule-b', 'rule b text'),
      measurePayloadComponent('skill', 'skill-a', 'skill a text'),
      measurePayloadComponent('pre_script_output', 'pre_script_output', 'script output text'),
      measurePayloadComponent('bead_context', 'own', 'bead context text'),
    ];

    const breakdown = summarizePayloadBreakdown(components);

    expect(breakdown.components).toHaveLength(7);
    expect(breakdown.components.every((component) => component.tokens > 0 && component.bytes > 0)).toBe(true);
    expect(breakdown.totals.tokens).toBe(components.reduce((sum, component) => sum + component.tokens, 0));
    expect(breakdown.totals.bytes).toBe(components.reduce((sum, component) => sum + component.bytes, 0));
  });
});
