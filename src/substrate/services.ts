/**
 * Runtime resolution of the Substrate services that back the Issue, Journal and
 * Provenance tools (unitAI-aiwva.9/.10/.11).
 *
 * Resolution is deliberately OPTIONAL and never throws, for two measured reasons:
 *
 *   1. `@xtrm/substrate` is unpublished. `@jaggerxtrm/specialists` ships to users from
 *      npm; a published package cannot hard-depend on one that 404s. For most installs
 *      the module simply is not there, and that must be an ordinary degraded state
 *      rather than a failed server start.
 *   2. It cannot load under bun today. Substrate hard-imports `node:sqlite`
 *      (packages/substrate/src/store/sqlite.ts:1) and declares `engines.node >= 24`,
 *      while this server runs under bun by design — `.mcp.json` uses `command: "bun"`
 *      and `src/index.ts` hard-guards it. bun 1.3.14 has no `node:sqlite`. Until
 *      Substrate grows a sqlite adapter seam, the import fails on the runtime we ship.
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
    '@xtrm/substrate is not installed. It is unpublished; install it as a local link to enable this surface.',
  runtime_incompatible:
    'Substrate requires node:sqlite (node >= 24); this server runs under bun, which does not provide it. ' +
    'Substrate needs a sqlite adapter seam before this surface can load here.',
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
    mod = require('@xtrm/substrate') as Record<string, unknown>;
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
        detail: 'resolved @xtrm/substrate does not export the expected service constructors',
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
