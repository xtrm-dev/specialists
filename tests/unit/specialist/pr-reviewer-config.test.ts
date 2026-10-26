import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSpecialist } from '../../../src/specialist/schema.js';

async function loadPrReviewer() {
  return parseSpecialist(readFileSync('config/specialists/pr-reviewer.specialist.json', 'utf8'));
}

describe('pr-reviewer package specialist', () => {
  it('is schema-valid, read-tier, and carries no machine-specific paths or model', async () => {
    const spec = await loadPrReviewer();
    const system = spec.specialist.prompt.system ?? '';

    expect(spec.specialist.metadata.name).toBe('pr-reviewer');
    expect(spec.specialist.execution.permission_required).toBe('LOW');
    expect(spec.specialist.execution.model ?? null).toBeNull();
    expect(system).not.toMatch(/\/home\/\w+/);
    expect(JSON.stringify(spec)).not.toMatch(/\/home\/\w+/);
  });

  it('runs the ocr preflight and the ledger check before the verdict, never the LLM lane', async () => {
    const system = (await loadPrReviewer()).specialist.prompt.system ?? '';

    expect(system).toContain('ocr-preflight.mjs preflight');
    expect(system).toContain('ocr-preflight.mjs check');
    expect(system).toContain('must exit 0 before you emit the verdict');
    expect(system).toContain('Never run `ocr review` or `ocr scan`');
  });

  it('posts exactly one identified PR comment and never approves, merges or edits', async () => {
    const system = (await loadPrReviewer()).specialist.prompt.system ?? '';

    expect(system).toContain('gh pr comment <pr>');
    expect(system).toContain('Review by pr-reviewer specialist (<model>) at head <sha12>');
    expect(system).toContain('Post one comment per reviewed head.');
    expect(system).toContain('Never run `gh pr review`, `gh pr merge`, `gh pr close` or `gh pr edit`.');
  });

  it('emits one verdict format with the PASS, PARTIAL or FAIL enum', async () => {
    const system = (await loadPrReviewer()).specialist.prompt.system ?? '';

    expect(system.match(/## Required output format/g)).toHaveLength(1);
    expect(system).not.toContain('## Compliance Verdict');
    expect(system).toContain('- Verdict: PASS | PARTIAL | FAIL');
    expect(system).toContain('## OCR Preflight');
  });

  it('puts CI status first and reproduces every red check on the merge ref', async () => {
    const system = (await loadPrReviewer()).specialist.prompt.system ?? '';

    expect(system).toContain('CI status is mandatory and comes before you read code');
    expect(system).toContain('reproduce it on the merge ref before you claim anything passes');
    expect(system).toContain('A run on the PR head alone does not clear a red check');
    expect(system).toContain('A required check that is red and unexplained prevents PASS.');
    expect(system).toContain('- Verdict: PASS | PARTIAL | FAIL (exactly one of these three words');
  });
});
