/**
 * Substrate work-authority store: the one `~/.xtrm/state.db`.
 *
 * Writer owner (unitAI-aiwva.3): NativeActivationHost lifecycle. The host already owns
 * the in-memory FleetRegistry; persisting that projection here is one hop. There is no
 * sb daemon code in this repo, so no sb-runtime writer exists to choose, and per-repo
 * observability.db is forensic evidence, not work authority — no migration, no second
 * store. A future sb writes this same path; the path resolver below is the one place
 * that decision lives.
 *
 * Override is explicit environment only (`XTRM_STATE_DB`); the path is never derived
 * from the project directory or the plugin root. Writes are best-effort: the authority
 * must never fail an activation, the same discipline as the SessionStart hook (exit 0
 * always) and the forensic sink.
 */
import type { ActivationSnapshot } from './types.js';
/** Increment when the DDL below changes shape. */
export declare const AUTHORITY_SCHEMA_VERSION = 1;
/**
 * The exact projection the SessionStart hook queries. Column names must stay
 * column-for-column identical to plugins/specialists/scripts/session-start.mjs:
 * activation_id, specialist, state, bead_id, last_activity_at.
 */
export declare const ACTIVATIONS_DDL = "CREATE TABLE IF NOT EXISTS activations (\n  activation_id TEXT PRIMARY KEY,\n  specialist TEXT NOT NULL,\n  state TEXT NOT NULL,\n  bead_id TEXT,\n  last_activity_at INTEGER NOT NULL\n)";
/**
 * Resolve the one authority path.
 *
 * `SUBSTRATE_DB` wins, then `XTRM_STATE_DB`, then the canonical `~/.xtrm/state.db`.
 *
 * The order is ownership, not preference. This store belongs to Substrate, which defines
 * the resolution as "explicit override, else SUBSTRATE_DB, else ~/.xtrm/state.db", pins it
 * with its own db-authority test, and shares it with sb and Pi. `XTRM_STATE_DB` is a name
 * specialists invented for the same file: it appears nowhere in the substrate packages, and
 * `SUBSTRATE_DB` appeared nowhere here. So an operator redirecting the store the documented
 * way moved sb and Pi but left specialists writing activations to the default path — two
 * components disagreeing about where authority lives, silently (unitAI-0whq0).
 *
 * `XTRM_STATE_DB` is kept and still honoured, so setups that only set it are unchanged; it
 * simply no longer overrides the owner's variable.
 *
 * Blank falls through — an unset-feeling value must never become a store path. Takes no
 * cwd/project/plugin input by design.
 */
export declare function resolveAuthorityDbPath(env?: NodeJS.ProcessEnv): string;
/**
 * Creation/migration path: idempotent. `IF NOT EXISTS` is the whole migration story
 * for E2 — the table either exists with these columns or is created; no data moves.
 */
export declare function ensureAuthorityStore(dbPath: string): void;
/** The host persists its Fleet projection through this; tests inject a temp path. */
export interface AuthorityWriter {
    record(snapshot: Pick<ActivationSnapshot, 'activationId' | 'specialist' | 'state' | 'issueRef' | 'lastActivityAt'>): void;
    /**
     * Drop a disposed activation. `stop()` is the only ordinary path to disposal, so
     * the row must go with it — otherwise SessionStart would surface dead work as
     * live (its filter covers settled/disposed, and a stopped row is neither).
     * Settled rows stay: settled means waiting and resumable, never disposed.
     */
    remove(activationId: string): void;
}
/** Used where authority persistence is genuinely not wanted (unit tests). */
export declare const NULL_AUTHORITY_WRITER: AuthorityWriter;
/**
 * File-backed writer against the one authority (default path resolved from the
 * environment at wiring time). One connection per record: lifecycle transitions are
 * low-frequency, and a held-open writer would lock the hook's reader out.
 */
export declare function createFileAuthorityWriter(dbPath?: string): AuthorityWriter;
//# sourceMappingURL=authority-store.d.ts.map