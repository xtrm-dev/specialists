interface ResultArgs {
    jobId?: string;
    nodeId?: string;
    memberKey?: string;
    wait: boolean;
    json: boolean;
    timeout?: number;
}
export declare function isNativeActivationId(ref: string): boolean;
export declare function isNativeAttemptId(ref: string): boolean;
export declare function resolveNativeAttemptToActivationId(attemptId: string): string;
export declare function parseArgs(argv: string[]): ResultArgs;
export declare function run(): Promise<void>;
export {};
//# sourceMappingURL=result.d.ts.map