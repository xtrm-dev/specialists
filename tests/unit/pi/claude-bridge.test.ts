import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative as relativePath } from 'node:path';
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
import { tempDir } from '../../utils/temp-dir.js';

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
    const dir = tempDir('claude-bridge-');
    const entry = join(dir, 'index.js');
    writeFileSync(entry, 'export default () => {};\n');

    expect(resolveClaudeBridgeExtensionPath({ env: { [CLAUDE_BRIDGE_PATH_ENV]: entry } })).toBe(entry);
    expect(resolveClaudeBridgeExtensionPath({ env: { [CLAUDE_BRIDGE_PATH_ENV]: join(dir, 'gone.js') } })).toBeUndefined();
  });

  it('resolves a package entry through the layouts pi loads, including a mainless bridge', () => {
    const pkg = tempDir('claude-bridge-');
    // The bridge ships neither `main` nor `exports`; src/index.ts is its real entry.
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'pi-claude-bridge', type: 'module' }));
    mkdirSync(join(pkg, 'src'));
    writeFileSync(join(pkg, 'src', 'index.ts'), 'export default () => {};\n');

    expect(resolveClaudeBridgePackageEntry(pkg, path => existsSync(path))).toBe(join(pkg, 'src', 'index.ts'));
  });

  it('prefers a declared exports/main entry over the layout fallbacks', () => {
    const pkg = tempDir('claude-bridge-');
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
    const dir = tempDir('claude-bridge-');
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
    const project = tempDir('claude-bridge-');
    mkdirSync(join(project, '.specialists', 'user'), { recursive: true });
    writeFileSync(
      join(project, '.specialists', 'user', 'explorer.specialist.json'),
      // An explicit model keeps the case independent of any operator config: the shipped
      // `explorer` has `model: null`, and a machine with no global override would otherwise
      // fail here for an unrelated reason (found in CI, where no operator file exists).
      JSON.stringify({
        specialist: { execution: { claude_bridge: true, model: 'claude-bridge/claude-sonnet-5-5' } },
      }),
    );
    // homeDir deliberately points elsewhere: the repo layer alone must carry the flag.
    const loader = new SpecialistLoader({ projectDir: project, homeDir: tempDir('claude-bridge-') });
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
    const dir = tempDir('claude-bridge-');
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
    // Leaf path (claude_bridge.enabled): the block has several fields now, and naming the one at
    // fault is what makes the message actionable.
    expect(result.errors.some(error => error.path.startsWith(CLAUDE_BRIDGE_SWITCH_KEY))).toBe(true);
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
    expect(invalid.errors[0]?.path).toBe(`${CLAUDE_BRIDGE_SWITCH_KEY}.enabled`);
  });
});

describe('path hygiene (review finding 6)', () => {
  it('rejects a relative override instead of resolving it against the dispatch cwd', () => {
    const dir = tempDir('claude-bridge-');
    writeFileSync(join(dir, 'index.js'), 'export default () => {};\n');
    const relative = relativePath(process.cwd(), join(dir, 'index.js'));
    expect(resolveClaudeBridgeExtensionPath({ env: { [CLAUDE_BRIDGE_PATH_ENV]: relative } })).toBeUndefined();
  });

  it('rejects a manifest entry that escapes the package directory', () => {
    // CORE-2612: keep the escaping file inside the registered temp root instead
    // of writing evil.js directly into the OS temp dir.
    const root = tempDir('claude-bridge-');
    const pkg = join(root, 'pkg');
    mkdirSync(pkg, { recursive: true });
    const outside = join(pkg, '..', 'evil.js');
    writeFileSync(outside, 'export default () => {};\n');
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'pi-claude-bridge', main: '../evil.js' }));
    expect(resolveClaudeBridgePackageEntry(pkg, path => existsSync(path))).toBeUndefined();
    // An absolute env override is operator-owned and stays accepted: this rule is about the
    // package manifest, not about an operator naming an entry explicitly.
    expect(resolveClaudeBridgeExtensionPath({ env: { [CLAUDE_BRIDGE_PATH_ENV]: outside } })).toBe(outside);
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

  const ROOT_ENV_KEYS = ['PI_NPM_GLOBAL_DIR', 'NPM_CONFIG_PREFIX', 'npm_config_prefix', 'BUN_INSTALL', 'NVM_BIN'] as const;

  /**
   * Every resolver test runs with all environment roots neutralised AND a scratch interpreter
   * prefix, because the interpreter's own `lib/node_modules` is one of the roots. A test that reads
   * either ambient value is only deterministic on one machine.
   */
  function isolate<T>(fn: (scratchRoots: Record<string, string>) => T): T {
    const scratchRoots: Record<string, string> = {};
    for (const key of ROOT_ENV_KEYS) {
      scratchRoots[key] = key === 'NVM_BIN' ? join(tempDir('claude-bridge-'), 'bin') : tempDir('claude-bridge-');
    }
    const home = tempDir('claude-bridge-');
    // No process.env mutation: the scratch roots travel through deps, so a test cannot leak them
    // into the next one and an ambient variable cannot leak in.
    return fn({ ...scratchRoots, HOME: home, EXEC: join(tempDir('claude-bridge-'), 'bin', 'node') });
  }

  /** Default deps for a test: the scratch roots, home, interpreter, and real existence checks. */
  function deps(scratchRoots: Record<string, string>, env: NodeJS.ProcessEnv = {}) {
    const neutral: NodeJS.ProcessEnv = {};
    for (const key of ROOT_ENV_KEYS) neutral[key] = scratchRoots[key];
    return {
      env: { ...neutral, ...env },
      home: scratchRoots.HOME,
      execPath: scratchRoots.EXEC,
      exists: (path: string) => existsSync(path),
    };
  }

  function inRepo<T>(fn: (repo: string) => T): T {
    const previous = process.cwd();
    const repo = tempDir('claude-bridge-');
    process.chdir(repo);
    try {
      return fn(repo);
    } finally {
      process.chdir(previous);
    }
  }

  it('mirrors pi getAgentDir: PI_CODING_AGENT_DIR (tilde included), empty means default', () => {
    isolate(roots => {
      const home = roots.HOME;
      const d = (env: NodeJS.ProcessEnv) => deps(roots, env);
      expect(claudeBridgeAgentStoreDir(d({}))).toBe(join(home, '.pi', 'agent', 'npm', 'node_modules'));
      expect(claudeBridgeAgentStoreDir(d({ PI_CODING_AGENT_DIR: '~/relocated/agent' }))).toBe(
        join(home, 'relocated', 'agent', 'npm', 'node_modules'),
      );
      expect(claudeBridgeAgentStoreDir(d({ PI_CODING_AGENT_DIR: '/abs/agent' }))).toBe(
        join('/abs/agent', 'npm', 'node_modules'),
      );
      expect(claudeBridgeAgentStoreDir(d({ PI_CODING_AGENT_DIR: '' }))).toBe(
        join(home, '.pi', 'agent', 'npm', 'node_modules'),
      );
      expect(claudeBridgeAgentStoreDir(d({ PI_CODING_AGENT_DIR: '   ' }))).toBe(
        join(home, '.pi', 'agent', 'npm', 'node_modules'),
      );
      expect(claudeBridgeAgentDirSource(d({}))).toBe('default');
      expect(claudeBridgeAgentDirSource(d({ PI_CODING_AGENT_DIR: '  ' }))).toBe('default');
      expect(claudeBridgeAgentDirSource(d({ PI_CODING_AGENT_DIR: '~/x' }))).toBe('tilde');
      expect(claudeBridgeAgentDirSource(d({ PI_CODING_AGENT_DIR: '/x' }))).toBe('env');
      expect(claudeBridgeAgentDirSource(d({ PI_CODING_AGENT_DIR: '.pi/agent' }))).toBe('ignored-relative');
    });
  });

  it('resolves the package pi install wrote, with no env override', () => {
    isolate(roots => {
      const pkg = bridgePackage(join(roots.HOME, '.pi', 'agent', 'npm', 'node_modules'));
      expect(resolveClaudeBridgeExtensionPath(deps(roots))).toBe(join(pkg, 'src', 'index.ts'));
    });
  });

  it('never trusts the workspace: bridges in .pi/npm, .pi/agent/npm and node_modules do not resolve', () => {
    isolate(roots => {
      inRepo(repo => {
        bridgePackage(join(repo, '.pi', 'npm', 'node_modules'));
        bridgePackage(join(repo, '.pi', 'agent', 'npm', 'node_modules'));
        bridgePackage(join(repo, 'node_modules'));
        expect(claudeBridgePackageCandidates(deps(roots, {}))).toEqual([]);
        expect(resolveClaudeBridgeExtensionPath(deps(roots, {}))).toBeUndefined();
        expect(claudeBridgeSearchPaths(deps(roots, {})).some(path => path.startsWith(repo))).toBe(false);
      });
    });
  });

  it('ignores a relative PI_CODING_AGENT_DIR instead of resolving it against the cwd', () => {
    isolate(roots => {
      inRepo(repo => {
        bridgePackage(join(repo, '.pi', 'agent', 'npm', 'node_modules'));
        const env = { PI_CODING_AGENT_DIR: '.pi/agent' };
        expect(claudeBridgeAgentStoreDir(deps(roots, env))).toBe(join(roots.HOME, '.pi', 'agent', 'npm', 'node_modules'));
        expect(resolveClaudeBridgeExtensionPath(deps(roots, env))).toBeUndefined();
      });
    });
  });

  it('prefers the pi store over a global prefix (the store pi keeps current wins)', () => {
    isolate(roots => {
      const agentPkg = bridgePackage(join(roots.HOME, '.pi', 'agent', 'npm', 'node_modules'));
      const globalPkg = bridgePackage(roots.PI_NPM_GLOBAL_DIR);
      process.env.PI_NPM_GLOBAL_DIR = roots.PI_NPM_GLOBAL_DIR;
      expect(claudeBridgePackageCandidates(deps(roots, {}))).toEqual([
        agentPkg,
        join(roots.PI_NPM_GLOBAL_DIR, 'pi-claude-bridge'),
      ]);
      expect(resolveClaudeBridgeExtensionPath(deps(roots, {}))).toBe(join(agentPkg, 'src', 'index.ts'));
      void globalPkg;
    });
  });

  it('falls back to the global prefix when the pi store has no bridge', () => {
    isolate(roots => {
      const globalPkg = bridgePackage(roots.PI_NPM_GLOBAL_DIR);
      process.env.PI_NPM_GLOBAL_DIR = roots.PI_NPM_GLOBAL_DIR;
      expect(resolveClaudeBridgeExtensionPath(deps(roots, {}))).toBe(join(globalPkg, 'src', 'index.ts'));
    });
  });

  it('does not let a bare directory shadow a working global install', () => {
    isolate(roots => {
      const globalPkg = bridgePackage(roots.PI_NPM_GLOBAL_DIR);
      process.env.PI_NPM_GLOBAL_DIR = roots.PI_NPM_GLOBAL_DIR;
      mkdirSync(join(roots.HOME, '.pi', 'agent', 'npm', 'node_modules', 'pi-claude-bridge'), { recursive: true });
      expect(claudeBridgePackageCandidates(deps(roots, {}))).toEqual([join(roots.PI_NPM_GLOBAL_DIR, 'pi-claude-bridge')]);
      expect(resolveClaudeBridgeExtensionPath(deps(roots, {}))).toBe(join(globalPkg, 'src', 'index.ts'));
    });
  });

  it('does not let a manifest without a loadable entry shadow a working global install', () => {
    isolate(roots => {
      const globalPkg = bridgePackage(roots.PI_NPM_GLOBAL_DIR);
      process.env.PI_NPM_GLOBAL_DIR = roots.PI_NPM_GLOBAL_DIR;
      const brokenPkg = bridgePackage(join(roots.HOME, '.pi', 'agent', 'npm', 'node_modules'), '');
      expect(existsSync(join(brokenPkg, 'package.json'))).toBe(true);
      expect(claudeBridgePackageCandidates(deps(roots, {}))).toEqual([join(roots.PI_NPM_GLOBAL_DIR, 'pi-claude-bridge')]);
      expect(resolveClaudeBridgeExtensionPath(deps(roots, {}))).toBe(join(globalPkg, 'src', 'index.ts'));
    });
  });

  it('treats `~user/x` as relative, because pi expands only `~` and `~/`', () => {
    isolate(roots => {
      const env = (value: string) => ({ PI_CODING_AGENT_DIR: value });
      expect(claudeBridgeAgentDirSource(deps(roots, env('~')))).toBe('tilde');
      expect(claudeBridgeAgentDirSource(deps(roots, env('~/x')))).toBe('tilde');
      expect(claudeBridgeAgentDirSource(deps(roots, env('~other/x')))).toBe('ignored-relative');
      expect(claudeBridgeAgentStoreDir(deps(roots, env('~other/x')))).toBe(
        join(roots.HOME, '.pi', 'agent', 'npm', 'node_modules'),
      );
    });
  });

  it('drops a relative root from every environment variable, warning once per value', () => {
    isolate(roots => {
      inRepo(repo => {
        // A relative root is only DANGEROUS when it resolves, so the plants must exist: that is the
        // shape a repository can create under a dispatch cwd.
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
          const searched = claudeBridgeSearchPaths(deps(roots, env));
          expect(searched.every(path => isAbsolute(path))).toBe(true);
          expect(searched.some(path => path.startsWith(repo))).toBe(false);
          expect(resolveClaudeBridgeExtensionPath(deps(roots, env))).toBeUndefined();
        }
        expect(warnings.some(w => w.includes('package root is not absolute'))).toBe(true);
        const before = warnings.length;
        for (let i = 0; i < 3; i++) claudeBridgeSearchPaths(deps(roots, { BUN_INSTALL: '.' }));
        expect(warnings.length).toBe(before);
      });
    });
  });

  it('reads a bridge planted under each environment root, one root at a time', () => {
    isolate(roots => {
      const plants: Array<{ key: string; dir: string }> = [
        { key: 'PI_NPM_GLOBAL_DIR', dir: roots.PI_NPM_GLOBAL_DIR },
        { key: 'NPM_CONFIG_PREFIX', dir: join(roots.NPM_CONFIG_PREFIX, 'lib', 'node_modules') },
        { key: 'BUN_INSTALL', dir: join(roots.BUN_INSTALL, 'install', 'global', 'node_modules') },
        { key: 'NVM_BIN', dir: join(roots.NVM_BIN, '..', 'lib', 'node_modules') },
      ];
      for (const plant of plants) {
        rmSync(plant.dir, { recursive: true, force: true });
        const pkg = bridgePackage(plant.dir);
        expect(resolveClaudeBridgeExtensionPath(deps(roots, {}))).toBe(join(pkg, 'src', 'index.ts'));
        rmSync(plant.dir, { recursive: true, force: true });
      }
    });
  });

  it('reads a bridge under the scratch home .bun root (deps.home is honoured)', () => {
    isolate(roots => {
      const pkg = bridgePackage(join(roots.HOME, '.bun', 'install', 'global', 'node_modules'));
      expect(resolveClaudeBridgeExtensionPath(deps(roots, {}))).toBe(join(pkg, 'src', 'index.ts'));
    });
  });

  it('reads a bridge under the scratch interpreter prefix (deps.execPath is honoured)', () => {
    isolate(roots => {
      const prefix = dirname(dirname(roots.EXEC)); // <prefix>/bin/node -> <prefix>/lib/node_modules
      const pkg = bridgePackage(join(prefix, 'lib', 'node_modules'));
      expect(resolveClaudeBridgeExtensionPath(deps(roots, {}))).toBe(join(pkg, 'src', 'index.ts'));
    });
  });

  it('resolves through an injected filesystem: deps.exists and deps.readDir are both honoured', () => {
    // A virtual filesystem, so this can only pass if BOTH seams are forwarded: `readDir` supplies
    // the nvm version list and `exists` decides the manifest and entry without touching disk.
    const home = '/virtual/home';
    const versionRoot = '/virtual/home/.nvm/versions/node/v24.0.0/lib/node_modules';
    const pkg = join(versionRoot, 'pi-claude-bridge');
    const files = new Set([join(pkg, 'package.json'), join(pkg, 'src', 'index.ts')]);
    const deps = {
      env: {},
      home,
      execPath: '/virtual/bin/node',
      exists: (path: string) => files.has(path) || path.endsWith('node_modules'),
      readDir: (path: string) => (path === '/virtual/home/.nvm/versions/node' ? ['v24.0.0'] : []),
    };
    expect(resolveClaudeBridgeExtensionPath(deps)).toBe(join(pkg, 'src', 'index.ts'));
  });

  it('neutralisation leaves no machine root in the search list', () => {
    isolate(roots => {
      const searched = claudeBridgeSearchPaths(deps(roots, {}));
      expect(searched.length).toBeGreaterThan(0);
      const scratchPrefixes = [...Object.values(roots), tmpdir()];
      for (const path of searched) {
        expect(scratchPrefixes.some(prefix => path.startsWith(prefix))).toBe(true);
      }
    });
  });

  it('warns once when a relative agent dir is ignored, and never for a blank value', () => {
    isolate(roots => {
      const before = warnings.length;
      claudeBridgeAgentStoreDir(deps(roots, { PI_CODING_AGENT_DIR: 'relative-only-here' }));
      claudeBridgeAgentStoreDir(deps(roots, { PI_CODING_AGENT_DIR: 'relative-only-here' }));
      claudeBridgeAgentStoreDir(deps(roots, { PI_CODING_AGENT_DIR: '   ' }));
      const messages = warnings.slice(before).filter(w => w.includes('PI_CODING_AGENT_DIR is not absolute'));
      expect(messages).toHaveLength(1);
    });
  });
});

describe('claude_bridge_unavailable note (stale-text fix)', () => {
  it('names the install command, the store it lands in, and every path searched', () => {
    const home = tempDir('claude-bridge-');
    const deps = { env: {}, home, execPath: join(tempDir('claude-bridge-'), 'bin', 'node'), exists: (path: string) => existsSync(path) };
    const note = claudeBridgeUnavailableNote(deps);
    expect(note).toContain('pi install npm:pi-claude-bridge@0.12.0');
    expect(note).toContain(join(home, '.pi', 'agent', 'npm', 'node_modules'));
    expect(note).toContain('set SPECIALISTS_CLAUDE_BRIDGE_PATH');
    for (const searched of claudeBridgeSearchPaths(deps)) expect(note).toContain(searched);
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
