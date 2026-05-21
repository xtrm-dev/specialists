import { describe, expect, it, vi } from 'vitest';

vi.mock('@earendil-works/pi-tui', () => ({ truncateToWidth: (value: string) => value }));
vi.mock('../../../src/specialist/status-load.js', () => ({
  loadStatuses: vi.fn(() => [{
    id: 'job-1',
    bead_id: 'bead-1',
    status: 'running',
    backend: 'anthropic',
    model: 'claude-4.6',
    metrics: { token_usage: { total_tokens: 14400 } },
    started_at_ms: 1,
    specialist: 'executor',
  }]),
}));

describe('chat status boundary', () => {
  it('polls live status without thrash on unchanged state', async () => {
    const { ChatStatus } = await import('../../../src/cli/chat/status.js');
    let requestRenderCalls = 0;
    const chatStatus = new ChatStatus({ requestRender: () => { requestRenderCalls += 1; } });

    await chatStatus.poll();
    for (let index = 0; index < 10; index += 1) await chatStatus.poll();

    expect(requestRenderCalls).toBe(1);
  });

  it('formatted status line contains job-id and bead-id (drift-safe substring, not positional)', async () => {
    const { ChatStatus } = await import('../../../src/cli/chat/status.js');
    const chatStatus = new ChatStatus({ requestRender: () => { /* noop */ } });
    await chatStatus.poll();
    const rendered = chatStatus.render(120);
    expect(rendered).toContain('job-1');
    expect(rendered).toContain('bead-1');
  });

  it('asserts status field types (presence + types, not exact identity)', async () => {
    const { loadStatuses } = await import('../../../src/specialist/status-load.js');
    const statuses = loadStatuses();
    expect(Array.isArray(statuses)).toBe(true);
    const first = statuses[0];
    expect(typeof first.id).toBe('string');
    expect(typeof first.bead_id).toBe('string');
    expect(typeof first.status).toBe('string');
    expect(typeof first.metrics?.token_usage?.total_tokens).toBe('number');
  });
});
