import { McpServer } from '@modelcontextprotocol/server';
import type { McpRequestContext, Transport } from '@modelcontextprotocol/server';
import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { type SubstrateHandle } from '../substrate/services.js';
/**
 * Build one server instance. The `serveStdio` factory calls this once per
 * connection; the host inside lives for that connection because a dispatch in
 * one turn and its `specialist_reply`/`specialist_status` in the next must see
 * the same FleetRegistry. That is application continuity keyed by explicit
 * handles (activation_id/bead_id), not protocol state: capabilities and the
 * protocol revision are re-read from every request's own envelope.
 */
export interface BuildV2ServerOptions {
    /**
     * Override the resolved Substrate handle instead of asking `resolveSubstrate()`
     * for the process-wide, cached-once result. Tests use this to exercise both the
     * available and unavailable tool surfaces deterministically, independent of
     * whether `@jaggerxtrm/substrate` happens to be installed on the machine running
     * them. Production callers never pass this — the real cached resolution applies.
     */
    substrate?: SubstrateHandle;
}
export declare function buildV2Server(ctx?: McpRequestContext, options?: BuildV2ServerOptions): McpServer;
/** Which protocol revisions the stdio entry serves. */
export type StdioEra = 'dual' | 'legacy';
/**
 * `SPECIALISTS_MCP_ERA=legacy` selects legacy-only serving; anything else keeps the
 * dual-revision default. The Claude Code plugin's launcher sets it (SPECIALISTS-4234).
 */
export declare function stdioEraFromEnv(env?: NodeJS.ProcessEnv): StdioEra;
/**
 * Legacy-only stdio serving: one 2025-11-25 instance hand-wired to the transport.
 *
 * Claude Code negotiates the modern revision with any server that answers
 * `server/discover`, and a modern connection has no unsolicited notification path,
 * so the channel wake is skipped. A hand-wired instance answers `server/discover`
 * with Method not found and answers a 2026-07-28 `initialize` with 2025-11-25, which
 * Claude Code accepts as a per-server downgrade: this server goes legacy and every
 * other server keeps negotiating normally, with no global MCP_PROTOCOL_NEGOTIATION.
 */
export declare function serveLegacyStdio(transport?: Transport, options?: BuildV2ServerOptions): StdioServerHandle;
/**
 * Official SDK v2 stdio entry. By default the SDK serves both supported eras from
 * this factory and rejects unsupported protocol revisions; `era: 'legacy'` serves
 * 2025-11-25 alone (see {@link serveLegacyStdio}).
 */
export declare function serveV2Stdio(era?: StdioEra): StdioServerHandle;
//# sourceMappingURL=v2-server.d.ts.map