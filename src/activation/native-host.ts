/**
 * NativeActivationHost — hosts a real Specialist on an in-process Pi `AgentSession`.
 *
 * This is the shared runtime seam. The Pi extension and the Claude Code MCP server are
 * both frontends over this class; neither invokes the legacy `sp run` CLI, and a future
 * Chain scheduler can call `start()` with a synthetic request because nothing here depends
 * on TUI state.
 *
 * WRITERS ARE ADMITTED, and the lease is wired. This paragraph used to say the opposite and
 * was left behind when the wiring landed — the exact drift this epic kept finding elsewhere,
 * so it is worth being precise about what is and is not true now:
 *   - A `MEDIUM` or `HIGH` tier resolves to `access: 'write'` and MUST acquire the workspace
 *     lease before an AgentSession exists; a denied lease is a refusal, not a warning.
 *   - `admitToolCall` re-checks the lease on every mutating tool call, and `guarded-tools.ts`
 *     wraps pi's four mutating builtins so a refusal comes back as a tool RESULT.
 *   - `releaseIfWriter` releases on SETTLE (`agent_settled`), on COMPLETION and on
 *     DISPOSAL, and converts a throwing release into `lease_uncertain` evidence rather than
 *     a silent success. A writer therefore holds its workspace for the duration of its turn
 *     and no longer. `resume()` RE-ACQUIRES the lease, and that acquisition can be REFUSED:
 *     when another writer already holds the workspace the resume fails with `lease_denied`
 *     naming the holder. A settled writer is resumable, not lease-holding — a caller must not
 *     read "the activation is settled" as "the workspace is still mine".
 *   The lease guards the LLM TOOL PATH ONLY. `pi.exec` and `AgentSession.executeBash` do not
 *   fire the tool_call handler (`unitAI-rrdnt.6`, unclosed), so a child reaching the
 *   filesystem that way is not fenced. Do not describe writers as "fenced" without that
 *   qualifier.
 *   - No model picker.
 *
 * The interaction protocol and the Fleet DO exist: see `./interaction.ts`, `./ask-tool.ts`
 * and `./registry.ts`.
 *
 * Session lifetime deliberately exceeds turn lifetime: reaching `agent_settled` makes a
 * Specialist *waiting and resumable*, never disposed. Disposal is an explicit act.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { SpecialistLoader, parseNpmSourceName, STALL_DETECTION_DEFAULTS, type StallDetectionConfig } from '../specialist/loader.js';
import { buildSystemPrompt } from '../specialist/system-prompt.js';
import { renderTaskPrompt } from '../specialist/task-prompt.js';
import {
  validateBeforeRun,
  classifyFallbackError,
  resolveOutputContractSchema,
  runScript,
  findRequiredPreScriptFailure,
  formatRequiredPreScriptFailure,
  formatScriptOutput,
  createReviewerDiffAppendHook,
} from '../specialist/runner.js';
import {
  resolveRuntimeToolContract,
  resolveCuratedExtensionPaths,
  resolveExecutionExtensionSelection,
  deduplicateExtensionSources,
  resolveGlobalNodeModulesDir,
  resolvePiVersion,
} from '../pi/session.js';
import { formatResolvedToolContract, withDiscoveredExtensionTools, type ResolvedToolContract } from '../specialist/resolved-tool-contract.js';
import { resolveModelChain } from '../specialist/model-chain.js';
import { extractPurposeExcerpt } from './contract-sections.js';
import {
  openWorkItemBoundary,
  resolveWorkItemDbPath,
  type EpicAncestor,
  type SpecialistWorkItemBoundary,
  type WorkItemView,
} from './workitem-store.js';
import { compileStepContract, type StepContract } from './step-contract.js';
import { validateContractText } from './contract-sections.js';
import { InteractionTransport, type InteractionMessage, type PendingAsk } from './interaction.js';
import { createPeerDelivery } from './peer-bridge.js';
import { PeerAdapter, type TransportForensicEvent } from './transport/peer-adapter.js';
import { acquire as acquireLease, admitToolCall, release as releaseLease } from './workspace-lease.js';
import { createGuardedTools } from './guarded-tools.js';
import { createAskTools, ASK_TOOL, ESCALATE_TOOL } from './ask-tool.js';
import { loadPiSdk, type PiSdk, type PiAgentSessionLike, type PiAgentSessionEvent, type PiModelRuntimeLike, type PiResourceLoaderLike } from './pi-sdk.js';
import { nativeSessionTokenUsage, nativeEventTokenUsage, isNativeUsageEvent, accumulateTokenUsage, captureNativeSessionStats } from '../specialist/native-activation-observability.js';
import { SESSION_STATS_TIMEOUT_MS } from '../specialist/session-metrics-contract.js';
import { createGateModelRuntime, validateModelAvailable } from './model-gate.js';
import { FleetRegistry, RESUMABLE_STATES, RETRYABLE_STATES, nextAttemptId, type ActivationRecord } from './registry.js';
import { publishSettlement, republishPendingSettlements, type SettlementSubject } from './settlement-publication.js';
import { createFileSettlementStore, type SettlementStore } from './settlement-store.js';
import { join } from 'node:path';
import { NULL_AUTHORITY_WRITER, type AuthorityWriter } from './authority-store.js';
import {
  DispatchRejectedError,
  type ActivationHandle,
  type ActivationRequest,
  type ActivationResult,
  type ActivationSnapshot,
  type ActivationState,
  type ActivationTokenUsage,
  type LiveActivationStats,
  THINKING_LEVELS,
  type WorkspaceAccess,
  type WorkspaceIdentity,
} from './types.js';

const TOKEN_USAGE_KEYS = [
  'input_tokens',
  'output_tokens',
  'cache_creation_tokens',
  'cache_read_tokens',
  'reasoning_tokens',
  'tool_tokens',
  'total_tokens',
] as const;

/**
 * Latest spend counts carried by a session event, if any.
 *
 * Pi session events carry usage nested as event.message (role=assistant) -> message.usage
 * with short keys; that shape is read by nativeSessionTokenUsage() in
 * native-activation-observability.ts, which is the canonical reader — this function reuses
 * it and only maps the result onto ActivationTokenUsage. Keep the two paired: a shape
 * change must land in the canonical reader, never in a second reader here.
 */
function extractTokenUsage(event: PiAgentSessionEvent): ActivationTokenUsage | undefined {
  // The ONE rule for which events carry usage (`message_end`, `compaction_end`), shared with
  // the forensic sink's projection so the two native accumulators cannot disagree (F1).
  const nested = nativeEventTokenUsage(event);
  if (nested) {
    // Provenance and the derived-total label are carried, not stripped: the live snapshot must
    // be able to say whether a number is Pi's report, and the durable timeline row already can.
    // Stripping `usage_source` here was the asymmetry the seconder gate flagged.
    return nested;
  }
  const candidates = [event.token_usage, event.tokenUsage, event.usage];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const usage: ActivationTokenUsage = {};
    for (const key of TOKEN_USAGE_KEYS) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) usage[key] = value;
    }
    if (Object.keys(usage).length > 0) return usage;
  }
  return undefined;
}

/** Permission tiers that can mutate the workspace. Derived from the resolved grant. */
const WRITE_TIERS = new Set(['MEDIUM', 'HIGH']);

/**
 * Poll cadence for the tool_duration checker (SPECIALISTS-102). A cadence, not a
 * threshold: the threshold stays STALL_DETECTION_DEFAULTS.tool_duration_warn_ms.
 * Mirrors the legacy 10s stall-watchdog tick (supervisor.ts).
 */
const TOOL_DURATION_CHECK_INTERVAL_MS = 10_000;

/**
 * Legacy-faithful threshold normalization (Target 2, PR #387 review).
 *
 * Legacy spreads the configured value straight through (`{...DEFAULTS,
 * ...opts.stallDetection}`), so 0 and negatives are honoured as-is (the schema
 * permits 0; `elapsed > 0` still gates the warn). This matches that: every finite
 * number passes through INCLUDING 0 and negatives. Non-finite values
 * (NaN/Infinity/non-number) fall back to undefined so the caller applies the
 * shared default — legacy would never warn on those (comparisons are false),
 * native warns per default instead. Garbage-in divergence, documented here
 * rather than silently clamped.
 */
function normalizeToolDurationWarnMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** One in-flight tool call watched for over-threshold duration, per activation. */
interface ToolDurationWatch {
  tool: string;
  toolCallId?: string;
  startMs: number;
  warned: boolean;
  timer: ReturnType<typeof setInterval>;
}

/**
 * Pi's own non-local extension source prefixes. The legacy CLI passes these straight to
 * `-e` and pi's package manager fetches them; the in-process `DefaultResourceLoader` takes
 * filesystem paths only, so they are reported and skipped rather than resolved as a
 * relative path that cannot exist.
 *
 * `npm:` is the one non-local family this path CAN honour, by resolving the already-installed
 * package under the same global node_modules `resolveCuratedExtensionPaths` reads — see
 * `resolveNpmExtensionSource`. Without that, every `npm:` source a specialist enables is
 * silently absent under native dispatch while the legacy CLI still loads it
 * (unitAI-rx1bu: `npm:pi-ast-grep`, enabled for every specialist in the global user config).
 */
const NON_LOCAL_EXTENSION_PREFIXES = ['npm:', 'git:', 'github:', 'http:', 'https:', 'ssh:'];

/**
 * True when an extension source cannot be handed to pi's in-process resource loader as a
 * path, and must instead be resolved by the pi CLI itself.
 *
 * Exported so the native/legacy parity harness can express the one extension divergence that
 * is real as a CHECKED shape (`native == legacy minus non-local sources`) instead of skipping
 * the field entirely — a whole-field skip also hides a divergence in the sources both runtimes
 * CAN load (XTRM-84 section 5).
 *
 * "Non-local" is not the same as "unloadable" here: an `npm:<pkg>` source is resolvable to
 * the installed package directory by `resolveNpmExtensionSource`, and a `git:<spec>` source
 * is resolvable to pi's checkout cache by `resolveGitExtensionSource`, so the native path
 * loads either rather than skipping it. Only the sources with no local form (`http:`,
 * `https:`, `ssh:`, a `git:` spec with no checkout, and an `npm:` package that is not
 * installed) are reported and skipped.
 */
export function isNonLocalExtensionSource(source: string): boolean {
  return NON_LOCAL_EXTENSION_PREFIXES.some((prefix) => source.startsWith(prefix));
}

/**
 * Resolve a declared `npm:<pkg>[@<spec>]` source to the installed package directory.
 *
 * Returns null unless the package is installed with a readable manifest, so a missing
 * package still takes the reported-and-skipped path instead of being handed to the loader
 * as a path that cannot exist. The spec/version is ignored on purpose: the loader wants a
 * directory, and package pinning is the catalog layer's job, not this one's.
 *
 * Injectable so tests can pin the node_modules root instead of inheriting whatever the
 * machine has installed (the same discipline `resolveCuratedExtensionPaths` follows).
 */
export interface ExtensionSourceResolutionEnv {
  globalNodeModulesDir: () => string | undefined;
  manifestExists: (packagePath: string) => boolean;
  /**
   * pi's agent directory (`sdk.getAgentDir()` in production, fixture-pinned in tests).
   * The `git:` checkout cache lives under `<agentDir>/git/<spec>`; pi itself maintains
   * it, so resolution joins under it and never hardcodes `$HOME` or invents a second cache.
   * Optional so existing callers that only resolve `npm:` keep working; absent means
   * `git:` sources cannot resolve and take the skip path.
   */
  piAgentDir?: () => string | undefined;
}

export const defaultExtensionSourceResolutionEnv: ExtensionSourceResolutionEnv = {
  globalNodeModulesDir: resolveGlobalNodeModulesDir,
  manifestExists: (packagePath) => existsSync(join(packagePath, 'package.json')),
  piAgentDir: () => undefined,
};

export function resolveNpmExtensionSource(
  source: string,
  env: ExtensionSourceResolutionEnv = defaultExtensionSourceResolutionEnv,
): string | null {
  const packageName = parseNpmSourceName(source);
  if (!packageName) return null;
  const globalDir = env.globalNodeModulesDir();
  if (!globalDir) return null;
  const packagePath = join(globalDir, packageName);
  return env.manifestExists(packagePath) ? packagePath : null;
}

/**
 * Resolve a declared `git:<spec>` source to pi's checkout cache.
 *
 * The mapping is the spec minus the scheme, joined under the agent directory pi itself
 * maintains: `git:github.com/alonw0/pi-claude-link` → `<agentDir>/git/github.com/alonw0/pi-claude-link`
 * (unitAI-1pqtl.3, same shape as the `npm:` fix in unitAI-rx1bu).
 *
 * Returns null unless the checkout exists with a readable manifest, so an absent or broken
 * checkout takes the reported-and-skipped path rather than a path that cannot load.
 * Read-only and offline: no clone, no fetch, no network, no writes.
 *
 * Injectable via `ExtensionSourceResolutionEnv.piAgentDir` so tests pin a fixture root
 * instead of reading the machine's real cache.
 */
export function resolveGitExtensionSource(
  source: string,
  env: ExtensionSourceResolutionEnv = defaultExtensionSourceResolutionEnv,
): string | null {
  if (!source.startsWith('git:')) return null;
  const spec = source.slice('git:'.length);
  if (!spec) return null;
  // Never let a crafted spec escape the cache root (`git:../evil`, absolute paths).
  if (spec.includes('..') || spec.startsWith('/') || spec.startsWith('\\')) return null;
  const agentDir = env.piAgentDir?.();
  if (!agentDir) return null;
  const checkoutPath = join(agentDir, 'git', spec);
  return env.manifestExists(checkoutPath) ? checkoutPath : null;
}

/**
 * Registry labels expected for the remote sources that resolved (unitAI-1pqtl.3, A′).
 *
 * Pure derivation from the declared set: a `git:<spec>` source that resolved (present in
 * declared, absent from skipped) is expected to label its tools with the declared spec
 * verbatim — measured against the real pi SDK (`git:github.com/alonw0/pi-claude-link` →
 * `git:github.com/alonw0/pi-claude-link`). Unresolved specs contribute nothing, and
 * non-`git:` sources never contribute: attribution covers exactly what this activation
 * resolved, so a `git:` label for an undeclared spec stays refused by construction.
 */
export function expectedRemoteExtensionLabels(
  declaredSources: readonly string[],
  skippedSources: readonly string[],
): string[] {
  const skipped = new Set(skippedSources);
  return declaredSources.filter((source) => source.startsWith('git:') && !skipped.has(source));
}

/**
 * Message for a declared source the native path cannot load.
 *
 * Names the source AND the remedy, not merely the fact of skipping: the operator enabled
 * the source, so the message must say how to make it load (install it with pi so a local
 * form exists) or that removing the enablement stops the warning.
 */
export function formatSkippedExtensionSourceMessage(source: string): string {
  return (
    `[specialists] native activation: extension source '${source}' has no local checkout; ` +
    'the in-process resource loader cannot load it, so it is not injected. ' +
    'To load it, install it with pi so a local checkout exists, or remove the enablement.\n'
  );
}

/**
 * Split declared `execution.extensions` sources into the ones the in-process resource
 * loader can take and the ones it cannot. Local paths pass through untouched; `npm:`
 * sources are resolved to their installed directory when possible; `git:` sources are
 * resolved to pi's checkout cache (`<agentDir>/git/<spec>`) when the checkout exists;
 * everything else non-local (`http:`, `https:`, `ssh:`, uninstalled `npm:`, `git:` with
 * no checkout) is skipped.
 */
export function resolveDeclaredExtensionSources(
  sources: readonly string[],
  env: ExtensionSourceResolutionEnv = defaultExtensionSourceResolutionEnv,
): { local: string[]; skipped: string[] } {
  const local: string[] = [];
  const skipped: string[] = [];
  for (const source of sources) {
    if (!isNonLocalExtensionSource(source)) {
      local.push(source);
      continue;
    }
    const installed = resolveNpmExtensionSource(source, env);
    if (installed) {
      local.push(installed);
      continue;
    }
    const checkout = resolveGitExtensionSource(source, env);
    if (checkout) local.push(checkout);
    else skipped.push(source);
  }
  return { local, skipped };
}

/**
 * Sources whose provenance the discover-then-pin gate trusts (unitAI-1pqtl.2).
 *
 * The same trust rule the legacy CLI policy extension uses
 * (`config/pi-extensions/extension-tool-policy/index.mjs`): a tool whose registry entry
 * reports one of these sources was registered by extension code the operator enabled, not
 * by pi itself. Provenance ALONE does not prevent the collision — a shadowing name also
 * reports `cli` — so the builtin-collision refusal below is required as well.
 */
export const EXTENSION_CLASS_SOURCES: ReadonlySet<string> = new Set(['cli', 'extension', 'package', 'custom']);

/** Registry sources that mark a tool as pi's own builtin, never pinnable.
 *
 * Version-drift note (R3.4b, no code change): these sets are static. If a future pi labels
 * a first-party tool with a source string outside `{builtin, sdk}` / `{cli, extension,
 * package, custom}`, the gates misread it — a builtin-looking name could pin, or every
 * dynamic activation could refuse on baseline/provenance. If dynamic activations start
 * refusing after a pi upgrade with "baseline registry" or "non-extension provenance"
 * notes, look here first and compare `getAllTools()` source strings against these sets.
 */
export const BUILTIN_TOOL_SOURCES: ReadonlySet<string> = new Set(['builtin', 'sdk']);

/** An `npm:` source that was declared enabled but resolved to nothing. Refused, not skipped. */
export function unresolvableNpmSources(skipped: readonly string[]): string[] {
  return skipped.filter((source) => source.startsWith('npm:'));
}

/** The discover-then-pin verdict for one activation's dynamic sources. */
export interface DynamicExtensionDiscovery {
  /** Names safe to pin: extension-class provenance and no builtin collision. */
  pinned: string[];
  /** Discovered names refused because they collide with a builtin name. */
  refusedCollisions: string[];
  /** Discovered names refused because their provenance is not extension-class. */
  refusedProvenance: string[];
  /** Raw active names the discovery session enumerated (before filtering). */
  discoveredRaw: string[];
  /** Builtin names enumerated from a session with NO dynamic sources. */
  builtinNames: string[];
}

const EMPTY_DISCOVERY: DynamicExtensionDiscovery = {
  pinned: [],
  refusedCollisions: [],
  refusedProvenance: [],
  discoveredRaw: [],
  builtinNames: [],
};

function uniqueOrderedNames(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}

function provenanceOf(entry: { sourceInfo?: { source?: string }; source?: string }): string {
  return entry.sourceInfo?.source ?? entry.source ?? '';
}

/**
 * Enumerate pi's builtin tool names DYNAMICALLY, per pi version (unitAI-1pqtl.2).
 *
 * From a fenced session with NO dynamic sources via `getAllTools()` filtered to
 * `sourceInfo.source` in `{builtin, sdk}`. Uses `getAllTools()`, not the active set:
 * the default-active set enumerated only `bash/edit/read/write` while `getAllTools()`
 * also lists platform-gated names such as `powershell`. Never a static list (unitAI-34pyf
 * rejected that pattern for drift).
 *
 * VETO (SPECIALISTS-83): do NOT merge this enumeration into the discovery session below
 * and do NOT relocate it into a session that has the dynamic sources loaded. The baseline
 * must be enumerated with the dynamic sources ABSENT, because in a session with them
 * loaded a shadowed builtin appears ONCE carrying the extension's source (measured:
 * `getToolDefinition('write')` returns the extension's tool, source `cli`), so it fails
 * `BUILTIN_TOOL_SOURCES`, disappears from the baseline set — and a NON-GRANTED builtin
 * such as `write`/`edit`/`bash` for a READ_ONLY child then becomes pinnable. That is a
 * widening through the very path that exists to prevent it, and the unit doubles cannot
 * catch it because they hand-place registry entries. The veto holds REGARDLESS of test
 * results: a change of that shape must not be accepted even if every test passes.
 *
 * A session without `getAllTools` yields an empty set. That is safe ONLY when the
 * discovery registry is also unavailable (both-missing): with no provenance map every
 * discovered name falls to `refusedProvenance` and nothing can be pinned — "no baseline
 * ⇒ nothing attributable ⇒ nothing pinned" is a closed argument, not a hope. Refusing
 * there would break old SDKs for no security gain, so both-missing proceeds with no
 * widening and no refusal. The MIXED case (baseline unavailable while discovery IS
 * available) refuses inside `discoverDynamicExtensionTools` — that is where a colliding
 * name could otherwise be pinned. Do not "harden" this into a blanket refusal.
 */
export async function enumerateBuiltinToolNames(input: {
  sdk: PiSdk;
  cwd: string;
  agentDir: string;
  model: unknown;
}): Promise<string[]> {
  const loader = new input.sdk.DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.agentDir,
    noSkills: true,
    additionalSkillPaths: [],
    noExtensions: true,
    additionalExtensionPaths: [],
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await loader.reload();
  const created = await input.sdk.createAgentSession({
    resourceLoader: loader,
    model: input.model,
    cwd: input.cwd,
    systemPrompt: 'builtin-enumeration (never prompted)',
  });
  try {
    const all = created.session.getAllTools?.() ?? [];
    return uniqueOrderedNames(
      all
        .filter((entry) => BUILTIN_TOOL_SOURCES.has(provenanceOf(entry)))
        .map((entry) => entry.name),
    );
  } finally {
    try { created.session.dispose(); } catch { /* disposal failures are recorded by absence */ }
  }
}

/**
 * Discover-then-pin enumeration (unitAI-1pqtl.2).
 *
 * Creates a fenced, never-prompted discovery session containing ONLY the resolved,
 * deduplicated, explicitly-enabled dynamic sources — no skills, no curated extensions, no
 * ambient discovery, no `customTools`; `noTools: 'builtin'`; `tools` OMITTED — enumerates
 * `getActiveToolNames()`, and splits the names into pinnable vs refused:
 * `pin-able = discovered MINUS builtin names`, with positive extension-class provenance
 * required for every pinned name. Both checks are required: a shadowing `write` also
 * reports `cli`, so provenance alone does not prevent the collision.
 *
 * Returns an empty verdict WITHOUT creating any session when there are no dynamic sources,
 * so existing behaviour is byte-identical for that path. Otherwise creates exactly one
 * builtin-enumeration session plus one discovery session, both disposed in `finally`.
 * Never prompted. No caching.
 *
 * Throws on discovery failure (including a silent-empty set: a non-existent extension path
 * yields an EMPTY set with NO error because `loader.reload()` does not throw). The caller
 * converts that into a fail-closed refusal before any model turn.
 */
export async function discoverDynamicExtensionTools(input: {
  sdk: PiSdk;
  cwd: string;
  agentDir: string;
  dynamicExtensions: readonly string[];
  model: unknown;
  /**
   * Reserved names the child will hold regardless of discovery (F1, R3.1): the base
   * contract's granted native tools PLUS its catalog-granted extension tools PLUS the
   * host's own `ask_coordinator`/`escalate_to_coordinator`. If the discovery registry
   * shows any of these with a NON-builtin source, an enabled extension is shadowing a
   * trusted name — keeping it out of `pinned` does NOT unload the extension, so the
   * activation must be refused, not merely unpinned. REQUIRED (R3.2): a call site that
   * omits it silently loses the shadow check, so there is no default.
   */
  reservedNames: readonly string[];
  /**
   * Registry labels expected for the remote sources THIS activation resolved (unitAI-1pqtl.3, A′).
   *
   * Attribution, not a label taxonomy: pi labels a tool loaded from its git checkout cache
   * with the declared spec verbatim (measured: declared `git:github.com/alonw0/pi-claude-link`
   * → registry `git:github.com/alonw0/pi-claude-link`), so the expected labels are derived
   * from the declared set that actually resolved — never from a hardcoded list, never from
   * a wildcard. A `git:`-labelled tool for a spec this operator never declared is still
   * refused. REQUIRED for the same fail-open reason as `reservedNames`: no default, so a
   * call site that omits it is a type error rather than a silently skipped attribution check.
   */
  allowedRemoteSources: readonly string[];
}): Promise<DynamicExtensionDiscovery> {
  if (input.dynamicExtensions.length === 0) return EMPTY_DISCOVERY;
  // SPECIALISTS-83 veto: the baseline stays in its own source-free session (see
  // `enumerateBuiltinToolNames`). Do not fold it into the source-loaded discovery session
  // below, even if the doubles still pass — they hand-place registry entries and cannot
  // catch the shadowed-builtin widening the separate baseline exists to prevent.
  const builtinNames = await enumerateBuiltinToolNames({
    sdk: input.sdk,
    cwd: input.cwd,
    agentDir: input.agentDir,
    model: input.model,
  });
  const builtinSet = new Set(builtinNames);
  const loader = new input.sdk.DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.sdk.getAgentDir(),
    noSkills: true,
    additionalSkillPaths: [],
    noExtensions: true,
    additionalExtensionPaths: [...input.dynamicExtensions],
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await loader.reload();
  const created = await input.sdk.createAgentSession({
    resourceLoader: loader,
    model: input.model,
    cwd: input.cwd,
    noTools: 'builtin',
    systemPrompt: 'extension-discovery (never prompted)',
  });
  try {
    const discoveredRaw = uniqueOrderedNames(created.session.getActiveToolNames() ?? []);
    if (discoveredRaw.length === 0) {
      // Silent by construction: loader.reload() does not throw for a non-existent path.
      throw new Error(
        `extension discovery yielded no tools for ${input.dynamicExtensions.length} enabled source(s); ` +
        'a declared source that resolves to nothing is a refusal, not a skip',
      );
    }
    // Baseline-vs-attribution (F3 decision B): the discovery registry may be unavailable on
    // old SDKs. With no provenance map every name falls to refusedProvenance and nothing pins
    // — safe to proceed. The dangerous MIXED case is baseline-empty while attribution IS
    // available: a colliding name would then look pinnable. Refuse exactly that case below.
    const discoveryRegistryAvailable = typeof created.session.getAllTools === 'function';
    const registry = discoveryRegistryAvailable ? created.session.getAllTools!() : [];
    const provenance = new Map(registry.map((entry) => [entry.name, provenanceOf(entry)]));
    if (!discoveryRegistryAvailable) {
      // Both-missing: no baseline (builtinNames empty, since the enumeration session also
      // lacks the accessor on old SDKs) and no attribution. Nothing can be pinned; proceed
      // with no widening rather than refusing every dynamic activation on old SDKs.
      // Note: if the baseline WAS established (builtinNames non-empty) but discovery lacks
      // the registry, the same logic holds — no attribution ⇒ nothing pinned ⇒ safe.
    } else if (builtinNames.length === 0) {
      // MIXED case: attribution possible, collision baseline not. A builtin name could
      // otherwise be pinned. Refuse loudly rather than proceeding with an empty baseline.
      throw new Error(
        'cannot establish the builtin baseline registry while the discovery registry is available; ' +
        'refusing rather than pinning names that cannot be checked for collisions',
      );
    }
    // F1 (CRITICAL): a shadowed GRANTED name executes extension code even when it is never
    // pinned, because the real session still loads the shadowing extension. The rendered
    // contract and the name-level promised-vs-active check both pass (the NAME is granted),
    // while the CODE behind it is the extension's. Refuse loudly, naming the tool and source.
    // No `?? []` here on purpose: the parameter is required, so re-defaulting it at the use
    // site would restore exactly the fail-open the requirement removed — an omitted list
    // must be a crash, not a silently skipped shadow check.
    for (const name of input.reservedNames) {
      const source = provenance.get(name);
      if (source !== undefined && !BUILTIN_TOOL_SOURCES.has(source)) {
        throw new Error(
          `enabled extension shadows granted tool '${name}' (registry source '${source}'); ` +
          'refusing rather than running extension code under a trusted name',
        );
      }
    }
    const pinned: string[] = [];
    const refusedCollisions: string[] = [];
    const refusedProvenance: string[] = [];
    for (const name of discoveredRaw) {
      // F2: the host's own ask/escalate names must never be pinned — an extension
      // registering them collides with the host's customTools. The reserved-name refusal
      // above already covers the loaded half; this keeps them out of the contract too.
      if (name === ASK_TOOL || name === ESCALATE_TOOL) {
        refusedProvenance.push(name);
        continue;
      }
      if (builtinSet.has(name)) {
        refusedCollisions.push(name);
        continue;
      }
      const source = provenance.get(name) ?? '';
      // A′ attribution (unitAI-1pqtl.3): extension-class either by the frozen taxonomy
      // (`EXTENSION_CLASS_SOURCES`, untouched) or by per-activation attribution to a remote
      // source THIS activation resolved from the operator's declared set. Anything else —
      // including a `git:` label for a spec nobody declared — stays refused. No `?? []` on
      // `allowedRemoteSources`: it is required, so re-defaulting it would restore the
      // fail-open the requirement removed.
      if (!EXTENSION_CLASS_SOURCES.has(source) && !input.allowedRemoteSources.includes(source)) {
        refusedProvenance.push(name);
        continue;
      }
      pinned.push(name);
    }
    return { pinned, refusedCollisions, refusedProvenance, discoveredRaw, builtinNames };
  } finally {
    try { created.session.dispose(); } catch { /* disposal failures are recorded by absence */ }
  }
}


/**
 * The activation's `cwd` and `agentDir` feed pi's resource loader, which is the ONLY
 * seam through which skills, extensions, prompt templates, themes and context files
 * reach an AgentSession (pi 0.85.1 has no `skills` field on `CreateAgentSessionOptions`).
 *
 * The legacy CLI isolates the child and then re-adds exactly the declared skills:
 * `--no-skills` at src/pi/session.ts:969, one `--skill <resolved path>` per declared
 * entry at :1001, `--no-extensions` and the curated `-e` set, `--no-context-files`,
 * `--no-prompt-templates`, `--no-themes`. `noSkills: true` + `additionalSkillPaths` is
 * the loader equivalent of that pair, and it is what stops the host project's own
 * skills and `AGENTS.md` from being auto-discovered into a child that never asked for
 * them.
 *
 * `skillPaths` are the SAME resolved paths `validateBeforeRun` hard-fails on
 * (native-host.ts, `validateBeforeRun(specialist, tier, toolContract)`), so a validated
 * skill is a loaded skill rather than a silently ignored `--skill` argument. Extension
 * paths are supplied by the caller; extension injection is a separate child issue and
 * passes none yet, while `noExtensions: true` already fences ambient ones.
 */
/**
 * The workspace a native activation runs in: the coordinator's own working
 * directory. ONE source for it, because the rendered Runtime Boundary Rules block,
 * the session `cwd`, the guarded-tool `cwd` and the workspace lease all key on this
 * value — two derivations that happen to agree today is exactly how they stop
 * agreeing tomorrow (SPECIALISTS-21).
 *
 * RUN-IN-PLACE IS THE DELIBERATE DESIGN, recorded here rather than in a document
 * because the next reader of this function is the one who will wonder whether it is
 * an omission:
 *   - `xt claude` / `xt pi` already launch the coordinator into an isolated worktree,
 *     so a per-activation worktree is isolation inside isolation.
 *   - The workspace LEASE is what provides the single-writer guarantee. That was the
 *     deliberate design, and a worktree would not add a guarantee the lease lacks.
 *   - Provisioning would drag the legacy handoff protocol into the native runtime: a
 *     `worktree_owner_job_id` reuse so a reviewer can read the writer's tree, plus a
 *     merge back per activation, on a merge path CLAUDE.md declares prohibited and
 *     known broken pending a separate rework epic.
 *   - The known cost, accepted: the coordinator is not a lease participant, so a
 *     coordinator edit and a write-tier activation can interleave. That hazard is
 *     tracked separately (the coordinator edit warning), and it is not a reason to
 *     provision worktrees.
 * Anyone reopening worktree provisioning must first answer the merge-path problem.
 */
export function resolveWorkspace(cwd: string): WorkspaceIdentity {
  return { repositoryRoot: cwd, worktreePath: cwd };
}

export function createActivationResourceLoader(
  sdk: PiSdk,
  options: { cwd: string; skillPaths: string[]; extensionPaths?: string[] },
): PiResourceLoaderLike {
  return new sdk.DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: sdk.getAgentDir(),
    noSkills: true,
    additionalSkillPaths: options.skillPaths,
    noExtensions: true,
    additionalExtensionPaths: options.extensionPaths ?? [],
    // Auto-discovered AGENTS.md and project context files must not silently enter the
    // child's prompt; the loader CAN be told to skip them, so it is told.
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
  });
}

/**
 * Error classes the fallback walk advances past. The classifier itself is shared with
 * the CLI runner (`classifyFallbackError` in runner.ts) — this set is only the native
 * half of the CLI's `isTransient && !isAuth` rule, restated as classes so the two
 * cannot drift into disagreeing about what a 429 means.
 */
const FALLBACK_RETRYABLE_CLASSES = new Set(['rate_limit', 'timeout', 'transient']);

/**
 * Sink for activation forensics.
 *
 * Native activations write the SAME `observability.db` as the legacy runner — there is no
 * native-subagent telemetry database. This interface exists only so tests can observe the
 * event stream without a database; production wires it to `appendForensicEvent`.
 */
export interface ActivationForensicSink {
  emit(event: {
    activationId: string;
    attemptId: string;
    participantId: string;
    specialist: string;
    beadId?: string;
    name: string;
    payload?: Record<string, unknown>;
  }): void;

  /**
   * Receives every RAW Pi session event, untranslated.
   *
   * The `emit` path above carries a small hand-written vocabulary; this one carries the
   * whole stream so the Phase 7 mapper can produce timeline rows through the same
   * factories the legacy `sp run` path uses. Without it, a native activation and a legacy
   * one answer the same query differently.
   *
   * Optional by design: every existing sink, including the null sink and each test double,
   * keeps working untouched. The two paths do not overlap — raw events feed the timeline
   * mappers, and the translated `emit` names remain the sole producers of their own rows.
   */
  sessionEvent?(input: NativeActivationSessionEventInput): void;

  /**
   * Receives peer-transport route and delivery events.
   *
   * The transport lane writes no forensics itself — `observability.db` is the single
   * forensic authority and no lane owns a file belonging to the sink, which is why
   * `PeerAdapter` takes an injected `emit` rather than importing one. Ownership follows the
   * authority; the fact that three lanes then merged without touching each other's files is
   * a consequence of that boundary, not a merge tactic to copy where no boundary exists.
   */
  peerTransportEvent?(event: TransportForensicEvent): void;
}

/** One raw session event, with the activation identity needed to attribute it. */
export interface NativeActivationSessionEventInput {
  activationId: string;
  attemptId: string;
  participantId: string;
  specialist: string;
  beadId?: string;
  piSessionId: string;
  workspacePath: string;
  event: PiAgentSessionEvent;
}

/** Discards events. Used only where forensics are genuinely not wanted (unit tests). */
export const NULL_FORENSIC_SINK: ActivationForensicSink = { emit: () => {} };

export interface NativeActivationHostDeps {
  loader?: SpecialistLoader;
  /**
   * The shared Substrate work boundary (ADR §8-§12). When omitted the host
   * resolves lazily against the canonical store (SUBSTRATE_DB, then
   * XTRM_STATE_DB, then ~/.xtrm/state.db) and refuses dispatch fail-closed when that store
   * is absent or unopenable — never by falling back to another authority.
   */
  workItems?: SpecialistWorkItemBoundary;
  forensics?: ActivationForensicSink;
  /** Injected for tests; defaults to resolving the real Pi SDK. */
  loadSdk?: () => Promise<PiSdk>;
  /** Defaults to `process.cwd()`. */
  cwd?: string;
  now?: () => number;
  /**
   * S1 runtime result storage. Defaults to the file store under
   * `<cwd>/.specialists/settlements/`; tests inject the memory store.
   * Best-effort by contract — publication never fails an activation.
   */
  settlements?: SettlementStore;
  /**
   * Environment the X1 envelope reads the exact R4 contract from
   * (`XTRM_SESSION_ID`, `XTRM_SESSION_NAME` only). Defaults to process.env.
   */
  env?: Record<string, string | undefined>;
  /**
   * Persists the Fleet projection to the one Substrate authority. Defaults to a
   * no-op (unit tests); production servers inject `createFileAuthorityWriter()`.
   * Best-effort by contract — the writer never throws, so lifecycle never depends
   * on the store being present, writable, or even openable.
   */
  authority?: AuthorityWriter;
  /**
   * Push asks to a live Claude coordinator over the peer channel.
   *
   * Omit it and the host is polling-only, which is the degraded path and is correct: the
   * question is still readable through `specialist_status` and nothing is lost. Supplying
   * it does not make delivery guaranteed — see docs/design/claude-transport-decision.md §5.
   */
  peer?: PeerDelivery;
  /**
   * Admission: the pre-flight gate that decides whether a resolved definition may actually
   * run on THIS host. Defaults to `validateBeforeRun`, which is the real, fail-closed
   * production gate — missing skill path, absent external command, required_tool the tier
   * does not grant.
   *
   * It is injectable only so COMPOSITION can be measured independently of ADMISSION
   * (XTRM-84 4c): the native/legacy parity harness compares what the two runtimes COMPILE
   * for a shipped definition, and a validator whose verdict depends on which binaries are on
   * the host's PATH is not part of either runtime's composition. Injecting it here is
   * narrower than the alternative the harness used before, which was to rewrite the shipped
   * definition and then compare a definition no user has.
   */
  admission?: (specialist: unknown, tier: string, toolContract: ResolvedToolContract) => void;
  /**
   * Stall detection thresholds, shared with the legacy supervisor path (SPECIALISTS-102).
   * Only `tool_duration_warn_ms` is read here; the running/waiting reasons stay
   * legacy-only and are never emitted by this host.
   *
   * This is an explicit host-level OVERRIDE: when provided it wins over the
   * specialist spec (operator/test policy beats packaged default). When omitted the
   * host resolves the threshold from the dispatched spec's `stall_detection`
   * (same source legacy `sp run` uses), falling back to STALL_DETECTION_DEFAULTS.
   * Either way production honours a configured threshold with no construction-site
   * change, because the host resolves the spec itself on every dispatch.
   */
  stallDetection?: StallDetectionConfig;
  /**
   * Bound on the settlement `get_session_stats` capture (SPECIALISTS-120). Defaults to 5s;
   * tests inject a short bound to prove the failure path without waiting one out.
   */
  sessionStatsTimeoutMs?: number;
  /** Injected for tests; defaults to probing the `pi` binary on PATH. */
  piVersion?: string;
}

/** Configuration for pushing interactions to a Claude coordinator. */
export interface PeerDelivery {
  /** The coordinator's Claude session id. The only stable address on this channel. */
  coordinatorSessionId: string;
  /** Repository root under which `.specialists/interactions/` lives. Defaults to `cwd`. */
  repoRoot?: string;
  /** Built for tests; defaults to a real `PeerAdapter` against the live roster. */
  adapter?: PeerAdapter;
  replyTimeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * A live activation view attached to a running or resumable session.
 *
 * `detach` only removes this listener; it is symmetric with `attach`/`return` and never
 * touches the session's turn, its state, or any other attachment on the same activation.
 */
export interface ActivationAttachment {
  snapshot: ActivationSnapshot;
  detach: () => void;
}

export class NativeActivationHost {
  private readonly loader: SpecialistLoader;
  /** Injected boundary, or undefined to resolve the canonical store lazily. */
  private readonly workItemsInjected?: SpecialistWorkItemBoundary;
  /** Lazily-opened canonical boundary; only touched when none was injected. */
  private workItemsDefault?: SpecialistWorkItemBoundary;
  private readonly forensics: ActivationForensicSink;
  private readonly loadSdk: () => Promise<PiSdk>;
  private readonly cwd: string;
  private readonly now: () => number;
  private readonly sessionStatsTimeoutMs?: number;
  private readonly piVersion?: string;
  private readonly authority: AuthorityWriter;
  private readonly settlements: SettlementStore;
  /** Admission gate. Defaults to the real `validateBeforeRun`; see `NativeActivationHostDeps`. */
  private readonly admission: (specialist: unknown, tier: string, toolContract: ResolvedToolContract) => void;
  /** Guards the once-per-process settlement republish pass (SPECIALISTS-54). */
  private republished = false;
  private readonly env: Record<string, string | undefined>;

  private readonly registry = new FleetRegistry();

  /**
   * Last per-message usage value seen per activation, keyed by live snapshot.
   * Feeds accumulateTokenUsage so delta-shape and cumulative-shape providers both
   * project monotonic totals. WeakMap: the entry dies with the snapshot, and resume
   * keeps the same snapshot so counters continue across attempts by construction.
   */
  private readonly lastUsageSeen = new WeakMap<object, Record<string, number>>();

  /**
   * Active tool_duration watches, keyed by ACTIVATION id (SPECIALISTS-102).
   *
   * Activation-keyed, never session-keyed: the fallback walk, retry() and resume()
   * all replace record.session under the SAME activation id, and none of those sites
   * touches this map — so a replacement can never rebuild or reset the watch, and
   * at-most-once holds ACROSS attempts (a new attempt arms a new watch only when a
   * new tool call starts). In production no live watch spans a replacement:
   * publishTerminalSettlement clears it on every runToSettled terminal leg, the
   * fallback continues same-attempt, and retry()/resume() start new attempts
   * post-settle. The synthetic session-swap test pins this keying invariant at
   * unit level; it is not production traversal of those sites. Entries die on tool
   * end, on terminal settle (publishTerminalSettlement) and on stop(); the timer
   * is unref'd so a missed stop can never pin this long-lived process.
   */
  private readonly toolDurationWatch = new Map<string, ToolDurationWatch>();
  /** Warn threshold fallback when an activation has no resolved entry; dep or shared default. */
  private readonly toolDurationWarnMs: number;
  /** Explicit host-level override; undefined when no dep was provided (spec applies). */
  private readonly toolDurationWarnMsByDep: number | undefined;
  /**
   * Per-activation warn threshold, resolved once at dispatch (SPECIALISTS-102
   * parity follow-up): explicit host dep > specialist spec > shared default.
   *
   * Lifetime follows the REGISTRY, not the watch: entries are set in start() and
   * deleted only in stop() (the sole registry.remove site), so retry()/resume()
   * legs — new attempts under the same activation id — keep the spec threshold
   * without re-resolving anything. A tool end clears the watch but never this.
   */
  private readonly toolDurationWarnMsByActivation = new Map<string, number>();

  /**
   * One transport for the whole host. Messages carry their own activationId, so a single
   * instance serves every child and the parent enumerates asks across the Fleet in one
   * place rather than walking activations.
   *
   * Delivery is wired only when a coordinator address is configured. Without one the
   * transport is in-process and every ask reads as `pending` through `specialist_status`,
   * which is the degraded path and is fully functional — the peer channel is an
   * optimisation on top of durable state, never a prerequisite for it (PRD §30).
   */
  private readonly interactions: InteractionTransport;

  constructor(deps: NativeActivationHostDeps = {}) {
    this.cwd = deps.cwd ?? process.cwd();
    this.interactions = new InteractionTransport(
      deps.peer ? { deliver: this.wirePeerDelivery(deps.peer) } : {},
    );
    this.loader = deps.loader ?? new SpecialistLoader({ projectDir: this.cwd });
    this.workItemsInjected = deps.workItems;
    this.forensics = deps.forensics ?? NULL_FORENSIC_SINK;
    this.loadSdk = deps.loadSdk ?? loadPiSdk;
    this.now = deps.now ?? (() => Date.now());
    this.sessionStatsTimeoutMs = deps.sessionStatsTimeoutMs;
    this.piVersion = deps.piVersion;
    this.authority = deps.authority ?? NULL_AUTHORITY_WRITER;
    this.settlements = deps.settlements ?? createFileSettlementStore(join(this.cwd, '.specialists', 'settlements'));
    this.admission = deps.admission ?? ((candidate, tier, contract) => validateBeforeRun(candidate as never, tier, contract));
    this.toolDurationWarnMs = normalizeToolDurationWarnMs(deps.stallDetection?.tool_duration_warn_ms) ?? STALL_DETECTION_DEFAULTS.tool_duration_warn_ms;
    this.toolDurationWarnMsByDep = normalizeToolDurationWarnMs(deps.stallDetection?.tool_duration_warn_ms);
    this.env = deps.env ?? process.env;
  }

  /**
   * Admit and start one activation.
   *
   * Every rejection below happens BEFORE an AgentSession exists, and each leaves forensic
   * evidence: a refused dispatch is still runtime evidence, and a dispatch that failed
   * silently is indistinguishable from one that never happened.
   */
  async start(request: ActivationRequest): Promise<ActivationHandle> {
    const activationId = `act:${randomUUID().slice(0, 12)}`;
    const attemptId = `att:${activationId.slice(4)}:1`;
    // `::` is the house separator for every participant kind in deriveParticipantId
    // (`orch::`, `node::`, `<container>::emitter::`), and it is what the identity
    // migration writes. A single colon here would produce a participant_id that no
    // lineage query joins against.
    const participantId = `specialist::${request.specialist}`;

    // The forensic event field keeps its storage name (bead_id column in
    // observability.db) but carries the ISSUE ref post-A7; storage-column
    // renames are fleet-sweep territory, not runtime-boundary territory.
    const emit = (name: string, payload?: Record<string, unknown>) =>
      this.forensics.emit({
        activationId, attemptId, participantId,
        specialist: request.specialist, beadId: request.issueRef, name, payload,
      });

    emit('activation_requested', {
      requested_by: request.requestedByParticipantId,
      model_override: request.modelOverride ?? null,
      thinking_override: request.thinkingOverride ?? null,
    });

    /**
     * Releases the workspace lease THIS activation took, if it took one.
     *
     * A refusal firing after acquisition used to leak the lease (SPECIALISTS-42 review): the
     * holder is this long-lived MCP server process, so the workspace read as `held` indefinitely
     * and every later writer was refused with workspace_held_by_another_writer — one refused
     * write-tier dispatch poisoned the workspace for the life of the process. A fail-closed
     * refusal that silently blocks all later writers is the same invisibility this issue exists
     * to remove.
     *
     * Gated on our own successful acquisition rather than calling release unconditionally.
     * `release` cannot release another writer's lease — it inspects the holder and throws
     * `workspace_lease_not_held_by_caller` — and it throws `workspace_lease_uncertain` rather
     * than guessing about a holder whose liveness is unknown. So an unconditional call on a
     * pre-acquisition refusal (an unknown specialist, an empty contract, a contract/ref
     * conflict) would not free anything: it would convert a clean refusal into a spurious
     * `lease_release_failed` event. The gate is what keeps this releasing exactly the lease
     * this activation took, and only when it took one.
     *
     * DISARMED once admission succeeds: after that the lease belongs to the snapshot
     * lifecycle (`releaseIfWriter` on settle, completion and stop), not to this closure.
     * Leaving it armed let a later fallback or retry attempt reach a start()-scoped release
     * carrying the wrong lifecycle assumptions.
     */
    let releaseOwnLease: (() => void) | null = null;
    const releaseLeaseOnRefusal = (): void => {
      if (!releaseOwnLease) return;
      const release = releaseOwnLease;
      releaseOwnLease = null;
      release();
    };

    /**
     * The issue an inline contract created and claimed, named on every refusal that fires after it.
     *
     * An inline dispatch creates AND claims a durable issue before the lease is taken and before the
     * tool verification runs, so a refusal after that point leaves a claimed issue behind and never
     * returns the `created_bead_id` that would otherwise tell the caller it exists. Set below, read
     * here, so no refusal path can forget it — including ones added later. A rejection must not leave
     * durable work the caller cannot discover (SPECIALISTS-45).
     */
    let createdRefForRefusals: string | undefined;

    /**
     * Releases the claim the inline issue took, so a refused inline dispatch leaves an issue that is
     * immediately re-dispatchable instead of one locked for the claim TTL by an activation that
     * never ran (SPECIALISTS-53). Armed where the issue is created, called from `reject` for the same
     * reason as the ref: `reject` is defined before `workItems` is assigned and is genuinely called
     * before that (unknown_specialist), so it cannot reach the boundary directly.
     */
    let releaseInlineClaimOnRefusal: (() => void) | null = null;
    const releaseClaimForRefusal = (): void => {
      if (!releaseInlineClaimOnRefusal) return;
      const release = releaseInlineClaimOnRefusal;
      releaseInlineClaimOnRefusal = null;
      release();
    };

    const reject = (reason: string, detail: Record<string, unknown> = {}): never => {
      // All first, so no refusal path can forget any of them.
      releaseLeaseOnRefusal();
      releaseClaimForRefusal();
      emit('activation_rejected', { reason, ...detail });
      throw new DispatchRejectedError(reason, {
        specialist: request.specialist,
        issueRef: request.issueRef,
        ...(createdRefForRefusals ? { created_ref: createdRefForRefusals } : {}),
        ...detail,
      });
    };

    // SPECIALISTS-54: drain the pending-publication backlog before the first dispatch this
    // process serves. Not awaited into the refusal path — a backlog must never refuse a
    // dispatch — but awaited here so the pass has finished before any new settlement is
    // written, which keeps the reconciliation reads and the writes from interleaving.
    await this.republishOncePerProcess();

    const specialist = await this.loader.get(request.specialist).catch((error: unknown) => {
      return reject('unknown_specialist', {
        note: error instanceof Error ? error.message : String(error),
      });
    });
    if (!specialist) return reject('unknown_specialist');

    const execution = specialist.specialist.execution;
    const tier = execution.permission_required ?? 'READ_ONLY';

    // SPECIALISTS-102 parity follow-up: honour the specialist's configured threshold
    // exactly like legacy `sp run` (launch.ts:96 passes spec stall_detection to the
    // Supervisor). Precedence: explicit host dep (operator/test override) > spec >
    // shared default. The production construction sites need no change: the host
    // resolves the spec itself on every dispatch, so a configured threshold reaches
    // native the same way it reaches legacy.
    const specToolDurationWarnMs = specialist.specialist.stall_detection?.tool_duration_warn_ms;
    this.toolDurationWarnMsByActivation.set(
      activationId,
      this.toolDurationWarnMsByDep
        ?? normalizeToolDurationWarnMs(specToolDurationWarnMs)
        ?? STALL_DETECTION_DEFAULTS.tool_duration_warn_ms,
    );

    // Readers and writers are both admitted. A write tier does not gate admission here; it
    // selects the LEASE path below, and the lease is what makes a single writer safe. The
    // refusal this comment used to describe was removed when the lease was wired
    // (unitAI-rrdnt.21/.36) — a comment claiming writers are refused, above code that admits
    // them, is worse than no comment.
    const access: WorkspaceAccess = WRITE_TIERS.has(tier) ? 'write' : 'read';

    // The workspace is resolved BEFORE the work gate: the dispatch gate binds
    // workspace into its verdict, and it is available without the model or tool
    // contracts that follow.
    const workspace: WorkspaceIdentity = resolveWorkspace(this.cwd);

    // Shared Substrate work boundary (§8-§12). No Beads client, no bd
    // subprocess, no second readiness derivation: the gate lives in the
    // substrate dispatch service and this host only renders its refusals.
    let workItems: SpecialistWorkItemBoundary;
    try {
      workItems = await this.resolveWorkItems();
    } catch (error) {
      return reject('work_item_store_unavailable', {
        note: error instanceof Error ? error.message : String(error),
      });
    }

    // Inline-contract dispatch (§10): the host owns creation — validate →
    // create → attest → claim through the boundary, then dispatch against the
    // created issue. Adapters pre-check with validateContractText for the
    // refusal shape; inlineCreate re-validates authoritatively, so a refusal
    // here still leaves the board unchanged. Creation runs BEFORE any session
    // exists and claims WITH this activation's id, satisfying the strict
    // claim-activation equality the bind path enforces.
    const inlineContract = (request.contract ?? '').trim();
    let autoCreatedRef: string | undefined;
    if (inlineContract) {
      if (request.issueRef) {
        return reject('contract_and_ref', {
          note: 'contract and issueRef were both provided — provide exactly one',
        });
      }
      try {
        const created = workItems.inlineCreate(inlineContract, {
          ...(request.title ? { title: request.title } : {}),
          holder: participantId,
          activationId,
        });
        autoCreatedRef = created.ref;
        createdRefForRefusals = created.ref;
        releaseInlineClaimOnRefusal = () => {
          try {
            // The activation id is passed so the boundary releases only a claim THIS activation
            // took, rather than whatever is live (SPECIALISTS-53 review).
            workItems.releaseInlineClaim?.(created.ref, { activationId });
          } catch {
            // Cleanup must not change the outcome: the refusal is still a refusal.
          }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('inline contract is not a usable task contract')) {
          const rechecked = validateContractText(inlineContract);
          return reject('issue_not_dispatchable', {
            note: message,
            ...(!rechecked.ok ? { missing: rechecked.missing } : {}),
          });
        }
        // Creation infra failure (issue may exist without a claim): surface,
        // never claim the board is unchanged.
        throw error;
      }
    }
    const issueRef = autoCreatedRef ?? request.issueRef ?? '';
    if (!issueRef) {
      return reject('no_work_ref', {
        note: 'neither issueRef nor contract was provided — dispatch requires an existing issue or an inline contract',
      });
    }

    let view: WorkItemView;
    try {
      view = workItems.view(issueRef);
    } catch (error) {
      return reject('issue_unresolvable', {
        note: error instanceof Error ? error.message : String(error),
      });
    }

    // `--issue` is the prompt. An Issue that is not dispatchable (draft,
    // unattested, blocked, deferred, terminal) is refused here, before a model
    // turn is spent guessing at the scope it does not carry. Scope-expanding
    // requests refuse the same way (§39.1: requestedScope may only narrow).
    let dispatchCheck: ReturnType<SpecialistWorkItemBoundary['check']>;
    try {
      dispatchCheck = workItems.check({
        ref: issueRef,
        specialist: request.specialist,
        holder: participantId,
        // The landed producer gate fences claimed dispatch on holder +
        // activation at CHECK time (anti-steal); the read-only check must
        // carry the same identity the bind will pin, or live-held issues
        // refuse here. Unclaimed issues ignore it.
        activationId,
        workspace: workspace.worktreePath,
      });
      // The first view is only for resolution/error reporting. Re-read the
      // admitted revision after the gate so prompt and StepContract cannot use
      // a pre-gate "latest" if an edit raced the read-only check.
      view = workItems.view(issueRef);
      if (view.revision !== dispatchCheck.revision || view.contractHash !== dispatchCheck.contractHash) {
        return reject('issue_revision_diverged', {
          note: 'issue changed between resolution and the read-only dispatch check; retry against the new revision',
        });
      }
    } catch (error) {
      const note = error instanceof Error ? error.message : String(error);
      const missing = note.match(/missing(?: required sections)?:\s*([^;]+)/i)?.[1]
        ?.split(',').map((entry) => entry.trim()).filter(Boolean);
      return reject('issue_not_dispatchable', {
        note,
        ...(missing?.length ? { missing } : {}),
      });
    }

    // The definition's declared extension selection, resolved ONCE so the tool contract, the
    // resource loader and any future consumer cannot disagree. Before SPECIALISTS-57 the tool
    // contract was resolved without it and the loader resolved it separately twice below.
    const extensionSelection = resolveExecutionExtensionSelection(specialist.specialist.execution?.extensions);

    const toolContract = resolveRuntimeToolContract({
      level: tier,
      specialistName: request.specialist,
      specialistPermissions: specialist.specialist.permissions,
      // SPECIALISTS-57: the definition's OWN extension selection must reach the tool-contract
      // resolution, exactly as the legacy runner passes it (src/specialist/runner.ts:1098-1107).
      // Omitting it made the native path honour `execution.extensions: { gitnexus: false }` in
      // the resource loader (below) but NOT in the contract: with a healthy gitnexus the
      // catalog's hard deny then removed grep/find/ls from a specialist that had explicitly
      // turned gitnexus off to keep them, and `validateBeforeRun` refused the dispatch. On a
      // runner without gitnexus the deny is inactive and the same specialist dispatched fine,
      // so the defect was visible only on machines that had the extension installed.
      excludeExtensions: extensionSelection.excludeExtensions,
      extensionSources: extensionSelection.extensionSources,
      cwd: this.cwd,
    });
    if (!toolContract || toolContract.toolsList.length === 0) {
      return reject('empty_tool_contract', { tier });
    }

    // Admission (`validateBeforeRun`, including `required_tools`) runs AFTER the effective
    // contract is finalized and the prompt is rendered (unitAI-1pqtl.2 ordering:
    // discovery -> effective contract -> prompt render -> admission -> session creation),
    // so a discovered extension tool satisfies `required_tools` instead of refusing as
    // "missing from resolved runtime contract". See the call site after `renderTaskPrompt`.

    // Pre-phase scripts run locally BEFORE an AgentSession exists, matching the legacy
    // runner (src/specialist/runner.ts:1120+): a required script's nonzero exit refuses
    // the dispatch here, so no model turn is spent and no session is created, and the
    // captured stdout of every `inject_output` script reaches the prompt as
    // `$pre_script_output`. validateBeforeRun above already proved each script exists and is
    // executable, so a missing script refuses before this point rather than as a spawn error.
    const preScripts = specialist.specialist.skills?.scripts?.filter((s) => s.phase === 'pre') ?? [];
    const preScriptResults = preScripts.map((script) =>
      runScript(script.run ?? (script as unknown as { path?: string }).path, this.cwd));
    const requiredPreFailure = findRequiredPreScriptFailure(preScripts, preScriptResults);
    if (requiredPreFailure) {
      return reject('required_pre_script_failed', {
        note: formatRequiredPreScriptFailure(requiredPreFailure),
      });
    }
    const preScriptOutput = formatScriptOutput(
      preScriptResults.filter((_, index) => preScripts[index].inject_output),
    );

    const sdk = await this.loadSdk();
    // Fail closed rather than fall back to pi's auto-discovering DefaultResourceLoader:
    // a session that discovers its own skills is the exact defect this closes. The real
    // SDK always exports both (loadPiSdk validates them); only a stale or hand-rolled
    // SDK injection can land here.
    if (typeof sdk.DefaultResourceLoader !== 'function' || typeof sdk.getAgentDir !== 'function') {
      return reject('pi_sdk_resource_loader_unavailable', {
        note: 'this pi SDK cannot declare which skills a session loads, so the declared-skills contract cannot be honoured',
      });
    }

    // The full configured chain is the candidate list (unitAI-3emr7 reverses the
    // unitAI-rrdnt.35 never-fallback ruling, which settled every 429 as failed and wasted
    // the run). An explicit override replaces the chain — a chain of one — which mirrors
    // the CLI `backendOverride` path: a manual switch runs on exactly what was asked for,
    // never on a silent substitute. The walk itself happens below and in runWithFallback:
    // a retryable provider error (rate_limit/timeout/transient per the classifier shared
    // with the CLI runner) advances to the next model and the winner is recorded on the
    // snapshot, so attribution answers "what actually ran" rather than "what was first".
    const fullChain = resolveModelChain(execution);
    const configuredModel = fullChain[0];
    const modelChain = request.modelOverride ? [request.modelOverride] : fullChain;
    const requestedModel = request.modelOverride ?? configuredModel;
    if (request.thinkingOverride !== undefined && !(THINKING_LEVELS as readonly string[]).includes(request.thinkingOverride)) {
      return reject('invalid_thinking_override', {
        thinkingOverride: request.thinkingOverride,
        note: `supported thinking levels: ${THINKING_LEVELS.join(', ')}`,
      });
    }
    const thinkingLevel = request.thinkingOverride ?? execution.thinking_level;
    if (!requestedModel) return reject('no_model_configured');

    // An explicit override that is unavailable must fail here rather than silently
    // running on something else. Both halves of the gate are required — see model-gate.ts.
    // Without an override the walk starts here: the first HONOURABLE model wins the
    // dispatch-time session, and an unavailable primary with a configured fallback is
    // skipped with forensics rather than spending a turn failing. Post-dispatch provider
    // failures continue the same walk inside runWithFallback.
    const modelRuntime = await createGateModelRuntime(sdk);
    let modelIndex = 0;
    let modelCheck = await validateModelAvailable(sdk, modelRuntime, modelChain[0] ?? '');
    while ((!modelCheck.ok || !modelCheck.model) && modelIndex < modelChain.length - 1) {
      const skipped = modelChain[modelIndex];
      emit('model_fallback', {
        from_model: skipped ?? null,
        to_model: modelChain[modelIndex + 1],
        error_class: 'unavailable',
        terminal: false,
        note: modelCheck.reason ?? null,
      });
      modelIndex += 1;
      modelCheck = await validateModelAvailable(sdk, modelRuntime, modelChain[modelIndex] ?? '');
    }
    if (!modelCheck.ok || !modelCheck.model) {
      return reject('model_unavailable', {
        requestedModel: modelChain[modelIndex] ?? requestedModel,
        note: modelCheck.reason,
      });
    }
    const resolvedModel = modelCheck.resolvedModel ?? modelChain[modelIndex] ?? requestedModel;

    // Discover-then-pin (unitAI-1pqtl.2): the definition's declared extension sources,
    // resolved ONCE so the tool contract, discovery, the resource loader and any future
    // consumer cannot disagree. The curated set is what the legacy CLI re-enables after
    // `--no-extensions` (shared helper so the two runtimes cannot drift), plus the
    // definition's own declared sources with the same-identity de-dup rule (unitAI-il2io).
    // Resolved here — before discovery, the effective contract, the prompt and admission —
    // so every later consumer reuses these values instead of re-resolving.
    const curatedExtensions = resolveCuratedExtensionPaths({
      permissionLevel: tier,
      resolvedToolContract: toolContract,
    });
    const declaredExtensions = extensionSelection.extensionSources;
    const { local: declaredLocalExtensions, skipped: skippedDeclaredSources } =
      resolveDeclaredExtensionSources(declaredExtensions, {
        ...defaultExtensionSourceResolutionEnv,
        // The same agent-directory resolution the runtime already uses for the loader
        // (`sdk.getAgentDir()` below): the `git:` cache root is derived from it, never
        // hardcoded from `$HOME`, and no second cache or download path is invented.
        piAgentDir: () => sdk.getAgentDir(),
      });
    // Skipped sources (`git:` with no checkout, `http:`/`https:`/`ssh:`, uninstalled `npm:`)
    // stay reported-and-skipped here (unitAI-1pqtl.3 option A). A stricter refusal for
    // unresolvable enabled sources was REJECTED — `git:github.com/alonw0/pi-claude-link` is
    // enabled fleet-wide, so refusing would block every activation under the default config.
    // This bead refuses the SILENT failure instead: a RESOLVED source whose discovery
    // yields an empty set (a non-existent path loads with NO error) is a refusal, not a
    // skip, detected positively inside `discoverDynamicExtensionTools`.
    for (const source of skippedDeclaredSources) {
      process.stderr.write(formatSkippedExtensionSourceMessage(source));
    }
    const { kept: dynamicExtensions, dropped: droppedExtensions } = deduplicateExtensionSources(
      curatedExtensions.dedupeAgainstDynamic,
      declaredLocalExtensions,
    );
    for (const { dropped, keptAs } of droppedExtensions) {
      process.stderr.write(
        `[python-kernel] DEDUP: skipping duplicate extension source '${dropped}' (same as '${keptAs}'; kept '${keptAs}').\n`,
      );
    }

    // Discovery runs exactly once per activation, before the effective contract, the prompt,
    // admission and any real session — so a child can never hold more than the contract it
    // was shown, and every real/retry/fallback session pins the identical finalized allowlist.
    //
    // SPECIALISTS-83: the double session_start is bounded and observable. A dynamic
    // activation creates exactly two extra fenced sessions (the builtin baseline above plus
    // the discovery session below), so each enabled extension runs its load-time work twice
    // per activation. The `extension_discovery_sessions` forensic signal states that bound
    // and why, so an operator or forensic reader can see the cost; a no-dynamic-source
    // activation creates zero extra sessions and emits no signal.
    const emitDiscoverySessionsSignal = (): void => {
      emit('extension_discovery_sessions', {
        fenced_sessions: 2,
        baseline_session: 'builtin-enumeration (never prompted)',
        discovery_session: 'extension-discovery (never prompted)',
        dynamic_sources: dynamicExtensions.join(','),
        note: 'builtin baseline enumerated with no dynamic sources so a shadowed builtin stays distinguishable from an extension tool; discovery enumerates the declared sources; each enabled extension runs load-time work twice per activation',
      });
    };
    let discovery: DynamicExtensionDiscovery;
    try {
      discovery = await discoverDynamicExtensionTools({
        sdk,
        cwd: workspace.worktreePath,
        agentDir: sdk.getAgentDir(),
        dynamicExtensions,
        model: modelCheck.model,
        // F1 + R3.1: every name the child can hold regardless of pinning — granted natives
        // ∪ base extensionTools (catalog-granted, e.g. gitnexus_query) ∪ ask/escalate. A
        // non-builtin registry entry for any of these means an enabled extension shadows a
        // trusted name; the `already`-filter in the materializer handles the PIN, not the
        // LOAD, so this must refuse. deniedNativeTools stays excluded (not held) and pinned
        // names need no protection (extension-attributed by construction).
        reservedNames: [...toolContract.nativeTools, ...toolContract.extensionTools, ASK_TOOL, ESCALATE_TOOL],
        // A′ attribution (unitAI-1pqtl.3): the registry labels expected for the remote
        // sources THIS activation resolved, derived from the declared set (never a
        // hardcoded list, never a wildcard). REQUIRED with no default, like reservedNames.
        allowedRemoteSources: expectedRemoteExtensionLabels(declaredExtensions, skippedDeclaredSources),
      });
      if (dynamicExtensions.length > 0) emitDiscoverySessionsSignal();
    } catch (error) {
      if (dynamicExtensions.length > 0) emitDiscoverySessionsSignal();
      const note = error instanceof Error ? error.message : String(error);
      // Loud, specific reason for the shadow case (F1): names the tool and the source.
      // All other discovery failures stay under the generic fail-closed reason.
      if (note.includes('shadows granted tool')) {
        return reject('extension_tool_shadowed', { note });
      }
      return reject('extension_discovery_failed', { note });
    }
    const effectiveToolContract = withDiscoveredExtensionTools(toolContract, {
      pinned: discovery.pinned,
      refusedCollisions: discovery.refusedCollisions,
      refusedProvenance: discovery.refusedProvenance,
    });
    if (discovery.refusedCollisions.length > 0 || discovery.refusedProvenance.length > 0) {
      emit('extension_tools_refused', {
        refused_collisions: discovery.refusedCollisions.join(',') || null,
        refused_provenance: discovery.refusedProvenance.join(',') || null,
        pinned: discovery.pinned.join(',') || null,
      });
    }
    if (discovery.pinned.length > 0) {
      emit('extension_tools_discovered', {
        pinned: discovery.pinned.join(','),
        sources: dynamicExtensions.join(','),
      });
    }

    // PRD Phase 10 / §52. A writer takes the lease BEFORE a session exists, so contention
    // is refused without spending a model turn, and so a refused writer never reaches the
    // point where it could mutate anything. A reader takes nothing: it is not entitled to
    // the lease, and `admitToolCall` refuses it every mutating call for that reason.
    //
    // `acquire` throws DispatchRejectedError on contention and on an uncertain lease, and
    // both are correct refusals rather than errors — an uncertain workspace is never
    // stolen, because a holder whose liveness is unknown may still be mutating it and only
    // reconciliation decides what happened (`workspace-reconcile.ts`).
    if (access === 'write') {
      try {
        acquireLease({ workspace, activationId, attemptId, specialist: request.specialist });
      } catch (error) {
        if (error instanceof DispatchRejectedError) {
          emit('lease_denied', {
            workspace: workspace.worktreePath,
            reason: error.reason,
            note: error.detail.holder,
          });
        }
        emit('activation_rejected', { reason: 'workspace_lease_unavailable' });
        // Rebuilt rather than rethrown so the created ref is named without losing the acquire's own
        // reason and holder detail: a caller needs to know WHO holds the workspace, and that the
        // inline contract already left a claimed issue behind (SPECIALISTS-45).
        // The inline claim is released on this path too: this refusal throws a rebuilt error rather
        // than going through reject(), so routing the release only through reject would leave the
        // claim held on exactly the path where the workspace was the problem (SPECIALISTS-53).
        releaseClaimForRefusal();
        if (error instanceof DispatchRejectedError && createdRefForRefusals) {
          throw new DispatchRejectedError(error.reason, {
            ...error.detail,
            created_ref: createdRefForRefusals,
          });
        }
        throw error;
      }
      emit('lease_acquired', { workspace: workspace.worktreePath });
      releaseOwnLease = () => {
        try {
          releaseLease(workspace, activationId);
          emit('lease_released', { workspace: workspace.worktreePath, reason: 'activation_refused' });
        } catch (error) {
          // A refusal is still a refusal: cleanup failing must not turn it into a different
          // outcome, exactly as teardown is never failed by a release that could not run.
          emit('lease_release_failed', {
            workspace: workspace.worktreePath,
            note: error instanceof Error ? error.message : String(error),
          });
        }
      };
    }

    // PRD §15: bound this activation to its role. Derived and in-memory — compiling a
    // StepContract creates no issue, chain, or graph (Phase 4, invariant 4).
    // Compiled from the RESOLVED issue revision: the contract the worker sees
    // is the contract the gate admitted, not a later "latest" (§9).
    const stepContract = compileStepContract({
      work: { ref: view.ref, title: view.title, contract: view.contract },
      revision: dispatchCheck.revision,
      specialist: specialist.specialist.metadata.name,
      responseFormat: execution.response_format,
      now: this.now,
    });

    emit('step_contract_compiled', {
      root_work_ref: stepContract.rootWorkRef,
      inputs: stepContract.inputs.length,
      outputs: stepContract.outputs.length,
      non_goals: stepContract.nonGoals.length,
      constraints: stepContract.constraints?.length ?? 0,
      validation: stepContract.validation?.length ?? 0,
      source_issue_revision: stepContract.provenance.sourceIssueRevision ?? null,
    });

    // `activation_admitted` telemetry moved after prompt render + admission (unitAI-1pqtl.2):
    // it must carry the FINALIZED effective allowlist, and admission must see the prompt it
    // admits. See the emit after `systemPrompt` below.

    // §11: lineage comes from Substrate parent_child edges, not a Beads
    // dependency walk, and obeys the same inheritance rules as the store.
    const epicAncestors = workItems.epicAncestors(issueRef, request.epicContextDepth ?? 0);

    // Dependency context for completed blockers, from the SAME Substrate edge graph and the
    // SAME boundary that supplies epicAncestors — never a second traversal. Without this a
    // child never sees the contracts that unblocked it (SPECIALISTS-22).
    const completedBlockers = workItems.completedBlockers(issueRef, 1);

    const isReviewer = specialist.specialist.metadata.name === 'reviewer';

    const rendered = renderTaskPrompt({
      specialist: specialist.specialist,
      // Both the cwd the prompt reports and the boundary it names come from
      // `workspace`; the session below is created with the same value. No two
      // derivations to drift.
      cwd: workspace.worktreePath,
      worktreeBoundary: workspace.worktreePath,
      beadId: view.ref,
      bead: workItemAsRecord(view),
      epicAncestors: epicAncestors.map(workAncestorAsRecord),
      completedBlockers: completedBlockers.map(workAncestorAsRecord),
      preScriptOutput,
      // $resolved_tool_contract: 7 shipped specialists interpolate it, and explorer's template
      // instructs the model to "Read resolved tool contract first". The renderer treats an
      // unsupplied optional placeholder as an intentional EMPTY, so omitting it here did not
      // fail loudly — it silently handed those specialists a contract block that pointed at
      // nothing. Filled from the FINALIZED effective contract (base + discovered), so the
      // prompt and the enforced gate cannot disagree: a child never holds more than the
      // contract it was shown (unitAI-1pqtl.2).
      variables: {
        resolved_tool_contract: formatResolvedToolContract(effectiveToolContract, 'discover-then-pin'),
      },
      // Reviewer diff context is EXECUTION-ONLY, so it enters through the hook rather than
      // the pure renderer — and it must land before the prompt hash, exactly as it does on
      // the legacy path. Without it the reviewer role loses its diff entirely.
      ...(isReviewer
        ? {
            appendExecutionContext: createReviewerDiffAppendHook((message) => process.stderr.write(`${message}\n`)),
          }
        : {}),
    });

    // Mandatory-rules resolution failure: FAIL CLOSED, deliberately.
    //
    // The two legacy consumers disagree — `sp run` warns and continues, the read-only
    // renderer treats it as fatal "precisely so a coordinator can never launch silently
    // missing its rules". Native dispatch IS a coordinator launch, which is the case the
    // renderer's fatal policy exists to protect, so a specialist that cannot be given its
    // mandatory rules is refused here rather than launched without them. Silent omission
    // is the one option neither legacy consumer chose.
    if (rendered.mandatoryRulesError) {
      return reject('mandatory_rules_unavailable', {
        note: `mandatory rules could not be resolved, and a native activation is never launched without them: ${rendered.mandatoryRulesError}`,
      });
    }

    // The same injection metadata the legacy path emits, so the Fleet can answer "which
    // rules did this activation actually run under".
    if (rendered.mandatoryRules && rendered.mandatoryRulesBlock?.trim()) {
      const rules = rendered.mandatoryRules;
      emit('mandatory_rules_injection', {
        source: 'mandatory_rules_injection',
        sets_loaded: rules.setsLoaded,
        rules_count: rules.ruleCount,
        inline_rules_count: rules.inlineRulesCount,
        globals_disabled: rules.globalsDisabled,
        token_estimate: rules.injectedTokens,
        budget_limit: rules.budgetLimit,
        candidate_tokens: rules.candidateTokens,
        injected_tokens: rules.injectedTokens,
        injected_section_ids: rules.injectedSectionIds,
        evicted_section_ids: rules.evictedSectionIds,
        payload_digest: rules.payloadDigest,
        outcome: rules.outcome,
      });
    }

    // Resolved ONCE from the definition, exactly as the legacy call site does
    // (src/specialist/runner.ts: `resolveOutputContractSchema(responseFormat, outputType,
    // prompt.output_schema)`). The native path used to hardcode `undefined`, so every
    // specialist declaring `prompt.output_schema` was asked for structured output by its
    // prompt and never told the schema (SPECIALISTS-5).
    const responseFormat = execution.response_format ?? 'text';
    const outputType = execution.output_type ?? 'custom';
    const outputContractSchema = resolveOutputContractSchema(
      responseFormat,
      outputType,
      specialist.specialist.prompt.output_schema,
    );

    const systemPrompt = buildSystemPrompt({
      systemPromptTemplate: specialist.specialist.prompt.system ?? '',
      templateVariables: rendered.beadTemplateVariables ?? {},
      bare: execution.bare ?? false,
      runCwd: workspace.worktreePath,
      specialistName: specialist.specialist.metadata.name,
      inputIssueRef: view.ref,
      responseFormat,
      outputType,
      outputContractSchema,
      beadContextText: rendered.beadContextText ?? '',
      readBeadForMemory: (id) => {
        try {
          const v = workItems.view(id);
          return { title: v.title, description: contractToMarkdown(v.contract) };
        } catch {
          return null;
        }
      },
    });

    // Admission AFTER prompt rendering (unitAI-1pqtl.2 ordering): the effective contract is
    // finalized before the prompt, and the prompt is rendered before admission, so
    // `required_tools` validation sees discovered extension names instead of refusing them
    // as "missing from resolved runtime contract". Fail-closed before any model turn and
    // before any real session exists; the lease taken above is released via `reject()`.
    //
    // The validator stays injectable so COMPOSITION and ADMISSION can be exercised
    // separately (XTRM-84 4c). The default is the real `validateBeforeRun`.
    try {
      this.admission(specialist, tier, effectiveToolContract);
    } catch (error) {
      return reject('preflight_failed', {
        note: error instanceof Error ? error.message : String(error),
      });
    }

    emit('activation_admitted', {
      tier, access,
      configured_model: configuredModel ?? null,
      requested_model: requestedModel,
      resolved_model: resolvedModel,
      model_override: Boolean(request.modelOverride),
      thinking_level: thinkingLevel ?? null,
      thinking_override: request.thinkingOverride !== undefined,
      workspace: workspace.worktreePath,
      tools: effectiveToolContract.toolsList.join(','),
      custom_tools: `${ASK_TOOL},${ESCALATE_TOOL}`,
    });

    emit('activation_starting', { pi_session_id: null });

    // The ask/escalate tools are CUSTOM tools, admitted alongside the resolved allowlist
    // rather than added to it. A read-only Specialist gains the ability to ask without
    // gaining any mutation capability — asking is not a workspace operation.
    const askTools = createAskTools(sdk, {
      transport: this.interactions,
      activationId,
      currentAttemptId: () => this.registry.get(activationId)?.snapshot.attemptId ?? attemptId,
      self: participantId,
      parent: request.requestedByParticipantId,
      onAsk: (kind, body) => {
        const record = this.registry.get(activationId);
        if (record) record.snapshot.state = kind === 'escalation' ? 'escalated' : 'needs_reply';
        if (record) this.save(record.snapshot);
        emit(kind === 'escalation' ? 'escalation_raised' : 'clarification_requested', { body });
      },
      onAnswered: (kind) => {
        const record = this.registry.get(activationId);
        if (record) record.snapshot.state = 'running';
        if (record) this.save(record.snapshot);
        emit(kind === 'escalation' ? 'escalation_resolved' : 'clarification_answered');
      },
    });

    // PRD §52: the mutating builtins are RECONSTRUCTED and wrapped here, so the only
    // mutating tool the child can reach is one that consults the lease on every call. A
    // guard each frontend has to remember to call is optional enforcement; this one cannot
    // be skipped, because the frontend is not involved (unitAI-rrdnt.36.2).
    const guardedTools = createGuardedTools(sdk, {
      toolNames: effectiveToolContract.toolsList,
      cwd: workspace.worktreePath,
      admit: toolName => admitToolCall({ toolName, workspace, activationId }),
    });

    if (guardedTools.unguardable.length > 0) {
      // A mutating tool we cannot reconstruct cannot be fenced. Passing it through would
      // make the lease decorative for exactly the calls it exists to stop, so the dispatch
      // is refused and the names are named.
      emit('lease_denied', {
        workspace: workspace.worktreePath,
        note: `cannot guard mutating tools: ${guardedTools.unguardable.join(', ')}`,
      });
      return reject('unguardable_mutating_tools', {
        note: `these tools mutate and cannot be fenced by the workspace lease on this runtime: ${guardedTools.unguardable.join(', ')}`,
      });
    }

    // Built ONCE, before any attempt: every session created below — the first, a
    // fallback model, a retry — must see the same declared resources and the identical
    // finalized allowlist. `reload()` is explicit because createAgentSession only reloads
    // a loader it constructed itself. Extension paths reuse the discovery-time resolution
    // above (`curatedExtensions` + `dynamicExtensions`), never re-resolved, so discovery,
    // the real loader and the effective contract cannot disagree.
    // Known accepted gap (R3.4a, no behaviour change): the real loader loads curated
    // extensions too, while discovery loads only dynamic sources — so a CURATED extension
    // shadowing a granted native is undetected by the reserved-name check. Accepted because
    // curated paths are host-resolved and in-repo, not operator-supplied: the trust boundary
    // the shadow refusal protects is the operator-enabled dynamic set. Do not add a scan.
    const resourceLoader = createActivationResourceLoader(sdk, {
      cwd: workspace.worktreePath,
      skillPaths: specialist.specialist.skills?.paths ?? [],
      extensionPaths: [...curatedExtensions.all, ...dynamicExtensions],
    });
    await resourceLoader.reload();

    // Session options are built once so every later attempt on a new model — the fallback
    // walk below, a retry with an override — creates its session identically to the first.
    // The ask/escalate tools are shared across attempts on purpose: they key off the live
    // attempt id, not the session, so a fallback keeps the same pending-ask correlation.
    const baseSessionOptions = {
      customTools: [...askTools, ...guardedTools.tools],
      cwd: workspace.worktreePath,
      resourceLoader,
      // The pi SDK takes a Model object here. Passing the provider-qualified string
      // instead is accepted silently and then fails mid-turn with an unresolved provider.
      model: modelCheck.model,
      ...(thinkingLevel ? { thinkingLevel } : {}),
      // Fail-closed: only the resolved contract's tools, never pi's defaults. `noTools`
      // must be "builtin" rather than `tools: []`, which would also empty customTools.
      noTools: 'builtin',
      // `tools` is a HARD FILTER on pi 0.85.1 and it applies to `customTools` too: a
      // session given customTools: [ask_coordinator] and tools: ['read'] reports exactly
      // ['read'], dropping the custom tool silently — no error, no diagnostic. So the ask
      // tools have to be named here as well as passed above, or no Specialist can ever
      // reach its coordinator (unitAI-rrdnt.43). Measured on a live session by enumerating
      // getAllTools(), not inferred.
      //
      // Omitting `tools` entirely is NOT the alternative: that admits every builtin,
      // measured at 50+ including bash, edit, write and powershell. Fail-open is worse than
      // the bug. Naming the two ask tools keeps admission fail-closed and widens nothing —
      // asking is not a workspace operation and neither tool can mutate anything.
      // Pinned to the FINALIZED effective allowlist (base + discovered): every real, retry
      // and fallback session is built from these same options, so no attempt can exceed the
      // contract the child was shown. The hard filter stays: `tools` is never omitted on a
      // prompted session.
      tools: [...effectiveToolContract.toolsList, ASK_TOOL, ESCALATE_TOOL],
      systemPrompt: systemPrompt.text,
    };

    // SPECIALISTS-42 (c): post-load verification on the NATIVE path.
    //
    // This runtime does not load the tool-policy gate at all — it relies on pi's `tools`
    // hard filter, which drops anything it does not name and cannot supply anything it does.
    // So a tool the contract promised but the runtime does not expose is simply absent, and
    // before this nothing noticed. The contract is the promise; the live session's active set
    // is the fact; a Specialist is never launched with a smaller surface than it was told it
    // had. Verified here rather than in the gate because the gate is not on this path.
    const PROMISED_TOOLS = [...effectiveToolContract.toolsList];
    const missingPromisedTools = (candidate: PiAgentSessionLike): string[] => {
      const active = new Set(candidate.getActiveToolNames());
      return PROMISED_TOOLS.filter((tool) => !active.has(tool));
    };
    const createVerifiedSession = async (
      model: { id?: string; provider?: string },
      options: { viaFallback?: boolean } = {},
    ): Promise<PiAgentSessionLike> => {
      const created = await sdk.createAgentSession({ ...baseSessionOptions, model });
      const missing = missingPromisedTools(created.session);
      if (missing.length > 0) {
        // Fail closed BEFORE the binding and before any model turn: a session missing a
        // promised tool cannot do the work its contract describes, and continuing would
        // report success for a run that silently had less capability than it declared.
        created.session.dispose();
        const detail = {
          missing,
          // An inline contract is created AND claimed before this point, so a refusal here
          // leaves a durable issue behind. Name it: an orphan nobody is told about is the
          // failure mode the inline dispatch path already warns about in its result.
          ...(autoCreatedRef ? { created_ref: autoCreatedRef } : {}),
          note:
            `the session did not expose ${missing.join(', ')}; the resolved contract promised them, ` +
            'and a native activation is never launched with a smaller tool surface than its contract declares',
        };
        if (options.viaFallback) {
          // This activation was already admitted and its handle returned to the caller, so
          // emitting `activation_rejected` would report an admitted activation as rejected to
          // anything reading the event stream. Distinct event instead.
          //
          // The lease is deliberately NOT released here. Admission disarmed the start()-scoped
          // release, and the lease belongs to the snapshot lifecycle: the previous attempt
          // settled, and settling releases through releaseIfWriter. Releasing again from here
          // would make two owners of one release, and if another writer acquired in the gap the
          // snapshot-lifecycle release would throw workspace_lease_not_held_by_caller and
          // surface as a false `lease_uncertain` alarm on a workspace that is actually fine.
          emit('tool_contract_unsatisfied_on_fallback', { missing, model: model.id ?? null });
          throw new DispatchRejectedError('tool_contract_unsatisfied', {
            specialist: request.specialist,
            issueRef: request.issueRef,
            ...detail,
          });
        }
        return reject('tool_contract_unsatisfied', detail);
      }
      return created.session;
    };

    const session = await createVerifiedSession(modelCheck.model);

    // §49 dispatch step: the mutation lands at activation start, once the
    // physical session exists, so the ExecutionBinding can pin the real
    // session id alongside issue/revision/hash/claim/participant/activation/
    // attempt/workspace (§9). A concurrent contract edit between the
    // read-only check above and this binding refuses here — the divergence
    // check is inside the substrate dispatch gate, never re-derived.
    let binding: ReturnType<SpecialistWorkItemBoundary['bind']>;
    try {
      binding = workItems.bind({
        ref: issueRef,
        specialist: request.specialist,
        holder: participantId,
        activationId,
        attemptId,
        sessionId: session.sessionId,
        workspace: workspace.worktreePath,
      });
    } catch (error) {
      try { session.dispose(); } catch { /* best effort before refusing */ }
      return reject('issue_binding_failed', {
        note: error instanceof Error ? error.message : String(error),
      });
    }

    // Same verification on every later attempt: a fallback model or a retry must not be the
    // one place that runs with an unverified tool surface.
    const createSessionForModel = (model: { id?: string; provider?: string }) =>
      createVerifiedSession(model, { viaFallback: true });

    const purpose = purposeExcerptFromContract(view.contract);
    const startedAt = this.now();
    // SPECIALISTS-42: a reduced tool surface is surfaced at admission, the same way the
    // build-staleness line is. Deduplicated because the same reason reaches warnings and
    // downgradeReasons through different paths, and a repeated line reads as two problems.
    const toolContractNotes = [...new Set([...effectiveToolContract.warnings, ...effectiveToolContract.downgradeReasons])];
    const configNotes = legacyOnlyConfigNotes(specialist.specialist);

    const snapshot: ActivationSnapshot = {
      activationId, participantId, attemptId,
      specialist: request.specialist,
      issueId: view.issueId,
      issueRef: view.ref,
      issueRevision: binding.issueRevision,
      contractHash: binding.contractHash,
      executionBindingId: binding.id,
      state: 'starting',
      access, workspace,
      piSessionId: session.sessionId,
      configuredModel,
      // What the CALLER asked for, recorded even when it equals what resolved. Without the
      // equal case the useful query — "which activations ran on something other than what
      // was asked for" — is unanswerable, and `configuredModel` does not substitute: that
      // is what the Specialist configures, which becomes a different question the moment an
      // override exists (unitAI-rrdnt.35).
      requestedModel,
      resolvedModel,
      modelOverride: Boolean(request.modelOverride),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      thinkingOverride: request.thinkingOverride !== undefined,
      // Initialized to 0 rather than left absent: at this point the child has provably
      // completed no turn, so zero is a measurement and not a zero-fill.
      turnCount: 0,
      // Captured once at dispatch from the validated contract; the tick stays an in-memory read.
      ...(purpose ? { purpose } : {}),
      startedAt,
      lastActivityAt: startedAt,
      ...(toolContractNotes.length > 0 ? { toolContractNotes } : {}),
      ...(configNotes.length > 0 ? { configNotes } : {}),
    };

    emit('activation_started', { pi_session_id: session.sessionId });

    const unsubscribe = session.subscribe((event) => this.onSessionEvent(snapshot, event, emit));

    // The result promise owns the fallback walk: the first attempt runs, and a failure
    // whose class is retryable advances to the next chain model on a FRESH session under
    // the SAME activation and attempt — dispatch already returned by then, so the walk
    // must not block it. The registry record is mutated in place (session, snapshot,
    // unsubscribe) so status/readers observe the winner, not the casualty.
    const record: ActivationRecord = {
      snapshot, session, unsubscribe,
      result: undefined as unknown as Promise<ActivationResult>,
      stepContract, initialPrompt: rendered.initial_prompt, createSession: createSessionForModel,
      // S1 coordinator lineage: the dispatcher pair every attempt publishes
      // under its own attempt id. Carried on the record so retry/resume legs
      // publish coherently without re-resolving anything.
      lineage: {
        ...(request.requestedByParticipantId ? { coordinatorParticipantId: request.requestedByParticipantId } : {}),
        ...(request.coordinatorSessionId ? { coordinatorSessionId: request.coordinatorSessionId } : {}),
      },
      workItems,
      ...(typeof (binding as { baseCommit?: unknown }).baseCommit === 'string' && ((binding as { baseCommit?: string }).baseCommit as string).trim() !== ''
        ? { bindingBaseCommit: (binding as { baseCommit?: string }).baseCommit as string }
        : {}),
    };
    const result = this.runWithFallback(record, {
      modelChain, modelIndex, sdk, modelRuntime,
      initialPrompt: rendered.initial_prompt, emit,
    });
    record.result = result;

    this.registry.register(record);
    this.save(snapshot);

    // Admission is complete: the lease now belongs to the snapshot lifecycle, so the
    // start()-scoped release must not fire again. Anything post-admission routes through
    // releaseIfWriter, which knows the activation and turns an uncertain release into evidence
    // instead of freeing a workspace that may still be under mutation.
    releaseOwnLease = null;

    return {
      activationId, participantId, attemptId,
      specialist: request.specialist,
      issueId: view.issueId,
      issueRef: view.ref,
      access, workspace, resolvedModel,
      stepContract,
      result,
    };
  }

  /**
   * The shared work boundary for this host.
   *
   * Injected wins. Otherwise the canonical store opens lazily on first
   * dispatch: absent or unopenable refuses fail-closed (§10) — the runtime
   * never falls back to a second work authority. Opening runs the substrate
   * migrations, which are append-only and idempotent, so the first dispatch on
   * a machine whose store exists but predates a migration heals it.
   */
  private async resolveWorkItems(): Promise<SpecialistWorkItemBoundary> {
    if (this.workItemsInjected) return this.workItemsInjected;
    if (this.workItemsDefault) return this.workItemsDefault;
    const dbPath = resolveWorkItemDbPath();
    if (!existsSync(dbPath)) {
      throw new Error(
        `no Substrate work store at ${dbPath} (set SUBSTRATE_DB (or the legacy XTRM_STATE_DB) or initialize it via xt init / sb)`,
      );
    }
    // Runtime dynamic import from XTRM_SUBSTRATE_DIR; absent package refuses
    // fail-closed with work_item_store_unavailable — never a second authority.
    this.workItemsDefault = await openWorkItemBoundary({ dbPath });
    return this.workItemsDefault;
  }

  /**
   * Republish settlements whose publication degraded, ONCE per host process (SPECIALISTS-54).
   *
   * The trigger is deliberately the first dispatch rather than host construction: a host is
   * constructed in every test and by every read-only tool call, and a settlement backlog must
   * not be retried by processes that never publish anything. The first dispatch is the smallest
   * trigger that covers the post-cutover backlog, which is the case the issue is about — the
   * records written while the runtime pointed at a pre-result Substrate build.
   *
   * Best-effort by the same contract as publication itself: a backlog that cannot be drained
   * must never refuse the dispatch that triggered the drain.
   */
  private async republishOncePerProcess(): Promise<void> {
    if (this.republished) return;
    this.republished = true;
    try {
      const boundary = await this.resolveWorkItems();
      const pending = this.settlements.listPendingPublication?.() ?? [];
      if (pending.length === 0) return;
      const outcomes = republishPendingSettlements({
        boundary,
        store: this.settlements,
        participantId: 'specialist::settlement-republisher',
        repositoryRoot: this.cwd,
        env: this.env,
        emit: (name, payload) => this.forensics.emit({
          activationId: 'act:settlement-republisher',
          attemptId: 'att:settlement-republisher:1',
          participantId: 'specialist::settlement-republisher',
          specialist: 'settlement-republisher',
          name,
          payload,
        }),
      });
      const unresolved = outcomes.filter((outcome) => outcome.outcome !== 'published');
      if (unresolved.length > 0) {
        // Named, not counted: an operator has to be able to find the records.
        process.stderr.write(
          `[specialists] ${unresolved.length} settlement(s) still unpublished after republish: `
            + `${unresolved.map((o) => `${o.activationId}/${o.attemptId}=${o.outcome}`).join(', ')}\n`,
        );
      }
    } catch (error) {
      process.stderr.write(
        `[specialists] settlement republish pass failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  /**
   * Translate Pi session events into Specialists forensic events.
   *
   * `agent_end` is a per-turn boundary carrying `willRetry`; `agent_settled` is the
   * governed quiescence boundary. Conflating them is why a naive host disposes a child
   * that was merely pausing.
   */
  private onSessionEvent(
    snapshot: ActivationSnapshot,
    event: PiAgentSessionEvent,
    emit: (name: string, payload?: Record<string, unknown>) => void,
  ): void {
    snapshot.lastActivityAt = this.now();
    // Session spend merges one message's provider counts into the running total
    // (unitAI-beqby.15): per-message deltas add whole, cumulative-per-message
    // counters add only their growth, so neither shape flaps the row down nor
    // explodes it. Exactly ONE rule decides which events carry usage
    // (`isNativeUsageEvent` + `nativeEventTokenUsage`, shared with the forensic sink's
    // projection), and it covers `compaction_end` as well as `message_end`: the
    // summarization call is billed by Pi and counted in its session totals, and it never
    // appears as an assistant message, so a rule that read only `message_end` made every
    // compacted activation disagree with Pi's own snapshot (SPECIALISTS-120 F1).
    const usage = isNativeUsageEvent(event) ? extractTokenUsage(event) : undefined;
    if (usage) {
      const seen = this.lastUsageSeen.get(snapshot) ?? {};
      snapshot.tokenUsage = accumulateTokenUsage(snapshot.tokenUsage, usage, seen);
      this.lastUsageSeen.set(snapshot, seen);
    }

    // Offer the RAW event before any translation. Deliberately not wrapped in try/catch:
    // the sink swallows its own errors, and a forensic concern must never alter activation
    // behaviour — nor be silently hidden by a catch here.
    this.forensics.sessionEvent?.({
      activationId: snapshot.activationId,
      attemptId: snapshot.attemptId,
      participantId: snapshot.participantId,
      specialist: snapshot.specialist,
      beadId: snapshot.issueRef,
      piSessionId: snapshot.piSessionId ?? '',
      workspacePath: snapshot.workspace.worktreePath,
      event,
    });

    switch (event.type) {
      case 'agent_start':
        snapshot.state = 'running';
        this.save(snapshot);
        emit('turn_started');
        break;
      case 'agent_end':
        emit('turn_completed', { will_retry: Boolean(event.willRetry) });
        break;
      case 'turn_end':
        // The canonical per-turn boundary: one finished assistant message and its tool
        // results. Counted here and nowhere else — `agent_start`/`agent_end` bracket a whole
        // run (a run with tool calls contains several turns), and the message/streaming
        // events would count one turn many times. Cumulative across attempts by mutation:
        // resume and retry reuse this snapshot, which is what the Fleet reads.
        snapshot.turnCount = (snapshot.turnCount ?? 0) + 1;
        break;
      case 'agent_settled':
        // Quiescence alone does not say whether the turn succeeded — `runToSettled`
        // inspects stopReason for that, right after this same `waitForIdle()` resolves,
        // and is the sole place that emits the terminal `activation_settled`/
        // `activation_failed` pair (unitAI-8s7xx: emitting it here unconditionally made
        // an aborted turn push BOTH `completed` and `failed`). The lease release and
        // state bookkeeping below are unconditional on every settle, aborted or not.
        snapshot.state = 'settled';
        this.save(snapshot);
        this.releaseIfWriter(snapshot, 'settled');
        break;
      case 'auto_retry_start':
        emit('retry_started', { attempt: event.attempt, max_attempts: event.maxAttempts });
        break;
      case 'auto_retry_end':
        emit('retry_completed', { success: event.success, attempt: event.attempt });
        break;
      case 'compaction_start':
        emit('compaction_started', { reason: event.reason });
        break;
      case 'compaction_end':
        emit('compaction_completed', { reason: event.reason, aborted: event.aborted });
        break;
      case 'tool_execution_start':
        // SPECIALISTS-102: feed the tool_duration checker. No forensic emit here —
        // the checker emits at most once per call, only when it runs over threshold.
        this.noteToolStart(snapshot, event);
        break;
      case 'tool_execution_end':
        this.noteToolEnd(snapshot.activationId, event);
        break;
      default:
        break;
    }
  }

  /**
   * Capture and record Pi's terminal session totals (SPECIALISTS-120 criterion 3).
   *
   * Emitted BEFORE the terminal activation event, so `activation_completed`'s run_complete row
   * carries both the snapshot and its reconciliation. A failure is emitted as its own event:
   * a run whose snapshot is missing must say so, because a silently absent snapshot is
   * indistinguishable from a run that legitimately had no tokens.
   */
  private async captureSessionStats(
    session: PiAgentSessionLike,
    emit: (name: string, payload?: Record<string, unknown>) => void,
  ): Promise<void> {
    const timeoutMs = this.sessionStatsTimeoutMs ?? SESSION_STATS_TIMEOUT_MS;
    const piVersion = this.piVersion ?? resolvePiVersion();
    const { stats, error } = await captureNativeSessionStats(session, timeoutMs);
    if (stats) {
      emit('session_stats_captured', {
        session_stats: stats,
        ...(piVersion ? { pi_version: piVersion } : {}),
      });
      return;
    }
    emit('session_stats_failed', {
      error: error ?? 'session stats unavailable',
      timeout_ms: timeoutMs,
      ...(piVersion ? { pi_version: piVersion } : {}),
    });
  }

  /**
   * Record the start of one tool call for the tool_duration checker (SPECIALISTS-102).
   *
   * A repeat start for the SAME in-flight call (streaming duplicate) keeps its original
   * start time and warned flag; a genuinely new call replaces the dead one. The poll
   * timer is per activation and is created lazily, so tool-less activations never tick.
   */
  private noteToolStart(snapshot: ActivationSnapshot, event: PiAgentSessionEvent): void {
    // A tool executes only inside a live turn. Stray starts arriving after settle
    // (replay skew, late delivery) must not arm a watch nobody will end.
    if (snapshot.state !== 'starting' && snapshot.state !== 'running') return;
    const tool = typeof event.toolName === 'string' && event.toolName.length > 0 ? event.toolName : 'unknown';
    const toolCallId = typeof event.toolCallId === 'string' && event.toolCallId.length > 0 ? event.toolCallId : undefined;
    const existing = this.toolDurationWatch.get(snapshot.activationId);
    if (existing && toolCallId !== undefined && existing.toolCallId === toolCallId) return;
    if (existing) clearInterval(existing.timer);
    const timer = setInterval(() => this.checkToolDuration(snapshot.activationId), TOOL_DURATION_CHECK_INTERVAL_MS);
    timer.unref();
    this.toolDurationWatch.set(snapshot.activationId, { tool, toolCallId, startMs: this.now(), warned: false, timer });
  }

  /** Clear the watch when the tool call ends; a stray end never kills a live call. */
  private noteToolEnd(activationId: string, event: PiAgentSessionEvent): void {
    const watch = this.toolDurationWatch.get(activationId);
    if (!watch) return;
    const toolCallId = typeof event.toolCallId === 'string' && event.toolCallId.length > 0 ? event.toolCallId : undefined;
    if (toolCallId !== undefined && watch.toolCallId !== undefined && watch.toolCallId !== toolCallId) return;
    this.stopToolDurationWatch(activationId);
  }

  /**
   * One checker tick: warn at most once per tool call (SPECIALISTS-102) via the
   * warned flag. Driven by the interval in production and directly (with the
   * injected clock) in tests. Cross-leg attempt attribution of the emitted row
   * is owned by SPECIALISTS-113; no claim is made here about which attempt a
   * spanning call would be attributed to.
   */
  private checkToolDuration(activationId: string): void {
    const watch = this.toolDurationWatch.get(activationId);
    if (!watch || watch.warned) return;
    // Per-activation resolution from start(): dep > spec > shared default.
    const thresholdMs = this.toolDurationWarnMsByActivation.get(activationId) ?? this.toolDurationWarnMs;
    const elapsed = this.now() - watch.startMs;
    if (elapsed <= thresholdMs) return;
    watch.warned = true;
    const record = this.registry.get(activationId);
    // No record (stopped/disposed) means nobody can attribute the row: drop it and the watch.
    // Same when the turn is no longer live: settle/failure already ended watching below,
    // so a surviving entry is skew — drop it rather than warning a dead activation.
    if (!record || (record.snapshot.state !== 'starting' && record.snapshot.state !== 'running')) {
      this.stopToolDurationWatch(activationId);
      return;
    }
    try {
      this.forensics.emit({
        activationId,
        attemptId: record.snapshot.attemptId,
        participantId: record.snapshot.participantId,
        specialist: record.snapshot.specialist,
        beadId: record.snapshot.issueRef,
        name: 'stale_warning',
        payload: {
          reason: 'tool_duration',
          silence_ms: elapsed,
          threshold_ms: thresholdMs,
          tool: watch.tool,
        },
      });
    } catch {
      // A timer callback must never throw into the host: forensic evidence
      // never alters activation behaviour (same rule as onSessionEvent).
    }
  }

  /** Clear the poll timer and drop the watch. Idempotent; safe on every exit path. */
  private stopToolDurationWatch(activationId: string): void {
    const watch = this.toolDurationWatch.get(activationId);
    if (!watch) return;
    clearInterval(watch.timer);
    this.toolDurationWatch.delete(activationId);
  }

  private async runToSettled(
    snapshot: ActivationSnapshot,
    session: PiAgentSessionLike,
    initialPrompt: string,
    emit: (name: string, payload?: Record<string, unknown>) => void,
    record: ActivationRecord,
  ): Promise<ActivationResult> {
    // SPECIALISTS-120 criterion 3 / F2: the settlement capture also runs on the FAILURE path.
    // A prompt rejection or a mid-run throw used to settle with no snapshot AND no
    // `session_stats_failed`, which is indistinguishable from a run Pi never measured. The
    // absence has to be explicit. `captureSessionStats` never throws and is bounded, so this
    // cannot block completion, and the flag keeps it to one outcome per attempt.
    let settlementRecorded = false;
    const recordSettlementOnce = async (): Promise<void> => {
      if (settlementRecorded) return;
      settlementRecorded = true;
      await this.captureSessionStats(session, emit);
    };
    try {
      await session.prompt(initialPrompt);
      await session.waitForIdle();

      // SPECIALISTS-120 criterion 3: Pi's session totals are captured at settlement, before
      // any terminal activation event, so run_complete can carry the snapshot and its
      // reconciliation. Bounded and failure-tolerant by construction — see the helper.
      await recordSettlementOnce();

      // A settled session is NOT a successful one. pi records a failed turn as an
      // assistant message with stopReason 'error' (or 'aborted') and an errorMessage —
      // provider 429s, auth failures and aborts all land here — while `waitForIdle`
      // returns normally. Reporting that as `completed` with empty output is exactly the
      // silent-success failure the result contract exists to prevent.
      const last = lastAssistantMessage(session.messages);
      if (last && (last.stopReason === 'error' || last.stopReason === 'aborted')) {
        const detail = last.errorMessage ?? `turn ended with stopReason "${last.stopReason}"`;
        snapshot.state = 'failed';
        this.save(snapshot);
        emit('activation_failed', { error: detail, stop_reason: last.stopReason });
        const failedResult: ActivationResult = {
          activationId: snapshot.activationId,
          participantId: snapshot.participantId,
          attemptId: snapshot.attemptId,
          issueId: snapshot.issueId,
          issueRef: snapshot.issueRef,
          issueRevision: snapshot.issueRevision,
          contractHash: snapshot.contractHash,
          executionBindingId: snapshot.executionBindingId,
          status: 'failed',
          output: undefined,
          validation: { valid: false, errors: [detail] },
          piSessionId: session.sessionId,
          configuredModel: snapshot.configuredModel,
      requestedModel: snapshot.requestedModel,
          resolvedModel: snapshot.resolvedModel,
          modelOverride: snapshot.modelOverride,
          ...(snapshot.thinkingLevel ? { thinkingLevel: snapshot.thinkingLevel } : {}),
          thinkingOverride: snapshot.thinkingOverride,
          fallbackUsed: false,
          completedAt: this.now(),
        };
        this.publishTerminalSettlement(snapshot, failedResult, record, emit);
        return failedResult;
      }

      const output = textOf(last);

      // The turn reached idle without an error/aborted stopReason — the one terminal
      // event this disposal reports (unitAI-8s7xx). Fired here, after stopReason
      // inspection, instead of unconditionally on every settle in `onSessionEvent`.
      emit('activation_settled');

      emit('output_validation_started');
      // Phase 1 carries no output schema; schema/expected-key enforcement arrives with the
      // result-contract work (unitAI-v2om5 NON_GOALS). One check is always available
      // regardless: a specialist that produced no output has not delivered, whitespace
      // included — so empty/whitespace-only output fails validation on an otherwise
      // settled (not failed) activation.
      const validation = output.trim().length > 0
        ? { valid: true as const }
        : { valid: false as const, errors: ['empty output: specialist produced no output'] };
      if (validation.valid) {
        emit('output_validation_passed');
      } else {
        emit('output_validation_failed', { errors: validation.errors });
      }

      snapshot.state = 'settled';
      this.save(snapshot);
      emit('activation_completed', { pi_session_id: session.sessionId, output });
      this.releaseIfWriter(snapshot, 'completed');

      const completedResult: ActivationResult = {
        activationId: snapshot.activationId,
        participantId: snapshot.participantId,
        attemptId: snapshot.attemptId,
        issueId: snapshot.issueId,
        issueRef: snapshot.issueRef,
        issueRevision: snapshot.issueRevision,
        contractHash: snapshot.contractHash,
        executionBindingId: snapshot.executionBindingId,
        status: 'completed',
        output,
        validation,
        piSessionId: session.sessionId,
        configuredModel: snapshot.configuredModel,
      requestedModel: snapshot.requestedModel,
        resolvedModel: snapshot.resolvedModel,
        modelOverride: snapshot.modelOverride,
        ...(snapshot.thinkingLevel ? { thinkingLevel: snapshot.thinkingLevel } : {}),
        thinkingOverride: snapshot.thinkingOverride,
        fallbackUsed: false,
        completedAt: this.now(),
      };
      this.publishTerminalSettlement(snapshot, completedResult, record, emit);
      return completedResult;
    } catch (error) {
      snapshot.state = 'failed';
      this.save(snapshot);
      const message = error instanceof Error ? error.message : String(error);
      // The run failed by THROWING, not by settling: without this the terminal event would be
      // the only record, and a reader could not tell "Pi never reported totals" from "the
      // capture was never attempted" (SPECIALISTS-120 F2). Bounded, never throws.
      await recordSettlementOnce();
      emit('activation_failed', { error: message });
      // SPECIALISTS-51: a rejected prompt is not always a settled one. pi emits agent_settled from a
      // finally around its agent loop, so a turn that fails by THROWING still settles and the settle
      // handler releases — but the paths outside that finally (the prompt() preflight and its
      // activeRun guard) reject without ever emitting it. On those the activation went terminal
      // holding the lease, held by this long-lived process, and every later writer was refused.
      // Idempotent by construction: release() returns early for a free workspace, and
      // releaseIfWriter turns an uncertain or not-held release into evidence rather than stealing.
      // One seam for all four acquire sites, since each of them ends here.
      this.releaseIfWriter(snapshot, 'failed');

      const thrownResult: ActivationResult = {
        activationId: snapshot.activationId,
        participantId: snapshot.participantId,
        attemptId: snapshot.attemptId,
        issueId: snapshot.issueId,
        issueRef: snapshot.issueRef,
        issueRevision: snapshot.issueRevision,
        contractHash: snapshot.contractHash,
        executionBindingId: snapshot.executionBindingId,
        status: 'failed',
        output: undefined,
        validation: { valid: false, errors: [message] },
        piSessionId: session.sessionId,
        configuredModel: snapshot.configuredModel,
      requestedModel: snapshot.requestedModel,
        resolvedModel: snapshot.resolvedModel,
        modelOverride: snapshot.modelOverride,
        ...(snapshot.thinkingLevel ? { thinkingLevel: snapshot.thinkingLevel } : {}),
        thinkingOverride: snapshot.thinkingOverride,
        fallbackUsed: false,
        completedAt: this.now(),
      };
      this.publishTerminalSettlement(snapshot, thrownResult, record, emit);
      return thrownResult;
    }
    // Deliberately no dispose(): a settled Specialist remains alive and resumable.
  }

  /**
   * S1 automatic settlement publication (ADR §38).
   *
   * Host-driven: called on every terminal settlement with the live snapshot,
   * so the Specialist is involved in no step. Intermediate fallback attempts
   * settle `failed` and store only; the walk's winner publishes. Retry/resume
   * legs publish under their own attempt id through the same call, because
   * they funnel through runToSettled after advancing the snapshot.
   *
   * Best-effort twice over: publishSettlement degrades internally, and this
   * guards the call, because settlement evidence must never alter the result
   * the activation reports.
   */
  private publishTerminalSettlement(
    snapshot: ActivationSnapshot,
    result: ActivationResult,
    record: ActivationRecord,
    emit: (name: string, payload?: Record<string, unknown>) => void,
  ): void {
    try {
      const subject: SettlementSubject = {
        activationId: snapshot.activationId,
        participantId: snapshot.participantId,
        attemptId: snapshot.attemptId,
        specialist: snapshot.specialist,
        issueRef: snapshot.issueRef,
        issueRevision: snapshot.issueRevision,
        contractHash: snapshot.contractHash,
        executionBindingId: snapshot.executionBindingId,
        ...(snapshot.piSessionId ? { piSessionId: snapshot.piSessionId } : {}),
        repositoryRoot: snapshot.workspace.repositoryRoot,
        worktreePath: snapshot.workspace.worktreePath,
        ...(snapshot.workspace.branch ? { branch: snapshot.workspace.branch } : {}),
        ...(record.bindingBaseCommit ? { bindingBaseCommit: record.bindingBaseCommit } : {}),
      };
      publishSettlement({
        boundary: record.workItems,
        store: this.settlements,
        subject,
        status: result.status === 'completed' ? 'completed' : 'failed',
        output: result.output,
        validation: result.validation,
        coordinator: {
          ...(record.lineage.coordinatorParticipantId
            ? { participantId: record.lineage.coordinatorParticipantId }
            : {}),
          ...(record.lineage.coordinatorSessionId ? { sessionId: record.lineage.coordinatorSessionId } : {}),
        },
        env: this.env,
        now: this.now(),
        emit,
      });
    } catch {
      // Settlement evidence never fails an activation.
    }
    // Terminal settle ends duration watching for this activation (SPECIALISTS-102):
    // the single call site all three runToSettled terminal legs funnel through.
    // Intermediate fallback failures also land here; the walk restarts the watch
    // lazily on the next tool start, which is a NEW call and warns at most once.
    this.stopToolDurationWatch(snapshot.activationId);
  }

  /**
   * Run the turn-1 attempt, walking the model chain on retryable provider failures.
   *
   * The first attempt runs on the dispatch-time session; a failure whose class is
   * retryable (rate_limit/timeout/transient per the classifier shared with the CLI
   * runner) disposes that session and continues on the next chain model under the SAME
   * activation and attempt id. Auth, unknown and abort-class failures settle failed
   * immediately — retrying those on another model is either wrong (auth) or blind
   * (unknown), exactly the CLI rule. The winner lands on the snapshot (`resolvedModel`,
   * `piSessionId`) and on the result (`resolvedModel`, `fallbackUsed`), so attribution
   * answers what actually ran.
   *
   * Runs inside the dispatch result promise: dispatch already returned, so the walk never
   * blocks admission. A record removed mid-walk (stop) ends the walk — a disposed
   * activation must never resurrect.
   */
  private async runWithFallback(
    record: ActivationRecord,
    ctx: {
      modelChain: string[];
      modelIndex: number;
      sdk: PiSdk;
      modelRuntime: PiModelRuntimeLike;
      initialPrompt: string;
      emit: (name: string, payload?: Record<string, unknown>) => void;
    },
  ): Promise<ActivationResult> {
    let index = ctx.modelIndex;
    // A dispatch-time skip (unavailable primary) already advanced past the chain head.
    let fallbackUsed = index > 0;
    let result = await this.runToSettled(record.snapshot, record.session, ctx.initialPrompt, ctx.emit, record);

    while (result.status === 'failed' && index < ctx.modelChain.length - 1) {
      if (this.registry.get(record.snapshot.activationId) !== record) break;
      const detail = result.validation.errors?.[0] ?? 'unknown failure';
      const errorClass = classifyFallbackError(detail);
      if (!FALLBACK_RETRYABLE_CLASSES.has(errorClass)) break;
      const nextModel = ctx.modelChain[index + 1];
      const fromModel = record.snapshot.resolvedModel;
      // Validate BEFORE disposing: a fallback that cannot be honoured keeps the failed
      // session and its context rather than trading them for nothing.
      const check = await validateModelAvailable(ctx.sdk, ctx.modelRuntime, nextModel);
      if (!check.ok || !check.model) {
        ctx.emit('model_fallback', {
          from_model: fromModel,
          to_model: nextModel,
          error_class: errorClass,
          terminal: true,
          note: `fallback unavailable: ${check.reason ?? 'unresolvable'}`,
          resolved_model: fromModel,
        });
        break;
      }
      ctx.emit('model_fallback', {
        from_model: fromModel,
        to_model: nextModel,
        error_class: errorClass,
        terminal: false,
        attempt_n: index + 2,
        resolved_model: check.resolvedModel ?? nextModel,
      });
      // SPECIALISTS-46: re-acquire before creating the next session, exactly as retry() does.
      // Settling releases the lease unconditionally (onSessionEvent, agent_settled), and a
      // retryable failure is normally a settled turn with a bad stopReason — so without this the
      // fallback attempt ran holding nothing, and every mutating call it made was refused by
      // admitToolCall. The result was a full model turn spent on writes that could not happen,
      // reported as the model's outcome rather than as "fallback could not proceed".
      // The SAME attempt id: a fallback is a new model under one attempt, not a new attempt.
      if (record.snapshot.access === 'write') {
        try {
          acquireLease({
            workspace: record.snapshot.workspace,
            activationId: record.snapshot.activationId,
            attemptId: record.snapshot.attemptId,
            specialist: record.snapshot.specialist,
          });
        } catch (error) {
          // Contention ends the walk with a reason that names the lease. A silent
          // model_fallback here would leave the operator reading a model failure for what is
          // actually a workspace that could not be taken.
          if (error instanceof DispatchRejectedError) {
            this.forensics.emit({
              activationId: record.snapshot.activationId,
              attemptId: record.snapshot.attemptId,
              participantId: record.snapshot.participantId,
              specialist: record.snapshot.specialist,
              beadId: record.snapshot.issueRef,
              name: 'lease_denied',
              payload: { reason: error.reason, note: error.detail.holder, on: 'fallback' },
            });
          }
          ctx.emit('model_fallback', {
            from_model: fromModel,
            to_model: nextModel,
            error_class: errorClass,
            terminal: true,
            note:
              'fallback could not acquire the workspace lease: ' +
              (error instanceof Error ? error.message : String(error)),
            resolved_model: fromModel,
          });
          break;
        }
      }

      let nextSession: PiAgentSessionLike;
      try {
        nextSession = await record.createSession(check.model);
      } catch (error) {
        // The lease was taken above and no session will run under it, so it must go back or it
        // is held by this long-lived process for the rest of its life (SPECIALISTS-46 review).
        // Nothing else releases on this path: the settle release needs a session to settle, and
        // releaseIfWriter on completion sits inside runToSettled's success branch, which never
        // runs. This is the likely branch too - a fallback walk runs precisely because a
        // provider is misbehaving, so a failed session creation is expected rather than exotic.
        // Same shape as retry() after the #354 review.
        this.releaseIfWriter(record.snapshot, 'fallback_session_unavailable');
        ctx.emit('model_fallback', {
          from_model: fromModel,
          to_model: nextModel,
          error_class: errorClass,
          terminal: true,
          note: error instanceof Error ? error.message : String(error),
          resolved_model: fromModel,
        });
        break;
      }
      try { record.session.dispose(); } catch { /* best effort; the lease is untouched */ }
      record.unsubscribe();
      record.session = nextSession;
      record.snapshot.resolvedModel = check.resolvedModel ?? nextModel;
      record.snapshot.piSessionId = nextSession.sessionId;
      record.snapshot.state = 'starting';
      record.snapshot.lastActivityAt = this.now();
      this.save(record.snapshot);
      record.unsubscribe = nextSession.subscribe((event) => this.onSessionEvent(record.snapshot, event, ctx.emit));
      ctx.emit('activation_started', { pi_session_id: nextSession.sessionId });
      index += 1;
      fallbackUsed = true;
      result = await this.runToSettled(record.snapshot, record.session, ctx.initialPrompt, ctx.emit, record);
    }

    result.fallbackUsed = fallbackUsed;
    return result;
  }

  /**
   * Re-run a FAILED activation in place — the native equivalent of `sp retry`.
   *
   * Keeps `activationId` and advances `attemptId`: a retry is a new attempt under one
   * activation, never a second dispatch, so lineage and the workspace lease survive it.
   * Without a model override the SAME session is re-prompted, so its context survives
   * too; with one a new session is built identically except for the model, and the
   * failed session is disposed. The turn prompt defaults to the dispatch-time render of
   * the same bead — pass `prompt` to say something new, or dispatch fresh when the bead
   * itself was rewritten.
   *
   * Gating mirrors the CLI retry: failed only. A waiting/settled/needs_reply/escalated
   * activation resumes (its session is alive); a running one steers or stops first.
   * A refused model override leaves the activation failed-and-retryable, never
   * half-advanced. Writers reacquire their own lease for the new attempt — the workspace
   * is held across the retry, never dropped, so no orphan is possible.
   */
  async retry(activationId: string, opts?: { modelOverride?: string; prompt?: string }): Promise<ActivationHandle> {
    const record = this.registry.get(activationId);
    if (!record) {
      throw new DispatchRejectedError('unknown_activation', { activationId });
    }
    if (!RETRYABLE_STATES.has(record.snapshot.state)) {
      const state = record.snapshot.state;
      const hint = state === 'waiting' || state === 'settled' || state === 'needs_reply' || state === 'escalated'
        ? `Activation ${activationId} is ${state} — use resume, which keeps the live session.`
        : `Activation ${activationId} is ${state} — steer it or stop it first.`;
      throw new DispatchRejectedError('not_resumable', {
        activationId,
        note: `state is "${state}". retry only re-runs failed activations. ${hint}`,
      });
    }

    // Validate an override BEFORE touching lease or snapshot: a refused model leaves the
    // activation failed-and-retryable rather than half-advanced.
    const overrideName = opts?.modelOverride;
    let overrideModel: { id?: string; provider?: string } | undefined;
    let overrideResolved: string | undefined;
    if (overrideName) {
      const sdk = await this.loadSdk();
      const check = await validateModelAvailable(sdk, await createGateModelRuntime(sdk), overrideName);
      if (!check.ok || !check.model) {
        throw new DispatchRejectedError('model_unavailable', {
          activationId,
          requestedModel: overrideName,
          note: check.reason,
        });
      }
      overrideModel = check.model;
      overrideResolved = check.resolvedModel ?? overrideName;
    }

    const attemptId = nextAttemptId(record.snapshot.attemptId);
    if (record.snapshot.access === 'write') {
      try {
        acquireLease({
          workspace: record.snapshot.workspace,
          activationId, attemptId, specialist: record.snapshot.specialist,
        });
      } catch (error) {
        if (error instanceof DispatchRejectedError) {
          this.forensics.emit({
            activationId, attemptId, participantId: record.snapshot.participantId,
            specialist: record.snapshot.specialist, beadId: record.snapshot.issueRef,
            name: 'lease_denied',
            payload: { reason: error.reason, note: error.detail.holder, on: 'retry' },
          });
        }
        throw error;
      }
    }
    record.snapshot.attemptId = attemptId;
    record.snapshot.state = 'starting';
    record.snapshot.lastActivityAt = this.now();
    this.save(record.snapshot);

    const emit = (name: string, payload?: Record<string, unknown>) =>
      this.forensics.emit({
        activationId, attemptId, participantId: record.snapshot.participantId,
        specialist: record.snapshot.specialist, beadId: record.snapshot.issueRef, name, payload,
      });

    let reusedSession = true;
    if (overrideModel && overrideResolved && overrideName) {
      // A new model needs a new session — the model is fixed at creation. The failed
      // session is disposed; same-session context survives only on the no-override path.
      let nextSession: PiAgentSessionLike;
      try {
        nextSession = await record.createSession(overrideModel);
      } catch (error) {
        // A refused session left the activation half-advanced otherwise: `state` was set to
        // 'starting' and saved just above, and nothing after this line runs. Terminal it
        // explicitly and release through the snapshot lifecycle, which owns the lease after
        // admission. The failed session stays the live record.session and is deliberately NOT
        // disposed: it is what a later retry without an override re-prompts, and trading its
        // context for nothing is the mistake the fallback walk refuses to make.
        record.snapshot.state = 'failed';
        record.snapshot.lastActivityAt = this.now();
        this.save(record.snapshot);
        this.releaseIfWriter(record.snapshot, 'tool_contract_unsatisfied_on_retry');
        throw error;
      }
      try { record.session.dispose(); } catch { /* best effort */ }
      record.unsubscribe();
      record.session = nextSession;
      record.snapshot.requestedModel = overrideName;
      record.snapshot.resolvedModel = overrideResolved;
      record.snapshot.modelOverride = true;
      record.snapshot.piSessionId = nextSession.sessionId;
      reusedSession = false;
    } else {
      record.unsubscribe();
    }
    // Re-subscribe under the new attempt id: the old listener would emit forensics
    // against the closed attempt (the resume() shape).
    record.unsubscribe = record.session.subscribe((event) => this.onSessionEvent(record.snapshot, event, emit));

    emit('activation_retried', {
      requested_model: record.snapshot.requestedModel ?? null,
      resolved_model: record.snapshot.resolvedModel,
      model_override: record.snapshot.modelOverride,
      reused_session: reusedSession,
    });

    const result = this.runToSettled(record.snapshot, record.session, opts?.prompt ?? record.initialPrompt, emit, record);
    record.result = result;

    return {
      activationId, participantId: record.snapshot.participantId, attemptId,
      specialist: record.snapshot.specialist,
      issueId: record.snapshot.issueId,
      issueRef: record.snapshot.issueRef,
      access: record.snapshot.access, workspace: record.snapshot.workspace,
      resolvedModel: record.snapshot.resolvedModel,
      stepContract: record.stepContract,
      result,
    };
  }

  /**
   * Answer an outstanding ask, resuming the child inside its existing tool call.
   *
   * The answer returns as that tool's result, so the SAME AgentSession continues with its
   * context intact. Correlation is by `messageId`; there is deliberately no "answer the
   * latest ask" convenience, because with two asks outstanding that is a coin flip.
   */
  async answer(messageId: string, body: string): Promise<InteractionMessage | undefined> {
    const ask = this.interactions.pendingAsks().find(a => a.message.messageId === messageId);
    if (!ask) return undefined;

    return this.interactions.send({
      kind: 'reply',
      from: ask.message.to,
      to: ask.message.from,
      activationId: ask.message.activationId,
      attemptId: ask.message.attemptId,
      body,
      inReplyTo: messageId,
    });
  }

  /**
   * Mirror one snapshot to the Substrate authority. Best-effort twice over: the
   * writer swallows its own errors, and this guards the call, because a store
   * failure must never alter activation behaviour.
   */
  private save(snapshot: ActivationSnapshot): void {
    try {
      this.authority.record(snapshot);
    } catch {
      // Authority writes never fail an activation.
    }
  }

  /**
   * Mirror disposal to the authority: the row goes with the activation, so
   * SessionStart never surfaces stopped work as live. Guarded like `save`.
   */
  private forget(activationId: string): void {
    try {
      this.authority.remove(activationId);
    } catch {
      // Authority writes never fail an activation.
    }
  }

  /**
   * Release a writer's lease, converting an uncertain release into evidence.
   *
   * `release` THROWS when the holder's liveness cannot be established, and that throw is
   * the point: it refuses to guess whether the previous writer finished. Swallowing it
   * would silently free a workspace that may still be under mutation, which is the exact
   * inference the uncertain state exists to prevent. So the throw becomes a
   * `lease_uncertain` event and the workspace stays uncertain until an operator reconciles
   * it through `specialist_status` — the shape argued by the unitAI-rrdnt.31 lane.
   *
   * Teardown is never failed by this. A stop that could not release is still a stop.
   */
  private releaseIfWriter(snapshot: ActivationSnapshot, reason: string): void {
    if (snapshot.access !== 'write') return;
    try {
      releaseLease(snapshot.workspace, snapshot.activationId);
      this.forensics.emit({
        activationId: snapshot.activationId,
        attemptId: snapshot.attemptId,
        participantId: snapshot.participantId,
        specialist: snapshot.specialist,
        beadId: snapshot.issueRef,
        name: 'lease_released',
        payload: { workspace: snapshot.workspace.worktreePath, reason },
      });
    } catch (error) {
      this.forensics.emit({
        activationId: snapshot.activationId,
        attemptId: snapshot.attemptId,
        participantId: snapshot.participantId,
        specialist: snapshot.specialist,
        beadId: snapshot.issueRef,
        name: 'lease_uncertain',
        payload: {
          workspace: snapshot.workspace.worktreePath,
          note: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Decide whether one planned tool call may run — PRD §52, the per-call block.
   *
   * This must be a per-call verdict and NOT `setActiveToolsByName`. Within a turn the agent
   * loop runs against a tool snapshot taken at turn start, so revoking a tool cannot cancel
   * a call that is already planned; every handler in a batch fires before any execution, so
   * a block is enforceable exactly where a tool-set change is not (unitAI-rrdnt.7).
   *
   * A read-only activation is refused every mutating call. That is not an error — it holds
   * no lease because it is not entitled to one, and this is the only choke point where the
   * capability grant can actually be enforced.
   *
   * KNOWN HOLE, unclosed and not closable on pi 0.85.1: this guards the LLM tool path only.
   * `AgentSession.executeBash()` and `pi.exec()` fire the extension `tool_call` handler
   * ZERO times, re-verified on 0.85.1 (unitAI-rrdnt.6). An extension that mutates the
   * workspace through those bypasses this gate entirely. Do not document the lease as
   * protecting a worktree against arbitrary extension effects; it does not.
   */
  admitToolCall(activationId: string, toolName: string): { allow: boolean; reason?: string } {
    const record = this.registry.get(activationId);
    if (!record) return { allow: false, reason: `unknown activation ${activationId}` };

    const verdict = admitToolCall({
      toolName,
      workspace: record.snapshot.workspace,
      activationId,
    });

    if (!verdict.allow) {
      this.forensics.emit({
        activationId,
        attemptId: record.snapshot.attemptId,
        participantId: record.snapshot.participantId,
        specialist: record.snapshot.specialist,
        beadId: record.snapshot.issueRef,
        name: 'tool_blocked',
        payload: { tool: toolName, note: verdict.reason },
      });
    }
    return verdict;
  }

  /** Every outstanding ask across the Fleet, oldest first. */
  pendingAsks(): PendingAsk[] {
    return this.interactions.pendingAsks();
  }

  /** Current state of one activation, or undefined if unknown to this host. */
  inspect(activationId: string): ActivationSnapshot | undefined {
    return this.registry.projection(activationId);
  }

  /**
   * Live per-activation stats over existing in-memory state: one Map read plus
   * arithmetic, never an observability.db query, so the 1s widget tick stays cheap.
   */
  liveStats(activationId: string): LiveActivationStats | undefined {
    const snapshot = this.registry.projection(activationId);
    if (!snapshot) return undefined;
    return {
      activationId: snapshot.activationId,
      elapsed_s: Math.max(0, Math.floor((this.now() - snapshot.startedAt) / 1000)),
      last_activity_at: snapshot.lastActivityAt,
      ...(snapshot.thinkingLevel ? { thinking_level: snapshot.thinkingLevel } : {}),
      ...(snapshot.turnCount !== undefined ? { turn_count: snapshot.turnCount } : {}),
      ...(snapshot.tokenUsage ? { token_usage: { ...snapshot.tokenUsage } } : {}),
    };
  }

  /**
   * Build the delivery hook for a configured coordinator.
   *
   * Called from the constructor, so it must not read any field the constructor has not yet
   * assigned — `repoRoot` is taken from the config or from `deps.cwd` directly rather than
   * from `this.cwd`, which is set on the line above but would be a trap to depend on if the
   * order ever changed.
   */
  private wirePeerDelivery(peer: PeerDelivery) {
    const repoRoot = peer.repoRoot ?? this.cwd;
    return createPeerDelivery({
      transport: () => this.interactions,
      adapter: peer.adapter ?? new PeerAdapter({
        repoRoot,
        emit: event => this.forensics.peerTransportEvent?.(event),
      }),
      repoRoot,
      coordinatorSessionId: peer.coordinatorSessionId,
      ...(peer.replyTimeoutMs !== undefined ? { replyTimeoutMs: peer.replyTimeoutMs } : {}),
      ...(peer.pollIntervalMs !== undefined ? { pollIntervalMs: peer.pollIntervalMs } : {}),
    });
  }

  /** The Fleet projection: every activation this process knows about, transport-neutral. */
  list(): ActivationSnapshot[] {
    return this.registry.list();
  }

  /**
   * Explicitly stop and dispose an activation.
   *
   * This is the only ordinary path to disposal — settling is not one.
   */
  async stop(activationId: string, reason = 'operator request'): Promise<void> {
    const record = this.registry.get(activationId);
    if (!record) return;

    record.snapshot.state = 'stopping';
    try {
      await record.session.abort();
    } finally {
      // Explicit disposal ends duration watching: no timer survives activation end.
      // The per-activation threshold dies with the registry entry (same lifetime).
      this.stopToolDurationWatch(activationId);
      this.toolDurationWarnMsByActivation.delete(activationId);
      record.unsubscribe();
      record.session.dispose();
      record.snapshot.state = 'stopped';
      this.forget(record.snapshot.activationId);
      this.releaseIfWriter(record.snapshot, reason);
      this.forensics.emit({
        activationId,
        attemptId: record.snapshot.attemptId,
        participantId: record.snapshot.participantId,
        specialist: record.snapshot.specialist,
        beadId: record.snapshot.issueRef,
        name: 'activation_disposed',
        payload: { reason },
      });
      this.registry.remove(activationId);
    }
  }

  /**
   * Attach a listener to a live activation's event stream without perturbing its turn.
   *
   * Subscribing is additive — `PiAgentSessionLike.subscribe` fans out to every listener —
   * so an attached observer (a Fleet view, a follow MCP call) never displaces the host's
   * own lifecycle subscription or any other attachment on the same activation.
   */
  attach(
    activationId: string,
    listener: (event: PiAgentSessionEvent) => void,
  ): ActivationAttachment | undefined {
    const record = this.registry.get(activationId);
    if (!record) return undefined;
    return { snapshot: record.snapshot, detach: record.session.subscribe(listener) };
  }

  /** Release an attachment. Symmetric with `attach`; the activation itself is unaffected. */
  return(attachment: ActivationAttachment): void {
    attachment.detach();
  }

  /**
   * Resume a settled or waiting activation with a new prompt.
   *
   * Keeps `activationId` and advances `attemptId` — a resume is never a second activation.
   * The host's own lifecycle listener is re-subscribed so forensics for the new attempt
   * carry the new `attemptId` rather than the one closed over at `start()`.
   */
  async resume(activationId: string, prompt: string): Promise<ActivationHandle> {
    const record = this.registry.get(activationId);
    if (!record) {
      throw new DispatchRejectedError('unknown_activation', { activationId });
    }
    if (!RESUMABLE_STATES.has(record.snapshot.state)) {
      throw new DispatchRejectedError('not_resumable', {
        activationId,
        note: `state is "${record.snapshot.state}"`,
      });
    }

    const attemptId = nextAttemptId(record.snapshot.attemptId);
    if (record.snapshot.access === 'write') {
      try {
        acquireLease({
          workspace: record.snapshot.workspace,
          activationId, attemptId, specialist: record.snapshot.specialist,
        });
      } catch (error) {
        if (error instanceof DispatchRejectedError) {
          this.forensics.emit({
            activationId, attemptId, participantId: record.snapshot.participantId,
            specialist: record.snapshot.specialist, beadId: record.snapshot.issueRef,
            name: 'lease_denied',
            payload: { reason: error.reason, note: error.detail.holder, on: 'resume' },
          });
        }
        throw error;
      }
    }
    record.snapshot.attemptId = attemptId;
    record.snapshot.state = 'starting';
    this.save(record.snapshot);

    const emit = (name: string, payload?: Record<string, unknown>) =>
      this.forensics.emit({
        activationId, attemptId, participantId: record.snapshot.participantId,
        specialist: record.snapshot.specialist, beadId: record.snapshot.issueRef, name, payload,
      });
    // A resumed attempt carried no payload, so an override could not be shown to survive a
    // resume from observability.db — only from memory, which is not evidence.
    emit('activation_resumed', {
      requested_model: record.snapshot.requestedModel,
      resolved_model: record.snapshot.resolvedModel,
      model_override: record.snapshot.modelOverride,
      thinking_level: record.snapshot.thinkingLevel ?? null,
      thinking_override: record.snapshot.thinkingOverride,
    });

    record.unsubscribe();
    record.unsubscribe = record.session.subscribe((event) => this.onSessionEvent(record.snapshot, event, emit));

    const result = this.runToSettled(record.snapshot, record.session, prompt, emit, record);
    record.result = result;

    return {
      activationId, participantId: record.snapshot.participantId, attemptId,
      specialist: record.snapshot.specialist,
      issueId: record.snapshot.issueId,
      issueRef: record.snapshot.issueRef,
      access: record.snapshot.access, workspace: record.snapshot.workspace,
      resolvedModel: record.snapshot.resolvedModel,
      stepContract: record.stepContract,
      result,
    };
  }
}

/**
 * Project a resolved issue view onto the record shape the shared prompt
 * renderer consumes. The renderer's parameter type predates the substrate
 * boundary and is shared with the legacy CLI surface; the projection keeps
 * this host decoupled from it without forking the renderer (PR2 migrates the
 * renderer vocabulary itself).
 */
function workItemAsRecord(view: WorkItemView): { id: string; title: string; description?: string } {
  return { id: view.ref, title: view.title, description: contractToMarkdown(view.contract) };
}

function workAncestorAsRecord(ancestor: EpicAncestor): { id: string; title: string; description?: string } {
  return { id: ancestor.ref, title: ancestor.title, ...(ancestor.description ? { description: ancestor.description } : {}) };
}

/** Capture the same one-line purpose projection as the legacy path, without markdown bullets. */
function purposeExcerptFromContract(contract: unknown): string {
  if (contract !== null && typeof contract === 'object') {
    const c = contract as Record<string, unknown>;
    const scope = Array.isArray(c['scope']) ? c['scope'].filter((item): item is string => typeof item === 'string') : [];
    const success = typeof c['success'] === 'string' ? c['success'] : '';
    const first = scope[0] ?? success;
    if (first) {
      const flat = first.trim().replace(/\s+/g, ' ');
      return flat.length <= 160 ? flat : `${flat.slice(0, 159)}…`;
    }
  }
  return extractPurposeExcerpt(contractToMarkdown(contract)) ?? '';
}

/** Render a structured work contract back to the 7-section layout the prompt surface reads. */
export function contractToMarkdown(contract: unknown): string {
  if (contract === null || typeof contract !== 'object') return '';
  const c = contract as Record<string, unknown>;
  const lines: string[] = [];
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x !== null ? Object.values(x as Record<string, unknown>).filter((y) => typeof y === 'string').join(': ') : String(x))) : []);
  const problem = text(c['problem']);
  if (problem) lines.push(`PROBLEM: ${problem}`);
  const success = text(c['success']);
  if (success) lines.push(`SUCCESS: ${success}`);
  const sections: Array<[string, unknown]> = [
    ['SCOPE', c['scope']],
    ['NON_GOALS', c['nonGoals']],
    ['CONSTRAINTS', c['constraints']],
    ['VALIDATION', c['validation']],
    ['OUTPUT', c['output']],
  ];
  for (const [name, value] of sections) {
    const items = list(value);
    if (items.length === 0) continue;
    lines.push(`${name}:`);
    for (const item of items) lines.push(`- ${item}`);
  }
  return lines.join('\n');
}

/** Structural view of a pi assistant message. */
interface AssistantMessageLike {
  role?: string;
  content?: unknown;
  stopReason?: string;
  errorMessage?: string;
}

/** The last assistant message in a Pi message list, or undefined. */
function lastAssistantMessage(messages: unknown[]): AssistantMessageLike | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as AssistantMessageLike | undefined;
    if (message?.role === 'assistant') return message;
  }
  return undefined;
}

/** Concatenated text content of an assistant message, defensively. */
function textOf(message: AssistantMessageLike | undefined): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type: string; text: string } =>
      typeof part === 'object' && part !== null &&
      (part as { type?: string }).type === 'text' &&
      typeof (part as { text?: string }).text === 'string')
    .map(part => part.text)
    .join('');
}

/**
 * SPECIALISTS-52: `beads_integration` and `beads_write_notes` are read only by the legacy sp
 * CLI. At their defaults they are noise on every spec; a non-default value is a user's intent
 * that this runtime cannot honour, so it is named rather than dropped.
 */
export function legacyOnlyConfigNotes(spec: { beads_integration?: string; beads_write_notes?: boolean }): string[] {
  const notes: string[] = [];
  if (spec.beads_write_notes === false) {
    notes.push('beads_write_notes=false applies to the legacy sp CLI only; native activations ignore it and publish their result to the Substrate Journal');
  }
  if (spec.beads_integration !== undefined && spec.beads_integration !== 'auto') {
    notes.push(`beads_integration=${spec.beads_integration} applies to the legacy sp CLI only; native activations ignore it`);
  }
  return notes;
}
