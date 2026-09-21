// tests/unit/cli/rules-inspectable.test.ts
// SPECIALISTS-4205: mandatory-rules introspection must work on a config that is
// not yet runnable, and a rule's own text must be printable.
//
// These live in a new file rather than tests/unit/cli/list-rules.test.ts because
// that suite is quarantined (SPECIALISTS-121) and therefore cannot carry a
// regression test the default baseline actually runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run as runView } from '../../../src/cli/view.js';
import { run as runListRules } from '../../../src/cli/list-rules.js';

// Force the loader to ignore the installed package's canonical-asset dir so each
// test sees ONLY the fixtures written into tmpProject/config. Without this the
// globally installed specialists leak in and the fixture counts are meaningless
// (the reason tests/unit/cli/list-rules.test.ts is quarantined).
vi.mock('../../../src/specialist/canonical-asset-resolver.js', () => ({
  resolveCanonicalAssetDir: () => null,
}));

const RULE_BODY = '---\nname: demo-rule\nkind: mandatory-rule\n---\nDemo rule body line one.\n';

const SPEC = (name: string, model: string | null): string => JSON.stringify({
  specialist: {
    metadata: { name, version: '1.0.0', description: 'demo', category: 'test' },
    execution: { model, permission_required: 'READ_ONLY' },
    prompt: { task_template: 'Do $prompt' },
    mandatory_rules: { template_sets: ['demo-rule'] },
  },
});

describe('mandatory-rules introspection (SPECIALISTS-4205)', () => {
  let project: string;
  let home: string;
  let originalHome: string | undefined;
  let originalXdg: string | undefined;
  let originalCwd: string;
  let originalArgv: string[];
  let logLines: string[];
  let stdout: string;
  let stderr: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'rules-inspectable-proj-'));
    home = mkdtempSync(join(tmpdir(), 'rules-inspectable-home-'));
    originalHome = process.env.HOME;
    originalXdg = process.env.XDG_CONFIG_HOME;
    originalCwd = process.cwd();
    originalArgv = process.argv;

    mkdirSync(join(project, 'config', 'mandatory-rules'), { recursive: true });
    mkdirSync(join(project, 'config', 'specialists'), { recursive: true });
    writeFileSync(join(project, 'config', 'mandatory-rules', 'index.json'), JSON.stringify({
      required_template_sets: ['core-rule'],
      default_template_sets: [],
    }));
    writeFileSync(join(project, 'config', 'mandatory-rules', 'core-rule.md'), '---\nname: core-rule\nkind: mandatory-rule\n---\nCore.\n');
    writeFileSync(join(project, 'config', 'mandatory-rules', 'demo-rule.md'), RULE_BODY);
    // model: null on purpose — the fresh-config case that used to abort `sp view`.
    writeFileSync(join(project, 'config', 'specialists', 'demo.specialist.json'), SPEC('demo', null));

    // No global user.json: no layer supplies a model.
    process.env.HOME = home;
    delete process.env.XDG_CONFIG_HOME;
    process.chdir(project);

    logLines = [];
    stdout = '';
    stderr = '';
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => { logLines.push(String(msg ?? '')); });
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => { stdout += String(chunk); return true; }) as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => { stderr += String(chunk); return true; }) as never);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.argv = originalArgv;
    process.env.HOME = originalHome;
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    vi.restoreAllMocks();
    vi.resetModules();
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  /**
   * Both CLIs read their args from `process.argv.slice(3)`. Returns everything
   * written through console.log; `stdout` holds process.stdout.write payloads
   * (list-rules --json) and is reset per call.
   */
  async function runCli(subcommand: 'view' | 'list-rules', args: string[]): Promise<string> {
    logLines.length = 0;
    stdout = '';
    stderr = '';
    process.argv = ['bun', 'cli.js', subcommand, ...args];
    await (subcommand === 'view' ? runView() : runListRules());
    return logLines.join('\n');
  }

  it('sp view --section renders a specialist whose model no layer supplies, marking it unset', async () => {
    const out = await runCli('view', ['demo', '--section', 'mandatory']);
    expect(out).toContain('mandatory_rules');
    expect(out).toContain('demo-rule');
    expect(out).toContain('(unset)');
  });

  it('sp view --raw --section emits only that section, while --raw alone stays the full spec', async () => {
    const narrowed = JSON.parse(await runCli('view', ['demo', '--raw', '--section', 'mandatory']));
    expect(Object.keys(narrowed)).toEqual(['specialist']);
    expect(Object.keys(narrowed.specialist)).toEqual(['mandatory_rules']);
    expect(narrowed.specialist.mandatory_rules.template_sets).toEqual(['demo-rule']);

    const full = JSON.parse(await runCli('view', ['demo', '--raw']));
    // The xt pi --role launcher parses this; narrowing it would break that contract.
    expect(full.specialist.metadata.name).toBe('demo');
    expect(Object.keys(full.specialist).length).toBeGreaterThan(1);
  });

  it('sp list-rules --rule --show prints the rule text verbatim from its source file', async () => {
    const out = await runCli('list-rules', ['--rule', 'demo-rule', '--show']);
    expect(out).toContain('Rule: demo-rule');
    expect(out).toContain('demo-rule.md');
    // Verbatim: the file is the authority, so frontmatter and body both survive.
    expect(out).toContain(RULE_BODY.trimEnd());
  });

  it('sp list-rules --rule --show --json carries the content alongside the routing', async () => {
    await runCli('list-rules', ['--rule', 'demo-rule', '--show', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.rule).toBe('demo-rule');
    expect(parsed.content).toBe(RULE_BODY);
    expect(parsed.source_path).toContain('demo-rule.md');
    expect(parsed.applied_to.map((entry: { name: string }) => entry.name)).toEqual(['demo']);
  });

  it('sp list-rules --show refuses to run without --rule instead of silently doing nothing', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('__exit__'); }) as never);
    await expect(runCli('list-rules', ['--show'])).rejects.toThrow('__exit__');
    expect(stderr).toContain('--show requires --rule');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('sp list-rules --rule --show fails loud for an unknown rule id', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('__exit__'); }) as never);
    await expect(runCli('list-rules', ['--rule', 'not-a-rule', '--show'])).rejects.toThrow('__exit__');
    expect(stderr).toContain('Unknown rule: not-a-rule');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
