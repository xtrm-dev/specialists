import { ChatFeed } from './chat/feed.js';
import { ChatStatus } from './chat/status.js';
import { createChatControl } from './chat/control.js';
export declare function run(): Promise<void>;
interface ChatEventTailerOptions {
    jobId: string;
    jobsDir: string;
    specialist: string;
    beadId?: string;
    feed: ChatFeed;
    requestRender: () => void;
}
export declare function startChatEventTailer(options: ChatEventTailerOptions): () => void;
export declare function silenceStderrDuringTui(): () => void;
interface SubmittedInputDeps {
    text: string;
    getJobId: () => string;
    getJobState: () => Promise<string | null>;
    getJobStatus: () => Promise<{
        fifo_path?: string;
        status?: string;
    } | null>;
    beadId?: string;
    control: ReturnType<typeof createChatControl>;
    appendEvent: (type: string, details: string) => void;
    requestRender: () => void;
    requestExit: () => void;
}
export declare function handleSubmittedInput(deps: SubmittedInputDeps): Promise<void>;
export declare function formatChatShow(jobId: string, beadId: string | undefined, status: {
    fifo_path?: string;
    status?: string;
} | null): string;
export declare function createCleanup(tui: any, terminal: any, status: ChatStatus): {
    stop(): Promise<void>;
};
export {};
//# sourceMappingURL=chat.d.ts.map