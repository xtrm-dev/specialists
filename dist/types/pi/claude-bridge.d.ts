import { type ClaudeBridgeBlockRead, type GlobalUserConfigPath } from '../specialist/global-config.js';
/** The provider id the extension registers. Fixed by `PROVIDER_ID` in the bridge's own source. */
export declare const CLAUDE_BRIDGE_PROVIDER = "claude-bridge";
/** The npm package that ships the extension. */
export declare const CLAUDE_BRIDGE_PACKAGE = "pi-claude-bridge";
/**
 * Escape hatch for a checkout or a non-global install: an absolute path to the extension entry.
 *
 * Test seam AND operator override — a source checkout is a legitimate way to run this route, and
 * the alternative (copying the package into a global prefix) is worse. Unset in normal use.
 * Resolved by `resolveClaudeBridgeExtensionPath` in session.ts, next to the global-package
 * resolution it shares with every other curated extension.
 */
export declare const CLAUDE_BRIDGE_PATH_ENV = "SPECIALISTS_CLAUDE_BRIDGE_PATH";
/**
 * Whether the DEFINITION asked for this route. Never sufficient on its own: see
 * `claudeBridgeRouteEnabled`.
 */
export declare function claudeBridgeEnabled(execution: {
    claude_bridge?: unknown;
} | undefined): boolean;
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
export declare function operatorClaudeBridgeEnabled(location?: GlobalUserConfigPath, readFile?: (path: string) => string): boolean;
/**
 * The route is ON only when BOTH halves agree: the definition selects it per Specialist, and the
 * operator enabled it for this machine. Checked in the host and in the legacy argv path, so the
 * two runtimes cannot disagree about it either.
 */
export declare function claudeBridgeRouteEnabled(execution: {
    claude_bridge?: unknown;
} | undefined, operatorEnabled?: () => boolean): boolean;
/**
 * Which switch is off, named for a refusal note. Never changes what enables the route:
 * `claudeBridgeRouteEnabled` stays the decision, this only explains a "no".
 *
 * `specialistName` is what makes the note truthful after SPECIALISTS-4442: when the operator block
 * carries an allow list, the reason a repo-selected Specialist stays off is the missing NAME, not
 * the definition flag (a repo layer can still write that flag; the list is what it cannot write).
 */
export declare function claudeBridgeOffSwitches(execution: {
    claude_bridge?: unknown;
} | undefined, operatorEnabled?: () => boolean, specialistName?: string, blockRead?: ClaudeBridgeBlockRead): string[];
/**
 * Providers the gate may treat as supplied-by-an-extension for this activation.
 *
 * Takes the RESOLVED route decision (both halves), not the definition alone: a repository-selected
 * flag with the operator switch off must not even reach the gate's carve-out, or the refusal moves
 * from today's "no such model" to a later, more confusing failure.
 */
export declare function claudeBridgeExtensionProviders(routeEnabled: boolean): string[];
/**
 * The legacy `PiAgentSession` option fragment for a definition. One place decides the selector, so
 * the runner and the script-runner cannot drift; the operator half is checked again inside
 * `PiAgentSession.start`, which is the only place that can see the machine.
 */
export declare function claudeBridgeSessionOption(execution: {
    claude_bridge?: unknown;
} | undefined): {
    claudeBridge?: true;
};
/**
 * Is this model served by the Claude Code route? The single predicate for every fallback decision:
 * a bridged model is a subscription surface, so a run must not move off it silently. Both the
 * native host and the legacy runner call this, so the two cannot drift.
 */
export declare function isBridgedModel(model: string | null | undefined): boolean;
/**
 * The event a skipped fallback emits, shared by both runtimes. It carries the model that was NOT
 * started under its own key (`not_started_model`), so a reader cannot mistake it for a model that
 * ran, and `resolved_model` stays the bridged model that actually ran.
 */
export declare function bridgedFallbackSkipEvent(args: {
    fromModel: string;
    toModel?: string;
    errorClass: string;
    cause: string;
}): Record<string, unknown>;
//# sourceMappingURL=claude-bridge.d.ts.map