// tests/unit/specialist/runner-script-exec.test.ts
// Real-execution contract for runScript: no child_process mocks. Proves stdout
// and stderr are captured on success and failure, exit status is exact, and
// spawn errors/timeouts are represented (unitAI-x64ys).
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { extractPreScriptErrorLine, findRequiredPreScriptFailure, formatRequiredPreScriptFailure, runScript, sanitizeDisplayName, sanitizeScriptName, scriptDisplayName } from '../../../src/specialist/runner.js';

const cwd = tmpdir();

describe('runScript execution contract', () => {
  it('captures exact nonzero exit code', () => {
    const result = runScript('exit 7', cwd);
    expect(result.exitCode).toBe(7);
  });

  it('captures stdout and stderr on success', () => {
    const result = runScript('echo out-line; echo err-line 1>&2', cwd);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('out-line');
    expect(result.stderr).toContain('err-line');
  });

  it('captures stdout and stderr on failure', () => {
    const result = runScript('echo to-stdout; echo to-stderr 1>&2; exit 4', cwd);
    expect(result.exitCode).toBe(4);
    expect(result.output).toContain('to-stdout');
    expect(result.stderr).toContain('to-stderr');
  });

  it('keeps stderr-only failures visible', () => {
    const result = runScript('echo boom 1>&2; exit 1', cwd);
    expect(result.exitCode).toBe(1);
    expect(result.output.trim()).toBe('');
    expect(result.stderr).toContain('boom');
  });

  it('represents spawn errors without leaking the host path', () => {
    const hostPath = '/definitely-not-a-real-cwd-xyz';
    const result = runScript('echo hi', hostPath);
    expect(result.exitCode).not.toBe(0);
    expect(result.spawnError).toBe('ENOENT');
    expect(result.stderr).toContain('spawn error: ENOENT');
    expect(result.stderr).not.toContain(hostPath);
  });

  it('bounds attacker/script output via maxBuffer truncation', () => {
    const result = runScript('yes 0123456789 | head -c 20000000', cwd);
    expect(result.exitCode).not.toBe(0);
    expect(result.output.length).toBeLessThanOrEqual(1024 * 1024 + 2);
  });

  it('threads a human-readable label through to the rejection without changing the derived name', () => {
    const result = runScript('exit 3', cwd, 'service-knowledge scope+drift');
    expect(result.name).toBe('exit');
    expect(result.displayName).toBe('service-knowledge scope+drift');
    const failure = findRequiredPreScriptFailure(
      [{ phase: 'pre', required: true, label: 'service-knowledge scope+drift' }],
      [result],
    );
    expect(failure?.displayName).toBe('service-knowledge scope+drift');
    expect(formatRequiredPreScriptFailure(failure!)).toContain("'service-knowledge scope+drift'");
  });

  it('falls back to the derived name when no label is provided', () => {
    const result = runScript('exit 3', cwd);
    expect(result.displayName).toBeUndefined();
    const failure = findRequiredPreScriptFailure([{ phase: 'pre', required: true }], [result]);
    expect(failure?.displayName).toBeUndefined();
    expect(formatRequiredPreScriptFailure(failure!).split('\n')[0]).toBe(
      "Required pre-script 'exit' failed with exit code 3.",
    );
  });

  it('surfaces the PRE_SCRIPT_ERROR line even when head-truncated stdout would hide it', () => {
    const stdout = `${'PRE_SCRIPT_SCOPE: filler\n'.repeat(500)}PRE_SCRIPT_ERROR: ERROR: drift_detector.py failed with exit_code=3\nPRE_SCRIPT_DATA_END\n`;
    const text = formatRequiredPreScriptFailure({
      name: ':',
      displayName: 'service-knowledge scope+drift',
      exitCode: 1,
      stdout,
      stderr: '',
    });
    expect(text).toContain("'service-knowledge scope+drift'");
    expect(text).not.toContain("pre-script ':'");
    expect(text).toContain('Cause: PRE_SCRIPT_ERROR: ERROR: drift_detector.py failed with exit_code=3');
    expect(extractPreScriptErrorLine(stdout, '')).toBe(
      'PRE_SCRIPT_ERROR: ERROR: drift_detector.py failed with exit_code=3',
    );
    expect(extractPreScriptErrorLine('no envelope here', '')).toBeNull();
  });

  it('sanitizes human-readable labels without rejecting spaces or plus signs', () => {
    expect(sanitizeDisplayName('service-knowledge scope+drift')).toBe('service-knowledge scope+drift');
    expect(sanitizeDisplayName('  padded  ')).toBe('padded');
    expect(sanitizeDisplayName('\x00\x1b')).toBe('unknown');
    expect(sanitizeDisplayName('x'.repeat(500)).length).toBe(128);
    expect(scriptDisplayName({ label: 'service-knowledge scope+drift' })).toBe('service-knowledge scope+drift');
    expect(scriptDisplayName({ phase: 'pre' })).toBeUndefined();
    expect(scriptDisplayName(null)).toBeUndefined();
  });

  it('renders control-safe bounded script names', () => {
    expect(sanitizeScriptName('check.sh')).toBe('check.sh');
    expect(sanitizeScriptName(':')).toBe(':');
    expect(sanitizeScriptName('bad\x1b[31m"na<me>')).toBe('unknown');
    expect(sanitizeScriptName('bad\u009b31mname')).toBe('bad31mname');
    expect(sanitizeScriptName('TOKEN=secret')).toBe('unknown');
    expect(sanitizeScriptName('x'.repeat(500)).length).toBe(128);
    expect(sanitizeScriptName('\x00\x01')).toBe('unknown');
  });
});
