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

  it('tells the model which background tools exist and that no delegate tools do', async () => {
    const spec = await loadPrReviewer();
    const system = spec.specialist.prompt.system ?? '';

    expect(spec.specialist.metadata.version).toBe('1.4.0');
    expect(system).toContain('If only `BashBackground`, `Monitor` and `BackgroundStop` are exposed, there are no delegate, attested-run or fusion tools');
  });

  it('posts exactly one formal review pinned to the head, and never merges or edits', async () => {
    const system = (await loadPrReviewer()).specialist.prompt.system ?? '';

    expect(system).toContain('gh pr review <pr> --repo <owner/repo> --comment --body-file');
    expect(system).toContain('sets `commit_id` to the reviewed head');
    expect(system).toContain('Review by <role> (<model>) at head <sha12>');
    expect(system).toContain('One review per reviewed head');
    expect(system).toContain('`gh pr review` is your only GitHub write');
    expect(system).not.toContain('Post one comment per reviewed head.');
    expect(system).not.toContain('Never run `gh pr review`');
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

  it('caps targeted test runs at 4 GB virtual and keeps mutation runs at 2 GB', async () => {
    const system = (await loadPrReviewer()).specialist.prompt.system ?? '';

    expect(system).toContain('targeted Python tests `(ulimit -v 4000000; timeout 120 ...)`');
    expect(system).toContain('mutation runs keep `(ulimit -v 2000000; timeout 120 ...)`, one mutant at a time');
  });

  it('lints the findings body mechanically before posting and leaves the header to the shim', async () => {
    const system = (await loadPrReviewer()).specialist.prompt.system ?? '';

    expect(system).toContain('This exact command must exit 0, and a body that fails it is fixed and re-linted, never posted');
    expect(system).toContain("^- Verdict: (PASS|PARTIAL|FAIL)$");
    expect(system).toContain("! grep -Eq '/home/|/Users/|/root/'");
    expect(system).toContain('do NOT write the header line or the marker yourself');
    expect(system).not.toContain('mmd-review');
  });

  it('refuses to post outside the reviewer role instead of working around the shim', async () => {
    const system = (await loadPrReviewer()).specialist.prompt.system ?? '';
    expect(system).toContain('the launch sets `XTRM_ROLE=reviewer`');
    expect(system).toContain('do not work around it with `gh api` or `gh pr comment`');
  });
});
