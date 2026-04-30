import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { compatGuard, collectModelCandidates, classifyAttempt, isRetryableModelFailure, renderTaskTemplate } from '../../../src/specialist/script-runner.js';

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

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

function makeLoader() {
  return {
    get: vi.fn().mockResolvedValue(baseSpec),
  };
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
