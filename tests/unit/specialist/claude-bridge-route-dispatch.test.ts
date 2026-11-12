/**
 * Dispatch-level evidence for the Claude Code allow list (SPECIALISTS-4442).
 *
 * The loader is the one place the operator block is applied, so the runtimes must consume its
 * merged spec rather than re-deriving precedence: the native host (dispatch and retry), the
 * legacy runner and the script runner all read `loader.get(...)`. A listed Specialist that cannot
 * resolve a bridged model must be REFUSED with a dedicated code — never admitted and then billed
 * to another provider.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpecialistLoader, ClaudeBridgeRouteModelMismatchError } from '../../../src/specialist/loader.js';
import { NativeActivationHost, NULL_FORENSIC_SINK } from '../../../src/activation/native-host.js';
import type { DispatchRejectedError } from '../../../src/activation/types.js';
import { claudeBridgeRouteEnabled, claudeBridgeSessionOption } from '../../../src/pi/claude-bridge.js';

const SPEC = (name: string) => JSON.stringify({
  specialist: {
    metadata: { name, version: '1.0.0', description: 'demo', category: 'test' },
    execution: { model: 'anthropic/claude-sonnet-4-6', permission_required: 'READ_ONLY' },
    prompt: { task_template: 'Do $prompt' },
  },
});

describe('dispatch consumes the allow-list resolver (SPECIALISTS-4442)', () => {
  let root: string;
  let home: string;
  let project: string;
  let previousHome: string | undefined;
  let previousXdg: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bridge-route-dispatch-'));
    home = join(root, 'home');
    project = join(root, 'project');
    mkdirSync(join(project, 'config', 'specialists'), { recursive: true });
    writeFileSync(join(project, 'config', 'specialists', 'researcher.specialist.json'), SPEC('researcher'));
    previousHome = process.env.HOME;
    previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = join(root, 'xdg');
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    rmSync(root, { recursive: true, force: true });
  });

  const writeBlock = (block: Record<string, unknown>) => {
    mkdirSync(join(root, 'xdg', 'specialists'), { recursive: true });
    writeFileSync(join(root, 'xdg', 'specialists', 'user.json'), JSON.stringify({ claude_bridge: block }));
  };

  const hostWith = (loader: SpecialistLoader, loadSdk: () => Promise<never>) => new NativeActivationHost({
    loader,
    workItems: {} as never,
    forensics: NULL_FORENSIC_SINK,
    settlements: { listPendingPublication: () => [] } as never,
    loadSdk,
    cwd: project,
  });

  it('refuses a listed Specialist whose block resolves no bridged model, with the dedicated code', async () => {
    writeBlock({ enabled: true, specialists: ['researcher'], models: { researcher: 'anthropic/claude-sonnet-4-6' } });
    const loader = new SpecialistLoader({ projectDir: project });
    const host = hostWith(loader, async () => {
      throw new Error('the SDK must never load for a refused route');
    });

    const refusal = await host.start({
      specialist: 'researcher',
      issueRef: 'ISSUE-1',
      requestedByParticipantId: 'coordinator',
    }).catch((error: unknown) => error) as DispatchRejectedError;

    expect(refusal.reason).toBe('claude_bridge_route_model_mismatch');
    const note = String(refusal.detail?.note ?? '');
    expect(note).toContain('researcher');
    expect(note).toContain('anthropic/claude-sonnet-4-6');
    expect(note).toContain('claude_bridge');
  });

  it('hands dispatch and retry the same resolved model, and the session readers agree', async () => {
    writeBlock({ enabled: true, specialists: ['researcher'], default_model: 'claude-bridge/claude-sonnet-5-5' });
    const loader = new SpecialistLoader({ projectDir: project });

    // Dispatch reads this; retry re-reads the SAME loader entry and must not see another answer.
    const dispatch = await loader.get('researcher');
    const retry = await loader.get('researcher');

    expect(dispatch.specialist.execution.model).toBe('claude-bridge/claude-sonnet-5-5');
    expect(retry.specialist.execution.model).toBe(dispatch.specialist.execution.model);
    expect(retry.specialist.execution.claude_bridge).toBe(dispatch.specialist.execution.claude_bridge);
    // native host (dispatch + retry) and the session option shared by sp run and sp script.
    expect(claudeBridgeRouteEnabled(dispatch.specialist.execution)).toBe(true);
    expect(claudeBridgeSessionOption(retry.specialist.execution)).toEqual({ claudeBridge: true });
  });

  it('leaves an unlisted Specialist with a non-bridged model runnable and off the route', async () => {
    writeBlock({ enabled: true, specialists: ['advisor'], default_model: 'claude-bridge/claude-sonnet-5-5' });
    const loader = new SpecialistLoader({ projectDir: project });

    const merged = await loader.get('researcher');

    expect(merged.specialist.execution.model).toBe('anthropic/claude-sonnet-4-6');
    expect(claudeBridgeRouteEnabled(merged.specialist.execution)).toBe(false);
    // The dedicated code the host renders is the code the loader throws.
    expect(new ClaudeBridgeRouteModelMismatchError('researcher', null, '/tmp/user.json', null).code)
      .toBe('claude_bridge_route_model_mismatch');
  });
});
