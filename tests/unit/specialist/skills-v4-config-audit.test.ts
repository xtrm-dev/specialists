import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildMandatoryRulesInjection } from '../../../src/specialist/mandatory-rules.js';
import { buildRequiredPlatformRulesInjection } from '../../../src/specialist/required-platform-rules.js';

const repoRoot = process.cwd();
const specialistsDir = join(repoRoot, 'config', 'specialists');

const retiredSkillTokens = [
  'test-planning',
  'using-nodes',
  'specialists-creator/SKILL.md',
  'default/xt-merge',
  'default/xt-debugging',
  'default/clean-code',
  'gitnexus-exploring',
  'gitnexus-impact-analysis',
  'default/find-docs',
  'default/deepwiki',
  'default/github-search',
  'default/last30days',
  'verified-audit',
  '.agents/skills/using-quality-gates',
  '.agents/skills/clean-code',
];

const readSpec = (name: string) => JSON.parse(readFileSync(join(specialistsDir, `${name}.specialist.json`), 'utf8'));

describe('skills-v4 default specialist wiring', () => {
  it('contains no retired v3 skill references in package specialist configs', () => {
    const files = readdirSync(specialistsDir).filter((name) => name.endsWith('.specialist.json')).sort();
    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(specialistsDir, file), 'utf8');
      for (const token of retiredSkillTokens) if (text.includes(token)) violations.push(`${file}: ${token}`);
    }
    expect(violations).toEqual([]);
  });

  it('wires v4 umbrellas to specialists that materially depend on them', () => {
    expect(readSpec('planner').specialist.skills.paths).toEqual(['planning']);
    expect(readSpec('chain-coordinator').specialist.skills.paths).toEqual(['using-specialists']);
    expect(readSpec('node-coordinator').specialist.skills.paths).toEqual(['using-specialists']);
    expect(readSpec('specialists-creator').specialist.skills.paths).toEqual(['using-specialists']);
    expect(readSpec('debugger').specialist.skills.paths).toEqual(['engineering-quality', 'gitnexus']);
    expect(readSpec('explorer').specialist.skills.paths).toEqual(['gitnexus']);
    expect(readSpec('seconder').specialist.skills.paths).toEqual(['engineering-quality', 'gitnexus']);
    expect(readSpec('test-engineer').specialist.skills.paths).toEqual(['planning', 'engineering-quality']);
    expect(readSpec('researcher').specialist.skills.paths).toEqual(['~/.xtrm/skills/optional/research-methods/research/SKILL.md']);
    expect(readSpec('security-auditor').specialist.skills.paths).toEqual([
      '~/.xtrm/skills/optional/security-ops/security-ops/SKILL.md',
      '~/.xtrm/skills/optional/research-methods/research/SKILL.md',
    ]);
    expect(readSpec('sync-docs').specialist.skills.paths).toEqual(['~/.xtrm/skills/optional/xtrm-maintenance/sync-docs/']);
    expect(readSpec('service-knowledge-sync').specialist.skills.paths).toEqual(['service-knowledge', 'gitnexus']);
    expect(readSpec('reviewer').specialist.skills.paths).toEqual(['engineering-quality', 'gitnexus']);
    expect(readSpec('xt-merge').specialist.skills.paths).toEqual([]);
  });

  it('keeps the fleet boundary required even when ordinary global quick rules are disabled', () => {
    const injection = buildMandatoryRulesInjection({
      cwd: repoRoot,
      specialist: { mandatory_rules: { disable_default_globals: true, template_sets: [] } },
    });
    expect(injection.globalsDisabled).toBe(true);
    expect(injection.setsLoaded).toContain('core-session-boundary');
    expect(injection.block).toContain('one worker in XTRM');
    expect(injection.block).toContain('PROBLEM/SUCCESS/SCOPE/NON_GOALS/CONSTRAINTS/VALIDATION/OUTPUT');
    expect(injection.block).toContain('service-knowledge');
    expect(injection.block).toContain('current evidence wins');
    expect(injection.block).toContain('ast-grep');
    expect(injection.block).toContain('python-kernel');
    expect(injection.block).toContain('route through its references');
  });

  it('reduces bare mode to required platform rules only across both runners', () => {
    const injection = buildRequiredPlatformRulesInjection(repoRoot, 2400);
    expect(injection.setsLoaded).toEqual(['core-session-boundary']);
    expect(injection.block).toContain('core-session-boundary');
    expect(injection.block).not.toContain('git-workflow-safe');
    expect(injection.block).not.toContain('workflow-quick-rules');
    // runner.ts delegates system-prompt assembly (incl. bare mode) to system-prompt.ts
    // (unitAI-rrdnt.3) — that's where buildRequiredPlatformRulesBlock is now wired.
    for (const path of ['src/specialist/system-prompt.ts', 'src/specialist/script-runner.ts']) {
      expect(readFileSync(join(repoRoot, path), 'utf8')).toContain('buildRequiredPlatformRulesBlock');
    }
  });
  it('keeps canonical role prompts off the retired Beads lifecycle', () => {
    const files = readdirSync(specialistsDir).filter((name) => name.endsWith('.specialist.json')).sort();
    const forbidden = /\bbd\s+(?:show|create|update|close|ready|list|query|dep|prime)\b/;
    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(specialistsDir, file), 'utf8');
      if (forbidden.test(text)) violations.push(`${file}: direct bd lifecycle command`);
      if (text.includes('"bead-id-verbatim"')) violations.push(`${file}: bead-id-verbatim`);
    }
    expect(violations).toEqual([]);
  });

  it('keeps current mandatory rules on Substrate authority while quarantining the legacy bead rule', () => {
    const rulesDir = join(repoRoot, 'config', 'mandatory-rules');
    const forbidden = /\bbd\s+(?:show|create|update|close|ready|list|query|dep|prime)\b/;
    const violations: string[] = [];
    for (const file of readdirSync(rulesDir).filter((name) => name.endsWith('.md')).sort()) {
      const text = readFileSync(join(rulesDir, file), 'utf8');
      if (file !== 'bead-id-verbatim.md' && forbidden.test(text)) violations.push(file);
    }
    expect(violations).toEqual([]);

    const boundary = readFileSync(join(rulesDir, 'core-session-boundary.md'), 'utf8');
    expect(boundary).toContain('pinned Substrate Issue revision');
    expect(boundary).toContain('Journal');
    expect(boundary).toContain('not Issue Closure');

    const legacy = readFileSync(join(rulesDir, 'bead-id-verbatim.md'), 'utf8');
    expect(legacy).toContain('LEGACY COMPATIBILITY ONLY');
    expect(legacy).toContain('Do not use Beads as durable authority');
  });

  it('does not inject the retired Beads workflow quick-rules block', () => {
    const source = readFileSync(join(repoRoot, 'src', 'specialist', 'mandatory-rules.ts'), 'utf8');
    expect(source).not.toContain('STATIC_WORKFLOW_RULES_BLOCK');
    expect(source).not.toContain("id: 'workflow-quick-rules'");
    const memorySource = readFileSync(join(repoRoot, 'src', 'specialist', 'memory-retrieval.ts'), 'utf8');
    expect(memorySource).not.toContain('## Beads Workflow Quick Rules');
  });

  it('keeps generated/operator entry points Substrate-first', () => {
    const initSource = readFileSync(join(repoRoot, 'src', 'cli', 'init.ts'), 'utf8');
    expect(initSource).toContain('Substrate owns durable work');
    expect(initSource).toContain('specialist_dispatch(issue_ref=...)');
    expect(initSource).not.toContain('Create/claim bead issue');

    const helpSource = readFileSync(join(repoRoot, 'src', 'cli', 'help.ts'), 'utf8');
    expect(helpSource).toContain('Native tracked work (primary)');
    expect(helpSource).toContain('legacy Beads-backed sp job compatibility surface');
    expect(helpSource).not.toContain('bead-first workflow');

    const quickstartSource = readFileSync(join(repoRoot, 'src', 'cli', 'quickstart.ts'), 'utf8');
    expect(quickstartSource).toContain('Native tracked work');
    expect(quickstartSource).toContain('Legacy sp compatibility');
  });

  it('keeps Pi native dispatch issue_ref-first with bead_id only as compatibility alias', () => {
    const extensionSource = readFileSync(
      join(repoRoot, 'config', 'pi-extensions', 'specialist-subagents', 'index.mjs'),
      'utf8',
    );
    expect(extensionSource).toContain("issue_ref: Type.Optional");
    expect(extensionSource).toContain('Primary work locator');
    expect(extensionSource).toContain('Legacy compatibility alias for issue_ref');
    expect(extensionSource).toContain('created_issue_ref');
    expect(extensionSource).toContain('settlement is not Issue Closure');
    expect(extensionSource).not.toContain('existing READY Bead');
    expect(extensionSource).not.toContain('then a Bead is created');
  });

  it('keeps the canonical execution skill aligned with the eight native activation tools', () => {
    const skill = readFileSync(join(repoRoot, 'config', 'skills', 'using-specialists', 'SKILL.md'), 'utf8');
    expect(skill).toContain('Eight tools');
    for (const tool of [
      'specialist_dispatch',
      'specialist_status',
      'specialist_reply',
      'specialist_resume',
      'specialist_retry',
      'specialist_steer',
      'specialist_stop_activation',
      'specialist_list',
    ]) {
      expect(skill).toContain(`\`${tool}\``);
    }
  });

});
