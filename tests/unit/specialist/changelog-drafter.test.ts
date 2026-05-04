import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSpecialist } from '../../../src/specialist/schema.js';
import { compatGuard } from '../../../src/specialist/script-runner.js';

describe('changelog-drafter specialist', () => {
  it('passes script compat guard', async () => {
    const result = await parseSpecialist(readFileSync('config/specialists/changelog-drafter.specialist.json', 'utf8'));

    expect(result.specialist.execution.permission_required).toBe('READ_ONLY');
    expect(result.specialist.execution.interactive).toBe(false);
    expect(result.specialist.execution.requires_worktree).toBe(false);
    expect(result.specialist.skills?.scripts).toBeUndefined();
    expect(result.specialist.skills?.paths).toBeUndefined();

    expect(() => compatGuard(result)).not.toThrow();
  });
});
