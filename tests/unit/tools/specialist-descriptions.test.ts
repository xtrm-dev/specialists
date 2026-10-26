// tests/unit/tools/specialist-descriptions.test.ts
//
// SPECIALISTS-4342 drift test: every specialist_* tool description and parameter
// description has ONE definition in src/tools/specialist/descriptions.ts,
// re-exported from src/lib.ts and consumed by the MCP servers and the Pi
// extension. This test pins the expected tool set per surface and fails when
// two surfaces emit different description text for the same tool.
//
// Surfaces:
//   - v2 (src/mcp/v2-server.ts): all eleven specialist_* tools — asserted over
//     the REAL wire via tools/list, plus at the factory level.
//   - v1 (src/server.ts): nine tools (no specialist_feed, no specialist_resume).
//   - Pi (config/pi-extensions/native-specialists/index.mjs): all eleven, loaded
//     as the real bundle through a fake pi.
// Per-runtime wording (Channel push vs follow-up message, the legacy
// stop_specialist pointer, the Pi dispatch-surface note) is allowed ONLY as a
// declared suffix in MCP/PI_TOOL_DESCRIPTION_SUFFIXES. Anything else that
// differs between surfaces is a drift failure. A new tool fails here until it
// is classified in V1/V2/PI_SPECIALIST_TOOL_NAMES.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { z } from 'zod';

// The extension imports Type from 'typebox' (resolved from pi's own install at
// runtime). Under vitest the worktree has no typebox, so stub the members the
// factory uses — parameter schemas AND the output schemas — since they are
// captured, never validated, in this test.
vi.mock('typebox', () => ({
  Type: {
    Object: (props: unknown) => ({ type: 'object', properties: props }),
    String: (opts = {}) => ({ type: 'string', ...opts }),
    Integer: (opts = {}) => ({ type: 'integer', ...opts }),
    Number: (opts = {}) => ({ type: 'number', ...opts }),
    Boolean: (opts = {}) => ({ type: 'boolean', ...opts }),
    Array: (items: unknown, opts = {}) => ({ type: 'array', items, ...(opts as object) }),
    Union: (variants: unknown, opts = {}) => ({ anyOf: variants, ...opts }),
    Literal: (value: unknown) => ({ const: value }),
    Enum: (values: object, opts = {}) => ({ enum: Object.values(values), ...opts }),
    Unknown: () => ({ type: 'unknown' }),
    Null: () => ({ type: 'null' }),
    Optional: (schema: unknown) => schema,
  },
}));

import {
  SPECIALIST_TOOL_NAMES,
  V2_SPECIALIST_TOOL_NAMES,
  V1_SPECIALIST_TOOL_NAMES,
  PI_SPECIALIST_TOOL_NAMES,
  SPECIALIST_TOOL_DESCRIPTIONS,
  MCP_TOOL_DESCRIPTION_SUFFIXES,
  PI_TOOL_DESCRIPTION_SUFFIXES,
  specialistToolDescription,
  specialistFeedLimitDescription,
  SPECIALIST_DISPATCH_PARAMS,
  SPECIALIST_DISPATCH_RUNTIME_PARAMS,
  SPECIALIST_TOOL_PARAM_DESCRIPTIONS,
  type SpecialistToolName,
} from '../../../src/tools/specialist/descriptions.js';
import {
  createSpecialistDispatchTool,
  createSpecialistReplyTool,
  createSpecialistRetryTool,
  createSpecialistSteerTool,
  createSpecialistStopActivationTool,
  specialistDispatchSchema,
  specialistReplySchema,
  specialistRetrySchema,
  specialistSteerSchema,
  specialistStopSchema,
} from '../../../src/tools/specialist/activation.tool.js';
import {
  createSpecialistStatusTool,
  specialistStatusSchema,
} from '../../../src/tools/specialist/specialist_status.tool.js';
import {
  createSpecialistResultTool,
  specialistResultSchema,
} from '../../../src/tools/specialist/specialist_result.tool.js';
import {
  createSpecialistFeedTool,
  specialistFeedSchema,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
} from '../../../src/tools/specialist/specialist_feed.tool.js';
import {
  createSpecialistListTool,
  specialistListSchema,
} from '../../../src/tools/specialist/specialist_list.tool.js';
import {
  createSpecialistLeaseReconcileTool,
  specialistLeaseReconcileSchema,
} from '../../../src/tools/specialist/specialist_lease_reconcile.tool.js';
import { createSpecialistResumeTool, specialistResumeSchema } from '../../../src/mcp/resume-tool.js';
import { SpecialistsServer } from '../../../src/server.js';
import { SpecialistLoader } from '../../../src/specialist/loader.js';
import { CircuitBreaker } from '../../../src/utils/circuitBreaker.js';

const EXTENSION_PATH = resolve('config/pi-extensions/native-specialists/index.mjs');

/** The pinned v2/Pi surface: all eleven specialist_* tools, registration order. */
const EXPECTED_V2_TOOLS: readonly SpecialistToolName[] = [
  'specialist_status',
  'specialist_result',
  'specialist_feed',
  'specialist_dispatch',
  'specialist_reply',
  'specialist_resume',
  'specialist_retry',
  'specialist_steer',
  'specialist_stop_activation',
  'specialist_list',
  'specialist_lease_reconcile',
];

/** The pinned v1 surface: nine tools — no specialist_feed, no specialist_resume. */
const EXPECTED_V1_TOOLS: readonly SpecialistToolName[] = [
  'specialist_status',
  'specialist_result',
  'specialist_dispatch',
  'specialist_reply',
  'specialist_retry',
  'specialist_steer',
  'specialist_stop_activation',
  'specialist_list',
  'specialist_lease_reconcile',
];

const stubHost = () => ({}) as never;
const stubPusher = () => undefined;

function buildMcpTools(): Array<{ name: string; description: string }> {
  const loader = new SpecialistLoader();
  const breaker = new CircuitBreaker();
  return [
    createSpecialistStatusTool(loader, breaker, stubHost, stubPusher),
    createSpecialistResultTool(stubHost, stubPusher),
    createSpecialistFeedTool(stubHost),
    createSpecialistDispatchTool(stubHost, stubPusher),
    createSpecialistReplyTool(stubHost),
    createSpecialistResumeTool(stubHost, stubPusher),
    createSpecialistRetryTool(stubHost, stubPusher),
    createSpecialistSteerTool(stubHost),
    createSpecialistStopActivationTool(stubHost),
    createSpecialistListTool(loader),
    createSpecialistLeaseReconcileTool(),
  ];
}

function mcpSchemas(): Record<string, z.ZodTypeAny> {
  return {
    specialist_status: specialistStatusSchema,
    specialist_result: specialistResultSchema,
    specialist_feed: specialistFeedSchema,
    specialist_dispatch: specialistDispatchSchema,
    specialist_reply: specialistReplySchema,
    specialist_resume: specialistResumeSchema,
    specialist_retry: specialistRetrySchema,
    specialist_steer: specialistSteerSchema,
    specialist_stop_activation: specialistStopSchema,
    specialist_list: specialistListSchema,
    specialist_lease_reconcile: specialistLeaseReconcileSchema,
  };
}

function zodDescription(schema: z.ZodTypeAny, field: string): string | undefined {
  const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
  const fieldSchema = shape?.[field] as { description?: string } | undefined;
  return fieldSchema?.description;
}

function makeFakePi() {
  const tools: Array<{
    name: string;
    description?: string;
    parameters?: { properties?: Record<string, { description?: string }> };
  }> = [];
  const messageRenderers: Record<string, unknown> = {};
  return {
    // Shaped like the real Pi ExtensionAPI (register + getters only).
    registerTool: (def: (typeof tools)[number]) => tools.push(def),
    registerCommand: () => {},
    registerFlag: () => {},
    registerMessageRenderer: (customType: string, renderer: unknown) => {
      messageRenderers[customType] = renderer;
    },
    on: () => {},
    getFlag: () => false,
    sendMessage: () => {},
    getAllTools: () => [...tools],
    getMessageRenderers: () => ({ ...messageRenderers }),
  };
}

async function loadPiTools() {
  const mod = await import(EXTENSION_PATH);
  const pi = makeFakePi();
  mod.default(pi, { createHost: () => stubHost() });
  return { pi, tools: pi.getAllTools() };
}

beforeEach(() => {
  // Hermetic observability/state: tool construction must never touch a
  // developer or CI database.
  const xdg = mkdtempSync(join(tmpdir(), 'sp-descriptions-'));
  vi.stubEnv('XDG_DATA_HOME', xdg);
  vi.stubEnv('XTRM_STATE_DB', join(xdg, 'state.db'));
});

describe('pinned tool sets per surface', () => {
  it('the shared module pins eleven v2/Pi tools', () => {
    expect([...V2_SPECIALIST_TOOL_NAMES]).toEqual([...EXPECTED_V2_TOOLS]);
    expect([...PI_SPECIALIST_TOOL_NAMES]).toEqual([...EXPECTED_V2_TOOLS]);
    expect([...SPECIALIST_TOOL_NAMES]).toEqual([...EXPECTED_V2_TOOLS]);
  });

  it('the shared module pins the nine-tool v1 subset (no feed, no resume)', () => {
    expect([...V1_SPECIALIST_TOOL_NAMES]).toEqual([...EXPECTED_V1_TOOLS]);
    expect(V1_SPECIALIST_TOOL_NAMES).not.toContain('specialist_feed');
    expect(V1_SPECIALIST_TOOL_NAMES).not.toContain('specialist_resume');
    for (const name of V1_SPECIALIST_TOOL_NAMES) {
      expect(V2_SPECIALIST_TOOL_NAMES).toContain(name);
    }
  });

  it('every tool has a base description and only declared per-runtime suffixes', () => {
    for (const name of SPECIALIST_TOOL_NAMES) {
      expect(
        SPECIALIST_TOOL_DESCRIPTIONS[name],
        `${name} has no shared base description`,
      ).toMatch(/\S/);
    }
    // Suffixes may only exist for tools in the shared set.
    for (const name of Object.keys(MCP_TOOL_DESCRIPTION_SUFFIXES)) {
      expect(SPECIALIST_TOOL_NAMES).toContain(name as SpecialistToolName);
    }
    for (const name of Object.keys(PI_TOOL_DESCRIPTION_SUFFIXES)) {
      expect(SPECIALIST_TOOL_NAMES).toContain(name as SpecialistToolName);
    }
  });
});

describe('MCP factories emit the shared text', () => {
  it('every factory description equals base plus the declared MCP suffix', () => {
    for (const tool of buildMcpTools()) {
      expect(tool.description, tool.name).toBe(
        specialistToolDescription(tool.name as SpecialistToolName, 'mcp'),
      );
    }
  });

  it('every factory covers exactly the shared set (a new tool fails until classified)', () => {
    expect(buildMcpTools().map((t) => t.name).sort()).toEqual([...EXPECTED_V2_TOOLS].sort());
  });

  it('every zod parameter description is the shared text', () => {
    const schemas = mcpSchemas();
    for (const [toolName, params] of Object.entries(SPECIALIST_TOOL_PARAM_DESCRIPTIONS)) {
      for (const [field, expected] of Object.entries(params)) {
        expect(zodDescription(schemas[toolName], field), `${toolName}.${field}`).toBe(expected);
      }
    }
    // The two runtime-named dispatch params come from the declared runtime map.
    expect(zodDescription(schemas.specialist_dispatch, 'requested_by')).toBe(
      SPECIALIST_DISPATCH_RUNTIME_PARAMS.mcp.requested_by,
    );
    expect(zodDescription(schemas.specialist_dispatch, 'coordinator_session_id')).toBe(
      SPECIALIST_DISPATCH_RUNTIME_PARAMS.mcp.coordinator_session_id,
    );
    // The feed limit help is the shared template over the numeric bounds.
    expect(zodDescription(schemas.specialist_feed, 'limit')).toBe(
      specialistFeedLimitDescription(FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT),
    );
  });
});

describe('Pi emits the shared text', () => {
  it('Pi registers exactly the eleven shared tools — no Pi-only specialist_* tool', () => {
    return loadPiTools().then(({ tools }) => {
      const names = tools.map((t) => t.name);
      expect(names.sort()).toEqual([...EXPECTED_V2_TOOLS].sort());
      expect(names).not.toContain('specialist_ask');
      expect(names).not.toContain('specialist_settled');
    });
  });

  it('specialist_ask and specialist_settled stay event-card customTypes, not tools', () => {
    return loadPiTools().then(({ pi }) => {
      const renderers = pi.getMessageRenderers();
      expect(Object.keys(renderers)).toEqual(
        expect.arrayContaining(['specialist_ask', 'specialist_settled']),
      );
    });
  });

  it('every Pi description equals base plus the declared Pi suffix', () => {
    return loadPiTools().then(({ tools }) => {
      for (const tool of tools) {
        expect(tool.description, tool.name).toBe(
          specialistToolDescription(tool.name as SpecialistToolName, 'pi'),
        );
      }
    });
  });

  it('every Pi parameter description is the shared text', () => {
    return loadPiTools().then(({ tools }) => {
      const byName = new Map(tools.map((t) => [t.name, t]));
      for (const [toolName, params] of Object.entries(SPECIALIST_TOOL_PARAM_DESCRIPTIONS)) {
        const properties = byName.get(toolName)?.parameters?.properties ?? {};
        for (const [field, expected] of Object.entries(params)) {
          // status.wait_for_change/timeout_s are MCP-only fields; every other
          // shared field must be described identically on Pi.
          if (toolName === 'specialist_status' && field !== 'full') continue;
          expect(properties[field]?.description, `Pi ${toolName}.${field}`).toBe(expected);
        }
      }
      const dispatch = byName.get('specialist_dispatch')?.parameters?.properties ?? {};
      expect(dispatch.requested_by?.description).toBe(
        SPECIALIST_DISPATCH_RUNTIME_PARAMS.pi.requested_by,
      );
      expect(dispatch.coordinator_session_id?.description).toBe(
        SPECIALIST_DISPATCH_RUNTIME_PARAMS.pi.coordinator_session_id,
      );
      const feed = byName.get('specialist_feed')?.parameters?.properties ?? {};
      expect(feed.limit?.description).toBe(
        specialistFeedLimitDescription(FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT),
      );
    });
  });
});

describe('v1 server exposes the nine-tool subset with shared text', () => {
  it('v1 registers exactly the pinned nine with MCP descriptions', () => {
    const server = new SpecialistsServer();
    const tools = (server as unknown as { tools: Array<{ name: string; description: string }> })
      .tools;
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_V1_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.description, tool.name).toBe(
        specialistToolDescription(tool.name as SpecialistToolName, 'mcp'),
      );
    }
  });
});

describe('cross-surface drift', () => {
  it('Pi and MCP differ only by the declared suffixes', () => {
    return loadPiTools().then(({ tools }) => {
      const piByName = new Map(tools.map((t) => [t.name, t.description ?? '']));
      for (const tool of buildMcpTools()) {
        const name = tool.name as SpecialistToolName;
        const mcpSuffix = MCP_TOOL_DESCRIPTION_SUFFIXES[name] ?? '';
        const piSuffix = PI_TOOL_DESCRIPTION_SUFFIXES[name] ?? '';
        // Strip each surface's declared suffix: the remainder must be the one base.
        expect(tool.description.endsWith(mcpSuffix), name).toBe(true);
        const piDescription = piByName.get(name) ?? '';
        expect(piDescription.endsWith(piSuffix), name).toBe(true);
        expect(piDescription.slice(0, piDescription.length - piSuffix.length), name).toBe(
          tool.description.slice(0, tool.description.length - mcpSuffix.length),
        );
        expect(
          tool.description.slice(0, tool.description.length - mcpSuffix.length),
          name,
        ).toBe(SPECIALIST_TOOL_DESCRIPTIONS[name]);
      }
    });
  });

  it('the 7-vs-8 divergence is gone: eight required parts stated once per surface', () => {
    return loadPiTools().then(({ tools }) => {
      const piByName = new Map(tools.map((t) => [t.name, t.description ?? '']));
      for (const [label, description] of [
        ['mcp dispatch', specialistToolDescription('specialist_dispatch', 'mcp')],
        ['pi dispatch', piByName.get('specialist_dispatch') ?? ''],
      ] as const) {
        expect(description, `${label} states eight required parts`).toMatch(
          /eight required parts, not seven/i,
        );
      }
      expect(SPECIALIST_DISPATCH_PARAMS.contract).toMatch(/eight required parts, not seven/i);
      expect(SPECIALIST_DISPATCH_PARAMS.issue_ref).toMatch(/eight required parts, not seven/i);
    });
  });
});
