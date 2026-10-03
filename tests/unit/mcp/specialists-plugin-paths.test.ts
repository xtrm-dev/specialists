import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Wave E1 path discipline (specialists plugin design §6): plugin-owned paths must
 * be ${CLAUDE_PLUGIN_ROOT}-rooted, the §B forbidden substrings must not appear,
 * and .mcp.json must carry no env block (design §5 correction).
 */
const PLUGIN_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'plugins',
  'specialists',
);

function read(rel: string): string {
  return readFileSync(join(PLUGIN_ROOT, rel), 'utf-8');
}

const JSON_FILES = ['hooks/hooks.json', '.mcp.json'];
const SCRIPT_FILES = [
  'scripts/mcp-server.mjs',
  'scripts/session-start.mjs',
  'scripts/precompact.mjs',
  'scripts/postcompact.mjs',
];

describe('specialists plugin path discipline', () => {
  it('registers every plugin-owned entrypoint through ${CLAUDE_PLUGIN_ROOT}', () => {
    const hooks = read('hooks/hooks.json');
    expect(hooks).toContain('${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs');
    expect(hooks).toContain('${CLAUDE_PLUGIN_ROOT}/scripts/precompact.mjs');
    expect(hooks).toContain('${CLAUDE_PLUGIN_ROOT}/scripts/postcompact.mjs');
    expect(read('.mcp.json')).toContain('${CLAUDE_PLUGIN_ROOT}/scripts/mcp-server.mjs');
  });

  it('contains none of the forbidden path substrings', () => {
    const forbidden = [
      'CLAUDE_PROJECT_DIR}/packages', // §B named anti-pattern
      'packages/substrate/integrations', // repo-checkout-relative layout
      'process.cwd()', // cwd fallback for plugin-owned assets
      '"./scripts/', // relative hook/MCP entrypoints
      "'./scripts/",
    ];
    for (const rel of [...JSON_FILES, ...SCRIPT_FILES]) {
      const text = read(rel);
      for (const bad of forbidden) {
        expect(text, `${rel} contains forbidden ${bad}`).not.toContain(bad);
      }
    }
  });

  it('.mcp.json declares no env key', () => {
    const parsed: unknown = JSON.parse(read('.mcp.json'));
    const keys: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          keys.push(k);
          walk(v);
        }
      }
    };
    walk(parsed);
    expect(keys).not.toContain('env');
  });

  it('pins the Bun runtime for the MCP server and every hook command', () => {
    const mcp = JSON.parse(read('.mcp.json')) as {
      mcpServers: Record<string, { command: string }>;
    };
    expect(mcp.mcpServers.specialists.command).toBe('bun');
    const hooks = JSON.parse(read('hooks/hooks.json')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command?: string }> }>>;
    };
    const commands: string[] = [];
    for (const entries of Object.values(hooks.hooks)) {
      for (const entry of entries) {
        for (const hook of entry.hooks) {
          if (hook.command) commands.push(hook.command);
        }
      }
    }
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command.startsWith('bun '), `hook command pins bun: ${command}`).toBe(true);
    }
  });

  it('declares its MCP server in the manifest so Claude wires .mcp.json', () => {
    // Without this field Claude Code loads the plugin, validates it, and never
    // connects the server: the session sees zero specialists tools (unitAI-aiwva.2).
    const manifest = JSON.parse(read('.claude-plugin/plugin.json')) as Record<string, unknown>;
    expect(manifest.mcpServers).toBe('./.mcp.json');
  });

  it('resolves the plugin-local runtime before the package name', () => {
    // Package-name-first lets bun resolve into its global install cache and serve a
    // stale published runtime with an older tool surface (unitAI-aiwva.2).
    // Comment prose names both, so compare the code only.
    const launcher = read('scripts/mcp-server.mjs')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    const localAt = launcher.indexOf("'../../../dist/index.js'");
    const packageAt = launcher.indexOf("require.resolve('@jaggerxtrm/specialists')");
    expect(localAt).toBeGreaterThan(-1);
    expect(packageAt).toBeGreaterThan(-1);
    expect(localAt).toBeLessThan(packageAt);
  });

  it('is obtainable: the marketplace manifest offers the plugin at its own path', () => {
    // Without a marketplace entry nothing installs the plugin — the only way in is a
    // hand-typed --plugin-dir, so "works for a user" cannot be true (unitAI-aiwva.22).
    const marketplacePath = join(PLUGIN_ROOT, '..', '..', '.claude-plugin', 'marketplace.json');
    const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf-8')) as {
      name: string;
      description?: string;
      plugins: Array<{ name: string; source: string }>;
    };
    expect(marketplace.description, 'strict validate rejects a marketplace with no description').toBeTruthy();
    const entry = marketplace.plugins.find((candidate) => candidate.name === 'specialists');
    expect(entry, 'marketplace must offer the specialists plugin').toBeDefined();
    expect(entry?.source).toBe('./plugins/specialists');
    // The entry must point at the manifest we actually ship.
    const manifest = JSON.parse(read('.claude-plugin/plugin.json')) as { name: string };
    expect(entry?.name).toBe(manifest.name);
  });
});

/**
 * A marketplace install copies only the plugin folder into Claude Code's cache, so the
 * launcher's `../../../dist` never exists there and bun's package-name resolution does not
 * search the npm global prefix (SPECIALISTS-4225). Run the real launcher from a
 * cache-shaped copy against a fake global prefix; HOME and bun's cache are isolated so no
 * real runtime is ever found and started.
 */
describe('specialists plugin launcher in a marketplace install', () => {
  const BUN = basename(process.execPath).startsWith('bun') ? process.execPath : 'bun';

  function cacheShapedLauncher(root: string): string {
    const scripts = join(root, 'plugins', 'cache', 'xtrm', 'specialists', '0.1.0', 'scripts');
    mkdirSync(scripts, { recursive: true });
    copyFileSync(join(PLUGIN_ROOT, 'scripts', 'mcp-server.mjs'), join(scripts, 'mcp-server.mjs'));
    return join(scripts, 'mcp-server.mjs');
  }

  function launch(root: string, launcher: string, extraPath: string[]) {
    // --no-install: bun's default auto-install would fetch the published runtime from npm
    // at the package-name step and start it, which is neither offline nor what is tested.
    return spawnSync(BUN, ['--no-install', launcher], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 15_000,
      env: {
        PATH: [...extraPath, dirname(BUN)].join(delimiter),
        HOME: root,
        BUN_INSTALL_CACHE_DIR: join(root, 'bun-cache'),
      },
    });
  }

  it('starts the runtime installed under the prefix of the npm on PATH', () => {
    const root = mkdtempSync(join(tmpdir(), 'sp-launcher-'));
    try {
      const launcher = cacheShapedLauncher(root);
      const prefix = join(root, 'nvm', 'v25');
      mkdirSync(join(prefix, 'bin'), { recursive: true });
      writeFileSync(join(prefix, 'bin', 'npm'), '');
      const dist = join(prefix, 'lib', 'node_modules', '@jaggerxtrm', 'specialists', 'dist');
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, 'index.js'), "console.log('FAKE_RUNTIME_STARTED');\n");

      const run = launch(root, launcher, [join(prefix, 'bin')]);
      expect(run.stderr).toBe('');
      expect(run.stdout).toContain('FAKE_RUNTIME_STARTED');
      expect(run.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('names every location it searched when no runtime exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'sp-launcher-'));
    try {
      const launcher = cacheShapedLauncher(root);
      const run = launch(root, launcher, []);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('cannot locate the specialists runtime');
      expect(run.stderr).toContain('Searched:');
      expect(run.stderr).toContain(join(root, '.bun', 'install', 'global', 'node_modules'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
