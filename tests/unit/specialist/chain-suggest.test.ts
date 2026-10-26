import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * SPECIALISTS-4364. After a specialist_dispatch the coordinator receives no pointer
 * to a next step. The Claude frontend adds one informational suggestion via a
 * settings-level PostToolUse hook: chain-suggest.mjs returns
 * hookSpecificOutput.additionalContext naming the SPECIALISTS-4363 reference.
 *
 * These tests run the REAL hook script, not a reimplementation of it.
 */

const SCRIPT = fileURLToPath(new URL('../../../plugins/specialists/scripts/chain-suggest.mjs', import.meta.url));
const HOOKS_JSON = fileURLToPath(new URL('../../../plugins/specialists/hooks/hooks.json', import.meta.url));
const PI_EXTENSION = fileURLToPath(
  new URL('../../../config/pi-extensions/native-specialists/index.mjs', import.meta.url),
);

const EXPECTED_SUGGESTION =
  'Chain reference: the using-specialists skill, references/chain-recipes.md — read it and choose the next step by scrutiny and your own judgment.';

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chain-suggest-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

/** Run the hook exactly as Claude Code does: JSON on stdin, JSON on stdout. */
function runHook(payload: unknown, seenDir: string): { stdout: string; status: number | null } {
  const result = spawnSync('bun', [SCRIPT], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, SPECIALISTS_CHAIN_SUGGEST_DIR: seenDir },
  });
  return { stdout: result.stdout ?? '', status: result.status };
}

function dispatchPayload(toolName: string, activationId: string | null, sessionId = 'sess-test-1') {
  return {
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    tool_input: { specialist: 'executor', issue_ref: 'SPECIALISTS-4364' },
    tool_response: activationId ? { status: 'dispatched', activation_id: activationId } : { status: 'rejected' },
    session_id: sessionId,
    cwd: '/work',
  };
}

describe('chain-suggest PostToolUse hook (SPECIALISTS-4364)', () => {
  it('suggests the chain reference once per activation, naming the reference path', () => {
    const seenDir = scratch();
    const tool = 'mcp__plugin_specialists_specialists__specialist_dispatch';
    const first = runHook(dispatchPayload(tool, 'act:chain-1'), seenDir);
    expect(first.status).toBe(0);
    const payload = JSON.parse(first.stdout) as {
      hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
      permissionDecision?: string;
    };
    expect(payload.hookSpecificOutput?.hookEventName).toBe('PostToolUse');
    expect(payload.hookSpecificOutput?.additionalContext).toBe(EXPECTED_SUGGESTION);
    expect(payload.hookSpecificOutput?.additionalContext).toContain(
      'the using-specialists skill, references/chain-recipes.md',
    );
    // Never a block, never a prescription: no role is named, no decision is returned.
    expect(payload.permissionDecision).toBeUndefined();
    expect(first.stdout).not.toContain('seconder');
    expect(first.stdout).not.toContain('test-engineer');

    // Same session, same activation: silent the second time.
    const second = runHook(dispatchPayload(tool, 'act:chain-1'), seenDir);
    expect(second.status).toBe(0);
    expect(second.stdout.trim()).toBe('');
  });

  it('prunes markers older than 7 days and keeps fresh ones', () => {
    const seenDir = scratch();
    const stale = join(seenDir, 'old-session.act-old');
    const fresh = join(seenDir, 'new-session.act-new');
    writeFileSync(stale, 'old\n');
    writeFileSync(fresh, 'new\n');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(stale, eightDaysAgo, eightDaysAgo);

    runHook(dispatchPayload('mcp__plugin_specialists_specialists__specialist_dispatch', 'act-1'), seenDir);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(join(seenDir, 'sess-test-1.act-1'))).toBe(true);
  });

  it('suggests again for a different activation in the same session', () => {
    const seenDir = scratch();
    const tool = 'mcp__plugin_specialists_specialists__specialist_dispatch';
    const first = runHook(dispatchPayload(tool, 'act:chain-a'), seenDir);
    expect(JSON.parse(first.stdout).hookSpecificOutput.additionalContext).toBe(EXPECTED_SUGGESTION);
    const second = runHook(dispatchPayload(tool, 'act:chain-b'), seenDir);
    expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout).hookSpecificOutput.additionalContext).toBe(EXPECTED_SUGGESTION);
  });

  it('accepts the local-checkout server name too', () => {
    const seenDir = scratch();
    const { stdout, status } = runHook(
      dispatchPayload('mcp__specialists__specialist_dispatch', 'act:chain-local'),
      seenDir,
    );
    expect(status).toBe(0);
    expect(JSON.parse(stdout).hookSpecificOutput.additionalContext).toBe(EXPECTED_SUGGESTION);
  });

  it('fails open: malformed input or an unrelated tool name exits 0 with no output', () => {
    const seenDir = scratch();
    const malformed = runHook('not json{{{', seenDir);
    expect(malformed.status).toBe(0);
    expect(malformed.stdout.trim()).toBe('');

    const unrelated = runHook(dispatchPayload('Bash', 'act:chain-x'), seenDir);
    expect(unrelated.status).toBe(0);
    expect(unrelated.stdout.trim()).toBe('');

    const noActivation = runHook(
      dispatchPayload('mcp__plugin_specialists_specialists__specialist_dispatch', null),
      seenDir,
    );
    expect(noActivation.status).toBe(0);
    expect(noActivation.stdout.trim()).toBe('');
  });

  it('registers PostToolUse on the dispatch tool with a bounded timeout', () => {
    const hooks = JSON.parse(readFileSync(HOOKS_JSON, 'utf8')) as {
      hooks: Record<string, Array<{ matcher: string; hooks: Array<{ command: string; timeout: number }> }>>;
    };
    const postToolUse = hooks.hooks.PostToolUse;
    expect(postToolUse).toBeDefined();
    const matchers = postToolUse.map((e) => e.matcher).join('|');
    // Live-trace names: local checkout and marketplace install (SPECIALISTS-4364).
    expect(matchers).toContain('mcp__specialists__specialist_dispatch');
    expect(matchers).toContain('mcp__plugin_specialists_specialists__specialist_dispatch');
    const commands = postToolUse.flatMap((e) => e.hooks.map((h) => h.command));
    expect(commands.some((c) => c.includes('chain-suggest.mjs'))).toBe(true);
    for (const entry of postToolUse) {
      for (const hook of entry.hooks) {
        expect(hook.timeout).toBeLessThanOrEqual(5);
      }
    }
    // No engine hook added: the plugin engine surface is untouched (SPECIALISTS-4343
    // no longer shares a file with this Issue) — modules still lists only register.tsx.
    expect(JSON.parse(readFileSync(HOOKS_JSON, 'utf8')).modules).toEqual(['./register.tsx']);
  });

  it('shares the suggestion text with the Pi extension (parity)', () => {
    const piText = readFileSync(PI_EXTENSION, 'utf8');
    expect(piText).toContain('the using-specialists skill, references/chain-recipes.md');
    expect(piText).toContain('scrutiny and your own judgment');
    const hookText = readFileSync(SCRIPT, 'utf8');
    expect(hookText).toContain('the using-specialists skill, references/chain-recipes.md');
    expect(hookText).toContain('scrutiny and your own judgment');
  });
});
