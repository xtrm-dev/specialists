import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSpecialist } from '../../../src/specialist/schema.js';
import { renderTaskTemplate } from '../../../src/specialist/script-runner.js';

async function loadChangelogKeeperSpec() {
  return parseSpecialist(readFileSync('config/specialists/changelog-keeper.specialist.json', 'utf8'));
}

describe('changelog-keeper specialist', () => {
  it('wires mandatory rule set and output schema', async () => {
    const result = await loadChangelogKeeperSpec();
    const specialist = result.specialist;

    expect(specialist.execution.permission_required).toBe('READ_ONLY');
    expect(specialist.execution.response_format).toBe('markdown');
    expect(specialist.execution.output_type).toBe('synthesis');
    expect(specialist.mandatory_rules?.template_sets).toContain('changelog-conventions');

    const outputSchema = specialist.prompt.output_schema as {
      type?: string;
      properties?: { sections?: { properties?: Record<string, unknown> } };
      required?: string[];
    };

    expect(outputSchema.type).toBe('object');
    expect(outputSchema.required).toEqual(['unreleased_summary', 'sections']);
    expect(Object.keys(outputSchema.properties?.sections?.properties ?? {})).toEqual([
      'added',
      'changed',
      'fixed',
      'removed',
      'deprecated',
      'security',
    ]);
  });

  it('defines pre-scripts for git log and bead query with injected output', async () => {
    const result = await loadChangelogKeeperSpec();
    const scripts = result.specialist.skills?.scripts ?? [];

    expect(scripts).toHaveLength(2);
    expect(scripts.every((script) => script.phase === 'pre' && script.inject_output === true)).toBe(true);
    expect(scripts[0]?.run).toContain('git log --pretty=format:%H||%s||%b -- $prev_tag..$next_tag');
    expect(scripts[1]?.run).toContain('bd query "closed_at >= $prev_tag_date"');
  });

  it('renders task template with injected pre-script evidence', async () => {
    const result = await loadChangelogKeeperSpec();
    const rendered = renderTaskTemplate(result.specialist.prompt.task_template, {
      prompt: 'Draft release notes',
      cwd: '/tmp/project',
      prev_tag: 'v3.8.0',
      next_tag: 'v3.9.0',
      pre_script_output: [
        'git log:',
        'abc123||feat: ship release drafter||',
        'bd query:',
        'unitAI-42 closed_at=2026-04-29',
      ].join('\n'),
    });

    expect(rendered).toContain('Draft changelog section for range `v3.8.0`..`v3.9.0`.');
    expect(rendered).toContain('git log:');
    expect(rendered).toContain('unitAI-42 closed_at=2026-04-29');
  });
});
