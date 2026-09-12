import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquire, inspect, leasePath } from '../../../src/activation/workspace-lease.js';
import { leaseScopeFor } from '../../../src/activation/workspace-reconcile.js';

/**
 * SPECIALISTS-23. The workspace lease fences native activations against each other, but the
 * coordinator is not a participant in it: a Claude Code session edits through its own tools
 * without acquiring or inspecting the lease. Because native activations run IN PLACE, a
 * coordinator edit and a write-tier activation's edit to the same file can interleave and
 * silently lose one of the two writes. That is the accepted cost of run-in-place; the point
 * of this hook is that the loss stops being silent.
 *
 * These tests run the REAL hook script, not a reimplementation of it.
 */

const SCRIPT = fileURLToPath(new URL('../../../plugins/specialists/scripts/lease-warn.mjs', import.meta.url));

const workspaces: string[] = [];
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'lease-warn-'));
  workspaces.push(root);
  return root;
}
afterEach(() => {
  while (workspaces.length > 0) rmSync(workspaces.pop() as string, { recursive: true, force: true });
});

/** Run the hook exactly as Claude Code does: JSON on stdin, one line of JSON on stdout. */
function runHook(cwd: string): { stdout: string; status: number | null } {
  const result = spawnSync('bun', [SCRIPT], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(cwd, 'x.ts') }, cwd }),
    encoding: 'utf8',
    cwd,
  });
  return { stdout: result.stdout ?? '', status: result.status };
}

describe('coordinator lease warning hook (SPECIALISTS-23)', () => {
  it('warns once, naming the holding activation, while the edit still applies', () => {
    const root = workspace();
    const scope = leaseScopeFor(root);
    acquire({ workspace: scope, activationId: 'act:holder-1', attemptId: 'att:holder-1:1', specialist: 'executor' });
    const leaseFile = leasePath(scope);
    const before = readFileSync(leaseFile, 'utf8');

    const { stdout, status } = runHook(root);

    expect(status).toBe(0);
    const payload = JSON.parse(stdout) as {
      systemMessage?: string;
      hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
      permissionDecision?: string;
    };
    expect(payload.systemMessage).toContain('act:holder-1');
    expect(payload.systemMessage).toContain('executor');
    expect(payload.systemMessage).toContain(scope.worktreePath);
    expect(payload.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(payload.hookSpecificOutput?.additionalContext).toContain('act:holder-1');
    // Never a block: the edit still applies.
    expect(payload.permissionDecision).toBeUndefined();

    // Read-only: the hook must not have touched the lease record.
    expect(readFileSync(leaseFile, 'utf8')).toBe(before);
  });

  it('is silent when no activation holds the workspace', () => {
    const root = workspace();
    const { stdout, status } = runHook(root);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe('');
    expect(inspect(leaseScopeFor(root)).state).toBe('free');
  });

  it('is silent on an unreadable lease rather than erroring', () => {
    const root = workspace();
    const scope = leaseScopeFor(root);
    mkdirSync(dirname(leasePath(scope)), { recursive: true });
    writeFileSync(leasePath(scope), '{ not json');
    const { stdout, status } = runHook(root);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('is silent on a stale lease whose holder process is gone', () => {
    const root = workspace();
    const scope = leaseScopeFor(root);
    mkdirSync(dirname(leasePath(scope)), { recursive: true });
    // A record that parses but whose pid cannot be the live holder: the runtime must call
    // this uncertain, and an uncertain workspace is never reported as held.
    writeFileSync(leasePath(scope), JSON.stringify({
      workspaceKey: 'x',
      activationId: 'act:ghost',
      attemptId: 'att:ghost:1',
      specialist: 'executor',
      acquiredAt: 1,
      expiresAt: 9_999_999_999_999,
      holder: { pid: 999_999, startTicks: 1 },
    }));
    const { stdout, status } = runHook(root);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe('');
    expect(inspect(scope).state).toBe('uncertain');
  });

  it('registers on the PreToolUse edit surface with a bounded timeout', () => {
    const hooks = JSON.parse(
      execFileSync('cat', [fileURLToPath(new URL('../../../plugins/specialists/hooks/hooks.json', import.meta.url))], { encoding: 'utf8' }),
    ) as { hooks: Record<string, Array<{ matcher: string; hooks: Array<{ command: string; timeout: number }> }>> };
    const preToolUse = hooks.hooks.PreToolUse;
    expect(preToolUse).toBeDefined();
    const entry = preToolUse[0];
    // Every mutating builtin, so no edit path bypasses the warning.
    expect(entry.matcher).toContain('Write');
    expect(entry.matcher).toContain('Edit');
    expect(entry.matcher).toContain('MultiEdit');
    expect(entry.hooks[0]?.command).toContain('lease-warn.mjs');
    expect(entry.hooks[0]?.timeout).toBeLessThanOrEqual(5);
  });
});
