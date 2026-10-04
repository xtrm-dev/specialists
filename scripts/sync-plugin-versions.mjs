#!/usr/bin/env node
// Set every Claude Code plugin's version to the package version (SPECIALISTS-4254).
//
// Claude Code keys the plugin cache and `claude plugin update` on plugin.json "version".
// A version that never moves makes every update a no-op, so changed skills, hooks and
// scripts only arrive after an uninstall and reinstall. package.json is the one source
// of truth; the npm `version` hook runs this and stages the result.
//
//   node scripts/sync-plugin-versions.mjs [--check]
//     --check  exit 1 if any plugin.json differs from package.json, write nothing
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const check = process.argv.includes('--check');

const pluginsDir = join(root, 'plugins');
const drifted = [];
for (const name of readdirSync(pluginsDir)) {
  const manifest = join(pluginsDir, name, '.claude-plugin', 'plugin.json');
  if (!existsSync(manifest)) continue;
  const text = readFileSync(manifest, 'utf8');
  const plugin = JSON.parse(text);
  if (plugin.version === version) continue;
  drifted.push(`${name}: ${plugin.version} -> ${version}`);
  if (!check) {
    plugin.version = version;
    writeFileSync(manifest, `${JSON.stringify(plugin, null, 2)}\n`);
  }
}

if (check && drifted.length > 0) {
  console.error(`plugin versions differ from package.json:\n  ${drifted.join('\n  ')}`);
  process.exit(1);
}
for (const line of drifted) console.log(line);
