import type { ChatState } from './chat/control.js';
interface JobStatus {
    status?: ChatState;
    bead_id?: string;
    specialist?: string;
    fifo_path?: string;
}
interface AttachTarget {
    id: string;
    status: JobStatus['status'];
    specialist: string;
    beadId?: string;
    fifoPath?: string;
    terminal: boolean;
}
export interface AttachRuntimeDeps {
    runTui?: (target: AttachTarget) => Promise<void>;
}
export declare function run(deps?: AttachRuntimeDeps): Promise<void>;
export {};
//# sourceMappingURL=attach.d.ts.map