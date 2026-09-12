/**
 * Runtime resolution of the Substrate services that back the Issue, Journal and
 * Provenance tools (unitAI-aiwva.9/.10/.11).
 *
 * Resolution is deliberately OPTIONAL and never throws: Substrate is a separate
 * product on its own release cadence, and `@jaggerxtrm/specialists` must start and
 * serve its own tools whether or not that package happens to be installed. Absence
 * is an ordinary degraded state, never a failed server start.
 *
 * CORRECTED 2026-09-12 (XTRM-267). This block previously claimed two blockers, and
 * both are now wrong in ways worth recording, because either one would send the next
 * reader chasing a problem that does not exist:
 *
 *   1. "`@xtrm/substrate` is unpublished." It is published, as
 *      `@jaggerxtrm/substrate` — renamed to a scope the project owns, since the npm
 *      org `xtrm` was never registered.
 *   2. "It cannot load under bun." Measured false. `src/store/sqlite.ts` carries a
 *      lazy dual-runtime seam that selects `bun:sqlite` under bun and `node:sqlite`
 *      under node, so bun never resolves its missing built-in. Verified directly:
 *      the barrel imports cleanly under bun 1.3.14, and Substrate's own
 *      `bun-acceptance.ts` passes there.
 *
 * So `runtime_incompatible` below is retained as defense against a future regression,
 * not as a description of the present. The only reason this surface goes inert today
 * is `module_not_resolvable` — the package is not installed.
 *
 * So the tools are always REGISTERED and always answer. When Substrate is unreachable
 * they answer with a diagnosis naming the reason, which is strictly better than a
 * missing tool: a coordinator can see that the surface exists and why it is inert. The
 * moment Substrate loads, the same tools work with no change here and no change in the
 * tool files — which is why each tool takes its service injected.
 *
 * Mirrors the resolution discipline already used for sqlite itself in
 * `src/activation/authority-store.ts`: try, catch, degrade, never fail the caller.
 */
import { createRequire } from 'node:module';
import { resolveAuthorityDbPath } from '../activation/authority-store.js';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);

/** The package this surface loads. Must match the loader's own constant in `workitem-store.ts`. */
const SUBSTRATE_PACKAGE = '@jaggerxtrm/substrate';

/** Why the Substrate surface is inert. Reported verbatim through every tool. */
export type SubstrateUnavailableReason =
  | 'module_not_resolvable'
  | 'runtime_incompatible'
  | 'open_failed';

export interface SubstrateServices {
  issues: unknown;
  journal: unknown;
  provenance: unknown;
}

export interface SubstrateHandle {
  available: boolean;
  services: SubstrateServices | null;
  reason?: SubstrateUnavailableReason;
  detail?: string;
}

const UNAVAILABLE_HELP: Record<SubstrateUnavailableReason, string> = {
  module_not_resolvable:
    `${SUBSTRATE_PACKAGE} is not installed. Install it to enable this surface.`,
  runtime_incompatible:
    'The installed Substrate could not load on this runtime. It ships a dual-runtime sqlite seam ' +
    '(bun:sqlite under bun, node:sqlite under node), so this indicates a regression in that seam ' +
    'rather than an expected state.',
  open_failed: 'The Substrate store could not be opened.',
};

let cached: SubstrateHandle | null = null;

/**
 * Resolve once per process. The result cannot change without a restart — a module either
 * resolves on this runtime or it does not — and retrying per tool call would pay the
 * failure repeatedly to reach the same answer.
 */
export function resolveSubstrate(): SubstrateHandle {
  if (cached) return cached;
  cached = load();
  if (!cached.available) {
    logger.info(`Substrate tool surface inert (${cached.reason}): ${cached.detail ?? ''}`.trim());
  }
  return cached;
}

function load(): SubstrateHandle {
  let mod: Record<string, unknown>;
  try {
    mod = require(SUBSTRATE_PACKAGE) as Record<string, unknown>;
  } catch (error) {
    // Distinguish "not installed" from "installed but cannot run here". Both are
    // degraded, but only the second is a Substrate-side defect worth reporting upward.
    const message = error instanceof Error ? error.message : String(error);
    const reason: SubstrateUnavailableReason = /node:sqlite|DatabaseSync|built-in module/i.test(message)
      ? 'runtime_incompatible'
      : 'module_not_resolvable';
    return { available: false, services: null, reason, detail: message };
  }

  try {
    const open = mod.openSubstrate as ((path: string) => unknown) | undefined;
    const IssueService = mod.IssueService as (new (db: unknown) => unknown) | undefined;
    const JournalService = mod.JournalService as (new (db: unknown, issues: unknown) => unknown) | undefined;
    const ProvenanceService = mod.ProvenanceService as
      | (new (db: unknown, issues: unknown, journal?: unknown) => unknown)
      | undefined;
    if (!open || !IssueService || !JournalService || !ProvenanceService) {
      return {
        available: false,
        services: null,
        reason: 'module_not_resolvable',
        detail: `resolved ${SUBSTRATE_PACKAGE} does not export the expected service constructors`,
      };
    }

    const db = open(resolveAuthorityDbPath());
    const issues = new IssueService(db);
    const journal = new JournalService(db, issues);
    return {
      available: true,
      services: { issues, journal, provenance: new ProvenanceService(db, issues, journal) },
    };
  } catch (error) {
    return {
      available: false,
      services: null,
      reason: 'open_failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The payload every Substrate-backed tool returns when the surface is inert.
 *
 * Shared so all three tools answer identically: a coordinator that learns the reason once
 * should not have to learn three dialects of it.
 */
export function substrateUnavailablePayload(tool: string, handle: SubstrateHandle) {
  const reason = handle.reason ?? 'module_not_resolvable';
  return {
    status: 'error' as const,
    error: `substrate unavailable for ${tool}`,
    reason,
    detail: handle.detail,
    help: UNAVAILABLE_HELP[reason],
  };
}

/** Test seam: forget the cached resolution. Never called in production. */
export function __resetSubstrateCacheForTests(): void {
  cached = null;
}
