#!/usr/bin/env node
// specialists plugin MCP launcher.
//
// Resolves the runtime that ships WITH this plugin, then imports it. No argv: the
// entrypoint starts MCP server mode when given no subcommand.
//
// Local-first is load-bearing, not a style choice. `../../../dist/index.js` is correct in
// BOTH supported layouts — a --plugin-dir checkout (repo/plugins/specialists/scripts) and an
// npm install (node_modules/@jaggerxtrm/specialists/plugins/specialists/scripts) — so the
// plugin's own build is always the right answer. Asking the package name first is what
// broke: under bun, `require.resolve('@jaggerxtrm/specialists')` from a plugin directory
// with no local node_modules resolves into bun's GLOBAL INSTALL CACHE
// (~/.bun/install/cache/@jaggerxtrm/specialists@<ver>/dist/index.js), silently serving a
// stale published runtime whose tool surface predates this plugin (unitAI-aiwva.2).
//
// A MARKETPLACE install is the third layout, and neither check above reaches it: Claude Code
// copies only the plugin folder to ~/.claude/plugins/cache/<marketplace>/specialists/<ver>/, so
// `../../../dist` never exists, and bun's package-name resolution does not search the npm
// global prefix where `npm install -g @jaggerxtrm/specialists` put the runtime
// (SPECIALISTS-4225). The global-prefix candidates mirror resolveSubstrateFromGlobalPrefix in
// src/activation/workitem-store.ts, without a child process: this runs on every session start.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RUNTIME = join('@jaggerxtrm', 'specialists', 'dist', 'index.js');

/** Global `node_modules` directories that may hold the runtime, most specific first. */
function globalModuleDirs(env = process.env, execPath = process.execPath, home = homedir()) {
  const dirs = [];
  if (env.npm_config_prefix) dirs.push(join(env.npm_config_prefix, 'lib', 'node_modules'));
  // The prefix of each npm on PATH: nvm's per-version prefix, a system or user prefix.
  for (const bin of String(env.PATH ?? '').split(delimiter)) {
    if (bin && existsSync(join(bin, 'npm'))) dirs.push(join(dirname(bin), 'lib', 'node_modules'));
  }
  dirs.push(join(dirname(dirname(execPath)), 'lib', 'node_modules'));
  // Bun's global install root, which is neither `<prefix>/lib` nor seen by the node walk.
  dirs.push(join(home, '.bun', 'install', 'global', 'node_modules'));
  return [...new Set(dirs)];
}

function resolveRuntime(searched = []) {
  // The runtime shipped alongside this plugin: a --plugin-dir checkout or an npm install.
  const local = fileURLToPath(new URL('../../../dist/index.js', import.meta.url));
  searched.push(local);
  if (existsSync(local)) return local;
  // Only when the plugin is installed apart from its runtime.
  try {
    return require.resolve('@jaggerxtrm/specialists');
  } catch {
    searched.push('require.resolve(@jaggerxtrm/specialists)');
  }
  // A marketplace install beside a globally installed runtime.
  for (const dir of globalModuleDirs()) {
    const candidate = join(dir, RUNTIME);
    searched.push(candidate);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const searched = [];
const entry = resolveRuntime(searched);
if (!entry) {
  console.error(
    'specialists plugin: cannot locate the specialists runtime (Bun runtime required).\n' +
      'Install Bun from https://bun.sh (tested with bun 1.3.14), then ' +
      'install @jaggerxtrm/specialists, or run the plugin from a built checkout ' +
      '(bun run build) so dist/index.js exists.\n' +
      `Searched:\n  ${searched.join('\n  ')}`,
  );
  process.exit(1);
}

await import(entry);
