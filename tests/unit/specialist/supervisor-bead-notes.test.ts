import { describe, expect, it } from 'vitest';
import { formatHandoffBlock, shouldPersistHandoffBlock } from '../../../src/specialist/supervisor.js';

describe('formatHandoffBlock', () => {
  const base = {
    output: 'memo body',
    promptHash: 'abc123',
    durationMs: 321,
    model: 'claude-haiku',
    backend: 'anthropic',
    specialist: 'researcher',
    jobId: '691242',
    status: 'waiting' as const,
    timestamp: '2026-05-29T15:00:00.000Z',
    turnIndex: 7,
  };

  it('renders waiting handoff block', () => {
    const note = formatHandoffBlock(base, { final: false });
    expect(note).toContain('______________________________________________________________________');
    expect(note).toContain('### 🔬 researcher · claude-haiku · [turn 7 · WAITING]');
  });

  it('renders final done block', () => {
    const note = formatHandoffBlock({ ...base, status: 'done' }, { final: true });
    expect(note).toContain('══════════════════════════════════════════════════════════════════════');
    expect(note).toContain('### ✅ researcher · claude-haiku · [FINAL · DONE]');
  });

  it('renders token usage lines when provided', () => {
    const note = formatHandoffBlock({
      ...base,
      status: 'done',
      tokenUsage: {
        input_tokens: 111,
        output_tokens: 222,
        cache_creation_tokens: 3,
        cache_read_tokens: 4,
      },
    }, { final: true });

    expect(note).toContain('input_tokens=111');
    expect(note).toContain('output_tokens=222');
    expect(note).toContain('cache_creation_tokens=3');
    expect(note).toContain('cache_read_tokens=4');
  });
});

describe('shouldPersistHandoffBlock', () => {
  it('skips empty output', () => {
    expect(shouldPersistHandoffBlock({ output: '   ', notesMode: 'full-trail', final: false })).toBe(false);
  });

  it('skips non-final full trail when output is empty', () => {
    expect(shouldPersistHandoffBlock({ output: '', notesMode: 'full-trail', final: false })).toBe(false);
  });

  it('skips intermediate turns in final-only mode', () => {
    expect(shouldPersistHandoffBlock({ output: 'memo body', notesMode: 'final-only', final: false })).toBe(false);
  });

  it('keeps final turn in final-only mode', () => {
    expect(shouldPersistHandoffBlock({ output: 'memo body', notesMode: 'final-only', final: true })).toBe(true);
  });

  it('keeps substantive full-trail turns', () => {
    expect(shouldPersistHandoffBlock({ output: 'memo body', notesMode: 'full-trail', final: false })).toBe(true);
  });
});
