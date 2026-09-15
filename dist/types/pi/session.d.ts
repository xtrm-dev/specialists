export declare class SessionKilledError extends Error {
    constructor();
}
export declare class StallTimeoutError extends Error {
    constructor(timeoutMs: number);
}
import { type ManifestPolicy } from '../specialist/manifest-resolver.js';
import { type ResolvedToolContract } from '../specialist/resolved-tool-contract.js';
import { type ToolCatalogIndex } from '../specialist/tool-catalog.js';
export interface AgentSessionMeta {
    backend: string;
    model: string;
    sessionId: string;
    startedAt: Date;
}
export interface SessionTokenUsage {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_tokens?: number;
    cache_read_tokens?: number;
    reasoning_tokens?: number;
    tool_tokens?: number;
    total_tokens?: number;
    usage_source?: 'provider_usage' | 'runtime_estimate' | 'local_estimate' | 'unknown';
}
export interface SessionRunMetrics {
    token_usage?: SessionTokenUsage;
    finish_reason?: string;
    exit_reason?: string;
    turns?: number;
    tool_calls?: number;
    tool_call_names?: string[];
    auto_compactions?: number;
    auto_retries?: number;
    api_error?: string;
}
export type SessionMetricEvent = {
    type: 'token_usage';
    token_usage: SessionTokenUsage;
    source: 'message_done' | 'turn_end' | 'agent_end';
} | {
    type: 'finish_reason';
    finish_reason: string;
    source: 'message_done' | 'turn_end' | 'agent_end';
} | {
    type: 'turn_summary';
    turn_index: number;
    token_usage?: SessionTokenUsage;
    finish_reason?: string;
} | {
    type: 'compaction';
    phase: 'start' | 'end';
    tokensBefore?: number;
    summary?: string;
    firstKeptEntryId?: string;
} | {
    type: 'retry';
    phase: 'start' | 'end';
    attempt?: number;
    maxAttempts?: number;
    delayMs?: number;
    errorMessage?: string;
} | {
    type: 'model_change';
    action: 'set_model' | 'cycle_model';
    model?: string;
    previousModel?: string;
} | {
    type: 'extension_error';
    extension?: string;
    errorMessage?: string;
} | {
    type: 'api_error';
    source: 'rpc' | 'stderr';
    errorMessage: string;
};
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
    onEvent?: (type: string, details?: {
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
    }) => void;
    /** Called with additive observability metrics derived from RPC events */
    onMetric?: (event: SessionMetricEvent) => void;
    /** Called once with actual backend/model from the first assistant message_start */
    onMeta?: (meta: {
        backend: string;
        model: string;
        sessionId?: string;
    }) => void;
    /** Kill and fail if no streaming/protocol activity occurs within this window */
    stallTimeoutMs?: number;
    /** Extended stall timeout used while known test commands run via bash tool */
    testCommandStallTimeoutMs?: number;
}
export declare const RUNTIME_TOOL_CATALOG_ERROR_MESSAGE = "Runtime tool catalog unavailable or invalid; refusing to launch with Pi default tools. Reinstall or rebuild Specialists and verify config/catalog/index.json.";
export type RuntimeToolCatalogErrorReason = 'invalid_permission_tier' | 'project_catalog_invalid' | 'canonical_catalog_unavailable' | 'canonical_catalog_invalid' | 'tool_contract_invalid' | 'empty_tool_contract';
export declare class RuntimeToolCatalogResolutionError extends Error {
    readonly reason: RuntimeToolCatalogErrorReason;
    readonly code = "runtime_tool_catalog_unavailable";
    constructor(reason: RuntimeToolCatalogErrorReason);
}
/**
 * Exported so the doctor reports the SAME catalog the runtime resolves (SPECIALISTS-42 (d)).
 * A second resolution rule is how two resolvers came to disagree about the store path before
 * (SPECIALISTS-3); a doctor that inspects a different catalog than the runtime loads would be
 * the same defect wearing a diagnostic hat.
 */
export declare function loadSharedToolCatalogIndex(cwd: string): ToolCatalogIndex;
/**
 * The runtime's own package.json version read, exported so the doctor reports the SAME installed
 * version the gate compares (SPECIALISTS-42 (d) review). A second inline lookup in doctor.ts was
 * identical today, but identical-today is how two resolvers come to disagree tomorrow — the
 * doctor would then describe a version the gate never saw, which is the defect this issue is
 * about wearing a diagnostic hat.
 */
export declare function readPackageVersion(packageJsonPath: string): string | undefined;
export declare function resolveRuntimeToolContract(options: {
    level?: string;
    specialistName?: string;
    specialistPermissions?: ManifestPolicy['permissions'];
    excludeExtensions?: readonly string[];
    extensionSources?: readonly string[];
    cwd?: string;
}): ResolvedToolContract | undefined;
export declare function resolvePermissionTools(options: {
    level?: string;
    specialistName?: string;
    specialistPermissions?: ManifestPolicy['permissions'];
    excludeExtensions?: readonly string[];
    extensionSources?: readonly string[];
    cwd?: string;
}): string | undefined;
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
export declare function applyExtensionToolPolicyGate(args: string[], contract: ResolvedToolContract | undefined, env: Record<string, string>): void;
export declare function deduplicateExtensionSources(autoInjected: readonly string[], dynamicSources: readonly string[]): {
    kept: string[];
    dropped: Array<{
        dropped: string;
        keptAs: string;
    }>;
};
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
export declare function sessionResourceFenceArgv(): {
    head: string[];
    tail: string[];
};
/**
 * Which of the five discovery fences a session argv actually disables.
 *
 * The inverse of `sessionResourceFenceArgv`: a present flag means the fence is DISABLED,
 * which is the direction the native resource loader expresses directly (`noSkills: true`).
 * Unknown flags are ignored, so this can be handed a whole session argv.
 */
export declare function parseSessionResourceFence(argv: readonly string[]): {
    noSkills: boolean;
    noExtensions: boolean;
    noContextFiles: boolean;
    noPromptTemplates: boolean;
    noThemes: boolean;
};
export declare function resolveExecutionExtensionSelection(extensions: Readonly<Record<string, boolean | null | undefined>> | undefined): {
    excludeExtensions: string[];
    extensionSources: string[];
    offline: boolean;
};
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
export declare function resolveCuratedExtensionPaths(options: {
    permissionLevel?: string;
    resolvedToolContract?: ResolvedToolContract;
}): CuratedExtensionResolution;
export declare function resolveGlobalNodeModulesDir(): string | undefined;
export declare function validateWriteToolPathAgainstBoundary(toolName: string, toolArgs: Record<string, unknown> | undefined, worktreeBoundary: string | undefined): string | undefined;
export declare class PiAgentSession {
    private options;
    private proc?;
    private _lastOutput;
    private _donePromise?;
    private _doneResolve?;
    private _doneReject?;
    private _agentEndReceived;
    private _killed;
    private _lineBuffer;
    private _pendingRequests;
    private _nextRequestId;
    private _stderrBuffer;
    private _apiError?;
    private _stallTimer?;
    private _stallError?;
    private _testWindowToolCallIds;
    private _testWindowWithoutIdCount;
    private _impactWindowToolCallIds;
    private _impactWindowWithoutIdCount;
    private _metrics;
    readonly meta: AgentSessionMeta;
    private constructor();
    static create(options: PiSessionOptions): Promise<PiAgentSession>;
    start(): Promise<void>;
    private _clearStallTimer;
    private _isTestWindowActive;
    private _isImpactWindowActive;
    private _resolveStallTimeoutMs;
    private _activateTestWindow;
    private _deactivateTestWindow;
    private _activateImpactWindow;
    private _deactivateImpactWindow;
    private _markActivity;
    private _updateTokenUsage;
    private _updateFinishReason;
    private _handleEvent;
    /**
     * Send a JSON command to pi's stdin and return a promise for the response.
     * Each call is assigned a unique ID; concurrent calls are supported.
     */
    private sendCommand;
    /**
     * Write the prompt to pi's stdin and await the RPC ack.
     * Stdin is kept open for subsequent RPC commands.
     * Call waitForDone() to block until agent_end, then close() to terminate.
     */
    prompt(task: string): Promise<void>;
    /**
     * Wait for the agent to finish. Optionally times out (throws Error on timeout).
     */
    waitForDone(timeout?: number): Promise<void>;
    /**
     * Get the last assistant output text. Tries RPC first, falls back to in-memory capture.
     */
    getLastOutput(): Promise<string>;
    /**
     * Get current session state via RPC.
     */
    getState(): Promise<any>;
    getMetrics(): SessionRunMetrics;
    /**
     * Close the pi process cleanly by ending stdin (EOF) and waiting for exit.
     */
    close(): Promise<void>;
    kill(reason?: Error): void;
    /** Returns accumulated stderr output from the pi process. */
    getStderr(): string;
    /**
     * Send a mid-run steering message to the Pi agent and await the RPC ack.
     * Pi delivers it after the current assistant turn finishes tool calls.
     */
    steer(message: string): Promise<void>;
    /**
     * Queue a follow_up on the Pi session using pi's native follow_up RPC command.
     * This is distinct from resume(): follow_up queues work during a still-running turn,
     * while resume() sends a next-turn prompt to a waiting (idle) session.
     *
     * Not yet implemented — reserved to prevent semantic drift with pi's native follow_up.
     */
    followUp(_task: string): never;
    /**
     * Start a new turn on the same Pi session (keep-alive multi-turn).
     * Resets done state and sends a new prompt — Pi retains full conversation history.
     * Only valid after waitForDone() has resolved for the previous turn.
     */
    resume(task: string, timeout?: number): Promise<void>;
}
//# sourceMappingURL=session.d.ts.map