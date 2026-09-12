import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export interface ForbiddenClaim {
  /** Human name for the removed claim, used in the failure message. */
  what: string;
  pattern: RegExp;
}

/**
 * The claims that must never reappear on a native-facing surface. Every pattern here was
 * observed in this tree at some point during the workstream.
 */
export const FORBIDDEN_CLAIMS: ForbiddenClaim[] = [
  { what: 'bead_id is an EXISTING READY Bead', pattern: /EXISTING READY Bead/ },
  { what: 'the Bead is the prompt', pattern: /the Bead is the prompt/i },
  { what: 'dispatch creates a Bead', pattern: /creates? (?:its )?(?:a )?Bead\b/i },
  { what: 'lineage walks bead.parent', pattern: /bead\.parent/ },
  { what: 'Beads is the durable work authority', pattern: /Beads (?:and git )?remain the durable work|Beads as durable work authority|Beads owns the graph/i },
  { what: 'resume keeps the workspace lease', pattern: /keeps its (?:context and its )?workspace lease/i },
  { what: 'the plugin lives at plugins/substrate/', pattern: /plugins\/substrate\// },
  { what: 'the plugin is named "substrate"', pattern: /plugin (?:is )?named [`"']?substrate\b|plugin named `?substrate`?/ },
  { what: 'polling is the normal mandatory workflow', pattern: /then poll specialist_status|poll specialist_status for state/i },
];

/** Excluded from the scan, with the reason each is legitimate. */
export const EXCLUDED_FILES: Array<{ path: string; reason: string }> = [
  {
    path: 'docs/cli-reference.md',
    reason: 'Legacy `sp` CLI reference. The Beads-backed job workflow still exists and this surface documents it correctly.',
  },
  {
    path: 'docs/worktrees.md',
    reason: 'Legacy `sp run --worktree` reference. Worktree provisioning is correct there and is explicitly rejected for the native path.',
  },
  {
    path: 'docs/ARCHITECTURE.md',
    reason: 'Legacy `--worktree` / epic chain reference, Beads-scoped.',
  },
  {
    path: 'docs/features.md',
    reason: 'Documents the legacy `sp run` and Supervisor surfaces; its MCP section is explicitly labelled legacy compatibility.',
  },
  {
    path: 'docs/e1-plugin-design-record.md',
    reason: 'Historical design record, banner-marked superseded. Its value is that it records what was decided at the time.',
  },
  {
    path: 'docs/design/roadmap/specialists-prd.md',
    reason: 'Product roadmap with Beads-era historical sections. Only its dispatch/status inventory is normative and is checked by hand.',
  },
];

/** The native surface: exactly these files, plus every skill under the plugin. */
export const NATIVE_SURFACE_FILES = [
  'src/tools/specialist/activation.tool.ts',
  'src/activation/native-host.ts',
  'docs/mcp-tools.md',
  'docs/native-activation.md',
];

export const PLUGIN_SKILLS_DIR = join('plugins', 'specialists', 'skills');

/** `config/skills/using-specialists/SKILL.md` is only native BELOW this header. */
export const NATIVE_SECTION_HEADER = /^##\s+Native activation\b/;

export interface ScanTarget {
  path: string;
  /** Lines to scan, with their original 1-based numbers. */
  lines: Array<{ number: number; text: string }>;
}

function linesOf(absolutePath: string): Array<{ number: number; text: string }> {
  return readFileSync(absolutePath, 'utf8')
    .split('\n')
    .map((text, index) => ({ number: index + 1, text }));
}

/** The native half of a two-runtime document: from the native header to the next `## `. */
function nativeSectionLines(absolutePath: string): Array<{ number: number; text: string }> {
  const all = linesOf(absolutePath);
  const start = all.findIndex((line) => NATIVE_SECTION_HEADER.test(line.text));
  if (start < 0) throw new Error(`no native section header in ${absolutePath}`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line.text));
  return [all[start], ...(end < 0 ? rest : rest.slice(0, end))];
}

function pluginSkillFiles(): string[] {
  const root = join(REPO_ROOT, PLUGIN_SKILLS_DIR);
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((entry) => extname(entry) === '.md')
    .map((entry) => join(PLUGIN_SKILLS_DIR, entry));
}

export function scanTargets(): ScanTarget[] {
  const excluded = new Set(EXCLUDED_FILES.map((entry) => entry.path));
  const targets: ScanTarget[] = [];

  for (const relativePath of [...NATIVE_SURFACE_FILES, ...pluginSkillFiles()]) {
    if (excluded.has(relativePath)) continue;
    targets.push({ path: relativePath, lines: linesOf(join(REPO_ROOT, relativePath)) });
  }

  const twoRuntime = 'config/skills/using-specialists/SKILL.md';
  targets.push({ path: twoRuntime, lines: nativeSectionLines(join(REPO_ROOT, twoRuntime)) });

  return targets;
}

export interface Violation {
  file: string;
  line: number;
  what: string;
  text: string;
}

export function findViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const target of scanTargets()) {
    for (const line of target.lines) {
      for (const claim of FORBIDDEN_CLAIMS) {
        if (claim.pattern.test(line.text)) {
          violations.push({ file: target.path, line: line.number, what: claim.what, text: line.text.trim() });
        }
      }
    }
  }
  return violations;
}

export function describeViolation(violation: Violation): string {
  return `${violation.file}:${violation.line}: ${violation.what}\n    ${violation.text}`;
}

/** One known-true historical sample per claim, so the test proves the patterns are not vacuous. */
export const HISTORICAL_SAMPLES: Record<string, string> = {
  'bead_id is an EXISTING READY Bead': "bead_id: 'The id of an EXISTING READY Bead'",
  'the Bead is the prompt': '*The Bead is the prompt.* It has no task field.',
  'dispatch creates a Bead': 'an inline contract creates its bead first',
  'lineage walks bead.parent': 'Walk bead.parent UP this many hops',
  'Beads is the durable work authority': 'Beads and git remain the durable work and integration authority',
  'resume keeps the workspace lease': 'the child keeps its context and its workspace lease',
  'the plugin lives at plugins/substrate/': 'the plugin lives at plugins/substrate/ today',
  'the plugin is named "substrate"': 'Specialists ships a Claude Code plugin named substrate',
  'polling is the normal mandatory workflow': 'Dispatch admission, then poll specialist_status.',
};

/** A tiny driver so the same scan can be run as evidence outside vitest. */
if (import.meta.main) {
  const violations = findViolations();
  for (const violation of violations) console.log(describeViolation(violation));
  console.log(`violations: ${violations.length}`);
}
