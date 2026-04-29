import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { SpecialistLoader } from '../specialist/loader.js';
import { runScriptSpecialist } from '../specialist/script-runner.js';

type BumpKind = 'major' | 'minor' | 'patch';

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
  if (!jsonText) return undefined;
  try {
    return JSON.parse(jsonText) as ReleaseDraft;
  } catch {
    return undefined;
  }
}

export function insertReleaseSection(changelog: string, section: string): string {
  const normalized = changelog.replace(/\r\n/g, '\n');
  const version = section.match(/^## \[(v?\d+\.\d+\.\d+)\]/m)?.[1];
  if (!version) throw new Error('Release section must start with version header');
  const existingSection = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\] - .*?(?=^## \\[[^\n]+\\] - |\\z)`, 'ms');
  const withoutDuplicate = normalized.replace(existingSection, '').replace(/\n{3,}/g, '\n\n');
  const lines = withoutDuplicate.split('\n');
  const unreleasedIndex = lines.findIndex((line) => line.trim() === '## [Unreleased]');
  if (unreleasedIndex < 0) throw new Error('Missing [Unreleased] section in CHANGELOG.md');
  const nextVersionIndex = lines.findIndex((line, index) => index > unreleasedIndex && RELEASE_HEADER.test(line));
  const insertIndex = nextVersionIndex >= 0 ? nextVersionIndex : lines.length - 1;
  const before = lines.slice(0, insertIndex).join('\n').replace(/\n*$/, '');
  const after = lines.slice(insertIndex).join('\n').replace(/^\n*/, '');
  return [before, section.trimEnd(), after].filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

export function parseReleaseSection(changelog: string, version: string): { date: string; body: string } | undefined {
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
  return { date, body: body.trim() };
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

async function runKeeper(projectDir: string, prevTag: string, nextTag: string, deps: GitDeps): Promise<string> {
  const result = await deps.runScript({
    specialist: DEFAULT_RELEASE_SPECIALIST,
    variables: { prev_tag: prevTag, next_tag: nextTag },
    trace: true,
  }, { loader: deps.loader(projectDir), projectDir, observabilityDbPath: projectDir });
  if (!result.success) throw new Error(result.error ?? 'changelog-keeper failed');
  return result.output;
}

export async function prepareRelease(argv: string[] = process.argv.slice(3), injected: Partial<GitDeps> = {}): Promise<void> {
  const deps = { ...DEFAULT_DEPS, ...injected };
  const cwd = deps.cwd();
  const bump = parseBumpKind(argv);
  const tags = git(['tag', '--list', 'v*'], cwd, deps.exec).split('\n').filter(Boolean);
  const prevTag = getMostRecentSemverTag(tags);
  const nextTag = computeNextTag(prevTag, bump);
  const output = await runKeeper(cwd, prevTag ?? 'v0.0.0', nextTag, deps);
  const draft = extractReleaseDraft(output);
  if (!draft) throw new Error('Could not parse changelog-keeper JSON output');

  const changelogPath = join(cwd, 'CHANGELOG.md');
  const changelog = deps.readFile(changelogPath, 'utf-8');
  const section = buildReleaseSection(nextTag, deps.now().toISOString().slice(0, 10), draft);
  deps.writeFile(changelogPath, insertReleaseSection(changelog, section), 'utf-8');
  writePackageVersion(cwd, nextTag.slice(1), deps.readFile, deps.writeFile);
  gitSpawn(['add', 'CHANGELOG.md', 'package.json', 'dist/index.js'], cwd, deps.spawn);
  console.log(`Review staged changes, commit with: git commit -m "release: ${nextTag}" then run sp release publish`);
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

  gitSpawn(['tag', '-a', `v${version}`, '-m', section.body], cwd, deps.spawn);
  gitSpawn(['push', 'origin', `v${version}`], cwd, deps.spawn);

  const ghStatus = deps.spawn('gh', ['auth', 'status'], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (ghStatus.status === 0) {
    const ghRelease = deps.spawn('gh', ['release', 'create', `v${version}`, '--notes-file', '-'], { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], input: section.body });
    if (ghRelease.status !== 0) throw new Error((ghRelease.stderr ?? ghRelease.stdout ?? 'gh release create failed').trim());
  } else {
    console.log(`gh release create v${version} --notes-file -`);
  }

  deps.writeFile(changelogPath, changelog.replace(section.body, '').replace(/\n{3,}/g, '\n\n'), 'utf-8');
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

export const releaseCli = { parseBumpKind, getMostRecentSemverTag, computeNextTag, buildReleaseSection, extractReleaseDraft, insertReleaseSection, parseReleaseSection };
