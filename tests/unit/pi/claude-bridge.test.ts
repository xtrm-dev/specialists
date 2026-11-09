import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLAUDE_BRIDGE_PATH_ENV,
  CLAUDE_BRIDGE_PROVIDER,
  claudeBridgeEnabled,
  claudeBridgeExtensionProviders,
} from '../../../src/pi/claude-bridge.js';
import {
  resolveClaudeBridgeExtensionPath,
  resolveClaudeBridgePackageEntry,
  resolveCuratedExtensionPaths,
} from '../../../src/pi/session.js';
import { ExecutionSchema, OVERRIDE_ALLOWED_EXECUTION_FIELDS } from '../../../src/specialist/schema.js';

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

  it('names the provider only when the flag is on', () => {
    expect(claudeBridgeExtensionProviders({})).toEqual([]);
    expect(claudeBridgeExtensionProviders({ claude_bridge: true })).toEqual([CLAUDE_BRIDGE_PROVIDER]);
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

  it('is override-allowed so the operator enables it in their own layer, never in a shipped definition', () => {
    expect(OVERRIDE_ALLOWED_EXECUTION_FIELDS).toContain('claude_bridge');
  });
});
