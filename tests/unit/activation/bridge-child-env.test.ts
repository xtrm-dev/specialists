import { describe, expect, it } from 'vitest';
import { bridgeGitBlockOmitted, bridgedChildEnv, scopeBridgedChildEnv } from '../../../src/activation/bridge-child-env.js';
import type { PiModelRuntimeLike } from '../../../src/activation/pi-sdk.js';

/**
 * SPECIALISTS-4498: the provider env pi-claude-bridge lays over the host env for its Claude Code
 * child. `ccChildEnv` throws on HOME/USERPROFILE/CLAUDE_CONFIG_DIR and turns an empty value into a
 * delete, so what the host hands it must already respect both rules.
 */
describe('bridgedChildEnv', () => {
  it('keeps the identity and drops PATH and the keys the bridge refuses', () => {
    expect(bridgedChildEnv({
      XTMUX_AGENT_ROLE: 'pr-reviewer',
      SUBSTRATE_HOLDER: 'sp-pr-reviewer-abc',
      XTRM_AGENT_NAME: 'sp-pr-reviewer-abc',
      PATH: '/shim:/usr/bin',
      HOME: '/elsewhere',
      userprofile: 'C:\\elsewhere',
      CLAUDE_CONFIG_DIR: '/elsewhere/.claude',
    })).toEqual({
      XTMUX_AGENT_ROLE: 'pr-reviewer',
      SUBSTRATE_HOLDER: 'sp-pr-reviewer-abc',
      XTRM_AGENT_NAME: 'sp-pr-reviewer-abc',
    });
  });

  it('carries a GIT_CONFIG_* block whole when every value is non-empty', () => {
    const block = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.useConfigOnly', GIT_CONFIG_VALUE_0: 'true' };
    expect(bridgedChildEnv({ SUBSTRATE_HOLDER: 'h', ...block })).toEqual({ SUBSTRATE_HOLDER: 'h', ...block });
  });

  it('leaves out a GIT_CONFIG_* block whose empty reset the bridge would turn into a delete', () => {
    // Carried, git would see GIT_CONFIG_COUNT=2 with VALUE_0 missing and refuse every command.
    expect(bridgedChildEnv({
      SUBSTRATE_HOLDER: 'h',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.helper',
      GIT_CONFIG_VALUE_1: '!xt identity credential',
    })).toEqual({ SUBSTRATE_HOLDER: 'h' });
  });
});

describe('bridgedChildEnv PATH and the omitted git block', () => {
  it('drops PATH in any letter case', () => {
    expect(bridgedChildEnv({ SUBSTRATE_HOLDER: 'h', Path: 'C:\\shim', path: '/p', PATH: '/q' })).toEqual({ SUBSTRATE_HOLDER: 'h' });
  });

  it('says when a GIT_CONFIG_* block is left out, so the caller can warn', () => {
    const reset = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '' };
    expect(bridgeGitBlockOmitted({ SUBSTRATE_HOLDER: 'h', ...reset })).toBe(true);
    expect(bridgeGitBlockOmitted({ SUBSTRATE_HOLDER: 'h', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a', GIT_CONFIG_VALUE_0: 'b' })).toBe(false);
    expect(bridgeGitBlockOmitted({ SUBSTRATE_HOLDER: 'h' })).toBe(false);
  });
});

describe('scopeBridgedChildEnv', () => {
  const runtimeWith = (env?: Record<string, string>): PiModelRuntimeLike => ({
    hasConfiguredAuth: () => true,
    getAuth: async () => ({ auth: { apiKey: 'not-used' }, ...(env ? { env } : {}) }),
  });

  it('lays the identity over a claude-bridge resolution, model or provider id, over the credential env', async () => {
    const runtime = runtimeWith({ ANTHROPIC_BASE_URL: 'https://proxy.invalid', XTMUX_AGENT_ROLE: 'stale' });
    expect(scopeBridgedChildEnv(runtime, { XTMUX_AGENT_ROLE: 'pr-reviewer', SUBSTRATE_HOLDER: 'sp-x' })).toBe(true);

    for (const target of [{ provider: 'claude-bridge', id: 'claude-opus-5-5' }, 'claude-bridge']) {
      expect(await runtime.getAuth!(target)).toEqual({
        auth: { apiKey: 'not-used' },
        env: { ANTHROPIC_BASE_URL: 'https://proxy.invalid', XTMUX_AGENT_ROLE: 'pr-reviewer', SUBSTRATE_HOLDER: 'sp-x' },
      });
    }
  });

  it('leaves every other provider and an unresolved request untouched', async () => {
    const runtime = runtimeWith();
    scopeBridgedChildEnv(runtime, { SUBSTRATE_HOLDER: 'sp-x' });
    expect(await runtime.getAuth!({ provider: 'anthropic' })).toEqual({ auth: { apiKey: 'not-used' } });

    const unresolved: PiModelRuntimeLike = { hasConfiguredAuth: () => false, getAuth: async () => undefined };
    scopeBridgedChildEnv(unresolved, { SUBSTRATE_HOLDER: 'sp-x' });
    expect(await unresolved.getAuth!('claude-bridge')).toBeUndefined();
  });

  it('reports false when there is nothing to carry or no getAuth to scope', () => {
    expect(scopeBridgedChildEnv(runtimeWith(), {})).toBe(false);
    expect(scopeBridgedChildEnv({ hasConfiguredAuth: () => true }, { SUBSTRATE_HOLDER: 'sp-x' })).toBe(false);
  });
});
