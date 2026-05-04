import { describe, it, expect } from 'vitest';
import { PiAgentSession } from '../../../src/pi/session.js';

describe('PiAgentSession impact stall window', () => {
  it('activates on gitnexus_impact start and resolves to 300_000', async () => {
    const session = await PiAgentSession.create({ model: 'gemini', stallTimeoutMs: 50, testCommandStallTimeoutMs: 200 });
    const s = session as any;

    expect(s._resolveStallTimeoutMs()).toBe(50);

    s._handleEvent(JSON.stringify({ type: 'tool_execution_start', toolName: 'gitnexus_impact', toolCallId: 'impact-1', args: { target: 'x', direction: 'upstream' } }));

    expect(s._resolveStallTimeoutMs()).toBe(300000);
  });

  it('deactivates on gitnexus_impact end', async () => {
    const session = await PiAgentSession.create({ model: 'gemini', stallTimeoutMs: 50, testCommandStallTimeoutMs: 200 });
    const s = session as any;

    s._handleEvent(JSON.stringify({ type: 'tool_execution_start', toolName: 'gitnexus_impact', toolCallId: 'impact-1', args: { target: 'x', direction: 'upstream' } }));
    expect(s._resolveStallTimeoutMs()).toBe(300000);

    s._handleEvent(JSON.stringify({ type: 'tool_execution_end', toolName: 'gitnexus_impact', toolCallId: 'impact-1', isError: false, result: { content: [] } }));

    expect(s._resolveStallTimeoutMs()).toBe(50);
  });

  it('non-impact tools keep base/test timeout behavior', async () => {
    const session = await PiAgentSession.create({ model: 'gemini', stallTimeoutMs: 50, testCommandStallTimeoutMs: 200 });
    const s = session as any;

    expect(s._resolveStallTimeoutMs()).toBe(50);

    s._handleEvent(JSON.stringify({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'bash-1', args: { command: 'bun test' } }));
    expect(s._resolveStallTimeoutMs()).toBe(200);

    s._handleEvent(JSON.stringify({ type: 'tool_execution_end', toolName: 'bash', toolCallId: 'bash-1', isError: false, result: { content: [] } }));
    expect(s._resolveStallTimeoutMs()).toBe(50);

    s._handleEvent(JSON.stringify({ type: 'tool_execution_start', toolName: 'gitnexus_query', toolCallId: 'query-1', args: { query: 'x' } }));
    expect(s._resolveStallTimeoutMs()).toBe(50);
  });
});
