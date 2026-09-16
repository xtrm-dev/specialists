import { type ObservabilitySqliteClient } from './observability-sqlite.js';
export type TryResolveNodeRefResult = {
    kind: 'resolved';
    id: string;
} | {
    kind: 'absent';
} | {
    kind: 'ambiguous';
    matches: Array<{
        id: string;
        node_name: string;
    }>;
};
export declare function tryResolveNodeRefWithClient(partialRef: string, sqliteClient: ObservabilitySqliteClient): TryResolveNodeRefResult;
export declare function resolveNodeRefWithClient(partialRef: string, sqliteClient: ObservabilitySqliteClient): string;
export declare function resolveNodeRef(partialRef: string): string;
export declare function resolveSingleActiveNodeRef(sqliteClient?: ObservabilitySqliteClient): string;
//# sourceMappingURL=node-resolve.d.ts.map