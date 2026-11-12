/**
 * The opt-in Claude Code route (SPECIALISTS-4405, evidence in docs/spike-4403-claude-bridge.md).
 *
 * `pi-claude-bridge` is a Pi extension that serves Claude models through the Claude Code CLI and
 * the Claude Agent SDK. It is deliberately NOT part of the default install and NEVER loaded unless
 * BOTH halves agree: the definition selects it per Specialist (`execution.claude_bridge`), and the
 * operator enables it for this machine (the `claude_bridge` switch in the global user config).
 *
 *   - it spends the operator's own Claude subscription quota, not an API key;
 *   - the operator's permission for that route is a recorded decision (SPECIALISTS-4403), not a
 *     default this package may assume, and a repository must not be able to grant it;
 *   - with either half off, nothing here runs and the package need not be installed at all.
 *
 * The bridge registers its provider at SESSION bind time, not before, which is why the model gate
 * receives the provider ids from here as "extension providers" (see model-gate.ts) rather than
 * resolving them on its own runtime.
 */
import { readFileSync } from 'node:fs';
import {
  CLAUDE_BRIDGE_SWITCH_KEY,
  getGlobalUserConfigPath,
  readClaudeBridgeBlock,
  type ClaudeBridgeBlockRead,
  type GlobalUserConfigPath,
} from '../specialist/global-config.js';

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

/**
 * Whether the DEFINITION asked for this route. Never sufficient on its own: see
 * `claudeBridgeRouteEnabled`.
 */
export function claudeBridgeEnabled(execution: { claude_bridge?: unknown } | undefined): boolean {
  return execution?.claude_bridge === true;
}

/**
 * Whether the OPERATOR enabled the route on this machine.
 *
 * Read from the `claude_bridge` block of `~/.config/specialists/user.json`, the one config file a
 * repository cannot write. The definition flag alone must never be enough: a repo can ship
 * `.specialists/user/<name>.json`, a repo-defined specialist name can become the merge base, and
 * the repo layer may even be a symlink into the home layer — so provenance cannot be inferred from
 * the merged spec, and the decision has to live somewhere outside every repo.
 *
 * This is the MACHINE gate. Which Specialists may use the route is the block's allow list, applied
 * by the loader (SPECIALISTS-4442); this function answers only "did the operator consent on this
 * machine".
 *
 * Fail closed: absent, unreadable, malformed or invalid is OFF, and so is any shape other than
 * `enabled: true`. The same validated reader the loader uses is the only reader, so the two
 * cannot report different failures.
 */
export function operatorClaudeBridgeEnabled(
  location: GlobalUserConfigPath = getGlobalUserConfigPath(),
  readFile: (path: string) => string = path => readFileSync(path, 'utf-8'),
): boolean {
  const read = readClaudeBridgeBlock(location, readFile);
  return read.error === null && read.block !== null && read.block.enabled === true;
}

/**
 * The route is ON only when BOTH halves agree: the definition selects it per Specialist, and the
 * operator enabled it for this machine. Checked in the host and in the legacy argv path, so the
 * two runtimes cannot disagree about it either.
 */
export function claudeBridgeRouteEnabled(
  execution: { claude_bridge?: unknown } | undefined,
  operatorEnabled: () => boolean = operatorClaudeBridgeEnabled,
): boolean {
  return claudeBridgeEnabled(execution) && operatorEnabled();
}

/**
 * Which switch is off, named for a refusal note. Never changes what enables the route:
 * `claudeBridgeRouteEnabled` stays the decision, this only explains a "no".
 *
 * `specialistName` is what makes the note truthful after SPECIALISTS-4442: when the operator block
 * carries an allow list, the reason a repo-selected Specialist stays off is the missing NAME, not
 * the definition flag (a repo layer can still write that flag; the list is what it cannot write).
 */
export function claudeBridgeOffSwitches(
  execution: { claude_bridge?: unknown } | undefined,
  operatorEnabled: () => boolean = operatorClaudeBridgeEnabled,
  specialistName?: string,
  blockRead: ClaudeBridgeBlockRead = readClaudeBridgeBlock(),
): string[] {
  const off: string[] = [];
  const block = blockRead.block;
  const allowListReason = (): string | null => {
    if (specialistName === undefined || block === null || block.specialists === undefined) return null;
    if (!block.specialists.includes(specialistName)) {
      return (
        `the operator allow list ${CLAUDE_BRIDGE_SWITCH_KEY}.specialists in ~/.config/specialists/user.json, ` +
        `which does not name "${specialistName}"`
      );
    }
    return (
      `the operator allow list ${CLAUDE_BRIDGE_SWITCH_KEY}.specialists in ~/.config/specialists/user.json, ` +
      `which resolves no ${CLAUDE_BRIDGE_PROVIDER}/... model for "${specialistName}"`
    );
  };

  if (blockRead.error !== null) {
    off.push(`the operator ${CLAUDE_BRIDGE_SWITCH_KEY} block in ${blockRead.path} is invalid (${blockRead.error})`);
  } else {
    const allowList = allowListReason();
    if (allowList !== null) off.push(allowList);
    else if (!claudeBridgeEnabled(execution)) off.push('the definition flag execution.claude_bridge');
  }
  if (!operatorEnabled()) {
    off.push(`the operator switch ${CLAUDE_BRIDGE_SWITCH_KEY} in ~/.config/specialists/user.json`);
  }
  return off;
}

/**
 * Providers the gate may treat as supplied-by-an-extension for this activation.
 *
 * Takes the RESOLVED route decision (both halves), not the definition alone: a repository-selected
 * flag with the operator switch off must not even reach the gate's carve-out, or the refusal moves
 * from today's "no such model" to a later, more confusing failure.
 */
export function claudeBridgeExtensionProviders(routeEnabled: boolean): string[] {
  return routeEnabled ? [CLAUDE_BRIDGE_PROVIDER] : [];
}

/**
 * The legacy `PiAgentSession` option fragment for a definition. One place decides the selector, so
 * the runner and the script-runner cannot drift; the operator half is checked again inside
 * `PiAgentSession.start`, which is the only place that can see the machine.
 */
export function claudeBridgeSessionOption(
  execution: { claude_bridge?: unknown } | undefined,
): { claudeBridge?: true } {
  return claudeBridgeEnabled(execution) ? { claudeBridge: true } : {};
}

/**
 * Is this model served by the Claude Code route? The single predicate for every fallback decision:
 * a bridged model is a subscription surface, so a run must not move off it silently. Both the
 * native host and the legacy runner call this, so the two cannot drift.
 */
export function isBridgedModel(model: string | null | undefined): boolean {
  return typeof model === 'string' && model.startsWith(`${CLAUDE_BRIDGE_PROVIDER}/`);
}

/**
 * The event a skipped fallback emits, shared by both runtimes. It carries the model that was NOT
 * started under its own key (`not_started_model`), so a reader cannot mistake it for a model that
 * ran, and `resolved_model` stays the bridged model that actually ran.
 */
export function bridgedFallbackSkipEvent(args: {
  fromModel: string;
  toModel?: string;
  errorClass: string;
  cause: string;
}): Record<string, unknown> {
  const { fromModel, toModel, errorClass, cause } = args;
  return {
    from_model: fromModel,
    ...(toModel ? { to_model: toModel, not_started_model: toModel } : {}),
    error_class: errorClass,
    terminal: true,
    skipped: true,
    note:
      `fallback skipped: the primary "${fromModel}" is served by the Claude Code route, ` +
      `so the walk does not continue to another provider (cause: ${cause})`,
    resolved_model: fromModel,
  };
}
