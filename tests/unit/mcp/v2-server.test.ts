import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildV2Server } from '../../../src/mcp/v2-server.js';
import type { SubstrateHandle } from '../../../src/substrate/services.js';

/**
 * SDK v2 wire tests (unitAI-aiwva.7 E3).
 *
 * The REAL SDK v2 stack — `serveStdio(factory, { legacy: 'serve' })` over a
 * `StdioServerTransport` bound to in-memory streams — is spoken to with raw
 * JSON-RPC. The same factory serves either a 2025-11-25 `initialize` opening
 * or a 2026-07-28 per-request `_meta` envelope; each connection is pinned to
 * its negotiated era.
 *
 * Domain parity (gates, refusals, dispatch) lives in
 * activation-mcp-tools.test.ts / activation-dispatch-inline.test.ts at the
 * tool level plus live probes; here the wire contract is proved:
 * dual-revision negotiation, server/discover, 6-tool surface, resultType,
 * partitioned errors, and per-request independence.
 */

const LEGACY_PROTOCOL = '2025-11-25';
const PROTOCOL = '2026-07-28';
const META = {
  'io.modelcontextprotocol/protocolVersion': PROTOCOL,
  'io.modelcontextprotocol/clientCapabilities': {},
};

const EXPECTED_TOOLS = [
  'specialist_status',
  'specialist_dispatch',
  'specialist_reply',
  'specialist_resume',
  'specialist_stop_activation',
  'specialist_list',
];

const EXPECTED_TOOLS_WITH_SUBSTRATE = [
  ...EXPECTED_TOOLS,
  'substrate_issue',
  'substrate_journal',
  'substrate_provenance',
];

/**
 * unitAI-tgdtw: the tool surface depends on `resolveSubstrate()`, and that
 * result depends on whether `@jaggerxtrm/substrate` happens to be installed
 * on the machine running the suite. An injected handle makes both surfaces
 * (present and absent) a controlled input to the test instead of an accident
 * of the environment — see `BuildV2ServerOptions` in `src/mcp/v2-server.ts`.
 */
const SUBSTRATE_AVAILABLE: SubstrateHandle = {
  available: true,
  services: { issues: {}, journal: {}, provenance: {} },
};
const SUBSTRATE_UNAVAILABLE: SubstrateHandle = {
  available: false,
  services: null,
  reason: 'module_not_resolvable',
  detail: 'forced unavailable for test',
};

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

class WireClient {
  private nextId = 1;
  private readonly pending = new Map<number, (msg: JsonRpcResponse) => void>();
  private buffer = '';
  readonly seen: JsonRpcResponse[] = [];

  constructor(
    private readonly stdin: PassThrough,
    stdout: PassThrough,
  ) {
    stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as JsonRpcResponse;
        this.seen.push(msg);
        if (msg.id !== undefined) {
          const resolve = this.pending.get(msg.id as number);
          if (resolve) {
            this.pending.delete(msg.id as number);
            resolve(msg);
          }
        }
      }
    });
  }

  call(method: string, params: unknown, timeoutMs = 15000): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for ${method} response`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method: string, params: unknown): void {
    // Notifications carry no id (§constraint).
    this.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
}

let handle: StdioServerHandle | undefined;
let client: WireClient;

beforeEach(async () => {
  // Hermetic observability: point XDG resolution at a throwaway dir so tool
  // calls never touch a developer or CI database.
  const xdg = mkdtempSync(join(tmpdir(), 'mcp-v2-xdg-'));
  vi.stubEnv('XDG_DATA_HOME', xdg);
  (globalThis as { __mcpV2Xdg?: string }).__mcpV2Xdg = xdg;

  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const transport = new StdioServerTransport(stdin, stdout);
  // Baseline suite intentionally exercises the no-Substrate surface (EXPECTED_TOOLS,
  // 6 tools): inject the unavailable handle so that is a controlled input, not an
  // accident of whether @jaggerxtrm/substrate happens to be on disk (unitAI-tgdtw).
  // The Substrate-present surface is exercised separately, below.
  handle = serveStdio(() => buildV2Server(undefined, { substrate: SUBSTRATE_UNAVAILABLE }), { transport, legacy: 'serve' });
  client = new WireClient(stdin, stdout);
});

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  vi.unstubAllEnvs();
  const xdg = (globalThis as { __mcpV2Xdg?: string }).__mcpV2Xdg;
  if (xdg) rmSync(xdg, { recursive: true, force: true });
});

describe('v2 dual-revision negotiation', () => {
  it('server/discover advertises exactly 2026-07-28 with the tools capability', async () => {
    const res = await client.call('server/discover', { _meta: META });
    expect(res.error).toBeUndefined();
    const result = res.result as Record<string, unknown>;
    expect(result['supportedVersions']).toEqual([PROTOCOL]);
    expect(result['capabilities']).toMatchObject({ tools: {} });
    expect(result['resultType']).toBe('complete');
    expect(result['_meta']).toMatchObject({
      'io.modelcontextprotocol/serverInfo': { name: 'specialists' },
    });
  });

  it('serves the 2025-11-25 initialize handshake and a legacy request', async () => {
    const init = await client.call('initialize', {
      protocolVersion: LEGACY_PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'probe', version: '0' },
    });
    expect(init.error).toBeUndefined();
    const result = init.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe(LEGACY_PROTOCOL);
    expect(result.capabilities).toMatchObject({ tools: {} });
    expect(result.serverInfo).toMatchObject({ name: 'specialists' });

    const list = await client.call('tools/list', {});
    expect(list.error).toBeUndefined();
    expect((list.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
  });

  it('rejects unsupported protocol revisions', async () => {
    const unsupported = '2026-01-01';
    const res = await client.call('server/discover', {
      _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': unsupported },
    });
    expect(res.error?.code).toBe(-32022);
    expect(res.error?.data).toMatchObject({ supported: [PROTOCOL], requested: unsupported });
  });

  it('serves a claim-less legacy request without a modern envelope', async () => {
    const res = await client.call('tools/list', {});
    expect(res.error).toBeUndefined();
    expect((res.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
  });

  it('rejects a modern envelope without client capabilities', async () => {
    const res = await client.call('tools/list', {
      _meta: { 'io.modelcontextprotocol/protocolVersion': PROTOCOL },
    });
    expect(res.error?.code).toBe(-32602);
  });

  it('drops claim-less notifications without a response (notifications carry no id)', async () => {
    const before = client.seen.length;
    client.notify('notifications/initialized', {});
    await new Promise((r) => setTimeout(r, 300));
    expect(client.seen.length).toBe(before);
  });
});

describe('v2 tool surface (t2kol parity)', () => {
  it('tools/list returns the 6-tool surface in deterministic order with modern resultType', async () => {
    const res = await client.call('tools/list', { _meta: META });
    expect(res.error).toBeUndefined();
    const result = res.result as { tools: Array<{ name: string }>; resultType: string };
    expect(result.tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS);
    expect(result['resultType']).toBe('complete');
  });

  it('tools/call stamps resultType complete + serverInfo on a read-only tool', async () => {
    const res = await client.call('tools/call', {
      name: 'specialist_list',
      arguments: {},
      _meta: META,
    });
    expect(res.error).toBeUndefined();
    const result = res.result as {
      content: Array<{ type: string; text: string }>;
      resultType: string;
      _meta: Record<string, unknown>;
    };
    expect(result.resultType).toBe('complete');
    expect(result._meta?.['io.modelcontextprotocol/serverInfo']).toMatchObject({ name: 'specialists' });
    expect(result.content[0]?.type).toBe('text');
    // Payload is the tool's own projection, parseable by the coordinator.
    expect(() => JSON.parse(result.content[0].text)).not.toThrow();
  });

  it('specialist_status exposes the compact shared projection without registry or job dumps', async () => {
    const res = await client.call('tools/call', {
      name: 'specialist_status',
      arguments: {},
      _meta: META,
    });
    expect(res.error).toBeUndefined();
    const result = res.result as {
      content: Array<{ type: string; text: string }>;
      resultType: string;
    };
    expect(result.resultType).toBe('complete');

    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('specialists');
    expect(payload).not.toHaveProperty('background_jobs');
    expect(JSON.stringify(payload).length).toBeLessThan(5_000);
    expect(payload.activations).toEqual([]);
    expect(payload.pending_asks).toEqual([]);
  });

  it('refusals surface as returned payloads through the modern envelope', async () => {
    // both bead_id and contract: refused before any gate or side effect.
    const res = await client.call('tools/call', {
      name: 'specialist_dispatch',
      arguments: { specialist: 'explorer', bead_id: 'unitAI-x', contract: 'PROBLEM\nx' },
      _meta: META,
    });
    expect(res.error).toBeUndefined();
    const result = res.result as {
      content: Array<{ type: string; text: string }>;
      resultType: string;
    };
    expect(result.resultType).toBe('complete');
    const payload = JSON.parse(result.content[0].text) as { status: string; reason: string };
    expect(payload.status).toBe('rejected');
    expect(payload.reason).toContain('exactly one');
  });

  it('unknown tools answer -32602', async () => {
    const res = await client.call('tools/call', { name: 'nope', arguments: {}, _meta: META });
    expect(res.error?.code).toBe(-32602);
  });

  it('specialist_resume reports an unknown activation as a returned error payload', async () => {
    const res = await client.call('tools/call', {
      name: 'specialist_resume',
      arguments: { activation_id: 'act:nope', prompt: 'carry on' },
      _meta: META,
    });
    expect(res.error).toBeUndefined();
    const result = res.result as {
      content: Array<{ type: string; text: string }>;
      resultType: string;
    };
    expect(result.resultType).toBe('complete');
    const payload = JSON.parse(result.content[0].text) as { status: string; error: string };
    expect(payload.status).toBe('error');
    expect(payload.error).toContain('Unknown activation: act:nope');
  });

  it('specialist_resume surfaces a missing prompt as an isError result (zod throw, per E3)', async () => {
    const res = await client.call('tools/call', {
      name: 'specialist_resume',
      arguments: { activation_id: 'act:aaaa' },
      _meta: META,
    });
    expect(res.error).toBeUndefined();
    const result = res.result as { isError: boolean; resultType: string };
    expect(result.isError).toBe(true);
    expect(result.resultType).toBe('complete');
  });
});

describe('v2 statelessness (no cross-request server state)', () => {
  it('two sequential requests with different capabilities are served independently', async () => {
    const capsA = { 'io.modelcontextprotocol/protocolVersion': PROTOCOL, 'io.modelcontextprotocol/clientCapabilities': { sampling: {} } };
    const capsB = { 'io.modelcontextprotocol/protocolVersion': PROTOCOL, 'io.modelcontextprotocol/clientCapabilities': { roots: {} } };
    const first = await client.call('tools/list', { _meta: capsA });
    const second = await client.call('tools/list', { _meta: capsB });
    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();
    expect((first.result as { tools: unknown[] }).tools.length).toBe(6);
    expect((second.result as { tools: unknown[] }).tools.length).toBe(6);
  });

  it('a tool call needs no prior handshake or discovery', async () => {
    // Fresh client order: call first, discover after. Both succeed.
    const call = await client.call('tools/call', {
      name: 'specialist_list',
      arguments: { detail: 'compact' },
      _meta: META,
    });
    expect(call.error).toBeUndefined();
    const discover = await client.call('server/discover', { _meta: META });
    expect(discover.error).toBeUndefined();
  });
});

/**
 * unitAI-tgdtw: prove the Substrate-present surface is exercised deliberately,
 * not left untested because this machine happens not to carry the package.
 * Each case stands up its own server with an injected handle rather than
 * relying on the shared `beforeEach` (which always uses the real resolution).
 */
describe('v2 tool surface (Substrate injected, unitAI-tgdtw)', () => {
  async function listToolsWith(substrate: SubstrateHandle): Promise<string[]> {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const transport = new StdioServerTransport(stdin, stdout);
    const localHandle = serveStdio(() => buildV2Server(undefined, { substrate }), { transport, legacy: 'serve' });
    const localClient = new WireClient(stdin, stdout);
    try {
      const res = await localClient.call('tools/list', { _meta: META });
      expect(res.error).toBeUndefined();
      return (res.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    } finally {
      await localHandle.close();
    }
  }

  it('registers the 9-tool surface when Substrate resolves', async () => {
    expect(await listToolsWith(SUBSTRATE_AVAILABLE)).toEqual(EXPECTED_TOOLS_WITH_SUBSTRATE);
  });

  it('registers the 6-tool surface when Substrate does not resolve', async () => {
    expect(await listToolsWith(SUBSTRATE_UNAVAILABLE)).toEqual(EXPECTED_TOOLS);
  });
});
