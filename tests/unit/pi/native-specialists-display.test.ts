import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Fleet display fallback and preference for the Pi extension (SPECIALISTS-4365).
 *
 * - a recorded payload WITHOUT `display` renders the old output with zero errors
 *   (the local formatters are retained as the fallback);
 * - a payload WITH `display` is preferred (same strings the runtime computed),
 *   with styling applied locally.
 */

// The extension imports Type from 'typebox' (resolved from pi's own install at
// runtime). Under vitest the worktree has no typebox, so stub the members the
// factory uses — parameter schemas AND the output schemas — since they are
// captured, never validated, in this test.
vi.mock('typebox', () => ({
  Type: {
    Object: (props) => ({ type: 'object', properties: props }),
    String: (opts = {}) => ({ type: 'string', ...opts }),
    Integer: (opts = {}) => ({ type: 'integer', ...opts }),
    Number: (opts = {}) => ({ type: 'number', ...opts }),
    Boolean: (opts = {}) => ({ type: 'boolean', ...opts }),
    Array: (items) => ({ type: 'array', items }),
    Union: (variants, opts = {}) => ({ anyOf: variants, ...opts }),
    Literal: (value) => ({ const: value }),
    Enum: (values, opts = {}) => ({ enum: Object.values(values), ...opts }),
    Unknown: () => ({ type: 'unknown' }),
    Null: () => ({ type: 'null' }),
    Optional: (schema) => schema,
  },
}));

const EXTENSION_PATH = resolve('config/pi-extensions/native-specialists/index.mjs');

async function loadExtension() {
  expect(existsSync(EXTENSION_PATH)).toBe(true);
  return import(EXTENSION_PATH);
}

/** Strip SGR so the test asserts CONTENT separately from styling. */
function plain(line: string): string {
  return String(line).replace(/\x1b\[[0-9;]*m/g, '');
}

// A recorded compact payload WITHOUT the display block: the old shape.
const SETTLED_ROW = {
  activation_id: 'act:aaaabbbb-cccc',
  specialist: 'explorer',
  bead_id: 'XTRM-1',
  issue_ref: 'XTRM-1',
  state: 'settled',
  access: 'read',
  resolved_model: 'test-model',
  elapsed_s: 134,
  turn_count: 3,
  token_usage: { input_tokens: 9000, output_tokens: 3000 },
};

describe('Pi fleet display fallback and preference (SPECIALISTS-4365)', () => {
  it('renders the old output with zero errors when display is absent', async () => {
    const mod = await loadExtension();
    const fleet = { activations: [SETTLED_ROW], asks: [] };
    let header: string = '';
    let rows: string[] = [];
    expect(() => {
      header = mod.renderFleetHeader(fleet);
      rows = mod.renderFleetRowLines(SETTLED_ROW, [], Date.now());
    }).not.toThrow();
    expect(plain(header)).toBe('  specialists 1 waiting');
    // Marker, identity, model facts, then the space-separated stats.
    expect(plain(rows[0]!)).toContain('✓ explorer:aaaabbbb-cccc XTRM-1 test-model');
    expect(plain(rows[0]!)).toContain('2m14s 3 turns 12k');
    // The section renderer agrees with the row renderer.
    const lines = mod.renderSectionLines(fleet, { nowMs: Date.now() });
    expect(lines.map(plain).join('\n')).toContain('2m14s 3 turns 12k');
  });

  it('prefers the runtime display block when present', async () => {
    const mod = await loadExtension();
    const fleet = {
      activations: [SETTLED_ROW],
      asks: [],
      display: {
        header: '1 waiting',
        activations: [{
          activation_id: 'act:aaaabbbb-cccc',
          marker: '✓',
          metrics: '2m14s 3 turns 12k',
          work: 'XTRM-1',
        }],
      },
    };
    expect(plain(mod.renderFleetHeader(fleet))).toBe('  specialists 1 waiting');
    const rows = mod.renderFleetRowLines(
      SETTLED_ROW,
      [],
      Date.now(),
      fleet.display.activations[0],
    );
    expect(plain(rows[0]!)).toContain('✓ explorer:aaaabbbb-cccc XTRM-1 test-model');
    expect(plain(rows[0]!)).toContain('2m14s 3 turns 12k');
    // A display entry whose strings differ from the local computation wins.
    const custom = {
      ...fleet,
      display: {
        header: 'custom header',
        activations: [{
          activation_id: 'act:aaaabbbb-cccc',
          marker: '●',
          metrics: 'asked 19s',
          work: 'XTRM-9',
        }],
      },
    };
    expect(plain(mod.renderFleetHeader(custom))).toBe('  specialists custom header');
    const customRows = mod.renderFleetRowLines(
      SETTLED_ROW,
      [],
      Date.now(),
      custom.display.activations[0],
    );
    expect(plain(customRows[0]!)).toContain('XTRM-9');
    expect(plain(customRows[0]!)).toContain('asked 19s');
    expect(plain(customRows[0]!)).not.toContain('2m14s');
    // Section and overlay rows thread the same entry through.
    const section = mod.renderSectionLines(custom, { nowMs: Date.now() });
    expect(section.map(plain).join('\n')).toContain('asked 19s');
    const overlay = mod.buildOverlayRows(custom, Date.now());
    expect(plain(overlay[0]!.line)).toContain('asked 19s');
  });

  it('an empty fleet still headers idle with and without display', async () => {
    const mod = await loadExtension();
    expect(plain(mod.renderFleetHeader({ activations: [], asks: [] }))).toBe('  specialists idle');
    expect(
      plain(mod.renderFleetHeader({ activations: [], asks: [], display: { header: 'idle', activations: [] } })),
    ).toBe('  specialists idle');
  });
});
