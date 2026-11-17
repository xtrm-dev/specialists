import { describe, expect, it } from 'vitest';
import { bindActivationSession } from '../../../src/activation/native-host.js';

/**
 * SPECIALISTS-4441: `createAgentSession` does not emit `session_start`; the host must call
 * `bindExtensions` itself or every extension runs without its lifecycle handler. These tests pin
 * the three shapes the host can meet: a session that binds, one that predates the method, and one
 * whose binding throws.
 */
describe('bindActivationSession', () => {
  it('emits the lifecycle with no UI bindings', async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const result = await bindActivationSession({
      bindExtensions: async bindings => {
        calls.push(bindings);
      },
    });

    expect(result).toEqual({ bound: true });
    expect(calls).toEqual([{}]);
  });

  it('reports "not bound" when the session has no bindExtensions (older SDK)', async () => {
    expect(await bindActivationSession({})).toEqual({ bound: false });
  });

  it('reports the error instead of throwing when an extension handler fails', async () => {
    const result = await bindActivationSession({
      bindExtensions: async () => {
        throw new Error('session_start handler exploded');
      },
    });

    expect(result.bound).toBe(false);
    expect(result.error).toContain('session_start handler exploded');
  });
});
