import { createChatControl } from './chat/control.js';
export declare function run(): Promise<void>;
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
export {};
//# sourceMappingURL=chat.d.ts.map