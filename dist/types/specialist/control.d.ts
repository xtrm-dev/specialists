export interface StopJobOptions {
    force?: boolean;
    closeBeadAnyway?: boolean;
    jobsDir?: string;
}
export interface FinalizeJobOptions {
    jobsDir?: string;
}
export declare function stopJob(jobId: string, opts?: StopJobOptions): Promise<void>;
export declare function finalizeJob(chainMemberId: string, opts?: FinalizeJobOptions): Promise<void>;
//# sourceMappingURL=control.d.ts.map