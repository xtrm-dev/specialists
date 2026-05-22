interface JobStatus {
    status?: string;
    bead_id?: string;
    specialist?: string;
}
interface AttachTarget {
    id: string;
    status: JobStatus['status'];
    specialist: string;
    beadId?: string;
    terminal: boolean;
}
export interface AttachRuntimeDeps {
    runTui?: (target: AttachTarget) => Promise<void>;
}
export declare function run(deps?: AttachRuntimeDeps): Promise<void>;
export {};
//# sourceMappingURL=attach.d.ts.map