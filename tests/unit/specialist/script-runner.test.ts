import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STDOUT_LIMIT_BYTES,
  collectModelCandidates,
  classifyAttempt,
  compatGuard,
  isRetryableModelFailure,
  renderTaskTemplate,
  resolveStdoutLimitBytes,
  runScriptSpecialist,
} from '../../../src/specialist/script-runner.js';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

const baseSpec = {
  specialist: {
    execution: {
      interactive: false,
      requires_worktree: false,
      permission_required: 'READ_ONLY',
      model: 'anthropic/claude-sonnet-4-6',
      fallback_model: 'google-gemini-cli/gemini-3.1-pro-preview',
      timeout_ms: 1000,
      response_format: 'markdown',
      output_type: 'synthesis',
    },
    prompt: {
      task_template: 'draft $name',
      output_schema: { type: 'object', required: ['unreleased_summary', 'sections'] },
    },
    skills: { scripts: [] },
  },
} as const;

afterEach(() => {
  spawnMock.mockReset();
  delete process.env.SPECIALISTS_SCRIPT_STDOUT_LIMIT_BYTES;
});

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

function makeLoader(spec = baseSpec) {
  return {
    get: vi.fn().mockResolvedValue(spec),
  };
}

function createSpawnMock(): FakeChild {
  const child = new FakeChild();
  spawnMock.mockReturnValue(child as never);
  return child;
}

describe('script-runner compat guard', () => {
  it('rejects interactive specialist', () => {
    expect(() => compatGuard({ ...baseSpec, specialist: { ...baseSpec.specialist, execution: { ...baseSpec.specialist.execution, interactive: true } } } as never)).toThrow('interactive');
  });

  it('rejects worktree specialist', () => {
    expect(() => compatGuard({ ...baseSpec, specialist: { ...baseSpec.specialist, execution: { ...baseSpec.specialist.execution, requires_worktree: true } } } as never)).toThrow('worktree');
  });

  it('rejects non read only specialist', () => {
    expect(() => compatGuard({ ...baseSpec, specialist: { ...baseSpec.specialist, execution: { ...baseSpec.specialist.execution, permission_required: 'LOW' } } } as never)).toThrow('permission_required');
  });

  it('rejects scripted specialist', () => {
    expect(() => compatGuard({ ...baseSpec, specialist: { ...baseSpec.specialist, skills: { scripts: [{ run: 'echo hi', phase: 'pre', inject_output: false }] } } } as never)).toThrow('scripts not allowed');
  });
});

describe('template render', () => {
  it('throws on missing variable', () => {
    expect(() => renderTaskTemplate('hello $name', {})).toThrow('Missing template variable: name');
  });

  it('ignores literal $tokens in substituted values', () => {
    expect(renderTaskTemplate('release $name', { name: 'notes with $prev_tag and $next_tag' })).toBe('release notes with $prev_tag and $next_tag');
  });

  it('still throws when template references unknown variable', () => {
    expect(() => renderTaskTemplate('hello $name and $missing', { name: 'world' })).toThrow('Missing template variable: missing');
  });
});

describe('runScriptSpecialist fallback chain', () => {
  it('advances to fallback_model after empty assistant output', () => {
    const spec = baseSpec as never;
    const candidates = collectModelCandidates(
      { specialist: 'changelog-keeper' },
      spec,
      { fallbackModel: 'nano-gpt/moonshotai/kimi-k2.5' },
    );

    expect(candidates).toEqual([
      'anthropic/claude-sonnet-4-6',
      'google-gemini-cli/gemini-3.1-pro-preview',
      'nano-gpt/moonshotai/kimi-k2.5',
    ]);
    expect(classifyAttempt({ text: '', stderr: '', exitCode: 0, timedOut: false, outputTooLarge: false })).toMatchObject({ retryable: true });
    expect(isRetryableModelFailure('', '')).toBe(true);
  });

  it('advances to fallback_model after quota error', () => {
    expect(isRetryableModelFailure('429 insufficient_quota quota exceeded', '')).toBe(true);
    expect(isRetryableModelFailure('quota exceeded', '')).toBe(true);
    expect(isRetryableModelFailure('rate limit', '')).toBe(true);
    expect(classifyAttempt({ text: '', stderr: '429 insufficient_quota quota exceeded', exitCode: 1, timedOut: false, outputTooLarge: false })).toMatchObject({ retryable: true });
  });
});

describe('stdout limit resolution', () => {
  it('defaults stdout limit to 128MB', () => {
    expect(DEFAULT_STDOUT_LIMIT_BYTES).toBe(128 * 1024 * 1024);
    delete process.env.SPECIALISTS_SCRIPT_STDOUT_LIMIT_BYTES;
    expect(resolveStdoutLimitBytes(baseSpec as never)).toBe(DEFAULT_STDOUT_LIMIT_BYTES);
  });

  it('uses env override when spec has no override', () => {
    process.env.SPECIALISTS_SCRIPT_STDOUT_LIMIT_BYTES = String(2 * 1024);
    expect(resolveStdoutLimitBytes(baseSpec as never)).toBe(2 * 1024);
  });

  it('uses spec override over env override', () => {
    process.env.SPECIALISTS_SCRIPT_STDOUT_LIMIT_BYTES = String(1024);
    expect(resolveStdoutLimitBytes({ ...baseSpec, specialist: { ...baseSpec.specialist, execution: { ...baseSpec.specialist.execution, stdout_limit_bytes: 3 * 1024 } } } as never)).toBe(3 * 1024);
  });
});

describe('runScriptSpecialist stdout overflow', () => {
  it('kills pi on stdout cap overflow and returns output_too_large', async () => {
    const child = createSpawnMock();
    const resultPromise = runScriptSpecialist(
      { specialist: 'changelog-keeper', variables: { name: 'release notes' } },
      { loader: makeLoader({ ...baseSpec, specialist: { ...baseSpec.specialist, execution: { ...baseSpec.specialist.execution, stdout_limit_bytes: 1024 } } }), projectDir: '.' },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    child.stdout.emit('data', Buffer.from('x'.repeat(600)));
    child.stdout.emit('data', Buffer.from('y'.repeat(600)));
    child.emit('close', 0);

    const result = await resultPromise;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result).toMatchObject({ success: false, error_type: 'output_too_large' });
  });
});
