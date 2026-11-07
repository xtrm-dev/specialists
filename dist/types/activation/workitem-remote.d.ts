import type { WorkItemPorts } from './workitem-store.js';
/**
 * The one capability this adapter needs. Structural on purpose: the module has
 * no static dependency on @jaggerxtrm/substrate, exactly like the local opener,
 * so a build without Substrate still typechecks and only fails at open time.
 */
export interface RemoteWorkItemService {
    call<T = unknown>(op: string, args?: Record<string, unknown>): Promise<T>;
    close(): Promise<void>;
}
/** Whether this failure means the connection is gone rather than the request refused. */
export declare function isDroppedLink(error: unknown): boolean;
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
export declare function createReopeningService(first: RemoteWorkItemService, reopen: () => Promise<RemoteWorkItemService>): RemoteWorkItemService;
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
export declare function createRemoteWorkItemPorts(service: RemoteWorkItemService, opts: {
    remote: string;
    project?: RemoteProjectTarget;
}): WorkItemPorts;
//# sourceMappingURL=workitem-remote.d.ts.map