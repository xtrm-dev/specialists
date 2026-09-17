// src/pi/session.ts
export class SessionKilledError extends Error {
  constructor() {
    super('Session was killed');
    this.name = 'SessionKilledError';
  }
}

export class StallTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Session stalled: no activity for ${timeoutMs}ms`);
    this.name = 'StallTimeoutError';
  }
}

//
// PiAgentSession wraps the `pi` CLI (global binary) in --mode rpc.
// Events are emitted per the pi RPC protocol over stdout (NDJSON).
//
// Pi RPC event layers (per docs/pi-rpc.md):
//
// Top-level events:
//   response              — ack that prompt command was received
//   agent_start           — agent begins processing
//   turn_start/end        — conversation turn boundaries
//   message_start/end     — message boundaries
//   message_update        — streaming update; carries .assistantMessageEvent
//   tool_execution_start  — tool begins executing (top-level)
//   tool_execution_update — tool execution progress (top-level)
//   tool_execution_end    — tool execution complete (top-level)
//   agent_end             — run complete, contains all generated messages
//
// Nested under message_update.assistantMessageEvent:
//   text_start/delta/end    — text token streaming
//   thinking_start/delta/end — thinking token streaming
//   toolcall_start/delta/end — LLM tool-call construction
//   done                    — message-level completion
//   error                   — message-level error
//
import { createHash } from 'node:crypto';
import { getReadLineNumbersExtensionPath } from './read-line-numbers-extension.js';
import { getExtensionToolPolicyExtensionPath, NATIVE_TOOLS_ENV_KEY, REQUIRED_EXTENSION_TOOLS_ENV_KEY } from './extension-tool-policy-extension.js';
import { resolvePiExtensionsPythonKernelPath } from './python-kernel-extension.js';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, resolve, sep, join, dirname } from 'node:path';
import { mapSpecialistBackend, getProviderArgs } from './backendMap.js';
import { resolveCanonicalAssetDir } from '../specialist/canonical-asset-resolver.js';
import { type ExtensionState, type ManifestPolicy, type ManifestPolicyTier, type ToolCatalog } from '../specialist/manifest-resolver.js';
import { buildResolvedToolContract, type ResolvedToolContract } from '../specialist/resolved-tool-contract.js';
import { loadToolCatalogIndex, type ToolCatalogIndex, resolveCatalogVersionVerdict } from '../specialist/tool-catalog.js';
import {
  accumulateTokenUsage,
  normalizeSessionTokenUsage,
  normalizePiSessionStats,
  reconcileSessionUsage,
  type PiSessionStats,
  type SessionMetricEvent,
  type SessionRunMetrics,
  type SessionTokenUsage,
} from '../specialist/session-metrics-contract.js';

/** Bound on the settlement `get_session_stats` call; see PiSessionOptions.sessionStatsTimeoutMs. */
const SESSION_STATS_TIMEOUT_MS = 5_000;
const TEST_COMMAND_STALL_TIMEOUT_MS = 300_000;
const GITNEXUS_IMPACT_STALL_TIMEOUT_MS = 300_000;
const TEST_COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:^|\s)(?:bun\s+--bun\s+)?vitest(?:\s|$)/i,
  /(?:^|\s)bun\s+test(?:\s|$)/i,
  /(?:^|\s)npm\s+test(?:\s|$)/i,
  /(?:^|\s)(?:pnpm|yarn)\s+test(?:\s|$)/i,
  /(?:^|\s)(?:node\s+)?jest(?:\s|$)/i,
  /(?:^|\s)pytest(?:\s|$)/i,
];

export interface AgentSessionMeta {
  backend: string;
  model: string;
  sessionId: string;
  startedAt: Date;
}

// Session metric shape lives in the neutral contract module; re-exported here
// so existing importers of pi/session.js keep working unchanged.
export type {
  PiSessionStats,
  PiUsageVerbatim,
  SessionMetricEvent,
  SessionRunMetrics,
  SessionTokenUsage,
  SessionUsageCost,
  SessionUsageReconciliation,
} from '../specialist/session-metrics-contract.js';

export interface PiSessionOptions {
  model: string;
  systemPrompt?: string;
  systemPromptMode?: 'append' | 'replace';
  /** Additional extension sources forwarded as repeated `-e <source>` pairs. */
  extensionSources?: readonly string[];
  /** Controls whether Pi starts with `--offline`. Defaults true. */
  offline?: boolean;
  /** Absolute path boundary for write-side tools; undefined disables enforcement */
  worktreeBoundary?: string;
  /** Permission level from specialist YAML — controls which pi tools are enabled */
  permissionLevel?: string;
  /** Specialist name for per-specialist policy overrides. */
  specialistName?: string;
  /** Specialist manifest permissions for resolver overrides. */
  specialistPermissions?: ManifestPolicy['permissions'];
  /** Skill files declared via pi --skill (native flag; force-loaded at turn-1 via /skill:name). */
  skillPaths?: string[];
  /** Thinking level passed as pi --thinking <level> */
  thinkingLevel?: string;
  /** Working directory for the pi process — defaults to process.cwd() if not set */
  cwd?: string;
  /** Extra environment variables injected into the pi process */
  env?: Record<string, string>;
  /** npm extension package names to skip when assembling pi -e args */
  excludeExtensions?: string[];
  /** Shared resolver-backed runtime contract computed before launch. */
  resolvedToolContract?: ResolvedToolContract;
  /** Called with each text token as it arrives */
  onToken?: (delta: string) => void;
  /** Called with each thinking token */
  onThinking?: (delta: string) => void;
  /** Called with tool name, optional args payload, and optional tool call ID when a tool starts executing */
  onToolStart?: (tool: string, args?: Record<string, unknown>, toolCallId?: string) => void;
  /** Called with tool name, error flag, optional tool call ID, summarized result content, and optional raw result payload */
  onToolEnd?: (tool: string, isError: boolean, toolCallId?: string, resultContent?: string, resultRaw?: Record<string, unknown>) => void;
  /** Called with the raw pi event type (for job status tracking) */
  onEvent?: (
    type: string,
    details?: {
      charCount?: number;
      content?: string;
      toolCallId?: string;
      model?: string;
      previousModel?: string;
      action?: 'set_model' | 'cycle_model';
      extension?: string;
      errorMessage?: string;
      tokensBefore?: number;
      summary?: string;
      firstKeptEntryId?: string;
      attempt?: number;
      maxAttempts?: number;
      delayMs?: number;
    },
  ) => void;
  /** Called with additive observability metrics derived from RPC events */
  onMetric?: (event: SessionMetricEvent) => void;
  /** Called once with actual backend/model from the first assistant message_start */
  onMeta?: (meta: { backend: string; model: string; sessionId?: string }) => void;
  /** Kill and fail if no streaming/protocol activity occurs within this window */
  stallTimeoutMs?: number;
  /** Extended stall timeout used while known test commands run via bash tool */
  testCommandStallTimeoutMs?: number;
  /**
   * Bound on the settlement `get_session_stats` call (SPECIALISTS-120). Settlement must never
   * hang on telemetry: on expiry the failure is recorded as an explicit event and the run
   * settles anyway.
   */
  sessionStatsTimeoutMs?: number;
  /** Test seam: inject the Pi version instead of probing the binary. */
  piVersion?: string;
}

export const RUNTIME_TOOL_CATALOG_ERROR_MESSAGE =
  'Runtime tool catalog unavailable or invalid; refusing to launch with Pi default tools. Reinstall or rebuild Specialists and verify config/catalog/index.json.';

export type RuntimeToolCatalogErrorReason =
  | 'invalid_permission_tier'
  | 'project_catalog_invalid'
  | 'canonical_catalog_unavailable'
  | 'canonical_catalog_invalid'
  | 'tool_contract_invalid'
  | 'empty_tool_contract';

export class RuntimeToolCatalogResolutionError extends Error {
  readonly code = 'runtime_tool_catalog_unavailable';

  constructor(readonly reason: RuntimeToolCatalogErrorReason) {
    super(RUNTIME_TOOL_CATALOG_ERROR_MESSAGE);
    this.name = 'RuntimeToolCatalogResolutionError';
  }
}

function toRuntimeToolCatalogs(catalogIndex: ToolCatalogIndex): readonly ToolCatalog[] {
  return catalogIndex.catalogs.map((catalog) => ({
    catalog: catalog.catalog,
    precedence: catalog.precedence,
    source_tiers: {
      READ_ONLY: catalog.source_tiers.READ_ONLY ?? [],
      LOW: catalog.source_tiers.LOW ?? [],
      MEDIUM: catalog.source_tiers.MEDIUM ?? [],
      HIGH: catalog.source_tiers.HIGH ?? [],
    },
  }));
}

/**
 * Exported so the doctor reports the SAME catalog the runtime resolves (SPECIALISTS-42 (d)).
 * A second resolution rule is how two resolvers came to disagree about the store path before
 * (SPECIALISTS-3); a doctor that inspects a different catalog than the runtime loads would be
 * the same defect wearing a diagnostic hat.
 */
export function loadSharedToolCatalogIndex(cwd: string): ToolCatalogIndex {
  const overridePath = resolve(cwd, '.specialists', 'catalog', 'index.json');
  let overrideExists = false;
  try {
    lstatSync(overridePath);
    overrideExists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new RuntimeToolCatalogResolutionError('project_catalog_invalid');
    }
  }

  if (overrideExists) {
    try {
      return loadToolCatalogIndex(readFileSync(overridePath, 'utf8'));
    } catch {
      throw new RuntimeToolCatalogResolutionError('project_catalog_invalid');
    }
  }

  let canonicalDir: string | null;
  try {
    canonicalDir = resolveCanonicalAssetDir('catalog');
  } catch {
    throw new RuntimeToolCatalogResolutionError('canonical_catalog_unavailable');
  }
  if (!canonicalDir) {
    throw new RuntimeToolCatalogResolutionError('canonical_catalog_unavailable');
  }
  const canonicalPath = resolve(canonicalDir, 'index.json');
  try {
    return loadToolCatalogIndex(readFileSync(canonicalPath, 'utf8'));
  } catch {
    throw new RuntimeToolCatalogResolutionError('canonical_catalog_invalid');
  }
}

/**
 * The runtime's own package.json version read, exported so the doctor reports the SAME installed
 * version the gate compares (SPECIALISTS-42 (d) review). A second inline lookup in doctor.ts was
 * identical today, but identical-today is how two resolvers come to disagree tomorrow — the
 * doctor would then describe a version the gate never saw, which is the defect this issue is
 * about wearing a diagnostic hat.
 */
export function readPackageVersion(packageJsonPath: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

function resolveGitnexusRuntime(options: { catalogIndex: ToolCatalogIndex; excludeExtensions?: readonly string[] }): {
  packageName: string;
  packagePath?: string;
  extensionState: ExtensionState;
} {
  const gitnexusCatalog = options.catalogIndex.catalogs.find(catalog => catalog.catalog === 'gitnexus');
  const packageName = gitnexusCatalog?.package ?? 'pi-gitnexus';
  if ((options.excludeExtensions ?? []).includes(packageName)) {
    return {
      packageName,
      extensionState: { enabled: false, health: 'disabled', catalogCompatible: true },
    };
  }

  const globalDir = resolveGlobalNodeModulesDir();
  if (!globalDir) {
    return {
      packageName,
      extensionState: { enabled: true, health: 'not_installed', catalogCompatible: false },
    };
  }

  const packagePath = join(globalDir, packageName);
  const packageJsonPath = join(packagePath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return {
      packageName,
      extensionState: { enabled: true, health: 'not_installed', catalogCompatible: false },
    };
  }

  const installedVersion = readPackageVersion(packageJsonPath);
  if (!installedVersion) {
    return {
      packageName,
      packagePath,
      extensionState: { enabled: true, health: 'loaded_unhealthy', catalogCompatible: false },
    };
  }

  // SPECIALISTS-42: compatibility, not identity. A patch release inside the pin's line is
  // healthy; only a version outside it fails closed, and it says why.
  if (gitnexusCatalog) {
    const verdict = resolveCatalogVersionVerdict(installedVersion, gitnexusCatalog.version);
    if (!verdict.compatible) {
      return {
        packageName,
        packagePath,
        extensionState: { enabled: true, health: 'loaded_unhealthy', catalogCompatible: false, reason: verdict.reason },
      };
    }
  }

  return {
    packageName,
    packagePath,
    extensionState: { enabled: true, health: 'loaded_healthy', catalogCompatible: true },
  };
}

function resolvePiExtensionsPythonKernelRuntime(options: { catalogIndex: ToolCatalogIndex; excludeExtensions?: readonly string[] }): {
  packageName: string;
  packagePath?: string;
  extensionState: ExtensionState;
} {
  const catalog = options.catalogIndex.catalogs.find((c) => c.catalog === 'python-kernel');
  const packageName = catalog?.package ?? '@jaggerxtrm/pi-extensions';
  if ((options.excludeExtensions ?? []).includes(packageName)) {
    return {
      packageName,
      extensionState: { enabled: false, health: 'disabled', catalogCompatible: true },
    };
  }

  const globalDir = resolveGlobalNodeModulesDir();
  if (!globalDir) {
    return {
      packageName,
      extensionState: { enabled: true, health: 'not_installed', catalogCompatible: false },
    };
  }

  const packagePath = join(globalDir, packageName);
  const packageJsonPath = join(packagePath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return {
      packageName,
      extensionState: { enabled: true, health: 'not_installed', catalogCompatible: false },
    };
  }

  const installedVersion = readPackageVersion(packageJsonPath);
  const extPath = join(packagePath, 'extensions', 'python-kernel', 'index.ts');
  if (!installedVersion || !existsSync(extPath)) {
    return {
      packageName,
      packagePath,
      extensionState: { enabled: true, health: 'loaded_unhealthy', catalogCompatible: false },
    };
  }

  // The SAME rule as the gitnexus gate above — one comparator, so the two catalogs cannot
  // disagree about what compatibility means (SPECIALISTS-42).
  if (catalog) {
    const verdict = resolveCatalogVersionVerdict(installedVersion, catalog.version);
    if (!verdict.compatible) {
      return {
        packageName,
        packagePath,
        extensionState: { enabled: true, health: 'loaded_unhealthy', catalogCompatible: false, reason: verdict.reason },
      };
    }
  }

  return {
    packageName,
    packagePath,
    extensionState: { enabled: true, health: 'loaded_healthy', catalogCompatible: true },
  };
}

export function resolveRuntimeToolContract(options: {
  level?: string;
  specialistName?: string;
  specialistPermissions?: ManifestPolicy['permissions'];
  excludeExtensions?: readonly string[];
  extensionSources?: readonly string[];
  cwd?: string;
}): ResolvedToolContract | undefined {
  if (options.level === undefined) return undefined;

  const tier = options.level.trim().toUpperCase();
  if (tier !== 'READ_ONLY' && tier !== 'LOW' && tier !== 'MEDIUM' && tier !== 'HIGH') {
    throw new RuntimeToolCatalogResolutionError('invalid_permission_tier');
  }
  const catalogIndex = loadSharedToolCatalogIndex(resolve(options.cwd ?? process.cwd()));

  const specialistOverride: ManifestPolicyTier | undefined = options.specialistPermissions?.[tier];
  const gitnexusRuntime = resolveGitnexusRuntime({
    catalogIndex,
    excludeExtensions: options.excludeExtensions,
  });
  const pythonKernelRuntime = resolvePiExtensionsPythonKernelRuntime({
    catalogIndex,
    excludeExtensions: options.excludeExtensions,
  });

  const runtimeCatalogs = toRuntimeToolCatalogs(catalogIndex);

  let contract: ResolvedToolContract;
  try {
    contract = buildResolvedToolContract({
      tier,
      catalogs: runtimeCatalogs,
      catalogDefaultOverrides: catalogIndex.default_overrides,
      manifestPolicy: options.specialistPermissions ? { permissions: options.specialistPermissions } : undefined,
      specialistOverride,
      specialistExclusions: (options.excludeExtensions ?? []).includes(gitnexusRuntime.packageName)
        ? { disabledExtensions: ['gitnexus'] }
        : undefined,
      extensionSources: options.extensionSources,
      extensionState: {
        gitnexus: gitnexusRuntime.extensionState,
        'python-kernel': pythonKernelRuntime.extensionState,
      },
      extensionPackages: {
        gitnexus: {
          packageName: gitnexusRuntime.packageName,
          packagePath: gitnexusRuntime.packagePath,
        },
        'python-kernel': {
          packageName: pythonKernelRuntime.packageName,
          packagePath: pythonKernelRuntime.packagePath,
        },
      },
    });
  } catch {
    throw new RuntimeToolCatalogResolutionError('tool_contract_invalid');
  }
  if (!contract.toolsFlag.trim()) {
    throw new RuntimeToolCatalogResolutionError('empty_tool_contract');
  }
  return contract;
}

export function resolvePermissionTools(options: {
  level?: string;
  specialistName?: string;
  specialistPermissions?: ManifestPolicy['permissions'];
  excludeExtensions?: readonly string[];
  extensionSources?: readonly string[];
  cwd?: string;
}): string | undefined {
  return resolveRuntimeToolContract(options)?.toolsFlag || undefined;
}

/**
 * Applies the extension tool-policy gate to a spawn arg list (unitAI-34pyf).
 * When the resolved contract exposes enabled extension sources:
 *   - the session starts `--no-builtin-tools` (nothing active by default),
 *   - the Specialists-owned policy extension is appended LAST to `-e` and, at
 *     session_start, re-activates the tier's granted natives (bounded env
 *     channel) plus every tool registered by the enabled extension sources.
 * Native restrictions stay fail-closed: anything not explicitly granted is
 * never activated, and Pi rejects inactive tools at call time. When no
 * extension source is enabled this is a no-op and the caller keeps the strict
 * `--tools` allowlist — byte-identical legacy behavior.
 *
 * HARD-FAIL: with extension sources enabled, a missing policy artifact aborts
 * the launch. Running `--no-builtin-tools` without the policy extension would
 * leave explicitly enabled extension tools active while the granted natives
 * stay inactive — a broken, misleading session. Never warn-and-continue.
 */
export function applyExtensionToolPolicyGate(
  args: string[],
  contract: ResolvedToolContract | undefined,
  env: Record<string, string>,
): void {
  if (!contract || (contract.exposedExtensionSources?.length ?? 0) === 0) return;
  const policyPath = getExtensionToolPolicyExtensionPath();
  if (!policyPath) {
    throw new Error(
      '[xtrm-tool-policy] bundled policy extension not found while extension sources are enabled ' +
        `(${contract.exposedExtensionSources.join(', ')}); aborting launch. ` +
        'Reinstall or rebuild the specialists package so config/pi-extensions/extension-tool-policy ships.',
    );
  }
  args.push('--no-builtin-tools');
  args.push('-e', policyPath);
  env[NATIVE_TOOLS_ENV_KEY] = contract.nativeTools.join(',');
  // The promise the gate verifies against the live registry (SPECIALISTS-42).
  env[REQUIRED_EXTENSION_TOOLS_ENV_KEY] = contract.extensionTools.join(',');
}

function isRemoteExtensionSource(source: string): boolean {
  return source.startsWith('npm:') || source.startsWith('git:') || source.startsWith('http://') || source.startsWith('https://');
}

/**
 * Canonical identity for a local `-e` extension source (unitAI-il2io).
 *
 * The python-kernel ships twice on dev machines: the managed npm copy
 * (`.../node_modules/@jaggerxtrm/pi-extensions/extensions/python-kernel/index.ts`,
 * often a symlink into the core checkout) and a raw dev-checkout path
 * (`/home/.../dev/core/packages/pi-extensions/extensions/python-kernel`,
 * directory form). Pi treats those as two extensions registering tool
 * `python` and exits 1 before turn 0. Mapping both forms to the same
 * realpath (dir -> dir/index.ts, symlinks resolved) lets the spawn dedup
 * before Pi ever sees the conflict. Remote sources and missing paths
 * return null (dedup by exact string only).
 */
function canonicalizeLocalExtensionIdentity(source: string): string | null {
  if (isRemoteExtensionSource(source)) return null;
  let candidate = source;
  try {
    const stat = statSync(candidate);
    if (stat.isDirectory()) {
      const indexCandidate = join(candidate, 'index.ts');
      if (existsSync(indexCandidate)) candidate = indexCandidate;
    }
  } catch {
    return null;
  }
  try {
    return realpathSync(candidate);
  } catch {
    try {
      return resolve(candidate);
    } catch {
      return null;
    }
  }
}

export function deduplicateExtensionSources(
  autoInjected: readonly string[],
  dynamicSources: readonly string[],
): { kept: string[]; dropped: Array<{ dropped: string; keptAs: string }> } {
  const seenExact = new Set<string>();
  const keptByIdentity = new Map<string, string>();
  for (const auto of autoInjected) {
    seenExact.add(auto);
    const identity = canonicalizeLocalExtensionIdentity(auto);
    if (identity) keptByIdentity.set(identity, auto);
  }
  const kept: string[] = [];
  const dropped: Array<{ dropped: string; keptAs: string }> = [];
  for (const source of dynamicSources) {
    if (seenExact.has(source)) {
      dropped.push({ dropped: source, keptAs: source });
      continue;
    }
    const identity = canonicalizeLocalExtensionIdentity(source);
    const keptAs = identity ? keptByIdentity.get(identity) : undefined;
    if (identity && keptAs !== undefined) {
      dropped.push({ dropped: source, keptAs });
      continue;
    }
    seenExact.add(source);
    if (identity) keptByIdentity.set(identity, source);
    kept.push(source);
  }
  return { kept, dropped };
}

/**
 * The Pi discovery fences the legacy CLI session disables, as the argv fragments it passes.
 *
 * XTRM-84: the native/legacy parity harness has to compare the resource fence each runtime
 * ACTUALLY configures. The native side derives it from the resource-loader options it
 * constructs (`createActivationResourceLoader`); the legacy side is this argv. Before this
 * helper existed the harness hardcoded `ambientDiscovery: false` for legacy, so dropping
 * `--no-context-files` below - which would let auto-discovered context files into every
 * legacy child - stayed invisible. Reading the fragments the session really passes is what
 * makes that regression fail a test.
 *
 * Split into the two positions the flags occupy in the argv rather than one contiguous list,
 * because the argv order is load-bearing (`tests/unit/pi/session.test.ts` asserts
 * `--no-context-files` comes after `--offline`). `start()` splats both halves verbatim, so
 * this function and the argv cannot diverge.
 */
export function sessionResourceFenceArgv(): { head: string[]; tail: string[] } {
  return {
    head: ['--no-extensions', '--no-skills'],
    tail: ['--no-context-files', '--no-prompt-templates', '--no-themes'],
  };
}

/**
 * Which of the five discovery fences a session argv actually disables.
 *
 * The inverse of `sessionResourceFenceArgv`: a present flag means the fence is DISABLED,
 * which is the direction the native resource loader expresses directly (`noSkills: true`).
 * Unknown flags are ignored, so this can be handed a whole session argv.
 */
export function parseSessionResourceFence(argv: readonly string[]): {
  noSkills: boolean;
  noExtensions: boolean;
  noContextFiles: boolean;
  noPromptTemplates: boolean;
  noThemes: boolean;
} {
  const present = new Set(argv);
  return {
    noSkills: present.has('--no-skills'),
    noExtensions: present.has('--no-extensions'),
    noContextFiles: present.has('--no-context-files'),
    noPromptTemplates: present.has('--no-prompt-templates'),
    noThemes: present.has('--no-themes'),
  };
}

export function resolveExecutionExtensionSelection(
  extensions: Readonly<Record<string, boolean | null | undefined>> | undefined,
): { excludeExtensions: string[]; extensionSources: string[]; offline: boolean } {
  const excludeExtensions: string[] = [];
  const extensionSources: string[] = [];

  for (const [source, enabled] of Object.entries(extensions ?? {})) {
    if (source === 'serena') continue;
    if (source === 'gitnexus') {
      if (enabled === false) excludeExtensions.push('pi-gitnexus');
      continue;
    }
    if (enabled !== true) continue;
    extensionSources.push(source);
  }

  return {
    excludeExtensions,
    extensionSources,
    offline: !extensionSources.some(isRemoteExtensionSource),
  };
}

/**
 * The curated Pi extension set every Specialist session gets, resolved once for BOTH
 * surfaces: the legacy CLI turns these into argv `-e` flags (`start()` below), and the
 * native host hands the same paths to the resource loader's `additionalExtensionPaths`.
 *
 * Extracted rather than duplicated (SPECIALISTS-6): the two runtimes drifted by exactly
 * this kind of copy, and the native path historically injected nothing at all while the
 * CLI re-enabled this set after `--no-extensions`.
 */
export interface CuratedExtensionResolution {
  /** Every curated path, in the legacy argv order. Only paths that exist are included. */
  all: string[];
  /**
   * The subset that takes part in same-identity de-duplication against a definition's own
   * `execution.extensions` sources. Preserved verbatim from the pre-extraction code
   * (unitAI-il2io): the managed python-kernel copy and the gitnexus npm copy are the two a
   * dev-checkout source can collide with, and Pi aborts with `Tool "python" conflicts`
   * before turn 0 when both are forwarded. The managed copy wins and every drop is logged.
   */
  dedupeAgainstDynamic: string[];
}

export function resolveCuratedExtensionPaths(options: {
  permissionLevel?: string;
  resolvedToolContract?: ResolvedToolContract;
}): CuratedExtensionResolution {
  const all: string[] = [];
  const piExtDir = join(homedir(), '.pi', 'agent', 'extensions');
  const permLevel = (options.permissionLevel ?? '').toUpperCase();
  if (permLevel !== 'READ_ONLY') {
    const qgPath = join(piExtDir, 'quality-gates');
    if (existsSync(qgPath)) all.push(qgPath);
  }
  // python-kernel: persistent python3 tool (skillbridge/audit/QoL). Resolved from the
  // @jaggerxtrm/pi-extensions package (global node_modules) like the gitnexus package — not
  // from ~/.pi/agent/extensions (those loose copies are not managed). Injecting `python`
  // gives specialists an in-kernel python REPL instead of only bash.
  const pyKernelPath = resolvePiExtensionsPythonKernelPath();
  if (pyKernelPath && permLevel !== 'READ_ONLY') all.push(pyKernelPath);
  // Caveman extension — terse output for agent-to-agent communication.
  const cavemanPath = join(piExtDir, 'caveman');
  if (existsSync(cavemanPath)) all.push(cavemanPath);
  // NVIDIA NIM provider extension — injects chat_template_kwargs and system-role compat.
  const nvidiaNimPath = join(homedir(), '.pi', 'agent', 'git', 'github.com', 'xRyul', 'pi-nvidia-nim');
  if (existsSync(nvidiaNimPath)) all.push(nvidiaNimPath);
  // npm package extension (gitnexus), resolved from global node_modules. Serena injection was
  // retired with K4 (unitAI-e67up.8).
  const gitnexusContract = options.resolvedToolContract?.extensions.gitnexus;
  if (gitnexusContract?.status === 'available' && gitnexusContract.packagePath && existsSync(gitnexusContract.packagePath)) {
    all.push(gitnexusContract.packagePath);
  }
  return {
    all,
    dedupeAgainstDynamic: [
      ...(pyKernelPath ? [pyKernelPath] : []),
      ...(gitnexusContract?.status === 'available' && gitnexusContract.packagePath ? [gitnexusContract.packagePath] : []),
    ],
  };
}

let cachedPiVersion: string | undefined;
let piVersionResolved = false;

/**
 * Resolve the Pi version actually in use for a run (SPECIALISTS-120 criterion 7).
 *
 * Prefers the `pi` binary on PATH — that is what the legacy `sp run` path executes, and a
 * telemetry row must name the binary that produced it, not a package that happens to be
 * installed elsewhere. Falls back to the resolved SDK package's `package.json` (the native
 * activation path loads that package in-process). Cached per process: the version cannot
 * change under a running session, and probing per run would spawn a process per activation.
 *
 * Never throws: an unresolvable version returns `undefined` and the run records no version
 * rather than failing to start.
 */
export function resolvePiVersion(): string | undefined {
  if (piVersionResolved) return cachedPiVersion;
  piVersionResolved = true;
  try {
    const output = execFileSync('pi', ['--version'], { encoding: 'utf-8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] });
    const version = output.trim();
    if (version.length > 0) {
      cachedPiVersion = version;
      return cachedPiVersion;
    }
  } catch {
    // Binary absent or unreadable; fall through to the SDK package.
  }
  try {
    const globalDir = resolveGlobalNodeModulesDir();
    if (globalDir) {
      const pkgPath = join(globalDir, '@earendil-works', 'pi-coding-agent', 'package.json');
      if (existsSync(pkgPath)) {
        const parsed = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
        if (typeof parsed.version === 'string' && parsed.version.length > 0) {
          cachedPiVersion = parsed.version;
          return cachedPiVersion;
        }
      }
    }
  } catch {
    // Version telemetry is never worth failing a run over.
  }
  return undefined;
}

/** Test seam: drop the cached Pi version so a test can supply its own environment. */
export function __resetPiVersionCacheForTest(): void {
  cachedPiVersion = undefined;
  piVersionResolved = false;
}

export function resolveGlobalNodeModulesDir(): string | undefined {
  const candidates = [
    process.env.PI_NPM_GLOBAL_DIR,
    process.env.NPM_CONFIG_PREFIX ? join(process.env.NPM_CONFIG_PREFIX, 'lib', 'node_modules') : undefined,
    process.env.npm_config_prefix ? join(process.env.npm_config_prefix, 'lib', 'node_modules') : undefined,
    process.env.NVM_BIN ? join(dirname(process.env.NVM_BIN), 'lib', 'node_modules') : undefined,
    join(homedir(), '.nvm/versions/node', process.version, 'lib', 'node_modules'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(candidate => existsSync(candidate));
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Read one usage candidate (SPECIALISTS-120).
 *
 * `providerReported` is the provenance claim: true only for a value that came out of a
 * `usage`-shaped field Pi reported (an assistant/toolResult message, a turn/run payload, a
 * compaction summary call). The parser's last-resort fallback — normalizing a whole event
 * record — is NOT a provider report and must stay `unknown` rather than inherit
 * `provider_usage` from the schema default.
 */
function normalizeTokenUsage(candidate: unknown, providerReported = true): SessionTokenUsage | undefined {
  const normalized = normalizeSessionTokenUsage(candidate);
  if (!normalized) return undefined;
  if (providerReported && normalized.usage_source === 'unknown' && !hasExplicitUsageSource(candidate)) {
    normalized.usage_source = 'provider_usage';
  }
  return normalized;
}

function hasExplicitUsageSource(candidate: unknown): boolean {
  if (candidate === null || typeof candidate !== 'object') return false;
  return typeof (candidate as Record<string, unknown>).usage_source === 'string';
}

function findFinishReason(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const direct = record.stopReason ?? record.finishReason ?? record.finish_reason ?? record.reason;
  if (typeof direct === 'string' && direct.trim().length > 0) return direct;
  return undefined;
}

function findTokenUsage(payload: unknown): SessionTokenUsage | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const message = (record.message && typeof record.message === 'object') ? record.message as Record<string, unknown> : undefined;
  const assistantMessage = Array.isArray(record.messages)
    ? [...record.messages]
      .reverse()
      .find((m): m is Record<string, unknown> => !!m && typeof m === 'object' && (m as Record<string, unknown>).role === 'assistant')
    : undefined;

  const candidates: unknown[] = [
    record.usage,
    record.tokenUsage,
    record.token_usage,
    message?.usage,
    message?.tokenUsage,
    message?.token_usage,
    assistantMessage?.usage,
    assistantMessage?.tokenUsage,
    assistantMessage?.token_usage,
    (record.stats as Record<string, unknown> | undefined)?.usage,
    (record.stats as Record<string, unknown> | undefined)?.tokenUsage,
    (record.result as Record<string, unknown> | undefined)?.usage,
    (record.result as Record<string, unknown> | undefined)?.tokenUsage,
    (record.assistantMessageEvent as Record<string, unknown> | undefined)?.usage,
    (record.assistantMessageEvent as Record<string, unknown> | undefined)?.tokenUsage,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeTokenUsage(candidate);
    if (normalized) return normalized;
  }

  // Last resort: the event record itself may carry bare counters. It did not come from a
  // `usage` field, so it must not be labelled provider usage (SPECIALISTS-120 criterion 4).
  return normalizeTokenUsage(record, false);
}

function extractMessageTextContent(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;
  const content = record.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const item = part as Record<string, unknown>;
      if (item.type !== undefined && item.type !== 'text') return '';
      return typeof item.text === 'string' ? item.text : '';
    })
    .join('');
}

function findApiErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const direct = [record.errorMessage, record.error_message, record.error, record.message]
    .find((value) => typeof value === 'string' && value.trim().length > 0);
  if (typeof direct === 'string') return direct.trim();

  const nestedError = record.error;
  if (nestedError && typeof nestedError === 'object') {
    const nested = nestedError as Record<string, unknown>;
    const nestedMessage = [nested.message, nested.errorMessage, nested.error_message]
      .find((value) => typeof value === 'string' && value.trim().length > 0);
    if (typeof nestedMessage === 'string') return nestedMessage.trim();
  }

  const message = record.assistantMessageEvent;
  if (message && typeof message === 'object') {
    const nested = message as Record<string, unknown>;
    const nestedMessage = [nested.errorMessage, nested.error_message, nested.error, nested.message]
      .find((value) => typeof value === 'string' && value.trim().length > 0);
    if (typeof nestedMessage === 'string') return nestedMessage.trim();
  }

  return undefined;
}

function extractApiErrorFromStderr(stderr: string): string | undefined {
  const compact = stderr.trim();
  if (!compact) return undefined;

  const patterns = [
    /You have hit your ChatGPT usage limit[^\n]*/i,
    /rate limit[^\n]*/i,
    /quota[^\n]*/i,
    /auth(?:entication)?[^\n]*/i,
    /unauthori[sz]ed[^\n]*/i,
    /forbidden[^\n]*/i,
    /overloaded[^\n]*/i,
  ];

  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (match) return match[0].trim();
  }

  return undefined;
}

function normalizeToolResultPart(contentPart: unknown): string | undefined {
  if (!contentPart || typeof contentPart !== 'object') return undefined;
  const part = contentPart as Record<string, unknown>;
  const text = part.text;
  if (typeof text === 'string' && text.trim().length > 0) return text;

  const content = part.content;
  if (typeof content === 'string' && content.trim().length > 0) return content;

  const output = part.output;
  if (typeof output === 'string' && output.trim().length > 0) return output;

  return undefined;
}

function findToolResultContent(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const result = record.result;
  if (!result || typeof result !== 'object') return undefined;
  const resultRecord = result as Record<string, unknown>;

  const content = resultRecord.content;
  if (Array.isArray(content)) {
    const parts = content
      .map(normalizeToolResultPart)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (parts.length > 0) return parts.join('\n');
  }

  if (typeof resultRecord.content === 'string' && resultRecord.content.trim().length > 0) {
    return resultRecord.content;
  }

  if (typeof resultRecord.output === 'string' && resultRecord.output.trim().length > 0) {
    return resultRecord.output;
  }

  return undefined;
}

function findToolResultRaw(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const result = record.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  return result as Record<string, unknown>;
}

function findStringValue(payload: unknown, keys: readonly string[]): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

function extractBashCommand(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  const command = args.command ?? args.cmd ?? args.script;
  if (typeof command !== 'string') return undefined;
  const normalizedCommand = command.trim();
  return normalizedCommand.length > 0 ? normalizedCommand : undefined;
}

function isTestCommand(command: string): boolean {
  return TEST_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

const WRITE_BOUNDARY_TOOL_NAMES = new Set(['edit', 'write', 'multiEdit', 'notebookEdit']);
const WORKTREE_BOUNDARY_ENV_KEY = 'SPECIALISTS_WORKTREE_BOUNDARY';

function isPathWithinBoundary(path: string, boundary: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedBoundary = resolve(boundary);
  if (resolvedPath === resolvedBoundary) return true;
  const boundaryPrefix = resolvedBoundary.endsWith(sep) ? resolvedBoundary : `${resolvedBoundary}${sep}`;
  return resolvedPath.startsWith(boundaryPrefix);
}

export function validateWriteToolPathAgainstBoundary(
  toolName: string,
  toolArgs: Record<string, unknown> | undefined,
  worktreeBoundary: string | undefined,
): string | undefined {
  if (!worktreeBoundary) return undefined;
  if (!WRITE_BOUNDARY_TOOL_NAMES.has(toolName)) return undefined;
  if (!toolArgs || typeof toolArgs !== 'object') return undefined;

  const candidatePath = typeof toolArgs.path === 'string'
    ? toolArgs.path
    : (typeof toolArgs.file_path === 'string' ? toolArgs.file_path : undefined);
  if (!candidatePath || !isAbsolute(candidatePath)) return undefined;

  if (isPathWithinBoundary(candidatePath, worktreeBoundary)) return undefined;

  const resolvedBoundary = resolve(worktreeBoundary);
  return `Path '${candidatePath}' is outside worktree boundary ('${resolvedBoundary}'). Use a relative path or a path within the worktree.`;
}

function getWorktreeBoundaryExtensionPath(worktreeBoundary: string): string | null {
  const boundaryHash = createHash('sha256').update(resolve(worktreeBoundary)).digest('hex').slice(0, 16);
  const extensionsDir = join(tmpdir(), 'specialists-pi-extensions');
  try {
    mkdirSync(extensionsDir, { recursive: true });
  } catch (err) {
    process.stderr.write(
      `[worktree-boundary] WARN: could not create extensions directory at ${extensionsDir}: ${(err as Error).message}. ` +
      `Boundary enforcement will NOT apply for this session.\n`,
    );
    return null;
  }
  const extensionPath = join(extensionsDir, `worktree-boundary-${boundaryHash}.mjs`);
  if (existsSync(extensionPath)) return extensionPath;

  const extensionSource = `
import { isAbsolute, resolve } from 'node:path';

const WRITE_TOOLS = new Set(['edit', 'write', 'multiEdit', 'notebookEdit']);
const WORKTREE_BOUNDARY_ENV_KEY = '${WORKTREE_BOUNDARY_ENV_KEY}';

function isPathWithinBoundary(path, boundary) {
  const resolvedPath = resolve(path);
  const resolvedBoundary = resolve(boundary);
  if (resolvedPath === resolvedBoundary) return true;
  return resolvedPath.startsWith(resolvedBoundary.endsWith('/') ? resolvedBoundary : resolvedBoundary + '/');
}

export default function(pi) {
  const worktreeBoundary = process.env[WORKTREE_BOUNDARY_ENV_KEY];
  if (!worktreeBoundary) return;

  pi.on('tool_call', (event) => {
    if (!WRITE_TOOLS.has(event.toolName)) return undefined;

    const input = event.input && typeof event.input === 'object' ? event.input : {};
    const rawPath = typeof input.path === 'string'
      ? input.path
      : (typeof input.file_path === 'string' ? input.file_path : undefined);

    if (!rawPath || !isAbsolute(rawPath)) return undefined;

    if (isPathWithinBoundary(rawPath, worktreeBoundary)) return undefined;

    return {
      block: true,
      reason: \`Path '\${rawPath}' is outside worktree boundary ('\${resolve(worktreeBoundary)}'). Use a relative path or a path within the worktree.\`,
    };
  });
}
`.trimStart();

  try {
    writeFileSync(extensionPath, extensionSource, 'utf-8');
  } catch (err) {
    process.stderr.write(
      `[worktree-boundary] WARN: could not write extension file at ${extensionPath}: ${(err as Error).message}. ` +
      `Boundary enforcement will NOT apply for this session.\n`,
    );
    return null;
  }
  return extensionPath;
}


export class PiAgentSession {
  private proc?: ChildProcess;
  private _lastOutput = '';
  private _donePromise?: Promise<void>;
  private _doneResolve?: () => void;
  private _doneReject?: (e: Error) => void;
  private _agentEndReceived = false;
  private _killed = false;
  private _lineBuffer = '';   // accumulates partial lines split across stdout chunks
  private _pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private _nextRequestId = 1;
  private _stderrBuffer = '';
  private _apiError?: string;
  private _stallTimer?: ReturnType<typeof setTimeout>;
  private _stallError?: Error;
  private _testWindowToolCallIds = new Set<string>();
  private _testWindowWithoutIdCount = 0;
  private _impactWindowToolCallIds = new Set<string>();
  private _impactWindowWithoutIdCount = 0;
  private _metrics: SessionRunMetrics = {
    turns: 0,
    tool_calls: 0,
    auto_compactions: 0,
    auto_retries: 0,
  };
  /**
   * Summed per-message usage (SPECIALISTS-120 criterion 5). Accumulated on `message_end` only —
   * the one event per message carrying final usage — so streaming partials cannot double-count.
   * This is the "summed" side of the reconciliation against Pi's session totals; `_metrics.
   * token_usage` keeps its historical last-value semantics for existing readers.
   */
  private _summedUsage?: SessionTokenUsage;
  private _summedUsageSeen: Record<string, number> = {};
  private _sessionStats?: PiSessionStats;
  private _sessionStatsError?: string;
  /** Guards once-per-run settlement capture; reset when a new turn starts. */
  private _sessionStatsCaptured = false;
  private _piVersion?: string;
  readonly meta: AgentSessionMeta;

  private constructor(
    private options: PiSessionOptions,
    meta: AgentSessionMeta,
  ) {
    this.meta = meta;
  }

  static async create(options: PiSessionOptions): Promise<PiAgentSession> {
    const meta: AgentSessionMeta = {
      backend: options.model.includes('/')
        ? options.model.split('/')[0]
        : mapSpecialistBackend(options.model),
      model: options.model,
      sessionId: crypto.randomUUID(),
      startedAt: new Date(),
    };
    return new PiAgentSession(options, meta);
  }

  async start(): Promise<void> {
    const model = this.options.model;
    const extraArgs = getProviderArgs(model);

    const providerArgs: string[] = model.includes('/')
      ? ['--model', model]
      : ['--provider', mapSpecialistBackend(model)];

    // Resource fence (XTRM-84): built from the shared projection so the parity harness reads
    // the flags this session really passes instead of a parallel copy of them. head =
    // --no-extensions (disable ALL auto-discovered xtrm Pi extensions: beads, session-flow,
    // etc.) and --no-skills (isolate: discovery pool == declared skills.paths only, re-added
    // below via --skill); tail = the context-file, prompt-template and theme fences.
    const resourceFence = sessionResourceFenceArgv();
    const args = [
      '--mode', 'rpc',
      ...resourceFence.head,
      ...providerArgs,
      '--no-session',
      ...(this.options.offline === false ? [] : ['--offline']),
      ...resourceFence.tail,
      ...extraArgs,
    ];

    // Enforce permission level via --tools flag
    const resolvedToolContract = this.options.resolvedToolContract ?? resolveRuntimeToolContract({
      level: this.options.permissionLevel,
      specialistName: this.options.specialistName,
      specialistPermissions: this.options.specialistPermissions,
      excludeExtensions: this.options.excludeExtensions,
      extensionSources: this.options.extensionSources,
      cwd: this.options.cwd,
    });
    if (this.options.permissionLevel !== undefined && !resolvedToolContract?.toolsFlag.trim()) {
      throw new RuntimeToolCatalogResolutionError('empty_tool_contract');
    }
    if (resolvedToolContract?.toolsFlag && (resolvedToolContract.exposedExtensionSources?.length ?? 0) === 0) {
      args.push('--tools', resolvedToolContract.toolsFlag);
    }

    // Thinking level (models that don't support it ignore the flag)
    if (this.options.thinkingLevel) {
      args.push('--thinking', this.options.thinkingLevel);
    }

    // Skill files declared via pi --skill (native flag; body force-loads at turn-1 via /skill:name).
    for (const skillPath of this.options.skillPaths ?? []) {
      args.push('--skill', skillPath);
    }

    // Selectively re-enable useful Pi extensions if installed. The set is resolved by the
    // shared helper the native host also uses (SPECIALISTS-6), so the two runtimes cannot
    // drift on which extensions a Specialist gets.
    const curatedExtensions = resolveCuratedExtensionPaths({
      permissionLevel: this.options.permissionLevel,
      resolvedToolContract,
    });
    for (const extensionPath of curatedExtensions.all) {
      args.push('-e', extensionPath);
    }
    // unitAI-il2io: never forward two `-e` sources with the same filesystem
    // identity. The managed copy wins and every drop is logged (no silent shadowing).
    const { kept: dedupedSources, dropped: droppedSources } = deduplicateExtensionSources(
      curatedExtensions.dedupeAgainstDynamic,
      this.options.extensionSources ?? [],
    );
    for (const { dropped, keptAs } of droppedSources) {
      process.stderr.write(
        `[python-kernel] DEDUP: skipping duplicate extension source '${dropped}' (same as '${keptAs}'; kept '${keptAs}').\n`,
      );
    }
    for (const source of dedupedSources) {
      args.push('-e', source);
    }

    if (this.options.systemPrompt) {
      const systemPromptFlag = this.options.systemPromptMode === 'replace' ? '--system-prompt' : '--append-system-prompt';
      args.push(systemPromptFlag, this.options.systemPrompt);
    }

    const worktreeBoundary = this.options.worktreeBoundary ? resolve(this.options.worktreeBoundary) : undefined;
    if (worktreeBoundary) {
      const boundaryExtPath = getWorktreeBoundaryExtensionPath(worktreeBoundary);
      if (boundaryExtPath) {
        args.push('-e', boundaryExtPath);
      }
    }

    // Numbered `read` output — bundled fork of xtrm-dev/core's read-line-numbers
    // Pi extension. Fires on tool_result only, no I/O, safe at every permission
    // level. Pushed AFTER worktree-boundary so the boundary check (tool_call)
    // always sees raw payloads even if Pi later adds a raw hook — argv-order
    // invariant is behaviorally moot today but coded on purpose.
    const readLineNumbersPath = getReadLineNumbersExtensionPath();
    if (readLineNumbersPath) args.push('-e', readLineNumbersPath);

    // Extension tool policy (unitAI-34pyf): appended LAST (-e) so every
    // configured source is registered before session_start. Re-activates the
    // granted natives + all extension-registered tools under --no-builtin-tools.
    const policyEnv: Record<string, string> = {};
    applyExtensionToolPolicyGate(args, resolvedToolContract, policyEnv);

    const hookEnv = {
      ...process.env,
      ...(this.options.env ?? {}),
      ...policyEnv,
      CAVEMAN_LEVEL: 'full',
      // python-kernel audit seam: surface kernel-side file mutations in tool
      // details (report-only policy hook) so specialists that rebuild indexes
      // or write from the kernel leave a visible audit trail.
      PI_KERNEL_AUDIT_POLICY: '1',
    };

    // Version telemetry (SPECIALISTS-120 criterion 7): resolved once at session start, so a
    // run names the Pi that produced it even when the operator swaps versions mid-day.
    this._piVersion = this._piVersionValue();
    if (this._piVersion) {
      this._metrics.pi_version = this._piVersion;
      this.options.onMetric?.({ type: 'pi_version', pi_version: this._piVersion });
    }

    const sessionCwd = resolve(this.options.cwd ?? process.cwd());

    // `detached: true` puts pi in its own process group so we can later
    // group-SIGKILL the whole subtree (pi + gitnexus mcp + …)
    // as a backstop when graceful shutdown does not reap MCP children.
    this.proc = spawn('pi', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: sessionCwd,
      env: worktreeBoundary
        ? { ...hookEnv, [WORKTREE_BOUNDARY_ENV_KEY]: worktreeBoundary }
        : hookEnv,
      detached: true,
    });

    const donePromise = new Promise<void>((resolve, reject) => {
      this._doneResolve = resolve;
      this._doneReject = reject;
    });
    // Prevent unhandled rejection warnings when kill() is called before waitForDone() is awaited
    donePromise.catch(() => {});
    this._donePromise = donePromise;

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      this._stderrBuffer += text;
      this._apiError ??= extractApiErrorFromStderr(this._stderrBuffer) ?? extractApiErrorFromStderr(text);
    });

    this.proc.stdout?.on('data', (chunk: Buffer) => {
      // Accumulate into the line buffer — agent_end JSON can be 100KB+,
      // larger than a single stdout chunk (~64KB), so we must reassemble.
      this._lineBuffer += chunk.toString();
      const lines = this._lineBuffer.split('\n');
      // All but the last element are complete lines (last may be partial)
      this._lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) this._handleEvent(line);
      }
    });

    this.proc.stdout?.on('end', () => {
      // Flush any remaining buffered content when stdout closes
      if (this._lineBuffer.trim()) {
        this._handleEvent(this._lineBuffer);
        this._lineBuffer = '';
      }
    });

    this.proc.on('close', (code) => {
      this._clearStallTimer();
      // Fail pending RPC commands immediately: a dead child can never answer.
      // Without this, a startup source-resolution failure (npm:/git: source
      // exits pi 1 before the prompt ack) burns the full per-command timeout
      // and surfaces as a generic "RPC timeout" instead of the actionable
      // exit code + stderr (unitAI-u5xjk).
      if (this._pendingRequests.size > 0) {
        const stderrTail = this._stderrBuffer.trim().split('\n').slice(-5).join('\n').slice(0, 2000);
        const exitDetail = code === null ? '' : ` with code ${code}`;
        const message = `pi process exited${exitDetail} before responding to RPC command${stderrTail ? `; stderr:\n${stderrTail}` : ''}`;
        for (const [, entry] of this._pendingRequests) {
          clearTimeout(entry.timer);
          entry.reject(new Error(message));
        }
        this._pendingRequests.clear();
      }
      if (this._agentEndReceived || this._killed) {
        this._doneResolve?.();
      } else if (code === 0 || code === null) {
        this._doneResolve?.();
      } else {
        this._doneReject?.(new Error(`pi process exited with code ${code}`));
      }
    });
  }

  private _clearStallTimer(): void {
    if (this._stallTimer) {
      clearTimeout(this._stallTimer);
      this._stallTimer = undefined;
    }
  }

  private _isTestWindowActive(): boolean {
    return this._testWindowToolCallIds.size > 0 || this._testWindowWithoutIdCount > 0;
  }

  private _isImpactWindowActive(): boolean {
    return this._impactWindowToolCallIds.size > 0 || this._impactWindowWithoutIdCount > 0;
  }

  private _resolveStallTimeoutMs(): number | undefined {
    const baseTimeoutMs = this.options.stallTimeoutMs;
    if (!baseTimeoutMs || baseTimeoutMs <= 0) return undefined;

    let timeoutMs = baseTimeoutMs;
    if (this._isTestWindowActive()) {
      const testCommandTimeoutMs = this.options.testCommandStallTimeoutMs ?? TEST_COMMAND_STALL_TIMEOUT_MS;
      timeoutMs = Math.max(timeoutMs, testCommandTimeoutMs);
    }
    if (this._isImpactWindowActive()) {
      timeoutMs = Math.max(timeoutMs, GITNEXUS_IMPACT_STALL_TIMEOUT_MS);
    }

    return timeoutMs;
  }

  private _activateTestWindow(toolCallId?: string): void {
    if (toolCallId) {
      this._testWindowToolCallIds.add(toolCallId);
      return;
    }
    this._testWindowWithoutIdCount += 1;
  }

  private _deactivateTestWindow(toolCallId?: string): void {
    if (toolCallId) {
      this._testWindowToolCallIds.delete(toolCallId);
      return;
    }
    if (this._testWindowWithoutIdCount > 0) {
      this._testWindowWithoutIdCount -= 1;
    }
  }

  private _activateImpactWindow(toolCallId?: string): void {
    if (toolCallId) {
      this._impactWindowToolCallIds.add(toolCallId);
      return;
    }
    this._impactWindowWithoutIdCount += 1;
  }

  private _deactivateImpactWindow(toolCallId?: string): void {
    if (toolCallId) {
      this._impactWindowToolCallIds.delete(toolCallId);
      return;
    }
    if (this._impactWindowWithoutIdCount > 0) {
      this._impactWindowWithoutIdCount -= 1;
    }
  }

  private _markActivity(): void {
    const timeoutMs = this._resolveStallTimeoutMs();
    if (!timeoutMs || this._killed || this._agentEndReceived) return;

    this._clearStallTimer();
    this._stallTimer = setTimeout(() => {
      if (this._killed || this._agentEndReceived) return;
      const err = new StallTimeoutError(timeoutMs);
      this._stallError = err;
      this.kill(err);
    }, timeoutMs);
  }

  private _updateTokenUsage(tokenUsage: SessionTokenUsage | undefined, source: 'message_done' | 'turn_end' | 'agent_end'): void {
    if (!tokenUsage) return;

    this._metrics.token_usage = {
      ...this._metrics.token_usage,
      ...tokenUsage,
    };

    this.options.onMetric?.({ type: 'token_usage', token_usage: tokenUsage, source });
  }

  private _updateFinishReason(finishReason: string | undefined, source: 'message_done' | 'turn_end' | 'agent_end'): void {
    if (!finishReason) return;
    this._metrics.finish_reason = finishReason;
    this.options.onMetric?.({ type: 'finish_reason', finish_reason: finishReason, source });
  }

  /**
   * Fold one message's provider-reported usage into the run totals (SPECIALISTS-120).
   *
   * The dual-shape rule (per-message deltas vs cumulative counters) is owned by
   * `accumulateTokenUsage` and shared with the native path, so both runtimes reconcile
   * against Pi's session stats with the same arithmetic.
   *
   * Cost is summed plainly. Known ceiling: a provider that reported cumulative cost per
   * message would inflate this; none does today, and Pi's own usage totals have the same
   * assumption.
   */
  private _accumulateUsage(usage: SessionTokenUsage | undefined): void {
    if (!usage) return;
    this._summedUsage = accumulateTokenUsage(this._summedUsage, usage, this._summedUsageSeen);
  }

  /**
   * Persist one message's usage verbatim and accumulate the run totals.
   *
   * `message_end` is the single event per message that carries final usage, so it is the only
   * place the accumulator reads. The metric event is emitted per message so every observed
   * usage survives to the durable event stream (criterion 1), verbatim.
   */
  private _recordMessageUsage(message: Record<string, any> | undefined): void {
    const usage = normalizeTokenUsage(message?.usage);
    if (!usage) return;
    this._accumulateUsage(usage);
    this.options.onMetric?.({ type: 'token_usage', token_usage: usage, source: 'message_done' });
  }

  private _piVersionValue(): string | undefined {
    return this._piVersion ?? this.options.piVersion ?? resolvePiVersion();
  }

  /**
   * Capture Pi's terminal session totals at settlement (SPECIALISTS-120 criterion 3).
   *
   * EXPLICIT settlement step, deliberately NOT part of `waitForDone`: the run boundary and
   * the telemetry capture are different concerns and a caller may want the boundary without
   * the extra RPC. The runner calls this between `waitForDone()` and `close()`, so the
   * snapshot describes the run that just finished rather than an empty session, and it is
   * persisted before the Pi process exits.
   *
   * Bounded by `sessionStatsTimeoutMs`: a Pi that never answers costs the run that wait and
   * nothing more, and the failure is recorded as an explicit event instead of silently
   * producing a run with no session totals.
   *
   * Recorded on the live child ONLY when it is still reachable. A killed or exited process
   * cannot answer, and asking would burn the full timeout on every failed run.
   */
  async captureSessionStats(): Promise<void> {
    if (this._sessionStatsCaptured) return;
    this._sessionStatsCaptured = true;

    const timeoutMs = this.options.sessionStatsTimeoutMs ?? SESSION_STATS_TIMEOUT_MS;
    const record = (errorMessage: string): void => {
      this._sessionStatsError = errorMessage;
      this._metrics.session_stats_error = errorMessage;
      this.options.onMetric?.({ type: 'session_stats_error', errorMessage, timeoutMs, source: 'settlement' });
    };

    if (!this.proc?.stdin || !this.proc.stdin.writable) {
      record('pi process is not available to answer get_session_stats');
      return;
    }

    try {
      const response = await this.sendCommand({ type: 'get_session_stats' }, timeoutMs);
      const stats = normalizePiSessionStats(response?.data);
      if (!stats) {
        record('get_session_stats returned no usable session totals');
        return;
      }
      this._sessionStats = stats;
      this._metrics.session_stats = stats;
      this.options.onMetric?.({ type: 'session_stats', session_stats: stats, source: 'settlement' });
    } catch (error) {
      record(error instanceof Error ? error.message : String(error));
    }
  }

  private _handleEvent(line: string): void {
    let event: Record<string, any>;
    try { event = JSON.parse(line); } catch { return; }

    this._markActivity();
    const { type } = event;

    // ── RPC response (reply to a sendCommand call) ──────────────────────────
    if (type === 'response') {
      const id = event.id as number | undefined;
      if (id !== undefined) {
        const entry = this._pendingRequests.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          this._pendingRequests.delete(id);
          entry.resolve(event);
        }
      }
      return;
    }

    // ── Message boundaries (assistant/toolResult) + metadata ───────────────
    if (type === 'message_start') {
      const role = event.message?.role;
      if (role === 'assistant') {
        this.options.onEvent?.('message_start_assistant');
        const { provider, model } = event.message ?? {};
        if (provider || model) {
          this.options.onMeta?.({ backend: provider ?? '', model: model ?? '', sessionId: this.meta.sessionId });
        }
      } else if (role === 'toolResult') {
        this.options.onEvent?.('message_start_tool_result');
      }
      return;
    }

    if (type === 'message_end') {
      const role = event.message?.role;
      // SPECIALISTS-120: one capture point per message for the run totals. Pi's AgentMessage
      // carries final provider usage here, for assistant messages AND for tool-reported usage
      // on toolResult messages; both contribute to Pi's session totals, so both must be summed.
      if (role === 'assistant' || role === 'toolResult') this._recordMessageUsage(event.message);
      if (role === 'assistant') {
        const content = extractMessageTextContent(event.message);
        this.options.onEvent?.('message_end_assistant', content ? { content, charCount: content.length } : undefined);
      } else if (role === 'toolResult') {
        this.options.onEvent?.('message_end_tool_result');
      }
      return;
    }

    // ── Turn boundaries ─────────────────────────────────────────────────────
    if (type === 'turn_start') {
      this._metrics.turns = (this._metrics.turns ?? 0) + 1;
      this.options.onEvent?.('turn_start');
      return;
    }
    if (type === 'turn_end') {
      const tokenUsage = findTokenUsage(event);
      const finishReason = findFinishReason(event);
      this._updateTokenUsage(tokenUsage, 'turn_end');
      this._updateFinishReason(finishReason, 'turn_end');
      this.options.onMetric?.({
        type: 'turn_summary',
        turn_index: this._metrics.turns ?? 0,
        ...(tokenUsage ? { token_usage: tokenUsage } : {}),
        ...(finishReason ? { finish_reason: finishReason } : {}),
      });
      this.options.onEvent?.('turn_end');
      return;
    }

    // ── Completion ─────────────────────────────────────────────────────────
    if (type === 'agent_end') {
      const messages: any[] = event.messages ?? [];
      const last = [...messages].reverse().find((m: any) => m.role === 'assistant');
      if (last) {
        this._lastOutput = extractMessageTextContent(last);
      }

      this._updateTokenUsage(findTokenUsage(event), 'agent_end');
      this._updateFinishReason(findFinishReason(event), 'agent_end');
      const apiError = findApiErrorMessage(event) ?? this._apiError ?? extractApiErrorFromStderr(this._stderrBuffer);
      if (apiError) {
        this._apiError = apiError;
        this._metrics.api_error = apiError;
        this.options.onMetric?.({ type: 'api_error', source: 'stderr', errorMessage: apiError });
      }

      this._agentEndReceived = true;
      this._clearStallTimer();
      if (this._lastOutput) {
        this.options.onEvent?.('agent_end', { content: this._lastOutput, charCount: this._lastOutput.length });
      } else {
        this.options.onEvent?.('agent_end');
      }
      this._doneResolve?.();
      return;
    }

    // ── Tool execution (top-level per RPC docs) ────────────────────────────────
    if (type === 'tool_execution_start') {
      this._metrics.tool_calls = (this._metrics.tool_calls ?? 0) + 1;
      const toolName = event.toolName ?? event.name ?? 'tool';
      const toolArgs = event.args as Record<string, unknown> | undefined;
      const toolCallId = event.toolCallId as string | undefined;
      const command = toolName === 'bash' ? extractBashCommand(toolArgs) : undefined;
      if (command && isTestCommand(command)) {
        this._activateTestWindow(toolCallId);
        this._markActivity();
      }
      if (toolName === 'gitnexus_impact') {
        this._activateImpactWindow(toolCallId);
        this._markActivity();
      }
      this.options.onToolStart?.(
        toolName,
        toolArgs,
        toolCallId,
      );
      this.options.onEvent?.('tool_execution_start', { toolCallId });
      return;
    }
    if (type === 'tool_execution_update') {
      this.options.onEvent?.('tool_execution_update', { toolCallId: event.toolCallId as string | undefined });
      return;
    }
    if (type === 'tool_execution_end') {
      const toolName = event.toolName ?? event.name ?? 'tool';
      const toolCallId = event.toolCallId as string | undefined;
      this.options.onToolEnd?.(
        toolName,
        event.isError ?? false,
        toolCallId,
        findToolResultContent(event),
        findToolResultRaw(event),
      );
      if (toolName === 'bash') {
        this._deactivateTestWindow(toolCallId);
        this._markActivity();
      }
      if (toolName === 'gitnexus_impact') {
        this._deactivateImpactWindow(toolCallId);
        this._markActivity();
      }
      this.options.onEvent?.('tool_execution_end', { toolCallId });
      return;
    }

    // ── Auto-compaction / auto-retry lifecycle events ──────────────────────────
    // Pi 0.85.1 emits `compaction_start`/`compaction_end`; older builds emitted
    // `auto_compaction_*`. Both spellings are accepted so a compaction is never silently
    // missing from the timeline just because the Pi version changed (SPECIALISTS-120
    // criterion 2). The internal `auto_compaction_*` vocabulary is preserved for readers.
    if (type === 'auto_compaction_start' || type === 'auto_compaction_end'
      || type === 'compaction_start' || type === 'compaction_end') {
      const isEnd = type === 'auto_compaction_end' || type === 'compaction_end';
      const legacyType = isEnd ? 'auto_compaction_end' : 'auto_compaction_start';
      if (isEnd) {
        this._metrics.auto_compactions = (this._metrics.auto_compactions ?? 0) + 1;
      }
      // CompactionResult is nested under `result` in Pi's AgentSessionEvent and flattened in
      // older payloads; read both. `usage` is the summarization LLM call's usage, which counts
      // toward Pi's session totals but never appears on an assistant message.
      const result = (event.result && typeof event.result === 'object') ? event.result as Record<string, unknown> : undefined;
      const compactionUsage = normalizeTokenUsage(result?.usage ?? event.usage);
      if (isEnd) this._accumulateUsage(compactionUsage);
      const compactionDetails = {
        tokensBefore: asNumber(event.tokensBefore ?? event.tokens_before ?? result?.tokensBefore),
        estimatedTokensAfter: asNumber(event.estimatedTokensAfter ?? event.estimated_tokens_after ?? result?.estimatedTokensAfter),
        summary: findStringValue(result ?? event, ['summary']) ?? findStringValue(event, ['summary']),
        firstKeptEntryId: findStringValue(result ?? event, ['firstKeptEntryId', 'first_kept_entry_id']),
        ...(compactionUsage ? { token_usage: compactionUsage } : {}),
      };
      this.options.onMetric?.({
        type: 'compaction',
        phase: isEnd ? 'end' : 'start',
        ...compactionDetails,
      });
      this.options.onEvent?.(legacyType, compactionDetails);
      return;
    }
    if (type === 'auto_retry_start' || type === 'auto_retry_end') {
      if (type === 'auto_retry_end') {
        this._metrics.auto_retries = (this._metrics.auto_retries ?? 0) + 1;
      }
      const retryDetails = {
        attempt: asNumber(event.attempt),
        maxAttempts: asNumber(event.maxAttempts ?? event.max_attempts),
        delayMs: asNumber(event.delayMs ?? event.delay_ms),
        errorMessage: findStringValue(event, ['errorMessage', 'error_message', 'error']),
      };
      this.options.onMetric?.({
        type: 'retry',
        phase: type === 'auto_retry_start' ? 'start' : 'end',
        ...retryDetails,
      });
      this.options.onEvent?.(type, retryDetails);
      return;
    }

    if (type === 'set_model' || type === 'cycle_model') {
      const modelChange = {
        action: type,
        model: findStringValue(event, ['model', 'newModel', 'new_model']),
        previousModel: findStringValue(event, ['previousModel', 'previous_model', 'oldModel', 'old_model']),
      };
      this.options.onMetric?.({ type: 'model_change', ...modelChange });
      this.options.onEvent?.(type, modelChange);
      return;
    }

    if (type === 'extension_error') {
      const extensionError = {
        extension: findStringValue(event, ['extension', 'extensionName', 'name']),
        errorMessage: findStringValue(event, ['errorMessage', 'error_message', 'error']),
      };
      this.options.onMetric?.({ type: 'extension_error', ...extensionError });
      this.options.onEvent?.('extension_error', extensionError);
      return;
    }

    // ── message_update — all streaming deltas are nested here ─────────────────
    if (type === 'message_update') {
      const ae = event.assistantMessageEvent;
      if (!ae) return;
      switch (ae.type) {
        case 'text_delta': {
          const delta = typeof ae.delta === 'string' ? ae.delta : '';
          if (delta) this.options.onToken?.(delta);
          this.options.onEvent?.('text', { charCount: delta.length, content: delta });
          break;
        }
        case 'thinking_start':
          this.options.onEvent?.('thinking', { charCount: 0 });
          break;
        case 'thinking_delta': {
          const delta = typeof ae.delta === 'string' ? ae.delta : '';
          if (delta) this.options.onThinking?.(delta);
          this.options.onEvent?.('thinking', { charCount: delta.length });
          break;
        }
        case 'toolcall_start':
          // Tool name known at LLM construction time — set before execution events fire
          this.options.onToolStart?.(ae.name ?? ae.toolName ?? 'tool');
          this.options.onEvent?.('toolcall');
          break;
        case 'toolcall_end':
          this.options.onEvent?.('toolcall');
          break;
        case 'done': {
          // Message-level completion (distinct from run-level agent_end)
          const tokenUsage = findTokenUsage(ae);
          const finishReason = findFinishReason(ae);
          this._updateTokenUsage(tokenUsage, 'message_done');
          this._updateFinishReason(finishReason, 'message_done');
          this.options.onEvent?.('message_done');
          break;
        }
        case 'error': {
          const apiError = findApiErrorMessage(ae) ?? findApiErrorMessage(event);
          if (apiError) {
            this._apiError = apiError;
            this._metrics.api_error = apiError;
            this.options.onMetric?.({ type: 'api_error', source: 'rpc', errorMessage: apiError });
          }
          this.options.onEvent?.('message_error');
          break;
        }
      }
    }
  }

  /**
   * Send a JSON command to pi's stdin and return a promise for the response.
   * Each call is assigned a unique ID; concurrent calls are supported.
   */
  private sendCommand(cmd: Record<string, any>, timeoutMs = 30_000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin) {
        reject(new Error('No stdin available'));
        return;
      }
      const id = this._nextRequestId++;
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new Error(`RPC timeout: no response for command id=${id} after ${timeoutMs}ms`));
      }, timeoutMs);
      this._pendingRequests.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ ...cmd, id }) + '\n', (err) => {
        if (err) {
          const entry = this._pendingRequests.get(id);
          if (entry) {
            clearTimeout(entry.timer);
            this._pendingRequests.delete(id);
          }
          reject(err);
        }
      });
    });
  }

  /**
   * Write the prompt to pi's stdin and await the RPC ack.
   * Stdin is kept open for subsequent RPC commands.
   * Call waitForDone() to block until agent_end, then close() to terminate.
   */
  async prompt(task: string): Promise<void> {
    this._stallError = undefined;
    // A new turn re-arms settlement capture: each turn settles with its own session snapshot.
    this._sessionStatsCaptured = false;
    this._markActivity();
    const response = await this.sendCommand({ type: 'prompt', message: task });
    if (response?.success === false) {
      throw new Error(`Prompt rejected by pi: ${response.error ?? 'already streaming'}`);
    }
    // NOTE: stdin is intentionally NOT closed here. Call close() after waitForDone()
    // to allow sendCommand() RPC calls between prompt completion and teardown.
  }

  /**
   * Wait for the agent to finish. Optionally times out (throws Error on timeout).
   */
  async waitForDone(timeout?: number): Promise<void> {
    const donePromise = this._donePromise ?? Promise.resolve();
    if (!timeout) return donePromise;
    return Promise.race([
      donePromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`Specialist timed out after ${timeout}ms`)), timeout)
      ),
    ]);
  }

  /**
   * Get the last assistant output text. Tries RPC first, falls back to in-memory capture.
   */
  async getLastOutput(): Promise<string> {
    if (!this.proc?.stdin || !this.proc.stdin.writable) {
      return this._lastOutput;
    }
    try {
      const response = await Promise.race([
        this.sendCommand({ type: 'get_last_assistant_text' }),
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
      return response?.data?.text ?? this._lastOutput;
    } catch {
      return this._lastOutput;
    }
  }

  /**
   * Get current session state via RPC.
   */
  async getState(): Promise<any> {
    try {
      const response = await Promise.race([
        this.sendCommand({ type: 'get_state' }),
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
      return response?.data;
    } catch {
      return null;
    }
  }

  getMetrics(): SessionRunMetrics {
    // The summed side carries the run's accumulated cost; Pi's session-stats cost lands on
    // `session_stats.cost`. Comparing the two is the reconciliation (criterion 5).
    const summedUsage = this._summedUsage;
    const reconciliation = reconcileSessionUsage(summedUsage, this._sessionStats);
    const piVersion = this._piVersionValue();
    return {
      ...this._metrics,
      ...(this._metrics.token_usage ? { token_usage: { ...this._metrics.token_usage } } : {}),
      ...(summedUsage?.cost ? { cost: { ...summedUsage.cost } } : {}),
      ...(this._sessionStats ? { session_stats: this._sessionStats } : {}),
      ...(this._sessionStatsError ? { session_stats_error: this._sessionStatsError } : {}),
      ...(reconciliation ? { reconciliation } : {}),
      ...(piVersion ? { pi_version: piVersion } : {}),
    };
  }

  /**
   * Close the pi process cleanly by ending stdin (EOF) and waiting for exit.
   */
  async close(): Promise<void> {
    if (this._killed) return;
    this._clearStallTimer();
    // Send EOF to stdin - pi should exit after this
    this.proc?.stdin?.end();
    // Wait for the process to actually exit
    if (this.proc) {
      const proc = this.proc;
      await new Promise<void>((resolve) => {
        proc.on('close', () => resolve());
        // Pi's graceful shutdown can take ~4s per MCP server (transport.close()
        // does stdin.end → SIGTERM(2s) → SIGKILL(2s)). A redundant SIGTERM here
        // races pi's shutdown handler — pi sees `shuttingDown=true` and calls
        // process.exit() synchronously, aborting in-flight MCP cleanup and
        // orphaning MCP children. Wait long enough for graceful
        // close, then group-SIGKILL the whole subtree as a backstop.
        setTimeout(() => {
          if (proc.exitCode === null && proc.pid != null) {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* dead/missing group */ }
          }
          resolve();
        }, 8000);
      });
    }
  }

  // executeBash removed — pre/post scripts run locally in runner.ts via execSync,
  // not via pi RPC (pi has no bash command in its protocol).

  kill(reason?: Error): void {
    if (this._killed) return; // idempotent – second call (e.g. from finally) is a no-op
    this._killed = true;
    this._clearStallTimer();
    // Best-effort abort signal before SIGKILL
    if (this.proc?.stdin?.writable) {
      try { this.proc.stdin.write(JSON.stringify({ type: 'abort' }) + '\n'); } catch { /* ignore */ }
    }
    // Reject all pending RPC requests
    const killError = reason ?? this._stallError ?? new SessionKilledError();
    for (const [, entry] of this._pendingRequests) {
      clearTimeout(entry.timer);
      entry.reject(killError);
    }
    this._pendingRequests.clear();
    // Send graceful SIGTERM first so pi can dispose MCP servers cleanly.
    // Backstop: group-SIGKILL after 8s to reap any orphaned MCP children
    // (e.g. the gitnexus mcp) if pi hangs or aborts dispose mid-flight.
    const proc = this.proc;
    this.proc = undefined;
    proc?.kill();
    const pid = proc?.pid;
    if (pid != null) {
      setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL'); } catch { /* already dead */ }
      }, 8000).unref();
    }
    // Reject so waitForDone() can distinguish cancelled vs stalled vs backend failures
    this._doneReject?.(killError);
  }

  /** Returns accumulated stderr output from the pi process. */
  getStderr(): string {
    return this._stderrBuffer;
  }

  /**
   * Send a mid-run steering message to the Pi agent and await the RPC ack.
   * Pi delivers it after the current assistant turn finishes tool calls.
   */
  async steer(message: string): Promise<void> {
    if (this._killed || !this.proc?.stdin) {
      throw new Error('Session is not active');
    }
    const response = await this.sendCommand({ type: 'steer', message });
    if (response?.success === false) {
      throw new Error(`Steer rejected by pi: ${response.error ?? 'steer failed'}`);
    }
  }

  /**
   * Queue a follow_up on the Pi session using pi's native follow_up RPC command.
   * This is distinct from resume(): follow_up queues work during a still-running turn,
   * while resume() sends a next-turn prompt to a waiting (idle) session.
   *
   * Not yet implemented — reserved to prevent semantic drift with pi's native follow_up.
   */
  followUp(_task: string): never {
    throw new Error('followUp() is not yet implemented. Use resume() to send a next-turn prompt to a waiting session.');
  }

  /**
   * Start a new turn on the same Pi session (keep-alive multi-turn).
   * Resets done state and sends a new prompt — Pi retains full conversation history.
   * Only valid after waitForDone() has resolved for the previous turn.
   */
  async resume(task: string, timeout?: number): Promise<void> {
    if (this._killed || !this.proc?.stdin) {
      throw new Error('Session is not active');
    }
    // Reset done state for the new turn
    this._agentEndReceived = false;
    const donePromise = new Promise<void>((resolve, reject) => {
      this._doneResolve = resolve;
      this._doneReject = reject;
    });
    donePromise.catch(() => {});
    this._donePromise = donePromise;

    await this.prompt(task);
    await this.waitForDone(timeout);
  }
}
