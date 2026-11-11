import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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

    expect(system).toContain('If only `BashBackground`, `Monitor` and `BackgroundStop` are exposed, there are no delegate, attested-run or fusion tools');
  });

  it('posts exactly one formal review pinned to the head, and never merges or edits', async () => {
    const system = (await loadPrReviewer()).specialist.prompt.system ?? '';

    expect(system).toContain('gh pr review <pr> --repo <owner/repo> --comment');
    expect(system).toContain("resolves `<sha12>` against the PR");
    expect(system).toContain('Review by pr-reviewer (<model>) at head <sha12>');
    expect(system).toContain('One review per reviewed head');
    expect(system).not.toContain('Post one comment per reviewed head.');
    expect(system).not.toContain('Never run `gh pr review`');
  });

  it('binds each verdict to exactly one gh pr review flag', async () => {
    const system = (await loadPrReviewer()).specialist.prompt.system ?? '';

    // The prompt is the only place that decides which flag carries which verdict,
    // and the shim refuses a flag that disagrees with the body. One assertion over
    // the post instruction binds the three pairs in order: a swap
    // (--approve for PARTIAL, --comment for PASS), a substitution (--reject) or a
    // dropped binding changes this mapping.
    const start = system.indexOf('Then post with exactly one verdict flag:');
    const end = system.indexOf('The shim prints the review', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const post = system.slice(start, end);

    const bindings = [...post.matchAll(/(--comment|--approve|--request-changes)[^,]*?for (PASS|PARTIAL|FAIL)/g)]
      .map((match) => [match[1], match[2]]);
    expect(bindings).toEqual([
      ['--comment', 'PARTIAL'],
      ['--approve', 'PASS'],
      ['--request-changes', 'FAIL'],
    ]);
  });

  it('says the review is one formal GitHub review, not a review comment', async () => {
    const task = (await loadPrReviewer()).specialist.prompt.task_template;

    expect(task).toContain('formal GitHub review');
    expect(task).not.toContain('review comment');
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
    expect(system).toContain('Do NOT write any hidden marker');
    expect(system).not.toContain('mmd-review');
  });

  it('loads the pr-reviewer-only rule set and leaves the shared one to the job reviewer', async () => {
    const pr = await loadPrReviewer();
    expect(pr.specialist.mandatory_rules?.template_sets).toContain('pr-reviewer-verdict-format');
    const shared = readFileSync('config/mandatory-rules/pr-reviewer-verdict-format.md', 'utf8');
    expect(shared).toContain('pr-reviewer');
    // The shared rule the job reviewer also loads must not carry PR-only text.
    const sharedReviewer = readFileSync('config/mandatory-rules/reviewer-verdict-format.md', 'utf8');
    expect(sharedReviewer).not.toContain('gh pr review');
    expect(sharedReviewer).not.toContain('PR Review Verdict');
  });

  it('executes the lint command from the prompt: a good body passes, a self-written header or a second verdict fails', async () => {
    const system = (await loadPrReviewer()).specialist.prompt.system ?? '';
    const start = system.indexOf('f=<body file>;');
    expect(start).toBeGreaterThan(0);
    const end = system.indexOf('`. Then post', start);
    expect(end).toBeGreaterThan(start);
    const lint = system.slice(start + 'f=<body file>;'.length, end).replace(/^\s+/, '');

    const dir = mkdtempSync(join(tmpdir(), 'pr-reviewer-lint-'));
    try {
      const run = (name: string, body: string) => {
        const file = join(dir, name);
        writeFileSync(file, body);
        return spawnSync('bash', ['-c', `f=${JSON.stringify(file)}; ${lint}`], { encoding: 'utf8' });
      };
      const header = 'Review by pr-reviewer (Muse Spark) at head 0123456789ab';
      const good = `${header}\n\n## PR Review Verdict\n- Verdict: PARTIAL\n\n## Findings\n- one thing\n`;
      expect(run('good.md', good).status, 'good body must pass the prompt lint').toBe(0);

      // A body with no header line fails line 1.
      expect(run('no-header.md', '## PR Review Verdict\n- Verdict: PARTIAL\n').status).not.toBe(0);
      // Two verdict lines fail.
      expect(run('two-verdicts.md', `${good}- Verdict: PASS\n`).status).not.toBe(0);
      // A self-written hidden marker fails.
      expect(run('marker.md', `${header}\n<!-- agent=me run=x -->\n\n## PR Review Verdict\n- Verdict: PASS\n`).status).not.toBe(0);
      // An absolute host path fails.
      expect(run('path.md', `${good}- see /home/someone/file.ts\n`).status).not.toBe(0);
      // The size cap fails on its own: drop the cap clause and this body passes.
      expect(run('big.md', `${good}${'x'.repeat(60000)}\n`).status).not.toBe(0);
      // The section clause fails on its own: drop the grep and this body passes.
      expect(run('no-section.md', `${header}\n\n- Verdict: PARTIAL\n`).status).not.toBe(0);
      // Line 1 is pinned, not merely prefix-matched: another role, an 11-hex or a
      // 13-hex head, trailing text after the head, and a model that starts with
      // whitespace all fail. Each case is a mutant killer — widening pr-reviewer
      // to [a-z-]+, {12} to {3}, dropping the trailing $, or [^)]* opening to a
      // leading space must turn one of these red.
      expect(run('other-role.md', 'Review by other-role (Muse Spark) at head 0123456789ab\n\n## PR Review Verdict\n- Verdict: PASS\n').status, 'another role must fail line 1').not.toBe(0);
      expect(run('short-head.md', 'Review by pr-reviewer (Muse Spark) at head 0123456789a\n\n## PR Review Verdict\n- Verdict: PASS\n').status, 'an 11-hex head must fail line 1').not.toBe(0);
      expect(run('long-head.md', 'Review by pr-reviewer (Muse Spark) at head 0123456789abc\n\n## PR Review Verdict\n- Verdict: PASS\n').status, 'a 13-hex head must fail line 1').not.toBe(0);
      expect(run('trailing-text.md', 'Review by pr-reviewer (Muse Spark) at head 0123456789ab (delta from 0123456789ab)\n\n## PR Review Verdict\n- Verdict: PASS\n').status, 'trailing text after the head must fail line 1').not.toBe(0);
      expect(run('leading-space-model.md', 'Review by pr-reviewer ( Muse Spark) at head 0123456789ab\n\n## PR Review Verdict\n- Verdict: PASS\n').status, 'a model name starting with whitespace must fail line 1').not.toBe(0);
      // Parity with the shim: a verdict line must start at column 0, so an
      // indented one fails the lint instead of reaching the shim and being
      // refused there.
      expect(run('indented.md', `${header}\n\n## PR Review Verdict\n  - Verdict: PARTIAL\n`).status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to post outside the reviewer role instead of working around the shim', async () => {
    const system = (await loadPrReviewer()).specialist.prompt.system ?? '';
    expect(system).toContain('the launch sets `XTRM_ROLE=reviewer`');
    expect(system).toContain('do not work around it with `gh api` or `gh pr comment`');
  });
});
