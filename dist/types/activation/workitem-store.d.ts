import type { DatabaseSync } from 'node:sqlite';
/**
 * Where Substrate lives, in precedence order: an explicit checkout, then normal
 * module resolution, then nowhere.
 *
 * The explicit path wins deliberately. A developer who points
 * XTRM_SUBSTRATE_DIR at a working tree means it, and an installed copy silently
 * shadowing that checkout would make local Substrate changes untestable from
 * here — the exact confusion the variable exists to avoid.
 *
 * Module resolution is what makes the plugin work for someone who installed it
 * from npm and has never heard of the Substrate repository. Before it existed,
 * dispatch was unavailable to every such user (XTRM-267).
 */
/**
 * Where Substrate lives, in precedence order: an explicit checkout, then an injected or
 * installed resolution, then normal module resolution, then nowhere.
 *
 * `resolveInstalled` is the overridable-for-testing seam (unitAI-7co1i, landed on master as
 * PR #349): a test can STATE "nothing is installed" instead of depending on the machine not
 * having the package. It defaults to the real module resolution below and is never supplied in
 * production. SPECIALISTS-24 fixed the same defect independently with an equivalent seam under
 * a different name; that duplicate was dropped when this branch merged master, so exactly one
 * seam remains.
 *
 * MEASURED (closeout §3), because the answer is counter-intuitive and it decides the install
 * contract. Typical module resolution is NOT sufficient for the XTRM-managed layout:
 *
 *   - Core's `xt init` enrolls Substrate with `npm install --global <checkout>`. On npm 7+ a
 *     folder install is a SYMLINK, so `<prefix>/lib/node_modules/@jaggerxtrm/substrate` points at
 *     the checkout and `<prefix>/lib/node_modules/@jaggerxtrm/specialists` points at the
 *     Specialists checkout.
 *   - Default resolution dereferences the Specialists symlink and walks the ancestors of the
 *     CHECKOUT, not of the prefix. Measured on a synthetic prefix with a symlinked Specialists
 *     checkout that carries no local Substrate: plain `require.resolve` FAILS under node. (Under
 *     bun it appeared to succeed, but resolved Bun's own install cache, which is an artifact of
 *     this machine and not the npm global layout.)
 *   - A TARBALL/registry global install is a real directory and DOES resolve by the ancestor walk,
 *     which is why the failure is invisible to anyone whose Specialists install is not a folder
 *     link — the exact shape Core produces.
 *
 * So the npm prefix is tried explicitly as a FALLBACK, after normal resolution, via
 * `resolve(spec, { paths: [<prefix>/lib] })` — measured to find the real checkout behind the
 * global symlink under BOTH node and bun where plain resolution failed. Precedence is unchanged:
 * an explicit checkout, then the injected seam, then ordinary resolution, then the prefix.
 */
export declare function resolveSubstrateDir(explicit: string, resolveInstalled?: () => string | null): string | null;
/**
 * Substrate installed under an npm-style global prefix, which the ancestor walk cannot reach
 * through a symlinked Specialists install. See the measurement note on `resolveSubstrateDir`.
 *
 * Each candidate is a `<prefix>/lib` directory, because `resolve(spec, { paths })` appends
 * `node_modules` itself. Deduplicated and existence-checked so a candidate that cannot possibly
 * hold the package costs nothing.
 */
export declare function resolveSubstrateFromGlobalPrefix(libDirs?: readonly string[]): string | null;
/**
 * The store path every path that opens the work store uses.
 *
 * This is a DELEGATION, not a second precedence rule. It used to resolve only
 * `XTRM_STATE_DB`, so an operator who set `SUBSTRATE_DB` — the owner-defined variable
 * README.md and the supervising-activations skill tell them to use — got Substrate
 * services and forensics on one database and dispatch on another, silently, because the
 * test suite pinned the correct precedence only for the resolver that was NOT on the
 * dispatch path (SPECIALISTS-3). One rule, one home.
 */
export declare function resolveWorkItemDbPath(env?: NodeJS.ProcessEnv): string;
/**
 * Open a SQLite database behind the DatabaseSync surface the work services use.
 *
 * bun:sqlite first (bun 1.3.14 has no node:sqlite), node:sqlite fallback for
 * non-bun runtimes — the same dual-driver discipline authority-store.ts applies
 * to the same file. bun binds undefined as NULL where node:sqlite refuses it,
 * so params are normalized where the two disagree; nothing else differs on the
 * prepare/exec/close surface. Opening a database is generic sqlite work and
 * carries no Substrate code.
 *
 * SPECIALISTS-59: each driver attempt is recorded rather than discarded. The
 * `node:sqlite` require used to sit OUTSIDE a try, so on bun — where that built-in does not
 * exist — a genuine open failure (a missing parent directory is the usual cause) was replaced
 * by the module-resolution error `ResolveMessage: No such built-in module: node:sqlite`. That
 * string names neither the store nor a remedy, and it escaped the caller's normalized
 * `work_item_store_unavailable` refusal. Reachable on any host whose HOME has no `.xtrm`
 * directory: containers, service accounts, systemd units, sudo with a different HOME.
 */
export declare function openSubstrateDb(dbPath: string): DatabaseSync;
/** One resolved issue revision, flattened for the admission and render surface. */
export interface WorkItemView {
    ref: string;
    issueId: string;
    revision: number;
    contractHash: string;
    title: string;
    contract: unknown;
    readinessState: string;
    dispatchable: boolean;
    reasons: string[];
}
/** Epic lineage hop: whatever the prompt renderer needs from an ancestor issue. */
export interface EpicAncestor {
    ref: string;
    title: string;
    description?: string;
}
/** One active `blocks`-edge source, flattened for the dependency-context renderer. */
export interface BlockerIssue {
    id: string;
    humanRef: string;
    title: string;
    currentRevision: number;
    lifecycleState: string;
}
/** Result of an inline-contract dispatch (§10): the created issue's identity. */
export interface InlineIssueResult {
    ref: string;
    issueId: string;
    claimId: number | null;
}
/**
 * Dispatch request carried across the seam. Extra producer-specific fields may
 * ride along; the consumer only reads ref/holder/claim/activation identity.
 */
export interface DispatchRequest {
    ref: string;
    holder: string;
    specialist?: string;
    claimId?: number | null;
    activationId?: string | null;
    attemptId?: string | null;
    sessionId?: string | null;
    workspace?: unknown;
    baseCommit?: string | null;
    [key: string]: unknown;
}
/** Structural projection of the producer's ExecutionBinding — the fields the host pins. */
export interface ExecutionBindingView {
    id: string;
    issueId: string;
    issueRevision: number;
    contractHash: string;
    claimId: number | null;
    [key: string]: unknown;
}
/** Readiness + binding outcome for the admission path. */
export interface BindResult {
    check: {
        issueId: string;
        revision: number;
        contractHash: string;
        report: unknown;
    };
    binding: ExecutionBindingView;
}
/** Read-only dispatch gate outcome (§49 ordering: check before any mutation). */
export interface CheckResult {
    issueId: string;
    revision: number;
    contractHash: string;
    report: unknown;
}
/**
 * S1 settlement input: the bounded Journal `result` publication (ADR §39).
 *
 * Field-for-field the Substrate ResultPayload shape plus the shared X1
envelope, mirrored structurally so this module keeps no static dependency on
 * producer code. Substrate validates every field fail-closed on write; an
 * oversized summary is rejected there, which is why the host bounds BEFORE
 * calling (see settlement-publication.ts).
 */
export interface SettlementResultInput {
    result: {
        summary: string;
        resultVersion?: number;
        attempted?: string;
        outcome?: string;
        completed?: string[];
        validation?: string[];
        findings?: string[];
        artifactRefs?: string[];
        receiptRefs?: string[];
        provenanceRefs?: string[];
    };
    executionContext?: unknown;
    refs?: Array<{
        kind: string;
        key: string;
        value?: unknown;
    }>;
    participantId?: string;
    activationId?: string;
    sessionId?: string;
}
/** Structural projection of the producer's WorkReceipt — the fields the host pins. */
export interface WorkReceiptView {
    id: string;
    executionBindingId: string;
    issueId: string;
    issueRevision: number;
    contractHash: string;
    [key: string]: unknown;
}
/** Structural projection of one producer artifact binding. */
export interface SettlementArtifactView {
    receiptId: string;
    kind: string;
    value: string;
    [key: string]: unknown;
}
/**
 * The consumer-side work boundary (ADR §8-§12).
 *
 * `check` is the fail-closed read-only gate (draft/unready/blocked/terminal/
 * scope-expansion refuse before anything is created); `bind` performs the
 * mutation at activation start, pinning the immutable ExecutionBinding over
 * issue/revision/hash/claim/participant/activation/attempt/session/workspace
 * (§9). `inlineCreate` implements §10 — an inline contract becomes a real
 * Substrate Issue through structural validation, creation, attestation and
 * claim; there is no bd subprocess and no hidden temporary work item on any
 * path in this module.
 */
export interface SpecialistWorkItemBoundary {
    view(ref: string): WorkItemView;
    epicAncestors(ref: string, depth: number): EpicAncestor[];
    /**
     * Completed `blocks`-edge sources, up to `depth` hops, as dependency context for the
     * turn-1 prompt. The Substrate edge graph through this boundary is the ONE traversal —
     * the host never queries the store or walks edges itself (SPECIALISTS-22).
     */
    completedBlockers(ref: string, depth: number): EpicAncestor[];
    check(req: DispatchRequest): CheckResult;
    bind(req: DispatchRequest): ExecutionBindingView;
    inlineCreate(contract: string, opts?: {
        title?: string;
        holder?: string;
        activationId?: string;
    }): InlineIssueResult;
    /**
     * Release the claim an inline contract took, so a refused inline dispatch leaves an issue that is
     * immediately re-dispatchable rather than one locked by an activation that never ran
     * (SPECIALISTS-53). Returns false when there is no live claim or the boundary cannot release.
     * Optional for the same reason as the port method: the boundary is structural and test doubles
     * predate it.
     */
    releaseInlineClaim?(ref: string, opts?: {
        activationId?: string;
    }): boolean;
    journal(ref: string, kind: string, opts?: {
        participantId?: string;
        activationId?: string;
    }): void;
    /**
     * S1 settlement surface (ADR §§38–39). Optional so existing fakes keep
     * compiling; the host degrades to store-only publication when absent.
     * `appendResult` writes the bounded Journal `result` with the X1 envelope;
     * `allocateReceipt` mints the WorkReceipt over a live ExecutionBinding
     * (revision/hash copied host-side, never from model output); `attachArtifact`
     * links a non-commit artifact (the runtime result ref) to the receipt.
     * Commits are never attached here — zero-commit results publish identically.
     */
    appendResult?(ref: string, input: SettlementResultInput): {
        entryId: string;
        sequence: number;
    };
    allocateReceipt?(bindingId: string): WorkReceiptView;
    attachArtifact?(receiptId: string, kind: string, value: string): SettlementArtifactView;
    /**
     * Reconciliation reads (SPECIALISTS-54). A republish has to prove it is the FIRST publication
     * of (activation, attempt) before it writes anything, because neither the receipt nor the
     * Journal append is idempotent.
     *
     * TRI-STATE, deliberately. Collapsing "no receipt exists" and "this boundary cannot tell me"
     * into one falsy answer is how a republish mints a SECOND receipt: the caller cannot
     * distinguish a proven absence from an unanswerable question, and defaults to the safe-looking
     * "absent". Optional for the same reason as the writers: a boundary without them defers.
     */
    findResultEntry?(ref: string, key: {
        activationId: string;
        attemptId: string;
    }): SettlementLookup<{
        entryId: string;
    }>;
    /** The receipt already allocated over a binding, if any. One receipt per binding is the rule. */
    findReceiptForBinding?(ref: string, bindingId: string): SettlementLookup<{
        receiptId: string;
    }>;
}
/**
 * The answer to "did this already land?".
 *
 * `absent` is a PROOF that nothing was written; `unavailable` is the absence of a proof. Only
 * `absent` licenses a write.
 */
export type SettlementLookup<T> = {
    status: 'found';
    value: T;
} | {
    status: 'absent';
} | {
    status: 'unavailable';
    reason: string;
};
/** Structural view of the producer's active claim — the only claim fields the seam reads. */
export interface ActiveClaimView {
    id: number;
    holder: string;
    activationId: string | null;
}
/** Structural port over the producer's issue service. Implemented by fakes in public tests. */
export interface IssueServicePort {
    resolveRef(ref: string): {
        id: string;
        humanRef: string;
    };
    getActiveClaim(issueId: string): ActiveClaimView | null;
    /**
     * Release a live claim (SPECIALISTS-53). Optional because this port is structural and several
     * public-test doubles predate it; a double that omits it has no claim to release. The real
     * service implements it (substrate issue-service `releaseClaim`).
     */
    releaseClaim?(issueId: string, holder: string, opts?: {
        activationId?: string;
    }): {
        id: number;
    } | null;
    getParent(childId: string): {
        id: string;
        humanRef: string;
        title: string;
        currentRevision: number;
    } | null;
    /**
     * Every ACTIVE `blocks` edge whose target is `childId`, resolved to its sources. Optional
     * so an existing in-memory fake keeps compiling; absent means "no blocker information",
     * never "no blockers".
     */
    getBlockers?(childId: string): BlockerIssue[];
    getRevision(issueId: string, revision: number): {
        contract: unknown;
    };
    resolveProject(opts: {
        gitRoot: string;
    }): {
        projectId: string;
    };
    createIssue(input: {
        projectId: string;
        title: string;
        kind: string;
        contract: unknown;
        scrutiny: string;
        authoredBy: string;
    }): {
        id: string;
    };
    claimReady(issueId: string, holder: string, attestation: {
        outcome: string;
        policy: string;
        attestedBy: string;
    }, opts?: {
        activationId?: string;
    }): {
        claim: {
            id: number;
        };
    };
}
/** Structural port over the producer's issue store (read + journal). */
export interface IssueStorePort {
    get(ref: string): {
        issue: {
            humanRef: string;
            id: string;
            currentRevision: number;
            currentContractHash: string;
            title: string;
        };
        contract: unknown;
        readinessState: string;
        dispatchable: boolean;
        reasons: string[];
    };
    addJournal(ref: string, kind: string, opts?: {
        participantId?: string;
        activationId?: string;
    }): void;
}
/** Structural port over the producer's dispatch gate (check + bind mutation). */
export interface DispatchGatePort {
    check(issues: unknown, req: DispatchRequest): {
        issueId: string;
        revision: number;
        contractHash: string;
        report: unknown;
    };
    dispatch(issues: unknown, provenance: unknown, req: DispatchRequest): {
        binding: ExecutionBindingView;
    };
}
/** Structural port over the producer's journal service (S1 result publication). */
export interface JournalServicePort {
    appendEntry(issueId: string, input: {
        kind: string;
        result?: unknown;
        executionContext?: unknown;
        refs?: Array<{
            kind: string;
            key: string;
            value?: unknown;
        }>;
        participantId?: string;
        activationId?: string;
        sessionId?: string;
    }): {
        id: string;
        sequence: number;
    };
    /** Existing entries, for the settlement reconciliation read (SPECIALISTS-54). */
    listEntries?(issueId: string, opts?: {
        kind?: string;
        limit?: number;
    }): Array<{
        id: string;
        kind?: string;
        activationId?: string | null;
        /**
         * NOT a producer field. `issue_journal` has no attempt column (substrate
         * src/domain/journal.ts:193-211), so the real entry never carries this — it is declared only so
         * a fake can supply it. The ATTEMPT identity that does exist is
         * `executionContext.specialist.attemptId`, which is why matching reads that.
         */
        attemptId?: string | null;
        executionContext?: {
            specialist?: {
                attemptId?: string | null;
            } | null;
        } | null;
    }>;
}
/** Structural port over the producer's provenance service (S1 receipt publication). */
export interface ProvenanceServicePort {
    allocateReceipt(bindingId: string): {
        id: string;
        executionBindingId: string;
        issueId: string;
        issueRevision: number;
        contractHash: string;
    };
    attachArtifact(receiptId: string, kind: string, value: string): {
        receiptId?: string;
        kind?: string;
        value?: string;
    };
    /** Receipts already allocated for an issue, for the reconciliation read (SPECIALISTS-54). */
    listReceipts?(issueId: string): Array<{
        id: string;
        executionBindingId: string;
    }>;
}
/** The injected ports `createWorkItemBoundary` programs against. */
export interface WorkItemPorts {
    issues: IssueServicePort;
    provenance: unknown;
    store: IssueStorePort;
    gate: DispatchGatePort;
    /**
     * S1 settlement services. Optional so the private integration job can wire
     * them independently of the dispatch ports; absent means the boundary
     * carries no settlement surface and the host stores results only.
     */
    journalService?: JournalServicePort;
    provenanceService?: ProvenanceServicePort;
}
/**
 * Build the consumer boundary over injected producer ports.
 *
 * Public unit tests inject fakes; the private integration job injects the real
 * Substrate services; `openWorkItemBoundary` injects them via runtime dynamic
 * import. No path here statically imports producer code.
 */
export declare function createWorkItemBoundary(ports: WorkItemPorts): SpecialistWorkItemBoundary;
/** Options for the runtime opener. */
export interface OpenWorkItemsOptions {
    dbPath?: string;
    /** Absolute path to a Substrate checkout. Overrides module resolution; see resolveSubstrateDir. */
    substrateDir?: string;
    env?: NodeJS.ProcessEnv;
    /**
     * How to find an INSTALLED Substrate when no explicit path is given. Defaults to real
     * module resolution.
     *
     * Exists so a test can state "nothing is installed" instead of depending on the machine
     * not having the package (unitAI-7co1i). The absent-Substrate paths were previously
     * asserted by accident: they passed on CI, which carries no Substrate, and failed the
     * moment anyone installed it — which publishing it made normal.
     */
    resolveInstalled?: () => string | null;
}
/**
 * Open the canonical work store and build the boundary over the REAL producer
 * services, dynamic-imported at runtime from an explicit checkout.
 *
 * `substrateDir` (or `XTRM_SUBSTRATE_DIR`) must point at a @jaggerxtrm/substrate
 * package directory exposing `src/store/migrations/runner.ts`,
 * `src/service/issue-service.ts`, `src/service/journal-service.ts`,
 * `src/service/provenance-service.ts`, `src/workitems/substrate-store.ts` and
 * `src/workitems/dispatch-gate.ts` with the `migrate`, `IssueService`,
 * `JournalService`, `ProvenanceService`, `SubstrateIssueStore`,
 * `checkDispatch` and `dispatchToSpecialist` members. Anything else — absent
 * directory, failed import, unopenable store — fails closed with
 * `work_item_store_unavailable`; there is no fallback work authority.
 */
export declare function openWorkItemBoundary(opts?: OpenWorkItemsOptions): Promise<SpecialistWorkItemBoundary>;
/** Used where work is genuinely not available (unit tests); every call refuses. */
export declare const NULL_WORK_ITEMS: SpecialistWorkItemBoundary;
//# sourceMappingURL=workitem-store.d.ts.map