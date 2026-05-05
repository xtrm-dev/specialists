export declare function getChainPositionBadge(name: string): string | null;
export declare function computeMedianElapsedMs(elapsedMs: readonly number[]): number | null;
export interface ParsedArgs {
    category?: string;
    scope?: 'default' | 'user';
    json?: boolean;
    live?: boolean;
    showDead?: boolean;
    compact?: boolean;
    full?: boolean;
}
export declare class ArgParseError extends Error {
    constructor(message: string);
}
export declare function parseArgs(argv: string[]): ParsedArgs;
export declare function run(): Promise<void>;
//# sourceMappingURL=list.d.ts.map