import { spawnSync } from 'node:child_process';
import type { RuntimeOriginV1 } from '../specialist/runtime-origin.js';

const TMUX_SESSION_PREFIX = 'sp';

/** Pane option carrying the dispatching pane's tmux session id (`$N`, never `#S`). */
export const AGENT_PARENT_SESSION_OPTION = '@agent_parent_session';
/** Pane option carrying the dispatching pane id (`%N`). */
export const AGENT_PARENT_PANE_OPTION = '@agent_parent_pane';

function escapeForSingleQuotedBash(script: string): string {
  return script.replace(/'/g, "'\\''");
}

function quoteShellValue(value: string): string {
  return `'${escapeForSingleQuotedBash(value)}'`;
}

/** Returns true if tmux is available on PATH */
export function isTmuxAvailable(): boolean {
  return spawnSync('which', ['tmux'], { encoding: 'utf8', timeout: 2000 }).status === 0;
}

/** Build canonical session name: sp-<specialist>-<suffix> */
export function buildSessionName(specialist: string, suffix: string): string {
  return `${TMUX_SESSION_PREFIX}-${specialist}-${suffix}`;
}

/**
 * Derive pane lineage options from a dispatching pane's runtime origin.
 *
 * Pure mapping: `@agent_parent_session` is the dispatcher's tmux session id
 * (`$N`, stable per instance — never the mutable session name) and
 * `@agent_parent_pane` is the dispatcher's pane id. Returns `{}` when there
 * is no dispatcher identity (outside tmux / headless): an unset edge is the
 * documented "no dispatcher" state, never a guessed parent.
 */
export function parentPaneOptions(origin: RuntimeOriginV1 | undefined): Record<string, string> {
  if (!origin?.tmux_session_id || !origin?.tmux_pane_id) return {};
  return {
    [AGENT_PARENT_SESSION_OPTION]: origin.tmux_session_id,
    [AGENT_PARENT_PANE_OPTION]: origin.tmux_pane_id,
  };
}

/**
 * Best-effort: stamp pane options on a freshly created session's initial pane.
 * Never throws — the session exists and the launch is viable without lineage.
 */
function stampPaneOptions(sessionName: string, paneOptions: Record<string, string>): void {
  for (const [key, value] of Object.entries(paneOptions)) {
    if (!key || !value) continue;
    const result = spawnSync('tmux', ['set-option', '-t', sessionName, '-p', key, value], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (result.status !== 0) {
      const detail = (result.stderr ?? '').trim() || 'unknown error';
      console.warn(
        `[specialists] warning: failed to set ${key} on tmux session "${sessionName}": ${detail}`,
      );
    }
  }
}

/**
 * Create a detached tmux session running cmd.
 * - Sets SPECIALISTS_TMUX_SESSION=name as env var inside the session
 * - Unsets CLAUDECODE, CLAUDE_CODE_SSE_PORT, CLAUDE_CODE_ENTRYPOINT (Claude Code nesting guard)
 * - Wraps command in /bin/bash -c '...' for cross-shell compatibility
 * - extraEnv: additional key=value pairs to export in the session
 * - paneOptions: tmux pane options stamped on the session's initial pane
 *   (best-effort; stamp failures warn, never throw)
 * @throws if tmux exits non-zero
 */
export function createTmuxSession(
  name: string,
  cwd: string,
  cmd: string,
  extraEnv: Record<string, string> = {},
  paneOptions: Record<string, string> = {},
): void {
  const exports: string[] = [
    'unset CLAUDECODE CLAUDE_CODE_SSE_PORT CLAUDE_CODE_ENTRYPOINT',
    `export SPECIALISTS_TMUX_SESSION=${quoteShellValue(name)}`,
  ];

  for (const [key, value] of Object.entries(extraEnv)) {
    exports.push(`export ${key}=${quoteShellValue(value)}`);
  }

  const startupScript = `${exports.join('; ')}; exec ${cmd}`;
  const wrappedCommand = `/bin/bash -c '${escapeForSingleQuotedBash(startupScript)}'`;

  const result = spawnSync(
    'tmux',
    ['new-session', '-d', '-s', name, '-c', cwd, wrappedCommand],
    { encoding: 'utf8', stdio: 'pipe' },
  );

  if (result.status !== 0) {
    const errorOutput = (result.stderr ?? '').trim() || (result.error?.message ?? 'unknown error');
    throw new Error(`Failed to create tmux session \"${name}\": ${errorOutput}`);
  }

  stampPaneOptions(name, paneOptions);
}

/**
 * Check whether a tmux session currently exists.
 * Returns false when tmux exits non-zero or the check times out.
 */
export function isTmuxSessionAlive(sessionName: string): boolean {
  const result = spawnSync('tmux', ['has-session', '-t', sessionName], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 2000,
  });
  if (result.error) return false;
  return result.status === 0;
}

/**
 * Kill a tmux session. Idempotent — does not throw if session is already dead.
 */
export function killTmuxSession(name: string): void {
  spawnSync('tmux', ['kill-session', '-t', name], { encoding: 'utf8', stdio: 'pipe' });
}
