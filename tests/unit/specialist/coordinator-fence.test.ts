import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveWorkspace } from '../../../src/activation/native-host.js';
import { GUARDED_TOOL_NAMES } from '../../../src/activation/guarded-tools.js';
import {
  acquire,
  admitCoordinatorToolCall,
  recoverDeadHolder,
  inspect,
  leasePath,
  isMutatingTool,
  isWorkspaceWriteTool,
  releaseHolderLease,
  WORKSPACE_WRITE_TOOLS,
  type LeaseProcessProbe,
} from '../../../src/activation/workspace-lease.js';

/**
 * XTRM-109: the coordinator is FULLY WAIVED from the workspace writer lease. It is never
 * blocked — a workspace-writer tool only produces a non-blocking WARNING while a Specialist
 * holds the worktree. A provably dead holder is still reclaimed on every coordinator-reachable
 * path, so a stale lease does not block the next dispatch's acquire().
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

const WRITE_TOOLS = ['edit', 'write', 'bash', 'powershell'];
const READ_AND_FLEET_TOOLS = [
  'read', 'grep', 'ls', 'python', 'specialist_status', 'specialist_result', 'specialist_stop_activation',
];

describe('coordinator is waived from the workspace lease (warn-only)', () => {
  it('never blocks a writer while a lease is HELD, and warns with the holder', () => {
    const root = heldWorkspace();
    const identity = resolveWorkspace(root);
    for (const tool of WRITE_TOOLS) {
      const verdict = admitCoordinatorToolCall({ toolName: tool, workspace: identity }, liveProbe);
      expect(verdict.allow, `${tool} must never be fenced`).toBe(true);
      expect(verdict.warning, `${tool} should warn while a holder is live`).toMatch(/held by executor act:holder/);
    }
    // The live holder is untouched: warning is not recovery.
    expect(inspect(identity, liveProbe).state).toBe('held');
  });

  it('allows reads and Fleet tools with no warning', () => {
    const root = heldWorkspace();
    const identity = resolveWorkspace(root);
    for (const tool of READ_AND_FLEET_TOOLS) {
      const verdict = admitCoordinatorToolCall({ toolName: tool, workspace: identity }, liveProbe);
      expect(verdict.allow, tool).toBe(true);
      expect(verdict.warning, tool).toBeUndefined();
    }
  });

  it('allows a writer with no warning when the workspace is free', () => {
    const root = workspace();
    const identity = resolveWorkspace(root);
    const verdict = admitCoordinatorToolCall({ toolName: 'write', workspace: identity }, liveProbe);
    expect(verdict.allow).toBe(true);
    expect(verdict.warning).toBeUndefined();
  });

  it('classifies writers by a WRITE ALLOWLIST, not a read denylist (SPECIALISTS-4273)', () => {
    for (const tool of ['bash', 'write', 'edit', 'powershell']) expect(isWorkspaceWriteTool(tool), tool).toBe(true);
    for (const tool of ['ls', 'find', 'python', 'structured_return', 'grep', 'read']) {
      expect(isWorkspaceWriteTool(tool), tool).toBe(false);
    }
    // Default-quiet: a tool that did not exist when this list was written does not warn.
    expect(isWorkspaceWriteTool('some_future_shell')).toBe(false);
    // Parity: the advisory set and the guarded-tool reconstruction are the same tools.
    expect([...WORKSPACE_WRITE_TOOLS].sort()).toEqual([...GUARDED_TOOL_NAMES].sort());
    // The Specialist-side denylist is untouched and still strict about `python`.
    expect(isMutatingTool('python')).toBe(true);
    expect(isMutatingTool('read')).toBe(false);
  });

  it('reclaims a stale dead-pid lease on a read-only status call (XTRM-109)', () => {
    const root = workspace();
    const identity = resolveWorkspace(root);
    acquire(
      { workspace: identity, activationId: 'act:stale', attemptId: 'att:stale:1', specialist: 'executor' },
      liveProbe,
    );
    const deadProbe: LeaseProcessProbe = { canVerify: () => true, startTicks: () => undefined };
    expect(inspect(identity, deadProbe)).toMatchObject({ state: 'uncertain', uncertainReason: 'holder_process_gone' });

    // A read is not blocked, and it is coordinator-reachable recovery: the stale lease is
    // reclaimed, so a coordinator that only polls status never needs an out-of-band rm.
    const verdict = admitCoordinatorToolCall({ toolName: 'specialist_status', workspace: identity }, deadProbe);
    expect(verdict.allow).toBe(true);
    expect(inspect(identity, deadProbe).state).toBe('free');
    const log = readFileSync(join(dirname(leasePath(identity)), 'recoveries.jsonl'), 'utf-8');
    expect(JSON.parse(log.trim())).toMatchObject({
      holderActivationId: 'act:stale', observedReason: 'holder_process_gone', actor: 'coordinator-fence',
    });
  });

  it('reclaims a stale dead-pid lease on a writer call, without warning about a dead holder', () => {
    const root = workspace();
    const identity = resolveWorkspace(root);
    acquire(
      { workspace: identity, activationId: 'act:stale-write', attemptId: 'att:stale-write:1', specialist: 'executor' },
      liveProbe,
    );
    const deadProbe: LeaseProcessProbe = { canVerify: () => true, startTicks: () => undefined };
    const verdict = admitCoordinatorToolCall({ toolName: 'write', workspace: identity }, deadProbe);
    expect(verdict.allow).toBe(true);
    expect(verdict.warning).toBeUndefined();
    expect(inspect(identity, deadProbe).state).toBe('free');
  });

  it('never reclaims a lease whose holder might still be alive (PID-reuse guard stays)', () => {
    const root = workspace();
    const identity = resolveWorkspace(root);
    acquire(
      { workspace: identity, activationId: 'act:maybe-alive', attemptId: 'att:maybe-alive:1', specialist: 'executor' },
      liveProbe,
    );
    const mismatch: LeaseProcessProbe = { canVerify: () => true, startTicks: () => 999 };
    const blind: LeaseProcessProbe = { canVerify: () => false, startTicks: () => undefined };
    for (const probe of [mismatch, blind]) {
      // A writer still runs — waived, warned, never blocked...
      const write = admitCoordinatorToolCall({ toolName: 'write', workspace: identity }, probe);
      expect(write.allow).toBe(true);
      expect(write.warning).toMatch(/held by executor act:maybe-alive/);
      // ...and the lease is NOT auto-freed.
      expect(inspect(identity, probe).state).toBe('uncertain');
    }
  });

  it('records the recovery with actor and observed reason, and refuses to race a new holder', () => {
    const root = workspace();
    const identity = resolveWorkspace(root);
    acquire(
      { workspace: identity, activationId: 'act:dead2', attemptId: 'att:dead2:1', specialist: 'executor' },
      liveProbe,
    );
    const deadProbe: LeaseProcessProbe = { canVerify: () => true, startTicks: () => undefined };
    const healed = recoverDeadHolder(identity, { actor: 'operator:test', probe: deadProbe, now: 1_700_000_000_000 });
    expect(healed).toMatchObject({ applied: true, observedReason: 'holder_process_gone', actor: 'operator:test' });
    // Forensics survive the delete.
    const log = readFileSync(join(dirname(leasePath(identity)), 'recoveries.jsonl'), 'utf-8');
    expect(JSON.parse(log.trim())).toMatchObject({ holderActivationId: 'act:dead2', observedReason: 'holder_process_gone' });
    // Idempotent: a second call finds nothing to heal.
    expect(recoverDeadHolder(identity, { actor: 'operator:test', probe: deadProbe }).applied).toBe(false);
    // A live lease is never healed, even if a caller asks.
    acquire(
      { workspace: identity, activationId: 'act:live', attemptId: 'att:live:1', specialist: 'executor' },
      liveProbe,
    );
    expect(recoverDeadHolder(identity, { actor: 'operator:test', probe: liveProbe }).applied).toBe(false);
    expect(inspect(identity, liveProbe).state).toBe('held');
  });

  it('releases the lease on behalf of a named activation, and only that one (4275)', () => {
    const root = workspace();
    const identity = resolveWorkspace(root);
    acquire(
      { workspace: identity, activationId: 'act:stopping', attemptId: 'att:stopping:1', specialist: 'executor' },
      liveProbe,
    );
    // A stop for someone else's activation must never free their lease.
    expect(releaseHolderLease(identity, { activationId: 'act:someone_else', actor: 'coordinator-stop' }))
      .toMatchObject({ applied: false, reason: 'activation_mismatch' });
    expect(inspect(identity, liveProbe).state).toBe('held');
    // The real owner releases it, and the workspace is immediately free.
    expect(releaseHolderLease(identity, { activationId: 'act:stopping', actor: 'coordinator-stop' }))
      .toMatchObject({ applied: true, observedReason: 'released_by_holder', actor: 'coordinator-stop' });
    expect(inspect(identity, liveProbe).state).toBe('free');
    expect(admitCoordinatorToolCall({ toolName: 'write', workspace: identity }, liveProbe).allow).toBe(true);
  });
});
