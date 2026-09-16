// src/activation/workitem-store.ts
//
// Shared runtime boundary (ADR §8-§12, bead xtrm-6qu.7): the native Specialist
// runtime consumes Substrate durable work through the WorkItemStore seam, never
// through a Beads client.
//
// STRUCTURAL DECOUPLING (xtrm-6qu.7.1+): this module has NO static dependency
// on @jaggerxtrm/substrate — no import, no package.json entry, nothing for public CI
// to resolve.
//
// CORRECTED: this block used to say Substrate "lives in the PRIVATE xtrm repo" and
// that "private code must never be vendored, bundled, or lockfiled here". Substrate is
// PUBLISHED, as @jaggerxtrm/substrate — src/substrate/services.ts recorded that correction
// on 2026-09-12 (XTRM-267) and this block was missed, leaving the load-bearing rationale
// resting on a false premise. The real reason for the decoupling is install topology, not
// secrecy: Substrate is an OPTIONAL RUNTIME PREREQUISITE on its own release cadence, and a
// static dependency would force every legacy-only install to carry it and couple Specialists
// publishes to its version cuts (the same reasoning docs/installation.md records for
// xtrm-tools). Integration happens two ways:
//
//   1. `createWorkItemBoundary(ports)` — pure factory over injected ports.
//      Public unit tests inject fakes; the private integration job injects the
//      real services. This is the seam the private CI lane programs against.
//   2. `openWorkItemBoundary()` — convenience opener that dynamic-imports the
//      services from an explicit `XTRM_SUBSTRATE_DIR` checkout at RUNTIME.
//      Static builds, typechecks, and public CI never resolve the package; the
//      import fails closed with `work_item_store_unavailable` when absent.
//
// The boundary is deliberately narrow — view/claim/bind/lineage/inline-create.
// No issue, claim, or readiness logic is reimplemented: the check outcome and
// the ExecutionBinding come from the injected gate, because a second readiness
// derivation in the consumer would fork the shared authority (ADR §12). The
// ONE exception is the defense-in-depth claim-ownership refusal in `bind`
// (xtrm-6qu.7.2): until the producer gate pins same-holder semantics, this
// consumer refuses to inherit a foreign or cross-activation claim.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { resolveGlobalNodeModulesDir } from '../pi/session.js';
import { extractSections, scrutinyLevel, validateContractText } from './contract-sections.js';
import { resolveAuthorityDbPath } from './authority-store.js';

const require = createRequire(import.meta.url);

/**
 * The one name this loader will execute code from. Checked against the resolved
 * directory's own package.json before any deep module runs, on EVERY resolution
 * path — see `openWorkItemBoundary`. Strict equality against this single
 * constant is the point: a check that accepts two names accepts a spoof.
 *
 * Renamed from `@xtrm/substrate` under XTRM-267 when Substrate was published to
 * a scope the project actually owns.
 */
const SUBSTRATE_PACKAGE = '@jaggerxtrm/substrate';

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
export function resolveSubstrateDir(explicit: string, resolveInstalled?: () => string | null): string | null {
  const trimmed = explicit.trim();
  if (trimmed) return trimmed;
  if (resolveInstalled) return resolveInstalled();
  try {
    return dirname(require.resolve(`${SUBSTRATE_PACKAGE}/package.json`));
  } catch {
    // Not resolvable from here. Absence is an ordinary state, not an error to report here:
    // the caller turns it into work_item_store_unavailable with both remedies.
  }
  return resolveSubstrateFromGlobalPrefix();
}

/**
 * Substrate installed under an npm-style global prefix, which the ancestor walk cannot reach
 * through a symlinked Specialists install. See the measurement note on `resolveSubstrateDir`.
 *
 * Each candidate is a `<prefix>/lib` directory, because `resolve(spec, { paths })` appends
 * `node_modules` itself. Deduplicated and existence-checked so a candidate that cannot possibly
 * hold the package costs nothing.
 */
export function resolveSubstrateFromGlobalPrefix(libDirs?: readonly string[]): string | null {
  const globalModules = resolveGlobalNodeModulesDir();
  const runtimePrefix = dirname(dirname(process.execPath));
  const candidates = uniqueExistingLibDirs(libDirs ?? [
    globalModules ? dirname(globalModules) : undefined,
    join(runtimePrefix, 'lib'),
    // Bun's global install root, which is neither `<prefix>/lib` nor seen by the node walk.
    join(homedir(), '.bun', 'install', 'global'),
  ]);
  for (const libDir of candidates) {
    try {
      return dirname(require.resolve(`${SUBSTRATE_PACKAGE}/package.json`, { paths: [libDir] }));
    } catch {
      // Try the next prefix. A miss here is not an error: the caller reports the remedies.
    }
  }
  return null;
}

function uniqueExistingLibDirs(candidates: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = join(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    try {
      if (existsSync(normalized)) out.push(normalized);
    } catch {
      // Unreadable candidate: skip it rather than fail the whole resolution.
    }
  }
  return out;
}

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
export function resolveWorkItemDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveAuthorityDbPath(env);
}

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
export function openSubstrateDb(dbPath: string): DatabaseSync {
  const applyPragmas = (db: { exec(sql: string): void }): void => {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA foreign_keys = ON');
  };
  /** Why each driver was not used. Reported together, so the real cause is never the last one tried. */
  const failures: string[] = [];
  try {
    const bun = require('bun:sqlite') as { Database?: new (path: string) => { exec(sql: string): void } };
    if (bun?.Database) {
      const db = new bun.Database(dbPath);
      applyPragmas(db);
      return db as unknown as DatabaseSync;
    }
    failures.push('bun:sqlite: module exposes no Database export');
  } catch (error) {
    failures.push(`bun:sqlite: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const node = require('node:sqlite') as { DatabaseSync?: new (path: string) => { exec(sql: string): void } };
    if (node?.DatabaseSync) {
      const db = new node.DatabaseSync(dbPath);
      applyPragmas(db);
      return db as unknown as DatabaseSync;
    }
    failures.push('node:sqlite: module exposes no DatabaseSync export');
  } catch (error) {
    failures.push(`node:sqlite: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(
    `work-item store: cannot open the sqlite store at ${dbPath} `
      + `(bun:sqlite and node:sqlite both unavailable: ${failures.join('; ')})`,
  );
}

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

/** Lifecycle states that SATISFY a `blocks` edge (Substrate `isBlockerSatisfied`). */
const SATISFIED_BLOCKER_STATES = new Set(['done', 'archived']);

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
  check: { issueId: string; revision: number; contractHash: string; report: unknown };
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
  refs?: Array<{ kind: string; key: string; value?: unknown }>;
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
  inlineCreate(contract: string, opts?: { title?: string; holder?: string; activationId?: string }): InlineIssueResult;
  /**
   * Release the claim an inline contract took, so a refused inline dispatch leaves an issue that is
   * immediately re-dispatchable rather than one locked by an activation that never ran
   * (SPECIALISTS-53). Returns false when there is no live claim or the boundary cannot release.
   * Optional for the same reason as the port method: the boundary is structural and test doubles
   * predate it.
   */
  releaseInlineClaim?(ref: string, opts?: { activationId?: string }): boolean;
  journal(ref: string, kind: string, opts?: { participantId?: string; activationId?: string }): void;
  /**
   * S1 settlement surface (ADR §§38–39). Optional so existing fakes keep
   * compiling; the host degrades to store-only publication when absent.
   * `appendResult` writes the bounded Journal `result` with the X1 envelope;
   * `allocateReceipt` mints the WorkReceipt over a live ExecutionBinding
   * (revision/hash copied host-side, never from model output); `attachArtifact`
   * links a non-commit artifact (the runtime result ref) to the receipt.
   * Commits are never attached here — zero-commit results publish identically.
   */
  appendResult?(ref: string, input: SettlementResultInput): { entryId: string; sequence: number };
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
  findResultEntry?(ref: string, key: { activationId: string; attemptId: string }): SettlementLookup<{ entryId: string }>;
  /** The receipt already allocated over a binding, if any. One receipt per binding is the rule. */
  findReceiptForBinding?(ref: string, bindingId: string): SettlementLookup<{ receiptId: string }>;
}

/** The attempt an entry belongs to, read from the envelope first and the fake-only flat field second. */
function attemptOfEntry(entry: { attemptId?: string | null; executionContext?: { specialist?: { attemptId?: string | null } | null } | null }): string | null {
  return entry.executionContext?.specialist?.attemptId ?? entry.attemptId ?? null;
}

/**
 * The answer to "did this already land?".
 *
 * `absent` is a PROOF that nothing was written; `unavailable` is the absence of a proof. Only
 * `absent` licenses a write.
 */
export type SettlementLookup<T> =
  | { status: 'found'; value: T }
  | { status: 'absent' }
  | { status: 'unavailable'; reason: string };

/** Structural view of the producer's active claim — the only claim fields the seam reads. */
export interface ActiveClaimView {
  id: number;
  holder: string;
  activationId: string | null;
}

/** Structural port over the producer's issue service. Implemented by fakes in public tests. */
export interface IssueServicePort {
  resolveRef(ref: string): { id: string; humanRef: string };
  getActiveClaim(issueId: string): ActiveClaimView | null;
  /**
   * Release a live claim (SPECIALISTS-53). Optional because this port is structural and several
   * public-test doubles predate it; a double that omits it has no claim to release. The real
   * service implements it (substrate issue-service `releaseClaim`).
   */
  releaseClaim?(issueId: string, holder: string, opts?: { activationId?: string }): { id: number } | null;
  getParent(childId: string): { id: string; humanRef: string; title: string; currentRevision: number } | null;
  /**
   * Every ACTIVE `blocks` edge whose target is `childId`, resolved to its sources. Optional
   * so an existing in-memory fake keeps compiling; absent means "no blocker information",
   * never "no blockers".
   */
  getBlockers?(childId: string): BlockerIssue[];
  getRevision(issueId: string, revision: number): { contract: unknown };
  resolveProject(opts: { gitRoot: string }): { projectId: string };
  createIssue(input: {
    projectId: string;
    title: string;
    kind: string;
    contract: unknown;
    scrutiny: string;
    authoredBy: string;
  }): { id: string };
  claimReady(
    issueId: string,
    holder: string,
    attestation: { outcome: string; policy: string; attestedBy: string },
    opts?: { activationId?: string },
  ): { claim: { id: number } };
}

/** Structural port over the producer's issue store (read + journal). */
export interface IssueStorePort {
  get(ref: string): {
    issue: { humanRef: string; id: string; currentRevision: number; currentContractHash: string; title: string };
    contract: unknown;
    readinessState: string;
    dispatchable: boolean;
    reasons: string[];
  };
  addJournal(ref: string, kind: string, opts?: { participantId?: string; activationId?: string }): void;
}

/** Structural port over the producer's dispatch gate (check + bind mutation). */
export interface DispatchGatePort {
  check(issues: unknown, req: DispatchRequest): { issueId: string; revision: number; contractHash: string; report: unknown };
  dispatch(issues: unknown, provenance: unknown, req: DispatchRequest): { binding: ExecutionBindingView };
}

/** Structural port over the producer's journal service (S1 result publication). */
export interface JournalServicePort {
  appendEntry(issueId: string, input: {
    kind: string;
    result?: unknown;
    executionContext?: unknown;
    refs?: Array<{ kind: string; key: string; value?: unknown }>;
    participantId?: string;
    activationId?: string;
    sessionId?: string;
  }): { id: string; sequence: number };
  /** Existing entries, for the settlement reconciliation read (SPECIALISTS-54). */
  listEntries?(issueId: string, opts?: { kind?: string; limit?: number }): Array<{
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
    executionContext?: { specialist?: { attemptId?: string | null } | null } | null;
  }>;
}

/** Structural port over the producer's provenance service (S1 receipt publication). */
export interface ProvenanceServicePort {
  allocateReceipt(bindingId: string): { id: string; executionBindingId: string; issueId: string; issueRevision: number; contractHash: string };
  attachArtifact(receiptId: string, kind: string, value: string): { receiptId?: string; kind?: string; value?: string };
  /** Receipts already allocated for an issue, for the reconciliation read (SPECIALISTS-54). */
  listReceipts?(issueId: string): Array<{ id: string; executionBindingId: string }>;
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
export function createWorkItemBoundary(ports: WorkItemPorts): SpecialistWorkItemBoundary {
  const { issues, provenance, store, gate, journalService, provenanceService } = ports;

  const viewOf = (ref: string): WorkItemView => {
    const v = store.get(ref);
    return {
      ref: v.issue.humanRef,
      issueId: v.issue.id,
      revision: v.issue.currentRevision,
      contractHash: v.issue.currentContractHash,
      title: v.issue.title,
      contract: v.contract,
      readinessState: v.readinessState,
      dispatchable: v.dispatchable,
      reasons: v.reasons,
    };
  };

  return {
    view(ref: string): WorkItemView {
      return viewOf(ref);
    },

    epicAncestors(ref: string, depth: number): EpicAncestor[] {
      if (depth !== 1 && depth !== 2) return [];
      const ancestors: EpicAncestor[] = [];
      const seen = new Set<string>();
      let childId = issues.resolveRef(ref).id;
      for (let i = 0; i < depth; i += 1) {
        const parent = issues.getParent(childId);
        if (!parent) break;
        if (seen.has(parent.id)) break; // fail-closed: never loop on a corrupt cycle
        seen.add(parent.id);
        const rev = issues.getRevision(parent.id, parent.currentRevision);
        ancestors.push({
          ref: parent.humanRef,
          title: parent.title,
          description: typeof rev.contract === 'object' && rev.contract !== null
            ? String((rev.contract as { problem?: string }).problem ?? '')
            : undefined,
        });
        childId = parent.id;
      }
      return ancestors;
    },

    completedBlockers(ref: string, depth: number): EpicAncestor[] {
      if (depth !== 1 && depth !== 2) return [];
      if (!issues.getBlockers) return [];
      const collected: EpicAncestor[] = [];
      const seen = new Set<string>();
      let frontier = [issues.resolveRef(ref).id];
      for (let hop = 0; hop < depth && frontier.length > 0; hop += 1) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const blocker of issues.getBlockers(id)) {
            if (seen.has(blocker.id)) continue; // fail-closed: never loop on a corrupt cycle
            seen.add(blocker.id);
            // Only SATISFIED blockers are dependency context. An unsatisfied blocker is a
            // reason the dispatch would have been refused, not context for the child.
            if (!SATISFIED_BLOCKER_STATES.has(blocker.lifecycleState)) continue;
            const rev = issues.getRevision(blocker.id, blocker.currentRevision);
            collected.push({
              ref: blocker.humanRef,
              title: blocker.title,
              description: typeof rev.contract === 'object' && rev.contract !== null
                ? String((rev.contract as { problem?: string }).problem ?? '')
                : undefined,
            });
            next.push(blocker.id);
          }
        }
        frontier = next;
      }
      return collected;
    },

    check(req: DispatchRequest): CheckResult {
      // checkDispatch is the fail-closed pre-activation gate: draft/unready/
      // blocked/terminal/scope-expansion refuse before any mutation exists.
      const check = gate.check(issues, req);
      return { issueId: check.issueId, revision: check.revision, contractHash: check.contractHash, report: check.report };
    },

    bind(req: DispatchRequest): ExecutionBindingView {
      const issueId = issues.resolveRef(req.ref).id;
      const active = issues.getActiveClaim(issueId);
      if (active) {
        // Defense in depth (xtrm-6qu.7.2): never inherit a foreign or
        // cross-activation claim. The producer gate must pin same-holder
        // semantics itself; until it does, this consumer refuses rather than
        // misattributing another holder's (or activation's) claim. A spoofed
        // holder string (B dispatching AS A) remains producer-side
        // responsibility — this check compares, it does not authenticate.
        if (active.holder !== req.holder) {
          throw new Error(
            `dispatch refused: issue is claimed by '${active.holder}' — holder '${req.holder}' must claim first`,
          );
        }
        const claimActivation = active.activationId ?? null;
        const reqActivation = req.activationId ?? null;
        if (claimActivation !== reqActivation) {
          // Strict equality, both directions: a mismatched activation, an
          // omitted activationId against a bound claim, and a fabricated
          // activationId against an unbound claim all refuse. Coordinator
          // flows must claim WITH the activation id they will dispatch with.
          throw new Error(
            'dispatch refused: claim activation does not match dispatch activation — claim with the dispatching activation id',
          );
        }
        if (req.claimId != null && req.claimId !== active.id) {
          // Never silently substitute: a supplied claimId that is not the
          // live claim is a different binding, not a default.
          throw new Error(
            `dispatch refused: supplied claim ${req.claimId} is not the active claim ${active.id}`,
          );
        }
      }
      // Bind the live claim when one exists (coordinator-claims-first), else
      // the caller-supplied claimId (inline path) — the gate pins the
      // revision/hash regardless, and a concurrent edit between check and bind
      // is refused by the gate's divergence check, never re-derived here.
      const claimId = active?.id ?? req.claimId ?? undefined;
      const out = gate.dispatch(issues, provenance, { ...req, claimId });
      return out.binding;
    },

    inlineCreate(contract: string, opts: { title?: string; holder?: string; activationId?: string } = {}): InlineIssueResult {
      // §10: structural validation BEFORE any Issue exists, so a refused
      // dispatch leaves the board unchanged. The shared contract-text gate is
      // the canonical reader; failures land here, never inside a worker prompt.
      const validation = validateContractText(contract);
      if (!validation.ok) {
        throw new Error(`${validation.reason}: ${validation.missing.join(', ')}`);
      }
      const sections = extractSections(contract);
      // Validated above, so a level exists; the fallback only satisfies the type.
      const scrutiny = scrutinyLevel(contract) ?? 'MEDIUM';

      const problem = sections.get('PROBLEM') ?? '';
      const firstLine = problem.split('\n').map((s) => s.trim()).find(Boolean);
      const contractObj = {
        problem,
        success: sections.get('SUCCESS') ?? '',
        scope: splitLines(sections.get('SCOPE')),
        nonGoals: splitLines(sections.get('NON_GOALS')),
        constraints: splitLines(sections.get('CONSTRAINTS')),
        validation: splitLines(sections.get('VALIDATION')).map((check) => ({ check })),
        output: splitLines(sections.get('OUTPUT')).map((artifact) => ({ artifact })),
      };

      // The dispatcher holds the created issue: the coordinator (or adapter)
      // that supplied the contract owns it until the activation settles.
      const holder = opts.holder ?? 'adapter::specialists';
      const { projectId } = issues.resolveProject({ gitRoot: process.cwd() });
      const issue = issues.createIssue({
        projectId,
        title: opts.title ?? (firstLine ?? 'Specialist dispatch contract').slice(0, 72),
        kind: 'task',
        contract: contractObj,
        scrutiny,
        authoredBy: holder,
      });
      // claimReady attests + claims in one transaction (§10: readiness
      // attestation then claim, atomically, before the ExecutionBinding).
      const { claim } = issues.claimReady(
        issue.id,
        holder,
        { outcome: 'ready', policy: 'default', attestedBy: holder },
        { activationId: opts.activationId },
      );
      // The machine id remains available separately, while dispatch returns the
      // human locator that IssueService.resolveRef accepts across all frontends.
      return { ref: issues.resolveRef(issue.id).humanRef, issueId: issue.id, claimId: claim.id };
    },
    releaseInlineClaim(ref: string, opts: { activationId?: string } = {}): boolean {
      const issueId = issues.resolveRef(ref).id;
      const active = issues.getActiveClaim(issueId);
      if (!active || !issues.releaseClaim) return false;
      // Release only a claim THIS activation took. Releasing as the recorded holder is what makes a
      // release possible at all, and it is also what makes it dangerous: if anything re-claimed
      // between creation and refusal - a TTL edge, a coordinator racing on created_ref, a future
      // path that re-claims - the recorded holder is someone else, and releasing as them would
      // destroy a claim that is not ours. Checked, not assumed (SPECIALISTS-53 review).
      if (opts.activationId && active.activationId !== opts.activationId) return false;
      // Still released AS THE RECORDED HOLDER, read from the claim rather than from the caller:
      // only the recorded holder and activation may release.
      const released = issues.releaseClaim(
        issueId,
        active.holder,
        active.activationId ? { activationId: active.activationId } : {},
      );
      return released !== null;
    },

    journal(ref: string, kind: string, opts: { participantId?: string; activationId?: string } = {}): void {
      store.addJournal(ref, kind, opts);
    },

    ...((journalService || provenanceService)
      ? {
          appendResult(ref: string, input: SettlementResultInput): { entryId: string; sequence: number } {
            if (!journalService) throw new Error('settlement unavailable: no journal service on this boundary');
            const issueId = issues.resolveRef(ref).id;
            const entry = journalService.appendEntry(issueId, {
              kind: 'result',
              result: input.result,
              executionContext: input.executionContext ?? null,
              refs: input.refs ?? [],
              participantId: input.participantId,
              activationId: input.activationId,
              sessionId: input.sessionId,
            });
            return { entryId: entry.id, sequence: entry.sequence };
          },
          allocateReceipt(bindingId: string): WorkReceiptView {
            if (!provenanceService) throw new Error('settlement unavailable: no provenance service on this boundary');
            const receipt = provenanceService.allocateReceipt(bindingId);
            return {
              id: receipt.id,
              executionBindingId: receipt.executionBindingId,
              issueId: receipt.issueId,
              issueRevision: receipt.issueRevision,
              contractHash: receipt.contractHash,
            };
          },
          attachArtifact(receiptId: string, kind: string, value: string): SettlementArtifactView {
            if (!provenanceService) throw new Error('settlement unavailable: no provenance service on this boundary');
            const attached = provenanceService.attachArtifact(receiptId, kind, value);
            return {
              receiptId: attached.receiptId ?? receiptId,
              kind: attached.kind ?? kind,
              value: attached.value ?? value,
            };
          },
          // Reconciliation reads (SPECIALISTS-54). Every way of failing to answer returns
          // `unavailable`, never `absent`: a missing method, a service that is not wired, and a
          // query that throws are all "cannot prove", and treating any of them as "nothing
          // there" is what would mint a duplicate receipt.
          findResultEntry(ref: string, key: { activationId: string; attemptId: string }): SettlementLookup<{ entryId: string }> {
            if (!journalService?.listEntries) {
              return { status: 'unavailable', reason: 'journal service exposes no entry listing' };
            }
            try {
              const entries = journalService.listEntries(issues.resolveRef(ref).id, { kind: 'result' });
              const forActivation = entries.filter((entry) => entry.activationId === key.activationId);
              // The attempt lives in the X1 envelope, NOT as a flat column: `issue_journal` has no
              // attempt_id (substrate src/domain/journal.ts:193-211). Matching on a flat
              // `entry.attemptId` compared `null` to a real attempt id and could never succeed, so
              // an append that had actually landed read as "absent" and the republish appended a
              // SECOND Journal result.
              const match = forActivation.find((entry) => attemptOfEntry(entry) === key.attemptId);
              if (match) return { status: 'found', value: { entryId: match.id } };
              const unattributed = forActivation.filter((entry) => attemptOfEntry(entry) === null);
              if (unattributed.length > 0) {
                // Entries exist for this activation but none names an attempt, so "absent" cannot
                // be proven — and claiming it would license a duplicate append.
                return {
                  status: 'unavailable',
                  reason: `${unattributed.length} Journal result(s) for this activation carry no attempt attribution`,
                };
              }
              return { status: 'absent' };
            } catch (error) {
              return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
            }
          },
          findReceiptForBinding(ref: string, bindingId: string): SettlementLookup<{ receiptId: string }> {
            if (!provenanceService?.listReceipts) {
              return { status: 'unavailable', reason: 'provenance service exposes no receipt listing' };
            }
            try {
              const rows = provenanceService.listReceipts(issues.resolveRef(ref).id);
              const match = rows.find((receipt) => receipt.executionBindingId === bindingId);
              return match ? { status: 'found', value: { receiptId: match.id } } : { status: 'absent' };
            } catch (error) {
              return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
            }
          },
        }
      : {}),
  };
}

function splitLines(body: string | undefined): string[] {
  if (!body) return [];
  return body
    .split('\n')
    .map((l) => l.trim().replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
    .filter((l) => l.length > 0);
}

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
export async function openWorkItemBoundary(opts: OpenWorkItemsOptions = {}): Promise<SpecialistWorkItemBoundary> {
  const env = opts.env ?? process.env;
  const substrateDir = resolveSubstrateDir(
    opts.substrateDir ?? env.XTRM_SUBSTRATE_DIR ?? '',
    opts.resolveInstalled,
  );
  if (!substrateDir) {
    throw new Error(
      `work_item_store_unavailable: no Substrate package configured (install ${SUBSTRATE_PACKAGE}, ` +
        'or set XTRM_SUBSTRATE_DIR to a checkout of it)',
    );
  }
  // Package identity BEFORE executing any deep module: a spoofed or wrong
  // directory must fail closed here, never as a confusing import error — or
  // worse, by executing untrusted code past the export-presence check.
  let pkgName: unknown;
  try {
    const pkgRaw = await import(pathToFileURL(join(substrateDir, 'package.json')).href, { with: { type: 'json' } });
    pkgName = (pkgRaw as { default?: { name?: unknown } }).default?.name;
  } catch (error) {
    throw new Error(
      `work_item_store_unavailable: cannot read Substrate package identity at ${substrateDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (pkgName !== SUBSTRATE_PACKAGE) {
    throw new Error(
      `work_item_store_unavailable: expected ${SUBSTRATE_PACKAGE} at ${substrateDir}, found ${JSON.stringify(pkgName) ?? 'no name'}`,
    );
  }
  const load = async (rel: string): Promise<Record<string, any>> => {
    try {
      return (await import(pathToFileURL(join(substrateDir, rel)).href)) as Record<string, any>;
    } catch (error) {
      throw new Error(
        `work_item_store_unavailable: cannot load Substrate module ${rel}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const [runner, issueSvcMod, journalMod, provMod, storeMod, gateMod] = await Promise.all([
    load('src/store/migrations/runner.ts'),
    load('src/service/issue-service.ts'),
    load('src/service/journal-service.ts'),
    load('src/service/provenance-service.ts'),
    load('src/workitems/substrate-store.ts'),
    load('src/workitems/dispatch-gate.ts'),
  ]);
  for (const [mod, name] of [
    [runner, 'migrate'], [issueSvcMod, 'IssueService'], [journalMod, 'JournalService'],
    [provMod, 'ProvenanceService'], [storeMod, 'SubstrateIssueStore'],
    [gateMod, 'checkDispatch'], [gateMod, 'dispatchToSpecialist'],
  ] as const) {
    if (typeof (mod as Record<string, unknown>)[name] === 'undefined') {
      throw new Error(`work_item_store_unavailable: Substrate module is missing export ${name}`);
    }
  }
  const dbPath = opts.dbPath ?? resolveWorkItemDbPath(env);
  // SPECIALISTS-59: opening the store and running migrations is the point at which the lookup
  // depends on the HOST rather than on the package. Anything thrown here (an unopenable store, a
  // migration that refuses, a missing HOME/.xtrm directory) is normalized into the same refusal
  // the rest of this function uses, so the caller never sees a raw runtime error in place of a
  // remedy. The drivers' own messages are kept, so the cause is still named.
  const storeRefusal = (error: unknown): Error => new Error(
    `work_item_store_unavailable: cannot open the Substrate store at ${dbPath} `
      + `(set SUBSTRATE_DB or XTRM_STATE_DB to a writable database path, or install `
      + `${SUBSTRATE_PACKAGE}): ${error instanceof Error ? error.message : String(error)}`,
  );
  let db: DatabaseSync;
  try {
    db = openSubstrateDb(dbPath);
    runner.migrate(db);
  } catch (error) {
    throw storeRefusal(error);
  }
  // Constructing the producer services is host-dependent too: the pinned producer assigns fields,
  // but a producer that validated on construction would throw here, and that must surface as the
  // same refusal rather than as a raw error. The previous comment claimed db-open was the last such
  // point while these four sat outside it.
  let issueService: IssueServicePort & {
    listActiveEdges(): Array<{ fromIssue: string; toIssue: string; kind: string; active: boolean }>;
    getIssue(id: string): { id: string; humanRef: string; title: string; currentRevision: number; lifecycleState: string };
  };
  let journalSvc: InstanceType<typeof journalMod.JournalService>;
  let provenance: InstanceType<typeof provMod.ProvenanceService>;
  let store: IssueStorePort;
  try {
    issueService = new issueSvcMod.IssueService(db) as typeof issueService;
    journalSvc = new journalMod.JournalService(db, issueService);
    provenance = new provMod.ProvenanceService(db, issueService, journalSvc);
    store = new storeMod.SubstrateIssueStore(issueService, journalSvc) as IssueStorePort;
  } catch (error) {
    throw storeRefusal(error);
  }
  // The blocker traversal lives here, over the producer's own edge list, so the boundary
  // stays the single consumer surface and no host queries the store directly.
  issueService.getBlockers = (childId: string): BlockerIssue[] =>
    issueService
      .listActiveEdges()
      .filter((edge) => edge.active && edge.kind === 'blocks' && edge.toIssue === childId)
      .map((edge) => {
        const issue = issueService.getIssue(edge.fromIssue);
        return {
          id: issue.id,
          humanRef: issue.humanRef,
          title: issue.title,
          currentRevision: issue.currentRevision,
          lifecycleState: issue.lifecycleState,
        };
      });
  const issues = issueService;
  return createWorkItemBoundary({
    issues,
    provenance,
    store,
    gate: {
      check: (i, r) => gateMod.checkDispatch(i, r),
      dispatch: (i, p, r) => gateMod.dispatchToSpecialist(i, p, r),
    },
    // S1 settlement surface over the same live services: the Journal result
    // publication and WorkReceipt allocation the host performs automatically
    // at settlement. Structural ports only — no static producer import.
    journalService: journalSvc as unknown as JournalServicePort,
    provenanceService: provenance as unknown as ProvenanceServicePort,
  });
}

/** Used where work is genuinely not available (unit tests); every call refuses. */
export const NULL_WORK_ITEMS: SpecialistWorkItemBoundary = {
  view: () => { throw new Error('no work-item store: test double'); },
  epicAncestors: () => [],
  completedBlockers: () => [],
  check: () => { throw new Error('no work-item store: test double'); },
  bind: () => { throw new Error('no work-item store: test double'); },
  inlineCreate: () => { throw new Error('no work-item store: test double'); },
  journal: () => {},
};
