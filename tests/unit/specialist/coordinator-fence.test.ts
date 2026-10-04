import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { resolveWorkspace } from '../../../src/activation/native-host.js';
import { GUARDED_TOOL_NAMES } from '../../../src/activation/guarded-tools.js';
import {
  acquire,
  admitCoordinatorToolCall,
  isControlPlaneTool,
  isMutatingTool,
  isWorkspaceWriteTool,
  WORKSPACE_WRITE_TOOLS,
  type LeaseProcessProbe,
} from '../../../src/activation/workspace-lease.js';

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

  it('classifies the coordinator fence by a WRITE ALLOWLIST, not a read denylist (4273)', () => {
    // Refused: the four tools that can write a file or run a command.
    for (const tool of ['bash', 'write', 'edit', 'powershell']) expect(isWorkspaceWriteTool(tool), tool).toBe(true);
    // Allowed: read-adjacent tools the denylist forgot, observed live.
    for (const tool of ['ls', 'find', 'python', 'structured_return', 'grep', 'read']) {
      expect(isWorkspaceWriteTool(tool), tool).toBe(false);
    }
    // Default-allow: a tool that did not exist when this list was written is not fenced.
    expect(isWorkspaceWriteTool('some_future_shell')).toBe(false);
    // Parity: the fence set and the guarded-tool reconstruction are the same tools.
    expect([...WORKSPACE_WRITE_TOOLS].sort()).toEqual([...GUARDED_TOOL_NAMES].sort());
    // The Specialist-side denylist is untouched and still strict about `python`.
    expect(isMutatingTool('python')).toBe(true);
    expect(isMutatingTool('read')).toBe(false);
  });

  it('lets the coordinator run a read-only python cell while a lease is held', () => {
    const root = heldWorkspace();
    const identity = resolveWorkspace(root);
    const verdict = admitCoordinatorToolCall({ toolName: 'python', workspace: identity }, liveProbe);
    expect(verdict.allow).toBe(true);
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
