/** One terminal settlement of one attempt. Raw output included by design. */
export interface SettlementRecord {
    activationId: string;
    attemptId: string;
    specialist: string;
    issueRef: string;
    issueRevision: number;
    contractHash: string;
    executionBindingId: string;
    /** Terminal status of the attempt. Failed attempts are stored (queryable) but never published. */
    status: 'completed' | 'failed';
    /** Full raw output. Bounded publication keeps this OUT of the Journal body. */
    output: unknown;
    validation: {
        valid: boolean;
        errors?: string[];
    };
    /** Links filled in after publication; absent when unpublished or degraded. */
    receiptId?: string;
    journalEntryId?: string;
    artifactRef?: string;
    completedAt: number;
}
/**
 * Runtime result storage port. `save` is an upsert on (activationId, attemptId):
 * the host stores the raw settlement first, then saves again with the
 * publication links once Journal/WorkReceipt publication resolves.
 */
export interface SettlementStore {
    save(record: SettlementRecord): string;
    get(activationId: string, attemptId: string): SettlementRecord | undefined;
    listAttempts(activationId: string): SettlementRecord[];
}
/** File-backed runtime store. Directories are created lazily on first save. */
export declare function createFileSettlementStore(root: string): SettlementStore;
/** In-memory store. Test double — production wires the file store. */
export declare function createMemorySettlementStore(): SettlementStore & {
    records: SettlementRecord[];
};
//# sourceMappingURL=settlement-store.d.ts.map