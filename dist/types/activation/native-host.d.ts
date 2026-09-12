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
import { SpecialistLoader } from '../specialist/loader.js';
import { type SpecialistWorkItemBoundary } from './workitem-store.js';
import { type InteractionMessage, type PendingAsk } from './interaction.js';
import { PeerAdapter, type TransportForensicEvent } from './transport/peer-adapter.js';
import { type PiSdk, type PiAgentSessionEvent, type PiResourceLoaderLike } from './pi-sdk.js';
import { type AuthorityWriter } from './authority-store.js';
import { type ActivationHandle, type ActivationRequest, type ActivationSnapshot, type LiveActivationStats, type WorkspaceIdentity } from './types.js';
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
    private readonly registry;
    /**
     * Last per-message usage value seen per activation, keyed by live snapshot.
     * Feeds accumulateTokenUsage so delta-shape and cumulative-shape providers both
     * project monotonic totals. WeakMap: the entry dies with the snapshot, and resume
     * keeps the same snapshot so counters continue across attempts by construction.
     */
    private readonly lastUsageSeen;
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
     * Translate Pi session events into Specialists forensic events.
     *
     * `agent_end` is a per-turn boundary carrying `willRetry`; `agent_settled` is the
     * governed quiescence boundary. Conflating them is why a naive host disposes a child
     * that was merely pausing.
     */
    private onSessionEvent;
    private runToSettled;
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
//# sourceMappingURL=native-host.d.ts.map