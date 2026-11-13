import { describe, it, expect, vi } from 'vitest';

// Minimal smoke: the extension must never write to stdout/stderr when a TUI owns the terminal.
describe('extension-tool-policy managed output', () => {
  it('routes failures through ctx.ui.notify instead of console.error', async () => {
    const mjs = await import('../../config/pi-extensions/extension-tool-policy/index.mjs');
    const notify = vi.fn();
    const ctx = { ui: { notify } };
    const pi: any = {
      getAllTools: () => [],
      setActiveTools: () => { throw new Error('boom'); },
      getActiveTools: () => [],
      on: (event: string, handler: any) => {
        if (event === 'session_start') handler(undefined, ctx);
      },
    };
    mjs.default(pi);
    // session_start handler is registered and invoked above; notify must have been called
    // (the handler catches and notifies). On pre-fix code this would call console.error.
    expect(notify).toHaveBeenCalled();
  });
});
