import { describe, expect, it } from 'vitest';
import { formatBeadNotes } from '../../../src/specialist/supervisor.js';

describe('formatBeadNotes', () => {
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
  };

  it('renders divider and header format', () => {
    const note = formatBeadNotes(base);
    expect(note).toContain('______________________________________________________________________');
    expect(note).toContain('### 🔬 researcher · claude-haiku · [WAITING — more output may follow]');
  });

  it('renders token usage lines when provided', () => {
    const note = formatBeadNotes({
      ...base,
      status: 'done',
      tokenUsage: {
        input_tokens: 111,
        output_tokens: 222,
        cache_creation_tokens: 3,
        cache_read_tokens: 4,
      },
    });

    expect(note).toContain('input_tokens=111');
    expect(note).toContain('output_tokens=222');
    expect(note).toContain('cache_creation_tokens=3');
    expect(note).toContain('cache_read_tokens=4');
  });

  it('omits token usage lines when tokenUsage missing', () => {
    const note = formatBeadNotes(base);
    expect(note).not.toContain('input_tokens=');
    expect(note).not.toContain('output_tokens=');
    expect(note).not.toContain('cache_creation_tokens=');
    expect(note).not.toContain('cache_read_tokens=');
  });
});
