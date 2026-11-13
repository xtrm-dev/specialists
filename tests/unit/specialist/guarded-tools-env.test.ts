import { describe, expect, it } from 'vitest';

import { createGuardedTools } from '../../../src/activation/guarded-tools.js';
import type { PiSdk } from '../../../src/activation/pi-sdk.js';

/**
 * The host reconstructs `bash` as a lease-guarded custom tool, which is the ONLY place an
 * activation's identity env can be attached without touching the host process env
 * (SPECIALISTS-4456). These tests pin that attachment: which factory gets options, which
 * does not, and that no options are passed when the activation has no identity.
 */
function recordingSdk(calls: Array<{ factory: string; args: unknown[] }>): PiSdk {
  const factory = (name: string) => (...args: unknown[]) => {
    calls.push({ factory: name, args });
    return { name: name.replace('create', '').replace('Tool', '').toLowerCase(), execute: async () => 'ran' };
  };
  return {
    defineTool: (definition: Record<string, unknown>) => definition,
    createBashTool: factory('createBashTool'),
    createEditTool: factory('createEditTool'),
    createWriteTool: factory('createWriteTool'),
    createPowerShellTool: factory('createPowerShellTool'),
  } as unknown as PiSdk;
}

const admitAll = () => ({ allow: true } as const);

describe('createGuardedTools — activation env channel (SPECIALISTS-4456)', () => {
  it('passes a spawn hook to the bash factory when the activation has an identity', () => {
    const calls: Array<{ factory: string; args: unknown[] }> = [];
    createGuardedTools(recordingSdk(calls), {
      toolNames: ['bash'],
      cwd: '/w',
      admit: admitAll,
      env: { XTRM_ROLE: 'reviewer', SUBSTRATE_HOLDER: 'sp-pr-reviewer-abc' },
    });

    const bash = calls.find((call) => call.factory === 'createBashTool')!;
    expect(bash.args[0]).toBe('/w');
    const options = bash.args[1] as { spawnHook: (context: { command: string; cwd: string; env: NodeJS.ProcessEnv }) => { env: NodeJS.ProcessEnv } };
    expect(typeof options.spawnHook).toBe('function');
    const applied = options.spawnHook({ command: 'git push', cwd: '/w', env: { XTRM_ROLE: 'worker' } });
    expect(applied.env.XTRM_ROLE).toBe('reviewer');
    expect(applied.env.SUBSTRATE_HOLDER).toBe('sp-pr-reviewer-abc');
  });

  it('leaves the bash factory optionless when the activation has no identity', () => {
    const calls: Array<{ factory: string; args: unknown[] }> = [];
    createGuardedTools(recordingSdk(calls), {
      toolNames: ['bash'],
      cwd: '/w',
      admit: admitAll,
      env: {},
    });

    expect(calls.find((call) => call.factory === 'createBashTool')!.args).toEqual(['/w']);
  });

  it('never passes options to a non-shell factory', () => {
    // edit/write take no options on the SDKs this host supports; a second argument there
    // would be an untested surface for no gain (the identity reaches git and gh, not files).
    const calls: Array<{ factory: string; args: unknown[] }> = [];
    createGuardedTools(recordingSdk(calls), {
      toolNames: ['bash', 'edit', 'write'],
      cwd: '/w',
      admit: admitAll,
      env: { XTRM_ROLE: 'reviewer' },
    });

    expect(calls.find((call) => call.factory === 'createEditTool')!.args).toEqual(['/w']);
    expect(calls.find((call) => call.factory === 'createWriteTool')!.args).toEqual(['/w']);
    expect(calls.find((call) => call.factory === 'createBashTool')!.args).toHaveLength(2);
  });

  it('still consults the lease before running the shell', async () => {
    const calls: Array<{ factory: string; args: unknown[] }> = [];
    let executed = 0;
    const sdk = {
      defineTool: (definition: Record<string, unknown>) => definition,
      createBashTool: (...args: unknown[]) => {
        calls.push({ factory: 'createBashTool', args });
        return { name: 'bash', execute: async () => { executed += 1; return 'ran'; } };
      },
    } as unknown as PiSdk;

    const refused = createGuardedTools(sdk, {
      toolNames: ['bash'],
      cwd: '/w',
      admit: () => ({ allow: false, reason: 'lease held by another activation' }),
      env: { XTRM_ROLE: 'reviewer' },
    });
    const result = await (refused.tools[0] as { execute: (...args: unknown[]) => Promise<{ details: unknown }> })
      .execute('id', { command: 'git push' });

    expect(executed).toBe(0);
    expect(result.details).toEqual({ blocked: true, tool: 'bash' });
  });
});
