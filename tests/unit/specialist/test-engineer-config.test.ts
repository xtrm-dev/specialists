import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSpecialist } from '../../../src/specialist/schema.js';

const SPEC_PATH = 'config/specialists/test-engineer.specialist.json';

async function loadSpec() {
  return parseSpecialist(readFileSync(SPEC_PATH, 'utf8'));
}

describe('test-engineer specialist config', () => {
  it('validates schema and exposes required behavioral-validation handoff keys', async () => {
    const spec = await loadSpec();
    const schema = spec.specialist.prompt.output_schema ?? {};

    expect(spec.specialist.metadata.name).toBe('test-engineer');
    expect(spec.specialist.execution.permission_required).toBe('HIGH');
    expect(spec.specialist.execution.requires_worktree).toBe(true);
    expect(schema).toEqual(expect.objectContaining({
      status: 'tests_written|blocked|source_bug_suspected',
      files_changed: expect.any(Array),
      coverage_map: expect.any(Array),
      smoke_e2e_commands: expect.any(Array),
      telemetry_assertions: expect.any(Array),
      test_runner_commands: expect.any(Array),
      known_deferred_paths: expect.any(Array),
      source_bug_suspicions: expect.any(Array),
    }));
  });

  it('keeps prompt ambidextrous and test-asset scoped', async () => {
    const spec = await loadSpec();
    const system = spec.specialist.prompt.system ?? '';
    const task = spec.specialist.prompt.task_template;
    const combined = `${system}\n${task}`;

    expect(system).toContain('mode-agnostic');
    expect(system).not.toContain('you are the primary writer');
    expect(system).not.toContain('you are the secondary writer after the executor');
    expect(combined).toContain('Edit only allowed test/fixture/smoke/harness files');
    expect(combined).toContain('Refuse production source edits');
    expect(combined).toContain('source_bug_suspected');
  });

  it('requires exact test-runner commands plus smoke and telemetry evidence', async () => {
    const spec = await loadSpec();
    const combined = `${spec.specialist.prompt.system ?? ''}\n${spec.specialist.prompt.task_template}`;

    expect(combined).toContain('Emit exact commands for test-runner');
    expect(combined).toContain('Commands must be copy-pasteable, scoped');
    expect(combined).toContain('smoke/E2E');
    expect(combined).toContain('telemetry/log assertions');
    expect(combined).toContain('test_engineer');
    expect(combined).toContain('debugger_or_executor');
    expect(combined).toContain('infrastructure');
    expect(combined).toContain('pre_existing');
  });
});
