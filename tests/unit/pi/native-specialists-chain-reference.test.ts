import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    Array: (items: unknown) => ({ type: 'array', items }),
    Union: (variants: unknown, opts = {}) => ({ anyOf: variants, ...opts }),
    Literal: (value: unknown) => ({ const: value }),
    Enum: (values: object) => ({ enum: Object.values(values) }),
    Unknown: () => ({ type: 'unknown' }),
    Null: () => ({ type: 'null' }),
    Optional: (schema: unknown) => schema,
  },
}));

const EXTENSION_PATH = resolve('config/pi-extensions/native-specialists/index.mjs');
const HOOK_SCRIPT = fileURLToPath(
  new URL('../../../plugins/specialists/scripts/chain-suggest.mjs', import.meta.url),
);

const EXPECTED_SUGGESTION =
  'Chain reference: the using-specialists skill, references/chain-recipes.md — read it and choose the next step by scrutiny and your own judgment.';

async function loadExtension() {
  const mod = await import(EXTENSION_PATH);
  return mod;
}

const SNAPSHOT = {
  activationId: 'act:chain-1',
  participantId: 'specialist::explorer',
  attemptId: 'att:chain-1:1',
  specialist: 'explorer',
  issueId: 'iss_XTRM-1',
  issueRef: 'XTRM-1',
  issueRevision: 1,
  contractHash: 'hash-test',
  executionBindingId: 'exb-test',
  state: 'running',
  access: 'read',
  workspace: { repositoryRoot: '/r', worktreePath: '/r/wt' },
  piSessionId: 'sess-1',
  configuredModel: 'm',
  resolvedModel: 'm',
  modelOverride: false,
  startedAt: 1,
  lastActivityAt: 1,
};

function makeFakeHost() {
  const host = {
    start: vi.fn(async (req: { specialist: string; issueRef?: string }) => {
      const ref = req.issueRef ?? 'XTRM-1';
      return {
        activationId: 'act:chain-1',
        participantId: 'specialist::explorer',
        attemptId: 'att:chain-1:1',
        specialist: req.specialist,
        issueId: `iss_${ref}`,
        issueRef: ref,
        issueRevision: 1,
        contractHash: 'hash-test',
        executionBindingId: 'exb-test',
        access: 'read',
        workspace: SNAPSHOT.workspace,
        resolvedModel: 'm',
        stepContract: { rootWorkRef: ref, inputs: [1], outputs: [1] },
        result: Promise.resolve({
          activationId: 'act:chain-1',
          status: 'completed',
          output: 'report',
        }),
      };
    }),
    inspect: vi.fn(() => SNAPSHOT),
    list: vi.fn(() => [SNAPSHOT]),
    pendingAsks: vi.fn(() => []),
  };
  return host;
}

function makeFakePi() {
  const tools: Array<{ name: string; execute: (...args: never[]) => Promise<never> }> = [];
  return {
    registerTool: (def: (typeof tools)[number]) => tools.push(def),
    registerCommand: () => {},
    registerFlag: () => {},
    registerMessageRenderer: () => {},
    on: () => {},
    getFlag: () => false,
    sendMessage: () => {},
    getAllTools: () => [...tools],
  };
}

function toolNamed(pi: ReturnType<typeof makeFakePi>, name: string) {
  const tool = pi.getAllTools().find((t) => t.name === name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return tool as unknown as { execute: (...args: never[]) => Promise<{ content: Array<{ text: string }>; structuredContent: Record<string, unknown> }> };
}

function hookSuggestion(): string {
  const result = spawnSync('bun', [HOOK_SCRIPT], {
    input: JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__plugin_specialists_specialists__specialist_dispatch',
      tool_input: { specialist: 'explorer', issue_ref: 'XTRM-1' },
      tool_response: { status: 'dispatched', activation_id: 'act:parity-probe' },
      session_id: 'sess-parity-probe',
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      SPECIALISTS_CHAIN_SUGGEST_DIR: `${process.env.TMPDIR ?? '/tmp'}/chain-parity-${process.pid}`,
    },
  });
  return (JSON.parse(result.stdout) as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;
}

describe('specialist_dispatch chain reference (SPECIALISTS-4364)', () => {
  it('appends the shared suggestion text without changing any other result field', async () => {
    const mod = await loadExtension();
    const pi = makeFakePi();
    const host = makeFakeHost();
    mod.default(pi, { createHost: () => host });
    const dispatch = toolNamed(pi, 'specialist_dispatch');
    const out = await dispatch.execute('tc1', { specialist: 'explorer', issue_ref: 'XTRM-1' });
    const payload = out.structuredContent as Record<string, unknown>;

    // The one appended informational line, byte-identical to the Claude hook.
    expect(payload.chain_reference).toBe(EXPECTED_SUGGESTION);
    expect(payload.chain_reference).toBe(hookSuggestion());

    // No existing field changed: the dispatch outcome is intact.
    expect(payload.status).toBe('dispatched');
    expect(payload.activation_id).toBe('act:chain-1');
    expect(payload.specialist).toBe('explorer');
    expect(payload.issue_ref).toBe('XTRM-1');
    expect(payload.step_contract).toMatchObject({ root_work_ref: 'XTRM-1', inputs: 1, outputs: 1 });

    // Model-facing text and script-facing value still agree (extension invariant).
    const text = (out.content ?? []).find((c) => c.type === 'text')?.text ?? '';
    expect(JSON.parse(text)).toEqual(payload);

    // Informational only: no role prescribed, no gate enforced.
    expect(String(payload.chain_reference)).not.toContain('seconder');
  });

  it('does not append the suggestion to a refused dispatch (no activation)', async () => {
    const mod = await loadExtension();
    const pi = makeFakePi();
    const host = makeFakeHost();
    mod.default(pi, { createHost: () => host });
    const dispatch = toolNamed(pi, 'specialist_dispatch');
    // Both locators at once is refused before any activation exists.
    const out = await dispatch.execute('tc1', {
      specialist: 'explorer',
      issue_ref: 'XTRM-1',
      bead_id: 'XTRM-1',
    });
    const payload = out.structuredContent as Record<string, unknown>;
    expect(payload.status).toBe('rejected');
    expect(payload).not.toHaveProperty('chain_reference');
  });
});
