import { describe, expect, it } from 'vitest';

import { serializeForWire, toWireValue } from '../../../src/cli/serve.js';

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

  it('bounds depth rather than recursing forever', () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 40; i += 1) deep = { next: deep };
    expect(serializeForWire(deep)).toContain('[truncated]');
  });

  it('exposes the sanitizer as a pure function', () => {
    const error = errorWithStack('boom');
    expect(toWireValue(error)).toEqual({ name: 'Error', message: 'boom' });
  });
});
