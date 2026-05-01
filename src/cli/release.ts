import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { SpecialistLoader } from '../specialist/loader.js';
import { runScriptSpecialist } from '../specialist/script-runner.js';

type BumpKind = 'major' | 'minor' | 'patch';

type PrepareReleaseArgs = {
  bump: BumpKind;
  fromTag?: string;
  toTag?: string;
  insertAfter?: string;
};

type ReleaseDraft = {
  unreleased_summary: string;
  sections: {
    added: string[];
    changed: string[];
    fixed: string[];
    removed: string[];
    deprecated: string[];
    security: string[];
  };
};

type GitDeps = {
  spawn: typeof spawnSync;
  exec: typeof execFileSync;
  readFile: typeof readFileSync;
  writeFile: typeof writeFileSync;
  cwd: () => string;
  now: () => Date;
  loader: (projectDir: string) => SpecialistLoader;
  runScript: typeof runScriptSpecialist;
};

const DEFAULT_RELEASE_SPECIALIST = 'changelog-keeper';
const SEMVER_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;
const RELEASE_HEADER = /^## \[(v?\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/m;
const DEFAULT_DEPS: GitDeps = {
  spawn: spawnSync,
  exec: execFileSync,
  readFile: readFileSync,
  writeFile: writeFileSync,
  cwd: () => process.cwd(),
  now: () => new Date(),
  loader: (projectDir: string) => new SpecialistLoader({ projectDir }),
  runScript: runScriptSpecialist,
};

export function parseBumpKind(argv: string[]): BumpKind {
  if (argv.includes('--major')) return 'major';
  if (argv.includes('--minor')) return 'minor';
  return 'patch';
}

export function parseArgs(argv: string[]): PrepareReleaseArgs {
  const bump = parseBumpKind(argv);
  const fromTag = readFlagValue(argv, '--from');
  const toTag = readFlagValue(argv, '--to');
  const insertAfter = readFlagValue(argv, '--insert-after');
  validateReleaseRangeArgs({ bump, fromTag, toTag });
  return { bump, fromTag, toTag, insertAfter };
}

export function getMostRecentSemverTag(tags: string[]): string | undefined {
  return tags.map((tag) => tag.trim()).filter((tag) => SEMVER_TAG.test(tag)).sort(compareSemver).at(-1);
}

export function computeNextTag(prevTag: string | undefined, bump: BumpKind): string {
  const base = prevTag ? parseSemver(prevTag) : { major: 0, minor: 0, patch: 0 };
  if (bump === 'major') return `v${base.major + 1}.0.0`;
  if (bump === 'minor') return `v${base.major}.${base.minor + 1}.0`;
  return `v${base.major}.${base.minor}.${base.patch + 1}`;
}

export function buildReleaseSection(version: string, date: string, draft: ReleaseDraft): string {
  const lines = [`## [${version}] - ${date}`, ''];
  appendSection(lines, 'Added', draft.sections.added);
  appendSection(lines, 'Changed', draft.sections.changed);
  appendSection(lines, 'Fixed', draft.sections.fixed);
  appendSection(lines, 'Removed', draft.sections.removed);
  appendSection(lines, 'Deprecated', draft.sections.deprecated);
  appendSection(lines, 'Security', draft.sections.security);
  return `${lines.join('\n').trimEnd()}\n`;
}

export function extractReleaseDraft(output: string): ReleaseDraft | undefined {
  const jsonText = output.match(/\{[\s\S]*\}/)?.[0];
  if (jsonText) {
    try {
      const fromJson = normalizeReleaseDraft(JSON.parse(jsonText));
      if (fromJson) return fromJson;
    } catch {
      // fall through to markdown parse
    }
  }
  return parseMarkdownDraft(output);
}

const SECTION_KEY_MAP: Record<string, keyof ReleaseDraft['sections']> = {
  added: 'added', add: 'added',
  changed: 'changed', change: 'changed',
  fixed: 'fixed', fix: 'fixed', fixes: 'fixed',
  removed: 'removed', remove: 'removed',
  deprecated: 'deprecated', deprecate: 'deprecated',
  security: 'security',
};

function emptySections(): ReleaseDraft['sections'] {
  return { added: [], changed: [], fixed: [], removed: [], deprecated: [], security: [] };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function normalizeReleaseDraft(raw: unknown): ReleaseDraft | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const sectionsRaw = obj.sections;
  const sections = emptySections();

  if (Array.isArray(sectionsRaw)) {
    for (const item of sectionsRaw) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const name = typeof entry.name === 'string' ? entry.name.trim().toLowerCase() : '';
      const key = SECTION_KEY_MAP[name];
      if (!key) continue;
      const bullets = toStringArray(entry.bullets ?? entry.entries ?? entry.items);
      sections[key].push(...bullets);
    }
  } else if (sectionsRaw && typeof sectionsRaw === 'object') {
    const record = sectionsRaw as Record<string, unknown>;
    for (const [rawKey, value] of Object.entries(record)) {
      const key = SECTION_KEY_MAP[rawKey.trim().toLowerCase()];
      if (!key) continue;
      sections[key].push(...toStringArray(value));
    }
  } else {
    return undefined;
  }

  const total = Object.values(sections).reduce((n, arr) => n + arr.length, 0);
  if (total === 0) return undefined;
  const summary = typeof obj.unreleased_summary === 'string' ? obj.unreleased_summary : '';
  return { unreleased_summary: summary, sections };
}

function parseMarkdownDraft(output: string): ReleaseDraft | undefined {
  const sections: ReleaseDraft['sections'] = { added: [], changed: [], fixed: [], removed: [], deprecated: [], security: [] };
  const sectionMap: Record<string, keyof ReleaseDraft['sections']> = {
    Added: 'added', Changed: 'changed', Fixed: 'fixed', Removed: 'removed', Deprecated: 'deprecated', Security: 'security',
  };
  const lines = output.split('\n');
  let current: keyof ReleaseDraft['sections'] | null = null;
  let lastEntry: string | null = null;
  for (const raw of lines) {
    const line = raw.replace(/^\s+/, '');
    const heading = line.match(/^### (Added|Changed|Fixed|Removed|Deprecated|Security)\b/);
    if (heading) {
      current = sectionMap[heading[1]];
      lastEntry = null;
      continue;
    }
    if (!current) continue;
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      const entry = bullet[1].replace(/^\*\*([^*]+)\*\*:\s*/, '$1: ').trim();
      sections[current].push(entry);
      lastEntry = entry;
      continue;
    }
    if (lastEntry && line.trim()) {
      sections[current][sections[current].length - 1] = `${lastEntry} ${line.trim()}`;
    } else if (!line.trim()) {
      lastEntry = null;
    }
  }
  const total = Object.values(sections).reduce((n, arr) => n + arr.length, 0);
  if (total === 0) return undefined;
  return { unreleased_summary: '', sections };
}

export function insertReleaseSection(changelog: string, section: string, insertAfter?: string): string {
  const normalized = changelog.replace(/\r\n/g, '\n');
  const version = section.match(/^## \[(v?\d+\.\d+\.\d+)\]/m)?.[1];
  if (!version) throw new Error('Release section must start with version header');
  const existingSection = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\] - .*?(?=^## \\[[^\n]+\\] - |\\z)`, 'ms');
  const withoutDuplicate = normalized.replace(existingSection, '').replace(/\n{3,}/g, '\n\n');
  const lines = withoutDuplicate.split('\n');
  const unreleasedIndex = lines.findIndex((line) => line.trim() === '## [Unreleased]');
  if (unreleasedIndex < 0) throw new Error('Missing [Unreleased] section in CHANGELOG.md');
  const releaseHeaders = lines
    .map((line, index) => ({ line, index }))
    .filter(({ index }) => index > unreleasedIndex && RELEASE_HEADER.test(lines[index]));
  const anchorIndex = insertAfter
    ? releaseHeaders.find(({ line }) => line.includes(`[${insertAfter}]`))?.index
    : releaseHeaders[0]?.index;
  const insertIndex = anchorIndex !== undefined ? anchorIndex : lines.length - 1;
  const before = lines.slice(0, insertIndex).join('\n').replace(/\n*$/, '');
  const after = lines.slice(insertIndex).join('\n').replace(/^\n*/, '');
  return [before, section.trimEnd(), after].filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

export function parseReleaseSection(changelog: string, version: string): { date: string; body: string; start: number; end: number; section: string } | undefined {
  const normalized = changelog.replace(/\r\n/g, '\n');
  const header = `## [${version}] - `;
  const start = normalized.indexOf(header);
  if (start < 0) return undefined;
  const bodyStart = normalized.indexOf('\n', start);
  if (bodyStart < 0) return undefined;
  const date = normalized.slice(start + header.length, bodyStart).trim();
  const rest = normalized.slice(bodyStart + 1);
  const nextHeader = rest.search(/^## \[/m);
  const body = (nextHeader >= 0 ? rest.slice(0, nextHeader) : rest).trimEnd();
  const end = nextHeader >= 0 ? bodyStart + 1 + nextHeader : normalized.length;
  return { date, body: body.trim(), start, end, section: normalized.slice(start, end).trimEnd() };
}

function validateReleaseRangeArgs(args: Pick<PrepareReleaseArgs, 'bump' | 'fromTag' | 'toTag'>): void {
  const hasRange = Boolean(args.fromTag || args.toTag);
  if ((args.fromTag && !args.toTag) || (!args.fromTag && args.toTag)) {
    throw new Error('--from and --to must be used together');
  }
  if (hasRange && args.bump !== 'patch') {
    throw new Error('--from/--to cannot be combined with --major/--minor/--patch');
  }
}

function appendSection(lines: string[], title: string, entries: string[]): void {
  if (!entries.length) return;
  lines.push(`### ${title}`);
  for (const entry of entries) {
    const separatorIndex = entry.indexOf(': ');
    if (separatorIndex > 0) {
      lines.push(`- **${entry.slice(0, separatorIndex)}**: ${entry.slice(separatorIndex + 2)}`);
    } else {
      lines.push(`- ${entry}`);
    }
  }
  lines.push('');
}

function parseSemver(tag: string): { major: number; minor: number; patch: number } {
  const match = tag.match(SEMVER_TAG);
  if (!match) throw new Error(`Invalid semver tag: ${tag}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function git(args: string[], cwd: string, exec: typeof execFileSync): string {
  return exec('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function gitSpawn(args: string[], cwd: string, spawn: typeof spawnSync, input?: string): void {
  const result = spawn('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], input });
  if (result.status !== 0) throw new Error((result.stderr ?? result.stdout ?? 'git command failed').trim());
}

function ensureCleanTree(cwd: string, spawn: typeof spawnSync): void {
  const result = spawn('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  if ((result.stdout ?? '').trim()) throw new Error('Working tree dirty; commit or stash changes first');
}

function readPackageVersion(cwd: string, readFile: typeof readFileSync): string {
  return JSON.parse(readFile(join(cwd, 'package.json'), 'utf-8')).version as string;
}

function writePackageVersion(cwd: string, version: string, readFile: typeof readFileSync, writeFile: typeof writeFileSync): void {
  const packagePath = join(cwd, 'package.json');
  const pkg = JSON.parse(readFile(packagePath, 'utf-8')) as Record<string, unknown>;
  pkg.version = version;
  writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
}

function collectPreScriptOutput(projectDir: string, prevTag: string, nextTag: string, deps: GitDeps): string {
  const sections: string[] = [];
  try {
    const log = deps.exec('git', ['log', '--pretty=format:%H||%s||%b', `${prevTag}..${nextTag === 'HEAD' ? 'HEAD' : 'HEAD'}`], { cwd: projectDir, encoding: 'utf-8' }) as string;
    sections.push(`git log:\n${log}`);
  } catch {
    sections.push('git log: <unavailable>');
  }
  try {
    const dateRaw = deps.exec('git', ['log', '-1', '--format=%cI', prevTag], { cwd: projectDir, encoding: 'utf-8' }) as string;
    const date = dateRaw.trim();
    const beads = deps.exec('bd', ['query', `closed_at >= "${date}"`], { cwd: projectDir, encoding: 'utf-8' }) as string;
    sections.push(`bd query (closed_at >= ${date}):\n${beads}`);
  } catch {
    sections.push('bd query: <unavailable>');
  }
  return sections.join('\n\n');
}

async function runKeeper(projectDir: string, prevTag: string, nextTag: string, deps: GitDeps): Promise<string> {
  const preScriptOutput = collectPreScriptOutput(projectDir, prevTag, nextTag, deps);
  const result = await deps.runScript({
    specialist: DEFAULT_RELEASE_SPECIALIST,
    variables: { prev_tag: prevTag, next_tag: nextTag, cwd: projectDir, pre_script_output: preScriptOutput },
    trace: true,
  }, { loader: deps.loader(projectDir), projectDir, observabilityDbPath: projectDir, trust: { allowLocalScripts: true } });
  if (!result.success) throw new Error(result.error ?? 'changelog-keeper failed');
  return result.output;
}

export async function prepareRelease(argv: string[] = process.argv.slice(3), injected: Partial<GitDeps> = {}): Promise<void> {
  const deps = { ...DEFAULT_DEPS, ...injected };
  const cwd = deps.cwd();
  const args = parseArgs(argv);
  const tags = git(['tag', '--list', 'v*'], cwd, deps.exec).split('\n').filter(Boolean);
  const prevTag = args.fromTag ?? getMostRecentSemverTag(tags);
  const nextTag = args.toTag ?? computeNextTag(prevTag, args.bump);
  const output = await runKeeper(cwd, prevTag ?? 'v0.0.0', nextTag, deps);
  const draft = extractReleaseDraft(output);
  if (!draft) throw new Error('Could not parse changelog-keeper JSON output');

  const changelogPath = join(cwd, 'CHANGELOG.md');
  const changelog = deps.readFile(changelogPath, 'utf-8');
  const section = buildReleaseSection(nextTag, deps.now().toISOString().slice(0, 10), draft);
  deps.writeFile(changelogPath, insertReleaseSection(changelog, section, args.insertAfter), 'utf-8');
  if (!args.fromTag && !args.toTag) writePackageVersion(cwd, nextTag.slice(1), deps.readFile, deps.writeFile);
  if (!args.fromTag && !args.toTag) gitSpawn(['add', 'CHANGELOG.md', 'package.json', 'dist/index.js'], cwd, deps.spawn);
  else gitSpawn(['add', 'CHANGELOG.md', 'dist/index.js'], cwd, deps.spawn);
  console.log(args.fromTag || args.toTag ? `Review staged changes, backfill with: git commit -m "release: ${nextTag}"` : `Review staged changes, commit with: git commit -m "release: ${nextTag}" then run sp release publish`);
}

export async function publishRelease(_argv: string[] = process.argv.slice(3), injected: Partial<GitDeps> = {}): Promise<void> {
  const deps = { ...DEFAULT_DEPS, ...injected };
  const cwd = deps.cwd();
  ensureCleanTree(cwd, deps.spawn);
  const commit = git(['log', '-1', '--pretty=%s'], cwd, deps.exec);
  const match = commit.match(/^release: v(\d+\.\d+\.\d+)$/);
  if (!match) throw new Error('HEAD commit message must match release: v<version>');
  const version = match[1];
  if (readPackageVersion(cwd, deps.readFile) !== version) throw new Error('package.json version must match release commit');
  const changelogPath = join(cwd, 'CHANGELOG.md');
  const changelog = deps.readFile(changelogPath, 'utf-8');
  const section = parseReleaseSection(changelog, `v${version}`);
  if (!section) throw new Error('CHANGELOG.md must contain top release section');
  const topRelease = validateTopReleaseSection(changelog, version);
  if (!topRelease) throw new Error(`CHANGELOG.md must have v${version} as first release after [Unreleased]`);

  gitSpawn(['tag', '-a', `v${version}`, '-m', section.body], cwd, deps.spawn);
  gitSpawn(['push', 'origin', `v${version}`], cwd, deps.spawn);

  const ghStatus = deps.spawn('gh', ['auth', 'status'], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (ghStatus.status === 0) {
    const ghRelease = deps.spawn('gh', ['release', 'create', `v${version}`, '--notes-file', '-'], { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], input: section.body });
    if (ghRelease.status !== 0) throw new Error((ghRelease.stderr ?? ghRelease.stdout ?? 'gh release create failed').trim());
  } else {
    console.log(`gh release create v${version} --notes-file -`);
  }

  deps.writeFile(changelogPath, replaceReleaseSection(changelog, section), 'utf-8');
  console.log(`Published v${version}`);
}

export async function run(argv: string[] = process.argv.slice(3)): Promise<void> {
  const [mode, ...rest] = argv;
  if (!mode || mode === '--help' || mode === '-h') {
    console.log(['', 'Usage: specialists release <prepare|publish> [--major|--minor|--patch]', '', 'Prepare changelog + version bump, or publish release tag.', ''].join('\n'));
    return;
  }
  if (mode === 'prepare') return prepareRelease(rest);
  if (mode === 'publish') return publishRelease(rest);
  throw new Error(`Unknown release mode: ${mode}`);
}

function validateTopReleaseSection(changelog: string, version: string): boolean {
  const normalized = changelog.replace(/\r\n/g, '\n');
  const unreleasedIndex = normalized.indexOf('## [Unreleased]');
  if (unreleasedIndex < 0) return false;
  const afterUnreleased = normalized.slice(unreleasedIndex + '## [Unreleased]'.length);
  const firstReleaseHeader = afterUnreleased.match(/^## \[(v?\d+\.\d+\.\d+)\] - /m)?.[1];
  return firstReleaseHeader === `v${version}`;
}

function replaceReleaseSection(changelog: string, section: { start: number; end: number; section: string }): string {
  const normalized = changelog.replace(/\r\n/g, '\n');
  const before = normalized.slice(0, section.start);
  const after = normalized.slice(section.end);
  return `${before}${section.section}${after}`.replace(/\n{3,}/g, '\n\n');
}

function readFlagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

export const releaseCli = { parseBumpKind, parseArgs, getMostRecentSemverTag, computeNextTag, buildReleaseSection, extractReleaseDraft, insertReleaseSection, parseReleaseSection };

