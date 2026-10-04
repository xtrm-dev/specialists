import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { resolveWorkspace } from '../../../src/activation/native-host.js';
import { acquire, admitCoordinatorToolCall, isControlPlaneTool, type LeaseProcessProbe } from '../../../src/activation/workspace-lease.js';

/**
 * SPECIALISTS-4272: the coordinator's control plane must never be fenced by the workspace
 * write fence. The live deadlock was a Specialist holding a lease in needs_reply while the
 * coordinator was refused specialist_status, specialist_reply AND specialist_stop_activation —
 * the only tools that could have resolved it.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function workspace(): string {
  const root = mkdtempSync(join(process.cwd(), '.tmp-specialists-4272-'));
  roots.push(root);
  return root;
}

/** A real, live lease: the holder is this process, so inspect() reports 'held'. */
const liveProbe: LeaseProcessProbe = {
  canVerify: () => true,
  startTicks: pid => (pid === process.pid ? 111 : undefined),
};

function heldWorkspace(): string {
  const root = workspace();
  const identity = resolveWorkspace(root);
  acquire(
    { workspace: identity, activationId: 'act:holder', attemptId: 'att:holder:1', specialist: 'executor' },
    liveProbe,
  );
  return root;
}

/** Fails the test if inspect() is ever consulted: the exemption must be unconditional. */
const mustNotInspect: never = undefined as never;

const CONTROL = [
  'specialist_status',
  'specialist_reply',
  'specialist_result',
  'specialist_stop_activation',
  'specialist_lease_reconcile',
];

describe('coordinator control plane is exempt from the workspace write fence', () => {
  it('allows every control-plane tool while a lease is HELD', () => {
    const root = heldWorkspace();
    const identity = resolveWorkspace(root);
    for (const tool of CONTROL) {
      const verdict = admitCoordinatorToolCall({ toolName: tool, workspace: identity }, mustNotInspect);
      expect(verdict.allow, `${tool} must not be fenced by a held lease`).toBe(true);
      expect(verdict.reason).toBeUndefined();
    }
  });

  it('allows every control-plane tool while a lease is UNCERTAIN or FREE', () => {
    const root = workspace();
    const identity = resolveWorkspace(root); // no lease file at all -> free
    for (const tool of CONTROL) {
      expect(admitCoordinatorToolCall({ toolName: tool, workspace: identity }, mustNotInspect).allow, tool).toBe(true);
    }
  });

  it('recognises control-plane names case-insensitively and with surrounding space', () => {
    expect(isControlPlaneTool('Specialist_Status')).toBe(true);
    expect(isControlPlaneTool(' specialist_reply ')).toBe(true);
    expect(isControlPlaneTool('bash')).toBe(false);
    expect(isControlPlaneTool('write')).toBe(false);
  });

  it('still fences a genuine writer while a lease is held', () => {
    const root = heldWorkspace();
    const identity = resolveWorkspace(root);
    const verdict = admitCoordinatorToolCall(
      { toolName: 'write', workspace: identity },
      liveProbe,
    );
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toContain('is held by');
  });
});
