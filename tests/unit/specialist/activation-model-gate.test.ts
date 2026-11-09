import { describe, it, expect } from 'vitest';
import { validateModelAvailable } from '../../../src/activation/model-gate.js';
import type { PiSdk, PiModelRuntimeLike, PiModelScopeResult } from '../../../src/activation/pi-sdk.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';

/**
 * These cases mirror behaviour reproduced against pi 0.84.3 and re-verified against 0.85.1
 * (unitAI-rrdnt.17). The point of the gate is that
 * BOTH halves are load-bearing: each of the first two cases is accepted by one half alone.
 */

function sdkReturning(result: PiModelScopeResult): PiSdk {
  return {
    createAgentSession: async () => { throw new Error('not used'); },
    DefaultResourceLoader: FakeResourceLoader,
    getAgentDir: () => FAKE_AGENT_DIR,
    ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
    resolveModelScopeWithDiagnostics: () => result,
    defineTool: (d) => d,
  };
}

function runtime(authed: boolean): PiModelRuntimeLike {
  return { hasConfiguredAuth: () => authed };
}

const NO_DIAGNOSTICS: PiModelScopeResult['diagnostics'] = [];

describe('validateModelAvailable', () => {
  it('rejects an unknown model id via the no-match diagnostic', async () => {
    const sdk = sdkReturning({
      scopedModels: [],
      diagnostics: [{ type: 'warning', code: 'no-match', message: 'No models match pattern "nope/nope"', pattern: 'nope/nope' }],
    });

    const result = await validateModelAvailable(sdk, runtime(true), 'nope/nope');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('No models match');
  });

  it('rejects a fabricated custom model under a known, authed provider — the case an auth-only gate would accept', async () => {
    // pi returns a synthesized model here with only a warning, and hasConfiguredAuth is
    // true, so the auth half passes. Only the no-match diagnostic catches it.
    const sdk = sdkReturning({
      scopedModels: [],
      diagnostics: [{ type: 'warning', code: 'no-match', message: 'No models match pattern "nvidia/no-such-model-at-all"', pattern: 'nvidia/no-such-model-at-all' }],
    });

    const result = await validateModelAvailable(sdk, runtime(true), 'nvidia/no-such-model-at-all');

    expect(result.ok).toBe(false);
  });

  it('rejects a real model whose provider has no configured auth — the case the diagnostic alone would accept', async () => {
    const sdk = sdkReturning({
      scopedModels: [{ model: { id: 'real-model', provider: 'someprovider' } }],
      diagnostics: NO_DIAGNOSTICS,
    });

    const result = await validateModelAvailable(sdk, runtime(false), 'someprovider/real-model');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('no configured auth');
    expect(result.provider).toBe('someprovider');
  });

  it('accepts a real, authed model', async () => {
    const sdk = sdkReturning({
      scopedModels: [{ model: { id: 'good-model', provider: 'anthropic' } }],
      diagnostics: NO_DIAGNOSTICS,
    });

    const result = await validateModelAvailable(sdk, runtime(true), 'anthropic/good-model');

    expect(result.ok).toBe(true);
    expect(result.provider).toBe('anthropic');
    expect(result.resolvedModel).toBe('anthropic/good-model');
  });

  it('admits a bridged model PROVISIONALLY for an opted-in extension provider (SPECIALISTS-4405)', async () => {
    // The bridge registers its provider when the session binds, after this gate runs, so the
    // pattern can never resolve here. Admission is provisional and the host verifies it on the
    // live session before the first turn.
    const sdk = sdkReturning({
      scopedModels: [],
      diagnostics: [{ type: 'warning', code: 'no-match', message: 'No models match pattern "claude-bridge/claude-opus-5-5"', pattern: 'claude-bridge/claude-opus-5-5' }],
    });

    const result = await validateModelAvailable(sdk, runtime(false), 'claude-bridge/claude-opus-5-5', {
      extensionProviders: ['claude-bridge'],
    });

    expect(result.ok).toBe(true);
    expect(result.provisional).toBe(true);
    expect(result.provider).toBe('claude-bridge');
    expect(result.model?.api).toBe('claude-bridge');
    expect(result.model?.provider).toBe('claude-bridge');
    expect(result.model?.id).toBe('claude-opus-5-5');
  });

  it('refuses a bridged model when no extension provider was opted in — today\'s behaviour', async () => {
    const sdk = sdkReturning({
      scopedModels: [],
      diagnostics: [{ type: 'warning', code: 'no-match', message: 'No models match pattern "claude-bridge/claude-opus-5-5"', pattern: 'claude-bridge/claude-opus-5-5' }],
    });

    const result = await validateModelAvailable(sdk, runtime(false), 'claude-bridge/claude-opus-5-5');

    expect(result.ok).toBe(false);
    expect(result.provisional).toBeUndefined();
    expect(result.reason).toContain('No models match');
  });

  it('does not extend the carve-out to a provider that was not named', async () => {
    const sdk = sdkReturning({
      scopedModels: [],
      diagnostics: [{ type: 'warning', code: 'no-match', message: 'No models match pattern "other/x"', pattern: 'other/x' }],
    });

    const result = await validateModelAvailable(sdk, runtime(false), 'other/x', {
      extensionProviders: ['claude-bridge'],
    });

    expect(result.ok).toBe(false);
    expect(result.provisional).toBeUndefined();
  });

  it('does not let the carve-out bypass the auth half for a provider that DOES resolve', async () => {
    // A registered-but-unauthed provider must still be refused: the carve-out covers the
    // no-match case only, which is exactly the provider that is not there yet.
    const sdk = sdkReturning({
      scopedModels: [{ model: { id: 'claude-opus-5-5', provider: 'claude-bridge' } }],
      diagnostics: NO_DIAGNOSTICS,
    });

    const result = await validateModelAvailable(sdk, runtime(false), 'claude-bridge/claude-opus-5-5', {
      extensionProviders: ['claude-bridge'],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('no configured auth');
  });

  it('rejects rather than throwing when model resolution itself fails', async () => {
    const sdk: PiSdk = {
      createAgentSession: async () => { throw new Error('not used'); },
      DefaultResourceLoader: FakeResourceLoader,
      getAgentDir: () => FAKE_AGENT_DIR,
      ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
      resolveModelScopeWithDiagnostics: () => { throw new Error('registry exploded'); },
      defineTool: (d) => d,
    };

    const result = await validateModelAvailable(sdk, runtime(true), 'anything/at-all');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('registry exploded');
  });
});
