import { createObservabilitySqliteClient } from '../specialist/observability-sqlite.js';
interface ResultArgs {
    jobId?: string;
    nodeId?: string;
    memberKey?: string;
    positionalColonRef?: string;
    native?: boolean;
    wait: boolean;
    json: boolean;
    timeout?: number;
}
export declare function isNativeActivationId(ref: string): boolean;
export declare function isNativeAttemptId(ref: string): boolean;
export declare function resolveNativeAttemptToActivationId(attemptId: string): string;
export declare function parseArgs(argv: string[]): ResultArgs;
export type TryResolveJobIdResult = {
    kind: 'resolved';
    jobId: string;
} | {
    kind: 'node_absent';
} | {
    kind: 'member_absent';
} | {
    kind: 'member_without_job_id';
};
export declare function tryResolveJobIdFromNodeMember(sqliteClient: NonNullable<ReturnType<typeof createObservabilitySqliteClient>>, nodeId: string, memberKey: string): TryResolveJobIdResult;
export declare function resolveJobIdFromNodeMember(sqliteClient: NonNullable<ReturnType<typeof createObservabilitySqliteClient>>, nodeId: string, memberKey: string): string;
export declare function run(): Promise<void>;
export {};
//# sourceMappingURL=result.d.ts.map