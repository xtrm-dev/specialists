// src/activation/workitem-store.ts
//
// Shared runtime boundary (ADR §8-§12, bead xtrm-6qu.7): the native Specialist
// runtime consumes Substrate durable work through @xtrm/substrate's
// WorkItemStore, never through a Beads client. This module is the consumer-side
// seam: it opens the canonical ~/.xtrm/state.db, runs substrate migrations,
// wires the substrate services, and exposes the narrow boundary
// NativeActivationHost programs against.
//
// The boundary is deliberately narrow — view/claim/bind/lineage/inline-create.
// Everything here either delegates to @xtrm/substrate or adapts its shapes; no
// issue, claim, or readiness logic is reimplemented, because a second readiness
// derivation in the consumer would fork the shared authority (ADR §12).
//
// Consumption mode: @xtrm/substrate is unpublished; development uses a local
// `file:` override and the merge cuts over to the published ref (bead
// xtrm-6qu.7.1 blocks the merge, not development). Deep imports go through
// `@xtrm/substrate/src/...` paths, which the publish must keep stable — none of
// them may touch src/store/sqlite.ts, whose `node:sqlite` value import cannot
// load under bun 1.3.14.

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { migrate } from '@xtrm/substrate/src/store/migrations/runner.ts';
import { IssueService } from '@xtrm/substrate/src/service/issue-service.ts';
import { JournalService } from '@xtrm/substrate/src/service/journal-service.ts';
import { ProvenanceService } from '@xtrm/substrate/src/service/provenance-service.ts';
import { SubstrateIssueStore } from '@xtrm/substrate/src/workitems/substrate-store.ts';
import {
  checkDispatch,
  dispatchToSpecialist,
  type SpecialistDispatchRequest,
} from '@xtrm/substrate/src/workitems/dispatch-gate.ts';
import type { IssueView } from '@xtrm/substrate/src/workitems/store.ts';
import type { ExecutionBinding } from '@xtrm/substrate/src/domain/execution-binding.ts';
import type { ReadinessReport } from '@xtrm/substrate/src/domain/readiness.ts';
import { extractSections } from './contract-sections.js';

const require = createRequire(import.meta.url);

/** Canonical authority path: explicit XTRM_STATE_DB wins, else ~/.xtrm/state.db. */
export function resolveWorkItemDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.XTRM_STATE_DB ?? '').trim();
  if (override) return override;
  return join(homedir(), '.xtrm', 'state.db');
}

/**
 * Open the substrate DB behind the DatabaseSync surface the services use.
 *
 * bun:sqlite first (bun 1.3.14 has no node:sqlite), node:sqlite fallback for
 * non-bun runtimes — the same dual-driver discipline authority-store.ts applies
 * to the same file, restated for the substrate seam. bun binds undefined as
 * NULL where node:sqlite refuses it, so params are normalized where the two
 * disagree; nothing else differs on the prepare/exec/close surface.
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

/** Readiness + binding outcome for the admission path. */
export interface BindResult {
  check: { issueId: string; revision: number; contractHash: string; report: ReadinessReport };
  binding: ExecutionBinding;
}

/** Read-only dispatch gate outcome (§49 ordering: check before any mutation). */
export interface CheckResult {
  issueId: string;
  revision: number;
  contractHash: string;
  report: ReadinessReport;
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
  check(req: SpecialistDispatchRequest): CheckResult;
  bind(req: SpecialistDispatchRequest): ExecutionBinding;
  inlineCreate(contract: string, opts?: { title?: string; holder?: string; activationId?: string }): InlineIssueResult;
  journal(ref: string, kind: string, opts?: { participantId?: string; activationId?: string }): void;
}

/** The substrate-backed boundary. */
export class SubstrateWorkItemsBoundary implements SpecialistWorkItemBoundary {
  constructor(
    private readonly issues: IssueService,
    private readonly journalSvc: JournalService,
    private readonly provenance: ProvenanceService,
    private readonly store: SubstrateIssueStore,
  ) {}

  private viewOf(ref: string): WorkItemView {
    const v: IssueView = this.store.get(ref);
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
  }

  view(ref: string): WorkItemView {
    return this.viewOf(ref);
  }

  epicAncestors(ref: string, depth: number): EpicAncestor[] {
    if (depth !== 1 && depth !== 2) return [];
    const ancestors: EpicAncestor[] = [];
    const seen = new Set<string>();
    let childId = this.issues.resolveRef(ref).id;
    for (let i = 0; i < depth; i += 1) {
      const parent = this.issues.getParent(childId);
      if (!parent) break;
      if (seen.has(parent.id)) break; // fail-closed: never loop on a corrupt cycle
      seen.add(parent.id);
      const rev = this.issues.getRevision(parent.id, parent.currentRevision);
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
  }

  check(req: SpecialistDispatchRequest): CheckResult {
    // checkDispatch is the fail-closed pre-activation gate: draft/unready/
    // blocked/terminal/scope-expansion refuse before any mutation exists.
    const check = checkDispatch(this.issues, req);
    return { issueId: check.issueId, revision: check.revision, contractHash: check.contractHash, report: check.report };
  }

  bind(req: SpecialistDispatchRequest): ExecutionBinding {
    // Bind the live claim when one exists (coordinator-claims-first), else the
    // caller-supplied claimId (inline path), else null — the binding pins the
    // revision/hash regardless, and a concurrent edit between check and bind
    // is refused by the gate's divergence check inside dispatchToSpecialist.
    const claimId = this.issues.getActiveClaim(this.issues.resolveRef(req.ref).id)?.id ?? req.claimId ?? undefined;
    const out = dispatchToSpecialist(this.issues, this.provenance, { ...req, claimId });
    return out.binding;
  }

  inlineCreate(contract: string, opts: { title?: string; holder?: string; activationId?: string } = {}): InlineIssueResult {
    // §10: structural validation BEFORE any Issue exists, so a refused
    // dispatch leaves the board unchanged. The neutral contract parser is the
    // canonical 7-section reader; missing or empty sections fail here, never
    // inside a worker prompt.
    const sections = extractSections(contract);
    const missing = ['PROBLEM', 'SUCCESS', 'SCOPE', 'NON_GOALS', 'CONSTRAINTS', 'VALIDATION', 'OUTPUT']
      .filter((s) => !sections.get(s));
    if (missing.length > 0) {
      throw new Error(`inline contract is not a usable task contract: required sections are missing or empty: ${missing.join(', ')}`);
    }
    const scrutiny = (contract.match(/SCRUTINY\b[^\n]*\n?\s*\**\s*(LOW|MEDIUM|HIGH|CRITICAL)\b/i)
      ?? contract.match(/SCRUTINY\b\s*[:\-—]?\s*(LOW|MEDIUM|HIGH|CRITICAL)\b/i))?.[1]?.toUpperCase();
    if (!scrutiny) {
      throw new Error('inline contract is not a usable task contract: SCRUTINY must be LOW, MEDIUM, HIGH, or CRITICAL');
    }

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
    const { projectId } = this.issues.resolveProject({ gitRoot: process.cwd() });
    const issue = this.issues.createIssue({
      projectId,
      title: opts.title ?? (firstLine ?? 'Specialist dispatch contract').slice(0, 72),
      kind: 'task',
      contract: contractObj,
      scrutiny,
      authoredBy: holder,
    });
    // claimReady attests + claims in one transaction (§10: readiness
    // attestation then claim, atomically, before the ExecutionBinding).
    const { claim } = this.issues.claimReady(
      issue.id,
      holder,
      { outcome: 'ready', policy: 'default', attestedBy: holder },
      { activationId: opts.activationId },
    );
    // The machine id remains available separately, while dispatch returns the
    // human locator that IssueService.resolveRef accepts across all frontends.
    return { ref: this.issues.resolveRef(issue.id).humanRef, issueId: issue.id, claimId: claim.id };
  }

  journal(ref: string, kind: string, opts: { participantId?: string; activationId?: string } = {}): void {
    this.store.addJournal(ref, kind, opts);
  }
}

function splitLines(body: string | undefined): string[] {
  if (!body) return [];
  return body
    .split('\n')
    .map((l) => l.trim().replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
    .filter((l) => l.length > 0);
}

/** Open the canonical substrate store and build the boundary. */
export function openWorkItems(dbPath: string = resolveWorkItemDbPath()): SubstrateWorkItemsBoundary {
  const db = openSubstrateDb(dbPath);
  migrate(db);
  const issues = new IssueService(db);
  const journal = new JournalService(db, issues);
  const provenance = new ProvenanceService(db, issues, journal);
  const store = new SubstrateIssueStore(issues, journal);
  return new SubstrateWorkItemsBoundary(issues, journal, provenance, store);
}

/** Used where work is genuinely not available (unit tests); every call refuses. */
export const NULL_WORK_ITEMS: SpecialistWorkItemBoundary = {
  view: () => { throw new Error('no work-item store: test double'); },
  epicAncestors: () => [],
  check: () => { throw new Error('no work-item store: test double'); },
  bind: () => { throw new Error('no work-item store: test double'); },
  inlineCreate: () => { throw new Error('no work-item store: test double'); },
  journal: () => { throw new Error('no work-item store: test double'); },
};
