import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';


import { NativeActivationHost } from '../../../src/activation/native-host.js';
import {
  resetRuntimeDiagnosticsSink,
  runtimeDiagnosticsSinkPath,
  runtimeWarn,
} from '../../../src/utils/runtime-diagnostics.js';
import { tempDir } from '../../utils/temp-dir.js';

// Regression guard for the measured defect: a native activation runs the runtime INSIDE
// the coordinator's Pi process, so one console.debug in the model chain drew
// `[model-chain] plural fallback_models wins; ...` across the operator's statusline.
// The host is the in-process boundary, so constructing it must move runtime diagnostics
// off stdio and onto a file before any activation can warn.
describe('in-process runtime diagnostics', () => {
  afterEach(() => {
    resetRuntimeDiagnosticsSink();
    vi.restoreAllMocks();
  });

  it('a native host redirects runtime warnings away from stdio', () => {
    const cwd = tempDir('host-diagnostics-');
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      new NativeActivationHost({ cwd });

      runtimeWarn('probe', 'in-process warning');

      expect(write).not.toHaveBeenCalled();
      expect(readFileSync(runtimeDiagnosticsSinkPath(cwd), 'utf8')).toContain(
        '[WARN] [probe] in-process warning',
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
