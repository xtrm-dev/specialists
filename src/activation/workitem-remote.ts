// src/activation/workitem-remote.ts
//
// The remote half of the work-item seam (SPECIALISTS-4398, XTRM-693).
//
// The host used to open one store: the canonical local sqlite file. With
// `substrate.remote` configured the store lives on another machine, so that file
// answered with a board the operator never chose — the failure SPECIALISTS-4398
// was first misfiled as a worktree-path bug. This module supplies the SAME
// WorkItemPorts the local path supplies, over Substrate's typed service instead
// of a sqlite handle, so the boundary, the inline-create flow and every
// settlement method are shared and local/remote differ only in the port.
//
// Two rules hold here and are not negotiable:
//
//   1. FAIL CLOSED. A configured remote that cannot answer throws; nothing in
//      this file can fall back to a local store, because it never opens one.
//   2. ONE CALL PER MUTATION, never retried. The protocol carries no idempotency
//      key, so a retried append can run twice. Settlement has its own retry
//      path — the read-first republish pass — and that is the only retry.
//
// Two wire differences are recorded rather than papered over:
//
//   * `completedBlockers` answers [] over the wire. Substrate exposes no
//     operation that returns active `blocks` edges (XTRM-715 is the parity
//     draft, deliberately unscheduled), so `getBlockers` is absent and the
//     boundary reports "no blocker information". It only supplies prior-work
//     context to the turn-1 prompt and never gates a dispatch.
//   * The journal/result and provenance writers are async here because a wire
//     call is async; the local services stay sync and are wrapped by the caller.

import type {
  ActiveClaimView,
  DispatchRequest,
  ExecutionBindingView,
  IssueServicePort,
  IssueStorePort,
  JournalServicePort,
  ProvenanceServicePort,
  WorkItemPorts,
} from './workitem-store.js';

/**
 * The one capability this adapter needs. Structural on purpose: the module has
 * no static dependency on @jaggerxtrm/substrate, exactly like the local opener,
 * so a build without Substrate still typechecks and only fails at open time.
 */
export interface RemoteWorkItemService {
  call<T = unknown>(op: string, args?: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

/** How a remote call failed, when the service names a transport code. */
interface CodedError extends Error {
  code?: string;
}

/**
 * Name the transport code in the message the dispatch refusal renders.
 *
 * `ServiceCallError.code` is a field, and the host surfaces `error.message` —
 * so a raw transport failure used to read as prose with no code in it. The code
 * is the actionable part (`not_installed` means install a newer sb, `timeout`
 * means the call may still run there), so it is promoted into the text and kept
 * on the error object for callers that branch.
 */
function transportFailure(remote: string, error: unknown): Error {
  const coded = error as CodedError | null;
  const code = typeof coded?.code === 'string' ? coded.code : null;
  const message = error instanceof Error ? error.message : String(error);
  if (code === null) return error instanceof Error ? error : new Error(message);
  const wrapped: CodedError = new Error(`substrate remote ${remote} call failed: ${code}: ${message}`);
  wrapped.code = code;
  return wrapped;
}

/**
 * A link that is gone, as opposed to a call the far side refused.
 *
 * `connection_lost` and `timeout` mean the transport between here and the store stopped carrying
 * answers: an ssh child that exited, a laptop that slept, a route that moved. `not_installed` and
 * `protocol_mismatch` are answers — the far side ran something unusable — and reopening the same
 * command would fail the same way, so they are not listed.
 */
const DROPPED_LINK_CODES = new Set(['connection_lost', 'timeout']);

/** Whether this failure means the connection is gone rather than the request refused. */
export function isDroppedLink(error: unknown): boolean {
  const code = (error as CodedError | null)?.code;
  return typeof code === 'string' && DROPPED_LINK_CODES.has(code);
}

/**
 * Keep one connection, and replace it on the call AFTER the one that lost it.
 *
 * A host process lives for hours, so a single dropped link must not end its usefulness: the host
 * opens this service at store creation and would otherwise answer every later dispatch with
 * `connection_lost` until restart. Failing closed is correct; failing closed forever is not.
 *
 * The failed call is NOT retried — the protocol has no idempotency key, so a replayed mutation
 * could run twice. Instead the loss is recorded and the next call closes the dead child and opens
 * a fresh one before it runs. Nothing is leaked: the previous service's `close()` runs before the
 * new one is opened, and a `close()` on an ssh child that already exited is a no-op.
 *
 * One reopen is shared: concurrent callers that arrive after the same drop wait on the same
 * promise, so a burst of work after a network blip opens one connection, not one per call.
 */
export function createReopeningService(
  first: RemoteWorkItemService,
  reopen: () => Promise<RemoteWorkItemService>,
): RemoteWorkItemService {
  let current = first;
  let stale = false;
  let pending: Promise<RemoteWorkItemService> | null = null;

  const ensure = async (): Promise<RemoteWorkItemService> => {
    if (!stale) return current;
    if (pending === null) {
      pending = (async () => {
        const previous = current;
        try {
          await previous.close();
        } catch {
          // A child that already exited refuses nothing that matters; the link is gone either way.
        }
        const next = await reopen();
        current = next;
        stale = false;
        return next;
      })().finally(() => {
        pending = null;
      });
    }
    return pending;
  };

  return {
    async call<T = unknown>(op: string, args?: Record<string, unknown>): Promise<T> {
      const service = await ensure();
      try {
        return await service.call<T>(op, args);
      } catch (error) {
        if (isDroppedLink(error)) stale = true;
        throw error;
      }
    },
    async close(): Promise<void> {
      await current.close();
    },
  };
}

/**
 * The PC checkout → server checkout mapping `sb remote setup` verified, held for the one
 * operation that needs it.
 *
 * Substrate's `issue.resolveProject` takes a `gitRoot` and matches it against the links of the
 * store it runs on. Over this transport the store is on the other machine, so a PC path is not
 * evidence there even when both machines happen to use the same layout: the verified mapping is.
 * The server checkout root travels instead, and a checkout with no verified mapping refuses
 * rather than guessing.
 */
export interface RemoteProjectTarget {
  /** Local git common root the mapping was derived from. */
  localRoot: string;
  repositoryKey: string;
  /** Server checkout root verified for that repository, or null when setup recorded none. */
  serverRoot: string | null;
}

/**
 * Build the work-item ports over a live service connection to the store-owning
 * machine.
 *
 * `remote` is the configured label (`ssh:<host>`), used only to say where the
 * failure happened; the connection itself is already open and is not this
 * function's to close.
 */
export function createRemoteWorkItemPorts(
  service: RemoteWorkItemService,
  opts: { remote: string; project?: RemoteProjectTarget },
): WorkItemPorts {
  const remote = opts.remote;
  const call = async <T>(op: string, args?: Record<string, unknown>): Promise<T> => {
    try {
      return await service.call<T>(op, args);
    } catch (error) {
      throw transportFailure(remote, error);
    }
  };

  const issues: IssueServicePort = {
    resolveRef: (ref) => call<{ id: string; humanRef: string }>('issue.resolveRef', { ref }),
    getActiveClaim: (issueId) => call<ActiveClaimView | null>('issue.getActiveClaim', { issueId }),
    // Present, so the boundary's release path does not silently become a no-op:
    // the op exists on the server and returns null when nothing is held.
    releaseClaim: (issueId, holder, claimOpts) =>
      call<{ id: number } | null>('issue.releaseClaim', {
        issueId,
        holder,
        ...(claimOpts?.activationId !== undefined ? { activationId: claimOpts.activationId } : {}),
      }),
    getParent: (childId) =>
      call<{ id: string; humanRef: string; title: string; currentRevision: number } | null>(
        'issue.getParent',
        { issueId: childId },
      ),
    // NO `getBlockers`: the wire has no active-edge read (XTRM-715). Absence is
    // "no blocker information" to the boundary, never "no blockers".
    getRevision: (issueId, revision) => call<{ contract: unknown }>('issue.getRevision', { issueId, revision }),
    getResolvedContext: (issueId) =>
      call<{
        entries: Array<{ key: string; value: unknown; sourceIssueId: string; sourceRevision: number; resolutionRule: string }>;
        hash: string;
      }>('issue.getResolvedContext', { issueId }),
    resolveProject: async (projectOpts) => {
      const project = opts.project;
      if (project === undefined || project.serverRoot === null) {
        throw new Error(
          `substrate remote ${remote}: no verified server checkout for ${project?.repositoryKey ?? projectOpts.gitRoot}; ` +
            `run \`sb remote setup ${remote}\` on this machine so the checkout maps to a server checkout`,
        );
      }
      // The connection, and therefore this mapping, belongs to the checkout the host runs in.
      // A caller resolving some other checkout would get this project and never notice.
      const inside =
        projectOpts.gitRoot === project.localRoot || projectOpts.gitRoot.startsWith(`${project.localRoot}/`);
      if (!inside) {
        throw new Error(
          `substrate remote ${remote}: ${projectOpts.gitRoot} is outside ${project.localRoot}, the checkout this connection was opened for`,
        );
      }
      return call<{ projectId: string }>('issue.resolveProject', { gitRoot: project.serverRoot });
    },
    createIssue: (input) => call<{ id: string }>('issue.create', { input }),
    claimReady: (issueId, holder, attestation, claimOpts) =>
      call<{ claim: { id: number } }>('issue.claimReady', {
        issueId,
        holder,
        attestation,
        ...(claimOpts?.activationId !== undefined ? { activationId: claimOpts.activationId } : {}),
      }),
  };

  const store: IssueStorePort = {
    get: (ref) => call('store.get', { ref }),
    // One call. `store.addJournal` performs the resolve + append on the server,
    // exactly as the local store does, so the remote path pays one round trip
    // per journal write and a dropped link cannot duplicate half of it.
    addJournal: async (ref, kind, journalOpts) => {
      await call('store.addJournal', {
        ref,
        kind,
        ...(journalOpts?.participantId !== undefined ? { participantId: journalOpts.participantId } : {}),
        ...(journalOpts?.activationId !== undefined ? { activationId: journalOpts.activationId } : {}),
      });
    },
  };

  const gate = {
    check: (_issues: unknown, req: DispatchRequest) =>
      call<{ issueId: string; revision: number; contractHash: string; report: unknown }>('gate.check', {
        request: req,
      }),
    dispatch: (_issues: unknown, _provenance: unknown, req: DispatchRequest) =>
      call<{ binding: ExecutionBindingView }>('gate.dispatch', { request: req }),
  };

  const journalService: JournalServicePort = {
    appendEntry: (issueId, input) =>
      call<{ id: string; sequence: number }>('journal.appendEntry', { issueId, input }),
    listEntries: (issueId, listOpts) =>
      call<Array<{
        id: string;
        kind?: string;
        activationId?: string | null;
        attemptId?: string | null;
        executionContext?: { specialist?: { attemptId?: string | null } | null } | null;
      }>>('journal.listEntries', {
        issueId,
        ...(listOpts?.kind !== undefined ? { kind: listOpts.kind } : {}),
        ...(listOpts?.limit !== undefined ? { limit: listOpts.limit } : {}),
      }),
  };

  const provenanceService: ProvenanceServicePort = {
    allocateReceipt: (bindingId) =>
      call<{ id: string; executionBindingId: string; issueId: string; issueRevision: number; contractHash: string }>(
        'provenance.allocateReceipt',
        { bindingId },
      ),
    attachArtifact: (receiptId, kind, value) =>
      call<{ receiptId?: string; kind?: string; value?: string }>('provenance.attachArtifact', {
        receiptId,
        kind,
        value,
      }),
    listReceipts: (issueId) => call<Array<{ id: string; executionBindingId: string }>>('provenance.listReceipts', { issueId }),
  };

  return {
    issues,
    // Unused on this path: `gate.dispatch` runs the producer's own gate, which
    // owns the provenance write. Kept in the shape the shared boundary destructures.
    provenance: null,
    store,
    gate,
    journalService,
    provenanceService,
  };
}
