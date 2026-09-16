// XTRM-96 console adapter.
//
// Keep the existing RuntimeClient surface intact while routing the forensic LOG
// source through the shared persisted observability read model. `sp_feed` stays
// on its current human TimelineEvent projection. This lets Console migrate
// without coupling the UI-neutral read model back to console types/theme.

import { existsSync } from 'node:fs';
import { resolveObservabilityDbLocation } from '../../specialist/observability-db.js';
import {
  createObservabilitySqliteClient,
  createObservabilitySqliteClientAtPath,
  type ObservabilitySqliteClient,
} from '../../specialist/observability-sqlite.js';
import { asObservabilityReadSource, readForensicWindow } from '../../specialist/observability-read-model.js';
import { forensicEventToFeedRow } from './forensic.js';
import type { FeedEventRow, RepoRef, RuntimeClient } from './types.js';

export function withForensicObservability(runtime: RuntimeClient): RuntimeClient {
  const baseReadFeed = runtime.readFeed.bind(runtime);
  return new Proxy(runtime, {
    get(target, property) {
      if (property !== 'readFeed') {
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (args: Parameters<RuntimeClient['readFeed']>[0]): Promise<FeedEventRow[]> => {
        if ((args.source ?? 'forensic') !== 'forensic') return baseReadFeed(args);
        const client = openReadClient(args.repo);
        if (!client) {
          // File-only/old installations retain the previous console behavior.
          // Once an observability DB exists, however, its forensic rows are the
          // authority and we do not synthesize a second LOG stream from timeline.
          return baseReadFeed(args);
        }
        try {
          const window = readForensicWindow(asObservabilityReadSource(client), {
            jobId: args.jobId,
            limit: args.limit,
          });
          return window.events
            .filter((event) => typeof args.fromSeq !== 'number' || (event.seq ?? -1) >= args.fromSeq)
            .map((event, index) => forensicEventToFeedRow(
              event,
              {
                jobId: typeof event.correlation.job_id === 'string' ? event.correlation.job_id : args.jobId,
                specialist: event.resource.participant_role ?? 'unknown',
                ...(typeof event.correlation.bead_id === 'string' ? { beadId: event.correlation.bead_id } : {}),
                ...(typeof event.correlation.node_id === 'string' ? { nodeId: event.correlation.node_id } : {}),
                ...(typeof event.resource.repo === 'string' ? { repo: event.resource.repo } : {}),
                ...(typeof event.resource.model === 'string' ? { model: event.resource.model } : {}),
                ...(typeof event.correlation.chain_id === 'string' ? { chainId: event.correlation.chain_id } : {}),
                ...(typeof event.correlation.chain_root_job_id === 'string' ? { chainRootJobId: event.correlation.chain_root_job_id } : {}),
                ...(typeof event.correlation.chain_root_bead_id === 'string' ? { chainRootBeadId: event.correlation.chain_root_bead_id } : {}),
                ...(typeof event.correlation.epic_id === 'string' ? { epicId: event.correlation.epic_id } : {}),
                ...(typeof event.correlation.pi_session_id === 'string' ? { piSessionId: event.correlation.pi_session_id } : {}),
                ...(typeof event.correlation.workspace_id === 'string' ? { workspaceId: event.correlation.workspace_id } : {}),
                ...(typeof event.correlation.conversation_id === 'string' ? { conversationId: event.correlation.conversation_id } : {}),
                ...(typeof event.correlation.trace_id === 'string' ? { traceId: event.correlation.trace_id } : {}),
                ...(typeof event.correlation.span_id === 'string' ? { spanId: event.correlation.span_id } : {}),
                ...(typeof event.correlation.parent_span_id === 'string' ? { parentSpanId: event.correlation.parent_span_id } : {}),
              },
              index,
            ));
        } finally {
          client.close();
        }
      };
    },
  });
}

function openReadClient(repo: RepoRef): ObservabilitySqliteClient | null {
  if (repo.dbPath) {
    if (!existsSync(repo.dbPath)) return null;
    return createObservabilitySqliteClientAtPath(repo.dbPath);
  }
  const location = resolveObservabilityDbLocation(repo.path);
  if (!existsSync(location.dbPath)) return null;
  return createObservabilitySqliteClient(repo.path);
}
