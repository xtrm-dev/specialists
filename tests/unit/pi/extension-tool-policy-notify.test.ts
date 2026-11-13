import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('extension-tool-policy managed output', () => {
  let exitSpy: any;
  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });
  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('routes failures through ctx.ui.notify instead of console.error', async () => {
    const mjs = await import('../../../config/pi-extensions/extension-tool-policy/index.mjs');
    const notify = vi.fn();
    const ctx: any = { ui: { notify } };
    const pi: any = {
      getAllTools: () => [],
      setActiveTools: () => { throw new Error('boom'); },
      getActiveTools: () => [],
      on: (event: string, handler: any) => {
        if (event === 'session_start') handler(undefined, ctx);
      },
    };
    mjs.default(pi);
    expect(notify).toHaveBeenCalled();
  });
});
