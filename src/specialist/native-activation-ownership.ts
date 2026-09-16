// XTRM-93 N3 (SPECIALISTS-104, residual of unitAI-kmbb9): the ownership source
// for `sp ps --mine` on the NATIVE activation block.
//
// WHY THIS EXISTS. `--mine` is a CANDIDATE-DEFINING filter: its semantics are
// "the latest N activations I own". A filter with those semantics has to be
// evaluated BEFORE the activation bound, never on the post-limit survivors —
// see `NativeCandidatePredicate` in src/cli/ps.ts. Expressing it before the
// bound means resolving ownership into a set of activation ids that
// `listNativeActivationIds` can select on, which needs a source.
//
// THE SOURCE IS SUBSTRATE, NOT BEADS. Native activation ownership is persisted
// in the one authority store (`resolveAuthorityDbPath()`): `issue_claims` binds
// an `activation_id` to a `holder` (144 distinct non-null activation ids
// measured 2026-09-16), and `execution_bindings` binds an activation to its
// issue, participant, session and workspace. The legacy Beads assignee surface
// is NOT a usable source and is not consulted here. Measured 2026-09-16:
//
//   bd query 'assignee=me'         -> 0 rows   (`me` is not a token bd query
//                                               supports; `bd query --help`
//                                               documents assignee=<user> and
//                                               assignee=none)
//   bd query 'assignee=jaggerxtrm' -> 2 rows   (git config user.name)
//
// So the old resolution asserted "nothing is mine" against a board where 73 of
// 79 beads carry no assignee at all, and the empty set hard-excluded every
// activation. A successful empty query is also not "bd unreachable", so the
// documented no-op fallback never fired.
//
// THE OPERATOR IDENTITY IS NOT RESOLVABLE, AND IS NOT INVENTED HERE. Substrate
// records whichever holder string the dispatcher supplied — observed:
// `specialist::<role>`, `pi::a1k5`, `pi::o3rq`, `coordinator:xt-pi-8158`,
// `claude::xt-i1q2`, `claude-fshb`, `pi:uxfix` — and it defines no ambient
// current-user: `sb issue claim` requires an explicit `--holder`, and the
// schema has no assignee. Measured on the same date, no other authority exists:
//
//   - `XTRM_SESSION_ID` / `XTRM_SESSION_NAME` are absent from a plain pi
//     session, and nothing in xtrm-tools exports them;
//   - `workspace_leases` is empty, so the workspace carries no holder;
//   - no git-config-to-holder mapping exists (holders are caller-chosen
//     strings, not identities);
//   - the activation's own claim holder is `specialist::<role>` — the worker,
//     not the operator.
//
// Therefore the ONLY identity accepted here is the session identity this
// codebase already reads verbatim (`XTRM_SESSION_NAME`, then `XTRM_SESSION_ID`,
// the two variables `src/activation/native-host.ts` and
// `src/activation/settlement-publication.ts` treat as the session's identity),
// matched by EXACT string equality against the recorded holder. Exact equality
// is an identity join; a prefix or substring rule would be a heuristic and
// would silently widen ownership. When no identity is present the resolution is
// `unavailable`, and the caller must FAIL CLOSED on it: an explicitly requested
// `--mine` whose candidate set is unknown selects nothing, and the caller
// reports the missing authority as a typed filter status rather than presenting
// the unfiltered window as though it satisfied the filter. `unavailable` must
// never be recorded as "you own zero activations".
//
// This module is READ-ONLY over the authority store and never throws; every
// failure is a typed `unavailable`.
import { existsSync } from 'node:fs';
import { resolveAuthorityDbPath } from '../activation/authority-store.js';

/** Why native activation ownership could not be resolved. */
export type NativeOwnershipUnavailableReason =
  | 'no_session_identity'
  | 'authority_store_absent'
  | 'authority_store_unreadable';

export type NativeOwnershipResolution =
  | {
      kind: 'resolved';
      /** Activations whose recorded Substrate claim holder equals `holder`. */
      activationIds: string[];
      /** The exact holder string matched against `issue_claims.holder`. */
      holder: string;
    }
  | {
      kind: 'unavailable';
      reason: NativeOwnershipUnavailableReason;
      /** Operator-facing detail. Names the missing authority; never a guess. */
      detail: string;
    };

/**
 * The session identity, in the order this codebase already reads it. Both are
 * treated as opaque holder strings: nothing is prefixed, stripped, or
 * normalized. Empty and whitespace-only values are absent (an unset-feeling
 * value must never become a holder, the same rule `resolveAuthorityDbPath`
 * applies to its own variables).
 */
export function resolveSessionHolder(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of ['XTRM_SESSION_NAME', 'XTRM_SESSION_ID'] as const) {
    const value = (env[key] ?? '').trim();
    if (value) return value;
  }
  return undefined;
}

interface ReadonlySqlite {
  all(sql: string, ...params: unknown[]): Array<Record<string, unknown>>;
  close(): void;
}

/** Open the authority store READ-ONLY. `sp ps` must never mutate authority. */
function openReadonly(dbPath: string): ReadonlySqlite | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bun = require('bun:sqlite') as { Database?: new (path: string, opts?: { readonly?: boolean }) => { query: (sql: string) => { all: (...p: unknown[]) => unknown[] }; close: () => void } };
    if (bun?.Database) {
      const db = new bun.Database(dbPath, { readonly: true });
      return {
        all: (sql, ...params) => db.query(sql).all(...params) as Array<Record<string, unknown>>,
        close: () => db.close(),
      };
    }
  } catch {
    // Fall through to node:sqlite.
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const node = require('node:sqlite') as { DatabaseSync?: new (path: string, opts?: { readOnly?: boolean }) => { prepare: (sql: string) => { all: (...p: unknown[]) => unknown[] }; close: () => void } };
    if (node?.DatabaseSync) {
      const DatabaseSync = node.DatabaseSync;
      const db = new DatabaseSync(dbPath, { readOnly: true });
      return {
        all: (sql, ...params) => db.prepare(sql).all(...params) as Array<Record<string, unknown>>,
        close: () => db.close(),
      };
    }
  } catch {
    // Absent sqlite driver: reported as unreadable, never thrown.
  }
  return null;
}

export interface ResolveNativeOwnershipOptions {
  env?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to the one authority path. */
  dbPath?: string;
}

/**
 * Resolve the set of native activations owned by this session.
 *
 * Read-only, bounded and total: it never throws, and every failure is a typed
 * `unavailable` result rather than an empty set, because "ownership is unknown"
 * and "you own nothing" are different facts and the caller renders them
 * differently.
 */
export function resolveNativeActivationOwnership(
  opts: ResolveNativeOwnershipOptions = {},
): NativeOwnershipResolution {
  const holder = resolveSessionHolder(opts.env);
  if (!holder) {
    return {
      kind: 'unavailable',
      reason: 'no_session_identity',
      detail:
        'this session carries no XTRM_SESSION_NAME/XTRM_SESSION_ID, and Substrate records ownership ' +
        'only against an explicit claim holder, so the current operator cannot be identified',
    };
  }

  const dbPath = opts.dbPath ?? resolveAuthorityDbPath(opts.env);
  if (!existsSync(dbPath)) {
    return {
      kind: 'unavailable',
      reason: 'authority_store_absent',
      detail: `the Substrate authority store is absent (${dbPath}), so claim holders cannot be read`,
    };
  }

  const db = openReadonly(dbPath);
  if (!db) {
    return {
      kind: 'unavailable',
      reason: 'authority_store_unreadable',
      detail: `the Substrate authority store could not be opened read-only (${dbPath})`,
    };
  }

  try {
    // Exact holder equality. Both live and released claims count: a released
    // claim is still a record that this holder owned the activation, and
    // `--since` is the operator's tool for narrowing by time.
    const rows = db.all(
      'SELECT DISTINCT activation_id FROM issue_claims WHERE holder = ? AND activation_id IS NOT NULL',
      holder,
    );
    const activationIds = rows
      .map((row) => row.activation_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return { kind: 'resolved', activationIds, holder };
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: 'authority_store_unreadable',
      detail: `reading claim holders failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    try { db.close(); } catch { /* the connection is already gone */ }
  }
}
