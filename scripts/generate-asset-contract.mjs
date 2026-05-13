#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, 'dist', 'asset-contract.json');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const SCHEMA_VERSION = '1.0.0';

function getGeneratedAt() {
  try {
    return execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return new Date(0).toISOString();
  }
}

async function main() {
  const packageJson = JSON.parse(await readFile(PACKAGE_PATH, 'utf8'));
  const generatedAt = getGeneratedAt();

  const contract = {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    package_version: packageJson.version,
    shipped_skills: await collectFiles('config/skills', 'SKILL.md', async (filePath) => ({
      path: filePath,
      sha256: await sha256File(path.join(ROOT, filePath)),
    })),
    shipped_specialists: await collectFiles('config/specialists', '.specialist.json', (filePath) => ({
      path: filePath,
    })),
    shipped_mandatory_rules: await collectMandatoryRules(),
    shipped_catalogs: await collectFiles('config/catalog', '.json', (filePath) => ({
      path: filePath,
    })),
    shipped_nodes: await collectFiles('config/nodes', '.json', (filePath) => ({
      path: filePath,
    })),
    shipped_hooks: await collectFiles('config/hooks', '.mjs', (filePath) => ({
      path: filePath,
    })),
    notes: [
      'Cross-repo expectation: xtrm-tools validates this manifest against shipped assets on fresh install.',
      'Any new skill, specialist, rule, catalog, node, or hook must appear here before release.',
    ],
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
}

async function collectFiles(relativeDir, suffix, mapEntry) {
  const files = [];
  for await (const filePath of walk(relativeDir)) {
    if (filePath.endsWith(suffix)) {
      files.push(await mapEntry(filePath));
    }
  }
  files.sort(compareByPath);
  return files;
}

async function collectMandatoryRules() {
  const rules = [];
  for await (const filePath of walk('config/mandatory-rules')) {
    if (filePath.endsWith('.md') || filePath.endsWith('index.json')) {
      rules.push({ path: filePath });
    }
  }
  rules.sort(compareByPath);
  return rules;
}

async function* walk(relativeDir) {
  const absoluteDir = path.join(ROOT, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(relativePath);
      continue;
    }
    if (entry.isFile()) {
      yield relativePath;
    }
  }
}

async function sha256File(filePath) {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function compareByPath(left, right) {
  return left.path.localeCompare(right.path);
}

await main();
