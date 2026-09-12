// src/activation/workitem-store.ts
//
// Shared runtime boundary (ADR §8-§12, bead xtrm-6qu.7): the native Specialist
// runtime consumes Substrate durable work through the WorkItemStore seam, never
// through a Beads client.
//
// STRUCTURAL DECOUPLING (xtrm-6qu.7.1+): this module has NO static dependency
// on @jaggerxtrm/substrate — no import, no package.json entry, nothing for public CI
// to resolve. The Substrate package lives in the PRIVATE xtrm repo; this repo
// is public, so private code must never be vendored, bundled, or lockfiled
// here. Integration happens two ways:
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

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { extractSections, scrutinyLevel, validateContractText } from './contract-sections.js';

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
function resolveSubstrateDir(explicit: string, resolveInstalled?: () => string | null): string | null {
  const trimmed = explicit.trim();
  if (trimmed) return trimmed;
  if (resolveInstalled) return resolveInstalled();
  try {
    return dirname(require.resolve(`${SUBSTRATE_PACKAGE}/package.json`));
  } catch {
    // Not installed. Absence is an ordinary state, not an error to report here:
    // the caller turns it into work_item_store_unavailable with both remedies.
    return null;
  }
}

/** Canonical authority path: explicit XTRM_STATE_DB wins, else ~/.xtrm/state.db. */
export function resolveWorkItemDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.XTRM_STATE_DB ?? '').trim();
  if (override) return override;
  return join(homedir(), '.xtrm', 'state.db');
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
 */
export function openSubstrateDb(dbPath: string): DatabaseSync {
  const applyPragmas = (db: { exec(sql: string): void }): void => {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA foreign_keys = ON');
  };
  try {
    const bun = require('bun:sqlite') as { Database?: new (path: string) => { exec(sql: string): void } };
    if (bun?.Database) {
      const db = new bun.Database(dbPath);
      applyPragmas(db);
      return db as unknown as DatabaseSync;
    }
  } catch {
    // Fall through to node:sqlite.
  }
  const node = require('node:sqlite') as { DatabaseSync?: new (path: string) => { exec(sql: string): void } };
  if (node?.DatabaseSync) {
    const db = new node.DatabaseSync(dbPath);
    applyPragmas(db);
    return db as unknown as DatabaseSync;
  }
  throw new Error(`work-item store: no sqlite driver for ${dbPath}`);
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
  check(req: DispatchRequest): CheckResult;
  bind(req: DispatchRequest): ExecutionBindingView;
  inlineCreate(contract: string, opts?: { title?: string; holder?: string; activationId?: string }): InlineIssueResult;
  journal(ref: string, kind: string, opts?: { participantId?: string; activationId?: string }): void;
}

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
  getParent(childId: string): { id: string; humanRef: string; title: string; currentRevision: number } | null;
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

/** The injected ports `createWorkItemBoundary` programs against. */
export interface WorkItemPorts {
  issues: IssueServicePort;
  provenance: unknown;
  store: IssueStorePort;
  gate: DispatchGatePort;
}

/**
 * Build the consumer boundary over injected producer ports.
 *
 * Public unit tests inject fakes; the private integration job injects the real
 * Substrate services; `openWorkItemBoundary` injects them via runtime dynamic
 * import. No path here statically imports producer code.
 */
export function createWorkItemBoundary(ports: WorkItemPorts): SpecialistWorkItemBoundary {
  const { issues, provenance, store, gate } = ports;

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

    journal(ref: string, kind: string, opts: { participantId?: string; activationId?: string } = {}): void {
      store.addJournal(ref, kind, opts);
    },
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
  const db = openSubstrateDb(dbPath);
  runner.migrate(db);
  const issues = new issueSvcMod.IssueService(db) as IssueServicePort;
  const journalSvc = new journalMod.JournalService(db, issues);
  const provenance = new provMod.ProvenanceService(db, issues, journalSvc);
  const store = new storeMod.SubstrateIssueStore(issues, journalSvc) as IssueStorePort;
  return createWorkItemBoundary({
    issues,
    provenance,
    store,
    gate: {
      check: (i, r) => gateMod.checkDispatch(i, r),
      dispatch: (i, p, r) => gateMod.dispatchToSpecialist(i, p, r),
    },
  });
}

/** Used where work is genuinely not available (unit tests); every call refuses. */
export const NULL_WORK_ITEMS: SpecialistWorkItemBoundary = {
  view: () => { throw new Error('no work-item store: test double'); },
  epicAncestors: () => [],
  check: () => { throw new Error('no work-item store: test double'); },
  bind: () => { throw new Error('no work-item store: test double'); },
  inlineCreate: () => { throw new Error('no work-item store: test double'); },
  journal: () => {},
};
