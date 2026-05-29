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
    tokenUsage: {
      input_tokens: 111,
      output_tokens: 222,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    },
  };

  it('renders waiting handoff block', () => {
    const note = formatHandoffBlock(base, { final: false });
    expect(note).toContain('### researcher · claude-haiku · [turn 7 · WAITING]');
    expect(note).not.toContain('______________________________________________________________________');
    expect(note).not.toContain('══════════════════════════════════════════════════════════════════════');
    expect(note).not.toContain('\n---\n');
    expect(note).toContain('_turn 7 · 321 ms · 111 to 222 tok · 2026-05-29 15:00 · git ');
  });

  it('renders final done block', () => {
    const note = formatHandoffBlock({ ...base, status: 'done' }, { final: true });
    expect(note).toContain('## researcher · claude-haiku · [FINAL · DONE]');
    expect(note).not.toContain('### researcher · claude-haiku · [FINAL · DONE]');
    expect(note).not.toContain('______________________________________________________________________');
    expect(note).not.toContain('══════════════════════════════════════════════════════════════════════');
    expect(note).toContain('_final · 321 ms · 111 to 222 tok · 2026-05-29 15:00 · git ');
  });

  it('normalizes provider-qualified model strings', () => {
    const note = formatHandoffBlock({ ...base, model: 'anthropic/claude-haiku' }, { final: false });
    expect(note).toContain('### researcher · claude-haiku · [turn 7 · WAITING]');
    expect(note).not.toContain('anthropic/claude-haiku');
  });

  it('omits empty metadata fields from footer', () => {
    const note = formatHandoffBlock({
      ...base,
      durationMs: undefined,
      promptHash: undefined,
      tokenUsage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      },
    }, { final: true });

    expect(note).toContain('_final · 2026-05-29 15:00 · git ');
    expect(note).not.toContain('prompt_hash=');
    expect(note).not.toContain('input_tokens=');
    expect(note).not.toContain('output_tokens=');
    expect(note).not.toContain('cache_creation_tokens=');
    expect(note).not.toContain('cache_read_tokens=');
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
