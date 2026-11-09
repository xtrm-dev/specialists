/**
 * The opt-in Claude Code route (SPECIALISTS-4405, evidence in docs/spike-4403-claude-bridge.md).
 *
 * `pi-claude-bridge` is a Pi extension that serves Claude models through the Claude Code CLI and
 * the Claude Agent SDK. It is deliberately NOT part of the default install and NEVER loaded
 * unless a specialist definition sets `execution.claude_bridge: true`:
 *
 *   - it spends the operator's own Claude subscription quota, not an API key;
 *   - the operator's permission for that route is a recorded decision (SPECIALISTS-4403), not a
 *     default this package may assume;
 *   - with the flag off, nothing here runs and the package need not be installed at all.
 *
 * The bridge registers its provider at SESSION bind time, not before, which is why the model gate
 * receives the provider ids from here as "extension providers" (see model-gate.ts) rather than
 * resolving them on its own runtime.
 */
/** The provider id the extension registers. Fixed by `PROVIDER_ID` in the bridge's own source. */
export const CLAUDE_BRIDGE_PROVIDER = 'claude-bridge';

/** The npm package that ships the extension. */
export const CLAUDE_BRIDGE_PACKAGE = 'pi-claude-bridge';

/**
 * Escape hatch for a checkout or a non-global install: an absolute path to the extension entry.
 *
 * Test seam AND operator override — a source checkout is a legitimate way to run this route, and
 * the alternative (copying the package into a global prefix) is worse. Unset in normal use.
 * Resolved by `resolveClaudeBridgeExtensionPath` in session.ts, next to the global-package
 * resolution it shares with every other curated extension.
 */
export const CLAUDE_BRIDGE_PATH_ENV = 'SPECIALISTS_CLAUDE_BRIDGE_PATH';

/** Whether the definition asked for this route at all. */
export function claudeBridgeEnabled(execution: { claude_bridge?: unknown } | undefined): boolean {
  return execution?.claude_bridge === true;
}

/**
 * Providers the gate may treat as supplied-by-an-extension for this activation.
 *
 * Empty unless the flag is on: a disabled flag must behave exactly like a build without this
 * feature, including the refusal a bridged model gets today.
 */
export function claudeBridgeExtensionProviders(
  execution: { claude_bridge?: unknown } | undefined,
): string[] {
  return claudeBridgeEnabled(execution) ? [CLAUDE_BRIDGE_PROVIDER] : [];
}
