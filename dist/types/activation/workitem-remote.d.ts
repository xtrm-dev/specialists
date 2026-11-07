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