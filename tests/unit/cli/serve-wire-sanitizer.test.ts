import type { ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { sendJson, serializeForWire, toWireValue } from '../../../src/cli/serve.js';

function errorWithStack(message: string): Error {
  const error = new Error(message);
  error.stack = `Error: ${message}\n    at secret (/home/operator/private/path.ts:42:7)`;
  return error;
}

describe('serve JSON sink', () => {
  it('drops a stack carried on an Error', () => {
    const wire = serializeForWire({ success: false, error: errorWithStack('boom') });
    expect(wire).not.toContain('at secret');
    expect(wire).not.toContain('/home/operator/private/path.ts');
    expect(JSON.parse(wire)).toEqual({ success: false, error: { name: 'Error', message: 'boom' } });
  });

  it('drops nested stack-bearing keys at any depth', () => {
    const body = {
      success: false,
      result: { error: { message: 'x', stack: 'Error: x\n    at f (/srv/app.js:1:1)' } },
      list: [{ stackTrace: 'at g' }, { ok: true }],
    };
    const wire = serializeForWire(body);
    expect(wire).not.toContain('at f');
    expect(wire).not.toContain('at g');
    expect(JSON.parse(wire)).toEqual({ success: false, result: { error: { message: 'x' } }, list: [{}, { ok: true }] });
  });

  it('leaves ordinary bodies unchanged', () => {
    const body = { ready: true, db_write_failures_total: 0, nested: { a: [1, 2, { b: null }] } };
    expect(JSON.parse(serializeForWire(body))).toEqual(body);
  });

  it('survives cycles instead of throwing', () => {
    const node: Record<string, unknown> = { name: 'a' };
    node.self = node;
    expect(JSON.parse(serializeForWire(node))).toEqual({ name: 'a', self: '[circular]' });
  });

  it('keeps the existing encoding for exotic values', () => {
    const date = new Date('2026-11-11T00:00:00.000Z');
    expect(JSON.parse(serializeForWire({ at: date }))).toEqual({ at: '2026-11-11T00:00:00.000Z' });
  });

  it('keeps a shared reference intact instead of calling it circular', () => {
    // Regression: `seen` was never unwound, so siblings sharing one object were both "circular".
    const shared = { id: 'shared', value: 1 };
    expect(JSON.parse(serializeForWire({ a: shared, b: shared }))).toEqual({
      a: { id: 'shared', value: 1 },
      b: { id: 'shared', value: 1 },
    });
    expect(JSON.parse(serializeForWire([shared, shared]))).toEqual([
      { id: 'shared', value: 1 },
      { id: 'shared', value: 1 },
    ]);
  });

  it('leaves a legitimately deep success body unchanged', () => {
    // The depth guard must not alter valid data; 50 is far deeper than any real response.
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 50; i += 1) deep = { next: deep };
    expect(JSON.parse(serializeForWire(deep))).toEqual(deep);
  });

  it('keeps an Error code but never its stack', () => {
    const error = Object.assign(errorWithStack('boom'), { code: 'E_PEER_GONE' });
    expect(JSON.parse(serializeForWire({ error }))).toEqual({
      error: { name: 'Error', message: 'boom', code: 'E_PEER_GONE' },
    });
  });

  it('is actually used by sendJson', () => {
    // Wiring: swapping the sink back to JSON.stringify must fail here, not stay green.
    const chunks: string[] = [];
    const headers: Record<string, string> = {};
    const response = {
      writeHead: (_status: number, given: Record<string, string>) => Object.assign(headers, given),
      end: (payload: string) => chunks.push(payload),
    } as unknown as ServerResponse;

    sendJson(response, 200, { success: false, error: errorWithStack('boom') });
    const payload = chunks.join('');
    expect(payload).not.toContain('at secret');
    expect(JSON.parse(payload).error).toEqual({ name: 'Error', message: 'boom' });
    expect(headers['content-type']).toBe('application/json');
  });

  it('bounds depth rather than recursing forever', () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 1200; i += 1) deep = { next: deep };
    expect(serializeForWire(deep)).toContain('[truncated]');
  });

  it('exposes the sanitizer as a pure function', () => {
    const error = errorWithStack('boom');
    expect(toWireValue(error)).toEqual({ name: 'Error', message: 'boom' });
  });
});
