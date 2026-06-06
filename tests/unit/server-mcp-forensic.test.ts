import { describe, expect, it, vi } from 'vitest';
import { emitMcpForensicEvent, toMcpMeta } from '../../src/server.js';
import { createForensicEvent } from '../../src/specialist/forensic-events.js';

describe('MCP forensic live emitter', () => {
  it('builds bounded meta with opaque ids', () => {
    const meta = toMcpMeta({
      mcpSessionId: 'session-1',
      jsonrpcRequestId: 'req-7',
      traceId: 'trace-1',
      spanId: 'span-1',
    });

    expect(meta).toEqual({
      trace_id: 'trace-1',
      span_id: 'span-1',
      mcp_session_id: 'session-1',
      jsonrpc_request_id: 'req-7',
      trace_carrier: '_meta',
    });
  });

  it('emits canonical mcp forensic envelope', () => {
    const appendForensicEvent = vi.fn();
    const observability = { appendForensicEvent } as const;
    const context = {
      mcpSessionId: 'session-1',
      jsonrpcRequestId: 'req-7',
      traceId: 'trace-1',
      spanId: 'span-1',
    };

    emitMcpForensicEvent(observability, 'mcp.call.completed', context, {
      mcp_server: 'specialists',
      mcp_method: 'tools/call',
      tool_name: 'use_specialist',
      network_transport: 'stdio',
    }, 42);

    expect(appendForensicEvent).toHaveBeenCalledTimes(1);
    const [, , , event] = appendForensicEvent.mock.calls[0];
    expect(event).toMatchObject({
      event_family: 'mcp',
      event_name: 'mcp.call.completed',
      correlation: {
        mcp_session_id: 'session-1',
        jsonrpc_request_id: 'req-7',
        trace_id: 'trace-1',
        span_id: 'span-1',
      },
      body: {
        mcp_server: 'specialists',
        mcp_method: 'tools/call',
        tool_name: 'use_specialist',
        network_transport: 'stdio',
        duration_ms: 42,
      },
    });
    expect(() => createForensicEvent({
      event_family: event.event_family,
      event_name: event.event_name,
      resource: event.resource,
      correlation: event.correlation,
      body: event.body,
      redaction: event.redaction,
    })).not.toThrow();
  });
});
