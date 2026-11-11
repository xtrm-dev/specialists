import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative as relativePath } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  CLAUDE_BRIDGE_PATH_ENV,
  CLAUDE_BRIDGE_PROVIDER,
  claudeBridgeEnabled,
  claudeBridgeExtensionProviders,
  claudeBridgeRouteEnabled,
  claudeBridgeSessionOption,
  operatorClaudeBridgeEnabled,
} from '../../../src/pi/claude-bridge.js';
import {
  buildSpecialistOverrideTemplate,
  CLAUDE_BRIDGE_SWITCH_KEY,
  validateGlobalUserConfig,
} from '../../../src/specialist/global-config.js';
import { SpecialistLoader } from '../../../src/specialist/loader.js';
import {
  claudeBridgeAgentDirSource,
  claudeBridgeAgentStoreDir,
  claudeBridgePackageCandidates,
  claudeBridgeSearchPaths,
  claudeBridgeUnavailableNote,
  resolveClaudeBridgeExtensionPath,
  resolveClaudeBridgePackageEntry,
  resolveCuratedExtensionPaths,
} from '../../../src/pi/session.js';
import { ExecutionSchema } from '../../../src/specialist/schema.js';

/**
 * The opt-in Claude Code route (SPECIALISTS-4405). Two properties matter more than the plumbing:
 * the flag must be OFF unless a definition says otherwise, and an enabled flag whose extension is
 * missing must be distinguishable from "not enabled" so the host can refuse instead of running.
 */

/**
 * runtimeWarn is the only signal that a misconfigured root was ignored, so it is spied on rather
 * than assumed: removing the call must fail a test, not pass silently.
 */
const warnings = vi.hoisted(() => [] as string[]);
vi.mock('../../../src/utils/runtime-diagnostics.js', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    runtimeWarn: (_tag: string, message: string) => {
      warnings.push(message);
    },
  };
});

const scratch: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-bridge-'));
  scratch.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('claudeBridgeEnabled / claudeBridgeExtensionProviders', () => {
  it('is off by default and for every non-true value', () => {
    expect(claudeBridgeEnabled(undefined)).toBe(false);
    expect(claudeBridgeEnabled({})).toBe(false);
    expect(claudeBridgeEnabled({ claude_bridge: false })).toBe(false);
    expect(claudeBridgeEnabled({ claude_bridge: 'true' })).toBe(false);
  });

  it('names the provider only when the RESOLVED route is on', () => {
    expect(claudeBridgeExtensionProviders(false)).toEqual([]);
    expect(claudeBridgeExtensionProviders(true)).toEqual([CLAUDE_BRIDGE_PROVIDER]);
  });
});

describe('resolveClaudeBridgeExtensionPath', () => {
  it('honours an explicit entry and reports a stale one as absent', () => {
    const dir = tempDir();
    const entry = join(dir, 'index.js');
    writeFileSync(entry, 'export default () => {};\n');

    expect(resolveClaudeBridgeExtensionPath({ [CLAUDE_BRIDGE_PATH_ENV]: entry })).toBe(entry);
    expect(resolveClaudeBridgeExtensionPath({ [CLAUDE_BRIDGE_PATH_ENV]: join(dir, 'gone.js') })).toBeUndefined();
  });

  it('resolves a package entry through the layouts pi loads, including a mainless bridge', () => {
    const pkg = tempDir();
    // The bridge ships neither `main` nor `exports`; src/index.ts is its real entry.
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'pi-claude-bridge', type: 'module' }));
    mkdirSync(join(pkg, 'src'));
    writeFileSync(join(pkg, 'src', 'index.ts'), 'export default () => {};\n');

    expect(resolveClaudeBridgePackageEntry(pkg, path => existsSync(path))).toBe(join(pkg, 'src', 'index.ts'));
  });

  it('prefers a declared exports/main entry over the layout fallbacks', () => {
    const pkg = tempDir();
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: 'pi-claude-bridge', exports: { '.': { import: './dist/main.js' } } }),
    );
    mkdirSync(join(pkg, 'dist'));
    writeFileSync(join(pkg, 'dist', 'main.js'), 'export default () => {};\n');

    expect(resolveClaudeBridgePackageEntry(pkg, path => existsSync(path))).toBe(join(pkg, 'dist', 'main.js'));
  });
});

describe('resolveCuratedExtensionPaths', () => {
  it('adds nothing when the flag is off — the default install needs no bridge', () => {
    const resolution = resolveCuratedExtensionPaths({ permissionLevel: 'HIGH' });
    expect(resolution.claudeBridgePath).toBeUndefined();
    expect(resolution.all.some(path => path.includes('pi-claude-bridge'))).toBe(false);
  });

  it('adds the resolved entry to `all` when the flag is on and the extension is installed', () => {
    const dir = tempDir();
    const entry = join(dir, 'index.js');
    writeFileSync(entry, 'export default () => {};\n');
    const previous = process.env[CLAUDE_BRIDGE_PATH_ENV];
    process.env[CLAUDE_BRIDGE_PATH_ENV] = entry;
    try {
      const resolution = resolveCuratedExtensionPaths({ permissionLevel: 'HIGH', claudeBridge: true });
      expect(resolution.claudeBridgePath).toBe(entry);
      expect(resolution.all).toContain(entry);
    } finally {
      if (previous === undefined) delete process.env[CLAUDE_BRIDGE_PATH_ENV];
      else process.env[CLAUDE_BRIDGE_PATH_ENV] = previous;
    }
  });

  it('reports the flag as unsatisfied rather than silently dropping it when the extension is missing', () => {
    const previous = process.env[CLAUDE_BRIDGE_PATH_ENV];
    process.env[CLAUDE_BRIDGE_PATH_ENV] = '/nonexistent/pi-claude-bridge/index.js';
    try {
      const resolution = resolveCuratedExtensionPaths({ permissionLevel: 'HIGH', claudeBridge: true });
      expect(resolution.claudeBridgePath).toBeUndefined();
      expect(resolution.all).not.toContain('/nonexistent/pi-claude-bridge/index.js');
    } finally {
      if (previous === undefined) delete process.env[CLAUDE_BRIDGE_PATH_ENV];
      else process.env[CLAUDE_BRIDGE_PATH_ENV] = previous;
    }
  });
});

describe('execution.claude_bridge definition field', () => {
  it('defaults to false and accepts true', () => {
    const base = { model: null };
    expect(ExecutionSchema.parse(base).claude_bridge).toBe(false);
    expect(ExecutionSchema.parse({ ...base, claude_bridge: true }).claude_bridge).toBe(true);
  });

  it('is reproducible from a repository layer, which is exactly why the operator switch exists', async () => {
    // Measured, not asserted from a list: a repo can write the definition flag into its own
    // `.specialists/user` layer, and the loader honours it. Finding 1 of the #526 review is that
    // this must NOT be enough to load the route — see claudeBridgeRouteEnabled below.
    const project = tempDir();
    mkdirSync(join(project, '.specialists', 'user'), { recursive: true });
    writeFileSync(
      join(project, '.specialists', 'user', 'explorer.specialist.json'),
      JSON.stringify({ specialist: { execution: { claude_bridge: true } } }),
    );
    // homeDir deliberately points elsewhere: the repo layer alone must carry the flag.
    const loader = new SpecialistLoader({ projectDir: project, homeDir: tempDir() });
    const spec = await loader.get('explorer');
    expect(spec.specialist.execution.claude_bridge).toBe(true);
    // The definition says yes; the machine has not. The route stays OFF.
    expect(claudeBridgeRouteEnabled(spec.specialist.execution, () => false)).toBe(false);
  });
});

/**
 * The operator half of the route switch (review finding 1). A repository can write the definition
 * flag; it cannot write `~/.config/specialists/user.json`. Both halves are required, and every
 * degraded input is OFF — an unreadable or malformed switch must never enable a billing surface.
 */
describe('operatorClaudeBridgeEnabled', () => {
  function withUserConfig(contents: string | null) {
    const dir = tempDir();
    const file = join(dir, 'user.json');
    if (contents !== null) writeFileSync(file, contents);
    return { path: file, exists: contents !== null, source: 'config-home' as const };
  }

  it('is true only for the exact shape', () => {
    expect(operatorClaudeBridgeEnabled(withUserConfig(JSON.stringify({ [CLAUDE_BRIDGE_SWITCH_KEY]: { enabled: true } })))).toBe(true);
    expect(operatorClaudeBridgeEnabled(withUserConfig(JSON.stringify({ [CLAUDE_BRIDGE_SWITCH_KEY]: { enabled: false } })))).toBe(false);
    expect(operatorClaudeBridgeEnabled(withUserConfig(JSON.stringify({ [CLAUDE_BRIDGE_SWITCH_KEY]: { enabled: 'true' } })))).toBe(false);
    expect(operatorClaudeBridgeEnabled(withUserConfig(JSON.stringify({ [CLAUDE_BRIDGE_SWITCH_KEY]: true })))).toBe(false);
    expect(operatorClaudeBridgeEnabled(withUserConfig(JSON.stringify({})))).toBe(false);
  });

  it('fails closed when the file is absent, unreadable or malformed', () => {
    expect(operatorClaudeBridgeEnabled(withUserConfig(null))).toBe(false);
    expect(operatorClaudeBridgeEnabled(withUserConfig('{not json'))).toBe(false);
    expect(operatorClaudeBridgeEnabled(
      { path: '/nonexistent/user.json', exists: true, source: 'config-home' },
    )).toBe(false);
    expect(operatorClaudeBridgeEnabled(withUserConfig('[]'))).toBe(false);
  });

  it('agrees with the validator about unknown keys: invalid input never enables the route', () => {
    const contents = JSON.stringify({ [CLAUDE_BRIDGE_SWITCH_KEY]: { enabled: true, foo: 1 } });
    const location = withUserConfig(contents);
    expect(validateGlobalUserConfig(contents).valid).toBe(false);
    expect(operatorClaudeBridgeEnabled(location)).toBe(false);
  });

  it('keeps the switch error when the rest of the file is also invalid', () => {
    const result = validateGlobalUserConfig(JSON.stringify({
      [CLAUDE_BRIDGE_SWITCH_KEY]: { enabled: 'yes' },
      explorer: { execution: { model: 'not-a-number' } },
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.path === CLAUDE_BRIDGE_SWITCH_KEY)).toBe(true);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it('requires both halves, and the definition alone never enables the route', () => {
    expect(claudeBridgeRouteEnabled({ claude_bridge: true }, () => false)).toBe(false);
    expect(claudeBridgeRouteEnabled({}, () => true)).toBe(false);
    expect(claudeBridgeRouteEnabled({ claude_bridge: true }, () => true)).toBe(true);
  });
});

describe('the switch key in the global user config', () => {
  it('is reserved: it does not invalidate the Specialist overrides next to it', () => {
    const valid = validateGlobalUserConfig(JSON.stringify({
      [CLAUDE_BRIDGE_SWITCH_KEY]: { enabled: true },
      explorer: buildSpecialistOverrideTemplate(),
    }));
    expect(valid).toEqual({ valid: true, errors: [] });
  });

  it('reports a malformed switch instead of silently ignoring it', () => {
    const invalid = validateGlobalUserConfig(JSON.stringify({
      [CLAUDE_BRIDGE_SWITCH_KEY]: { enabled: 'yes' },
    }));
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0]?.path).toBe(CLAUDE_BRIDGE_SWITCH_KEY);
  });
});

describe('path hygiene (review finding 6)', () => {
  it('rejects a relative override instead of resolving it against the dispatch cwd', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'index.js'), 'export default () => {};\n');
    const relative = relativePath(process.cwd(), join(dir, 'index.js'));
    expect(resolveClaudeBridgeExtensionPath({ [CLAUDE_BRIDGE_PATH_ENV]: relative })).toBeUndefined();
  });

  it('rejects a manifest entry that escapes the package directory', () => {
    // CORE-2612: keep the escaping file inside the registered temp root instead
    // of writing evil.js directly into the OS temp dir.
    const root = tempDir();
    const pkg = join(root, 'pkg');
    mkdirSync(pkg, { recursive: true });
    const outside = join(pkg, '..', 'evil.js');
    writeFileSync(outside, 'export default () => {};\n');
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'pi-claude-bridge', main: '../evil.js' }));
    expect(resolveClaudeBridgePackageEntry(pkg, path => existsSync(path))).toBeUndefined();
    // An absolute env override is operator-owned and stays accepted: this rule is about the
    // package manifest, not about an operator naming an entry explicitly.
    expect(resolveClaudeBridgeExtensionPath({ [CLAUDE_BRIDGE_PATH_ENV]: outside })).toBe(outside);
  });
});

describe('pi store resolution (A2: `pi install` must satisfy the resolver)', () => {
  /** A store root holding a mainless bridge package, exactly like the published npm package. */
  function bridgePackage(root: string, entry = 'src/index.ts'): string {
    const pkg = join(root, 'pi-claude-bridge');
    mkdirSync(join(pkg, 'src'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'pi-claude-bridge', type: 'module' }));
    if (entry) writeFileSync(join(pkg, entry), 'export default () => {};\n');
    return pkg;
  }

  /** Run `fn` with the process cwd set to a scratch repository, restored afterwards. */
  function inRepo<T>(fn: (repo: string) => T): T {
    const previous = process.cwd();
    const repo = tempDir();
    process.chdir(repo);
    try {
      return fn(repo);
    } finally {
      process.chdir(previous);
    }
  }

  /**
   * Neutralise EVERY root the resolver reads from the environment, not just the one that happened
   * to break: a test that leaves BUN_INSTALL or an npm prefix pointing at a machine root passes
   * here and fails on another machine. `execPath`-derived roots cannot be neutralised, which is why
   * the planted-bridge test below also plants under an absolute root and asserts it is found.
   */
  const ROOT_ENV_KEYS = ['PI_NPM_GLOBAL_DIR', 'NPM_CONFIG_PREFIX', 'npm_config_prefix', 'BUN_INSTALL', 'NVM_BIN'] as const;
  function withNeutralRoots<T>(fn: (roots: Record<string, string>) => T): T {
    const roots: Record<string, string> = {};
    const previous: Record<string, string | undefined> = {};
    for (const key of ROOT_ENV_KEYS) {
      previous[key] = process.env[key];
      // A directory that exists but holds nothing is the neutral value for every root.
      roots[key] = key === 'NVM_BIN' ? join(tempDir(), 'bin') : tempDir();
      process.env[key] = roots[key];
    }
    try {
      return fn(roots);
    } finally {
      for (const key of ROOT_ENV_KEYS) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  }

  it('mirrors pi getAgentDir: PI_CODING_AGENT_DIR (tilde included), empty means default', () => {
    const home = tempDir();
    expect(claudeBridgeAgentStoreDir({}, home)).toBe(join(home, '.pi', 'agent', 'npm', 'node_modules'));
    expect(claudeBridgeAgentStoreDir({ PI_CODING_AGENT_DIR: '~/relocated/agent' }, home)).toBe(
      join(home, 'relocated', 'agent', 'npm', 'node_modules'),
    );
    expect(claudeBridgeAgentStoreDir({ PI_CODING_AGENT_DIR: '/abs/agent' }, home)).toBe(
      join('/abs/agent', 'npm', 'node_modules'),
    );
    // An empty or blank value is not a location; pi falls back to its default directory.
    expect(claudeBridgeAgentStoreDir({ PI_CODING_AGENT_DIR: '' }, home)).toBe(
      join(home, '.pi', 'agent', 'npm', 'node_modules'),
    );
    expect(claudeBridgeAgentStoreDir({ PI_CODING_AGENT_DIR: '   ' }, home)).toBe(
      join(home, '.pi', 'agent', 'npm', 'node_modules'),
    );
    // Blank is "unset", not "a broken path": it must not be reported as ignored input.
    expect(claudeBridgeAgentDirSource({}, home)).toBe('default');
    expect(claudeBridgeAgentDirSource({ PI_CODING_AGENT_DIR: '  ' }, home)).toBe('default');
    expect(claudeBridgeAgentDirSource({ PI_CODING_AGENT_DIR: '~/x' }, home)).toBe('tilde');
    expect(claudeBridgeAgentDirSource({ PI_CODING_AGENT_DIR: '/x' }, home)).toBe('env');
    expect(claudeBridgeAgentDirSource({ PI_CODING_AGENT_DIR: '.pi/agent' }, home)).toBe('ignored-relative');
  });

  it('resolves the package pi install wrote, with no env override', () => {
    const home = tempDir();
    const pkg = bridgePackage(join(home, '.pi', 'agent', 'npm', 'node_modules'));
    expect(resolveClaudeBridgeExtensionPath({}, path => existsSync(path), home)).toBe(join(pkg, 'src', 'index.ts'));
  });

  it('never trusts the workspace: bridges in .pi/npm, .pi/agent/npm and node_modules do not resolve', () => {
    // The plants are in the CWD, which is the whole point: this test must go red the moment someone
    // adds a `process.cwd()`-derived candidate to the resolver.
    const home = tempDir();
    inRepo(repo => {
      bridgePackage(join(repo, '.pi', 'npm', 'node_modules'));
      bridgePackage(join(repo, '.pi', 'agent', 'npm', 'node_modules'));
      bridgePackage(join(repo, 'node_modules'));
      withNeutralRoots(() => {
        expect(claudeBridgePackageCandidates({}, path => existsSync(path), home)).toEqual([]);
        expect(resolveClaudeBridgeExtensionPath({}, path => existsSync(path), home)).toBeUndefined();
        expect(claudeBridgeSearchPaths({}, home).some(path => path.startsWith(repo))).toBe(false);
      });
    });
  });

  it('ignores a relative PI_CODING_AGENT_DIR instead of resolving it against the cwd', () => {
    const home = tempDir();
    inRepo(repo => {
      bridgePackage(join(repo, '.pi', 'agent', 'npm', 'node_modules'));
      withNeutralRoots(() => {
        expect(claudeBridgeAgentStoreDir({ PI_CODING_AGENT_DIR: '.pi/agent' }, home)).toBe(
          join(home, '.pi', 'agent', 'npm', 'node_modules'),
        );
        expect(resolveClaudeBridgeExtensionPath({ PI_CODING_AGENT_DIR: '.pi/agent' }, path => existsSync(path), home))
          .toBeUndefined();
      });
    });
  });

  it('prefers the pi store over a global prefix (the store pi keeps current wins)', () => {
    const home = tempDir();
    const globalRoot = tempDir();
    const agentPkg = bridgePackage(join(home, '.pi', 'agent', 'npm', 'node_modules'));
    bridgePackage(globalRoot);
    const previous = process.env.PI_NPM_GLOBAL_DIR;
    process.env.PI_NPM_GLOBAL_DIR = globalRoot;
    try {
      expect(claudeBridgePackageCandidates({}, path => existsSync(path), home)).toEqual([
        agentPkg,
        join(globalRoot, 'pi-claude-bridge'),
      ]);
      expect(resolveClaudeBridgeExtensionPath({}, path => existsSync(path), home)).toBe(join(agentPkg, 'src', 'index.ts'));
    } finally {
      if (previous === undefined) delete process.env.PI_NPM_GLOBAL_DIR;
      else process.env.PI_NPM_GLOBAL_DIR = previous;
    }
  });

  it('falls back to the global prefix when the pi store has no bridge', () => {
    const home = tempDir();
    const globalRoot = tempDir();
    const globalPkg = bridgePackage(globalRoot);
    const previous = process.env.PI_NPM_GLOBAL_DIR;
    process.env.PI_NPM_GLOBAL_DIR = globalRoot;
    try {
      expect(resolveClaudeBridgeExtensionPath({}, path => existsSync(path), home)).toBe(join(globalPkg, 'src', 'index.ts'));
    } finally {
      if (previous === undefined) delete process.env.PI_NPM_GLOBAL_DIR;
      else process.env.PI_NPM_GLOBAL_DIR = previous;
    }
  });

  it('does not let a bare directory shadow a working global install', () => {
    const home = tempDir();
    const globalRoot = tempDir();
    const globalPkg = bridgePackage(globalRoot);
    // A directory with the right name and no manifest is not a package.
    mkdirSync(join(home, '.pi', 'agent', 'npm', 'node_modules', 'pi-claude-bridge'), { recursive: true });
    const previous = process.env.PI_NPM_GLOBAL_DIR;
    process.env.PI_NPM_GLOBAL_DIR = globalRoot;
    try {
      // The bare directory must not even be a candidate: existence is judged by manifest + entry.
      expect(claudeBridgePackageCandidates({}, path => existsSync(path), home)).toEqual([
        join(globalRoot, 'pi-claude-bridge'),
      ]);
      expect(resolveClaudeBridgeExtensionPath({}, path => existsSync(path), home)).toBe(join(globalPkg, 'src', 'index.ts'));
    } finally {
      if (previous === undefined) delete process.env.PI_NPM_GLOBAL_DIR;
      else process.env.PI_NPM_GLOBAL_DIR = previous;
    }
  });

  it('treats `~user/x` as relative, because pi expands only `~` and `~/`', () => {
    const home = tempDir();
    expect(claudeBridgeAgentDirSource({ PI_CODING_AGENT_DIR: '~' }, home)).toBe('tilde');
    expect(claudeBridgeAgentDirSource({ PI_CODING_AGENT_DIR: '~/x' }, home)).toBe('tilde');
    expect(claudeBridgeAgentDirSource({ PI_CODING_AGENT_DIR: '~other/x' }, home)).toBe('ignored-relative');
    expect(claudeBridgeAgentStoreDir({ PI_CODING_AGENT_DIR: '~other/x' }, home)).toBe(
      join(home, '.pi', 'agent', 'npm', 'node_modules'),
    );
  });

  it('drops a relative root from every environment variable, warning once per value', () => {
    const home = tempDir();
    inRepo(repo => {
      // A relative root is only DANGEROUS when it resolves, so the planted directories must exist:
      // that is the shape a repository can create under a dispatch cwd.
      mkdirSync(join(repo, '.pi', 'agent', 'npm', 'node_modules'), { recursive: true });
      mkdirSync(join(repo, 'lib', 'node_modules'), { recursive: true });
      mkdirSync(join(repo, 'install', 'global', 'node_modules'), { recursive: true });
      mkdirSync(join(repo, 'bin'), { recursive: true });

      const cases: Array<[string, string]> = [
        ['PI_NPM_GLOBAL_DIR', '.pi/agent/npm/node_modules'],
        ['NPM_CONFIG_PREFIX', '.'],
        ['npm_config_prefix', '.'],
        ['BUN_INSTALL', '.'],
        ['NVM_BIN', './bin'],
      ];
      for (const [key, value] of cases) {
        const env = { [key]: value };
        const searched = claudeBridgeSearchPaths(env, home);
        expect(searched.every(path => isAbsolute(path))).toBe(true);
        expect(searched.some(path => path.startsWith(repo))).toBe(false);
        expect(resolveClaudeBridgeExtensionPath(env, path => existsSync(path), home)).toBeUndefined();
      }
      expect(warnings.some(w => w.includes('package root is not absolute'))).toBe(true);
      // Per value, not per call: repeating one bad root must not add a warning.
      const before = warnings.length;
      for (let i = 0; i < 3; i++) claudeBridgeSearchPaths({ BUN_INSTALL: '.' }, home);
      expect(warnings.length).toBe(before);
    });
  });

  it('reads a bridge planted under each environment root, one root at a time', () => {
    const home = tempDir();
    const plants: Array<{ key: string; root: (scratch: string) => string; sub: string[] }> = [
      { key: 'PI_NPM_GLOBAL_DIR', root: scratch => scratch, sub: [] },
      { key: 'NPM_CONFIG_PREFIX', root: scratch => scratch, sub: ['lib', 'node_modules'] },
      { key: 'BUN_INSTALL', root: scratch => scratch, sub: ['install', 'global', 'node_modules'] },
      { key: 'NVM_BIN', root: scratch => join(scratch, 'bin'), sub: [] },
    ];
    for (const plant of plants) {
      withNeutralRoots(roots => {
        const scratch = tempDir();
        const root = plant.sub.length > 0 || plant.key === 'PI_NPM_GLOBAL_DIR'
          ? join(plant.root(scratch), ...plant.sub)
          : join(plant.root(scratch), '..', 'lib', 'node_modules');
        const pkg = bridgePackage(root);
        // The root under test points at the plant; every other root stays neutral.
        process.env[plant.key] = plant.key === 'NVM_BIN' ? join(scratch, 'bin') : scratch;
        expect(resolveClaudeBridgeExtensionPath({}, path => existsSync(path), home)).toBe(join(pkg, 'src', 'index.ts'));
        void roots;
      });
    }
  });

  it('neutralisation leaves no machine root in the search list', () => {
    const home = tempDir();
    withNeutralRoots(() => {
      const searched = claudeBridgeSearchPaths({}, home);
      expect(searched.length).toBeGreaterThan(0);
      // Everything searched must live under the scratch home or a scratch root, never under the
      // operator's real directories.
      for (const path of searched) {
        expect(path.startsWith(home) || path.startsWith('/tmp/')).toBe(true);
        expect(path.startsWith(process.env.HOME ?? '/nonexistent-home')).toBe(false);
      }
    });
  });

  it('warns once when a relative agent dir is ignored, and never for a blank value', () => {
    const home = tempDir();
    const before = warnings.length;
    claudeBridgeAgentStoreDir({ PI_CODING_AGENT_DIR: 'relative-only-here' }, home);
    claudeBridgeAgentStoreDir({ PI_CODING_AGENT_DIR: 'relative-only-here' }, home);
    claudeBridgeAgentStoreDir({ PI_CODING_AGENT_DIR: '   ' }, home);
    const messages = warnings.slice(before).filter(w => w.includes('PI_CODING_AGENT_DIR is not absolute'));
    expect(messages).toHaveLength(1);
  });

  it('does not let a manifest without a loadable entry shadow a working global install', () => {
    const home = tempDir();
    const globalRoot = tempDir();
    const globalPkg = bridgePackage(globalRoot);
    // package.json present, entry files absent: the store copy cannot load, so it must not win.
    const brokenPkg = bridgePackage(join(home, '.pi', 'agent', 'npm', 'node_modules'), '');
    expect(existsSync(join(brokenPkg, 'package.json'))).toBe(true);
    const previous = process.env.PI_NPM_GLOBAL_DIR;
    process.env.PI_NPM_GLOBAL_DIR = globalRoot;
    try {
      expect(claudeBridgePackageCandidates({}, path => existsSync(path), home)).toEqual([join(globalRoot, 'pi-claude-bridge')]);
      expect(resolveClaudeBridgeExtensionPath({}, path => existsSync(path), home)).toBe(join(globalPkg, 'src', 'index.ts'));
    } finally {
      if (previous === undefined) delete process.env.PI_NPM_GLOBAL_DIR;
      else process.env.PI_NPM_GLOBAL_DIR = previous;
    }
  });
});

describe('claude_bridge_unavailable note (stale-text fix)', () => {
  it('names the install command, the store it lands in, and every path searched', () => {
    const home = tempDir();
    const note = claudeBridgeUnavailableNote({}, home);
    expect(note).toContain('pi install npm:pi-claude-bridge@0.12.0');
    expect(note).toContain(join(home, '.pi', 'agent', 'npm', 'node_modules'));
    expect(note).toContain('set SPECIALISTS_CLAUDE_BRIDGE_PATH');
    for (const searched of claudeBridgeSearchPaths({}, home)) expect(note).toContain(searched);
    // The old wording promised a "global package" that pi install never writes.
    expect(note).not.toContain('global package');
  });
});

describe('legacy call-site wiring', () => {
  it('builds the session option from the definition alone, leaving the operator check to start()', () => {
    expect(claudeBridgeSessionOption({})).toEqual({});
    expect(claudeBridgeSessionOption({ claude_bridge: false })).toEqual({});
    expect(claudeBridgeSessionOption({ claude_bridge: true })).toEqual({ claudeBridge: true });
  });

  it('is used by both legacy call sites, so the runner and the script-runner cannot drift', () => {
    // A wiring assertion, not a behavioural one: executing either legacy runner needs a live pi
    // process. The behaviour of the fragment itself is covered above, and the operator half is
    // covered at `PiAgentSession.start` in claude-bridge-legacy-path.test.ts.
    for (const file of ['src/specialist/runner.ts', 'src/specialist/script-runner.ts']) {
      const source = readFileSync(join(process.cwd(), file), 'utf-8');
      expect(source).toContain('claudeBridgeSessionOption(');
      expect(source).not.toContain("execution.claude_bridge === true ? { claudeBridge: true }");
    }
  });
});
