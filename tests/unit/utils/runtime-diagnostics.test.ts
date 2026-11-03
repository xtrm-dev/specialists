import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFileDiagnosticsSink,
  resetRuntimeDiagnosticsSink,
  runtimeDebug,
  runtimeDiagnosticsSinkPath,
  runtimeWarn,
  setRuntimeDiagnosticsSink,
} from '../../../src/utils/runtime-diagnostics.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('runtime diagnostics sink', () => {
  afterEach(() => {
    resetRuntimeDiagnosticsSink();
    delete process.env.DEBUG;
    vi.restoreAllMocks();
  });

  it('writes to stderr by default, so CLI behaviour is unchanged', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    runtimeWarn('model-chain', 'plural fallback_models wins');

    expect(write).toHaveBeenCalledWith('[WARN] [model-chain] plural fallback_models wins\n');
  });

  it('routes a warning to the installed sink and never to stdio', () => {
    const lines: string[] = [];
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setRuntimeDiagnosticsSink((line) => lines.push(line));

    runtimeWarn('workspace-lease', 'no "origin" remote');

    expect(lines).toEqual(['[WARN] [workspace-lease] no "origin" remote']);
    expect(write).not.toHaveBeenCalled();
  });

  it('discards warnings when the sink is null', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setRuntimeDiagnosticsSink(null);

    runtimeWarn('beads', 'bd CLI not found');

    expect(write).not.toHaveBeenCalled();
  });

  it('keeps debug lines behind DEBUG', () => {
    const lines: string[] = [];
    setRuntimeDiagnosticsSink((line) => lines.push(line));

    runtimeDebug('model-chain', 'gated');
    expect(lines).toEqual([]);

    process.env.DEBUG = '1';
    runtimeDebug('model-chain', 'gated');
    expect(lines).toEqual(['[DEBUG] [model-chain] gated']);
  });

  it('appends to the canonical file sink, creating the directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'runtime-diagnostics-'));
    try {
      const path = runtimeDiagnosticsSinkPath(root);
      const sink = createFileDiagnosticsSink(path);

      sink('[WARN] [x] first');
      sink('[WARN] [x] second');

      const written = readFileSync(path, 'utf8');
      expect(written).toContain('[WARN] [x] first');
      expect(written).toContain('[WARN] [x] second');
      expect(written.trim().split('\n')).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never throws when the sink path is unwritable', () => {
    const root = mkdtempSync(join(tmpdir(), 'runtime-diagnostics-bad-'));
    try {
      const file = join(root, 'not-a-directory');
      writeFileSync(file, 'x');
      const sink = createFileDiagnosticsSink(join(file, 'nested', 'runtime-diagnostics.log'));

      expect(() => sink('[WARN] [x] swallowed')).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
