import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative as relativePath } from 'node:path';
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
    const pkg = tempDir();
    const outside = join(pkg, '..', 'evil.js');
    writeFileSync(outside, 'export default () => {};\n');
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'pi-claude-bridge', main: '../evil.js' }));
    expect(resolveClaudeBridgePackageEntry(pkg, path => existsSync(path))).toBeUndefined();
    // An absolute env override is operator-owned and stays accepted: this rule is about the
    // package manifest, not about an operator naming an entry explicitly.
    expect(resolveClaudeBridgeExtensionPath({ [CLAUDE_BRIDGE_PATH_ENV]: outside })).toBe(outside);
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
