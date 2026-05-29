export type JobFileOutputMode = 'on' | 'off';
export type JobFileWriteMode = 'append' | 'overwrite';
export declare function detectJobFileOutputMode(env?: NodeJS.ProcessEnv): JobFileOutputMode;
export declare function isJobFileOutputEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function writeJobFileOutput(path: string, content: string, mode: JobFileWriteMode): Promise<void>;
//# sourceMappingURL=job-file-output.d.ts.map