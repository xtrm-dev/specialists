// src/tools/specialist/specialist_result.tool.ts
import * as z from 'zod';
import type { NativeActivationHost } from '../../activation/native-host.js';
import type { RuntimeEventPusher } from '../../activation/async-events.js';
import { createObservabilitySqliteClient, type ObservabilitySqliteClient } from '../../specialist/observability-sqlite.js';
import { toActivationResultView } from './activation.tool.js';

export const specialistResultSchema = z.object({
  activation_id: z.string().min(1).describe(
    "Activation id: the full id or a unique short prefix, e.g. 'act:a2924153' or 'a2924153'.",
  ),
});

type ResultSource = 'memory' | 'observability_db';

function normalize(raw: string): string {
  const id = raw.trim();
  return id.startsWith('act:') ? id : `act:${id}`;
}

function nextTool(state: string): string {
  switch (state) {
    case 'running':
    case 'starting':
      return 'specialist_steer (it is still running; wait for the completion wake, then call specialist_result)';
    case 'waiting':
    case 'needs_reply':
    case 'escalated':
      return 'specialist_reply (it is waiting on an answer)';
    case 'failed':
      return 'specialist_retry (it failed and has no settled result)';
    default:
      return 'specialist_status (it has no settled result yet)';
  }
}

/**
 * Read ONE settled activation's complete result. specialist_status stays the
 * fleet view; this is the drill-down, so the output is never truncated.
 *
 * Lookup order: in-memory results of this server, then the durable
 * observability.db `specialist_results` row, then host state guidance.
 */
export function createSpecialistResultTool(
  getHost?: () => NativeActivationHost | undefined,
  getPusher?: () => RuntimeEventPusher | undefined,
  openObservability: () => ObservabilitySqliteClient | null = () => createObservabilitySqliteClient(),
) {
  return {
    name: 'specialist_result' as const,
    description: "Read the complete result of one settled activation by id (full id or unique short prefix). Returns the full output, never truncated. For an activation that has not settled it names the right next tool.",
    inputSchema: specialistResultSchema,
    async execute(input: z.infer<typeof specialistResultSchema>) {
      const wanted = normalize(input.activation_id);
      const results = (getPusher?.()?.allResults() ?? []).map(toActivationResultView);
      const snapshots = getHost?.()?.list() ?? [];

      const ids = new Set<string>([
        ...results.map(r => r.activation_id),
        ...snapshots.map(s => s.activationId),
      ]);
      const matches = ids.has(wanted) ? [wanted] : [...ids].filter(id => id.startsWith(wanted)).sort();
      if (matches.length > 1) {
        return {
          status: 'error' as const,
          error: `Ambiguous activation prefix: ${input.activation_id}`,
          candidates: matches,
        };
      }
      const id = matches[0] ?? wanted;

      const hit = results.find(r => r.activation_id === id);
      if (hit) {
        return {
          activation_id: hit.activation_id,
          specialist: snapshots.find(s => s.activationId === id)?.specialist ?? null,
          issue_ref: hit.issue_ref,
          status: hit.status,
          output: hit.output ?? '',
          validation: hit.validation,
          resolved_model: hit.resolved_model,
          completed_at: hit.completed_at,
          source: 'memory' as ResultSource,
        };
      }

      let client: ObservabilitySqliteClient | null = null;
      try {
        client = openObservability();
        const output = client?.readResult(id) ?? null;
        if (client && output !== null) {
          const row = client.readStatus(id);
          return {
            activation_id: id,
            specialist: row?.specialist ?? null,
            issue_ref: row?.bead_id ?? null,
            status: row?.status ?? 'done',
            output,
            validation: null,
            resolved_model: row?.model ?? null,
            completed_at: row?.last_event_at_ms ?? null,
            source: 'observability_db' as ResultSource,
          };
        }
      } catch {
        // An unreadable DB is the same as an absent one here; fall through to guidance.
      } finally {
        try { client?.close(); } catch { /* ignore */ }
      }

      const snapshot = snapshots.find(s => s.activationId === id);
      if (snapshot) {
        return { activation_id: id, state: snapshot.state, next: nextTool(snapshot.state) };
      }
      return { status: 'error' as const, error: `Unknown activation: ${input.activation_id}` };
    },
  };
}
