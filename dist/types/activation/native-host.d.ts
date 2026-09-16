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
import { SpecialistLoader, type StallDetectionConfig } from '../specialist/loader.js';
import { type ResolvedToolContract } from '../specialist/resolved-tool-contract.js';
import { type SpecialistWorkItemBoundary } from './workitem-store.js';
import { type InteractionMessage, type PendingAsk } from './interaction.js';
import { PeerAdapter, type TransportForensicEvent } from './transport/peer-adapter.js';
import { type PiSdk, type PiAgentSessionEvent, type PiResourceLoaderLike } from './pi-sdk.js';
import { type SettlementStore } from './settlement-store.js';
import { type AuthorityWriter } from './authority-store.js';
import { type ActivationHandle, type ActivationRequest, type ActivationSnapshot, type LiveActivationStats, type WorkspaceIdentity } from './types.js';
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
export declare function isNonLocalExtensionSource(source: string): boolean;
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
export declare const defaultExtensionSourceResolutionEnv: ExtensionSourceResolutionEnv;
export declare function resolveNpmExtensionSource(source: string, env?: ExtensionSourceResolutionEnv): string | null;
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
export declare function resolveGitExtensionSource(source: string, env?: ExtensionSourceResolutionEnv): string | null;
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
export declare function expectedRemoteExtensionLabels(declaredSources: readonly string[], skippedSources: readonly string[]): string[];
/**
 * Message for a declared source the native path cannot load.
 *
 * Names the source AND the remedy, not merely the fact of skipping: the operator enabled
 * the source, so the message must say how to make it load (install it with pi so a local
 * form exists) or that removing the enablement stops the warning.
 */
export declare function formatSkippedExtensionSourceMessage(source: string): string;
/**
 * Split declared `execution.extensions` sources into the ones the in-process resource
 * loader can take and the ones it cannot. Local paths pass through untouched; `npm:`
 * sources are resolved to their installed directory when possible; `git:` sources are
 * resolved to pi's checkout cache (`<agentDir>/git/<spec>`) when the checkout exists;
 * everything else non-local (`http:`, `https:`, `ssh:`, uninstalled `npm:`, `git:` with
 * no checkout) is skipped.
 */
export declare function resolveDeclaredExtensionSources(sources: readonly string[], env?: ExtensionSourceResolutionEnv): {
    local: string[];
    skipped: string[];
};
/**
 * Sources whose provenance the discover-then-pin gate trusts (unitAI-1pqtl.2).
 *
 * The same trust rule the legacy CLI policy extension uses
 * (`config/pi-extensions/extension-tool-policy/index.mjs`): a tool whose registry entry
 * reports one of these sources was registered by extension code the operator enabled, not
 * by pi itself. Provenance ALONE does not prevent the collision — a shadowing name also
 * reports `cli` — so the builtin-collision refusal below is required as well.
 */
export declare const EXTENSION_CLASS_SOURCES: ReadonlySet<string>;
/** Registry sources that mark a tool as pi's own builtin, never pinnable.
 *
 * Version-drift note (R3.4b, no code change): these sets are static. If a future pi labels
 * a first-party tool with a source string outside `{builtin, sdk}` / `{cli, extension,
 * package, custom}`, the gates misread it — a builtin-looking name could pin, or every
 * dynamic activation could refuse on baseline/provenance. If dynamic activations start
 * refusing after a pi upgrade with "baseline registry" or "non-extension provenance"
 * notes, look here first and compare `getAllTools()` source strings against these sets.
 */
export declare const BUILTIN_TOOL_SOURCES: ReadonlySet<string>;
/** An `npm:` source that was declared enabled but resolved to nothing. Refused, not skipped. */
export declare function unresolvableNpmSources(skipped: readonly string[]): string[];
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
export declare function enumerateBuiltinToolNames(input: {
    sdk: PiSdk;
    cwd: string;
    agentDir: string;
    model: unknown;
}): Promise<string[]>;
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
export declare function discoverDynamicExtensionTools(input: {
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
}): Promise<DynamicExtensionDiscovery>;
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
export declare function resolveWorkspace(cwd: string): WorkspaceIdentity;
export declare function createActivationResourceLoader(sdk: PiSdk, options: {
    cwd: string;
    skillPaths: string[];
    extensionPaths?: string[];
}): PiResourceLoaderLike;
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
export declare const NULL_FORENSIC_SINK: ActivationForensicSink;
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
export declare class NativeActivationHost {
    private readonly loader;
    /** Injected boundary, or undefined to resolve the canonical store lazily. */
    private readonly workItemsInjected?;
    /** Lazily-opened canonical boundary; only touched when none was injected. */
    private workItemsDefault?;
    private readonly forensics;
    private readonly loadSdk;
    private readonly cwd;
    private readonly now;
    private readonly authority;
    private readonly settlements;
    /** Admission gate. Defaults to the real `validateBeforeRun`; see `NativeActivationHostDeps`. */
    private readonly admission;
    /** Guards the once-per-process settlement republish pass (SPECIALISTS-54). */
    private republished;
    private readonly env;
    private readonly registry;
    /**
     * Last per-message usage value seen per activation, keyed by live snapshot.
     * Feeds accumulateTokenUsage so delta-shape and cumulative-shape providers both
     * project monotonic totals. WeakMap: the entry dies with the snapshot, and resume
     * keeps the same snapshot so counters continue across attempts by construction.
     */
    private readonly lastUsageSeen;
    /**
     * Active tool_duration watches, keyed by ACTIVATION id (SPECIALISTS-102).
     *
     * Activation-keyed, never session-keyed: the fallback walk, retry() and resume()
     * all replace record.session under the SAME activation id, and none of those sites
     * touches this map — so a tool call spanning a replacement keeps its start time
     * and its warned flag and still warns AT MOST ONCE. Entries die on tool end, on
     * terminal settle (publishTerminalSettlement) and on stop(); the timer is unref'd
     * so a missed stop can never pin this long-lived process.
     */
    private readonly toolDurationWatch;
    /** Warn threshold fallback when an activation has no resolved entry; dep or shared default. */
    private readonly toolDurationWarnMs;
    /** Explicit host-level override; undefined when no dep was provided (spec applies). */
    private readonly toolDurationWarnMsByDep;
    /**
     * Per-activation warn threshold, resolved once at dispatch (SPECIALISTS-102
     * parity follow-up): explicit host dep > specialist spec > shared default.
     *
     * Lifetime follows the REGISTRY, not the watch: entries are set in start() and
     * deleted only in stop() (the sole registry.remove site), so retry()/resume()
     * legs — new attempts under the same activation id — keep the spec threshold
     * without re-resolving anything. A tool end clears the watch but never this.
     */
    private readonly toolDurationWarnMsByActivation;
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
    private readonly interactions;
    constructor(deps?: NativeActivationHostDeps);
    /**
     * Admit and start one activation.
     *
     * Every rejection below happens BEFORE an AgentSession exists, and each leaves forensic
     * evidence: a refused dispatch is still runtime evidence, and a dispatch that failed
     * silently is indistinguishable from one that never happened.
     */
    start(request: ActivationRequest): Promise<ActivationHandle>;
    /**
     * The shared work boundary for this host.
     *
     * Injected wins. Otherwise the canonical store opens lazily on first
     * dispatch: absent or unopenable refuses fail-closed (§10) — the runtime
     * never falls back to a second work authority. Opening runs the substrate
     * migrations, which are append-only and idempotent, so the first dispatch on
     * a machine whose store exists but predates a migration heals it.
     */
    private resolveWorkItems;
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
    private republishOncePerProcess;
    /**
     * Translate Pi session events into Specialists forensic events.
     *
     * `agent_end` is a per-turn boundary carrying `willRetry`; `agent_settled` is the
     * governed quiescence boundary. Conflating them is why a naive host disposes a child
     * that was merely pausing.
     */
    private onSessionEvent;
    /**
     * Record the start of one tool call for the tool_duration checker (SPECIALISTS-102).
     *
     * A repeat start for the SAME in-flight call (streaming duplicate) keeps its original
     * start time and warned flag; a genuinely new call replaces the dead one. The poll
     * timer is per activation and is created lazily, so tool-less activations never tick.
     */
    private noteToolStart;
    /** Clear the watch when the tool call ends; a stray end never kills a live call. */
    private noteToolEnd;
    /**
     * One checker tick: warn at most once per tool call (SPECIALISTS-102).
     *
     * Attempt attribution is read LIVE from the registry, never closed over at subscribe
     * time, and the watch is keyed to the activation — so a call spanning a fallback,
     * retry or resume replacement still warns exactly once, under the current attempt.
     * Driven by the interval in production and directly (with the injected clock) in tests.
     */
    private checkToolDuration;
    /** Clear the poll timer and drop the watch. Idempotent; safe on every exit path. */
    private stopToolDurationWatch;
    private runToSettled;
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
    private publishTerminalSettlement;
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
    private runWithFallback;
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
    retry(activationId: string, opts?: {
        modelOverride?: string;
        prompt?: string;
    }): Promise<ActivationHandle>;
    /**
     * Answer an outstanding ask, resuming the child inside its existing tool call.
     *
     * The answer returns as that tool's result, so the SAME AgentSession continues with its
     * context intact. Correlation is by `messageId`; there is deliberately no "answer the
     * latest ask" convenience, because with two asks outstanding that is a coin flip.
     */
    answer(messageId: string, body: string): Promise<InteractionMessage | undefined>;
    /**
     * Mirror one snapshot to the Substrate authority. Best-effort twice over: the
     * writer swallows its own errors, and this guards the call, because a store
     * failure must never alter activation behaviour.
     */
    private save;
    /**
     * Mirror disposal to the authority: the row goes with the activation, so
     * SessionStart never surfaces stopped work as live. Guarded like `save`.
     */
    private forget;
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
    private releaseIfWriter;
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
    admitToolCall(activationId: string, toolName: string): {
        allow: boolean;
        reason?: string;
    };
    /** Every outstanding ask across the Fleet, oldest first. */
    pendingAsks(): PendingAsk[];
    /** Current state of one activation, or undefined if unknown to this host. */
    inspect(activationId: string): ActivationSnapshot | undefined;
    /**
     * Live per-activation stats over existing in-memory state: one Map read plus
     * arithmetic, never an observability.db query, so the 1s widget tick stays cheap.
     */
    liveStats(activationId: string): LiveActivationStats | undefined;
    /**
     * Build the delivery hook for a configured coordinator.
     *
     * Called from the constructor, so it must not read any field the constructor has not yet
     * assigned — `repoRoot` is taken from the config or from `deps.cwd` directly rather than
     * from `this.cwd`, which is set on the line above but would be a trap to depend on if the
     * order ever changed.
     */
    private wirePeerDelivery;
    /** The Fleet projection: every activation this process knows about, transport-neutral. */
    list(): ActivationSnapshot[];
    /**
     * Explicitly stop and dispose an activation.
     *
     * This is the only ordinary path to disposal — settling is not one.
     */
    stop(activationId: string, reason?: string): Promise<void>;
    /**
     * Attach a listener to a live activation's event stream without perturbing its turn.
     *
     * Subscribing is additive — `PiAgentSessionLike.subscribe` fans out to every listener —
     * so an attached observer (a Fleet view, a follow MCP call) never displaces the host's
     * own lifecycle subscription or any other attachment on the same activation.
     */
    attach(activationId: string, listener: (event: PiAgentSessionEvent) => void): ActivationAttachment | undefined;
    /** Release an attachment. Symmetric with `attach`; the activation itself is unaffected. */
    return(attachment: ActivationAttachment): void;
    /**
     * Resume a settled or waiting activation with a new prompt.
     *
     * Keeps `activationId` and advances `attemptId` — a resume is never a second activation.
     * The host's own lifecycle listener is re-subscribed so forensics for the new attempt
     * carry the new `attemptId` rather than the one closed over at `start()`.
     */
    resume(activationId: string, prompt: string): Promise<ActivationHandle>;
}
/** Render a structured work contract back to the 7-section layout the prompt surface reads. */
export declare function contractToMarkdown(contract: unknown): string;
/**
 * SPECIALISTS-52: `beads_integration` and `beads_write_notes` are read only by the legacy sp
 * CLI. At their defaults they are noise on every spec; a non-default value is a user's intent
 * that this runtime cannot honour, so it is named rather than dropped.
 */
export declare function legacyOnlyConfigNotes(spec: {
    beads_integration?: string;
    beads_write_notes?: boolean;
}): string[];
//# sourceMappingURL=native-host.d.ts.map