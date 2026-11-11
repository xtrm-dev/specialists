// ISSUE: xtrm-wiy5n.4.11 — quarantined from the default test baseline.
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ASSISTANT_TEXT_LIMIT_BYTES,
  DEFAULT_PENDING_LINE_LIMIT_BYTES,
  DEFAULT_PROMPT_LIMIT_BYTES,
  DEFAULT_STDERR_LIMIT_BYTES,
  collectModelCandidates,
  collectRequiredOutputKeys,
  classifyAttempt,
  compatGuard,
  detectTemplateFieldMisuse,
  isRetryableModelFailure,
  renderTaskTemplate,
  resolveAssistantTextLimitBytes,
  resolvePromptLimitBytes,
  applyOutputContract,
  runScriptSpecialist,
} from '../../../src/specialist/script-runner.js';
import { resolveExecutionExtensionSelection } from '../../../src/pi/session.js';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';

const { spawnMock, spawnSyncMock, piSessionCreateMock, resolveGlobalNodeModulesDirMock, resolveRuntimeToolContractMock, RuntimeToolCatalogResolutionErrorMock, sqliteClients } = vi.hoisted(() => {
  class RuntimeToolCatalogResolutionErrorMock extends Error {
    readonly code = 'runtime_tool_catalog_unavailable';

    constructor() {
      super('Runtime tool catalog unavailable or invalid; refusing to launch with Pi default tools. Reinstall or rebuild Specialists and verify config/catalog/index.json.');
      this.name = 'RuntimeToolCatalogResolutionError';
    }
  }

  return {
    spawnMock: vi.fn(),
    spawnSyncMock: vi.fn(() => ({ status: 1, stdout: '', stderr: '' })),
    piSessionCreateMock: vi.fn(),
    resolveGlobalNodeModulesDirMock: vi.fn(() => undefined),
    resolveRuntimeToolContractMock: vi.fn(() => undefined),
    RuntimeToolCatalogResolutionErrorMock,
    sqliteClients: new Map<string, any>(),
  };
});

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock('../../../src/pi/session.js', () => ({
  PiAgentSession: { create: piSessionCreateMock },
  RuntimeToolCatalogResolutionError: RuntimeToolCatalogResolutionErrorMock,
  resolveGlobalNodeModulesDir: resolveGlobalNodeModulesDirMock,
  resolveRuntimeToolContract: resolveRuntimeToolContractMock,
  resolveExecutionExtensionSelection: vi.fn((extensions?: Record<string, boolean | null | undefined>) => {
    const excludeExtensions: string[] = [];
    const extensionSources: string[] = [];
    for (const [source, enabled] of Object.entries(extensions ?? {})) {
      if (source === 'serena') continue;
      if (source === 'gitnexus') {
        if (enabled === false) excludeExtensions.push('pi-gitnexus');
        continue;
      }
      if (enabled === true) extensionSources.push(source);
    }
    return {
      excludeExtensions,
      extensionSources,
      offline: !extensionSources.some((source) => source.startsWith('npm:') || source.startsWith('git:') || source.startsWith('http://') || source.startsWith('https://')),
    };
  }),
  resolvePermissionTools: vi.fn((options?: { level?: string }) => {
    const contract = resolveRuntimeToolContractMock(options);
    return contract?.toolsFlag;
  }),
  applyExtensionToolPolicyGate: vi.fn((args: string[], contract?: { exposedExtensionSources?: string[]; nativeTools?: string[] }, policyEnv: Record<string, string> = {}) => {
    // Faithful mock of the real gate (session.ts): no-op without exposed
    // sources; otherwise -nbt + policy -e LAST + bounded env channel. The
    // policy path is a sentinel here — exact path equality is verified in
    // tests/unit/pi/session.test.ts and the integration suite against the
    // real resolver.
    if (!contract || (contract.exposedExtensionSources?.length ?? 0) === 0) return;
    args.push('--no-builtin-tools');
    args.push('-e', '__POLICY_EXT__');
    policyEnv.__NATIVE_TOOLS_ENV__ = contract.nativeTools?.join(',') ?? '';
  }),
}));

vi.mock('../../../src/specialist/observability-sqlite.js', () => {
  const createClient = (dbPath: string) => {
    const eventsByJobId = new Map<string, any[]>();
    const append = (jobId: string, event: any) => {
      eventsByJobId.set(jobId, [...(eventsByJobId.get(jobId) ?? []), event]);
    };
    return {
      appendEvent: vi.fn((jobId: string, _specialist: string, _beadId: string | undefined, event: any) => append(jobId, event)),
      upsertStatusWithEvent: vi.fn((status: any, event: any) => append(status.id, event)),
      upsertStatusWithEventAndResult: vi.fn((status: any, event: any) => append(status.id, event)),
      readEvents: vi.fn((jobId: string) => eventsByJobId.get(jobId) ?? []),
      close: vi.fn(),
    };
  };
  return {
    createObservabilitySqliteClient: vi.fn(() => null),
    createObservabilitySqliteClientAtPath: vi.fn((dbPath: string) => {
      if (!sqliteClients.has(dbPath)) sqliteClients.set(dbPath, createClient(dbPath));
      return sqliteClients.get(dbPath);
    }),
  };
});

const baseSpec = {
  specialist: {
    execution: {
      interactive: false,
      requires_worktree: false,
      permission_required: 'READ_ONLY',
      model: 'anthropic/claude-sonnet-4-6',
      fallback_model: 'google-gemini-cli/gemini-3.1-pro-preview',
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

beforeEach(() => {
  resolveRuntimeToolContractMock.mockReturnValue(createResolvedToolContract());
});

afterEach(() => {
  spawnMock.mockReset();
  spawnSyncMock.mockClear();
  piSessionCreateMock.mockReset();
  resolveGlobalNodeModulesDirMock.mockReset();
  resolveGlobalNodeModulesDirMock.mockReturnValue(undefined);
  resolveRuntimeToolContractMock.mockReset();
  sqliteClients.clear();
  delete process.env.SPECIALISTS_SCRIPT_PROMPT_LIMIT_BYTES;
  delete process.env.SPECIALISTS_SCRIPT_STDOUT_LIMIT_BYTES;
});

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill = vi.fn();

  constructor() {
    super();
    this.stdin.write = vi.fn();
    this.stdin.end = vi.fn();
  }
}

function makeLoader(spec = baseSpec) {
  return {
    get: vi.fn().mockResolvedValue(spec),
  };
}

function createSpawnMock(): FakeChild {
  const child = new FakeChild();
  spawnMock.mockReturnValue(child as never);
  return child;
}

async function withPiExtensionPaths<T>(paths: readonly string[], run: () => Promise<T>): Promise<T> {
  const createdPaths = paths.filter((path) => !existsSync(path));
  try {
    for (const path of createdPaths) mkdirSync(path, { recursive: true });
    return await run();
  } finally {
    for (const path of createdPaths) rmSync(path, { recursive: true, force: true });
  }
}

function createResolvedToolContract(overrides: Partial<{
  effectiveTier: string;
  toolsFlag: string;
  toolsList: string[];
  nativeTools: string[];
  extensionTools: string[];
  gitnexusStatus: 'available' | 'disabled' | 'loaded_unhealthy' | 'catalog_incompatible' | 'not_installed';
  gitnexusTools: string[];
  packagePath: string;
  exposedExtensionSources: string[];
}> = {}) {
  const toolsList = overrides.toolsList ?? ['read', 'grep', 'find', 'ls', 'gitnexus_query'];
  const nativeTools = overrides.nativeTools ?? ['read', 'grep', 'find', 'ls'];
  const extensionTools = overrides.extensionTools ?? ['gitnexus_query'];
  const gitnexusTools = overrides.gitnexusTools ?? extensionTools;
  return {
    effectiveTier: overrides.effectiveTier ?? 'READ_ONLY',
    toolsFlag: overrides.toolsFlag ?? toolsList.join(','),
    exposedExtensionSources: overrides.exposedExtensionSources ?? [],
    toolsList,
    nativeTools,
    extensionTools,
    deniedNativeTools: [],
    deniedNativesMode: 'soft' as const,
    preferenceSignals: [],
    downgradeReasons: [],
    warnings: [],
    extensions: {
      gitnexus: {
        status: overrides.gitnexusStatus ?? 'available',
        packageName: 'pi-gitnexus',
        packagePath: overrides.packagePath ?? '/tmp/pi-gitnexus',
        activeTools: gitnexusTools,
      },
    },
  };
}


describe('runScriptSpecialist bridged candidate (SPECIALISTS-4425)', () => {
  it('does not walk to the next candidate when the bridged candidate fails retryably', async () => {
    const spec = {
      ...baseSpec,
      specialist: {
        ...baseSpec.specialist,
        execution: {
          ...baseSpec.specialist.execution,
          model: 'claude-bridge/claude-sonnet-5-5',
          fallback_model: 'openai-codex/gpt-5.4',
        },
      },
    } as never;
    const firstChild = new FakeChild();
    const secondChild = new FakeChild();
    spawnMock.mockReturnValueOnce(firstChild as never).mockReturnValueOnce(secondChild as never);

    const resultPromise = runScriptSpecialist(
      { specialist: 'changelog-keeper', variables: { name: 'release notes' } },
      { loader: makeLoader(spec) as never, projectDir: '.' },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    firstChild.stderr.emit('data', Buffer.from('429 insufficient_quota quota exceeded'));
    firstChild.emit('close', 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    secondChild.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'must-not-run' }] } })}\n`));
    secondChild.emit('close', 0);

    const result = await resultPromise;
    expect(result).toMatchObject({ success: false });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const spawnArgs = (spawnMock.mock.calls[0]?.[1] ?? []) as string[];
    expect(spawnArgs).toContain('claude-bridge/claude-sonnet-5-5');
    expect(spawnArgs).not.toContain('openai-codex/gpt-5.4');
  });

  it('still walks a non-bridged candidate (control)', async () => {
    const spec = {
      ...baseSpec,
      specialist: {
        ...baseSpec.specialist,
        execution: {
          ...baseSpec.specialist.execution,
          model: 'anthropic/claude-sonnet-4-6',
          fallback_model: 'openai-codex/gpt-5.4',
        },
      },
    } as never;
    const firstChild = new FakeChild();
    const secondChild = new FakeChild();
    spawnMock.mockReturnValueOnce(firstChild as never).mockReturnValueOnce(secondChild as never);

    const resultPromise = runScriptSpecialist(
      { specialist: 'changelog-keeper', variables: { name: 'release notes' } },
      { loader: makeLoader(spec) as never, projectDir: '.' },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    firstChild.stderr.emit('data', Buffer.from('429 insufficient_quota quota exceeded'));
    firstChild.emit('close', 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    secondChild.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } })}\n`));
    secondChild.emit('close', 0);

    const result = await resultPromise;
    expect(result).toMatchObject({ success: true });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
