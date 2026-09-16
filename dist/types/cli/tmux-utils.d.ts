import type { RuntimeOriginV1 } from '../specialist/runtime-origin.js';
/** Pane option carrying the dispatching pane's tmux session id (`$N`, never `#S`). */
export declare const AGENT_PARENT_SESSION_OPTION = "@agent_parent_session";
/** Pane option carrying the dispatching pane id (`%N`). */
export declare const AGENT_PARENT_PANE_OPTION = "@agent_parent_pane";
/** Returns true if tmux is available on PATH */
export declare function isTmuxAvailable(): boolean;
/** Build canonical session name: sp-<specialist>-<suffix> */
export declare function buildSessionName(specialist: string, suffix: string): string;
/**
 * Derive pane lineage options from a dispatching pane's runtime origin.
 *
 * Pure mapping: `@agent_parent_session` is the dispatcher's tmux session id
 * (`$N`, stable per instance — never the mutable session name) and
 * `@agent_parent_pane` is the dispatcher's pane id. Returns `{}` when there
 * is no dispatcher identity (outside tmux / headless): an unset edge is the
 * documented "no dispatcher" state, never a guessed parent.
 */
export declare function parentPaneOptions(origin: RuntimeOriginV1 | undefined): Record<string, string>;
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
export declare function createTmuxSession(name: string, cwd: string, cmd: string, extraEnv?: Record<string, string>, paneOptions?: Record<string, string>): void;
/**
 * Check whether a tmux session currently exists.
 * Returns false when tmux exits non-zero or the check times out.
 */
export declare function isTmuxSessionAlive(sessionName: string): boolean;
/**
 * Kill a tmux session. Idempotent — does not throw if session is already dead.
 */
export declare function killTmuxSession(name: string): void;
//# sourceMappingURL=tmux-utils.d.ts.map