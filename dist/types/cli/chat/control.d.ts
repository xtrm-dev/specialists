import type { SupervisorStatus } from '../../specialist/supervisor.js';
export type Result = {
    ok: true;
    message?: string;
} | {
    ok: false;
    error_code: 'not_waiting' | 'already_stopped' | 'unknown_command' | 'missing_notes';
    likely_cause: string;
    next_safe_action: 'none' | 'rejoin';
};
export interface ControlOps {
    getJobState(jobId: string): Promise<ChatState | null>;
    stopJob(jobId: string): Promise<Result>;
    finalizeJob(jobId: string): Promise<Result>;
    appendBeadNote(beadId: string, text: string): Promise<Result>;
}
export type ChatState = SupervisorStatus['status'];
export type ChatAction = {
    kind: 'stop';
} | {
    kind: 'finalize';
} | {
    kind: 'notes';
    text: string;
} | {
    kind: 'show';
} | {
    kind: 'quit';
} | {
    kind: 'steer';
    text: string;
} | {
    kind: 'resume';
    text: string;
} | {
    kind: 'error';
    message: string;
} | {
    kind: 'info';
    message: string;
} | {
    kind: 'reject';
    message: string;
};
export interface DispatchInputContext {
    jobState: ChatState;
}
export interface ChatControl {
    dispatchInput(text: string, ctx: DispatchInputContext): ChatAction;
    executeInput(text: string, ctx: {
        jobId: string;
        jobState: ChatState;
        beadId?: string;
    }): Promise<ChatAction>;
}
export declare function createChatControl(controlOps: ControlOps): ChatControl;
export declare function dispatchInput(text: string, ctx: DispatchInputContext): ChatAction;
//# sourceMappingURL=control.d.ts.map