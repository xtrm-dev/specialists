export type ProcessHealthThresholds = {
    warnPct: number;
    refusePct: number;
};
export type ProcessHealthProcessKind = 'specialist' | 'dolt' | 'serena-lsp' | 'orphan';
export interface ProcessHealthProcess {
    pid: number;
    ppid: number;
    kind: ProcessHealthProcessKind;
    role: string;
    cmdline: string;
    cwd: string | null;
    rssBytes: number;
    cpuPct: number;
    ageSeconds: number;
    worktree: string | null;
    reason?: 'dolt-worktree-local' | 'gitnexus-orphan' | 'pi-orphan' | 'deleted-worktree-process';
}
export interface ProcessHealthWorkspaceGroup {
    workspace: string;
    count: number;
    rssBytes: number;
    processes: ProcessHealthProcess[];
}
export type ProcessHealthStatus = 'OK' | 'WARN' | 'REFUSE';
export interface ProcessHealthReport {
    status: ProcessHealthStatus;
    statusReasons: string[];
    memAvailableBytes: number;
    totalRssBytes: number;
    totalCpuPct: number;
    specialistCount: number;
    doltCount: number;
    serenaLspCount: number;
    orphanCount: number;
    thresholdPct: number;
    warnPct: number;
    refusePct: number;
    warnLimitBytes: number;
    refuseLimitBytes: number;
    specialistProcesses: ProcessHealthProcess[];
    doltProcesses: ProcessHealthProcess[];
    serenaWorkspaces: ProcessHealthWorkspaceGroup[];
    orphanProcesses: ProcessHealthProcess[];
}
export declare function getProcessHealthThresholds(env?: NodeJS.ProcessEnv): ProcessHealthThresholds;
export declare function collectProcessHealth(options?: {
    procRoot?: string;
    meminfoPath?: string;
    nowMs?: number;
}): ProcessHealthReport;
export declare function collectOrphanProcesses(options?: {
    procRoot?: string;
    nowMs?: number;
}): ProcessHealthProcess[];
//# sourceMappingURL=process-health.d.ts.map