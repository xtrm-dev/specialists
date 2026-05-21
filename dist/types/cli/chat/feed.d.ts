import type { Component } from '@earendil-works/pi-tui';
export type FeedRowKind = 'token' | 'tool' | 'event' | 'result' | 'meta';
export interface FeedRow {
    kind: FeedRowKind;
    text: string;
    ts: number;
}
export declare class ChatFeed implements Component {
    private readonly rows;
    private cachedWidth;
    private cachedLines;
    private cachedRowCount;
    appendToken(text: string): void;
    appendToolStart(name: string, args: string): void;
    appendToolEnd(name: string, result: string): void;
    appendEvent(type: string, details: string): void;
    appendResult(text: string): void;
    invalidate(): void;
    render(width: number): string[];
    private appendRow;
    private wrapRows;
    private formatToolLine;
    private summarizeDetails;
}
//# sourceMappingURL=feed.d.ts.map