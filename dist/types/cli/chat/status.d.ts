type ChatTui = {
    requestRender(): void;
};
interface ChatStatusOptions {
    pollIntervalMs?: number;
}
export declare class ChatStatus {
    private readonly tui;
    private readonly pollIntervalMs;
    private currentStatus;
    private lastSignature;
    private timer;
    private disposed;
    constructor(tui: ChatTui, options?: ChatStatusOptions);
    start(): void;
    stop(): void;
    render(width: number): string;
    poll(): Promise<void>;
    private readCurrentStatus;
}
export {};
//# sourceMappingURL=status.d.ts.map