// DARTHFEEDOR-1207: a provider auth/quota failure can leave both assistant text and
// stderr empty; the runner must surface the captured provider api_error instead of
// the useless 'pi produced no assistant text'. Kept out of the quarantined
// script-runner.test.ts baseline (SPECIALISTS-121) so it runs by default.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { piSessionCreateMock, spawnMock, spawnSyncMock, resolveGlobalNodeModulesDirMock, resolveRuntimeToolContractMock } = vi.hoisted(() => ({
  piSessionCreateMock: vi.fn(),
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(() => ({ status: 1, stdout: '', stderr: '' })),
  resolveGlobalNodeModulesDirMock: vi.fn(() => undefined),
  resolveRuntimeToolContractMock: vi.fn(() => undefined),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock('../../../src/pi/session.js', () => ({
  PiAgentSession: { create: piSessionCreateMock },
  resolveGlobalNodeModulesDir: resolveGlobalNodeModulesDirMock,
  resolveRuntimeToolContract: resolveRuntimeToolContractMock,
  resolveExecutionExtensionSelection: vi.fn(() => ({ excludeExtensions: [], extensionSources: [], offline: true })),
  resolvePermissionTools: vi.fn(() => undefined),
  applyExtensionToolPolicyGate: vi.fn(),
}));

vi.mock('../../../src/specialist/observability-sqlite.js', () => ({
  createObservabilitySqliteClient: vi.fn(() => null),
  createObservabilitySqliteClientAtPath: vi.fn(() => null),
}));

import { runScriptSpecialist } from '../../../src/specialist/script-runner.js';

const baseSpec = {
  specialist: {
    execution: {
      interactive: false,
      requires_worktree: false,
      permission_required: 'MEDIUM',
      model: 'nano-gpt/minimax/minimax-m3',
      fallback_model: 'nano-gpt/z-ai/glm-5',
      timeout_ms: 1000,
      response_format: 'markdown',
      output_type: 'synthesis',
    },
    prompt: {
      task_template: 'draft $name',
      output_schema: { type: 'object', required: ['unreleased_summary', 'sections'] },
    },
    skills: { scripts: [] },
  },
} as const;

function makeLoader(spec: unknown = baseSpec) {
  return {
    get: vi.fn().mockResolvedValue(spec),
  };
}

beforeEach(() => {
  resolveRuntimeToolContractMock.mockReturnValue({
    effectiveTier: 'MEDIUM',
    toolsFlag: 'read,grep,find,ls',
    exposedExtensionSources: [],
    toolsList: ['read', 'grep', 'find', 'ls'],
    nativeTools: ['read', 'grep', 'find', 'ls'],
    extensionTools: [],
    deniedNativeTools: [],
    deniedNativesMode: 'soft',
    preferenceSignals: [],
    downgradeReasons: [],
    warnings: [],
    extensions: {},
  });
});

afterEach(() => {
  piSessionCreateMock.mockReset();
  spawnMock.mockReset();
});

describe('runScriptSpecialist empty assistant text surfaces provider api_error (DARTHFEEDOR-1207)', () => {
  it('reports the captured provider error instead of "pi produced no assistant text"', async () => {
    const session = {
      start: vi.fn(async () => undefined),
      prompt: vi.fn(async () => undefined),
      waitForDone: vi.fn(async () => {
        const options = piSessionCreateMock.mock.calls[0][0];
        options.onMetric({
          type: 'api_error',
          source: 'rpc',
          errorMessage: 'HTTP 401 {"message":"Invalid session","type":"invalid_api_key"}',
        });
      }),
      getLastOutput: vi.fn(async () => ''),
      getStderr: vi.fn(() => ''),
      close: vi.fn(async () => undefined),
      kill: vi.fn(),
    };
    piSessionCreateMock.mockResolvedValue(session);

    const result = await runScriptSpecialist(
      { specialist: 'service-knowledge-sync', variables: { name: 'release notes' } },
      {
        loader: makeLoader() as never,
        projectDir: '.',
        surface: 'script',
        trust: { allowWriteCapable: true },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('401');
    expect(result.error).toContain('invalid_api_key');
    expect(result.error_type).toBe('auth');
    // The auth failure must stop the model-chain walk, not burn the fallback.
    expect(piSessionCreateMock).toHaveBeenCalledTimes(1);
  });
});
