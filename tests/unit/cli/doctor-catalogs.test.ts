// tests/unit/cli/doctor-catalogs.test.ts
// SPECIALISTS-47: `specialists doctor --catalogs [--require-installed]`, the focused section the
// scheduled CI job runs. Hermetic: installs are fake package.json files under a temp directory that
// PI_NPM_GLOBAL_DIR points at, so the result never depends on what this machine has installed (the
// SPECIALISTS-24 class). The catalog itself is the repository's real config/catalog/index.json.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const catalog = JSON.parse(readFileSync(join(process.cwd(), 'config/catalog/index.json'), 'utf8')) as {
  catalogs: Array<{ catalog: string; package?: string; version: string }>;
};
const pins = catalog.catalogs.filter((c) => c.catalog !== 'native' && c.package);

/**
 * 'ahead' stays inside the caret line (a higher patch); 'break' leaves it. Which part breaks depends
 * on the baseline's line: a new major for >=1.x, a new minor for 0.x. Deriving it keeps the test
 * independent of the pins and their order in the catalog.
 */
function bump(version: string, kind: 'ahead' | 'break'): string {
  const [major, minor, patch] = version.split('.').map(Number);
  if (kind === 'ahead') return `${major}.${minor}.${patch! + 9}`;
  return major! > 0 ? `${major! + 1}.0.0` : `0.${minor! + 1}.0`;
}

describe('doctor --catalogs (SPECIALISTS-47)', () => {
  let globalDir: string;
  let previousGlobal: string | undefined;
  let output: string[];

  const install = (pkg: string, version: string): void => {
    const dir = join(globalDir, ...pkg.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg, version }));
  };

  async function runDoctor(argv: string[]): Promise<number> {
    const { run } = await import('../../../src/cli/doctor.js');
    process.exitCode = undefined;
    await run(argv);
    const code = Number(process.exitCode ?? 0);
    process.exitCode = undefined;
    return code;
  }

  beforeEach(() => {
    globalDir = mkdtempSync(join(tmpdir(), 'doctor-catalogs-global-'));
    previousGlobal = process.env.PI_NPM_GLOBAL_DIR;
    process.env.PI_NPM_GLOBAL_DIR = globalDir;
    output = [];
    const capture = (msg?: unknown): void => { output.push(String(msg ?? '')); };
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
  });

  afterEach(() => {
    if (previousGlobal === undefined) delete process.env.PI_NPM_GLOBAL_DIR;
    else process.env.PI_NPM_GLOBAL_DIR = previousGlobal;
    vi.restoreAllMocks();
    rmSync(globalDir, { recursive: true, force: true });
  });

  it('the repository catalog declares extension pins to check', () => {
    expect(pins.length).toBeGreaterThan(0);
  });

  it('treats an absent extension as information by default, so a machine without it is not broken', async () => {
    expect(await runDoctor(['--catalogs'])).toBe(0);
  });

  it('fails with --require-installed when an extension is not where the runtime resolves it', async () => {
    // The silent pass this flag removes: CI installed the packages somewhere else, every catalog
    // read `absent`, and the section passed having verified nothing.
    expect(await runDoctor(['--catalogs', '--require-installed'])).toBe(1);
    expect(output.join('\n')).toMatch(/not found where the runtime resolves installed extensions/);
  });

  it('passes with --require-installed when every pin is installed at its baseline', async () => {
    for (const pin of pins) install(pin.package!, pin.version);
    expect(await runDoctor(['--catalogs', '--require-installed'])).toBe(0);
  });

  it('reports an install ahead of the baseline as information without failing', async () => {
    for (const pin of pins) install(pin.package!, pin.version);
    const [first] = pins;
    install(first!.package!, bump(first!.version, 'ahead'));
    expect(await runDoctor(['--catalogs', '--require-installed'])).toBe(0);
    expect(output.join('\n')).toMatch(/ahead of baseline/);
  });

  it('fails when an installed extension is outside the pin\'s compatibility line', async () => {
    for (const pin of pins) install(pin.package!, pin.version);
    const [first] = pins;
    install(first!.package!, bump(first!.version, 'break'));
    expect(await runDoctor(['--catalogs', '--require-installed'])).toBe(1);
    expect(output.join('\n')).toMatch(/outside the compatible range/);
  });

  it('refuses --require-installed without --catalogs rather than silently ignoring it', async () => {
    await expect(runDoctor(['--require-installed'])).rejects.toThrow(/only applies to --catalogs/);
  });
});
