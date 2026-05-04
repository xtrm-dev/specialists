import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReportBundle, listXtReports } from '../../../scripts/release/xt-reports.ts';
import { parseSpecialist } from '../../../src/specialist/schema.js';
import { renderTaskTemplate } from '../../../src/specialist/script-runner.js';

async function loadChangelogKeeperSpec() {
  return parseSpecialist(readFileSync('config/specialists/changelog-keeper.specialist.json', 'utf8'));
}

describe('changelog-keeper specialist', () => {
  it('wires mandatory rule set and output schema', async () => {
    const result = await loadChangelogKeeperSpec();
    const specialist = result.specialist;

    expect(specialist.execution.permission_required).toBe('MEDIUM');
    expect(specialist.execution.response_format).toBe('markdown');
    expect(specialist.execution.output_type).toBe('workflow');
    expect(specialist.mandatory_rules?.template_sets).toContain('changelog-conventions');

    expect(specialist.prompt.output_schema).toBeUndefined();
  });

  it('injects report bundle pre-script output with cap control', async () => {
    const result = await loadChangelogKeeperSpec();
    const scripts = result.specialist.skills?.scripts ?? [];

    expect(scripts).toHaveLength(1);
    expect(scripts.every((script) => script.phase === 'pre' && script.inject_output === true)).toBe(true);
    expect(scripts[0]?.run).toContain('scripts/release/xt-reports.ts');
    expect(scripts[0]?.run).toContain('$prev_tag');
    expect(scripts[0]?.run).toContain('$next_tag');
  });

  it('renders task template with injected report bundle', async () => {
    const result = await loadChangelogKeeperSpec();
    const rendered = renderTaskTemplate(result.specialist.prompt.task_template, {
      prompt: 'Draft release notes',
      cwd: '/tmp/project',
      prev_tag: 'v3.8.0',
      next_tag: 'v3.9.0',
      reused_worktree_awareness: '',
      bead_context: '',
      pre_script_output: [
        '# xt reports document intent and post-mortem context for sessions that contributed to this release.',
        '## .xtrm/reports/2026-05-03-aa.md',
        '## .xtrm/reports/2026-05-04-bb.md',
      ].join('\n'),
    });

    expect(rendered).toContain('Inject xt report bundle first, then draft.');
    expect(rendered).toContain('Keep bundle capped; if note says older reports dropped, trust the bundle and continue.');
  });

  it('locks output to markdown body plus JSON tail and strict deprecated semantics', async () => {
    const result = await loadChangelogKeeperSpec();
    const { system, task_template: taskTemplate } = result.specialist.prompt;

    expect(system).toContain('Use those reports to write WHY-grounded entries instead of pure WHAT diffs');
    expect(system).toContain('No meta-commentary');
    expect(taskTemplate).toContain('Keep bundle capped; if note says older reports dropped, trust the bundle and continue.');
  });

  it('resolves annotated tags to commit dates when listing reports', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'xt-reports-tag-'));
    const baseEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    const git = (env: Record<string, string | undefined>, ...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' });
    git(baseEnv, 'init', '-q', '-b', 'main');
    git({ ...baseEnv, GIT_COMMITTER_DATE: '2026-05-01T00:00:00Z' }, 'commit', '--allow-empty', '-m', 'init', '--date=2026-05-01T00:00:00Z');
    git(baseEnv, 'tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
    git({ ...baseEnv, GIT_COMMITTER_DATE: '2026-05-04T00:00:00Z' }, 'commit', '--allow-empty', '-m', 'after', '--date=2026-05-04T00:00:00Z');
    mkdirSync(path.join(repo, '.xtrm/reports'), { recursive: true });
    writeFileSync(path.join(repo, '.xtrm/reports/2026-05-03-x.md'), '# in-range\n');
    writeFileSync(path.join(repo, '.xtrm/reports/2026-04-30-y.md'), '# out-of-range\n');

    const reports = listXtReports({ since: 'v1.0.0', to: 'HEAD', rootDir: repo });

    expect(reports.map((r) => r.file)).toEqual(['.xtrm/reports/2026-05-03-x.md']);
  });

  it('drops oldest reports once bundle cap is hit', () => {
    const bundle = buildReportBundle(
      Array.from({ length: 5 }, (_, index) => ({
        file: `.xtrm/reports/2026-05-0${index + 1}-r${index + 1}.md`,
        date: `2026-05-0${index + 1}`,
        bytes: 2000,
        content: `report ${index + 1}\n${'x'.repeat(1800)}`,
      })),
      5000,
    );

    expect(bundle.capped).toBe(true);
    expect(bundle.reports.length).toBeLessThan(5);
    expect(bundle.output.startsWith('# xt reports capped at 5000 bytes; oldest reports dropped')).toBe(true);
  });
});
